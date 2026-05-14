import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { claimCartForUser } from "@/lib/cart-migration";
import { CART_COOKIE_NAME, CART_COOKIE_MAX_AGE, parseCartIdFromCookie } from "@/lib/cart-cookie";

export async function GET(req: Request) {
  const { session } = getAuth();
  const store = await cookies();
  const reqLike = { cookies: { get: (n: string) => store.get(n) } };
  const current = await session.getCurrentSession(reqLike);
  const url = new URL(req.url);
  const returnTo = url.searchParams.get("return_to") ?? "/";

  if (!current) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const anonCartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  const res = NextResponse.redirect(new URL(returnTo, url.origin));

  if (anonCartId) {
    const { cartId } = await claimCartForUser(getDb(), anonCartId, current.user.id);
    if (cartId) {
      res.cookies.set(CART_COOKIE_NAME, cartId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: CART_COOKIE_MAX_AGE,
      });
    } else {
      res.cookies.set(CART_COOKIE_NAME, "", { path: "/", expires: new Date(0) });
    }
  }
  return res;
}
