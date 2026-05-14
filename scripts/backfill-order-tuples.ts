import { getDb, closeDb } from "../db";
import { orders } from "../db/schema";
import { isNotNull } from "drizzle-orm";
import { getAuth } from "../lib/auth";

async function main() {
  const db = getDb();
  const { permission } = getAuth();
  const all = await db.select().from(orders).where(isNotNull(orders.userId));
  console.log(`Found ${all.length} orders with userId. Writing owner+view tuples...`);
  let ok = 0;
  let fail = 0;
  for (const o of all) {
    const subject = `User:${o.userId}`;
    try {
      await permission.addTuple({ namespace: "Order", object: o.id, relation: "owner", subject });
      await permission.addTuple({ namespace: "Order", object: o.id, relation: "view", subject });
      console.log(`  ✓ ${o.id}`);
      ok++;
    } catch (err) {
      console.log(`  ✗ ${o.id}: ${(err as Error).message}`);
      fail++;
    }
  }
  console.log(`Done. ${ok} succeeded, ${fail} failed.`);
  closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
