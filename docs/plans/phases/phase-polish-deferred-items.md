# Polish Phase — Deferred Items from Phases 1–7

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address eight deferred items accumulated across Phases 1–7 that improve demo quality, fix real bugs, and reduce developer friction. None unblock Phase 8 (real Skyfire) but each is worth doing before live demos.

**Architecture:** Eight independent tasks listed roughly in order of "demo ROI first." No cross-task dependencies.

**Parent plan:** [`docs/plans/2026-05-13-architecture-and-roadmap.md`](../2026-05-13-architecture-and-roadmap.md)

**Pre-conditions:**
- Phase 7 complete (97 commits, 87 unit + 11 e2e/gated).
- Real Skyfire account NOT required (Phase 8).

**Standing preamble** for every task:
```bash
eval "$(fnm env --use-on-cd)"
cd /Users/jeff.hickman/Code/demos/merchant-agentic-demo
git branch --show-current  # must print: main
```

Stay on `main`. **Never** detach HEAD. **Never** write to `.claude/settings.json`. **Never** read `.env.local`. If `git commit` is blocked, report BLOCKED.

---

## File Structure (created/modified by this plan)

```
.
├── package.json                              (modified — postinstall hook)
├── scripts/
│   └── rebuild-native-if-needed.mjs          (new — guarded better-sqlite3 rebuild)
├── db/
│   ├── schema.ts                             (modified — kyaClaimsJson on orders)
│   ├── seed-data.ts                          (modified — curated image URLs)
│   └── migrations/                           (new migration for kyaClaimsJson)
├── lib/
│   ├── orders.ts                             (modified — accepts kyaClaimsJson)
│   ├── agent/validate-and-charge.ts          (modified — persists decoded claims)
│   ├── auth/ory/sessions.ts                  (modified — real revoke via admin)
│   ├── format.ts                             (verify helper exists or add)
│   └── oauth/refresh.ts                      (new — refresh helper)
├── app/
│   ├── api/mcp/route.ts                      (modified — persistent cart + better tool descriptions)
│   ├── api/oauth/refresh/route.ts            (new — refresh endpoint)
│   └── orders/[id]/page.tsx                  (modified — uses MandatePanel)
├── components/
│   └── mandate-panel.tsx                     (new — decoded claims display)
└── e2e/
    └── fixtures/test-identity.ts             (modified — cleans up agents owned by test user)
```

---

## Task 1 (PP.1): Auto-rebuild `better-sqlite3` via postinstall

The native binding gets out of sync whenever fnm switches Node ABI. Manual `pnpm rebuild better-sqlite3` has bitten every phase. Fix: a `postinstall` script that detects and rebuilds only when needed.

**Files:**
- Create: `scripts/rebuild-native-if-needed.mjs`
- Modify: `package.json` (postinstall)

**Step 1: Detection script**

`scripts/rebuild-native-if-needed.mjs`:

```js
#!/usr/bin/env node
// Conditionally rebuilds better-sqlite3 if the loaded native binding's ABI doesn't
// match the current Node runtime. Uses execFileSync (no shell) to avoid injection risk
// since arguments are fixed string literals.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function tryLoad() {
  try {
    const Database = require("better-sqlite3");
    new Database(":memory:").close();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err && err.message ? err.message : String(err) };
  }
}

const result = tryLoad();
if (result.ok) {
  // Silent on the happy path.
  process.exit(0);
}

const mismatch = /NODE_MODULE_VERSION|invalid ELF header|was compiled against a different/i.test(
  result.message,
);
if (!mismatch) {
  console.error("[postinstall] better-sqlite3 load failure unrelated to ABI:", result.message);
  process.exit(0);
}

console.log("[postinstall] better-sqlite3 ABI mismatch — rebuilding...");
try {
  // Fixed args; no user input; safe.
  execFileSync("pnpm", ["rebuild", "better-sqlite3"], { stdio: "inherit" });
  console.log("[postinstall] rebuild OK");
} catch (err) {
  console.error("[postinstall] rebuild failed:", err);
  process.exit(1);
}
```

**Step 2: Wire into package.json**

Add to `scripts`:

```json
"postinstall": "node scripts/rebuild-native-if-needed.mjs"
```

If a `postinstall` already exists (e.g., from create-next-app or shadcn), chain it: `"postinstall": "node scripts/rebuild-native-if-needed.mjs && <existing>"`.

**Step 3: Verify**

```bash
pnpm install --frozen-lockfile 2>&1 | tail -5
pnpm test 2>&1 | tail -3
```

Expected: install runs the postinstall, sqlite is happy (or rebuilds + is then happy), 87 tests pass.

**Step 4: Commit**

```bash
git add scripts/rebuild-native-if-needed.mjs package.json
git commit -m "chore: postinstall auto-rebuilds better-sqlite3 on ABI mismatch"
```

If blocked, report BLOCKED.

---

## Task 2 (PP.2): Test-identity cleanup in e2e fixtures

Across runs, Playwright test users + their agents pile up on the live Ory project. Extend the existing `testUser` fixture so its teardown also deletes any Ory identity whose `traits.owner_identity_id` matches the test user.

**Files:**
- Modify: `e2e/fixtures/test-identity.ts`

**Step 1: Read current fixture**

The fixture currently creates a Kratos identity (the "test user") and deletes it on teardown. Locate that teardown block.

**Step 2: Extend teardown to also delete owned agents**

Before the existing `identityAdmin.deleteIdentity({ id })` call, add:

```ts
try {
  const allIdentities = await identityAdmin.listIdentities({ pageSize: 250 });
  for (const i of allIdentities.data) {
    const traits = i.traits as { owner_identity_id?: string } | undefined;
    if (traits?.owner_identity_id === id) {
      try {
        await identityAdmin.deleteIdentity({ id: i.id });
      } catch (innerErr) {
        console.warn(`Cleanup: could not delete agent ${i.id}:`, (innerErr as Error).message);
      }
    }
  }
} catch (err) {
  console.warn(`Cleanup: agent list failed:`, (err as Error).message);
}
```

Wrap the existing test-user delete in try/catch too, so cleanup failures don't break the fixture.

**Step 3: Verify**

Run the agents.spec.ts e2e and check it still passes:

```bash
pnpm test:e2e --grep "agents" 2>&1 | tail -10
```

If working, the test user + its agents are deleted at teardown.

**Step 4: Commit**

```bash
git add e2e/fixtures/test-identity.ts
git commit -m "test(e2e): fixture cleans up agents owned by the test user"
```

---

## Task 3 (PP.3): Richer Mandate Panel with decoded KYA claims

Currently order detail shows `chargeId` + `paymentTokenJti` only. Persist the full decoded claims at validate-and-charge time and render them in a richer panel.

**Files:**
- Modify: `db/schema.ts` (add `kyaClaimsJson` column to `orders`)
- Generate: new migration
- Modify: `lib/orders.ts` (createOrderFromCart accepts `kyaClaimsJson`)
- Modify: `lib/agent/validate-and-charge.ts` (persists decoded claims)
- Create: `components/mandate-panel.tsx`
- Modify: `app/orders/[id]/page.tsx` (uses MandatePanel)

**Step 1: Schema migration**

Add to the `orders` table:

```ts
kyaClaimsJson: text("kya_claims_json"),
```

Generate + apply:

```bash
pnpm db:generate
pnpm db:migrate
```

**Step 2: Order persistence**

In `lib/orders.ts`, extend `createOrderFromCart` `opts` to accept `kyaClaimsJson?: string` and insert it.

In `lib/agent/validate-and-charge.ts`, after the KYA verify succeeds, serialize claims and pass through:

```ts
const orderId = await createOrderFromCart(deps.db, ctx.cartId, owner.id, "kyapay", {
  permissions: deps.permission,
  paymentTokenJti: claims.jti,
  skyfireChargeId: chargeResult.chargeId,
  kyaClaimsJson: JSON.stringify(claims),
});
```

**Step 3: MandatePanel component**

`components/mandate-panel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { formatCents } from "@/lib/format";

interface KyaClaims {
  iss: string;
  aud: string;
  jti: string;
  iat: number;
  exp: number;
  ssi: string;
  amount: number;
  cur: string;
  hid: { email: string };
  aid: { id: string; name: string };
}

export function MandatePanel({
  claims,
  chargeId,
}: {
  claims: KyaClaims | null;
  chargeId: string | null;
}) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <section className="rounded-lg border-2 border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          Mandate (KYA Pay)
        </h2>
        {claims && (
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {showRaw ? "Show summary" : "Show raw claims"}
          </button>
        )}
      </div>

      {!claims ? (
        <div className="text-sm text-muted-foreground">
          Claims not persisted for this order (placed before Phase Polish).
          {chargeId && (
            <>
              {" "}Skyfire charge: <span className="font-mono text-xs">{chargeId}</span>
            </>
          )}
        </div>
      ) : showRaw ? (
        <pre className="overflow-x-auto rounded bg-background p-3 text-xs font-mono">
          {JSON.stringify(claims, null, 2)}
        </pre>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Agent</dt>
          <dd className="font-medium">
            {claims.aid.name}{" "}
            <span className="font-mono text-xs text-muted-foreground">
              ({claims.aid.id.slice(0, 12)}…)
            </span>
          </dd>

          <dt className="text-muted-foreground">Authorized by</dt>
          <dd className="font-medium">{claims.hid.email}</dd>

          <dt className="text-muted-foreground">Amount</dt>
          <dd className="font-medium">
            {formatCents(claims.amount)} {claims.cur}
          </dd>

          <dt className="text-muted-foreground">Issued by</dt>
          <dd className="font-mono text-xs">{claims.iss}</dd>

          <dt className="text-muted-foreground">JWT id</dt>
          <dd className="font-mono text-xs">{claims.jti}</dd>

          <dt className="text-muted-foreground">Expires</dt>
          <dd className="text-xs">{new Date(claims.exp * 1000).toLocaleString()}</dd>

          {chargeId && (
            <>
              <dt className="text-muted-foreground">Skyfire charge</dt>
              <dd className="font-mono text-xs">{chargeId}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}
```

Confirm `formatCents` exists in `lib/format.ts` (it's used elsewhere in the app). If not, add it:

```ts
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
```

**Step 4: Wire into order detail page**

Replace the existing simple mandate section in `app/orders/[id]/page.tsx`:

```tsx
{order.paymentMethod === "kyapay" && (
  <MandatePanel
    claims={order.kyaClaimsJson ? JSON.parse(order.kyaClaimsJson) : null}
    chargeId={order.skyfireChargeId}
  />
)}
```

**Step 5: Verify**

```bash
pnpm typecheck
pnpm lint
pnpm test 2>&1 | tail -3
```

Manual: run a full demo flow (mint kya → bootstrap → MCP → submit). The new order should have `kyaClaimsJson` populated; the order detail page shows the rich panel.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(orders): persist decoded KYA claims + richer Mandate Panel"
```

---

## Task 4 (PP.4): Curated product images

Replace Lorem Picsum (random per-load images) with stable curated URLs.

**Files:**
- Modify: `db/seed-data.ts` (and wherever the image-url helper lives)

**Approach (pick one):**

**Option A (preferred):** Inline curated Unsplash photo IDs. Spend ~15 min picking ~30 photos that vaguely match each product slug. Format: `https://images.unsplash.com/photo-<id>?w=800&h=800&fit=crop`. Store as a `slug → photoId` map in `db/seed-data.ts`.

**Option B (fallback):** Use deterministic-per-slug placeholder: `https://placehold.co/800x800/059669/ffffff?text=<slug>`. Less attractive but zero risk of broken/unavailable photos.

**Option C (also acceptable):** Commit small JPGs to `public/products/<slug>.jpg`. More effort but offline-safe.

Pick Option A unless you don't want to spend the time on photo curation; then Option B.

**Step 1: Update seed**

In `db/seed-data.ts`, replace the random-picsum helper with a `slug → URL` map (or the chosen alternative). Include a comment naming the source so future-you can extend it.

**Step 2: Reseed**

```bash
pnpm db:seed
```

**Step 3: Visual verify**

`pnpm dev` → visit `/` → confirm products look on-theme.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(catalog): curated product images replace lorem picsum"
```

---

## Task 5 (PP.5): Persistent agent carts across MCP calls

`/api/mcp/route.ts` currently creates a fresh cart per request, so `addToCart` is forgotten between calls. Use a deterministic cart ID per agent.

**Files:**
- Modify: `app/api/mcp/route.ts`

**Approach:** Use `agent-cart-${ctx.agentId}` as the cart id (text PK). Look up first; create if missing. No schema migration needed because `carts.id` is `text` and `userId` is nullable.

**Step 1: Modify the cart-resolution logic**

In `app/api/mcp/route.ts`, find where the request handler creates a cart for each call. Replace:

```ts
const cartId = await createCart(getDb());
```

with:

```ts
const cartId = `agent-cart-${auth.agentId}`;
const existing = await getDb().query.carts.findFirst({ where: eq(carts.id, cartId) });
if (!existing) {
  await getDb().insert(carts).values({ id: cartId, userId: auth.ownerUserId });
}
```

Add `eq` and `carts` imports as needed.

When the order is submitted, `createOrderFromCart` already clears the cart items, so the agent's next request finds an empty cart. That's the right behavior — they don't accidentally re-submit old items.

**Step 2: Verify**

```bash
pnpm dev &
# In another terminal, run two MCP addToCart calls with the same agent token,
# then viewCart. Expect 2 items total.
```

`scripts/demo-agent-mcp.ts` only calls addToCart once per run; either expand it temporarily or write a one-off curl smoke script. Don't commit the smoke script — it's a verification artifact, not demo code.

**Step 3: Commit**

```bash
git add app/api/mcp/route.ts
git commit -m "feat(mcp): persistent cart per agent across requests"
```

---

## Task 6 (PP.6): Better MCP tool descriptions

Rewrite the `TOOLS` array descriptions in `/api/mcp/route.ts` for LLM consumption — describe inputs, outputs, expected behavior, error modes.

**Files:**
- Modify: `app/api/mcp/route.ts`

**Step 1: Replace the TOOLS array**

```ts
const TOOLS = [
  {
    name: "searchProducts",
    description:
      "List or filter products from the merchant catalog. Returns a JSON array of products with fields: id, slug, name, priceCents, category. Optional 'category' parameter filters by category slug (apparel, footwear, packs, food, accessories). With no parameter, returns all products. Useful for browsing the catalog before adding items to cart.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description:
            "Category slug filter (optional). Valid values: apparel, footwear, packs, food, accessories.",
        },
      },
    },
  },
  {
    name: "getProduct",
    description:
      "Fetch full details for a single product by its slug. Returns the product's full record including description, image URL, and category. Returns isError=true if no product matches the slug.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The product's URL slug (e.g., 'merino-tee')" },
      },
      required: ["slug"],
    },
  },
  {
    name: "addToCart",
    description:
      "Add a product to the agent's cart. The cart persists across MCP calls within the same agent's session. Returns { ok: true, items: <count> } on success. If the productId doesn't exist, the call fails.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Product id from searchProducts or getProduct" },
        quantity: { type: "number", description: "Positive integer quantity to add" },
      },
      required: ["productId", "quantity"],
    },
  },
  {
    name: "viewCart",
    description:
      "Inspect the current cart contents and total. Returns { items: [{ name, quantity, priceCents }], totalCents }. Call this before submitCart to determine the exact amount to authorize via KYA token.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "submitCart",
    description:
      "Submit the cart for payment via a KYAPay token. The token's amount MUST equal the cart's totalCents (call viewCart first to determine this). On success returns { status: 200, body: { orderId, chargeId, settledAt } }. Failure modes include: kya_invalid (signature/expiry/audience), amount_mismatch, hid_mismatch (token's user mismatch), aid_mismatch (token's agent mismatch), spend_cap_exceeded, charge_failed (replay or settlement error).",
    inputSchema: {
      type: "object",
      properties: {
        kyaToken: {
          type: "string",
          description:
            "A JWT-encoded KYAPay token signed by Skyfire (or the mock Skyfire issuer). Mint via the mintKyaToken helper with the cart's totalCents as the amount.",
        },
      },
      required: ["kyaToken"],
    },
  },
];
```

**Step 2: Verify**

```bash
pnpm typecheck
pnpm lint
pnpm test 2>&1 | tail -3
```

**Step 3: Commit**

```bash
git add app/api/mcp/route.ts
git commit -m "feat(mcp): expanded tool descriptions for LLM-driven agents"
```

---

## Task 7 (PP.7): `OrySessionProvider.revoke()` real implementation

Currently `revoke()` in `lib/auth/ory/sessions.ts` is a no-op. Use Kratos's admin API to disable a session.

**Files:**
- Modify: `lib/auth/ory/sessions.ts`

**Step 1: Confirm the SDK method name**

```bash
grep -i "session" node_modules/@ory/client/api/identityApi.d.ts | head -20
```

The method is named `disableSession` (or in some versions `revokeIdentitySessions` — confirm which is exported).

**Step 2: Implement**

Replace the `revoke` method body:

```ts
async revoke(sessionId: string): Promise<void> {
  const apiKey = process.env.ORY_ADMIN_API_KEY ?? process.env.ORY_API_KEY;
  if (!apiKey || !process.env.ORY_SDK_URL) {
    // Not configured for admin operations; nothing to do.
    return;
  }
  const { Configuration, IdentityApi } = await import("@ory/client");
  const admin = new IdentityApi(
    new Configuration({
      basePath: process.env.ORY_SDK_URL,
      baseOptions: { headers: { Authorization: `Bearer ${apiKey}` } },
    }),
  );
  try {
    await admin.disableSession({ id: sessionId });
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return; // already revoked or never existed
    throw err;
  }
}
```

If the SDK method has a different name in the installed version, adapt the call site.

**Step 3: Verify**

Real testing requires a live session. Verify typecheck + lint clean:

```bash
pnpm typecheck
pnpm lint
```

**Step 4: Commit**

```bash
git add lib/auth/ory/sessions.ts
git commit -m "feat(auth): OrySessionProvider.revoke real impl via Kratos admin"
```

---

## Task 8 (PP.8): refresh_token flow for delegated agents

Bootstrap currently returns a 5-min access token. Agents must re-bootstrap on expiry, which burns a KYA. Wire refresh_token support.

**Files:**
- Create: `lib/oauth/refresh.ts`
- Create: `app/api/oauth/refresh/route.ts`
- Verify: `lib/oauth/bootstrap.ts` already requests `offline_access` (it does, per Phase 7)

**Step 1: Verify the bootstrap response includes a refresh_token**

The bootstrap already requests `offline_access openid` and the agent client has `refresh_token` in its `grant_types` (per Phase 7 P7.5). Confirm by inspecting `lib/oauth/bootstrap.ts` — the `BootstrapResult` interface should already have `refresh_token?: string`. If not, add it and pass it through.

**Step 2: Refresh helper**

`lib/oauth/refresh.ts`:

```ts
export interface RefreshInput {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

export interface RefreshResult {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
}

export async function refreshDelegatedToken(input: RefreshInput): Promise<RefreshResult> {
  const sdkUrl = process.env.ORY_SDK_URL;
  if (!sdkUrl) throw new Error("ORY_SDK_URL not configured");
  const auth = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64");
  const res = await fetch(`${sdkUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    }).toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Refresh failed: ${JSON.stringify(data)}`);
  }
  return data as RefreshResult;
}
```

**Step 3: Endpoint**

`app/api/oauth/refresh/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { refreshDelegatedToken } from "@/lib/oauth/refresh";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const refreshToken = body?.refresh_token;
  if (typeof refreshToken !== "string") {
    return NextResponse.json({ error: "missing_refresh_token" }, { status: 400 });
  }
  const clientId = process.env.DEMO_AGENT_CLIENT_ID;
  const clientSecret = process.env.DEMO_AGENT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "demo_client_not_configured" }, { status: 500 });
  }
  try {
    const result = await refreshDelegatedToken({ refreshToken, clientId, clientSecret });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "refresh_failed", message: (err as Error).message },
      { status: 502 },
    );
  }
}
```

**Step 4: Unit test the helper**

Create `lib/oauth/__tests__/refresh.test.ts` with a happy-path test that stubs `fetch`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { refreshDelegatedToken } from "../refresh";

describe("refreshDelegatedToken", () => {
  beforeEach(() => {
    process.env.ORY_SDK_URL = "https://example.test";
    vi.restoreAllMocks();
  });

  it("posts grant_type=refresh_token with Basic auth and returns the parsed body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "at",
          refresh_token: "rt2",
          expires_in: 300,
          scope: "openid offline_access",
          token_type: "Bearer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await refreshDelegatedToken({
      refreshToken: "rt1",
      clientId: "cid",
      clientSecret: "secret",
    });

    expect(result.access_token).toBe("at");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/oauth2/token");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)?.Authorization).toMatch(/^Basic /);
    expect(init?.body).toContain("grant_type=refresh_token");
    expect(init?.body).toContain("refresh_token=rt1");
  });

  it("throws on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );

    await expect(
      refreshDelegatedToken({ refreshToken: "rt", clientId: "c", clientSecret: "s" }),
    ).rejects.toThrow(/invalid_grant/);
  });
});
```

**Step 5: Verify**

```bash
pnpm typecheck
pnpm lint
pnpm test 2>&1 | tail -5
```

Expected: 87 + 2 = 89 unit tests.

**Step 6: Commit**

```bash
git add lib/oauth/refresh.ts lib/oauth/__tests__/refresh.test.ts app/api/oauth/refresh/route.ts
git commit -m "feat(oauth): refresh_token endpoint for delegated agent tokens"
```

---

## Final verification

After all 8 tasks:

```bash
pnpm install --frozen-lockfile  # postinstall should detect-and-rebuild as needed
pnpm typecheck && echo "tsc OK"
pnpm lint && echo "lint OK"
pnpm test 2>&1 | tail -5
pnpm test:e2e --retries=1 2>&1 | tail -10
./scripts/ory-setup/apply.sh 2>&1 | tail -5
git log --oneline | head -20
git rev-list --count HEAD  # expect ~105–107
```

---

## Polish phase complete

End state:
- `pnpm install` auto-rebuilds native bindings on Node ABI shift.
- E2E test cleanup deletes test users + their agents from Ory.
- Order detail pages show a full Mandate panel with decoded KYA claims (summary ↔ raw JSON toggle).
- Catalog uses curated product images.
- MCP agents have a persistent cart across requests.
- MCP tool descriptions are LLM-friendly.
- `OrySessionProvider.revoke()` actually revokes sessions via Kratos admin.
- Delegated agent tokens can refresh without re-bootstrapping a KYA.

**Next:** Phase 8 — Real Skyfire. Requires the Skyfire seller account. When ready, swap `MockKyaPayProvider` for `SkyfireKyaPayProvider` via the env-var DI switch.
