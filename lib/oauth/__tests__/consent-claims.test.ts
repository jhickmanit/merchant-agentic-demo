import { describe, it, expect } from "vitest";
import { buildConsentClaims } from "@/lib/oauth/consent-claims";

describe("buildConsentClaims", () => {
  it("builds act + authorization_details from delegation context", () => {
    const out = buildConsentClaims({
      agent_id: "a1",
      agent_type: "shopping",
      kya_jti: "jti-abc",
      kya_amount: 5000,
      spend_cap_cents: 10000,
    });
    expect(out.act.sub).toBe("a1");
    expect(out.act.kya_jti).toBe("jti-abc");
    expect(out.act.agent_type).toBe("shopping");
    expect(out.authorization_details).toHaveLength(1);
    expect(out.authorization_details[0].type).toBe("agent_purchase");
    expect(out.authorization_details[0].max_amount).toBe(5000); // min(kya, cap)
  });

  it("clamps max_amount by spend cap when cap < kya amount", () => {
    const out = buildConsentClaims({
      agent_id: "a1",
      agent_type: "shopping",
      kya_jti: "jti-abc",
      kya_amount: 50000,
      spend_cap_cents: 1000,
    });
    expect(out.authorization_details[0].max_amount).toBe(1000);
  });

  it("uses kya amount when spend cap is null (unlimited)", () => {
    const out = buildConsentClaims({
      agent_id: "a1",
      agent_type: "shopping",
      kya_jti: "jti-abc",
      kya_amount: 9999,
      spend_cap_cents: null,
    });
    expect(out.authorization_details[0].max_amount).toBe(9999);
  });

  it("sets expires_at to ~ttl seconds from now", () => {
    const before = Date.now();
    const out = buildConsentClaims({
      agent_id: "a1",
      agent_type: "shopping",
      kya_jti: "jti",
      kya_amount: 100,
      spend_cap_cents: 1000,
    }, 600);
    const expiresMs = new Date(out.authorization_details[0].expires_at).getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 600 * 1000 - 100);
    expect(expiresMs).toBeLessThanOrEqual(before + 600 * 1000 + 1000);
  });
});
