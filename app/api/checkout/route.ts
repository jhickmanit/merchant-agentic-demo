import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { createOrderFromCart } from "@/lib/orders";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";

export async function POST() {
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  if (!cartId) return NextResponse.json({ error: "No cart" }, { status: 400 });
  try {
    // TODO(P3.3): replace "phase-2-stub-user" with real session user id
    const orderId = await createOrderFromCart(getDb(), cartId, "phase-2-stub-user", "stub");
    return NextResponse.json({ ok: true, orderId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
