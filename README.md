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
