# Architectural Decision Records (ADRs)

ADRs are short. Lead with the decision. Capture context and consequences in 1–3 sentences. Update or supersede when reality diverges.

---

## ADR-001: `@ory/mcp-access-control` — inline
**Status:** Accepted
**Date:** 2026-05-14

### Decision
Do not depend on `@ory/mcp-access-control`. Write the equivalent ~50 LOC inline in `lib/auth/mcp-gate.ts` in Phase 5.

### Context
The package does not exist on npm (HTTP 404 for `@ory/mcp-access-control`; no match under `@ory/mcp` or any search variant). The Skyfire reference demo (`skyfire-xyz/skyfire-solutions-demo` at commit `ede643c`) ships a vendored copy under `mcp-servers/dappier-seller-server/lib/@ory/mcp-access-control/` (v0.1.0, Apache-2.0, never published). Inspecting its `src/index.ts` reveals the exported `McpAccessControl` class targets Ory **Kratos** identity management (`FrontendApi.toSession()`, `IdentityApi.createIdentity()`) — not Hydra JWKS validation + Keto permission checks. Its `getToolDefinition()` registers an `ory_access_control` MCP tool for user registration/login flows, and `validateSession()` validates Kratos session tokens via the `x-session-token` header. This shape does not match our `OryPermissionProvider` interface, which requires: bearer JWT → Hydra JWKS verify → Keto `checkPermission(namespace, object, relation, subject)`. Investigated: npm registry, `pnpm search`, GitHub `ory` org (no `mcp-access-control` repo), and the skyfire-xyz reference repo source.

### Consequences
- One fewer external dependency; no npm install risk.
- We write and own the JWT+Keto gate ourselves (~50 LOC in `lib/auth/mcp-gate.ts`).
- Our gate uses `jose` (already in the dependency tree) for JWKS verification and `@ory/client-fetch` for Keto `checkPermission` calls, matching the actual Ory stack we're deploying.

---

## ADR-002: `@skyfire-xyz/skyfire-seller-sdk-node` — adopt
**Status:** Accepted
**Date:** 2026-05-14

### Decision
Adopt `@skyfire-xyz/skyfire-seller-sdk-node@0.0.6` for Phase 8 Skyfire integration.

### Context
Package exists on npm (MIT, latest 0.0.6, published 2025-08-01, repo: https://github.com/skyfire-xyz/skyfire-seller-sdk-node). Probed by installing in a scratch dir and reading the compiled build directly. Exported symbols: `validate(token, validationOptions?, jwtValidationOptions?)` and `chargeToken(token, amount)`, plus helpers `loadJWKSet()`, `getJWKSUrl()`, `getSkyfireIssuer()`, `getSkyfireAPIHost()`, `getSkyfireAPIKey()`. These match our `SkyfireKyaPayProvider.verify()` and `.charge()` shape exactly. JWKS rotation is handled internally via `jose.createRemoteJWKSet` with an in-process cache; callers may call `loadJWKSet()` to pre-warm or refresh. The SDK supports `kya+JWT`, `pay+JWT`, and `kya+pay+JWT` token types. One cosmetic bug noted: `config.js` reads `SKYFIRE_ISUER` (typo, missing 'S') instead of the documented `SKYFIRE_ISSUER`; the default value (`https://app.skyfire.xyz`) is correct so this only matters if overriding the issuer via env var. Five maintainers from Skyfire core team are listed.

### Consequences
- Phase 8 integration is a thin adapter — `SkyfireKyaPayProvider` wraps `validate()` and `chargeToken()` with no protocol implementation needed.
- Set `SKYFIRE_API_KEY` (required) and optionally `SKYFIRE_API_HOST` / `SKYFIRE_JWKS_URL`; issuer override requires the corrected env var name `SKYFIRE_ISSUER` once the SDK typo is fixed upstream.
- Track the package for security updates; the `jose` dependency (`^6.0.12`) and `openapi-fetch` (`^0.14.0`) are both actively maintained.
- If the `SKYFIRE_ISUER` typo causes integration pain before an upstream fix, patch with a one-line `process.env.SKYFIRE_ISUER = process.env.SKYFIRE_ISSUER` shim in bootstrap.

---

## ADR-003: `ory` CLI authentication & target project
**Status:** Accepted
**Date:** 2026-05-14

### Decision
The `ory` CLI on the dev machine is authed against the account that owns project `f5798507-b1c0-4168-9fd8-7eeb7a40d75c`. Config-as-code in `scripts/ory-setup/` will use this CLI from Phase 2 onward.

### Context
Verified via `ory list projects` and `ory get project f5798507-b1c0-4168-9fd8-7eeb7a40d75c`. Project slug `eager-dhawan-mio9f9ilcu` and project name `SkyfireOryDemo`. `scripts/ory-setup/apply.sh` runs cleanly with the expected no-op output.

### Consequences
- Phase 2/3/4/7 config changes ship as committed CLI invocations.
- CI does not need Ory creds — config-as-code is dev-machine-driven; CI uses `MemoryX` providers for tests.
