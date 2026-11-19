import type { Redis } from "ioredis";
import type { FastifyReply, FastifyRequest } from "fastify";

export async function hit(r: Redis, key: string, max: number, windowSec: number) {
  const [[, n]] = (await r.multi().incr(key).expire(key, windowSec, "NX").exec()) as any;
  return Number(n) <= max;
}

export const limiter = (r: Redis, name: string, max: number, windowSec: number) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await hit(r, `rl:${name}:${req.ip}`, max, windowSec)))
      return reply.code(429).header("retry-after", String(windowSec)).send({ error: "rate_limited" });
  };

// brute-force: N failures => lock key for lockSec
export const isLocked = async (r: Redis, k: string) => (await r.exists(`lock:${k}`)) === 1;
export async function recordFailure(r: Redis, k: string, max = 10, lockSec = 900) {
  const n = await r.incr(`fail:${k}`);
  if (n === 1) await r.expire(`fail:${k}`, lockSec);
  if (n >= max) await r.set(`lock:${k}`, "1", "EX", lockSec);
}
