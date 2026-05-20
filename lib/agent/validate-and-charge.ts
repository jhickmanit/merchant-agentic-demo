import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { agents } from "@/db/schema";
import type { KyaPayProvider } from "@/lib/payments/kyapay";
import type { IdentityProvider } from "@/lib/auth/identity";
import type { PermissionProvider } from "@/lib/auth/permissions";
import { createOrderFromCart } from "@/lib/orders";
import type { DelegationClaims } from "@/lib/auth/delegated-token";

export interface CartSnapshot {
  items: { productId: string; quantity: number; priceCents: number }[];
  totalCents: number;
}

export interface ValidateAndChargeArgs {
  kyaJwt: string;
  cart: CartSnapshot;
  ctx: {
    agentId: string;
    ownerUserId: string;
    cartId: string;
    delegationClaims?: DelegationClaims;
  };
  deps: {
    db: DB;
    kyaPay: KyaPayProvider;
    identity: IdentityProvider;
    permission: PermissionProvider;
  };
}

export interface ValidateAndChargeResult {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const WWW_AUTHENTICATE = `KYAPay realm="merchant-agentic-demo"`;

function fail(
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
): ValidateAndChargeResult {
  return {
    status,
    headers: {
      "WWW-Authenticate": WWW_AUTHENTICATE,
      "Content-Type": "application/json",
    },
    body: { error, message, ...extra },
  };
}

export async function validateAndCharge(
  args: ValidateAndChargeArgs,
): Promise<ValidateAndChargeResult> {
  const { kyaJwt, cart, ctx, deps } = args;

  // 1. Verify KYA JWT
  const v = await deps.kyaPay.verify(kyaJwt);
  if (!v.ok) return fail(400, "kya_invalid", v.message, { code: v.code });
  const claims = v.claims;

  // 2. Provider-agnostic agent id must match agent context
  if (claims.agentId !== ctx.agentId) {
    return fail(403, "aid_mismatch",
      `Token agentId (${claims.agentId}) does not match agent context (${ctx.agentId})`);
  }

  // 3. hid.email must match owner
  const owner = await deps.identity.getById(ctx.ownerUserId);
  if (!owner) return fail(403, "owner_not_found", `Owner ${ctx.ownerUserId} not found`);
  if (claims.hid.email.toLowerCase() !== owner.email.toLowerCase()) {
    return fail(403, "hid_mismatch",
      `Token hid.email (${claims.hid.email}) does not match owner (${owner.email})`);
  }

  // 4. Delegation cross-checks (Phase 7)
  if (ctx.delegationClaims) {
    const dc = ctx.delegationClaims;
    if (dc.act.sub !== ctx.agentId) {
      return fail(403, "delegation_act_mismatch",
        `Delegated token act.sub (${dc.act.sub}) does not match agent context (${ctx.agentId})`);
    }
    if (dc.sub !== ctx.ownerUserId) {
      return fail(403, "delegation_sub_mismatch",
        `Delegated token sub (${dc.sub}) does not match owner context (${ctx.ownerUserId})`);
    }
    const detail = dc.authorization_details.find((d) => d.type === "agent_purchase");
    const effectiveAmount = claims.amount ?? cart.totalCents;
    if (detail && typeof detail.max_amount === "number" && effectiveAmount > detail.max_amount) {
      return fail(403, "delegation_max_amount_exceeded",
        `Amount (${effectiveAmount}) exceeds delegation max_amount (${detail.max_amount})`,
        { delegationMaxAmount: detail.max_amount });
    }
  }

  // 5. Token amount (if present) must equal cart total. Skyfire KYA tokens carry no amount
  //    — cart total is authoritative.
  if (claims.amount !== undefined && claims.amount !== cart.totalCents) {
    return fail(400, "amount_mismatch",
      `Token amount (${claims.amount}) does not match cart total (${cart.totalCents})`);
  }
  const chargeAmount = claims.amount ?? cart.totalCents;

  // 6. Spend cap
  const agentRow = await deps.db.query.agents.findFirst({ where: eq(agents.id, ctx.agentId) });
  if (!agentRow) return fail(403, "agent_not_found", `Agent ${ctx.agentId} not in local DB`);
  if (agentRow.revokedAt) return fail(403, "agent_revoked", "Agent has been revoked");
  if (agentRow.spendCapCents !== null && chargeAmount > agentRow.spendCapCents) {
    return fail(403, "spend_cap_exceeded",
      `Amount ${chargeAmount} exceeds spend cap ${agentRow.spendCapCents}`,
      { spendCapCents: agentRow.spendCapCents });
  }

  // 6. Charge
  let chargeResult;
  try {
    chargeResult = await deps.kyaPay.charge(kyaJwt, chargeAmount);
  } catch (err) {
    return fail(402, "charge_failed", (err as Error).message);
  }

  // 7. Write order
  const orderId = await createOrderFromCart(
    deps.db,
    ctx.cartId,
    owner.id,
    "kyapay",
    {
      permissions: deps.permission,
      paymentTokenJti: claims.jti,
      skyfireChargeId: chargeResult.chargeId,
      kyaClaimsJson: JSON.stringify(claims),
    },
  );

  // 8. Decrement spend cap
  if (agentRow.spendCapCents !== null) {
    deps.db
      .update(agents)
      .set({ spendCapCents: agentRow.spendCapCents - chargeAmount })
      .where(eq(agents.id, ctx.agentId))
      .run();
  }

  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: {
      ok: true,
      orderId,
      chargeId: chargeResult.chargeId,
      settledAt: chargeResult.settledAt.toISOString(),
      remainingSpendCapCents:
        agentRow.spendCapCents === null ? null : agentRow.spendCapCents - chargeAmount,
    },
  };
}
