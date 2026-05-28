import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orders } from "@/db/schema";
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
import {
  withRecording,
  getRecordedEvents,
  recordPolicyEvent,
} from "@/lib/permissions-debug";

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

  // Agent path (Bose-style: KYA in header). Recording scope wraps the whole
  // branch so every recordPolicyEvent() call inside auto-provision /
  // skyfire-bridge / validate-and-charge lands in the same array, and we
  // can persist it on the order at the end.
  if (kyaToken) {
    return withRecording(() => handleAgentCheckout(kyaToken, body));
  }

  return handleHumanCheckout(body);
}

async function handleAgentCheckout(kyaToken: string, body: CheckoutBody) {
  const hs = await headers();
  const agentResult = await verifyAgentBearer(getDb(), hs.get("authorization"));
  const store = await cookies();
  // Agents may supply the cart id via the `X-Cart-Id` header
  // or via the standard `cart_id` cookie.
  // Header wins so curl-driven demos work without the cookie.
  const headerCartId = parseCartIdFromCookie(hs.get("x-cart-id") ?? undefined);
  const cookieCartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  const cartId = headerCartId ?? cookieCartId;
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
    // Pre-verify the KYA outside validate-and-charge so we (a) can short-circuit
    // with a clean 400 before any bridge/auto-provision side effects, and
    // (b) record a kya_verify event for the DebugPolicyPanel.
    const verifyStart = Date.now();
    const pre = await kyaPay.verify(kyaToken);
    if (!pre.ok) {
      recordPolicyEvent({
        kind: "kya_verify",
        data: { ok: false, errorCode: pre.code, durationMs: Date.now() - verifyStart },
      });
      return NextResponse.json(
        { error: "kya_invalid", code: pre.code, message: pre.message },
        { status: 400, headers: { "WWW-Authenticate": `KYAPay realm="merchant-agentic-demo"` } },
      );
    }
    recordPolicyEvent({
      kind: "kya_verify",
      data: {
        ok: true,
        agentId: pre.claims.agentId,
        userEmail: pre.claims.hid.email,
        jti: pre.claims.jti,
        issuer: pre.claims.iss,
        durationMs: Date.now() - verifyStart,
      },
    });

    // Phase 10 (flow 7) — if the skyfire-bridge Hydra client is configured,
    // bootstrap a real delegated token so downstream validation runs the
    // same path as the Phase 7 Hydra-bearer flow. Falls back gracefully to
    // Phase 9 plain auto-provision if the bridge isn't set up.
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
  // on the agent path so existing KYA-only / pure-API integrations still
  // work — when absent, the order is recorded with KYA provenance only.
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

  // If validate-and-charge wrote an order, attach the recorded policy events
  // so the order detail page can render the full provenance story without
  // re-running KYA verify / Hydra introspect at view time.
  const orderId = typeof result.body.orderId === "string" ? result.body.orderId : null;
  if (orderId) {
    const events = getRecordedEvents();
    if (events.length > 0) {
      getDb()
        .update(orders)
        .set({ policyEventsJson: JSON.stringify(events) })
        .where(eq(orders.id, orderId))
        .run();
    }
  }

  return NextResponse.json(result.body, { status: result.status, headers: result.headers });
}

async function handleHumanCheckout(body: CheckoutBody) {
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
