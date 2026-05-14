# Phase 0 — Repo Bootstrap, Dependency Triage, Ory-Setup Scaffold

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap an empty Next.js 15 + Tailwind v4 + shadcn/ui + Drizzle + SQLite repo with Vitest, Playwright, GitHub Actions CI, env scaffolding, the `scripts/ory-setup/` config-as-code skeleton, and three ADRs in `docs/decisions.md` capturing dependency-triage decisions.

**Architecture:** Pure scaffolding phase. No business logic, no auth, no agents. Each task produces one committed, working unit. End state: `pnpm dev` serves a styled "Hello" page on port 3000, `pnpm test` runs one Vitest unit test, `pnpm test:e2e` runs one Playwright smoke test, `pnpm typecheck` passes, and `ory list project` confirms the CLI is pointing at the right Ory project.

**Tech Stack:** Node 25.9.0 (via fnm + `.node-version`) · pnpm 11.x · Next.js 15 (App Router) · React 19 · Tailwind v4 · shadcn/ui · Drizzle ORM · better-sqlite3 · Vitest · Playwright · GitHub Actions · `ory` CLI

**Parent plan:** [`docs/plans/2026-05-13-architecture-and-roadmap.md`](../2026-05-13-architecture-and-roadmap.md)

**Pre-conditions:**
- Working directory is `/Users/jeff.hickman/Code/demos/merchant-agentic-demo` and is empty except for `docs/` and `.claude/` (if present).
- Node ≥ 22 and pnpm ≥ 9 installed.
- `ory` CLI installed and authed against project `f5798507-b1c0-4168-9fd8-7eeb7a40d75c`.
- `ORY_ADMIN_API_KEY` set in `.env.local` (not yet — this plan creates `.env.local`).

---

## File Structure (created by this plan)

```
.
├── .github/workflows/ci.yml
├── .gitignore
├── .node-version                 (pins to 25.9.0 — fnm reads this)
├── .env.example
├── .env.local                    (gitignored; created by Task 8)
├── README.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── next.config.ts
├── postcss.config.mjs
├── next-env.d.ts                 (auto-generated)
├── eslint.config.mjs
├── vitest.config.ts
├── playwright.config.ts
├── drizzle.config.ts
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   └── ui/button.tsx             (created by shadcn init)
├── lib/
│   ├── utils.ts                  (shadcn helper)
│   └── cart-math.ts              (created by Task 6 as test fixture)
├── lib/__tests__/
│   └── cart-math.test.ts
├── db/
│   ├── schema.ts                 (placeholder)
│   └── index.ts
├── e2e/
│   └── smoke.spec.ts
├── scripts/
│   └── ory-setup/
│       ├── README.md
│       └── apply.sh              (placeholder, executable)
└── docs/
    └── decisions.md              (ADRs 1-3)
```

---

## Task 1: Pre-flight & repo init

**Files:**
- Create: `.gitignore`, `.node-version`

- [ ] **Step 1: Verify tool versions**

Run:
```bash
eval "$(fnm env --use-on-cd)"
cd /Users/jeff.hickman/Code/demos/merchant-agentic-demo
node --version
pnpm --version
ory version
```

Expected: `node --version` prints `v25.9.0`, `pnpm --version` prints `11.x`, `ory version` prints a version string (no auth error).

If `.node-version` doesn't already exist, write it: `echo "25.9.0" > .node-version`.

If any tool is missing: report BLOCKED.

- [ ] **Step 2: Initialize git**

Run:
```bash
cd /Users/jeff.hickman/Code/demos/merchant-agentic-demo
git init
git config init.defaultBranch main
git checkout -b main 2>/dev/null || true
```

Expected: `git status` shows "On branch main" and lists `docs/` as untracked.

- [ ] **Step 3: Write `.gitignore`**

Create `.gitignore` with:
```gitignore
# dependencies
node_modules/
.pnp.*
.yarn/

# next
.next/
out/
build/
next-env.d.ts

# env
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp

# OS
.DS_Store
Thumbs.db

# test
coverage/
playwright-report/
test-results/
.playwright/

# db
*.sqlite
*.sqlite-journal
*.db
*.db-journal

# logs
*.log
npm-debug.log*
pnpm-debug.log*
```

- [ ] **Step 4: First commit**

Run:
```bash
git add .gitignore .node-version docs/
git commit -m "chore: repo init with .gitignore, .node-version, and existing planning docs"
```

Expected: commit succeeds; `git log --oneline` shows one commit.

---

## Task 2: Scaffold Next.js 15

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`

- [ ] **Step 1: Run create-next-app into a temp dir**

Run:
```bash
cd /tmp
rm -rf merchant-tmp
pnpm create next-app@latest merchant-tmp \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --import-alias "@/*" \
  --eslint \
  --turbopack \
  --use-pnpm \
  --yes
```

Expected: scaffolds `/tmp/merchant-tmp/` with the Next.js 15 + Tailwind v4 + ESLint default stack.

- [ ] **Step 2: Move scaffolded files into the repo**

Run:
```bash
cd /Users/jeff.hickman/Code/demos/merchant-agentic-demo
rsync -a --exclude='.git' --exclude='.gitignore' --exclude='node_modules' /tmp/merchant-tmp/ ./
rm -rf /tmp/merchant-tmp
pnpm install
```

Expected: `package.json`, `tsconfig.json`, `app/`, etc. now in the repo. `pnpm install` succeeds.

- [ ] **Step 3: Verify dev server starts**

Run:
```bash
pnpm dev &
DEV_PID=$!
sleep 5
curl -sf http://localhost:3000 > /dev/null && echo "OK" || echo "FAIL"
kill $DEV_PID
```

Expected: prints `OK`. If `FAIL`, check the dev-server output for errors.

- [ ] **Step 4: Verify typecheck and lint pass**

Run:
```bash
pnpm exec tsc --noEmit
pnpm lint
```

Expected: both exit code 0.

- [ ] **Step 5: Commit**

Run:
```bash
git add -A
git commit -m "feat: scaffold Next.js 15 with Tailwind v4 and ESLint"
```

---

## Task 3: Add a styled landing page placeholder

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace `app/page.tsx`**

Write `app/page.tsx`:
```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-5xl font-bold tracking-tight">Merchant Agentic Demo</h1>
      <p className="mt-4 text-muted-foreground">
        Ory × Skyfire KYAPay reference integration.
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Visually verify**

Run:
```bash
pnpm dev &
DEV_PID=$!
sleep 5
curl -sf http://localhost:3000 | grep -q "Merchant Agentic Demo" && echo "OK" || echo "FAIL"
kill $DEV_PID
```

Expected: prints `OK`.

- [ ] **Step 3: Commit**

Run:
```bash
git add app/page.tsx
git commit -m "feat: add landing page placeholder"
```

---

## Task 4: shadcn/ui init + Button component

**Files:**
- Create: `components.json`, `lib/utils.ts`, `components/ui/button.tsx`
- Modify: `app/page.tsx`, `app/globals.css` (shadcn adds CSS vars)

- [ ] **Step 1: Run shadcn init**

Run:
```bash
pnpm dlx shadcn@latest init --yes --base-color=neutral --css-variables
```

Expected: creates `components.json`, `lib/utils.ts`, modifies `app/globals.css` with CSS variables for theming.

- [ ] **Step 2: Add the Button component**

Run:
```bash
pnpm dlx shadcn@latest add button --yes
```

Expected: creates `components/ui/button.tsx`.

- [ ] **Step 3: Use the Button in the landing page**

Modify `app/page.tsx`:
```tsx
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-5xl font-bold tracking-tight">Merchant Agentic Demo</h1>
      <p className="mt-4 text-muted-foreground">
        Ory × Skyfire KYAPay reference integration.
      </p>
      <Button className="mt-8" variant="default">Get started</Button>
    </main>
  );
}
```

- [ ] **Step 4: Verify it renders**

Run:
```bash
pnpm dev &
DEV_PID=$!
sleep 5
curl -sf http://localhost:3000 | grep -q "Get started" && echo "OK" || echo "FAIL"
kill $DEV_PID
```

Expected: prints `OK`.

- [ ] **Step 5: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

Run:
```bash
git add -A
git commit -m "feat: add shadcn/ui with Button"
```

---

## Task 5: Drizzle + better-sqlite3 setup

**Files:**
- Create: `drizzle.config.ts`, `db/schema.ts`, `db/index.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Install dependencies**

Run:
```bash
pnpm add drizzle-orm better-sqlite3
pnpm add -D drizzle-kit @types/better-sqlite3
```

Expected: packages added; lockfile updated.

- [ ] **Step 2: Create `db/schema.ts` placeholder**

Write `db/schema.ts`:
```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const _placeholder = sqliteTable("_placeholder", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  note: text("note").notNull().default("schema-stub-phase-0"),
});
```

- [ ] **Step 3: Create `db/index.ts` client**

Write `db/index.ts`:
```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const sqlite = new Database(process.env.DATABASE_URL ?? "./local.db");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
```

- [ ] **Step 4: Create `drizzle.config.ts`**

Write `drizzle.config.ts`:
```ts
import type { Config } from "drizzle-kit";

export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./local.db",
  },
} satisfies Config;
```

- [ ] **Step 5: Add db scripts to package.json**

Modify `package.json` `scripts` block — add:
```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

- [ ] **Step 6: Generate the placeholder migration**

Run:
```bash
pnpm db:generate
```

Expected: creates `db/migrations/0000_*.sql` and `db/migrations/meta/`. Verify by running `ls db/migrations/`.

- [ ] **Step 7: Verify the schema compiles**

Run: `pnpm exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 8: Commit**

Run:
```bash
git add -A
git commit -m "feat: scaffold Drizzle ORM with better-sqlite3"
```

---

## Task 6: Vitest setup with one TDD-style smoke test

**Files:**
- Create: `vitest.config.ts`, `lib/cart-math.ts`, `lib/__tests__/cart-math.test.ts`
- Modify: `package.json` (test script)

- [ ] **Step 1: Install Vitest**

Run:
```bash
pnpm add -D vitest @vitejs/plugin-react jsdom
```

- [ ] **Step 2: Create `vitest.config.ts`**

Write `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "lib/**/*.test.tsx"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 3: Add the test script**

Modify `package.json` `scripts` block — add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write the failing test FIRST**

Create `lib/__tests__/cart-math.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { cartTotal } from "@/lib/cart-math";

describe("cartTotal", () => {
  it("returns 0 for an empty cart", () => {
    expect(cartTotal([])).toBe(0);
  });

  it("sums prices times quantities", () => {
    const items = [
      { priceCents: 1999, quantity: 2 },
      { priceCents: 500, quantity: 3 },
    ];
    expect(cartTotal(items)).toBe(1999 * 2 + 500 * 3);
  });

  it("rejects negative quantities", () => {
    expect(() => cartTotal([{ priceCents: 100, quantity: -1 }])).toThrow();
  });
});
```

- [ ] **Step 5: Run the test — it MUST fail**

Run: `pnpm test`
Expected: FAIL with "Cannot find module '@/lib/cart-math'" or similar.

- [ ] **Step 6: Implement `lib/cart-math.ts`**

Write `lib/cart-math.ts`:
```ts
export interface CartLine {
  priceCents: number;
  quantity: number;
}

export function cartTotal(items: CartLine[]): number {
  let total = 0;
  for (const item of items) {
    if (item.quantity < 0) {
      throw new Error(`Negative quantity not allowed: ${item.quantity}`);
    }
    total += item.priceCents * item.quantity;
  }
  return total;
}
```

- [ ] **Step 7: Run the test — it MUST pass**

Run: `pnpm test`
Expected: PASS. Output shows "3 passed".

- [ ] **Step 8: Commit**

Run:
```bash
git add -A
git commit -m "test: add Vitest with cart-math TDD smoke test"
```

---

## Task 7: Playwright setup with one smoke test

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`
- Modify: `package.json` (e2e script)

- [ ] **Step 1: Install Playwright**

Run:
```bash
pnpm add -D @playwright/test
pnpm exec playwright install --with-deps chromium
```

Expected: Playwright + Chromium downloaded.

- [ ] **Step 2: Create `playwright.config.ts`**

Write `playwright.config.ts`:
```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: Write the failing e2e test FIRST**

Create `e2e/smoke.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("landing page renders heading and CTA", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Merchant Agentic Demo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
});
```

- [ ] **Step 4: Add the e2e script**

Modify `package.json` `scripts` block — add:
```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

- [ ] **Step 5: Run the test — it MUST pass against Task 4's landing page**

Run: `pnpm test:e2e`
Expected: PASS. (Task 4 already shipped the heading and button — this is a regression-guard test.)

If it fails: open `playwright-report/` to inspect; fix whichever side regressed.

- [ ] **Step 6: Commit**

Run:
```bash
git add -A
git commit -m "test: add Playwright with landing-page smoke test"
```

---

## Task 8: Env files

**Files:**
- Create: `.env.example`, `.env.local`

- [ ] **Step 1: Create `.env.example`**

Write `.env.example`:
```bash
# Ory Network (project provisioned 2026-05-13)
ORY_PROJECT_ID=f5798507-b1c0-4168-9fd8-7eeb7a40d75c
ORY_SDK_URL=https://eager-dhawan-mio9f9ilcu.projects.oryapis.com
ORY_ADMIN_API_KEY=

# Skyfire (set in Phase 8 when seller account is provisioned)
SKYFIRE_API_KEY=

# Local SQLite
DATABASE_URL=./local.db

# Provider selection (memory for tests, ory for dev/staging/prod)
AUTH_PROVIDER=ory
KYAPAY_PROVIDER=memory
```

- [ ] **Step 2: Create `.env.local` (gitignored)**

Write `.env.local` with the same keys, leaving `ORY_ADMIN_API_KEY=` for the user to fill in (or to be already filled in by Jeff):
```bash
ORY_PROJECT_ID=f5798507-b1c0-4168-9fd8-7eeb7a40d75c
ORY_SDK_URL=https://eager-dhawan-mio9f9ilcu.projects.oryapis.com
ORY_ADMIN_API_KEY=
SKYFIRE_API_KEY=
DATABASE_URL=./local.db
AUTH_PROVIDER=ory
KYAPAY_PROVIDER=memory
```

Note: The user (Jeff) will paste their admin API key into `ORY_ADMIN_API_KEY` himself. **Do not read `.env.local` after creation** — it contains secrets.

- [ ] **Step 3: Verify `.env.local` is gitignored**

Run: `git check-ignore -v .env.local`
Expected: prints `.gitignore:NN:.env.local\t.env.local`. The file is ignored.

- [ ] **Step 4: Commit**

Run:
```bash
git add .env.example
git commit -m "chore: add .env.example with non-secret Ory project values"
```

---

## Task 9: `scripts/ory-setup/` scaffold

**Files:**
- Create: `scripts/ory-setup/README.md`, `scripts/ory-setup/apply.sh`

- [ ] **Step 1: Create `scripts/ory-setup/README.md`**

Write `scripts/ory-setup/README.md`:
```markdown
# Ory project — config as code

This directory is the source of truth for the demo's Ory Network project configuration. Anything configurable in the Ory console — Kratos identity schemas, Hydra OAuth2 client policy, Keto namespaces, Login/Consent URLs, token-hook URLs — is authored here and applied via the `ory` CLI.

## Prereqs

- `ory` CLI installed (`brew install ory/tap/cli`) and authed (`ory auth`).
- `.env.local` contains `ORY_PROJECT_ID` and `ORY_ADMIN_API_KEY`.

## Apply

```bash
./scripts/ory-setup/apply.sh
```

`apply.sh` is idempotent — it re-applies the current config without breaking existing identities.

## Structure (added in later phases)

- `identity-schemas/user.schema.json` — Kratos user schema (Phase 2)
- `identity-schemas/agent.schema.json` — Kratos agent schema (Phase 4)
- `keto-namespaces/namespaces.ts` — Keto OPL definitions (Phase 3)
- `hydra/oauth2-client-policy.json` — OAuth2 client default policy (Phase 4)
- `hydra/login-consent-urls.sh` — register custom Login/Consent URLs (Phase 7)
```

- [ ] **Step 2: Create `scripts/ory-setup/apply.sh` placeholder**

Write `scripts/ory-setup/apply.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

# scripts/ory-setup/apply.sh
# Idempotently applies all Ory project configuration committed to this repo.
# Real content lands in Phases 2, 3, 4, and 7. This is a Phase 0 placeholder
# that verifies the CLI is wired correctly.

if [[ -f .env.local ]]; then
  set -a; source .env.local; set +a
fi

: "${ORY_PROJECT_ID:?ORY_PROJECT_ID is required (set in .env.local)}"

echo "Confirming ory CLI sees project ${ORY_PROJECT_ID}..."
ory get project "${ORY_PROJECT_ID}" --format json | head -c 200
echo
echo "OK — apply.sh has nothing to apply yet (Phase 0 placeholder)."
```

- [ ] **Step 3: Make `apply.sh` executable**

Run:
```bash
chmod +x scripts/ory-setup/apply.sh
```

- [ ] **Step 4: Commit**

Run:
```bash
git add scripts/
git commit -m "chore: scaffold scripts/ory-setup/ for config-as-code"
```

---

## Task 10: Decisions doc scaffold

**Files:**
- Create: `docs/decisions.md`

- [ ] **Step 1: Create `docs/decisions.md`**

Write `docs/decisions.md`:
```markdown
# Architectural Decision Records (ADRs)

ADRs are short. Lead with the decision. Capture context and consequences in 1–3 sentences. Update or supersede when reality diverges.

---

## ADR-001: `@ory/mcp-access-control` — adopt / fork / inline
**Status:** _TBD (filled in Task 11)_
**Date:** 2026-05-13

### Decision
TBD.

### Context
The Skyfire reference demo (`skyfire-xyz/skyfire-solutions-demo`) uses `@ory/mcp-access-control` to gate the merchant MCP server: parse a bearer JWT, validate against Hydra's JWKS, check Keto. Maturity, last-published date, and shape are unknown.

### Consequences
TBD.

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
```

- [ ] **Step 2: Commit**

Run:
```bash
git add docs/decisions.md
git commit -m "docs: scaffold ADR file with three placeholder records"
```

---

## Task 11: ADR-001 — probe `@ory/mcp-access-control`

**Files:**
- Modify: `docs/decisions.md`

- [ ] **Step 1: Check npm registry for the package**

Run:
```bash
pnpm view @ory/mcp-access-control versions --json 2>&1 | tail -5
pnpm view @ory/mcp-access-control time --json 2>&1 | tail -10
pnpm view @ory/mcp-access-control 2>&1 | head -40
```

Expected: prints version list and last-published timestamps, plus README summary. If `404` — the package name may be different; check `@ory/mcp` or search `pnpm search @ory mcp`.

- [ ] **Step 2: Try installing into a scratch directory**

Run:
```bash
mkdir -p /tmp/mcp-probe && cd /tmp/mcp-probe && pnpm init -y && pnpm add @ory/mcp-access-control 2>&1 | tail -20
ls node_modules/@ory/mcp-access-control 2>&1 | head -20
cat node_modules/@ory/mcp-access-control/package.json 2>&1 | head -40
```

Expected: package installs; can see `package.json` with `main`, `types`, `dependencies`. Read `README.md` if present.

If installation fails (package doesn't exist or is private): note that in the ADR and plan to inline the equivalent ~50 LOC.

- [ ] **Step 3: Inspect exported API**

Run:
```bash
cd /tmp/mcp-probe
node -e "console.log(Object.keys(require('@ory/mcp-access-control')))" 2>&1 | head -10
cat node_modules/@ory/mcp-access-control/dist/*.d.ts 2>&1 | head -60
```

Expected: see the exported symbols (e.g., `createAccessControl`, `validateBearer`, similar) and TypeScript declarations.

- [ ] **Step 4: Decide and fill in ADR-001**

Based on Steps 1-3, update `docs/decisions.md` ADR-001 with a concrete decision. Replace the placeholder block with the actual decision, context, and consequences. Use one of these templates:

**If adopting:**
```markdown
## ADR-001: `@ory/mcp-access-control` — adopt
**Status:** Accepted
**Date:** 2026-05-13

### Decision
Adopt `@ory/mcp-access-control@<version>` as the auth gate for the merchant MCP server.

### Context
Last published <date>; exposes `<symbols>`. Accepts <inputs>, calls <Keto endpoint>, returns <shape>. Matches our `OryPermissionProvider` interface with no adapter needed.

### Consequences
- One less ~50 LOC of inline JWT+Keto plumbing to maintain.
- Couples us to the package's evolution; track its repo.
```

**If forking:**
```markdown
## ADR-001: `@ory/mcp-access-control` — fork
**Status:** Accepted
**Date:** 2026-05-13

### Decision
Fork `@ory/mcp-access-control` and vendor under `lib/auth/vendor/mcp-access-control/`.

### Context
<what we need that upstream lacks>; upstream last published <date>, appears unmaintained / lacks <feature>.

### Consequences
- We own the fork; track upstream for security fixes.
- ~50 LOC of vendored code in the repo.
```

**If inlining:**
```markdown
## ADR-001: `@ory/mcp-access-control` — inline
**Status:** Accepted
**Date:** 2026-05-13

### Decision
Do not depend on `@ory/mcp-access-control`. Write the equivalent ~50 LOC inline in `lib/auth/mcp-gate.ts` in Phase 5.

### Context
Package <does not exist | is unmaintained since <date> | does not match our claim shape>.

### Consequences
- One fewer external dependency.
- We write and own the JWT+Keto gate ourselves (~50 LOC).
```

- [ ] **Step 5: Clean up the probe directory**

Run:
```bash
rm -rf /tmp/mcp-probe
```

- [ ] **Step 6: Commit**

Run:
```bash
git add docs/decisions.md
git commit -m "docs(adr): fill in ADR-001 decision on @ory/mcp-access-control"
```

---

## Task 12: ADR-002 — probe `@skyfire-xyz/skyfire-seller-sdk-node`

**Files:**
- Modify: `docs/decisions.md`

- [ ] **Step 1: Check npm registry**

Run:
```bash
pnpm view @skyfire-xyz/skyfire-seller-sdk-node versions --json 2>&1 | tail -5
pnpm view @skyfire-xyz/skyfire-seller-sdk-node time --json 2>&1 | tail -10
pnpm view @skyfire-xyz/skyfire-seller-sdk-node 2>&1 | head -40
```

Expected: version list, timestamps, README snippet showing `validate()` and `chargeToken()` (or equivalent).

- [ ] **Step 2: Install into a scratch directory**

Run:
```bash
mkdir -p /tmp/skyfire-probe && cd /tmp/skyfire-probe && pnpm init -y && pnpm add @skyfire-xyz/skyfire-seller-sdk-node 2>&1 | tail -20
cat node_modules/@skyfire-xyz/skyfire-seller-sdk-node/package.json | head -40
```

Expected: installs cleanly; package.json shows `main`/`types`/`exports`.

- [ ] **Step 3: Inspect the SDK surface**

Run:
```bash
cd /tmp/skyfire-probe
cat node_modules/@skyfire-xyz/skyfire-seller-sdk-node/dist/*.d.ts 2>&1 | head -80
node -e "console.log(Object.keys(require('@skyfire-xyz/skyfire-seller-sdk-node')))"
```

Expected: see the exported types and function signatures for `validate(token)` and `chargeToken(token, amount)` (or whatever the actual names are).

- [ ] **Step 4: Decide and fill in ADR-002**

Update `docs/decisions.md` ADR-002 with one of the templates (analogous to ADR-001):

```markdown
## ADR-002: `@skyfire-xyz/skyfire-seller-sdk-node` — adopt
**Status:** Accepted
**Date:** 2026-05-13

### Decision
Adopt `@skyfire-xyz/skyfire-seller-sdk-node@<version>` for Phase 8 Skyfire integration.

### Context
Last published <date>; exposes `<actual function names>` matching our `SkyfireKyaPayProvider.verify()` and `.charge()` shape. JWKS rotation handled internally.

### Consequences
- Phase 8 integration is a straight adapter swap, no protocol implementation.
- Track package for security updates.
```

(Same fork/inline alternatives apply if the SDK isn't suitable.)

- [ ] **Step 5: Clean up**

Run:
```bash
rm -rf /tmp/skyfire-probe
```

- [ ] **Step 6: Commit**

Run:
```bash
git add docs/decisions.md
git commit -m "docs(adr): fill in ADR-002 decision on Skyfire seller SDK"
```

---

## Task 13: ADR-003 — `ory` CLI auth smoke test

**Files:**
- Modify: `docs/decisions.md`

- [ ] **Step 1: Verify CLI auth**

Run:
```bash
ory list projects --format json 2>&1 | head -40
```

Expected: JSON list of projects on this CLI's auth account. One of them must have ID `f5798507-b1c0-4168-9fd8-7eeb7a40d75c`.

If the project isn't listed: the CLI is authed against a different account or workspace. Run `ory auth` again with the correct account, or use `ory use project f5798507-b1c0-4168-9fd8-7eeb7a40d75c`.

- [ ] **Step 2: Run the scaffold apply script**

Run:
```bash
./scripts/ory-setup/apply.sh
```

Expected: prints the project's name/slug confirmation and "OK — apply.sh has nothing to apply yet". If it errors on `.env.local`, ensure that file exists from Task 8.

- [ ] **Step 3: Capture confirmation for ADR-003**

Run:
```bash
ory get project f5798507-b1c0-4168-9fd8-7eeb7a40d75c --format json | jq '{ id, slug, name }' 2>&1
```

Expected: prints `{ "id": "f5798507-...", "slug": "eager-dhawan-mio9f9ilcu", "name": "<project name>" }`. If `jq` isn't installed, use `head -10` or install jq via `brew install jq`.

- [ ] **Step 4: Fill in ADR-003**

Update `docs/decisions.md` ADR-003:
```markdown
## ADR-003: `ory` CLI authentication & target project
**Status:** Accepted
**Date:** 2026-05-13

### Decision
The `ory` CLI on the dev machine is authed against the account that owns project `f5798507-b1c0-4168-9fd8-7eeb7a40d75c`. Config-as-code in `scripts/ory-setup/` will use this CLI from Phase 2 onward.

### Context
Verified via `ory list projects` and `ory get project`. Project slug `eager-dhawan-mio9f9ilcu` matches the SDK URL in `.env.example`. `scripts/ory-setup/apply.sh` runs cleanly with no-op output.

### Consequences
- Phase 2/3/4/7 config changes ship as committed CLI invocations.
- CI does not need Ory creds — config-as-code is dev-machine-driven; CI uses `MemoryX` providers for tests.
```

- [ ] **Step 5: Commit**

Run:
```bash
git add docs/decisions.md
git commit -m "docs(adr): fill in ADR-003 confirming ory CLI auth"
```

---

## Task 14: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow file**

Write `.github/workflows/ci.yml`:
```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm exec tsc --noEmit

      - run: pnpm lint

      - run: pnpm test

      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
        env:
          CI: true
```

- [ ] **Step 2: Smoke-test locally that all four commands pass**

Run:
```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm test:e2e
```

Expected: all four exit 0.

- [ ] **Step 3: Commit**

Run:
```bash
git add .github/
git commit -m "ci: add lint + typecheck + vitest + playwright workflow"
```

---

## Task 15: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

Write `README.md`:
```markdown
# Merchant Agentic Demo

A reference integration showcasing **Ory** (identity, OAuth2, permissions) and **Skyfire KYAPay** (agent payments) on a generic merchant storefront. Built for Ory by Ory.

> Status: Phase 0 (bootstrap). Real Ory integration starts in Phase 2. See `docs/plans/2026-05-13-architecture-and-roadmap.md` for the full roadmap.

## Stack

Next.js 15 (App Router) · React 19 · Tailwind v4 · shadcn/ui · Drizzle + SQLite · Vitest · Playwright · Ory Network · Skyfire KYAPay (Phase 8+)

## Prereqs

- Node 22+
- pnpm 9+
- `ory` CLI installed and authed (`brew install ory/tap/cli && ory auth`)

## Setup

```bash
pnpm install
cp .env.example .env.local
# Edit .env.local — set ORY_ADMIN_API_KEY from the Ory console (Project Settings → API Keys)
pnpm db:generate
```

## Run

```bash
pnpm dev          # http://localhost:3000
pnpm test         # Vitest unit tests
pnpm test:e2e     # Playwright e2e tests
pnpm exec tsc --noEmit   # Typecheck
```

## Architecture & roadmap

- `docs/plans/2026-05-13-architecture-and-roadmap.md` — the master plan
- `docs/plans/phases/` — per-phase TDD implementation plans
- `docs/research/2026-05-13-research-summary.md` — research that informed the plan
- `docs/decisions.md` — ADRs

## Ory project

- Project ID: `f5798507-b1c0-4168-9fd8-7eeb7a40d75c`
- SDK URL: `https://eager-dhawan-mio9f9ilcu.projects.oryapis.com`
- Config-as-code: `scripts/ory-setup/`
```

- [ ] **Step 2: Commit**

Run:
```bash
git add README.md
git commit -m "docs: add README"
```

---

## Final verification

- [ ] **Step 1: Run the full local CI sequence**

Run:
```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm test:e2e
```

Expected: all four exit 0.

- [ ] **Step 2: Verify the repo tree matches the File Structure section**

Run:
```bash
git ls-files | sort
```

Expected: prints a tree that matches the "File Structure" section at the top of this plan (modulo auto-generated files like `pnpm-lock.yaml` and migration timestamps).

- [ ] **Step 3: Verify the three ADRs are filled in**

Run:
```bash
grep -c "^## ADR-" docs/decisions.md
grep -c "Status:.*Accepted" docs/decisions.md
```

Expected: first command prints `3`. Second prints `3`. (All ADRs decided.)

- [ ] **Step 4: Verify the Ory CLI smoke test still passes**

Run:
```bash
./scripts/ory-setup/apply.sh
```

Expected: prints the project confirmation line and the no-op message.

- [ ] **Step 5: Final commit if anything moved**

Run:
```bash
git status
# If clean: Phase 0 is done.
# If dirty: review, stage, commit with an appropriate message.
```

---

## Phase 0 complete

End state confirms:
- A Next.js 15 + Tailwind + shadcn skeleton runs and serves a styled landing page.
- One Vitest test and one Playwright test pass and are wired into GitHub Actions CI.
- `.env.example` carries the non-secret Ory project values; `.env.local` is gitignored.
- `scripts/ory-setup/` exists with a working `apply.sh` placeholder that confirms CLI auth.
- Three ADRs in `docs/decisions.md` are filled in with concrete decisions.
- `ory list projects` shows the demo's project; `apply.sh` runs cleanly.

**Next:** Phase 1 — Storefront shell with anonymous browsing and a cookie-backed cart. See [`phase-1-storefront-shell.md`](./phase-1-storefront-shell.md) (to be written when Phase 0 is complete).
