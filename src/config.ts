import { z } from "zod";

export const PRICE_PAISE = 49900; // hardcoded server-side, never from client/env

export const env = z.object({
  UPI_VPA: z.string().regex(/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/),
  MERCHANT_NAME: z.string().min(2).max(60),
  WEBHOOK_SECRET: z.string().min(32),
  LICENSE_PRIVATE_KEY_PEM: z.string(),
  LICENSE_PUBLIC_KEY_PEM: z.string(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  PAYMENT_MODE: z.enum(["sandbox", "manual", "psp"]).default("sandbox"),
}).parse(process.env);
