import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { Pool } from "pg";
import { env } from "./config";
import { settleOrder } from "./orders";

export function registerWebhook(app: FastifyInstance, db: Pool, redis: Redis) {
  // needs raw body: register fastify-raw-body with { field: "rawBody", global: false }
  app.post("/v1/webhooks/psp", { config: { rawBody: true } }, async (req, reply) => {
    const ts = String(req.headers["x-timestamp"] ?? "");
    const nonce = String(req.headers["x-nonce"] ?? "");
    const sig = String(req.headers["x-signature"] ?? "");
    const raw = (req as any).rawBody as string;

    if (!ts || !nonce || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300)
      return reply.code(401).send({ error: "invalid_request" });

    const expected = crypto.createHmac("sha256", env.WEBHOOK_SECRET)
      .update(`${ts}.${nonce}.${raw}`).digest();
    const given = Buffer.from(sig, "hex");
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected))
      return reply.code(401).send({ error: "invalid_signature" });

    // replay protection: nonce accepted once within 10 min
    const fresh = await redis.set(`nonce:${nonce}`, "1", "EX", 600, "NX");
    if (!fresh) return reply.code(409).send({ error: "replay" });

    const body = JSON.parse(raw) as {
      status: string; order_ref: string; amount_paise: number; txn_id: string };
    if (body.status !== "SUCCESS") return reply.send({ ok: true });

    try {
      await settleOrder(db, { orderRef: body.order_ref, amountPaise: body.amount_paise,
        providerTxnId: body.txn_id, source: "psp" });
      return reply.send({ ok: true });
    } catch { return reply.code(422).send({ error: "rejected" }); }
  });
}
