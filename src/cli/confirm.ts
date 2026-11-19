import readline from "node:readline/promises";
import { Pool } from "pg";
import { env, PRICE_PAISE } from "../config";
import { settleOrder } from "../orders";

if (env.PAYMENT_MODE !== "manual") {
  console.error("confirm CLI only works with PAYMENT_MODE=manual"); process.exit(1);
}
const [orderRef, bankTxnId] = process.argv.slice(2);
if (!orderRef || !bankTxnId) {
  console.error("usage: npm run confirm -- ORD1234567890ABCDEF <bank_txn_id>"); process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log("Pehle apne bank statement/PhonePe Business app mein ye credit dekho:");
console.log(`  amount ₹${PRICE_PAISE / 100}, remark/ref contains ${orderRef}, txn id ${bankTxnId}`);
const amt = await rl.question("Bank mein credited amount (₹) type karo: ");
const ok = (await rl.question(`Confirm ${orderRef}? (yes/no): `)).trim() === "yes";
rl.close();
if (!ok) process.exit(0);

const db = new Pool({ connectionString: env.DATABASE_URL });
try {
  const r = await settleOrder(db, { orderRef, amountPaise: Math.round(Number(amt) * 100),
    providerTxnId: bankTxnId, source: "manual" });
  console.log(r.already ? "Already paid." : "Settled. License issued.");
} catch (e) { console.error("Rejected:", (e as Error).message); process.exitCode = 1; }
finally { await db.end(); }
