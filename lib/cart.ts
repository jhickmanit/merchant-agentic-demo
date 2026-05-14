import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db";
import { carts, cartItems } from "@/db/schema";

export async function createCart(db: DB): Promise<string> {
  const id = nanoid(16);
  await db.insert(carts).values({ id });
  return id;
}

export async function getCartWithItems(db: DB, cartId: string) {
  const cart = await db.query.carts.findFirst({
    where: eq(carts.id, cartId),
    with: {
      items: {
        with: { product: true },
      },
    },
  });
  return cart ?? null;
}

export async function addItem(db: DB, cartId: string, productId: string, qty: number) {
  if (qty <= 0) throw new Error(`quantity must be > 0, got ${qty}`);
  const existing = await db.query.cartItems.findFirst({
    where: and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)),
  });
  if (existing) {
    await db
      .update(cartItems)
      .set({ quantity: existing.quantity + qty })
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
  } else {
    await db.insert(cartItems).values({ cartId, productId, quantity: qty });
  }
}

export async function removeItem(db: DB, cartId: string, productId: string) {
  await db
    .delete(cartItems)
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
}

export async function updateQuantity(db: DB, cartId: string, productId: string, qty: number) {
  if (qty < 0) throw new Error(`quantity must be >= 0, got ${qty}`);
  if (qty === 0) {
    await removeItem(db, cartId, productId);
    return;
  }
  await db
    .update(cartItems)
    .set({ quantity: qty })
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.productId, productId)));
}
