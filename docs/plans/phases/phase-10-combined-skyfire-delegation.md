# Phase 10 — Combined Skyfire KYA + Hydra delegation + identity auto-provision

**Status:** in-progress
**Started:** 2026-05-22
**Driver:** May 22 Skyfire touchpoint (Ankit / Supreet). This is "Flow 7" — the
penultimate, demo-headline flow. Combines what Phase 7 (Hydra delegated-token
bootstrap) and Phase 9 (Skyfire auto-provision) already do, but as a single
end-to-end story instead of two parallel branches.

## Goal

A Bose-style embedded-browser agent hits `POST /api/checkout` carrying only a
Skyfire KYA token (any of the four accepted header shapes — see
[`lib/agent/kya-header.ts`](../../../lib/agent/kya-header.ts)). The merchant:

1. Verifies the KYA via Skyfire's JWKS (Phase 8 plumbing).
2. **Auto-provisions** a Kratos identity for `claims.hid.email` if absent
   *and* an `agents` row for `claims.agentId` if absent (Phase 9 plumbing).
3. **Bootstraps a Hydra delegated access token** for that owner+agent pair
   using a single shared "skyfire-bridge" OAuth2 client (this phase's new
   wiring). The bootstrap re-uses Phase 7's orchestrator
   (`lib/oauth/bootstrap.ts`) and the existing `/oauth/login` + `/oauth/consent`
   apps — extended so they recognize the skyfire-bridge client as well as
   per-agent client_credentials clients.
4. Caches the bootstrap result by the KYA's `jti` so repeated calls within the
   same agent session don't re-bootstrap.
5. Returns the order receipt as normal. Subsequent merchant calls from this
   agent session present the delegated `Authorization: Bearer ory_at_…` and
   skip the bootstrap step.

The headline payoff: a single demoable flow that exercises **every** Ory
product Skyfire customers care about — Kratos (auto-provisioned identity),
Keto (owner→agent tuple), Hydra (delegated access token with RFC 9396
`authorization_details`) — driven entirely by a Skyfire-issued KYA, with no
prior registration on the merchant side.

## What's wrong with Flow 6 today

Flow 6 (Phase 9) auto-provisions the user and agent rows but **does not**
bootstrap a Hydra token. The agent has to keep presenting the KYA on every
request, and downstream the merchant treats `hydraClientId="skyfire-attested"`
as a sentinel that means "skip the delegated-token cross-checks." That's fine
as a Phase-9 stepping stone but it doesn't show off the Hydra story.

Flow 4 (Phase 7) shows the full Hydra story but only works for agents the
human pre-registered at `/me/agents/new` — there's a real `DEMO_AGENT_CLIENT_ID`
backing each agent. Bose has no equivalent — its agents arrive cold with a KYA
and no pre-registration.

Flow 7 closes the gap.

## Architecture decisions

### One shared "skyfire-bridge" Hydra client

Auto-provisioned agents do **not** get a per-agent Hydra client. Instead, a
single Hydra OAuth2 client (created once by `scripts/ory-setup/hydra-config.sh`)
acts as the bridge: every Skyfire-attested agent bootstraps through it. The
per-agent identity is carried in the `act` claim of the issued token (not in
the client id).

Why this and not per-agent clients:
- KYA is *already* the per-agent credential. Creating a Hydra client per
  Skyfire UUID would be redundant and quickly bloats the Hydra clients table.
- The Login/Consent apps already stamp `act.sub = agentId` into the access
  token — that's where the agent identity lives in the resulting token.
- One client to manage, one secret to rotate.

The bridge client's config:
- `grant_types`: `["authorization_code"]`
- `response_types`: `["code"]`
- `token_endpoint_auth_method`: `client_secret_basic`
- `redirect_uris`: `["http://localhost:3000/api/oauth/bootstrap-callback"]`
- `scope`: `"offline_access openid"`

### Bootstrap fires inside `/api/checkout`, not as a separate endpoint

Bose's headless browser doesn't speak custom auth handshakes. Simplest model:
when `/api/checkout` sees a KYA but no Bearer, it does the bootstrap inline,
attaches the resulting delegated token to its server-side context, and proceeds
as if the agent had presented the Bearer all along. The agent never sees the
Bearer (we won't return it in the response — it stays server-side). Next
request from the same agent can either:
- Present the KYA again → we hit the per-`jti` cache and reuse the token, or
- Present nothing → fall back to KYA-only path with no delegated semantics.

For demo purposes this is enough. A real client would want a token-endpoint
contract so it can persist the Bearer; we'll add that in a future phase if
asked.

### `/oauth/login` recognizes both client types

Today `/oauth/login` validates that `claims.agentId` matches an existing
`agents.hydraClientId`. After Phase 10 it also accepts the case where the
Hydra client is the skyfire-bridge client *and* the KYA's `claims.agentId`
matches an existing `agents.id` (auto-provisioned). Branch on:

```ts
if (clientId === SKYFIRE_BRIDGE_CLIENT_ID) {
  // skyfire-attested: agent row must exist (auto-provision already ran),
  // hydraClientId is "skyfire-attested" sentinel, not the bridge id.
  const agent = await getAgentById(claims.agentId);
  if (!agent || agent.hydraClientId !== "skyfire-attested") reject();
} else {
  // pre-registered: hydraClientId must equal the requesting clientId
  const agent = await getAgentByHydraClientId(clientId);
  if (!agent || agent.id !== claims.agentId) reject();
}
```

Consent app needs no changes — it stamps `act.sub = agentId` from the login
context either way.

## Tasks

### T1 — Provision the skyfire-bridge Hydra client

**Files**
- `scripts/ory-setup/hydra-config.sh` — add an idempotent `ory create
  oauth2-client` call that creates the bridge client if it doesn't exist,
  reads its `client_id`/`client_secret` back, and prints export lines for
  `.env.local`. Use a stable name so re-runs detect the existing one.

**Manual step** (once per project): copy the printed exports into `.env.local`
as `SKYFIRE_BRIDGE_CLIENT_ID` / `SKYFIRE_BRIDGE_CLIENT_SECRET`. Document this
in the README under setup.

### T2 — `.env.example` + env loader

**Files**
- `.env.example` — add `SKYFIRE_BRIDGE_CLIENT_ID` / `SKYFIRE_BRIDGE_CLIENT_SECRET`
  with comments pointing at T1.

### T3 — `lib/agent/skyfire-bridge.ts`

New module. Exports:

```ts
export async function bootstrapSkyfireAgent(
  kyaJwt: string,
  claims: KyaPayClaims,
  deps: {
    db: DB;
    identity: IdentityProvider;
    permission: PermissionProvider;
    bootstrap?: typeof bootstrapDelegatedToken; // injectable for tests
  },
): Promise<{
  ownerUserId: string;
  agentId: string;
  accessToken: string;
  delegationClaims: DelegationClaims; // already-decoded for ctx
}>
```

Internally:
1. Call `ensureAgentAndOwner(claims, deps)` — Phase 9's helper, untouched.
2. Call `bootstrapDelegatedToken({ kyaJwt, clientId: BRIDGE, clientSecret: ... })`
   — Phase 7's orchestrator, also untouched.
3. Decode the resulting access token's claims (introspect via Hydra admin or
   parse the JWT depending on token format) into `DelegationClaims` shape.
4. Cache by `claims.jti` in a module-level `Map<jti, BootstrapResult>` with a
   60-second TTL so repeat KYA-only requests in the same session reuse the
   bootstrap.

### T4 — Wire into `/api/checkout`

**Files**
- `app/api/checkout/route.ts` — in the agent branch, when there's no Hydra
  bearer but there is a KYA, call `bootstrapSkyfireAgent()` instead of just
  `ensureAgentAndOwner()`. Use the returned `delegationClaims` to construct
  `ctx` for `validateAndCharge` — same shape as the Phase-7 Hydra-bearer
  path, so downstream validation logic is identical.

### T5 — Login/Consent app recognizes the bridge client

**Files**
- `app/oauth/login/route.ts` — branch on `loginRequest.client.client_id ===
  process.env.SKYFIRE_BRIDGE_CLIENT_ID` and validate using
  `agents.hydraClientId === "skyfire-attested"` instead of strict client_id
  match.
- `app/oauth/consent/route.ts` — no changes (already stamps `act.sub` from
  context).

### T6 — Tests

**Files**
- `lib/agent/__tests__/skyfire-bridge.test.ts` — unit tests with mocked
  `bootstrapDelegatedToken` and in-memory identity/permission providers.
  Cover: (a) first-time KYA bootstraps creates user + agent + token,
  (b) repeat with same jti hits cache, (c) different jti re-runs bootstrap,
  (d) bootstrap failure surfaces as a typed error.
- `app/api/checkout/__tests__/skyfire-flow7.test.ts` — integration-style:
  POST a fresh KYA to `/api/checkout`, assert the response is 200 and a
  delegated token was minted (mock the Hydra calls inside the orchestrator).

### T7 — README + diagram

**Files**
- `README.md` — replace the Flow 6 mermaid with the Flow 7 mermaid (Flow 6
  becomes a building-block reference, not a headline). Update the
  "Demoable flows" table to mark Flow 6 as "internal stepping stone" and
  Flow 7 as the headline.
- New flow 7 diagram: KYA → verify → ensureAgentAndOwner → bootstrap
  (Hydra round-trip rendered as a nested rect) → ctx assembly → validateAndCharge
  → charge → order.

### T8 — Wire dev-mode hydra config setup script into apply.sh

**Files**
- `scripts/ory-setup/apply.sh` — call `hydra-config.sh` if it doesn't yet
  source the bridge env vars, so a Skyfire engineer cloning the repo and
  running `apply.sh` against their own Ory project ends up with the bridge
  client provisioned in one step.

## Non-goals (parked)

- **Real Skyfire `pay-id` settlement.** Still synthetic `sf-<uuid>` chargeId.
- **Per-agent Hydra clients.** Bridge client is the only one needed for
  auto-provisioned agents.
- **Refresh-token rotation.** Bootstrap'd tokens are short-lived; demo
  doesn't exercise refresh.
- **Returning the Bearer to the agent in the response body.** It stays
  server-side; clients that want a Bearer get it via a future
  `/api/agent/bootstrap` endpoint (not this phase).
- **Pre-checkout user verification (email/SMS) toggle.** That's a separate
  Phase 11 sketch — see `docs/plans/phases/phase-11-pre-checkout-verification.md`
  (to be drafted).

## Demo script (target end-state for May 29 check-in)

1. `pnpm dev` + `ory tunnel` running. `.env.local` has `KYAPAY_PROVIDER=skyfire`
   + bridge client creds + Skyfire buyer API key.
2. `pnpm skyfire:mint-kya --sellerDomain http://localhost:3000` → JWT.
3. `curl -X POST http://localhost:3000/api/checkout -H "skyfire-pay-id: <jwt>"
   -H "x-cart-id: <cart>"` → 200, order id, mandate panel populated.
4. Open `/orders/<id>` in browser as the auto-provisioned user → see the
   mandate panel rendering KYA claims + RFC 9396 `authorization_details` from
   the delegated token + Keto check trace in the DebugPolicyPanel.
5. All three Ory products demonstrably did work: Kratos created the user,
   Keto enforced the order ownership tuple, Hydra issued the delegated token.
