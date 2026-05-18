import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { getPayments } from "@/lib/payments";
import { createOrderFromCart } from "@/lib/orders";
import { getCartWithItems } from "@/lib/cart";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";
import { verifyAgentBearer } from "@/lib/auth/agent-gate";
import { validateAndCharge } from "@/lib/agent/validate-and-charge";
import { cartTotalFromLines } from "@/lib/cart-math";

async function extractKyaToken(): Promise<string | null> {
  const hs = await headers();
  const xKya = hs.get("x-kya-token");
  if (xKya) return xKya;
  const auth = hs.get("authorization");
  if (auth?.toLowerCase().startsWith("kyapay ")) return auth.slice(7).trim();
  return null;
}

export async function POST() {
  const kyaToken = await extractKyaToken();

  // ===== Agent path (Bose-style: X-KYA-Token header) =====
  if (kyaToken) {
    const hs = await headers();
    const agentResult = await verifyAgentBearer(getDb(), hs.get("authorization"));
    // Phase 5: even without a Hydra bearer, we still surface 402. The KYA token itself
    // will be validated in Phase 6. Use 'unknown' agent identity for Phase 5.
    const store = await cookies();
    const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
    const cart = cartId ? await getCartWithItems(getDb(), cartId) : null;
    const items =
      cart?.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        priceCents: i.product.priceCents,
      })) ?? [];
    const totalCents = cartTotalFromLines(cart?.items ?? []);
    const { kyaPay } = getPayments();
    const { identity, permission } = getAuth();
    // Agent ctx — fall back to "unknown" only if the agent gate didn't authenticate
    const ctx = agentResult.ok
      ? {
          agentId: agentResult.agentId,
          ownerUserId: agentResult.ownerUserId,
          cartId: cartId ?? "",
          delegationClaims: agentResult.delegationClaims,
        }
      : { agentId: "unknown", ownerUserId: "unknown", cartId: cartId ?? "" };
    const result = await validateAndCharge({
      kyaJwt: kyaToken,
      cart: { items, totalCents },
      ctx,
      deps: { db: getDb(), kyaPay, identity, permission },
    });
    return NextResponse.json(result.body, { status: result.status, headers: result.headers });
  }

  // ===== Human user path (existing, from Phase 3) =====
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
