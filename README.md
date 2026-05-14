# Merchant Agentic Demo

A reference integration showcasing **Ory** (identity, OAuth2, permissions) and **Skyfire KYAPay** (agent payments) on a generic merchant storefront. Built for Ory by Ory.

> Status: Phase 0 (bootstrap). Real Ory integration starts in Phase 2. See `docs/plans/2026-05-13-architecture-and-roadmap.md` for the full roadmap.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind v4 · shadcn/ui · Drizzle + SQLite · Vitest · Playwright · Ory Network · Skyfire KYAPay (Phase 8+)

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
