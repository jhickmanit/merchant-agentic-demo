import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignJWT } from "jose";
import { SkyfireKyaPayProvider } from "../kyapay";
import { mintTestKeypair } from "../../__tests__/helpers";

const ISSUER = "https://test.skyfire.example";
const JWKS_URL = "https://test.skyfire.example/.well-known/jwks.json";

async function setupProvider() {
  const { publicJwk, privateKey } = await mintTestKeypair();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url) === JWKS_URL) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  const provider = new SkyfireKyaPayProvider({ jwksUrl: JWKS_URL, issuer: ISSUER });
  return { provider, privateKey, fetchSpy };
}

async function signKya(
  privateKey: CryptoKey,
  overrides: Record<string, unknown> = {},
  opts: { issuer?: string; expIn?: number } = {},
): Promise<string> {
  return new SignJWT({
    sub: "buyer-agent-uuid-123",
    aud: "seller-agent-uuid-456",
    jti: "jti-test-1",
    hid: { email: "user@example.com" },
    aid: { name: "Demo Agent" },
    ssi: "seller-svc-1",
    ...overrides,
  })
    .setProtectedHeader({ alg: "ES256", kid: "test-key-1" })
    .setIssuedAt()
    .setExpirationTime(`${opts.expIn ?? 300}s`)
    .setIssuer(opts.issuer ?? ISSUER)
    .sign(privateKey);
}

describe("SkyfireKyaPayProvider", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("verifies a well-formed KYA token and maps claims", async () => {
    const { provider, privateKey } = await setupProvider();
    const jwt = await signKya(privateKey);
    const r = await provider.verify(jwt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.claims.agentId).toBe("buyer-agent-uuid-123");
    expect(r.claims.hid.email).toBe("user@example.com");
    expect(r.claims.aid.name).toBe("Demo Agent");
    expect(r.claims.amount).toBeUndefined();
    expect(r.claims.iss).toBe(ISSUER);
  });

  it("rejects wrong issuer", async () => {
    const { provider, privateKey } = await setupProvider();
    const jwt = await signKya(privateKey, {}, { issuer: "https://attacker.example" });
    const r = await provider.verify(jwt);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("wrong_issuer");
  });

  it("rejects token missing hid.email", async () => {
    const { provider, privateKey } = await setupProvider();
    const jwt = await signKya(privateKey, { hid: {} });
    const r = await provider.verify(jwt);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("missing_hid_email");
  });

  it("charge returns a synthetic sf- chargeId", async () => {
    const { provider, privateKey } = await setupProvider();
    const jwt = await signKya(privateKey);
    const result = await provider.charge(jwt, 4200);
    expect(result.chargeId).toMatch(/^sf-/);
    expect(result.amountCents).toBe(4200);
  });
});
