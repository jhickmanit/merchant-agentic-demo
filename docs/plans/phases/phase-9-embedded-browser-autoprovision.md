# Phase 9 — Embedded-browser KYA + auto-provision

**Status:** in-progress
**Started:** 2026-05-20

## Goal
Make the merchant work for Skyfire's Bose/Visa demo agent without prior agent or owner registration. Two changes:

1. **Auto-provision on first valid KYA.** If `claims.hid.email` is unknown → create a Kratos identity. If `claims.agentId` (= Skyfire `sub`) is unknown → insert a local `agents` row with that exact id (no Kratos agent identity, no Hydra client — KYA itself is the credential).
2. **Recognize `skyfire-pay-id` header** alongside existing `x-kya-token` / `Authorization: KYAPay …`. This is the header Skyfire's docs use; the Bose embedded browser presumably injects it on every request.

## Non-goals (parked)
- Storefront read-path integration (cart, checkout pages gated on cookie session). Wait until we know which URLs the Bose demo actually hits.
- Hydra delegation for KYA-attested embedded browser. KYA validates the agent + human; no need for a delegated access token round-trip when the human is "present" via the embedded browser. The Phase 7 delegation path stays for the programmatic MCP flow.
- Cleanup / TTL on auto-created identities. Demo accumulates them; fine for now.

## Agent identity model (decision)
Skyfire's `sub` is **their** UUID for the buyer agent (e.g. `414496a0-…`). Our existing `registerAgent` creates a Kratos agent identity and uses its UUID as `agents.id` — those two UUIDs can't be made to match. So:

- Auto-provisioned agents **skip Kratos agent identity creation and Hydra client creation**.
- `agents.id = claims.agentId` (Skyfire UUID).
- `agents.hydraClientId = "skyfire-attested"` placeholder.
- `agents.ownerUserId` = Kratos identity id of the human (looked up or created by email).
- Keto tuple `Agent:<skyfireId>#owner@User:<kratosId>` is written.

The human-driven `/agents/new` flow still creates Kratos agent identities for non-Skyfire-attested agents. The two coexist; both produce valid local agents rows.

## Tasks

### T1 — `lib/agent/auto-provision.ts`
**Files**
- `lib/agent/auto-provision.ts` (new) — exports:
  ```ts
  export async function ensureAgentAndOwner(
    claims: KyaPayClaims,
    deps: { db: DB; identity: IdentityProvider; permission: PermissionProvider }
  ): Promise<{ ownerUserId: string; agentId: string }>
  ```
  - Look up user by `claims.hid.email`; create via `identity.createUser` if missing.
  - Look up local `agents` row by id = `claims.agentId`; insert if missing with:
    - `displayName: claims.aid.name`
    - `ownerUserId: <looked up>`
    - `agentType: "shopping"`
    - `hydraClientId: "skyfire-attested"`
    - `spendCapCents: null`
    - `expiresAt: null` (Skyfire token has its own exp; not the agent's)
  - On insert, write Keto `Agent:<id>#owner@User:<ownerId>` tuple (best-effort, log on failure).
  - Idempotent: subsequent calls with same claims return same ids.

**Tests** (`lib/agent/__tests__/auto-provision.test.ts`):
- New user + new agent → both created, ids returned.
- Existing user (by email) + new agent → reuses user, creates agent.
- Existing both → no-ops, returns existing ids.
- Email casing: `hid.email = "Foo@Bar.com"` matches existing `foo@bar.com`.

### T2 — Wire into `/api/checkout` (charge path)
- Extract: add `skyfire-pay-id` to `extractKyaToken()` (highest precedence).
- After KYA token is present and BEFORE `validateAndCharge`: run a pre-verify (call `kyaPay.verify`) to get claims, then `ensureAgentAndOwner(claims)` to derive `ctx.agentId` + `ctx.ownerUserId`. Pass those into `validateAndCharge`.
- The existing Hydra-bearer agentResult is still honored if present (Phase 7 path); auto-provision only fires when there's no Hydra bearer.

Note: this means `validateAndCharge` calls `verify` again. It's idempotent (JWKS-cached) and the double-call is acceptable for clarity; can dedupe later.

### T3 — Smoke tests
- `lib/agent/__tests__/checkout-autoprovision.test.ts` (integration-style with mocks): post a valid Skyfire-shaped KYA, with no prior agent/user → expect 200, expect new rows in DB + identity provider.

### T4 — README + plan crossref
- Add a "Phase 9" section to README explaining the auto-provision behavior and the `skyfire-pay-id` header.

## Open follow-ups for after Bose-team clarifies
- Confirm Skyfire's exact header name(s) Bose uses (`skyfire-pay-id` vs something else).
- Decide if storefront pages need parallel KYA-session auth (only matters if Bose's browser navigates merchant pages, vs only hitting `/api/checkout`).
- Decide whether auto-created users should be passwordless-recoverable or pure demo throwaways.
