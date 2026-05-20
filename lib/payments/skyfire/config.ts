export interface SkyfireConfig {
  jwksUrl: string;
  issuer: string;
  apiBase: string;
  /** If set, enforce aud equality during verify. */
  expectedAudience: string | undefined;
}

const DEFAULT_JWKS = "https://app.skyfire.xyz/.well-known/jwks.json";
const DEFAULT_ISSUER = "https://app.skyfire.xyz";
const DEFAULT_API_BASE = "https://api.skyfire.xyz/api/v1";

export function loadSkyfireConfig(env: NodeJS.ProcessEnv = process.env): SkyfireConfig {
  return {
    jwksUrl: env.SKYFIRE_JWKS_URL ?? DEFAULT_JWKS,
    issuer: env.SKYFIRE_ISSUER ?? DEFAULT_ISSUER,
    apiBase: env.SKYFIRE_API_BASE ?? DEFAULT_API_BASE,
    expectedAudience: env.SKYFIRE_EXPECTED_AUDIENCE,
  };
}
