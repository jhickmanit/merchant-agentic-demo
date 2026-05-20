# Phase 8 — Real Skyfire KYA Provider

**Status:** in-progress
**Started:** 2026-05-20
**Depends on:** Phase 6 (mock provider + DI factory), Phase 7 (delegation cross-checks)
**Out of scope:** Real `pay` / `kya-pay` settlement (separate phase). For Phase 8 the merchant continues to "settle" via a synthetic chargeId — only the **identity verification** side becomes real.

## Goal
Wire a real `SkyfireKyaPayProvider` behind `KYAPAY_PROVIDER=skyfire`. Local JWKS verification of Skyfire-issued KYA JWTs; cart-driven amount (real KYA tokens carry identity only). Mock stays as default so demo runs without creds.

## Skyfire facts (from docs, 2026-05-20)
- **Mint:** `POST https://api.skyfire.xyz/api/v1/tokens` with header `skyfire-api-key: <buyerAgentApiKey>`; body `{ type: "kya", sellerDomainOrUrl, buyerTag?, expiresAt? }`.
- **Verify:** local JWKS at `https://app.skyfire.xyz/.well-known/jwks.json` (cache ≤60 min), expected `iss: "https://app.skyfire.xyz"`, header carries token as `skyfire-pay-id` in production usage; for our /charge we keep the existing `KYA-Pay <jwt>` Authorization header — the JWT is what matters, not the header name on Skyfire's side.
- **Optional introspect:** `POST /api/v1/tokens/introspect` — not used in Phase 8 (local JWKS verify is sufficient and what Skyfire recommends).
- **KYA payload** (Skyfire shape): `iss, iat, exp, jti, sub` (buyer agent id), `aud` (seller agent id), `env`, `ssi`, `btg`, `hid: { email }`, `aid: { name, creation_ip, source_ips }`, `apd: { id, name, email, ... }`.

## Mismatch with our current types
Our `KyaPayClaims` requires `amount: number`, `cur: "USD"`, and `aid.id`. Real Skyfire KYA has:
- no `amount` / `cur` — KYA is identity-only
- `aid` has no `id` field (only `name`); the buyer agent id is `sub`

### Resolution
1. Make `amount` and `cur` **optional** on `KyaPayClaims`.
2. Add `agentId: string` on the verify result (derived from `aid.id` for mock, `sub` for Skyfire) — keeps validate-and-charge.ts agent-match check provider-agnostic.
3. In `validate-and-charge.ts`:
   - Use `claims.agentId` instead of `claims.aid.id`.
   - When `claims.amount` is **undefined**, skip the amount-mismatch check (cart total becomes authoritative). Charge proceeds with `cart.totalCents`.
   - When `claims.amount` is **defined** (mock path), keep the existing strict equality.

## Tasks

### T1 — Type & validate-and-charge changes (single commit)
**Files**
- `lib/payments/types.ts` — add optional `amount?: number; cur?: "USD"`, add `agentId: string` on verify result (or as a top-level field on `KyaPayClaims`).
- `lib/payments/mock/kyapay.ts` — populate new `agentId` field from `aid.id`.
- `lib/agent/validate-and-charge.ts` — use `claims.agentId`; gate amount equality on `claims.amount !== undefined`; use cart total when missing; gate `delegation_max_amount_exceeded` likewise (use `cart.totalCents` when claims.amount missing).
- `lib/payments/__tests__/mock-kyapay.test.ts` and any existing tests — adjust expectations for the new field.

**Verify:** `pnpm test` (unit) green; `pnpm test:e2e` only relevant if the change touches behavior — should be unchanged.

**Commit:** `refactor(kyapay): claims.agentId + optional amount for provider-agnostic verify`

### T2 — `SkyfireKyaPayProvider`
**Files**
- `lib/payments/skyfire/kyapay.ts` (new) — implements `KyaPayProvider`:
  - `verify(jwt)`: lazy `jose.createRemoteJWKSet(new URL(JWKS_URL))` (jose caches), `jose.jwtVerify(jwt, jwks, { issuer })`. Map payload → `KyaPayClaims` (agentId from `payload.sub`, hid from `payload.hid`, etc.). Return `{ ok: false, code, message }` on failure.
  - `charge(_jwt, amountCents)`: returns a synthetic `{ chargeId: "sf_${randomUUID()}", settledAt: new Date(), amountCents }`. **Note in code comment**: real settlement requires Skyfire `pay`/`kya-pay` flow — out of Phase 8 scope.
  - `jwks()`: fetch JWKS from Skyfire and return as-is (for completeness; merchant doesn't actually serve a JWKS in skyfire mode but the interface requires it).
- `lib/payments/skyfire/config.ts` (new) — env-var reading: `SKYFIRE_JWKS_URL` (default prod), `SKYFIRE_ISSUER` (default `https://app.skyfire.xyz`), `SKYFIRE_EXPECTED_AUDIENCE` (optional — if set, enforce `aud === expected`), `SKYFIRE_API_BASE` (default `https://api.skyfire.xyz/api/v1`).
- `lib/payments/index.ts` — replace the `throw new Error("Real Skyfire provider lands in Phase 8")` branch with construction of `SkyfireKyaPayProvider`.
- `lib/payments/skyfire/__tests__/kyapay.test.ts` (new) — at least:
  - happy path: mock `fetch` for JWKS, generate a token signed with a test key whose JWK is returned, verify returns `ok: true` with mapped claims.
  - failure: wrong issuer → `ok: false`, code `invalid_issuer`.

**Verify:** `pnpm test` green; `pnpm typecheck` clean.

**Commit:** `feat(kyapay): real SkyfireKyaPayProvider with JWKS-based verify`

### T3 — Mint helper script
**Files**
- `scripts/skyfire/mint-kya.ts` (new) — `pnpm tsx` runnable. Reads `SKYFIRE_BUYER_API_KEY`, `SKYFIRE_BUYER_AGENT_ID` (display only), `SKYFIRE_SELLER_DOMAIN` (default `http://localhost:3000`), optional `--buyerTag <uuid>` and `--expiresIn <seconds>`. POSTs to `https://api.skyfire.xyz/api/v1/tokens` with `type: "kya"`. Prints the token JWT to stdout (and a friendly summary to stderr so stdout is pipe-clean).
- `package.json` — add `"skyfire:mint-kya": "tsx scripts/skyfire/mint-kya.ts"`.
- `README.md` (small addition) — one section "Phase 8: minting a real Skyfire KYA token" with usage.

**Verify:**
```bash
SKYFIRE_BUYER_API_KEY=... pnpm skyfire:mint-kya --sellerDomain http://localhost:3000
# expect: a JWT printed to stdout
```
(User runs this manually; not in CI.)

**Commit:** `feat(skyfire): pnpm skyfire:mint-kya helper for PoC manual testing`

### T4 — Manual integration sanity check
Not a code task; documented in plan:
1. Add to `.env.local`:
   ```
   KYAPAY_PROVIDER=skyfire
   SKYFIRE_BUYER_API_KEY=<from Jeff's notes>
   ```
2. `pnpm dev`
3. `JWT=$(pnpm skyfire:mint-kya --sellerDomain http://localhost:3000)`
4. POST to `/api/charge` with `Authorization: KYA-Pay $JWT` and an agent-bound cart cookie.
5. Expect: order created. Confirm in `/orders/[id]` that the Mandate Panel shows real Skyfire claims (real email, real iss `https://app.skyfire.xyz`, real jti).

**Commit:** none (manual verification only). If smoke uncovers a bug → new task.

## Non-goals (parked)
- Real `pay` / `kya-pay` settlement → future phase.
- Pointing Skyfire's Bose/Visa demo at our merchant — needs a public host + likely seller onboarding with Skyfire; out of Phase 8.
- Buyer-tag wiring to our internal agent ID — could add later if useful for cross-system correlation.
