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

## ADR-002: `@skyfire-xyz/skyfire-seller-sdk-node` — adopt / fork / inline
**Status:** _TBD (filled in Task 12)_
**Date:** 2026-05-13

### Decision
TBD.

### Context
Skyfire's official seller SDK exposes `validate(token)` and `chargeToken(token, amount)`. We need to confirm the shapes match our `KyaPayProvider` interface and that the package is actively maintained.

### Consequences
TBD.

---

## ADR-003: `ory` CLI authentication & target project
**Status:** _TBD (filled in Task 13)_
**Date:** 2026-05-13

### Decision
TBD.

### Context
Jeff provisioned an Ory Network project (`f5798507-b1c0-4168-9fd8-7eeb7a40d75c`, SDK URL `https://eager-dhawan-mio9f9ilcu.projects.oryapis.com`) and installed/authed the `ory` CLI. We need to confirm the CLI is pointed at this project before we lean on it for config-as-code in Phase 2 onward.

### Consequences
TBD.
