import { nanoid } from "nanoid";
import { desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { orders, orderItems, cartItems } from "@/db/schema";

export async function createOrderFromCart(
  db: DB,
  cartId: string,
  paymentMethod: "stub" | "kyapay",
): Promise<string> {
  const lines = await db.query.cartItems.findMany({
    where: eq(cartItems.cartId, cartId),
    with: { product: true },
  });
  if (lines.length === 0) throw new Error("Cannot create order from empty cart");

  const subtotal = lines.reduce(
    (sum, l) => sum + l.product.priceCents * l.quantity,
    0,
  );

  const id = nanoid(12);
  db.transaction((tx) => {
    tx.insert(orders).values({
      id,
      cartId,
      paymentMethod,
      subtotalCents: subtotal,
    }).run();
    tx.insert(orderItems).values(
      lines.map((l) => ({
        orderId: id,
        productId: l.productId,
        quantity: l.quantity,
        priceCentsAtPurchase: l.product.priceCents,
      })),
    ).run();
    // clear cart
    tx.delete(cartItems).where(eq(cartItems.cartId, cartId)).run();
  });
  return id;
}

export async function getOrderById(db: DB, id: string) {
  const result = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    with: {
      items: {
        with: { product: true },
      },
    },
  });
  return result ?? null;
}

export async function listOrdersForCart(db: DB, cartId: string) {
  return db.query.orders.findMany({
    where: eq(orders.cartId, cartId),
    orderBy: [desc(orders.createdAt), desc(sql`rowid`)],
    with: { items: { with: { product: true } } },
  });
}
