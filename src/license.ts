import crypto from "node:crypto";
import { env } from "./config";

const priv = crypto.createPrivateKey(env.LICENSE_PRIVATE_KEY_PEM);
const pub = crypto.createPublicKey(env.LICENSE_PUBLIC_KEY_PEM);

export interface LicenseClaims { lid: string; iat: number; exp?: number }

export function signLicense(c: LicenseClaims): string {
  const payload = Buffer.from(JSON.stringify(c)).toString("base64url");
  const sig = crypto.sign(null, Buffer.from(payload), priv).toString("base64url");
  return `${payload}.${sig}`;
}

export function verifyLicenseToken(token: string): LicenseClaims | null {
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const ok = crypto.verify(null, Buffer.from(payload), pub, Buffer.from(sig, "base64url"));
  if (!ok) return null;
  const c = JSON.parse(Buffer.from(payload, "base64url").toString()) as LicenseClaims;
  if (c.exp && c.exp * 1000 < Date.now()) return null;
  return c; // caller MUST still check revoked_at in DB
}
