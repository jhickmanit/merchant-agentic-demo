import { describe, it, expect } from "vitest";
import { extractKyaToken } from "@/lib/agent/kya-header";

function headers(map: Record<string, string>) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower[name.toLowerCase()] ?? null };
}

// Realistic-looking 3-segment base64url string. Value doesn't have to verify;
// kya-header only cares about *shape*.
const FAKE_JWT =
  "eyJhbGciOiJFUzI1NiJ9." +
  "eyJzdWIiOiJhZ2VudC0xMjMiLCJpc3MiOiJza3lmaXJlIn0." +
  "AAAA-BBB_CCCD";

describe("extractKyaToken", () => {
  it("returns null when no recognized header is present", () => {
    expect(extractKyaToken(headers({}))).toBeNull();
    expect(extractKyaToken(headers({ "content-type": "application/json" }))).toBeNull();
  });

  it("picks up skyfire-pay-id (current Skyfire convention)", () => {
    expect(extractKyaToken(headers({ "skyfire-pay-id": FAKE_JWT }))).toBe(FAKE_JWT);
  });

  it("picks up x-kya-token (older Bose-style header)", () => {
    expect(extractKyaToken(headers({ "x-kya-token": FAKE_JWT }))).toBe(FAKE_JWT);
  });

  it("picks up Authorization: KYAPay <jwt> (RFC 9110-style scheme)", () => {
    expect(
      extractKyaToken(headers({ authorization: `KYAPay ${FAKE_JWT}` })),
    ).toBe(FAKE_JWT);
  });

  it("picks up Authorization: Bearer <jwt> only when value looks like a JWT", () => {
    expect(
      extractKyaToken(headers({ authorization: `Bearer ${FAKE_JWT}` })),
    ).toBe(FAKE_JWT);
  });

  it("ignores Authorization: Bearer when value is an opaque Hydra token", () => {
    // Hydra delegated tokens are opaque `ory_at_...` strings — must not be
    // mistaken for a KYA token by the bearer fallback.
    expect(
      extractKyaToken(headers({ authorization: "Bearer ory_at_abc123" })),
    ).toBeNull();
  });

  it("precedence: skyfire-pay-id beats x-kya-token beats Authorization", () => {
    const other = "eyJh.bbb.ccc";
    expect(
      extractKyaToken(
        headers({
          "skyfire-pay-id": FAKE_JWT,
          "x-kya-token": other,
          authorization: `KYAPay ${other}`,
        }),
      ),
    ).toBe(FAKE_JWT);

    expect(
      extractKyaToken(
        headers({
          "x-kya-token": FAKE_JWT,
          authorization: `KYAPay ${other}`,
        }),
      ),
    ).toBe(FAKE_JWT);
  });

  it("is case-insensitive on the Authorization scheme", () => {
    expect(
      extractKyaToken(headers({ authorization: `kyapay ${FAKE_JWT}` })),
    ).toBe(FAKE_JWT);
    expect(
      extractKyaToken(headers({ authorization: `bearer ${FAKE_JWT}` })),
    ).toBe(FAKE_JWT);
  });

  it("trims surrounding whitespace", () => {
    expect(
      extractKyaToken(headers({ "skyfire-pay-id": `  ${FAKE_JWT}  ` })),
    ).toBe(FAKE_JWT);
  });
});
