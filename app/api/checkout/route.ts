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
import { ensureAgentAndOwner } from "@/lib/agent/auto-provision";
import { bootstrapSkyfireAgent } from "@/lib/agent/skyfire-bridge";
import type { DelegationClaims } from "@/lib/auth/delegated-token";
import { cartTotalFromLines } from "@/lib/cart-math";
import { extractKyaToken } from "@/lib/agent/kya-header";

export async function POST() {
  const kyaToken = extractKyaToken(await headers());

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

    // Agent ctx:
    //   1. Hydra delegated bearer (Phase 7 programmatic agent flow) — preferred when present.
    //   2. Otherwise auto-provision from the KYA claims (Phase 9 — Bose-style embedded
    //      browser where KYA-in-header is the only auth signal).
    let ctx: {
      agentId: string;
      ownerUserId: string;
      cartId: string;
      delegationClaims?: DelegationClaims;
    };
    if (agentResult.ok) {
      ctx = {
        agentId: agentResult.agentId,
        ownerUserId: agentResult.ownerUserId,
        cartId: cartId ?? "",
        delegationClaims: agentResult.delegationClaims,
      };
    } else {
      const pre = await kyaPay.verify(kyaToken);
      if (!pre.ok) {
        return NextResponse.json(
          { error: "kya_invalid", code: pre.code, message: pre.message },
          { status: 400, headers: { "WWW-Authenticate": `KYAPay realm="merchant-agentic-demo"` } },
        );
      }

      // Phase 10 (flow 7) — if the skyfire-bridge Hydra client is configured,
      // bootstrap a real delegated token so downstream validation runs the
      // same path as the Phase 7 Hydra-bearer flow. Falls back gracefully to
      // Phase 9 plain auto-provision if the bridge isn't set up — demo still
      // works, just without the Hydra story.
      const bridgeConfigured =
        process.env.SKYFIRE_BRIDGE_CLIENT_ID && process.env.SKYFIRE_BRIDGE_CLIENT_SECRET;

      if (bridgeConfigured) {
        try {
          const bridged = await bootstrapSkyfireAgent(kyaToken, pre.claims, {
            db: getDb(),
            identity,
            permission,
          });
          ctx = {
            agentId: bridged.agentId,
            ownerUserId: bridged.ownerUserId,
            cartId: cartId ?? "",
            delegationClaims: bridged.delegationClaims,
          };
        } catch (err) {
          console.error(
            "[checkout] skyfire-bridge bootstrap failed, falling back to plain auto-provision:",
            (err as Error).message,
          );
          const provisioned = await ensureAgentAndOwner(pre.claims, {
            db: getDb(),
            identity,
            permission,
          });
          ctx = {
            agentId: provisioned.agentId,
            ownerUserId: provisioned.ownerUserId,
            cartId: cartId ?? "",
          };
        }
      } else {
        const provisioned = await ensureAgentAndOwner(pre.claims, {
          db: getDb(),
          identity,
          permission,
        });
        ctx = {
          agentId: provisioned.agentId,
          ownerUserId: provisioned.ownerUserId,
          cartId: cartId ?? "",
        };
      }
    }
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
    cookies: {
      get: (n: string) => store.get(n),
      getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    },
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
