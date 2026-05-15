# Phase 5 — Agent Surfaces (MCP + HTML+header)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose two agent ingress surfaces on the merchant. (1) A **Model Context Protocol (MCP) server** at `/api/mcp` with five tools: `searchProducts`, `getProduct`, `addToCart`, `viewCart`, `submitCart`. (2) The existing **HTML checkout** route also accepts an `X-KYA-Token` header (Bose-style). Both surfaces converge on a single `validateAndCharge(kya, cart, ctx)` core that, in Phase 5, **returns 402** with `WWW-Authenticate: KYAPay realm=...` — real KYA verification + Skyfire settlement arrives in Phase 6. Two demo agent scripts (an MCP client and a Playwright browser script) exercise both paths.

**Architecture:** A new `lib/auth/agent-gate.ts` validates a Hydra-issued bearer token (from `client_credentials` grants minted against the OAuth2 client created in Phase 4), uses JOSE to verify against Hydra's JWKS, and looks up the agent in our local DB by `hydra_client_id`. Revoked agents are rejected. The MCP server uses the official `@modelcontextprotocol/sdk` StreamableHTTP transport. Tools call existing catalog/cart functions; `submitCart` calls `validateAndCharge()` which returns a stable 402 in Phase 5. The HTML checkout route grows a branch: if `X-KYA-Token` is present, it routes through `validateAndCharge()` instead of the user-session checkout path.

**Tech Stack:** new — `@modelcontextprotocol/sdk` (MCP server + client), `jose` (Hydra JWT validation). No agent-side LLM SDK yet — the demo agent scripts make direct MCP tool calls. Phase 6 may add Vercel AI SDK if the demo wants an LLM driving things.

**Parent plan:** [`docs/plans/2026-05-13-architecture-and-roadmap.md`](../2026-05-13-architecture-and-roadmap.md)

**Pre-conditions:**
- Phase 4 complete (67 commits, 58 unit + 7 e2e passing).
- Agent registration works end-to-end (a registered agent has a Kratos identity, Hydra OAuth2 client, Keto tuple, and local DB row with `hydra_client_id`).

**Carry-over reminders:**
- Hosted Ory Keto enforces only direct relation tuples (no computed permits).
- Schema-ID quirk and keto-client auth bug already handled in Phase 2/3.
- Never write to `.claude/settings.json`. If `git commit` is blocked, report BLOCKED.

**Standing preamble** for every task:
```bash
eval "$(fnm env --use-on-cd)"
cd /Users/jeff.hickman/Code/demos/merchant-agentic-demo
git branch --show-current  # must print: main
```

Stay on `main`. Never detach HEAD.

---

## File Structure (created/modified by this plan)

```
.
├── lib/
│   ├── auth/
│   │   ├── agent-gate.ts                 (new — JWT verify + agent lookup)
│   │   └── __tests__/
│   │       └── agent-gate.test.ts        (new — TDD)
│   └── agent/
│       ├── validate-and-charge.ts        (new — 402 stub)
│       └── __tests__/
│           └── validate-and-charge.test.ts (new)
├── app/
│   ├── api/
│   │   ├── checkout/route.ts             (modified — dual-path: header vs session)
│   │   └── mcp/route.ts                  (new — MCP StreamableHTTP server)
├── scripts/
│   ├── demo-agent-mcp.ts                 (new — MCP client demo)
│   ├── demo-agent-browser.ts             (new — Playwright Bose-style demo)
│   └── mint-agent-token.ts               (new — helper to client_credentials a token)
├── e2e/
│   └── agent-surfaces.spec.ts            (new — exercises both paths)
├── package.json                          (modified — new deps + scripts)
└── README.md                             (modified — Phase 5 section)
```

---

## Task 1: Install MCP SDK + jose, add scripts

**Files:**
- Modify: `package.json`
- Possibly modify: `pnpm-workspace.yaml`

**Step 1: Install runtime deps**

```bash
pnpm add @modelcontextprotocol/sdk jose
```

If pnpm 11 prompts for build approvals (unlikely — both are pure JS), update `pnpm-workspace.yaml`.

**Step 2: Add demo scripts to package.json**

In `package.json` `scripts`, add:

```json
"demo:agent-mcp": "tsx scripts/demo-agent-mcp.ts",
"demo:agent-browser": "tsx scripts/demo-agent-browser.ts",
"demo:mint-agent-token": "tsx scripts/mint-agent-token.ts"
```

Preserve all other scripts.

**Step 3: Typecheck**

```bash
pnpm typecheck
```

Exit 0.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(agents): install @modelcontextprotocol/sdk + jose for phase 5"
```

---

## Task 2: Agent auth gate

**Files:**
- Create: `lib/auth/agent-gate.ts`
- Create: `lib/auth/__tests__/agent-gate.test.ts`

The gate inspects a bearer token. Three outcomes:
- **Valid**: returns `{ ok: true, agentId, hydraClientId, ownerUserId }`
- **Invalid**: returns `{ ok: false, status: 401, code: 'invalid_token', message }`
- **Forbidden** (revoked, etc.): returns `{ ok: false, status: 403, code: 'agent_revoked', message }`

**Step 1: Write tests (RED)**

`lib/auth/__tests__/agent-gate.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { freshTestDb } from "@/lib/__tests__/helpers";
import { agents as agentsTable } from "@/db/schema";
import { verifyAgentBearer } from "@/lib/auth/agent-gate";
import { eq } from "drizzle-orm";

interface FakeJwtVerifier {
  decode(token: string): { client_id?: string; sub?: string };
}

const fakeVerifier: FakeJwtVerifier = {
  decode(token: string) {
    if (token === "good-token-hydra-client-1") return { client_id: "hydra-client-1" };
    if (token === "good-token-hydra-client-revoked") return { client_id: "hydra-client-revoked" };
    if (token === "good-token-unknown-client") return { client_id: "hydra-client-unknown" };
    return {};
  },
};

describe("verifyAgentBearer", () => {
  let testDb: ReturnType<typeof freshTestDb>;

  beforeEach(() => {
    testDb = freshTestDb();
    testDb.db.insert(agentsTable).values([
      {
        id: "agent-1",
        displayName: "A1",
        ownerUserId: "owner-1",
        agentType: "shopping",
        hydraClientId: "hydra-client-1",
      },
      {
        id: "agent-revoked",
        displayName: "R",
        ownerUserId: "owner-1",
        agentType: "shopping",
        hydraClientId: "hydra-client-revoked",
        revokedAt: new Date("2026-01-01"),
      },
    ]).run();
  });

  it("returns 401 when no bearer header", async () => {
    const result = await verifyAgentBearer(testDb.db, null, { verifier: fakeVerifier });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 401 when token has no client_id claim", async () => {
    const result = await verifyAgentBearer(testDb.db, "Bearer invalid-token", { verifier: fakeVerifier });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 401 when client_id is not a known agent", async () => {
    const result = await verifyAgentBearer(testDb.db, "Bearer good-token-unknown-client", { verifier: fakeVerifier });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 403 when the agent is revoked", async () => {
    const result = await verifyAgentBearer(testDb.db, "Bearer good-token-hydra-client-revoked", { verifier: fakeVerifier });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("returns ok with agent details for a valid live agent", async () => {
    const result = await verifyAgentBearer(testDb.db, "Bearer good-token-hydra-client-1", { verifier: fakeVerifier });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agentId).toBe("agent-1");
      expect(result.hydraClientId).toBe("hydra-client-1");
      expect(result.ownerUserId).toBe("owner-1");
    }
  });
});
```

Run `pnpm test 2>&1 | tail -10` — must fail on missing module.

**Step 2: Implement `lib/auth/agent-gate.ts`**

```ts
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { agents } from "@/db/schema";

export type AgentGateResult =
  | { ok: true; agentId: string; hydraClientId: string; ownerUserId: string }
  | { ok: false; status: number; code: string; message: string };

interface TokenVerifier {
  decode(token: string): { client_id?: string; sub?: string };
}

// Production verifier validates the JWT signature against Hydra's JWKS via jose.
// Build it lazily so tests can inject a fake.
let _prodVerifier: TokenVerifier | null = null;
async function prodVerifier(): Promise<TokenVerifier> {
  if (_prodVerifier) return _prodVerifier;
  const baseUrl = process.env.ORY_SDK_URL;
  if (!baseUrl) throw new Error("ORY_SDK_URL is not set");
  const { jwtVerify, createRemoteJWKSet } = await import("jose");
  const jwks = createRemoteJWKSet(new URL(`${baseUrl}/.well-known/jwks.json`));
  _prodVerifier = {
    decode(token: string) {
      // Note: this is sync here for the test fake; the real impl returns a promise.
      // We adapt by exposing an async path; see verifyAgentBearer below.
      void token;
      return {};
    },
  };
  // The actual jose verifier is async-only — we wrap it in a separate path:
  _prodVerifierAsync = async (token: string) => {
    const { payload } = await jwtVerify(token, jwks);
    return { client_id: (payload as { client_id?: string }).client_id, sub: payload.sub };
  };
  return _prodVerifier;
}
let _prodVerifierAsync: ((t: string) => Promise<{ client_id?: string; sub?: string }>) | null = null;

function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

export async function verifyAgentBearer(
  db: DB,
  authHeader: string | null,
  opts?: { verifier?: TokenVerifier },
): Promise<AgentGateResult> {
  const token = parseBearer(authHeader);
  if (!token) {
    return { ok: false, status: 401, code: "missing_bearer", message: "Missing or malformed Authorization header" };
  }

  let claims: { client_id?: string; sub?: string };
  if (opts?.verifier) {
    claims = opts.verifier.decode(token);
  } else {
    // Lazy-init the prod verifier; falls through to async signature check.
    await prodVerifier();
    if (!_prodVerifierAsync) {
      return { ok: false, status: 500, code: "verifier_unavailable", message: "JWT verifier not initialized" };
    }
    try {
      claims = await _prodVerifierAsync(token);
    } catch (err) {
      return { ok: false, status: 401, code: "invalid_token", message: (err as Error).message };
    }
  }

  const clientId = claims.client_id ?? claims.sub;
  if (!clientId) {
    return { ok: false, status: 401, code: "missing_client_id", message: "Token has no client_id" };
  }

  const row = await db.query.agents.findFirst({ where: eq(agents.hydraClientId, clientId) });
  if (!row) {
    return { ok: false, status: 401, code: "unknown_agent", message: "No agent registered for that client" };
  }
  if (row.revokedAt) {
    return { ok: false, status: 403, code: "agent_revoked", message: "Agent has been revoked" };
  }
  return { ok: true, agentId: row.id, hydraClientId: row.hydraClientId, ownerUserId: row.ownerUserId };
}
```

**The injected `TokenVerifier` interface is sync** for testing simplicity. The production path uses `jose.jwtVerify` (async) via a separate `_prodVerifierAsync` ref. The structure is a bit awkward but keeps the tests deterministic. Alternative: make `TokenVerifier.decode` async always. Pick whichever is cleaner.

Actually, simplify: make the verifier's `decode` return a `Promise` always.

Re-author both the test and the impl to use:

```ts
interface TokenVerifier {
  decode(token: string): Promise<{ client_id?: string; sub?: string }>;
}
```

In tests:
```ts
const fakeVerifier: TokenVerifier = {
  async decode(token: string) { ... }
};
```

Adjust the implementation accordingly. Cleaner.

**Step 3: Run tests — GREEN**

`pnpm test 2>&1 | tail -3` — 58 + 5 = 63 tests passing.

**Step 4: Commit**

```bash
pnpm typecheck
pnpm lint
git add -A
git commit -m "feat(agents): bearer token verify + agent lookup gate"
```

If blocked, report BLOCKED.

---

## Task 3: validateAndCharge stub

**Files:**
- Create: `lib/agent/validate-and-charge.ts`
- Create: `lib/agent/__tests__/validate-and-charge.test.ts`

**Step 1: Tests (RED)**

`lib/agent/__tests__/validate-and-charge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateAndCharge } from "@/lib/agent/validate-and-charge";

describe("validateAndCharge (Phase 5 stub)", () => {
  it("returns 402 with WWW-Authenticate header", async () => {
    const result = await validateAndCharge({
      kyaJwt: "any.token.value",
      cart: { items: [], totalCents: 0 },
      ctx: { agentId: "agent-1", ownerUserId: "owner-1" },
    });
    expect(result.status).toBe(402);
    expect(result.headers["WWW-Authenticate"]).toMatch(/KYAPay/);
    expect(result.body.error).toBe("kya_validation_not_implemented");
  });

  it("includes phase + next-phase metadata for debugging", async () => {
    const result = await validateAndCharge({
      kyaJwt: "x",
      cart: { items: [{ productId: "p1", quantity: 1, priceCents: 100 }], totalCents: 100 },
      ctx: { agentId: "a", ownerUserId: "o" },
    });
    expect(result.body.phase).toBe(5);
    expect(result.body.implementsIn).toBe("Phase 6");
  });
});
```

Run, fail.

**Step 2: Implement**

`lib/agent/validate-and-charge.ts`:

```ts
export interface CartSnapshot {
  items: { productId: string; quantity: number; priceCents: number }[];
  totalCents: number;
}

export interface ValidateAndChargeArgs {
  kyaJwt: string;
  cart: CartSnapshot;
  ctx: { agentId: string; ownerUserId: string };
}

export interface ValidateAndChargeResult {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const WWW_AUTHENTICATE = `KYAPay realm="merchant-agentic-demo", error="kya_validation_not_implemented"`;

export async function validateAndCharge(args: ValidateAndChargeArgs): Promise<ValidateAndChargeResult> {
  void args;
  return {
    status: 402,
    headers: { "WWW-Authenticate": WWW_AUTHENTICATE, "Content-Type": "application/json" },
    body: {
      error: "kya_validation_not_implemented",
      message: "Phase 5 surfaces the agent paths; KYA validation arrives in Phase 6.",
      phase: 5,
      implementsIn: "Phase 6",
      cart: { itemCount: args.cart.items.length, totalCents: args.cart.totalCents },
      agentId: args.ctx.agentId,
    },
  };
}
```

Run tests — GREEN. 65 total.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(agents): validateAndCharge stub returning 402 (real impl in Phase 6)"
```

---

## Task 4: HTML checkout dual-path (X-KYA-Token header)

**Files:**
- Modify: `app/api/checkout/route.ts`

**Step 1: Update route**

Read current file. Branch on `X-KYA-Token` (or `Authorization: KYAPay <jwt>`) presence. If present, skip user-session lookup; instead route through `validateAndCharge`. Otherwise, existing user flow.

```ts
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { createOrderFromCart } from "@/lib/orders";
import { getCartWithItems } from "@/lib/cart";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";
import { verifyAgentBearer } from "@/lib/auth/agent-gate";
import { validateAndCharge } from "@/lib/agent/validate-and-charge";
import { cartTotalFromLines } from "@/lib/cart-math";

async function extractKyaToken(): Promise<string | null> {
  const hs = await headers();
  const xKya = hs.get("x-kya-token");
  if (xKya) return xKya;
  const auth = hs.get("authorization");
  if (auth?.toLowerCase().startsWith("kyapay ")) return auth.slice(7).trim();
  return null;
}

export async function POST() {
  const kyaToken = await extractKyaToken();

  // ===== Agent path (Bose-style) =====
  if (kyaToken) {
    const hs = await headers();
    const agentResult = await verifyAgentBearer(getDb(), hs.get("authorization"));
    if (!agentResult.ok) {
      // No Hydra bearer accompanying the KYA token — accept anonymously for Phase 5;
      // Phase 6 will require the KYA token itself to prove the agent identity.
      // Return 402 with diagnostic info.
      const result = await validateAndCharge({
        kyaJwt: kyaToken,
        cart: { items: [], totalCents: 0 },
        ctx: { agentId: "unknown", ownerUserId: "unknown" },
      });
      return NextResponse.json(result.body, { status: result.status, headers: result.headers });
    }

    // Use the cart cookie if present (Bose flow: agent drove the human cart UI)
    const store = await cookies();
    const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
    const cart = cartId ? await getCartWithItems(getDb(), cartId) : null;
    const items = cart?.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      priceCents: i.product.priceCents,
    })) ?? [];
    const totalCents = cartTotalFromLines(cart?.items ?? []);
    const result = await validateAndCharge({
      kyaJwt: kyaToken,
      cart: { items, totalCents },
      ctx: { agentId: agentResult.agentId, ownerUserId: agentResult.ownerUserId },
    });
    return NextResponse.json(result.body, { status: result.status, headers: result.headers });
  }

  // ===== Human user path (existing) =====
  const store = await cookies();
  const { session, permission } = getAuth();
  const current = await session.getCurrentSession({ cookies: { get: (n: string) => store.get(n) } });
  if (!current) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  if (!cartId) {
    return NextResponse.json({ error: "No cart" }, { status: 400 });
  }
  try {
    const orderId = await createOrderFromCart(getDb(), cartId, current.user.id, "stub", { permissions: permission });
    return NextResponse.json({ ok: true, orderId });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
```

**Step 2: Smoke test**

```bash
pnpm dev &
DEV_PID=$!
sleep 8
# Without auth: 401
curl -sI -X POST http://localhost:3000/api/checkout | head -1
# With X-KYA-Token only (no Hydra bearer): 402 with WWW-Authenticate
curl -sI -X POST -H "X-KYA-Token: fake.kya.jwt" http://localhost:3000/api/checkout | head -3
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
```

Expected: first 401 (no session, no agent header). Second 402 with `WWW-Authenticate: KYAPay realm=...`.

**Step 3: Typecheck + commit**

```bash
pnpm typecheck
pnpm lint
pnpm test 2>&1 | tail -3
git add -A
git commit -m "feat(checkout): accept X-KYA-Token header (Bose-style agent path)"
```

If blocked, BLOCKED.

---

## Task 5: MCP server at /api/mcp

**Files:**
- Create: `app/api/mcp/route.ts`

The MCP SDK exposes a `Server` class and a `StreamableHTTPServerTransport`. Tools are registered with name + handler + input schema.

**Step 1: Inspect the SDK**

```bash
ls node_modules/@modelcontextprotocol/sdk/dist/
cat node_modules/@modelcontextprotocol/sdk/dist/index.d.ts 2>&1 | head -40
node -e "console.log(Object.keys(require('@modelcontextprotocol/sdk')))"
```

Identify the right import paths for `Server`, `StreamableHTTPServerTransport`, and the tool-registration helper. The SDK has shifted across versions; adapt the code below to the installed version's actual exports.

**Step 2: Implement the route**

```ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { listProducts, listByCategory, getProductBySlug } from "@/lib/catalog";
import { addItem, createCart, getCartWithItems } from "@/lib/cart";
import { verifyAgentBearer } from "@/lib/auth/agent-gate";
import { validateAndCharge } from "@/lib/agent/validate-and-charge";
import { cartTotalFromLines } from "@/lib/cart-math";
// MCP SDK imports — adapt to installed version:
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

async function authenticate(req: NextRequest): Promise<{ ok: true; agentId: string; ownerUserId: string } | { ok: false; status: number; message: string }> {
  const h = await headers();
  const result = await verifyAgentBearer(getDb(), h.get("authorization"));
  if (!result.ok) return { ok: false, status: result.status, message: result.message };
  return { ok: true, agentId: result.agentId, ownerUserId: result.ownerUserId };
}

function makeServer(ctx: { agentId: string; ownerUserId: string; cartId: string }) {
  const server = new Server(
    { name: "merchant-agentic-demo", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "searchProducts", description: "List or filter products by category", inputSchema: { type: "object", properties: { category: { type: "string" } } } },
      { name: "getProduct", description: "Fetch a product by slug", inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] } },
      { name: "addToCart", description: "Add a product to the cart", inputSchema: { type: "object", properties: { productId: { type: "string" }, quantity: { type: "number" } }, required: ["productId", "quantity"] } },
      { name: "viewCart", description: "Inspect the current cart", inputSchema: { type: "object", properties: {} } },
      { name: "submitCart", description: "Submit the cart for payment via KYA", inputSchema: { type: "object", properties: { kyaToken: { type: "string" } }, required: ["kyaToken"] } },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const db = getDb();
    switch (name) {
      case "searchProducts": {
        const cat = z.object({ category: z.string().optional() }).parse(args).category;
        const products = cat ? await listByCategory(db, cat) : await listProducts(db);
        return { content: [{ type: "text", text: JSON.stringify(products.map((p) => ({ id: p.id, slug: p.slug, name: p.name, priceCents: p.priceCents, category: p.categorySlug }))) }] };
      }
      case "getProduct": {
        const slug = z.object({ slug: z.string() }).parse(args).slug;
        const p = await getProductBySlug(db, slug);
        return { content: [{ type: "text", text: p ? JSON.stringify(p) : `Not found: ${slug}` }] };
      }
      case "addToCart": {
        const { productId, quantity } = z.object({ productId: z.string(), quantity: z.number().int().positive() }).parse(args);
        await addItem(db, ctx.cartId, productId, quantity);
        const cart = await getCartWithItems(db, ctx.cartId);
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, items: cart?.items.length ?? 0 }) }] };
      }
      case "viewCart": {
        const cart = await getCartWithItems(db, ctx.cartId);
        const items = cart?.items ?? [];
        return { content: [{ type: "text", text: JSON.stringify({ items: items.map((i) => ({ name: i.product.name, quantity: i.quantity, priceCents: i.product.priceCents })), totalCents: cartTotalFromLines(items) }) }] };
      }
      case "submitCart": {
        const kyaToken = z.object({ kyaToken: z.string() }).parse(args).kyaToken;
        const cart = await getCartWithItems(db, ctx.cartId);
        const items = (cart?.items ?? []).map((i) => ({ productId: i.productId, quantity: i.quantity, priceCents: i.product.priceCents }));
        const totalCents = cartTotalFromLines(cart?.items ?? []);
        const result = await validateAndCharge({
          kyaJwt: kyaToken,
          cart: { items, totalCents },
          ctx: { agentId: ctx.agentId, ownerUserId: ctx.ownerUserId },
        });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
    }
  });

  return server;
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  // Each agent gets a dedicated cart. For Phase 5, create one per request to avoid
  // cross-request leakage. Phase 7 will give agents persistent carts via session.
  const cartId = await createCart(getDb());

  const server = makeServer({ agentId: auth.agentId, ownerUserId: auth.ownerUserId, cartId });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });
  await server.connect(transport);

  // Plumb the Next request into the transport, capture the response.
  // The exact API depends on the SDK version — adapt as needed.
  // Most SDKs expose: `transport.handleRequest(req, res)` for raw Node IncomingMessage.
  // For Next route handlers, we may need to build a Web Streams adapter.

  // Pragmatic Phase 5 implementation: use a manual handler that bridges Next ↔ SDK.
  // Read the body as JSON, dispatch to the transport, return the response.
  const body = await req.json();
  const reply = await new Promise((resolve, reject) => {
    // The simplest path: directly invoke the JSON-RPC handler the Server registered.
    // Most MCP servers use newer transport.handleMessage(message) → returns response.
    // Inspect the installed SDK version's API and adapt this code.
    void body;
    void resolve;
    void reject;
    // PLACEHOLDER: adapt to SDK
  });

  return NextResponse.json(reply);
}
```

**This step has the most likelihood of needing adaptation.** The MCP SDK's exact API for HTTP serving has shifted significantly. Possible patterns:

1. **If the SDK provides a Next/Web-compatible adapter:** use it directly.
2. **If only Node IncomingMessage transport exists:** use `Server.handleMessage(parsedJsonRpc)` directly — bypass the transport for HTTP, do JSON-RPC over POST manually. The Server class has a `handleMessage` method on most versions.
3. **If everything is unfit:** write a thin JSON-RPC handler that mimics what the SDK does. For each `tools/list` and `tools/call` JSON-RPC request, match by method name and dispatch.

**Acceptable simplification for Phase 5**: implement a tiny JSON-RPC handler directly that doesn't use `StreamableHTTPServerTransport`. The MCP wire protocol is JSON-RPC 2.0 with specific method names (`tools/list`, `tools/call`). Phase 5 just needs the demo to work; full streaming HTTP can wait.

If you go with the simplification:

```ts
// Replace the Server/transport machinery with:

async function handleMcpJsonRpc(req: { method: string; params: unknown; id: string | number }, ctx: { agentId: string; ownerUserId: string; cartId: string }) {
  const db = getDb();
  switch (req.method) {
    case "tools/list": {
      return {
        jsonrpc: "2.0", id: req.id,
        result: { tools: [/* ... same list as above ... */] },
      };
    }
    case "tools/call": {
      const params = req.params as { name: string; arguments?: Record<string, unknown> };
      // dispatch to your handler logic (same switch as above)
      // wrap the result as { jsonrpc, id, result: { content: [...] } }
    }
    default:
      return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  }
}
```

Document which approach you took in your report.

**Step 3: Smoke test**

```bash
pnpm dev &
DEV_PID=$!
sleep 8
# Unauthenticated → 401
curl -sI -X POST http://localhost:3000/api/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -3
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
```

Expected: 401 (no bearer). The full flow (register agent → mint token → list tools → call submitCart → get 402) is exercised in P5.7.

**Step 4: Commit**

```bash
pnpm typecheck
pnpm lint
git add -A
git commit -m "feat(agents): MCP server at /api/mcp with 5 tools"
```

If blocked, BLOCKED.

---

## Task 6: Demo agent scripts (MCP + Browser)

**Files:**
- Create: `scripts/mint-agent-token.ts` (helper)
- Create: `scripts/demo-agent-mcp.ts`
- Create: `scripts/demo-agent-browser.ts`

**Step 1: Token mint helper**

`scripts/mint-agent-token.ts`:

```ts
// Mints a Hydra access token using the client_credentials grant for a registered agent.
// Usage: pnpm demo:mint-agent-token <hydra_client_id> <hydra_client_secret>

import "node:process";

async function main() {
  const [, , clientId, clientSecret] = process.argv;
  if (!clientId || !clientSecret) {
    console.error("Usage: pnpm demo:mint-agent-token <hydra_client_id> <hydra_client_secret>");
    process.exit(1);
  }
  const baseUrl = process.env.ORY_SDK_URL!;
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${baseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Token request failed:", data);
    process.exit(1);
  }
  console.log(data.access_token);
}

main();
```

Test it: register an agent via the UI, then run this with the agent's `hydraClientId` (from the DB) and the `client_secret` from Hydra. Hydra returns the secret only at creation — Phase 4's `OryOAuth2ClientProvider` doesn't currently surface it; you may need to extend it to return the secret, OR fetch it from Hydra after creation (Hydra returns a one-time secret at create time).

**Note:** This is a real gap. The agent record in our DB has `hydra_client_id` but not the secret. Without the secret, demo agents can't mint tokens. **Two options to handle in P4 catch-up:**

(a) Extend `OAuth2ClientProvider.create` to also return `clientSecret`, and store it on the agent row. (Less secure — secrets in the DB.)
(b) Use a long-lived OAuth2 client created manually (one for all demo agents), and pass its credentials via env. Simpler for the demo.

For Phase 5: **option (b)** is pragmatic. Document in the README that demo agents share a "demo-agent" Hydra client; production would mint per-agent secrets. Add `DEMO_AGENT_CLIENT_ID` and `DEMO_AGENT_CLIENT_SECRET` to `.env.example`; the demo scripts read them.

Update `scripts/mint-agent-token.ts` to default to those env vars:

```ts
const clientId = process.argv[2] ?? process.env.DEMO_AGENT_CLIENT_ID;
const clientSecret = process.argv[3] ?? process.env.DEMO_AGENT_CLIENT_SECRET;
```

You'll need to create the demo OAuth2 client once via the dashboard or a small one-off script. Document that.

**Step 2: MCP demo agent**

`scripts/demo-agent-mcp.ts`:

```ts
async function rpc(token: string, method: string, params: Record<string, unknown>) {
  const res = await fetch("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Math.random().toString(36).slice(2), method, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  const token = process.env.AGENT_TOKEN;
  if (!token) {
    console.error("Set AGENT_TOKEN — get one via pnpm demo:mint-agent-token (or use process substitution).");
    process.exit(1);
  }

  console.log("1. tools/list");
  const tools = await rpc(token, "tools/list", {});
  console.log("   →", tools.result.tools.map((t: { name: string }) => t.name).join(", "));

  console.log("2. searchProducts (food)");
  const products = await rpc(token, "tools/call", { name: "searchProducts", arguments: { category: "food" } });
  const list = JSON.parse(products.result.content[0].text);
  console.log("   →", list.length, "products");
  const first = list[0];

  console.log("3. addToCart", first.slug);
  await rpc(token, "tools/call", { name: "addToCart", arguments: { productId: first.id, quantity: 2 } });

  console.log("4. viewCart");
  const cart = await rpc(token, "tools/call", { name: "viewCart", arguments: {} });
  console.log("   →", cart.result.content[0].text);

  console.log("5. submitCart");
  const submit = await rpc(token, "tools/call", { name: "submitCart", arguments: { kyaToken: "fake.kya.jwt.for.phase.5" } });
  const result = JSON.parse(submit.result.content[0].text);
  console.log("   → status:", result.status, "body.error:", result.body.error);
  if (result.status !== 402) {
    console.error("Expected 402 in Phase 5");
    process.exit(1);
  }
  console.log("✓ MCP demo agent ran successfully (received expected 402)");
}

main().catch((err) => { console.error(err); process.exit(1); });
```

**Step 3: Browser demo agent (Bose-style)**

`scripts/demo-agent-browser.ts`:

```ts
import { chromium } from "@playwright/test";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  console.log("1. Navigate to landing");
  await page.goto("http://localhost:3000");

  console.log("2. Browse to product");
  await page.goto("http://localhost:3000/p/merino-tee");

  console.log("3. Add to cart (via the human button)");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/cart/items") && r.ok());

  console.log("4. POST /api/checkout with X-KYA-Token header");
  const cookies = await ctx.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await fetch("http://localhost:3000/api/checkout", {
    method: "POST",
    headers: {
      "X-KYA-Token": "fake.kya.jwt.for.phase.5",
      Cookie: cookieHeader,
    },
  });
  console.log("   → status:", res.status);
  console.log("   → WWW-Authenticate:", res.headers.get("www-authenticate"));
  const body = await res.json();
  console.log("   → body:", JSON.stringify(body, null, 2));

  if (res.status !== 402) {
    console.error("Expected 402 in Phase 5");
    process.exit(1);
  }
  console.log("✓ Browser demo agent ran successfully (received expected 402)");

  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

**Step 4: Smoke run both**

Requires the dev server up and `DEMO_AGENT_CLIENT_ID`/`DEMO_AGENT_CLIENT_SECRET` in `.env.local`. If you don't have a demo OAuth2 client yet, create one manually via the Ory dashboard (or extend `OryOAuth2ClientProvider.create` to return + log the secret on first creation — Phase 5 catch-up).

Test the MCP agent first:

```bash
# Terminal A
pnpm dev

# Terminal B
TOKEN=$(pnpm demo:mint-agent-token | tail -1)
AGENT_TOKEN=$TOKEN pnpm demo:agent-mcp
```

Then the browser agent:

```bash
# Terminal B
pnpm demo:agent-browser
```

Both should print `✓ ... received expected 402`.

**Step 5: Commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat(agents): demo agent scripts (MCP + browser/Bose)"
```

If blocked, BLOCKED.

---

## Task 7: E2E for both agent surfaces

**Files:**
- Create: `e2e/agent-surfaces.spec.ts`

**Step 1: Spec**

```ts
import { test, expect } from "@playwright/test";

test("HTML checkout with X-KYA-Token returns 402 + WWW-Authenticate", async ({ request }) => {
  const res = await request.post("/api/checkout", {
    headers: { "X-KYA-Token": "fake.kya.token" },
  });
  expect(res.status()).toBe(402);
  expect(res.headers()["www-authenticate"]).toMatch(/KYAPay/);
  const body = await res.json();
  expect(body.error).toBe("kya_validation_not_implemented");
});

test("MCP endpoint requires bearer token", async ({ request }) => {
  const res = await request.post("/api/mcp", {
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(res.status()).toBe(401);
});
```

These tests don't need a real agent or real Hydra token — they verify the surface shape (Phase 5's outcome). The actual agent flow with real tokens is exercised by the manual demo scripts in P5.6.

**Step 2: Run all e2e**

```bash
pnpm test:e2e 2>&1 | tail -10
```

Expected: 9 tests (7 prior + 2 new).

**Step 3: Commit**

```bash
git add -A
git commit -m "test(e2e): both agent surfaces exhibit expected 401/402 shapes"
```

If blocked, BLOCKED.

---

## Task 8: README + final verification

**Files:**
- Modify: `README.md`

**Step 1: README**

Add a section after "Agents":

```markdown
## Agent surfaces

The merchant exposes two ways for an agent to shop:

1. **MCP server** at `POST /api/mcp` — JSON-RPC 2.0. Tools: `searchProducts`, `getProduct`, `addToCart`, `viewCart`, `submitCart`. Requires `Authorization: Bearer <hydra-access-token>` (mint via `pnpm demo:mint-agent-token` against the registered agent's Hydra OAuth2 client).
2. **HTML checkout with `X-KYA-Token` header** (Bose-style) — `POST /api/checkout` accepts an `X-KYA-Token: <jwt>` header in lieu of the human user-session flow. Walks the same HTML site a human would.

Both surfaces converge on `lib/agent/validate-and-charge.ts`. In Phase 5 this stub returns **`HTTP 402 Payment Required`** with `WWW-Authenticate: KYAPay realm="merchant-agentic-demo"`. Phase 6 wires real KYA token validation + Skyfire `chargeToken`.

### Try it

```bash
# Terminal 1
pnpm dev

# Terminal 2
# (Once: register a demo Hydra OAuth2 client via the Ory dashboard,
# set DEMO_AGENT_CLIENT_ID and DEMO_AGENT_CLIENT_SECRET in .env.local)
AGENT_TOKEN=$(pnpm demo:mint-agent-token) pnpm demo:agent-mcp
# or:
pnpm demo:agent-browser
```

Both demos should report `received expected 402`.
```

**Step 2: Full CI sequence**

```bash
pnpm install --frozen-lockfile
pnpm typecheck && echo "tsc OK"
pnpm lint && echo "lint OK"
pnpm test 2>&1 | tail -5
pnpm test:e2e 2>&1 | tail -8
./scripts/ory-setup/apply.sh 2>&1 | tail -5
```

All exit 0. Expect: ~65 unit tests, 9 e2e tests.

**Step 3: Commit**

```bash
git add -A
git commit -m "docs: README phase 5 — agent surfaces (MCP + X-KYA-Token)"
git rev-list --count HEAD
```

If blocked, BLOCKED.

---

## Final verification

- [ ] Both demo scripts run and print `received expected 402`.
- [ ] Full local CI sequence (typecheck + lint + vitest + playwright + apply.sh) passes.
- [ ] Tree clean, on main, ~75 commits total.

---

## Phase 5 complete

End state:
- MCP server at `/api/mcp` exposes 5 tools, gated by Hydra bearer auth.
- HTML checkout accepts `X-KYA-Token` and routes through the same `validateAndCharge` stub.
- Both surfaces return `HTTP 402 + WWW-Authenticate: KYAPay` from `validateAndCharge`.
- Two demo agent scripts exercise both paths end-to-end against a real agent and a real Hydra OAuth2 client.
- ~65 unit tests + 9 e2e tests.

**Phase 5 follow-ups (deferred):**
- Per-agent Hydra OAuth2 client secret storage — currently demo agents share one client. Phase 6 may revisit.
- ACP JSON endpoints (`/api/acp/*`) — deferred to Phase 7. The MCP + HTML+header pair covers both the "structured agent" and "browser agent" stories.
- MCP-UI rich components — Phase 10 polish.

**Next:** Phase 6 — KYAPay verification + mock-Skyfire end-to-end. `validateAndCharge` actually verifies the KYA token (against our local-key mock-Skyfire), checks the agent's spend cap, and writes an order via Skyfire's mock `chargeToken`. The Debug Policy Panel grows a mandate-display row showing decoded KYA JWT claims. See `phase-6-kyapay-mock-skyfire.md`.
