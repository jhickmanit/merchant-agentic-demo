# Merchant Agentic Demo — Architecture & Roadmap

> **Status:** Architecture/planning document, pre-implementation. Each phase below is sized to become its own TDD-style implementation plan once we commit to building it.

**Goal:** A polished demo of a generic merchant site where humans authenticate via Ory and AI agents browse and purchase via Skyfire KYAPay — showcasing Ory's Agentic IAM stack as the canonical reference integration with KYAPay.

**Architecture:** Next.js 15 monolith hosting two parallel surfaces (human web UI + agent ACP/MCP API). Ory Network manages identities (Kratos), OAuth2/OIDC (Hydra), and authorization (Keto). Skyfire KYAPay handles agent payment authorization and settlement. The merchant validates KYAPay JWTs, calls Skyfire's charge API, and writes orders to a local SQLite store.

**Tech Stack:** Next.js 15 (App Router) · React 19 · Tailwind v4 · shadcn/ui · Drizzle ORM + SQLite (libSQL) · `@ory/client` + `@ory/keto-client` · `@skyfire-xyz/skyfire-seller-sdk-node` · `@modelcontextprotocol/sdk` · Vitest + Playwright · pnpm + Turborepo (single workspace, room to split).

**Demo product theme:** **TrailPeak Outfitters** — outdoor/sporting goods store (placeholder name; rename freely). Reasons: wide price band ($5 trail snacks → $500 jackets demonstrates spend caps; Unsplash has gorgeous free outdoor imagery; "Have my agent restock my pantry" / "Buy a tent under $200" are obviously useful agent narratives.)

**Placeholder agent name** used in this doc: "the agent" — earlier drafts used "Shoppy" as a cute hook but that's not a real product reference; replace with whatever fits the story.

---

## Demo narrative (the thing we're selling)

A two-pane split-screen with **two agent ingress surfaces feeding one unified auth pipeline**:

| Left pane (Jeff, human) | Right pane (Jeff's registered agent) |
|---|---|
| Signs in via Kratos. Browses the store. Goes to "My Agents" → registers an agent with a $200 cap, expires in 7 days. | Two surfaces, same merchant. **Browser narrative**: Playwright-driven agent navigates the storefront like a human, presents `X-KYA-Token` header at checkout (Bose/Visa flavor). **MCP narrative**: Vercel-AI-SDK agent calls structured MCP tools (Skyfire `skyfire-solutions-demo` flavor). Both go through the same Hydra Login/Consent bootstrap, both attempt $250 → blocked by Keto cap, adjust to $180 → Skyfire charge succeeds. |

### One auth pipeline regardless of surface

Both agent surfaces feed the same auth flow. There is **no "lightweight path"** that skips Hydra — the KYA token alone is not sufficient authorization for the merchant to spend against a user's account. The full flow per request:

1. Agent presents KYA token (header on HTML POST, parameter on MCP tool call, body on ACP).
2. Merchant verifies KYA signature against Skyfire JWKS — proves Skyfire vouches for the agent identity.
3. Merchant uses the KYA to bootstrap a **Hydra Login & Consent flow**: the custom Login App validates the KYA and accepts login with `subject = <delegating user>`. The custom Consent App writes a synthetic `act` claim and RFC 9396 `authorization_details` into `session.access_token`.
4. Hydra issues a user-bound access token. **This** is what gates the purchase decision; Keto checks are made against this token's subject (user) and `act` (agent).
5. Merchant calls Skyfire `chargeToken` with the original KYA for settlement.

The two surfaces differ only at step 1 — where the token is parsed from. Steps 2-5 are shared code in `lib/agent/validateAndCharge.ts`.

Three "wow" moments to engineer for:
1. **A live mandate panel** showing the signed JWT (decoded claims) at moment of purchase — KYAPay storytelling.
2. **Keto policy denial** — a visible 403 with the policy reason ("spend cap exceeded for this agent"), then a re-attempt under cap that succeeds.
3. **Revocation in real time** — Jeff revokes the agent mid-session and the next agent request 401s. Hits the "Keto delegation is authoritative" point.
4. **(Bonus)** The same Hydra-bootstrap pipeline serves both surfaces — visible in the code walkthrough.

---

## High-level architecture

```
                          ┌──────────────────────────────────────┐
                          │     Ory Network (provisioned)        │
                          │   eager-dhawan-mio9f9ilcu.projects.. │
                          │   Kratos      Hydra       Keto       │
                          │  (users +    (OAuth2 +   (relation   │
                          │   agents)   custom L&C)   tuples)    │
                          └─────┬───────────┬──────────┬─────────┘
                                │           │          │
                                ▼           ▼          ▼
┌────────────────────┐   ┌──────────────────────────────────────┐   ┌─────────────────────┐
│ Human (browser)    │──►│       Next.js 15 — TrailPeak          │◄─►│  Skyfire KYAPay      │
│   Kratos session   │   │                                       │   │  (JWT issuer +       │
└────────────────────┘   │  /          human web UI              │   │   settlement)        │
                          │  /checkout  accepts X-KYA-Token hdr  │   └─────────────────────┘
┌────────────────────┐   │  /login, /consent  custom L&C app    │
│ Browser agent      │──►│  /api/token-hook  Hydra claim webhook │
│ (Playwright,Bose)  │   │  /api/mcp   MCP server (StreamHTTP)   │
│ → X-KYA-Token hdr  │   │      └─ verify-token gate (Ory or     │
└────────────────────┘   │           inlined ~50 LOC)            │
                          │  /api/acp/* ACP JSON (optional)       │
┌────────────────────┐   │  ── shared core ───────────────────── │
│ MCP agent          │──►│   validateAndCharge(kya, cart, ctx)   │
│ (Vercel AI SDK,    │   │  ── Drizzle + SQLite ─────────────── │
│  Skyfire style)    │   │   products · carts · orders · agents │
└────────────────────┘   └──────────────────────────────────────┘
```

**Key constraints / design choices already locked:**

- **Build sequencing — Ory live from Phase 2, Skyfire mocked through Phase 7.** Phase 0 (bootstrap) and Phase 1 (storefront shell, anonymous browsing) are offline. **Phase 2 wires real Ory** (Kratos identities, Kratos sessions via Ory Account Experience, Keto permissions) — no fake email-only login is written. Phase 4 creates real agent identities and real Hydra OAuth2 clients on top. Phase 7 builds the custom Login & Consent app against real Hydra. Skyfire stays mocked through Phase 7 via a local ES256 keypair and fake `/charge` endpoint (~50 LOC). Phase 8 swaps mock-Skyfire for the real seller account.
- **Config-as-code for Ory.** All Ory project configuration (Kratos identity schemas, Hydra OAuth2 client policy, Keto namespaces) lives in `scripts/ory-setup/` and is applied via committed `ory patch …` / `ory create …` invocations. Repo is source of truth; the Ory console reflects it. A fresh project can be reconstructed by running one script.
- **Abstraction layer + `MemoryX` for tests.** All identity/OAuth2/permission/KYAPay logic goes through interfaces in `lib/auth/*` and `lib/payments/*`. `OryX` adapters are the production implementations; `MemoryX` implementations stay in the repo as **test fixtures only** so the contract suite runs offline in CI without Ory credentials.
- **Three agent ingress surfaces, one auth pipeline, one merchant core**:
  1. **Browser-driven (Bose-style)** — HTML checkout accepts `X-KYA-Token` header (or `Authorization: KYAPay <jwt>`). The Playwright agent navigates the human UI and attaches the header at checkout.
  2. **MCP-driven (Skyfire `skyfire-solutions-demo` style)** — `/api/mcp` over StreamableHTTP. Agent calls tools.
  3. **ACP JSON (secondary)** — `/api/acp/*`, share handlers with MCP. Kept thin; for non-MCP custom agents.
  
  All three converge on a single `validateAndCharge(kyaJwt, cart, ctx)` core that always drives the Hydra-bootstrap auth flow.
- **KYA alone is not authorization.** The merchant always drives a Hydra Login & Consent flow with the KYA as the federated-identity credential, and authorizes the purchase against the Hydra-issued user-bound access token (not against the KYA's `hid` claim directly).
- **Hydra does NOT support RFC 8693.** Delegation is wired via a **custom Login & Consent app** that accepts the KYA as bootstrap, plus an **OAuth2 token hook (webhook)** to inject `act`, RFC 9396 `authorization_details`, and per-merchant scope into the issued access token. RFC 8628 Device Authorization Grant (Hydra v25.4.0) is the underlying grant primitive.
- **Drizzle + SQLite** — zero ops, file checked into the repo (with a `db:seed` script).
- **NOT using Oathkeeper.** Validation lives in-process: a small middleware/util that parses a bearer/header JWT, validates against the right JWKS, and calls the permission interface (Keto in prod, in-memory in dev). We'll evaluate **`@ory/mcp-access-control`** on day 0 — if it's current and the right shape, we adopt it; if stale, we inline equivalent logic.
- **Ory Network (managed)** for the real Ory backend — provisioned at start of Phase 4. Self-host docker-compose stays as an optional appendix.
- **Two Kratos identity schemas:** `user` and `agent`.
- **Delegation lives in Keto**, not in Kratos traits — atomic revocation.
- **External account ramp:** Ory Network project already provisioned (project ID `f5798507-b1c0-4168-9fd8-7eeb7a40d75c`, SDK URL `https://eager-dhawan-mio9f9ilcu.projects.oryapis.com`). Admin API key in `.env.local` (gitignored). `ory` CLI installed and authed. Skyfire seller account provisioned at the start of Phase 8. Bose demo access slots into Phase 9 whenever it arrives.

---

## Phasing (each phase becomes its own implementation plan)

Each phase ends with the demo *running end-to-end up to that point* and is independently demoable.

### Phase 0 — Repo bootstrap, decisions doc, dependency triage, Ory-setup scaffold

**Outcome:** Empty Next.js 15 + Tailwind + shadcn skeleton, a few committed decisions, README, `.env.example` (with non-secret Ory project values), CI green, written go/no-go on `@ory/mcp-access-control`, and `scripts/ory-setup/` scaffolded (no schemas defined yet — those come in Phase 2/4).

- Initialize git, set up `pnpm`, scaffold Next.js 15 with App Router and TypeScript.
- Install shadcn/ui (`npx shadcn@latest init`).
- Install Drizzle + better-sqlite3, add `drizzle.config.ts`, create `db/schema.ts` placeholder.
- Add Vitest config and one smoke test.
- Add Playwright config and one smoke test (server starts, "/" 200s).
- Add `docs/decisions.md` (an ADR file) starting with the locked choices above.
- Add `.env.example` with: `ORY_PROJECT_ID=f5798507-b1c0-4168-9fd8-7eeb7a40d75c`, `ORY_SDK_URL=https://eager-dhawan-mio9f9ilcu.projects.oryapis.com`, `ORY_ADMIN_API_KEY=` (left empty — set in `.env.local`), plus placeholders for `SKYFIRE_API_KEY` etc. Add `.env.local` to `.gitignore`.
- Scaffold `scripts/ory-setup/` directory with a `README.md` describing the config-as-code pattern and a placeholder `apply.sh` that runs the ory CLI commands (no actual schemas committed yet).
- Add a GitHub Actions workflow: lint, typecheck, unit test, e2e smoke. CI uses `MemoryX` providers — no Ory credentials needed in CI for now.
- **Dependency triage**: install and probe `@ory/mcp-access-control`. Document last-published date, what it accepts as input, what it calls Keto with, and whether it knows about `authorization_details` / `act`. Decision recorded in `docs/decisions.md` as ADR-001: **adopt as-is** / **fork** / **inline equivalent**.
- **Dependency triage**: same probe for `@skyfire-xyz/skyfire-seller-sdk-node`. Confirm `validate()` accepts our token shape and `chargeToken()` is the right entry point. ADR-002.
- Smoke-test the Ory CLI connection: `ory list project` to confirm CLI auth points at the right project. Capture output as ADR-003 evidence.
- Commit.

Estimated size: **~1 day.**

### Phase 1 — Storefront shell (anonymous browsing, no auth yet)

**Outcome:** Anonymous browsing experience. You can browse the catalog and add items to a cookie-backed cart. Checkout is stubbed — no auth, no real payment. Auth arrives in Phase 2.

- Drizzle schema: `products`, `carts`, `cart_items`, `orders`, `order_items`, `agents` (stub for later).
- Seed script: 30 products from Faker + Unsplash images, categorized (apparel, footwear, packs, food, accessories).
- Pages: `/` (category grid), `/c/[category]`, `/p/[slug]`, `/cart`, `/checkout` (stub), `/orders` (empty placeholder).
- Components: `ProductCard`, `ProductGrid`, `CartSheet`, `CheckoutForm`, header with cart badge.
- Anonymous cart in a signed HTTP-only cookie (`cart_id` → row in `carts` table). Migrates to user-owned cart in Phase 2 when sign-in happens.
- Stub `/api/checkout` that writes an order with `payment_method = "stub"`, `user_id = null` for now.
- Vitest unit tests on cart math; Playwright e2e for anonymous browse + cart-add happy path.
- Visual pass: shadcn theme, dark mode, clean typography, branded wordmark.

Estimated size: **2 days.**

### Phase 2 — Identity & permission abstractions with real Ory wiring

**Outcome:** Real Kratos sessions for humans. Sign-in via Ory Account Experience. Sessions gate cart/checkout/orders pages. Identity, session, and permission abstractions are defined; both `OryX` (production) and `MemoryX` (test) implementations exist. "My Agents" page exists but is empty.

- Define interfaces:
  - `lib/auth/identity.ts` — `IdentityProvider`: `getById(id)`, `getByEmail(email)`, `createUser(traits)`, `createAgent(traits, ownerId)`.
  - `lib/auth/sessions.ts` — `SessionProvider`: `getCurrentSession(req)`, `createSession(identity)`, `revoke(sessionId)`.
  - `lib/auth/permissions.ts` — `PermissionProvider`: `check(namespace, object, relation, subject)`, `addTuple(...)`, `removeTuple(...)`.
- Implement `OryX` adapters (production):
  - `OryIdentityProvider` using `@ory/client` admin SDK (`identityApi.{listIdentities, createIdentity, getIdentity}`).
  - `OrySessionProvider` reading the `ory_kratos_session` cookie and calling `frontendApi.toSession()`.
  - `OryPermissionProvider` using `@ory/keto-client` (`permissionApi.checkPermission`, `relationshipApi.createRelationship`).
- Implement `MemoryX` adapters (test fixtures, in `lib/auth/__fakes__/`):
  - Map/Set-backed stores with the same shape; ~150 LOC total.
  - Contract test suite (`lib/auth/__tests__/contract.ts`) runs against BOTH adapters with identical assertions. The CI default is `MemoryX`; nightly e2e runs against `OryX`.
- DI module (`lib/auth/index.ts`) reads `AUTH_PROVIDER=ory|memory` from env. Default `ory` for dev/staging; tests override to `memory`.
- **Config-as-code in `scripts/ory-setup/`**:
  - `identity-schemas/user.schema.json` — Kratos `user` identity schema (email, name, shipping addresses, preferred currency).
  - `apply.sh` — runs `ory patch identity-config --add '/identity/default_schema_id=user' --add '/identity/schemas/0={"id":"user","url":"file://./identity-schemas/user.schema.json"}'` and similar. Idempotent.
  - First run applies the user schema. (Agent schema added in Phase 4.)
- Build `/login` and `/register` — proxy/redirect to **Ory Account Experience** at the project's Kratos UI URL. Default for speed; embedded self-service flows are a Phase 10 polish option.
- Middleware: protect `/cart`, `/checkout`, `/orders`, `/me/*` via the `SessionProvider`. Redirect anonymous users to `/login?return_to=...`.
- Migrate the anonymous cart from Phase 1 to a user-owned cart on first sign-in.
- `/me/agents` page (empty list + "Register an agent" CTA).
- Tests: contract suite against both providers; Playwright e2e against real Ory Account Experience using a seeded test identity (created via `ory create identity`).

Estimated size: **2.5–3 days** (Ory adapters + Account Experience integration + first run of `ory-setup/apply.sh`).

### Phase 3 — Permission-gated ownership against real Keto

**Outcome:** Orders are visible only to their owner. Policy decisions go through `OryPermissionProvider` (real Keto), not ad-hoc DB checks. Demonstrates the "every authz check is a Keto call" story.

- Author Keto namespace definitions in `scripts/ory-setup/keto-namespaces/`:
  - `namespaces.ts` (Keto OPL): defines `User`, `Order`, `Agent`, `Merchant`, `SpendCap` relations and permissions.
  - `apply.sh` extension: runs `ory patch project --add '/services/permission/config/namespaces/...'` to register them.
- Write tuples at order-creation time: `Order:{id}#owner@User:{user_id}` via `OryPermissionProvider.addTuple()`.
- Replace direct ownership checks with `perm.check({namespace: "Order", object, relation: "view", subject})` calls everywhere a route reads an order.
- Add a `<DebugPolicyPanel>` component (toggleable) that shows the last Keto check's request/response for the current page — great demo prop.
- Tests: contract suite covers basic namespace traversal against both `MemoryX` and `OryX`. E2E test asserts a stranger gets 403 when viewing someone else's order against real Keto.

Estimated size: **1.5 days.**

### Phase 4 — Agent registration

**Outcome:** Jeff can register an agent from `/me/agents`. The system creates a real Kratos agent identity, a real Hydra OAuth2 client, and real Keto delegation tuples.

- Author the **agent identity schema** in `scripts/ory-setup/identity-schemas/agent.schema.json` — traits include `agent_id`, `owner_identity_id`, `kya_credential_id`, `agent_type`, `attestation_url`. Apply via `ory-setup/apply.sh`.
- Define `OAuth2ClientProvider` interface (`create({owner, grantTypes, metadata})`, `revoke(clientId)`); implement `OryOAuth2ClientProvider` using the Hydra admin SDK (`@ory/client` `oAuth2Api.createOAuth2Client`).
- Build `/me/agents/new`: form for display name, type (`shopping`/`research`), spend cap, expiry date, allowed merchants (single merchant for the demo).
- Server action `registerAgent()`:
  - Create a Kratos agent identity via `OryIdentityProvider.createAgent({traits, ownerId})`.
  - Create a real Hydra OAuth2 client via `OryOAuth2ClientProvider.create({owner, grantTypes: ["urn:ietf:params:oauth:grant-type:device_code", "client_credentials"], metadata: {kratos_identity_id, kya_credential_id, ...}})` — **NOT** `urn:ietf:params:oauth:grant-type:token-exchange`; Hydra doesn't support 8693.
  - Write Keto delegation + spend-cap tuples via `OryPermissionProvider`.
- Server action `revokeAgent()` — invalidates Hydra sessions for the client (`oAuth2Api.revokeOAuth2LoginSessions`), deletes Keto delegation tuples, deactivates the Kratos agent identity.
- UI: agents list with status pill, "Revoke" button, spend-cap progress bar.
- Tests: contract suite covers `OAuth2ClientProvider` operations against `MemoryX` for CI speed. E2E flow against real Ory: registers an agent → asserts Hydra client exists + Keto tuples exist → revokes → asserts client revoked + tuples gone → asserts a later request from the revoked agent 401s.

Estimated size: **2 days** (agent schema config-as-code + UI + Hydra admin wiring + revocation flow).

### Phase 5 — Agent surfaces: browser-checkout, MCP, ACP (all three)

**Outcome:** An agent can interact with the merchant via any of three surfaces. The surfaces accept a KYA token but don't yet validate or charge (Phase 6). All three converge on the same handler.

- **Surface 1: human HTML checkout, agent-aware.** Add middleware to `/checkout` that detects `X-KYA-Token` (or `Authorization: KYAPay <jwt>`) and routes that request through `validateAndCharge()` instead of the human payment-method UI. The HTML pages are unchanged; the route handler just branches.
- **Surface 2: MCP server.** At `/api/mcp` using `@modelcontextprotocol/sdk` StreamableHTTP transport. Tools: `searchProducts`, `getProduct`, `addToCart`, `viewCart`, `submitCart`. Mirrors `skyfire-solutions-demo/mcp-servers/dappier-seller-server`.
- **Surface 3: ACP JSON (secondary).** `/api/acp/*` — `product_feed`, `cart` endpoints. Shares handlers with the MCP tools. Minimal subset matching ACP spec `2026-04-17`. Kept thin.
- **Auth gate.** Per Phase 0's ADR-001 decision, either wire `@ory/mcp-access-control` or use an inlined equivalent. Same gate logic on all three surfaces: parse the bearer/header JWT, validate against the real Hydra JWKS (live from Phase 4), and check the relevant Keto tuples. Returns 401 if missing/invalid.
- **Shared core stub.** All three surfaces converge on `lib/agent/validateAndCharge.ts` exporting `validateAndCharge(kyaJwt, cart, ctx)`. In this phase, the function returns 501 Not Implemented; Phase 6 wires the real pipeline. This is the file the demo walkthrough will linger on.
- **Two demo agent scripts** (skeletons now, payload-bearing in Phase 6):
  - `scripts/demo-agent-mcp.ts` — Vercel AI SDK client connecting to `/api/mcp`. Mirrors `skyfire-solutions-demo/agent/vercel`.
  - `scripts/demo-agent-browser.ts` — Playwright script that drives the human storefront, attaches `X-KYA-Token` at the checkout POST. This is the Bose-style flow.
- Tests: integration tests on each surface confirm the routing and 501/401 behavior. Property test that all three surfaces produce identical 501 results given the same `(cart, agent)` input.

Estimated size: **3 days.**

### Phase 6 — KYAPay verification + mock-Skyfire end-to-end purchase

**Outcome:** End-to-end purchase against a **mock Skyfire**. Agent presents a KYAPay JWT (signed by our local ES256 key), merchant validates it, charges via our mock-charge endpoint, writes the order, the order appears in Jeff's order history with a (synthetic) Skyfire transaction ID. **No real Skyfire account yet.**

- Define interface `KyaPayProvider` in `lib/payments/kyapay.ts`: `verify(jwt)`, `charge(jwt, amount)`, `jwks()`.
- Implement `MockKyaPayProvider`:
  - Local ES256 keypair stored in `.env.local` (committed under `.env.example` with a clearly-marked test key).
  - `jwks()` returns a public-key JWKS served at `/api/mock-skyfire/.well-known/jwks.json`.
  - `verify(jwt)` checks signature against our JWKS, plus all the claims a real Skyfire would (`iss`, `aud`, `ssi`, `value`/`amount`, `cur`, `exp`, `sps`/`spr`).
  - `charge(jwt, amount)` returns a synthetic `{charge_id, settled: true}` and logs the charge to an in-memory ledger.
- A small **test-token-minting CLI** (`scripts/mint-kya-test-token.ts`) used by Phase 5's demo agents to obtain valid test KYAs without standing up real Skyfire.
- Implement `validateAndCharge(kyaJwt, cart, ctx)`:
  - Validate KYA via `KyaPayProvider.verify()`.
  - Cross-check: claim `hid.email` must equal a known user's email; claim `aid.name` must match a registered agent's display name.
  - Cross-check: amount must be ≤ permission-store spend-cap for this `(agent, merchant)` pair.
  - **Stub user-session bootstrap** (Phase 7 replaces this): for now, set `ctx.user = <user looked up from hid.email>`. Phase 7 turns this into a real Hydra Login/Consent.
  - Call `KyaPayProvider.charge()`. On success, write the order with `payment_method = "kyapay"`, `payment_token_jti = ...`, `skyfire_charge_id = ...`.
  - Decrement / age out the spend-cap tuple via the `PermissionProvider`.
- "Mandate panel" UI on order-detail page showing decoded JWT claims (for human review).
- Tests: happy path, expired token, amount over cap, wrong audience, signature mismatch.

Estimated size: **2.5 days.**

### Phase 7 — Custom Login & Consent app + token hook (against real Hydra)

**Outcome:** Replaces Phase 6's stub user-session bootstrap with a real **Hydra Login/Consent flow** running against the real Ory Network Hydra provisioned in Phase 4. The agent's request triggers an OAuth2 flow where our custom Login App accepts the KYA as the federated-identity bootstrap, mints a Hydra-issued user-bound access token with a synthetic `act` claim, and the merchant authorizes the purchase against that token. This is the most demo-worthy moment.

> **Important:** Hydra does **NOT** support RFC 8693 token exchange ([discussion #3359](https://github.com/ory/hydra/discussions/3359), [issue #1218](https://github.com/ory/hydra/issues/1218) open since 2018). This phase implements the idiomatic Ory pattern: **custom Login & Consent app** that accepts an external attestation as the bootstrap, plus a **token hook (webhook)** to inject claims at issuance and refresh.

- Configure the Ory Network project's Hydra: register our Login URL (`/oauth/login`) and Consent URL (`/oauth/consent`); register the token-hook URL (`/api/token-hook`); enable RFC 8628 Device Authorization Grant.
- Build the **Login App** at `/oauth/login`:
  - Receive `?login_challenge=...` from Hydra (real, hosted on Ory Network).
  - Fetch login request context via `@ory/client` admin SDK.
  - Accept the Skyfire KYAPay JWT via a custom header / form param / bootstrap parameter.
  - Validate the JWT via `KyaPayProvider.verify()`.
  - Cross-check that the KYA `hid.email` maps to a registered Kratos user and that the agent is registered + non-revoked in Keto.
  - Call `acceptOAuth2LoginRequest(challenge, { subject: userId, context: { agent, kya } })`.
- Build the **Consent App** at `/oauth/consent`:
  - Read `?consent_challenge=...`, fetch the login context.
  - Auto-accept when `context` shows a valid, non-expired delegation (no UI prompt — this is an agent flow).
  - In `session.access_token`, write:
    - `act` = `{ sub: <agent_id>, agent_type, kya_jti }` (synthetic — Hydra has no first-class `act` slot)
    - `authorization_details` (RFC 9396) = `[{ type: "agent_purchase", merchant, max_amount, currency, expires_at }]`
    - `scope` = `catalog:browse cart:write payment:execute`
- Implement the **OAuth2 token hook**:
  - Add a `/api/token-hook` route in Next.js. Hydra (Ory Network) invokes it on issuance and refresh.
  - On each call, re-verify the delegation against Keto (the cap may have been consumed) and re-shape `session.access_token` claims. Return 403 to deny if the cap is exhausted.
- Update `validateAndCharge()`: replace Phase 6's stub user lookup with a real Hydra Login/Consent bootstrap. The request now produces a Hydra access token whose claims the merchant validates against the cart.
- Update the auth gate (Phase 5) to validate the Hydra-issued token's `act` and `authorization_details` for purchase requests.
- Update both demo agent scripts (`demo-agent-mcp.ts`, `demo-agent-browser.ts`) to drive the bootstrap → login challenge → access-token-with-`act` flow.
- Tests: assert the issued token has correct `act`/`sub`/`authorization_details`; that the merchant honors the cap; that issuance fails if KYAPay JWT is expired; that refresh fails after the cap is consumed. Contract suite runs against `MemoryOAuth2Provider` for CI speed; full e2e against real Ory Hydra in nightly.

Estimated size: **2.5 days** (Login/Consent app + token hook against real Hydra — saved ~half a day vs. building mock-Hydra).

### Phase 8 — Real Skyfire swap

**Outcome:** Replace mock-Skyfire with the real Skyfire seller account. Same tests pass. Same code paths run. Only the `KyaPayProvider` implementation and config change.

- **Provision** a Skyfire seller account. Capture `SKYFIRE_API_KEY`. Publish a storefront service in the Skyfire dashboard. Note the seller service ID (`ssi`) we'll need to enforce in token verification.
- Implement `SkyfireKyaPayProvider` using `@skyfire-xyz/skyfire-seller-sdk-node`:
  - `verify()` uses the real Skyfire JWKS endpoint and the SDK's `validate()`.
  - `charge()` calls `POST /api/v1/tokens/charge` with `{token, chargeAmount}` and the `skyfire-api-key` header.
  - `jwks()` returns Skyfire's JWKS URL.
- Switch DI to `KYAPAY_PROVIDER=skyfire` for dev/staging/prod. Tests stay on `memory`.
- Verify the test-token-minting CLI (Phase 6) keeps working for offline dev — it just generates tokens our `MemoryKyaPayProvider` accepts, which we still use in CI.
- Run the full contract test suite + nightly e2e against real Skyfire sandbox tokens. Expect quirks: token-shape edge cases, JWKS rotation handling.
- "Mandate panel" UI from Phase 6 now displays real Skyfire tokens (`hid` claim with real `verifier` field, real `aid`).

Estimated size: **1.5 days** (much smaller now — Ory swap already happened at Phase 4; only Skyfire left). Add 0.5 day risk buffer for token-shape quirks.

### Phase 9 — Bose-flow reality check

**Outcome:** Once we have access to Skyfire's Bose demo, confirm our `X-KYA-Token` header shape matches theirs and adjust as needed.

- Read the Bose demo's checkout request: exact header name, value format, any signature/timestamp/nonce conventions.
- If our header shape differs, update the merchant `/checkout` middleware and the Playwright demo agent to match. Should be a small adapter change.
- Confirm the agent identity claims we expect are present in their KYAs.
- Document the alignment in `docs/integrations/bose-flow.md`.

Estimated size: **0.5–1 day**, depending on how clean the Bose flow turns out to be.

### Phase 10 — Demo polish + recording

**Outcome:** A repeatable, scriptable demo flow with a recorded screen capture and a reset script.

- `scripts/demo-reset.ts`: wipes DB, re-seeds, deletes test users/agents from Kratos, clears Keto tuples, drops Hydra clients.
- `scripts/demo-walkthrough.md`: tight script with exact clicks/commands and screen-share talking points.
- A "Demo Mode" banner with phase indicators.
- Loom/QuickTime recording, README showcasing GIF.
- A blog-post-shaped doc with diagrams suitable for Ory marketing to publish.

Estimated size: **1 day.**

### Optional Phase 11 — Self-host docker-compose appendix

For audiences who care about air-gapped / on-prem. Same code, different Ory stack via official quickstart compose files. Out of scope for first cut.

---

## Top open questions / decisions to revisit

1. **Ory Account Experience vs. embedded Kratos flows.** Account Experience ships faster but is a separate origin; embedded flows look more "native" but cost a day or two of UI. *Default: Account Experience for the Phase 8 swap; embed in Phase 10 polish if time allows.*
2. **MCP transport.** Stdio is the dev/test default; StreamableHTTP transport is needed for hosted agents. *Default: ship both — stdio for local CLI demo agent, HTTP for hosted Claude/ChatGPT to discover.*
3. **Skyfire sandbox vs. real wallets at demo time.** Sandbox tokens are free; real wallets are more impressive. *Default: sandbox for CI (Phase 8), real ($10 funded wallet) for live demos.*
4. **Whether to support more than one merchant entity in Keto.** The schema is generic enough that adding a second mock merchant is trivial. *Default: single merchant for v1; second merchant as a stretch goal in Phase 10 if we want to demo cross-merchant policies.*
5. **MCP-UI rich product cards.** Shopify showed this as a polished UX — agents render rich HTML inside the chat. Worth the engineering effort? *Default: ship plain MCP first; rich UI is a Phase 10 polish item.*
6. **Mock-Hydra vs. ory/hydra in Docker locally.** Mock-Hydra is ~200 LOC and tightly coupled to our needs; running real Hydra in Docker is more faithful but heavier. *Default: mock-Hydra for Phase 7, real Hydra (Ory Network managed) for Phase 8. Real Hydra in Docker only if Phase 11 (self-host appendix) ships.*

---

## What we're explicitly NOT building

- Real shipping/tax calculation.
- A real payments processor for *humans* (we'll either stub or use Skyfire wallets for everyone). The point is agent payments.
- Account recovery flows beyond what Ory Account Experience gives us out-of-box.
- Mobile app surfaces.
- Inventory / restocking / merchant-admin pages (no `/admin`).
- A multi-tenant version. One merchant.

---

## Next steps

1. **Confirm phasing.** If the order or scope of any phase looks wrong, redirect now — each phase becomes its own TDD plan and re-shuffling is cheaper here than after a plan is drafted.
2. **Pick Phase 0 or Phase 1 to expand first.** Once confirmed, I'll write a bite-sized, TDD-style implementation plan for the chosen phase using the same writing-plans skill (test → run → implement → verify → commit per step, with exact file paths and code).
3. **Account provisioning intentionally deferred** to Phase 8. We build the entire integration against mocks first. Phase 8 is where Ory Network and Skyfire seller account get provisioned; Bose access lines up with Phase 9.
