import crypto from "node:crypto";
import type { Pool } from "pg";
import { PRICE_PAISE } from "./config";
import { signLicense } from "./license";

export async function createOrder(db: Pool, idemKey: string, sessionHash: string) {
  const ref = "ORD" + crypto.randomBytes(8).toString("hex").toUpperCase();
  const { rows } = await db.query(
    `insert into orders(order_ref, idempotency_key, session_hash, amount_paise, expires_at)
     values($1,$2,$3,$4, now() + interval '15 minutes')
     on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
     returning order_ref, status, expires_at`,
    [ref, idemKey, sessionHash, PRICE_PAISE],
  );
  return rows[0];
}

export async function settleOrder(
  db: Pool,
  a: { orderRef: string; amountPaise: number; providerTxnId: string; source: "psp" | "manual" },
) {
  const c = await db.connect();
  try {
    await c.query("begin");
    const { rows: [o] } = await c.query(
      "select * from orders where order_ref=$1 for update", [a.orderRef]);
    if (!o) throw new Error("order_not_found");

    if (o.status === "paid") { await c.query("commit"); return { already: true }; }
    if (o.status !== "pending" || new Date(o.expires_at) < new Date())
      throw new Error("order_not_payable");

    if (Number(o.amount_paise) !== a.amountPaise || a.amountPaise !== PRICE_PAISE) {
      await c.query("update orders set status='amount_mismatch' where id=$1", [o.id]);
      await c.query("insert into audit_log(event,order_ref,meta) values('amount_mismatch',$1,$2)",
        [a.orderRef, { got: a.amountPaise }]);
      await c.query("commit");
      throw new Error("amount_mismatch");
    }

    // PK on provider_txn_id => same bank txn can never settle two orders
    const ins = await c.query(
      `insert into payments(provider_txn_id, order_id, amount_paise, source)
       values($1,$2,$3,$4) on conflict do nothing`,
      [a.providerTxnId, o.id, a.amountPaise, a.source]);
    if (ins.rowCount === 0) throw new Error("duplicate_transaction");

    await c.query("update orders set status='paid' where id=$1", [o.id]);
    const { rows: [lic] } = await c.query(
      "insert into licenses(order_id) values($1) returning license_id", [o.id]);
    await c.query("insert into audit_log(event,order_ref,meta) values('settled',$1,$2)",
      [a.orderRef, { source: a.source }]);
    await c.query("commit");

    return { already: false, token: signLicense({ lid: lic.license_id, iat: Math.floor(Date.now() / 1000) }) };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally { c.release(); }
}
