import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { createOrderFromCart } from "@/lib/orders";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";

export async function POST() {
  const store = await cookies();
  const { session, permission } = getAuth();
  const current = await session.getCurrentSession({
    cookies: { get: (n: string) => store.get(n) },
  });
  if (!current) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  if (!cartId) {
    return NextResponse.json({ error: "No cart" }, { status: 400 });
  }

  try {
    const orderId = await createOrderFromCart(
      getDb(),
      cartId,
      current.user.id,
      "stub",
      { permissions: permission },
    );
    return NextResponse.json({ ok: true, orderId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
