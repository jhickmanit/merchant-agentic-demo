/**
 * Extract a KYA token from an incoming agent request, regardless of which
 * convention the agent framework uses. Centralized here so every route that
 * accepts agents (today: `/api/checkout`; tomorrow: any read-path Bose may hit)
 * agrees on precedence and naming.
 *
 * Supported (in priority order):
 *   1. `skyfire-pay-id`         — current Skyfire convention, used in their docs.
 *   2. `x-kya-token`            — older Bose / pre-Skyfire-rename header.
 *   3. `Authorization: KYAPay <jwt>` — RFC 9110-style scheme some agents emit.
 *   4. `Authorization: Bearer <jwt>` — generic fallback. Only honored when the
 *      bearer value looks like a Skyfire-issued JWT (3 base64url segments).
 *      This prevents collision with the Hydra delegated-token bearer used in
 *      Phase 7 — those tokens are opaque `ory_at_...` strings, never JWTs.
 */

interface HeaderSource {
  get(name: string): string | null;
}

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function extractKyaToken(headers: HeaderSource): string | null {
  const skyfirePayId = headers.get("skyfire-pay-id");
  if (skyfirePayId) return skyfirePayId.trim();

  const xKya = headers.get("x-kya-token");
  if (xKya) return xKya.trim();

  const auth = headers.get("authorization");
  if (auth) {
    const lower = auth.toLowerCase();
    if (lower.startsWith("kyapay ")) return auth.slice(7).trim();
    if (lower.startsWith("bearer ")) {
      const value = auth.slice(7).trim();
      if (JWT_SHAPE.test(value)) return value;
    }
  }

  return null;
}
