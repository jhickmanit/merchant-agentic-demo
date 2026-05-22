import { nanoid } from "nanoid";
import { desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db";
import { orders, orderItems, cartItems } from "@/db/schema";
import type { PermissionProvider } from "@/lib/auth/permissions";

export async function createOrderFromCart(
  db: DB,
  cartId: string,
  userId: string,
  paymentMethod: "stub" | "kyapay" | "mock_card",
  opts?: {
    permissions?: PermissionProvider;
    paymentTokenJti?: string;
    skyfireChargeId?: string;
    kyaClaimsJson?: string;
    paymentBrand?: string;
    paymentLast4?: string;
    paymentAuthId?: string;
    policyEventsJson?: string;
  },
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
      userId,
      paymentMethod,
      subtotalCents: subtotal,
      paymentTokenJti: opts?.paymentTokenJti ?? null,
      skyfireChargeId: opts?.skyfireChargeId ?? null,
      kyaClaimsJson: opts?.kyaClaimsJson ?? null,
      paymentBrand: opts?.paymentBrand ?? null,
      paymentLast4: opts?.paymentLast4 ?? null,
      paymentAuthId: opts?.paymentAuthId ?? null,
      policyEventsJson: opts?.policyEventsJson ?? null,
    }).run();
    tx.insert(orderItems).values(
      lines.map((l) => ({
        orderId: id,
        productId: l.productId,
        quantity: l.quantity,
        priceCentsAtPurchase: l.product.priceCents,
      })),
    ).run();
    tx.delete(cartItems).where(eq(cartItems.cartId, cartId)).run();
  });

  // Write Keto tuples — best-effort. Ory Network's hosted Keto requires
  // BOTH owner and view tuples (it doesn't enforce OPL computed permits).
  if (opts?.permissions) {
    const subject = `User:${userId}`;
    try {
      await opts.permissions.addTuple({ namespace: "Order", object: id, relation: "owner", subject });
      await opts.permissions.addTuple({ namespace: "Order", object: id, relation: "view", subject });
    } catch (err) {
      console.error(`Failed to write Keto tuples for order ${id}:`, err);
    }
  }

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

export async function listOrdersForUser(db: DB, userId: string) {
  return db.query.orders.findMany({
    where: eq(orders.userId, userId),
    orderBy: [desc(orders.createdAt)],
    with: { items: { with: { product: true } } },
  });
}
