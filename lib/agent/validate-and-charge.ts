export interface CartSnapshot {
  items: { productId: string; quantity: number; priceCents: number }[];
  totalCents: number;
}

export interface ValidateAndChargeArgs {
  kyaJwt: string;
  cart: CartSnapshot;
  ctx: { agentId: string; ownerUserId: string };
}

export interface ValidateAndChargeResult {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const WWW_AUTHENTICATE =
  `KYAPay realm="merchant-agentic-demo", error="kya_validation_not_implemented"`;

export async function validateAndCharge(
  args: ValidateAndChargeArgs,
): Promise<ValidateAndChargeResult> {
  return {
    status: 402,
    headers: {
      "WWW-Authenticate": WWW_AUTHENTICATE,
      "Content-Type": "application/json",
    },
    body: {
      error: "kya_validation_not_implemented",
      message: "Phase 5 surfaces the agent paths; KYA validation arrives in Phase 6.",
      phase: 5,
      implementsIn: "Phase 6",
      cart: { itemCount: args.cart.items.length, totalCents: args.cart.totalCents },
      agentId: args.ctx.agentId,
    },
  };
}
