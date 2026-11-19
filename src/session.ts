import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "./config";

export interface Sess { hash: string; csrf: string }
declare module "fastify" { interface FastifyRequest { sess?: Sess } }

const mac = (s: string) =>
  crypto.createHmac("sha256", env.SESSION_SECRET).update(s).digest("base64url");

const eq = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function startSession(reply: FastifyReply): Sess {
  const id = crypto.randomBytes(32).toString("base64url");
  reply.setCookie("sid", `${id}.${mac(id)}`, {
    httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 60 * 60 * 6,
  });
  return derive(id);
}

const derive = (id: string): Sess => ({
  hash: crypto.createHash("sha256").update(id).digest("hex"),
  csrf: mac("csrf:" + id),
});

export function readSession(req: FastifyRequest): Sess | null {
  const raw = req.cookies.sid;
  if (!raw) return null;
  const [id, sig, extra] = raw.split(".");
  if (!id || !sig || extra !== undefined || !eq(sig, mac(id))) return null;
  return derive(id);
}

// preHandler: valid session + (for mutating requests) CSRF header
export async function requireSession(req: FastifyRequest, reply: FastifyReply) {
  const s = readSession(req);
  if (!s) return reply.code(401).send({ error: "no_session" });
  if (req.method !== "GET") {
    const t = String(req.headers["x-csrf-token"] ?? "");
    if (!eq(t, s.csrf)) return reply.code(403).send({ error: "csrf" });
  }
  req.sess = s;
}
