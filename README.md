# Merchant Agentic Demo

A reference integration showcasing **Ory** (identity, OAuth2, permissions) and **Skyfire KYAPay** (agent payments) on a generic merchant storefront. Built for Ory by Ory.

> Status: Phase 0 (bootstrap). Real Ory integration starts in Phase 2. See `docs/plans/2026-05-13-architecture-and-roadmap.md` for the full roadmap.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind v4 · shadcn/ui · Drizzle + SQLite · Vitest · Playwright · Ory Kratos (sessions) · Ory Keto (permissions) · Ory Network · Skyfire KYAPay (Phase 8+)

## Prereqs

- Node 25.9.0 (pinned via `.node-version`; install via fnm/nvm)
- pnpm 11+
- `ory` CLI installed and authed (`brew install ory/tap/cli && ory auth`)

## Setup

```bash
pnpm install
cp .env.example .env.local
# Edit .env.local — set ORY_ADMIN_API_KEY from the Ory console (Project Settings → API Keys)
pnpm db:migrate
pnpm db:seed
```

## Run

```bash
pnpm dev          # http://localhost:3000
pnpm test         # Vitest unit tests
pnpm test:e2e     # Playwright e2e tests
pnpm exec tsc --noEmit   # Typecheck
pnpm lint         # ESLint
```

## Sign in

Anonymous browsing works without an account. To check out (or visit `/cart`, `/orders`, or `/me`), you must sign in.

Sign-in is hosted by **Ory Account Experience** at the project's URL. For local development against the hosted UI you'll need **Ory Tunnel** to avoid cross-domain cookie issues:

```bash
# In a separate terminal, with pnpm dev already running on :3000:
ory tunnel --project f5798507-b1c0-4168-9fd8-7eeb7a40d75c http://localhost:3000
```

The tunnel proxies Ory under the same origin as your app (defaults to `http://localhost:4000`), so the Kratos session cookie can be set on the right domain.

**Without the tunnel:** the e2e tests work (they use session-token injection — see `e2e/fixtures/test-identity.ts`), but interactive sign-in via the hosted UI will fail with a redirect loop. See `docs/decisions.md` once Phase 10 polish adds the production custom-domain path.

### Test users for e2e

The e2e suite (`pnpm test:e2e`) creates throwaway test identities via the Ory admin API and deletes them on teardown. Requires `ORY_ADMIN_API_KEY` (or `ORY_API_KEY`) set in `.env.local`.

## Permissions

Order ownership is enforced by **Ory Keto**. When a user places an order, two relation tuples are written via `getAuth().permission.addTuple()`:

- `Order:{id}#owner@User:{user_id}` — durable ownership
- `Order:{id}#view@User:{user_id}` — view permission (explicit; Ory Network's hosted Keto doesn't enforce OPL computed permits)

The order detail page calls `getAuth().permission.check({ namespace: "Order", object, relation: "view", subject })` before rendering. A different signed-in user gets a Forbidden page; an anonymous visitor gets redirected to /login by middleware.

A small **Debug Policy Panel** appears at the bottom-right of pages that perform Keto checks (click to expand). Each entry shows: ALLOW/DENY · namespace:object#relation@subject · latency in ms. Great for demo storytelling.

The OPL namespaces live in `scripts/ory-setup/keto-namespaces/namespaces.ts` and the names are registered by `scripts/ory-setup/keto-config.sh`. (The TypeScript `permits.view = (ctx) => ...` rule in the OPL is informational — Ory Network only enforces direct relation tuples.)

If you ever need to backfill tuples for orders in the DB that pre-date Phase 3, run `pnpm backfill:tuples`.

## Agents

Signed-in users can register AI agents at `/me/agents/new`. Each registered agent is a real entity in three places:

- **Kratos** — a separate identity using the agent schema (traits: `owner_identity_id`, `agent_type`, `display_name`).
- **Hydra** — an OAuth2 client (`grant_types: ["client_credentials"]` for Phase 4; Phase 7 adds device-code grant).
- **Keto** — an `Agent:{aid}#owner@User:{uid}` tuple.

The local DB (`agents` table) denormalizes display name, agent type, spend cap, expiry, and revocation timestamp for fast lookups.

Revoking an agent invalidates the Hydra OAuth2 client, deletes the Keto tuple, and stamps the local row's `revoked_at`. The Kratos identity is kept for audit.

Future: Phase 6 binds agents to Skyfire KYA Pay credentials; Phase 7 wires the Hydra Login/Consent flow so a KYA token can be exchanged for a delegated user-bound access token.

## Agent surfaces

The merchant exposes two ways for agents to shop:

1. **MCP server** at `POST /api/mcp` — JSON-RPC 2.0. Tools: `searchProducts`, `getProduct`, `addToCart`, `viewCart`, `submitCart`. Requires `Authorization: Bearer <hydra-access-token>` (mint via `pnpm demo:mint-agent-token` against a Hydra OAuth2 client).
2. **HTML checkout with `X-KYA-Token` header** (Bose-style) — `POST /api/checkout` accepts an `X-KYA-Token: <jwt>` header in lieu of the human user-session flow. Walks the same HTML site a human would.

Both surfaces converge on `lib/agent/validate-and-charge.ts`. In Phase 5, that stub returns **`HTTP 402 Payment Required`** with `WWW-Authenticate: KYAPay realm="merchant-agentic-demo"`. Phase 6 will wire real KYA token validation + Skyfire `chargeToken`.

### Try it locally

```bash
# Terminal 1
pnpm dev

# Terminal 2 — first create a Hydra OAuth2 client via the Ory dashboard
# (grant_types: ["client_credentials"]) and put the id+secret in .env.local:
#   DEMO_AGENT_CLIENT_ID=...
#   DEMO_AGENT_CLIENT_SECRET=...
AGENT_TOKEN=$(pnpm demo:mint-agent-token | tail -1) pnpm demo:agent-mcp
# or:
pnpm demo:agent-browser
```

Both demos should report `received expected 402`.

## KYA Pay (Phase 6 — mock Skyfire)

Phase 6 wires real KYA token verification + a mock Skyfire `chargeToken`. Order details show a **Mandate panel** when payment was via KYAPay.

### Setup

```bash
pnpm gen:mock-skyfire-keys
# Paste both lines into .env.local. DO NOT commit the private key.
```

### Demo flow

```bash
# Terminal 1: dev server
pnpm dev

# Terminal 2: register an agent via /me/agents UI (note its id)
# Then mint a Hydra access token for the demo OAuth2 client and run:
AGENT_TOKEN=$(pnpm demo:mint-agent-token | tail -1) \
  pnpm demo:agent-mcp --agent <agent-id> --user-email <your-email>
```

The MCP demo agent lists tools, browses, adds to cart, views cart, mints a KYA token for the exact cart total, submits, and gets HTTP 200 + an order id. Visit `/orders/<id>` to see the Mandate panel.

### Validation matrix

| Failure | Status | `error` |
|---|---|---|
| Bad signature / expired / wrong audience | 400 | `kya_invalid` |
| Amount doesn't match cart total | 400 | `amount_mismatch` |
| `hid.email` doesn't match user | 403 | `hid_mismatch` |
| `aid.id` doesn't match agent context | 403 | `aid_mismatch` |
| Amount exceeds spend cap | 403 | `spend_cap_exceeded` |
| Replay (same `jti` charged twice) | 402 | `charge_failed` |

Phase 8 swaps `MockKyaPayProvider` for `SkyfireKyaPayProvider`. The merchant code doesn't change — `getPayments()` reads `KYAPAY_PROVIDER` and returns the right impl.

## Architecture & roadmap

- `docs/plans/2026-05-13-architecture-and-roadmap.md` — the master plan
- `docs/plans/phases/` — per-phase TDD implementation plans
- `docs/research/2026-05-13-research-summary.md` — research that informed the plan
- `docs/decisions.md` — ADRs

## Ory project

- Project ID: `f5798507-b1c0-4168-9fd8-7eeb7a40d75c`
- SDK URL: `https://eager-dhawan-mio9f9ilcu.projects.oryapis.com`
- Project name: SkyfireOryDemo
- Config-as-code: `scripts/ory-setup/`
