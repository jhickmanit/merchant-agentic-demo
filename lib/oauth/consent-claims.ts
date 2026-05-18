export interface DelegationContext {
  agent_id: string;
  agent_type: string;
  kya_jti: string;
  kya_amount: number;
  spend_cap_cents: number | null;
}

export interface DelegatedSessionClaims {
  act: { sub: string; agent_type: string; kya_jti: string };
  authorization_details: Array<{
    type: "agent_purchase";
    merchant: string;
    max_amount: number;
    currency: "USD";
    expires_at: string;
  }>;
}

export function buildConsentClaims(
  ctx: DelegationContext,
  ttlSeconds = 300,
): DelegatedSessionClaims {
  return {
    act: {
      sub: ctx.agent_id,
      agent_type: ctx.agent_type,
      kya_jti: ctx.kya_jti,
    },
    authorization_details: [
      {
        type: "agent_purchase",
        merchant: "merchant-agentic-demo",
        max_amount:
          ctx.spend_cap_cents !== null
            ? Math.min(ctx.kya_amount, ctx.spend_cap_cents)
            : ctx.kya_amount,
        currency: "USD",
        expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      },
    ],
  };
}
