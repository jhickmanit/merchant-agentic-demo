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
import { authorizeCard, type CardInput } from "@/lib/payments/mock-card";

interface CheckoutBody {
  card?: CardInput;
}

async function parseBody(req: Request): Promise<CheckoutBody> {
  if (!req.body) return {};
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text) as CheckoutBody;
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  const body = await parseBody(req);
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
    // Card details, if present, are validated here (Bose-style headless agent
    // fills the same /checkout form a human would). Card details are OPTIONAL
    // on the agent path so existing KYA-only / pure-API integrations stay
    // working — when absent, the order is recorded with KYA provenance only.
    let cardAuth: { brand: string; last4: string; authId: string } | undefined;
    if (body.card) {
      const auth = authorizeCard(body.card);
      if (!auth.ok) {
        return NextResponse.json(
          { error: "card_declined", code: auth.code, field: auth.field, message: auth.message },
          { status: 400 },
        );
      }
      cardAuth = { brand: auth.brand, last4: auth.last4, authId: auth.authId };
    }

    const result = await validateAndCharge({
      kyaJwt: kyaToken,
      cart: { items, totalCents },
      ctx,
      cardAuth,
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
  // Card details are required on the human path.
  if (!body.card) {
    return NextResponse.json(
      { error: "missing_card", message: "Card details are required to check out." },
      { status: 400 },
    );
  }
  const auth = authorizeCard(body.card);
  if (!auth.ok) {
    return NextResponse.json(
      { error: "card_declined", code: auth.code, field: auth.field, message: auth.message },
      { status: 400 },
    );
  }

  try {
    const orderId = await createOrderFromCart(
      getDb(),
      cartId,
      current.user.id,
      "mock_card",
      {
        permissions: permission,
        paymentBrand: auth.brand,
        paymentLast4: auth.last4,
        paymentAuthId: auth.authId,
      },
    );
    return NextResponse.json({ ok: true, orderId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
