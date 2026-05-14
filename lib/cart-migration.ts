import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { carts, cartItems } from "@/db/schema";
import { addItem } from "@/lib/cart";

export interface ClaimResult {
  cartId: string | null;
}

export async function claimCartForUser(db: DB, anonymousCartId: string, userId: string): Promise<ClaimResult> {
  const anon = await db.query.carts.findFirst({
    where: eq(carts.id, anonymousCartId),
    with: { items: true },
  });
  if (!anon) return { cartId: null };
  if (anon.userId === userId) return { cartId: anon.id };

  const existing = await db.query.carts.findFirst({
    where: and(eq(carts.userId, userId)),
  });

  if (!existing) {
    await db.update(carts).set({ userId, updatedAt: new Date() }).where(eq(carts.id, anon.id));
    return { cartId: anon.id };
  }

  // Merge: add each anonymous item to the existing cart.
  for (const line of anon.items) {
    await addItem(db, existing.id, line.productId, line.quantity);
  }
  await db.delete(cartItems).where(eq(cartItems.cartId, anon.id));
  await db.delete(carts).where(eq(carts.id, anon.id));
  return { cartId: existing.id };
}
