import { env, PRICE_PAISE } from "./config";

const enc = encodeURIComponent;

export function buildUpiIntent(orderRef: string): string {
  const q = [
    ["pa", env.UPI_VPA],
    ["pn", env.MERCHANT_NAME],
    ["tr", orderRef],
    ["tn", `Repo access ${orderRef}`],
    ["am", (PRICE_PAISE / 100).toFixed(2)],
    ["cu", "INR"],
  ].map(([k, v]) => `${k}=${enc(v)}`).join("&");
  return `upi://pay?${q}`;
}
// QR: render buildUpiIntent() output with `qrcode` package server-side.
// NOTE: a upi:// link has NO guaranteed callback. Never mark paid on return.
