import type { VerifyResult, ChargeResult, JwksResponse } from "./types";

export interface KyaPayProvider {
  /** Verify a KYA JWT against the provider's signing key and validate claim shape. */
  verify(jwt: string): Promise<VerifyResult>;
  /**
   * Settle a charge. amountCents MUST match the token's amount claim.
   * Implementations may reject if the token has already been used (jti replay).
   */
  charge(jwt: string, amountCents: number): Promise<ChargeResult>;
  /** Public JWKS for verifiers. */
  jwks(): Promise<JwksResponse>;
}
