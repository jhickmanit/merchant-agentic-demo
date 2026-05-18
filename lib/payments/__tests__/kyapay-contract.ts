import { describe, it, expect, beforeEach } from "vitest";
import { mintKyaToken } from "@/lib/payments/mint";
import type { KyaPayProvider } from "@/lib/payments/kyapay";

interface Setup {
  provider: KyaPayProvider;
  privateKey: CryptoKey;
  issuer: string;
}

export function runKyaPayContract(name: string, makeSetup: () => Promise<Setup>) {
  describe(`${name} — KyaPayProvider contract`, () => {
    let s: Setup;
    beforeEach(async () => { s = await makeSetup(); });

    it("verify: returns ok for a valid token", async () => {
      const t = await mintKyaToken({
        agentId: "a", agentName: "X", userEmail: "u@e", amountCents: 5000,
        issuer: s.issuer, privateKey: s.privateKey,
      });
      const r = await s.provider.verify(t);
      expect(r.ok).toBe(true);
    });

    it("verify: rejects expired token", async () => {
      const t = await mintKyaToken({
        agentId: "a", agentName: "X", userEmail: "u@e", amountCents: 100,
        ttlSeconds: -100, issuer: s.issuer, privateKey: s.privateKey,
      });
      const r = await s.provider.verify(t);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("expired");
    });

    it("verify: rejects bad signature", async () => {
      const t = await mintKyaToken({
        agentId: "a", agentName: "X", userEmail: "u@e", amountCents: 100,
        issuer: s.issuer, privateKey: s.privateKey,
      });
      const r = await s.provider.verify(t.slice(0, -10) + "AAAAAAAAAA");
      expect(r.ok).toBe(false);
    });

    it("verify: rejects wrong audience", async () => {
      const t = await mintKyaToken({
        agentId: "a", agentName: "X", userEmail: "u@e", amountCents: 100,
        audience: "other-merchant", issuer: s.issuer, privateKey: s.privateKey,
      });
      const r = await s.provider.verify(t);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("wrong_audience");
    });

    it("charge: succeeds when amount matches", async () => {
      const t = await mintKyaToken({
        agentId: "a", agentName: "X", userEmail: "u@e", amountCents: 5000,
        issuer: s.issuer, privateKey: s.privateKey,
      });
      const r = await s.provider.charge(t, 5000);
      expect(r.chargeId).toBeTruthy();
      expect(r.amountCents).toBe(5000);
    });

    it("charge: rejects amount mismatch", async () => {
      const t = await mintKyaToken({
        agentId: "a", agentName: "X", userEmail: "u@e", amountCents: 5000,
        issuer: s.issuer, privateKey: s.privateKey,
      });
      await expect(s.provider.charge(t, 7500)).rejects.toThrow(/amount/i);
    });

    it("charge: rejects replay", async () => {
      const t = await mintKyaToken({
        agentId: "a", agentName: "X", userEmail: "u@e", amountCents: 1000,
        issuer: s.issuer, privateKey: s.privateKey,
      });
      await s.provider.charge(t, 1000);
      await expect(s.provider.charge(t, 1000)).rejects.toThrow(/replay/i);
    });

    it("jwks: returns a non-empty key set", async () => {
      const r = await s.provider.jwks();
      expect(r.keys.length).toBeGreaterThan(0);
    });
  });
}
