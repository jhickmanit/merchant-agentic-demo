import { nanoid } from "nanoid";
import { jwtVerify, type JWK, errors as joseErrors } from "jose";
import type { KyaPayProvider } from "@/lib/payments/kyapay";
import type { KyaPayClaims, VerifyResult, ChargeResult, JwksResponse } from "@/lib/payments/types";

export interface MockKyaPayOpts {
  publicKey: CryptoKey;
  publicJwk: JWK;
  issuer: string;
  audience: string;
  sellerServiceId: string;
}

export class MockKyaPayProvider implements KyaPayProvider {
  private chargedJti = new Set<string>();
  public readonly ledger: { chargeId: string; jti: string; amountCents: number; settledAt: Date }[] = [];

  constructor(private opts: MockKyaPayOpts) {}

  async verify(jwt: string): Promise<VerifyResult> {
    let claims: KyaPayClaims;
    try {
      const { payload } = await jwtVerify(jwt, this.opts.publicKey, {
        clockTolerance: 0,
      });
      claims = payload as unknown as KyaPayClaims;
      if (!claims.agentId && claims.aid?.id) {
        claims.agentId = claims.aid.id;
      }
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        return { ok: false, code: "expired", message: "Token expired" };
      }
      return { ok: false, code: "invalid_signature", message: (err as Error).message };
    }

    if (claims.iss !== this.opts.issuer) {
      return { ok: false, code: "wrong_issuer", message: `iss mismatch: ${claims.iss}` };
    }
    if (claims.aud !== this.opts.audience) {
      return { ok: false, code: "wrong_audience", message: `aud mismatch: ${claims.aud}` };
    }
    if (claims.ssi !== this.opts.sellerServiceId) {
      return { ok: false, code: "wrong_seller", message: `ssi mismatch: ${claims.ssi}` };
    }
    if (claims.cur !== "USD") {
      return { ok: false, code: "wrong_currency", message: "cur must be USD" };
    }
    if (typeof claims.amount !== "number" || claims.amount <= 0) {
      return { ok: false, code: "invalid_amount", message: "amount must be positive" };
    }
    if (!claims.hid?.email) {
      return { ok: false, code: "missing_hid_email", message: "hid.email required" };
    }
    if (!claims.aid?.id) {
      return { ok: false, code: "missing_aid_id", message: "aid.id required" };
    }
    return { ok: true, claims };
  }

  async charge(jwt: string, amountCents: number): Promise<ChargeResult> {
    const r = await this.verify(jwt);
    if (!r.ok) {
      throw new Error(`charge: token verification failed (${r.code})`);
    }
    if (r.claims.amount !== amountCents) {
      throw new Error(`charge: amount mismatch (token=${r.claims.amount}, charge=${amountCents})`);
    }
    if (this.chargedJti.has(r.claims.jti)) {
      throw new Error(`charge: replay detected (jti=${r.claims.jti} already settled)`);
    }
    this.chargedJti.add(r.claims.jti);
    const result: ChargeResult = {
      chargeId: `mock-charge-${nanoid(12)}`,
      settledAt: new Date(),
      amountCents,
    };
    this.ledger.push({
      chargeId: result.chargeId,
      jti: r.claims.jti,
      amountCents,
      settledAt: result.settledAt,
    });
    return result;
  }

  async jwks(): Promise<JwksResponse> {
    return { keys: [this.opts.publicJwk] };
  }
}
