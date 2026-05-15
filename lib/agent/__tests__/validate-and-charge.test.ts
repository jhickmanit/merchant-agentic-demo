import { describe, it, expect } from "vitest";
import { validateAndCharge } from "@/lib/agent/validate-and-charge";

describe("validateAndCharge (Phase 5 stub)", () => {
  it("returns 402 with WWW-Authenticate KYAPay header", async () => {
    const result = await validateAndCharge({
      kyaJwt: "any.token.value",
      cart: { items: [], totalCents: 0 },
      ctx: { agentId: "agent-1", ownerUserId: "owner-1" },
    });
    expect(result.status).toBe(402);
    expect(result.headers["WWW-Authenticate"]).toMatch(/KYAPay/);
    expect(result.body.error).toBe("kya_validation_not_implemented");
  });

  it("includes phase + implementsIn metadata", async () => {
    const result = await validateAndCharge({
      kyaJwt: "x",
      cart: { items: [{ productId: "p1", quantity: 1, priceCents: 100 }], totalCents: 100 },
      ctx: { agentId: "a", ownerUserId: "o" },
    });
    expect(result.body.phase).toBe(5);
    expect(result.body.implementsIn).toBe("Phase 6");
  });
});
