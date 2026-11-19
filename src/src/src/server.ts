import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import rawBody from "fastify-raw-body";
import { Pool } from "pg";
import { Redis } from "ioredis";
import QRCode from "qrcode";
import crypto from "node:crypto";
import { z } from "zod";
import { env, PRICE_PAISE } from "./config";
import { buildUpiIntent } from "./upi";
import { createOrder, settleOrder } from "./orders";
import { signLicense, verifyLicenseToken } from "./license";
import { registerWebhook } from "./webhook";
import { requireSession, startSession } from "./session";
import { limiter, isLocked, recordFailure } from "./ratelimit";

if (env.PAYMENT_MODE === "sandbox" && process.env.NODE_ENV === "production")
  throw new Error("Refusing to start: sandbox mode is not allowed in production");

const db = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
const redis = new Redis(env.REDIS_URL);

const app = Fastify({
  trustProxy: 1, // set to the REAL number of proxies in front of you
  bodyLimit: 16 * 1024,
  logger: { redact: ["req.headers.cookie", "req.headers['x-csrf-token']", "req.headers['x-signature']"] },
});

await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", "data:"] } } });
await app.register(cookie);
await app.register(rawBody, { field: "rawBody", global: false, encoding: "utf8", runFirst: true });

app.setErrorHandler((err, _req, reply) => {
  app.log.error({ msg: err.message });               // never log bodies/secrets
  reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500)
       .send({ error: "request_failed" });          // generic message to client
});

// 1) session + csrf token
app.post("/v1/session", { preHandler: limiter(redis, "session", 20, 60) }, async (_req, reply) => {
  const s = startSession(reply);
  return { csrfToken: s.csrf };
});

// 2) create order (price is NEVER read from the request)
const idem = z.string().uuid();
app.post("/v1/orders", { preHandler: [limiter(redis, "order", 5, 60), requireSession] }, async (req, reply) => {
  const key = idem.safeParse(req.headers["idempotency-key"]);
  if (!key.success) return reply.code(400).send({ error: "idempotency_key_required" });

  const { rows: [c] } = await db.query(
    "select count(*)::int n from orders where session_hash=$1 and status='pending' and expires_at>now()",
    [req.sess!.hash]);
  if (c.n >= 3) return reply.code(429).send({ error: "too_many_pending_orders" });

  const o = await createOrder(db, key.data, req.sess!.hash);
  const intent = buildUpiIntent(o.order_ref);
  return {
    orderRef: o.order_ref, amountInr: PRICE_PAISE / 100, expiresAt: o.expires_at,
    upiIntent: intent, qrDataUrl: await QRCode.toDataURL(intent, { margin: 1, width: 320 }),
    verification: env.PAYMENT_MODE, // "sandbox" | "manual" | "psp" — UI must label it honestly
  };
});

// 3) status — only the owning session can read it
app.get("/v1/orders/:ref/status", { preHandler: [limiter(redis, "status", 60, 60), requireSession] }, async (req, reply) => {
  const { ref } = req.params as { ref: string };
  if (!/^ORD[0-9A-F]{16}$/.test(ref)) return reply.code(400).send({ error: "bad_ref" });
  const { rows: [o] } = await db.query(
    `select o.status, o.expires_at, l.license_id, p.created_at paid_at, p.provider_txn_id
       from orders o left join licenses l on l.order_id=o.id left join payments p on p.order_id=o.id
      where o.order_ref=$1 and o.session_hash=$2`, [ref, req.sess!.hash]);
  if (!o) return reply.code(404).send({ error: "not_found" });

  if (o.status !== "paid") return { status: o.status };
  return {
    status: "paid", paidAt: o.paid_at, txnRef: o.provider_txn_id, amountInr: PRICE_PAISE / 100,
    licenseToken: signLicense({ lid: o.license_id, iat: Math.floor(Date.now() / 1000) }),
  };
});

// 4) license validation (signature + DB revocation/expiry, with brute-force lock)
app.post("/v1/licenses/validate", { preHandler: limiter(redis, "lic", 30, 60) }, async (req, reply) => {
  if (await isLocked(redis, req.ip)) return reply.code(429).send({ error: "locked" });
  const body = z.object({ token: z.string().max(1024) }).safeParse(req.body);
  const claims = body.success ? verifyLicenseToken(body.data.token) : null;

  let valid = false;
  if (claims) {
    const { rows: [l] } = await db.query(
      "select 1 from licenses where license_id=$1 and revoked_at is null and (expires_at is null or expires_at>now())",
      [claims.lid]);
    valid = !!l;
  }
  if (!valid) await recordFailure(redis, req.ip);
  return { valid }; // no reason leaked
});

registerWebhook(app, db, redis);

// 5) sandbox ONLY (labelled, disabled in production + non-sandbox modes)
if (env.PAYMENT_MODE === "sandbox") {
  app.post("/v1/sandbox/confirm", { preHandler: [limiter(redis, "sbx", 10, 60), requireSession] }, async (req, reply) => {
    const { orderRef } = z.object({ orderRef: z.string() }).parse(req.body);
    const r = await settleOrder(db, { orderRef, amountPaise: PRICE_PAISE,
      providerTxnId: "SANDBOX-" + crypto.randomBytes(6).toString("hex"), source: "manual" });
    return { sandbox: true, ...r };
  });
}

await app.listen({ port: 3000, host: "0.0.0.0" });
