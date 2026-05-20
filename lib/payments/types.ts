import type { JWK } from "jose";

export interface KyaPayClaims {
  iss: string;
  aud: string;
  jti: string;
  iat: number;
  exp: number;
  ssi?: string;
  /** Optional in real Skyfire KYA (identity-only). Mock embeds it for strict equality check. */
  amount?: number;
  cur?: "USD";
  hid: { email: string; user_id?: string };
  /** Provider-agnostic agent identifier. Mock: aid.id; Skyfire: sub (buyer-agent account id). */
  agentId: string;
  aid: { id?: string; name: string };
}

export type VerifyResult =
  | { ok: true; claims: KyaPayClaims }
  | { ok: false; code: string; message: string };

export interface ChargeResult {
  chargeId: string;
  settledAt: Date;
  amountCents: number;
}

export interface JwksResponse {
  keys: JWK[];
}
