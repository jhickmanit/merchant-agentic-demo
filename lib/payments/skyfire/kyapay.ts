import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";
import type { KyaPayProvider } from "@/lib/payments/kyapay";
import type {
  KyaPayClaims,
  VerifyResult,
  ChargeResult,
  JwksResponse,
} from "@/lib/payments/types";
import { loadSkyfireConfig, type SkyfireConfig } from "./config";

interface SkyfireKyaPayload {
  iss?: string;
  aud?: string | string[];
  jti?: string;
  iat?: number;
  exp?: number;
  sub?: string;
  ssi?: string;
  hid?: { email?: string };
  aid?: { name?: string };
}

export class SkyfireKyaPayProvider implements KyaPayProvider {
  private config: SkyfireConfig;
  private jwksSet: ReturnType<typeof createRemoteJWKSet>;

  constructor(config?: Partial<SkyfireConfig>) {
    this.config = { ...loadSkyfireConfig(), ...config };
    this.jwksSet = createRemoteJWKSet(new URL(this.config.jwksUrl));
  }

  async verify(jwt: string): Promise<VerifyResult> {
    let payload: SkyfireKyaPayload;
    try {
      const verifyOpts: { issuer: string; audience?: string } = {
        issuer: this.config.issuer,
      };
      if (this.config.expectedAudience) {
        verifyOpts.audience = this.config.expectedAudience;
      }
      const result = await jwtVerify(jwt, this.jwksSet, verifyOpts);
      payload = result.payload as SkyfireKyaPayload;
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        return { ok: false, code: "expired", message: "Token expired" };
      }
      if (err instanceof joseErrors.JWTClaimValidationFailed) {
        return {
          ok: false,
          code: err.claim === "iss" ? "wrong_issuer" : err.claim === "aud" ? "wrong_audience" : "claim_invalid",
          message: err.message,
        };
      }
      return { ok: false, code: "invalid_signature", message: (err as Error).message };
    }

    if (!payload.sub) {
      return { ok: false, code: "missing_sub", message: "sub (buyer agent id) required" };
    }
    if (!payload.hid?.email) {
      return { ok: false, code: "missing_hid_email", message: "hid.email required" };
    }
    if (!payload.jti || !payload.iat || !payload.exp) {
      return { ok: false, code: "missing_standard_claims", message: "jti/iat/exp required" };
    }

    const aud = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    const claims: KyaPayClaims = {
      iss: payload.iss ?? this.config.issuer,
      aud: aud ?? "",
      jti: payload.jti,
      iat: payload.iat,
      exp: payload.exp,
      ssi: payload.ssi,
      agentId: payload.sub,
      hid: { email: payload.hid.email },
      aid: { name: payload.aid?.name ?? "unknown" },
    };
    return { ok: true, claims };
  }

  // NOTE: Real Skyfire settlement would use the `pay` / `kya-pay` token flow.
  // Phase 8 verifies identity only; "charge" returns a synthetic chargeId so
  // existing order-write code works unchanged.
  async charge(jwt: string, amountCents: number): Promise<ChargeResult> {
    const r = await this.verify(jwt);
    if (!r.ok) {
      throw new Error(`charge: token verification failed (${r.code})`);
    }
    return {
      chargeId: `sf-${randomUUID()}`,
      settledAt: new Date(),
      amountCents,
    };
  }

  async jwks(): Promise<JwksResponse> {
    const res = await fetch(this.config.jwksUrl);
    if (!res.ok) throw new Error(`Failed to fetch Skyfire JWKS: ${res.status}`);
    return (await res.json()) as JwksResponse;
  }
}
