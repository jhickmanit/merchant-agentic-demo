import type { DB } from "@/db";
import type { IdentityProvider } from "@/lib/auth/identity";
import type { PermissionProvider } from "@/lib/auth/permissions";
import type { KyaPayClaims } from "@/lib/payments/types";
import {
  introspectAgentToken,
  type DelegationClaims,
} from "@/lib/auth/delegated-token";
import { bootstrapDelegatedToken } from "@/lib/oauth/bootstrap";
import { ensureAgentAndOwner, type AutoProvisionDeps } from "@/lib/agent/auto-provision";

/**
 * Phase 10 — the "flow 7" entry point.
 *
 * Drives a Bose-style Skyfire-attested agent from raw KYA → Hydra delegated
 * access token in one server-side call, regardless of whether the merchant
 * has seen this user / agent before. Combines Phase 9's auto-provision with
 * Phase 7's bootstrap orchestrator and caches by KYA `jti` so a stream of
 * KYA-only requests from the same session doesn't re-bootstrap every time.
 *
 * Why a single shared "skyfire-bridge" Hydra client: see
 * `docs/plans/phases/phase-10-combined-skyfire-delegation.md` — KYA is
 * already the per-agent credential, so the bridge client just gives Hydra
 * something to anchor its session against. The per-agent identity lives in
 * `act.sub` on the resulting token.
 */

export interface SkyfireBridgeResult {
  ownerUserId: string;
  agentId: string;
  /** The Hydra-issued access token to use as `Authorization: Bearer …`. */
  accessToken: string;
  /** Pre-introspected delegation claims, ready to drop into validateAndCharge's ctx. */
  delegationClaims: DelegationClaims;
  /** True iff the bootstrap actually ran (false = cache hit). */
  bootstrapped: boolean;
}

export interface SkyfireBridgeDeps extends AutoProvisionDeps {
  /** Injectable for tests — defaults to the real bootstrap orchestrator. */
  bootstrap?: typeof bootstrapDelegatedToken;
  /** Injectable for tests — defaults to the real Hydra introspection. */
  introspect?: (token: string) => Promise<Record<string, unknown>>;
  /** Override the bridge client id (defaults to env). */
  bridgeClientId?: string;
  /** Override the bridge client secret (defaults to env). */
  bridgeClientSecret?: string;
}

interface CacheEntry {
  result: SkyfireBridgeResult;
  expiresAt: number;
}

// Module-level cache keyed by KYA jti. Demo-grade: small Map, no eviction
// beyond TTL. In production this would live in Redis or similar.
const TOKEN_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

export function _clearBridgeCacheForTests() {
  TOKEN_CACHE.clear();
}

export async function bootstrapSkyfireAgent(
  kyaJwt: string,
  claims: KyaPayClaims,
  deps: SkyfireBridgeDeps,
): Promise<SkyfireBridgeResult> {
  const cached = TOKEN_CACHE.get(claims.jti);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.result, bootstrapped: false };
  }

  // 1. Make sure the local user + agent rows exist before Hydra rings our
  //    /oauth/login endpoint back — login validates against `agents.id`.
  const { ownerUserId, agentId } = await ensureAgentAndOwner(claims, deps);

  // 2. Bootstrap a delegated access token via the skyfire-bridge Hydra client.
  const clientId = deps.bridgeClientId ?? process.env.SKYFIRE_BRIDGE_CLIENT_ID;
  const clientSecret =
    deps.bridgeClientSecret ?? process.env.SKYFIRE_BRIDGE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "SKYFIRE_BRIDGE_CLIENT_ID / SKYFIRE_BRIDGE_CLIENT_SECRET not configured. " +
        "Run ./scripts/ory-setup/hydra-config.sh to provision the bridge client.",
    );
  }

  const bootstrap = deps.bootstrap ?? bootstrapDelegatedToken;
  const tokenResult = await bootstrap({
    kyaJwt,
    clientId,
    clientSecret,
  });

  // 3. Decode the token's claims so the caller can drop them straight into
  //    validateAndCharge's ctx — same shape as the Phase 7 Hydra-bearer path.
  const introspectResult = await introspectAgentToken(tokenResult.access_token, {
    introspect: deps.introspect,
  });
  if (!introspectResult.ok) {
    throw new Error(
      `skyfire-bridge: bootstrap token failed introspection (${introspectResult.code}): ${introspectResult.message}`,
    );
  }
  if (!introspectResult.delegated) {
    throw new Error(
      "skyfire-bridge: bootstrap token introspected as non-delegated (missing act claim). " +
        "Verify /oauth/consent stamps act.sub correctly.",
    );
  }

  const result: SkyfireBridgeResult = {
    ownerUserId,
    agentId,
    accessToken: tokenResult.access_token,
    delegationClaims: introspectResult.claims,
    bootstrapped: true,
  };

  TOKEN_CACHE.set(claims.jti, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return result;
}
