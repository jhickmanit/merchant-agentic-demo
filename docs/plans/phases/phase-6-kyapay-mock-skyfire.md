# Phase 6 — KYAPay Verification + Mock-Skyfire End-to-End Purchase

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 5 stub `validateAndCharge()` with a real implementation that verifies a KYAPay JWT (signed by our local ES256 key), cross-checks the claims against our agent/user records, charges via a mock Skyfire `chargeToken`, writes a real order linked to the registered agent, and decrements the agent's spend cap. Order detail pages gain a **Mandate Panel** that surfaces the Skyfire charge ID and KYA token id. The end-to-end demo flow now works: an MCP/Bose agent presents a KYA token → merchant verifies → order placed → owner sees it in their order history.

**Architecture:** New `KyaPayProvider` interface in `lib/payments/kyapay.ts` with `verify(jwt)`, `charge(jwt, amount)`, `jwks()`. A `MockKyaPayProvider` (default for Phase 6) uses an ES256 keypair stored in `.env.local`. It exposes `/api/mock-skyfire/.well-known/jwks.json` for verifiers and an in-memory ledger of charges. A new `getPayments()` DI factory mirrors `getAuth()` and reads `KYAPAY_PROVIDER=mock|skyfire` (default `mock`). `validateAndCharge()` becomes the real orchestration: verify → cross-check → charge → persist → decrement cap. Phase 8 will swap `mock` for `skyfire` (real Skyfire seller account) — Phase 6's only contract with Phase 8 is the `KyaPayProvider` interface.

**Tech Stack:** new — none. Uses existing `jose` (added in P5.1) for ES256 sign/verify and JWKS.

**Parent plan:** [`docs/plans/2026-05-13-architecture-and-roadmap.md`](../2026-05-13-architecture-and-roadmap.md)

**Pre-conditions:**
- Phase 5 complete (76 commits, 66 unit + 10 e2e passing).
- `validateAndCharge` returns 402 from both `/api/checkout` and `/api/mcp`'s `submitCart` tool.
- Demo agents (`demo:agent-mcp`, `demo:agent-browser`) exist and report "received expected 402".

**Standing preamble** for every task:
```bash
eval "$(fnm env --use-on-cd)"
cd /Users/jeff.hickman/Code/demos/merchant-agentic-demo
git branch --show-current  # must print: main
```

Stay on `main`. **Never** detach HEAD. **Never** write to `.claude/settings.json`. If a `git commit` is blocked, report BLOCKED.

**Carry-over reminders:**
- The agent's spend cap lives in the local DB (`agents.spend_cap_cents`, nullable = unlimited). Set via the `/me/agents/new` form.
- Phase 4 created the Hydra OAuth2 client per agent but `hydra_client_id` is stored; we don't have the secret for per-agent tokens (demo agents share `DEMO_AGENT_CLIENT_*`). Phase 6 doesn't need per-agent secrets — the KYA token carries the agent identity directly.
- Phase 3's `Order` Keto tuples (owner + view) are still written on order creation; Phase 6 keeps that behavior.
- **No `child_process.exec` or `execSync`** — the demo scripts share KYA-mint logic via a directly-imported helper. Shell-substitution forms are command-injection-risky and the project's security hook will block them.

---

## KYA Token Claims (Phase 6 schema)

Modeled on Skyfire's real claim shape (per the Phase 0 research summary), simplified for mock use:

```ts
interface KyaPayClaims {
  // Standard JWT
  iss: string;        // "http://localhost:3000/api/mock-skyfire"
  aud: string;        // merchant identifier — "merchant-agentic-demo"
  jti: string;        // unique token id (nanoid)
  iat: number;        // issued-at (unix seconds)
  exp: number;        // expiry (unix seconds)

  // Skyfire-shaped payment claims
  ssi: string;        // seller service id — "merchant-agentic-demo"
  amount: number;     // total in cents
  cur: "USD";

  // Identity
  hid: { email: string; user_id?: string };
  aid: { id: string; name: string };
}
```

The mock provider verifies signature via the JWKS published at `/api/mock-skyfire/.well-known/jwks.json` and validates the claim shape above. Real Skyfire (Phase 8) will swap in a different provider implementation; the interface stays.

---

## File Structure (created/modified by this plan)

```
.
├── lib/payments/
│   ├── types.ts                              (new — KyaPayClaims, VerifyResult, ChargeResult)
│   ├── kyapay.ts                             (new — KyaPayProvider interface)
│   ├── index.ts                              (new — getPayments() DI factory)
│   ├── mint.ts                               (new — mintKyaToken helper for scripts + tests)
│   ├── mock/
│   │   ├── kyapay.ts                         (new — MockKyaPayProvider)
│   │   └── keys.ts                           (new — keypair loader)
│   └── __tests__/
│       ├── kyapay-contract.ts                (new)
│       ├── mock-kyapay.test.ts               (new)
│       └── helpers.ts                        (new — test-only keypair helper)
├── lib/agent/
│   ├── validate-and-charge.ts                (rewritten — real impl)
│   └── __tests__/
│       └── validate-and-charge.test.ts       (rewritten — happy + 5 failure paths)
├── app/
│   ├── api/mock-skyfire/.well-known/jwks.json/route.ts (new)
│   ├── api/checkout/route.ts                 (modified — passes deps to validateAndCharge)
│   ├── api/mcp/route.ts                      (modified — passes deps to validateAndCharge)
│   └── orders/[id]/page.tsx                  (modified — Mandate panel when payment_method=kyapay)
├── scripts/
│   ├── gen-mock-skyfire-keys.ts              (new — one-shot keypair generator)
│   ├── mint-kya-test-token.ts                (new — CLI wrapping mintKyaToken)
│   ├── demo-agent-mcp.ts                     (modified — imports mintKyaToken directly)
│   └── demo-agent-browser.ts                 (modified — imports mintKyaToken directly)
├── .env.example                              (modified — adds MOCK_SKYFIRE_* + KYAPAY_PROVIDER)
├── e2e/
│   └── kyapay-checkout.spec.ts               (new — end-to-end purchase)
└── README.md                                 (modified — Phase 6 section)
```

---

## Task 1: Mock Skyfire keypair generator + key loader

**Files:**
- Create: `scripts/gen-mock-skyfire-keys.ts`
- Create: `lib/payments/mock/keys.ts`
- Modify: `package.json` (script)
- Modify: `.env.example`

**Step 1: Keypair generator**

`scripts/gen-mock-skyfire-keys.ts`:

```ts
// One-shot generator. Run via `pnpm gen:mock-skyfire-keys`, then paste the
// output JWKs into .env.local. DO NOT commit the private key.

export {};

import { generateKeyPair, exportJWK } from "jose";

async function main() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  publicJwk.kid = "mock-skyfire-1";
  privateJwk.kid = "mock-skyfire-1";
  publicJwk.alg = "ES256";
  privateJwk.alg = "ES256";
  publicJwk.use = "sig";

  console.log("# Paste these into .env.local:");
  console.log(`MOCK_SKYFIRE_PUBLIC_KEY_JWK='${JSON.stringify(publicJwk)}'`);
  console.log(`MOCK_SKYFIRE_PRIVATE_KEY_JWK='${JSON.stringify(privateJwk)}'`);
}

main();
```

**Step 2: Key loader**

`lib/payments/mock/keys.ts`:

```ts
import { importJWK, type JWK } from "jose";

let _publicKey: CryptoKey | null = null;
let _privateKey: CryptoKey | null = null;
let _publicJwk: JWK | null = null;

function parseJwkEnv(name: string): JWK {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(`${name} is not set. Run pnpm gen:mock-skyfire-keys and paste into .env.local.`);
  }
  try {
    return JSON.parse(raw) as JWK;
  } catch (err) {
    throw new Error(`${name} is not valid JSON: ${(err as Error).message}`);
  }
}

export async function getPublicKey(): Promise<CryptoKey> {
  if (_publicKey) return _publicKey;
  const jwk = parseJwkEnv("MOCK_SKYFIRE_PUBLIC_KEY_JWK");
  _publicJwk = jwk;
  _publicKey = (await importJWK(jwk, "ES256")) as CryptoKey;
  return _publicKey;
}

export async function getPrivateKey(): Promise<CryptoKey> {
  if (_privateKey) return _privateKey;
  const jwk = parseJwkEnv("MOCK_SKYFIRE_PRIVATE_KEY_JWK");
  _privateKey = (await importJWK(jwk, "ES256")) as CryptoKey;
  return _privateKey;
}

export async function getPublicJwk(): Promise<JWK> {
  if (_publicJwk) return _publicJwk;
  await getPublicKey();
  return _publicJwk!;
}

export const KEY_KID = "mock-skyfire-1";
export const MOCK_SKYFIRE_ISSUER = "http://localhost:3000/api/mock-skyfire";
export const MOCK_MERCHANT_AUD = "merchant-agentic-demo";
export const MOCK_SELLER_SSI = "merchant-agentic-demo";
```

**Step 3: package.json + .env.example**

Add `"gen:mock-skyfire-keys": "tsx scripts/gen-mock-skyfire-keys.ts"` to `scripts`.

Append to `.env.example`:
```bash

# Phase 6 — mock Skyfire keypair (ES256). Generate via:
#   pnpm gen:mock-skyfire-keys
# then paste both lines into .env.local. DO NOT commit the private key.
MOCK_SKYFIRE_PRIVATE_KEY_JWK=
MOCK_SKYFIRE_PUBLIC_KEY_JWK=
KYAPAY_PROVIDER=mock
```

**Step 4: Run the generator**

```bash
pnpm gen:mock-skyfire-keys
```

The output should be pasted into `.env.local` by the user (or you, with file-write). **DO NOT include the JWK values in any commit message, report, or stdout echo of subagent state. These are secret-equivalent.**

**Step 5: Commit**

```bash
pnpm typecheck
git add scripts/gen-mock-skyfire-keys.ts lib/payments/mock/keys.ts package.json .env.example
git commit -m "feat(payments): mock Skyfire keypair generator + key loader"
```

If commit blocked, BLOCKED.

## Self-Review

- Generator + loader both in place?
- `pnpm gen:mock-skyfire-keys` produces a valid pair?
- `.env.example` documents the three vars?
- typecheck clean?
- **No JWK values committed or echoed in your report**?
- Tree clean, on main?

## Report

- Status: DONE | DONE_WITH_CONCERNS | BLOCKED
- Whether `.env.local` was populated (yes/no, by you or the user)
- `git log --oneline -3`
- Issues

---

## Task 2: KyaPayProvider interface + types

**Files:**
- Create: `lib/payments/types.ts`
- Create: `lib/payments/kyapay.ts`

```ts
// lib/payments/types.ts
import type { JWK } from "jose";

export interface KyaPayClaims {
  iss: string;
  aud: string;
  jti: string;
  iat: number;
  exp: number;
  ssi: string;
  amount: number;
  cur: "USD";
  hid: { email: string; user_id?: string };
  aid: { id: string; name: string };
}

export type VerifyResult =
  | { ok: true; claims: KyaPayClaims }
  | { ok: false; code: string; message: string };

export interface ChargeResult {
  chargeId: string;
  settledAt: Date;
  amountCents: number;
}

export interface JwksResponse {
  keys: JWK[];
}
```

```ts
// lib/payments/kyapay.ts
import type { VerifyResult, ChargeResult, JwksResponse } from "./types";

export interface KyaPayProvider {
  verify(jwt: string): Promise<VerifyResult>;
  charge(jwt: string, amountCents: number): Promise<ChargeResult>;
  jwks(): Promise<JwksResponse>;
}
```

Commit:

```bash
pnpm typecheck
git add lib/payments/
git commit -m "feat(payments): KyaPayProvider interface + types"
```

---

## Task 3: Shared mintKyaToken helper

**Files:**
- Create: `lib/payments/mint.ts`

This helper is imported by tests, the CLI, and the demo agents — avoids duplicating the signing logic and (critically) avoids `child_process` in the demo scripts.

```ts
// lib/payments/mint.ts
import { SignJWT, importJWK, type JWK } from "jose";
import { nanoid } from "nanoid";

export interface MintKyaTokenInput {
  agentId: string;
  agentName: string;
  userEmail: string;
  amountCents: number;
  ttlSeconds?: number;
  issuer?: string;
  audience?: string;
  sellerServiceId?: string;
  privateKey?: CryptoKey;
}

export async function mintKyaToken(input: MintKyaTokenInput): Promise<string> {
  const ttl = input.ttlSeconds ?? 300;
  const iss = input.issuer ?? "http://localhost:3000/api/mock-skyfire";
  const aud = input.audience ?? "merchant-agentic-demo";
  const ssi = input.sellerServiceId ?? "merchant-agentic-demo";

  let privateKey = input.privateKey;
  if (!privateKey) {
    const raw = process.env.MOCK_SKYFIRE_PRIVATE_KEY_JWK;
    if (!raw) throw new Error("MOCK_SKYFIRE_PRIVATE_KEY_JWK not set");
    const jwk = JSON.parse(raw) as JWK;
    privateKey = (await importJWK(jwk, "ES256")) as CryptoKey;
  }

  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss, aud, jti: nanoid(16), iat: now, exp: now + ttl,
    ssi, amount: input.amountCents, cur: "USD",
    hid: { email: input.userEmail },
    aid: { id: input.agentId, name: input.agentName },
  })
    .setProtectedHeader({ alg: "ES256", kid: "mock-skyfire-1" })
    .sign(privateKey);
}
```

Commit:

```bash
pnpm typecheck
git add lib/payments/mint.ts
git commit -m "feat(payments): mintKyaToken helper (shared by CLI, tests, demos)"
```

---

## Task 4: MockKyaPayProvider implementation

**Files:**
- Create: `lib/payments/mock/kyapay.ts`
- Create: `lib/payments/__tests__/helpers.ts` (test-only keypair generator)
- Create: `lib/payments/__tests__/kyapay-contract.ts`
- Create: `lib/payments/__tests__/mock-kyapay.test.ts`

**Step 1: Test helpers (test-only keypair)**

`lib/payments/__tests__/helpers.ts`:

```ts
import { generateKeyPair, exportJWK } from "jose";
import type { JWK } from "jose";

export async function mintTestKeypair(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicJwk: JWK;
}> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key-1";
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";
  return { publicKey, privateKey, publicJwk };
}
```

**Step 2: Contract test**

`lib/payments/__tests__/kyapay-contract.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mintKyaToken } from "@/lib/payments/mint";
import type { KyaPayProvider } from "@/lib/payments/kyapay";

interface Setup {
  provider: KyaPayProvider;
  privateKey: CryptoKey;
  issuer: string;
}

export function runKyaPayContract(name: string, makeSetup: () => Promise<Setup>) {
  describe(`${name} — KyaPayProvider contract`, () => {
    let s: Setup;
    beforeEach(async () => { s = await makeSetup(); });

    it("verify: returns ok for a valid token", async () => {
      const t = await mintKyaToken({
        agentId: "a", agentName: "X", userEmail: "u@e", amountCents: 5000,
        issuer: s.issuer, privateKey: s.privateKey,
      });
      const r = await s.provider.verify(t);
      expect(r.ok).toBe(true);
    });

    it("verify: rejects expired token", async () => {
      const t = await mintKyaToken({
        agentId: "a", agentName: "X", userEmail: "u@e", amountCents: 100,
        ttlSeconds: -100, issuer: s.issuer, privateKey: s.privateKey,
      });
      const r = await s.provider.verify(t);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("expired");
    });

    it("verify: rejects bad signature", async () => {
      const t = await mintKyaToken({
        agentId: "a", agentName: "X", userEmail: "u@e", amountCents: 100,
        issuer: s.issuer, privateKey: s.privateKey,
      });
      const r = await s.provider.verify(t.slice(0, -10) + "AAAAAAAAAA");
      expect(r.ok).toBe(false);
    });

    it("verify: rejects wrong audience", async () => {
      const t = await mintKyaToken({
        agentId: "a", agentName: "X", userEmail: "u@e", amountCents: 100,
        audience: "other-merchant", issuer: s.issuer, privateKey: s.privateKey,
      });
      const r = await s.provider.verify(t);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("wrong_audience");
    });

    it("charge: succeeds when amount matches", async () => {
      const t = await mintKyaToken({
        agentId: "a", agentName: "X", userEmail: "u@e", amountCents: 5000,
        issuer: s.issuer, privateKey: s.privateKey,
      });
      const r = await s.provider.charge(t, 5000);
      expect(r.chargeId).toBeTruthy();
      expect(r.amountCents).toBe(5000);
    });

    it("charge: rejects amount mismatch", async () => {
      const t = await mintKyaToken({
        agentId: "a", agentName: "X", userEmail: "u@e", amountCents: 5000,
        issuer: s.issuer, privateKey: s.privateKey,
      });
      await expect(s.provider.charge(t, 7500)).rejects.toThrow(/amount/i);
    });

    it("charge: rejects replay", async () => {
      const t = await mintKyaToken({
        agentId: "a", agentName: "X", userEmail: "u@e", amountCents: 1000,
        issuer: s.issuer, privateKey: s.privateKey,
      });
      await s.provider.charge(t, 1000);
      await expect(s.provider.charge(t, 1000)).rejects.toThrow(/replay/i);
    });

    it("jwks: returns a non-empty key set", async () => {
      const r = await s.provider.jwks();
      expect(r.keys.length).toBeGreaterThan(0);
    });
  });
}
```

**Step 3: Mock provider**

`lib/payments/mock/kyapay.ts`:

```ts
import { nanoid } from "nanoid";
import { jwtVerify, type JWK, errors as joseErrors } from "jose";
import type { KyaPayProvider } from "@/lib/payments/kyapay";
import type { KyaPayClaims, VerifyResult, ChargeResult, JwksResponse } from "@/lib/payments/types";

export interface MockKyaPayOpts {
  publicKey: CryptoKey;
  publicJwk: JWK;
  issuer: string;
  audience: string;
  sellerServiceId: string;
}

export class MockKyaPayProvider implements KyaPayProvider {
  private chargedJti = new Set<string>();
  public readonly ledger: { chargeId: string; jti: string; amountCents: number; settledAt: Date }[] = [];

  constructor(private opts: MockKyaPayOpts) {}

  async verify(jwt: string): Promise<VerifyResult> {
    let claims: KyaPayClaims;
    try {
      const { payload } = await jwtVerify(jwt, this.opts.publicKey, {
        // We do our own iss/aud checks below for richer error codes.
      });
      claims = payload as unknown as KyaPayClaims;
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        return { ok: false, code: "expired", message: "Token expired" };
      }
      return { ok: false, code: "invalid_signature", message: (err as Error).message };
    }

    if (claims.iss !== this.opts.issuer) {
      return { ok: false, code: "wrong_issuer", message: `iss mismatch: ${claims.iss}` };
    }
    if (claims.aud !== this.opts.audience) {
      return { ok: false, code: "wrong_audience", message: `aud mismatch: ${claims.aud}` };
    }
    if (claims.ssi !== this.opts.sellerServiceId) {
      return { ok: false, code: "wrong_seller", message: `ssi mismatch: ${claims.ssi}` };
    }
    if (claims.cur !== "USD") {
      return { ok: false, code: "wrong_currency", message: "cur must be USD" };
    }
    if (typeof claims.amount !== "number" || claims.amount <= 0) {
      return { ok: false, code: "invalid_amount", message: "amount must be positive" };
    }
    if (!claims.hid?.email) {
      return { ok: false, code: "missing_hid_email", message: "hid.email required" };
    }
    if (!claims.aid?.id) {
      return { ok: false, code: "missing_aid_id", message: "aid.id required" };
    }
    return { ok: true, claims };
  }

  async charge(jwt: string, amountCents: number): Promise<ChargeResult> {
    const r = await this.verify(jwt);
    if (!r.ok) throw new Error(`charge: token verification failed (${r.code})`);
    if (r.claims.amount !== amountCents) {
      throw new Error(`charge: amount mismatch (token=${r.claims.amount}, charge=${amountCents})`);
    }
    if (this.chargedJti.has(r.claims.jti)) {
      throw new Error(`charge: replay detected (jti=${r.claims.jti} already settled)`);
    }
    this.chargedJti.add(r.claims.jti);
    const result: ChargeResult = {
      chargeId: `mock-charge-${nanoid(12)}`,
      settledAt: new Date(),
      amountCents,
    };
    this.ledger.push({ chargeId: result.chargeId, jti: r.claims.jti, amountCents, settledAt: result.settledAt });
    return result;
  }

  async jwks(): Promise<JwksResponse> {
    return { keys: [this.opts.publicJwk] };
  }
}
```

**Step 4: Bind contract to MockKyaPayProvider**

`lib/payments/__tests__/mock-kyapay.test.ts`:

```ts
import { MockKyaPayProvider } from "@/lib/payments/mock/kyapay";
import { mintTestKeypair } from "./helpers";
import { runKyaPayContract } from "./kyapay-contract";

runKyaPayContract("MockKyaPayProvider", async () => {
  const { publicKey, privateKey, publicJwk } = await mintTestKeypair();
  return {
    provider: new MockKyaPayProvider({
      publicKey, publicJwk,
      issuer: "http://test-issuer",
      audience: "merchant-agentic-demo",
      sellerServiceId: "merchant-agentic-demo",
    }),
    privateKey,
    issuer: "http://test-issuer",
  };
});
```

**Step 5: Run tests + commit**

```bash
pnpm test 2>&1 | tail -5
```

Expected: 66 + 8 = 74 tests passing.

```bash
pnpm typecheck
pnpm lint
git add -A
git commit -m "feat(payments): MockKyaPayProvider with verify + charge + jwks"
```

If blocked, BLOCKED.

---

## Task 5: getPayments() DI factory + JWKS endpoint

**Files:**
- Create: `lib/payments/index.ts`
- Create: `app/api/mock-skyfire/.well-known/jwks.json/route.ts`

```ts
// lib/payments/index.ts
import type { KyaPayProvider } from "./kyapay";

let cached: { kyaPay: KyaPayProvider } | null = null;

export function getPayments(): { kyaPay: KyaPayProvider } {
  if (cached) return cached;
  const which = process.env.KYAPAY_PROVIDER ?? "mock";

  if (which === "mock") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MockKyaPayProvider } = require("./mock/kyapay");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getPublicKey, getPublicJwk, MOCK_SKYFIRE_ISSUER, MOCK_MERCHANT_AUD, MOCK_SELLER_SSI } = require("./mock/keys");

    let _inner: KyaPayProvider | null = null;
    let _initPromise: Promise<KyaPayProvider> | null = null;
    async function init(): Promise<KyaPayProvider> {
      if (_inner) return _inner;
      if (_initPromise) return _initPromise;
      _initPromise = (async () => {
        const publicKey = await getPublicKey();
        const publicJwk = await getPublicJwk();
        _inner = new MockKyaPayProvider({
          publicKey, publicJwk,
          issuer: MOCK_SKYFIRE_ISSUER,
          audience: MOCK_MERCHANT_AUD,
          sellerServiceId: MOCK_SELLER_SSI,
        });
        return _inner;
      })();
      return _initPromise;
    }
    const proxy: KyaPayProvider = {
      async verify(jwt) { return (await init()).verify(jwt); },
      async charge(jwt, amt) { return (await init()).charge(jwt, amt); },
      async jwks() { return (await init()).jwks(); },
    };
    cached = { kyaPay: proxy };
    return cached;
  }

  if (which === "skyfire") throw new Error("Real Skyfire provider lands in Phase 8");
  throw new Error(`Unknown KYAPAY_PROVIDER: ${which}`);
}

export function resetPaymentsForTests() {
  cached = null;
}
```

```ts
// app/api/mock-skyfire/.well-known/jwks.json/route.ts
import { NextResponse } from "next/server";
import { getPayments } from "@/lib/payments";

export async function GET() {
  const { kyaPay } = getPayments();
  const jwks = await kyaPay.jwks();
  return NextResponse.json(jwks, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
```

Smoke test the JWKS endpoint (requires `MOCK_SKYFIRE_*_KEY_JWK` set):

```bash
pnpm dev &
DEV_PID=$!
sleep 8
curl -s http://localhost:3000/api/mock-skyfire/.well-known/jwks.json | head -c 200
echo
kill $DEV_PID 2>/dev/null || true
wait $DEV_PID 2>/dev/null || true
```

Expected JSON with `keys` array. Commit:

```bash
pnpm typecheck
pnpm lint
git add -A
git commit -m "feat(payments): getPayments() DI + /api/mock-skyfire/.well-known/jwks.json"
```

If blocked, BLOCKED.

---

## Task 6: KYA test-token-minting CLI

**Files:**
- Create: `scripts/mint-kya-test-token.ts`

The CLI is a thin wrapper around `mintKyaToken`:

```ts
// scripts/mint-kya-test-token.ts
// Usage: pnpm demo:mint-kya-token --agent <id> --agent-name <name> --user-email <email> [--amount-cents <int>]
//
// Prints the JWT to stdout (last line).

export {};

import { mintKyaToken } from "../lib/payments/mint";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

async function main() {
  const agentId = arg("agent");
  const agentName = arg("agent-name");
  const userEmail = arg("user-email");
  const amountCents = parseInt(arg("amount-cents", "5000")!, 10);
  if (!agentId || !agentName || !userEmail) {
    console.error("Usage: pnpm demo:mint-kya-token --agent <id> --agent-name <name> --user-email <email> [--amount-cents <int>]");
    process.exit(1);
  }
  const token = await mintKyaToken({ agentId, agentName, userEmail, amountCents });
  // Print to stdout — last line is the token (only line, in fact).
  process.stdout.write(token + "\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Add `"demo:mint-kya-token": "tsx scripts/mint-kya-test-token.ts"` to `package.json` scripts.

Smoke test:

```bash
# Requires MOCK_SKYFIRE_PRIVATE_KEY_JWK in .env.local
pnpm demo:mint-kya-token --agent agent-test --agent-name Shoppy --user-email alice@example.com --amount-cents 1000 2>&1 | tail -1 | awk '{print "token chars:", length($0)}'
```

Commit:

```bash
pnpm typecheck
git add -A
git commit -m "feat(payments): KYA test-token mint CLI"
```

If blocked, BLOCKED.

---

## Task 7: Real validateAndCharge implementation

**Files:**
- Rewrite: `lib/agent/validate-and-charge.ts`
- Rewrite: `lib/agent/__tests__/validate-and-charge.test.ts`
- Modify: `lib/orders.ts` (createOrderFromCart accepts paymentTokenJti + skyfireChargeId)
- Modify: `app/api/checkout/route.ts` (pass deps)
- Modify: `app/api/mcp/route.ts` (pass deps in submitCart)

**Step 1: Extend createOrderFromCart**

Read `lib/orders.ts`. Add `paymentTokenJti` and `skyfireChargeId` to the `opts` parameter. Pass them through to the insert:

```ts
opts?: {
  permissions?: PermissionProvider;
  paymentTokenJti?: string;
  skyfireChargeId?: string;
}
```

In the insert:
```ts
await tx.insert(orders).values({
  id,
  cartId,
  userId,
  paymentMethod,
  subtotalCents: subtotal,
  paymentTokenJti: opts?.paymentTokenJti ?? null,
  skyfireChargeId: opts?.skyfireChargeId ?? null,
});
```

(Confirm `orders.paymentTokenJti` and `orders.skyfireChargeId` columns exist from Phase 1 P1.5. Should — Phase 1's schema had them.)

**Step 2: Tests (RED)**

```ts
// lib/agent/__tests__/validate-and-charge.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { freshTestDb } from "@/lib/__tests__/helpers";
import { categories, products, agents as agentsTable, orders } from "@/db/schema";
import { addItem, createCart } from "@/lib/cart";
import { validateAndCharge } from "@/lib/agent/validate-and-charge";
import { MockKyaPayProvider } from "@/lib/payments/mock/kyapay";
import { MemoryIdentityProvider } from "@/lib/auth/memory/identity";
import { MemoryPermissionProvider } from "@/lib/auth/memory/permissions";
import { mintTestKeypair } from "@/lib/payments/__tests__/helpers";
import { mintKyaToken } from "@/lib/payments/mint";

const ISSUER = "http://test-issuer";
const AUDIENCE = "merchant-agentic-demo";

async function setup(args: { spendCapCents?: number | null } = {}) {
  const testDb = freshTestDb();
  testDb.db.insert(categories).values([{ slug: "a", name: "A", blurb: "" }]).run();
  testDb.db.insert(products).values([
    { id: "p1", slug: "p1", name: "Tee", description: "", priceCents: 5000, imageUrl: "x", categorySlug: "a" },
  ]).run();
  const { publicKey, privateKey, publicJwk } = await mintTestKeypair();
  const kyaPay = new MockKyaPayProvider({
    publicKey, publicJwk,
    issuer: ISSUER, audience: AUDIENCE, sellerServiceId: AUDIENCE,
  });
  const identity = new MemoryIdentityProvider();
  const permission = new MemoryPermissionProvider();
  const owner = await identity.createUser({ email: "alice@example.com" });
  const agent = await identity.createAgent({ displayName: "Shoppy", ownerIdentityId: owner.id, agentType: "shopping" });
  testDb.db.insert(agentsTable).values({
    id: agent.id, displayName: agent.displayName, ownerUserId: owner.id,
    agentType: "shopping", hydraClientId: "hydra-x",
    spendCapCents: args.spendCapCents === undefined ? 100000 : args.spendCapCents,
  }).run();
  const cartId = await createCart(testDb.db);
  await addItem(testDb.db, cartId, "p1", 1);
  return { testDb, kyaPay, privateKey, identity, permission, owner, agent, cartId };
}

describe("validateAndCharge (Phase 6 real impl)", () => {
  it("happy path: writes order, charges, decrements cap", async () => {
    const s = await setup({ spendCapCents: 100000 });
    const token = await mintKyaToken({
      agentId: s.agent.id, agentName: "Shoppy", userEmail: "alice@example.com",
      amountCents: 5000, issuer: ISSUER, audience: AUDIENCE, sellerServiceId: AUDIENCE,
      privateKey: s.privateKey,
    });
    const result = await validateAndCharge({
      kyaJwt: token,
      cart: { items: [{ productId: "p1", quantity: 1, priceCents: 5000 }], totalCents: 5000 },
      ctx: { agentId: s.agent.id, ownerUserId: s.owner.id, cartId: s.cartId },
      deps: { db: s.testDb.db, kyaPay: s.kyaPay, identity: s.identity, permission: s.permission },
    });
    expect(result.status).toBe(200);
    expect(result.body.orderId).toBeTruthy();
    const order = await s.testDb.db.query.orders.findFirst({ where: eq(orders.id, result.body.orderId as string) });
    expect(order?.paymentMethod).toBe("kyapay");
    expect(order?.skyfireChargeId).toMatch(/^mock-charge-/);
    const agentRow = await s.testDb.db.query.agents.findFirst({ where: eq(agentsTable.id, s.agent.id) });
    expect(agentRow?.spendCapCents).toBe(95000);
  });

  it("rejects expired token", async () => {
    const s = await setup();
    const token = await mintKyaToken({
      agentId: s.agent.id, agentName: "Shoppy", userEmail: "alice@example.com",
      amountCents: 5000, ttlSeconds: -100,
      issuer: ISSUER, audience: AUDIENCE, sellerServiceId: AUDIENCE, privateKey: s.privateKey,
    });
    const result = await validateAndCharge({
      kyaJwt: token, cart: { items: [], totalCents: 5000 },
      ctx: { agentId: s.agent.id, ownerUserId: s.owner.id, cartId: s.cartId },
      deps: { db: s.testDb.db, kyaPay: s.kyaPay, identity: s.identity, permission: s.permission },
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("kya_invalid");
  });

  it("rejects when amount exceeds spend cap", async () => {
    const s = await setup({ spendCapCents: 1000 });
    const token = await mintKyaToken({
      agentId: s.agent.id, agentName: "Shoppy", userEmail: "alice@example.com",
      amountCents: 5000, issuer: ISSUER, audience: AUDIENCE, sellerServiceId: AUDIENCE,
      privateKey: s.privateKey,
    });
    const result = await validateAndCharge({
      kyaJwt: token, cart: { items: [{ productId: "p1", quantity: 1, priceCents: 5000 }], totalCents: 5000 },
      ctx: { agentId: s.agent.id, ownerUserId: s.owner.id, cartId: s.cartId },
      deps: { db: s.testDb.db, kyaPay: s.kyaPay, identity: s.identity, permission: s.permission },
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe("spend_cap_exceeded");
  });

  it("rejects hid.email mismatch", async () => {
    const s = await setup();
    const token = await mintKyaToken({
      agentId: s.agent.id, agentName: "Shoppy", userEmail: "wrong@example.com",
      amountCents: 5000, issuer: ISSUER, audience: AUDIENCE, sellerServiceId: AUDIENCE,
      privateKey: s.privateKey,
    });
    const result = await validateAndCharge({
      kyaJwt: token, cart: { items: [{ productId: "p1", quantity: 1, priceCents: 5000 }], totalCents: 5000 },
      ctx: { agentId: s.agent.id, ownerUserId: s.owner.id, cartId: s.cartId },
      deps: { db: s.testDb.db, kyaPay: s.kyaPay, identity: s.identity, permission: s.permission },
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe("hid_mismatch");
  });

  it("rejects aid.id mismatch", async () => {
    const s = await setup();
    const token = await mintKyaToken({
      agentId: "different-agent", agentName: "Other", userEmail: "alice@example.com",
      amountCents: 5000, issuer: ISSUER, audience: AUDIENCE, sellerServiceId: AUDIENCE,
      privateKey: s.privateKey,
    });
    const result = await validateAndCharge({
      kyaJwt: token, cart: { items: [], totalCents: 5000 },
      ctx: { agentId: s.agent.id, ownerUserId: s.owner.id, cartId: s.cartId },
      deps: { db: s.testDb.db, kyaPay: s.kyaPay, identity: s.identity, permission: s.permission },
    });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe("aid_mismatch");
  });

  it("rejects amount mismatch with cart total", async () => {
    const s = await setup();
    const token = await mintKyaToken({
      agentId: s.agent.id, agentName: "Shoppy", userEmail: "alice@example.com",
      amountCents: 99999, issuer: ISSUER, audience: AUDIENCE, sellerServiceId: AUDIENCE,
      privateKey: s.privateKey,
    });
    const result = await validateAndCharge({
      kyaJwt: token, cart: { items: [], totalCents: 5000 },
      ctx: { agentId: s.agent.id, ownerUserId: s.owner.id, cartId: s.cartId },
      deps: { db: s.testDb.db, kyaPay: s.kyaPay, identity: s.identity, permission: s.permission },
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("amount_mismatch");
  });
});
```

**Step 3: Implement validate-and-charge**

```ts
// lib/agent/validate-and-charge.ts
import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { agents } from "@/db/schema";
import type { KyaPayProvider } from "@/lib/payments/kyapay";
import type { IdentityProvider } from "@/lib/auth/identity";
import type { PermissionProvider } from "@/lib/auth/permissions";
import { createOrderFromCart } from "@/lib/orders";

export interface CartSnapshot {
  items: { productId: string; quantity: number; priceCents: number }[];
  totalCents: number;
}

export interface ValidateAndChargeArgs {
  kyaJwt: string;
  cart: CartSnapshot;
  ctx: { agentId: string; ownerUserId: string; cartId: string };
  deps: {
    db: DB;
    kyaPay: KyaPayProvider;
    identity: IdentityProvider;
    permission: PermissionProvider;
  };
}

export interface ValidateAndChargeResult {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

const WWW_AUTHENTICATE = `KYAPay realm="merchant-agentic-demo"`;

function fail(status: number, error: string, message: string, extra: Record<string, unknown> = {}): ValidateAndChargeResult {
  return {
    status,
    headers: { "WWW-Authenticate": WWW_AUTHENTICATE, "Content-Type": "application/json" },
    body: { error, message, ...extra },
  };
}

export async function validateAndCharge(args: ValidateAndChargeArgs): Promise<ValidateAndChargeResult> {
  const { kyaJwt, cart, ctx, deps } = args;

  const v = await deps.kyaPay.verify(kyaJwt);
  if (!v.ok) return fail(400, "kya_invalid", v.message, { code: v.code });
  const claims = v.claims;

  if (claims.aid.id !== ctx.agentId) {
    return fail(403, "aid_mismatch", `Token aid.id (${claims.aid.id}) does not match agent context (${ctx.agentId})`);
  }

  const owner = await deps.identity.getById(ctx.ownerUserId);
  if (!owner) return fail(403, "owner_not_found", `Owner ${ctx.ownerUserId} not found`);
  if (claims.hid.email.toLowerCase() !== owner.email.toLowerCase()) {
    return fail(403, "hid_mismatch", `Token hid.email (${claims.hid.email}) does not match owner (${owner.email})`);
  }

  if (claims.amount !== cart.totalCents) {
    return fail(400, "amount_mismatch", `Token amount (${claims.amount}) does not match cart total (${cart.totalCents})`);
  }

  const agentRow = await deps.db.query.agents.findFirst({ where: eq(agents.id, ctx.agentId) });
  if (!agentRow) return fail(403, "agent_not_found", `Agent ${ctx.agentId} not in local DB`);
  if (agentRow.revokedAt) return fail(403, "agent_revoked", "Agent has been revoked");
  if (agentRow.spendCapCents !== null && claims.amount > agentRow.spendCapCents) {
    return fail(403, "spend_cap_exceeded",
      `Amount ${claims.amount} exceeds spend cap ${agentRow.spendCapCents}`,
      { spendCapCents: agentRow.spendCapCents });
  }

  let chargeResult;
  try {
    chargeResult = await deps.kyaPay.charge(kyaJwt, claims.amount);
  } catch (err) {
    return fail(402, "charge_failed", (err as Error).message);
  }

  const orderId = await createOrderFromCart(
    deps.db, ctx.cartId, owner.id, "kyapay",
    {
      permissions: deps.permission,
      paymentTokenJti: claims.jti,
      skyfireChargeId: chargeResult.chargeId,
    },
  );

  if (agentRow.spendCapCents !== null) {
    deps.db.update(agents)
      .set({ spendCapCents: agentRow.spendCapCents - claims.amount })
      .where(eq(agents.id, ctx.agentId))
      .run();
  }

  return {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: {
      ok: true,
      orderId,
      chargeId: chargeResult.chargeId,
      settledAt: chargeResult.settledAt.toISOString(),
      remainingSpendCapCents: agentRow.spendCapCents === null ? null : agentRow.spendCapCents - claims.amount,
    },
  };
}
```

**Step 4: Update callers**

`/api/checkout/route.ts` agent branch — replace the existing `validateAndCharge` call with:

```ts
import { getPayments } from "@/lib/payments";
// ...
const { kyaPay } = getPayments();
const { identity, permission } = getAuth();
const result = await validateAndCharge({
  kyaJwt: kyaToken,
  cart: { items, totalCents },
  ctx: {
    agentId: agentResult.ok ? agentResult.agentId : "unknown",
    ownerUserId: agentResult.ok ? agentResult.ownerUserId : "unknown",
    cartId: cartId ?? "",
  },
  deps: { db: getDb(), kyaPay, identity, permission },
});
```

`/api/mcp/route.ts` — `submitCart` tool's call to `validateAndCharge` likewise:

```ts
import { getPayments } from "@/lib/payments";
import { getAuth } from "@/lib/auth";
// inside submitCart handler:
const { kyaPay } = getPayments();
const { identity, permission } = getAuth();
const result = await validateAndCharge({
  kyaJwt: kyaToken,
  cart: { items, totalCents },
  ctx: { agentId: ctx.agentId, ownerUserId: ctx.ownerUserId, cartId: ctx.cartId },
  deps: { db: getDb(), kyaPay, identity, permission },
});
```

**Step 5: Run tests**

```bash
pnpm test 2>&1 | tail -5
```

Expected: 74 + 6 = 80 tests passing.

**Step 6: Commit**

```bash
pnpm typecheck
pnpm lint
git add -A
git commit -m "feat(agents): validateAndCharge real impl with mock-Skyfire"
```

If blocked, BLOCKED.

---

## Task 8: Mandate Panel UI on order detail

**Files:**
- Modify: `app/orders/[id]/page.tsx`

**Step 1: Add a mandate block**

After the existing order section (the items + total), add:

```tsx
{order.paymentMethod === "kyapay" && (
  <section className="rounded-lg border-2 border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/30 p-4 space-y-2">
    <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
      Mandate (KYA Pay)
    </h2>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <dt className="text-muted-foreground">Payment method</dt>
      <dd className="font-medium">KYAPay (mock Skyfire)</dd>
      <dt className="text-muted-foreground">Skyfire charge</dt>
      <dd className="font-mono text-xs">{order.skyfireChargeId ?? "—"}</dd>
      <dt className="text-muted-foreground">Token jti</dt>
      <dd className="font-mono text-xs">{order.paymentTokenJti ?? "—"}</dd>
    </dl>
  </section>
)}
```

Phase 6 takes the simple approach — show the `chargeId` and `paymentTokenJti` from the DB. We don't store the raw token, so we can't decode + display its claims. A richer "decoded claims" view is a Phase 10 polish item (would require storing the JWT or the decoded claims as JSON).

**Step 2: Smoke test manually**

(After running an end-to-end demo flow in Phase 6 Task 10, return here and verify the panel shows.)

**Step 3: Commit**

```bash
pnpm typecheck
pnpm lint
git add app/orders/\[id\]/page.tsx
git commit -m "feat(orders): mandate panel on order detail for KYAPay orders"
```

If blocked, BLOCKED.

---

## Task 9: Update demo agents to mint real tokens

**Files:**
- Modify: `scripts/demo-agent-mcp.ts`
- Modify: `scripts/demo-agent-browser.ts`

**Step 1: demo-agent-mcp.ts**

Replace `kyaToken: "fake.kya.jwt.for.phase.5"` with a real mint. **Import `mintKyaToken` directly — no `execSync`.** Add argv parsing:

```ts
import { mintKyaToken } from "../lib/payments/mint";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const token = process.env.AGENT_TOKEN;
  const agentId = arg("agent");
  const agentName = arg("agent-name") ?? "MCP Demo";
  const userEmail = arg("user-email");
  if (!token || !agentId || !userEmail) {
    console.error("Usage: AGENT_TOKEN=... pnpm demo:agent-mcp --agent <id> --user-email <email> [--agent-name <name>]");
    process.exit(1);
  }
  // ... existing tools/list, searchProducts, addToCart calls ...

  // After viewCart, compute the total from the response and mint a matching token.
  const cart = await rpc(token, "tools/call", { name: "viewCart", arguments: {} });
  const cartText = cart.result?.content?.[0]?.text ?? "{}";
  const { totalCents } = JSON.parse(cartText) as { totalCents: number };
  console.log("   → cart total:", totalCents);

  console.log("5. mintKyaToken");
  const kya = await mintKyaToken({ agentId, agentName, userEmail, amountCents: totalCents });

  console.log("6. submitCart with real KYA token");
  const submit = await rpc(token, "tools/call", { name: "submitCart", arguments: { kyaToken: kya } });
  const submitText = submit.result?.content?.[0]?.text ?? "{}";
  const result = JSON.parse(submitText) as { status: number; body: { orderId?: string; error?: string } };
  console.log("   → status:", result.status, "body:", JSON.stringify(result.body));
  if (result.status !== 200) {
    console.error("Expected 200, got:", result.status);
    process.exit(1);
  }
  console.log("✓ Order placed:", result.body.orderId);
}
```

**Step 2: demo-agent-browser.ts**

Same import + argv pattern. After adding the Merino Tee to cart, mint a token for 6500 cents (the known price) and POST to /api/checkout:

```ts
import { mintKyaToken } from "../lib/payments/mint";
// ... existing browser steps to add the merino tee ...

const agentId = process.argv[process.argv.indexOf("--agent") + 1];
const userEmail = process.argv[process.argv.indexOf("--user-email") + 1];
const kya = await mintKyaToken({
  agentId, agentName: "Browser Bot", userEmail, amountCents: 6500,
});
const res = await fetch("http://localhost:3000/api/checkout", {
  method: "POST",
  headers: { "X-KYA-Token": kya, Cookie: cookieHeader },
});
if (res.status !== 200) { /* error */ }
```

**Step 3: Commit**

```bash
pnpm typecheck
git add -A
git commit -m "feat(agents): demo scripts mint real KYA tokens via imported helper"
```

If blocked, BLOCKED.

---

## Task 10: E2E + README + final verification

**Files:**
- Create: `e2e/kyapay-checkout.spec.ts`
- Modify: `README.md`

**Step 1: E2E spec (gated)**

```ts
// e2e/kyapay-checkout.spec.ts
import { test, expect } from "@playwright/test";
import { mintKyaToken } from "../lib/payments/mint";

const skip = !process.env.TEST_AGENT_ID || !process.env.TEST_USER_EMAIL;
test.skip(skip, "TEST_AGENT_ID and TEST_USER_EMAIL must be set in .env.local for this spec");

test("HTML+X-KYA-Token: agent submits, order created with KYAPay payment_method", async ({ page }) => {
  const agentId = process.env.TEST_AGENT_ID!;
  const userEmail = process.env.TEST_USER_EMAIL!;

  await page.goto("/p/merino-tee");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/cart/items") && r.ok());

  const kya = await mintKyaToken({
    agentId, agentName: "E2E Bot", userEmail, amountCents: 6500,
  });

  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await fetch("http://localhost:3000/api/checkout", {
    method: "POST",
    headers: { "X-KYA-Token": kya, Cookie: cookieHeader },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.orderId).toBeTruthy();
  expect(body.chargeId).toMatch(/^mock-charge-/);
});
```

`test.skip` keeps CI clean when the demo agent isn't configured. A user can flip the test on by setting the two env vars.

**Step 2: README**

Add a section after "Agent surfaces":

```markdown
## KYA Pay (Phase 6 — mock Skyfire)

Phase 6 wires real KYA token verification + a mock Skyfire `chargeToken`. Order details show a Mandate panel when payment was via KYAPay.

### Setup

```bash
pnpm gen:mock-skyfire-keys
# Paste both lines into .env.local. DO NOT commit the private key.
```

### Demo flow

```bash
# Terminal 1: dev server
pnpm dev

# Terminal 2: register an agent via /me/agents UI (note the agent id from the URL or DB)
# Then mint a Hydra access token for the demo OAuth2 client and run:
AGENT_TOKEN=$(pnpm demo:mint-agent-token | tail -1) \
  pnpm demo:agent-mcp --agent <agent-id> --user-email <your-email>
```

The MCP demo agent will list tools, browse, add to cart, view cart, mint a KYA token for the exact cart total, submit, and get HTTP 200 + an order id. Visit `/orders/<id>` to see the Mandate panel.

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
```

**Step 3: Full CI**

```bash
pnpm install --frozen-lockfile
pnpm typecheck && echo "tsc OK"
pnpm lint && echo "lint OK"
pnpm test 2>&1 | tail -5
pnpm test:e2e --retries=1 2>&1 | tail -10
./scripts/ory-setup/apply.sh 2>&1 | tail -5
```

All clean. ~80 unit tests; 10 e2e tests (kyapay-checkout skipped without env).

**Step 4: Commit**

```bash
git add -A
git commit -m "docs+test(e2e): phase 6 KYAPay README + gated kyapay-checkout spec"
git rev-list --count HEAD
```

If blocked, BLOCKED.

---

## Final verification

- [ ] Full CI sequence passes locally.
- [ ] Manual demo: register agent, run `demo:agent-mcp`, order shows in `/orders` with Mandate panel.
- [ ] Tree clean, on main, ~86 commits.

---

## Phase 6 complete

End state:
- `KyaPayProvider` interface + Mock implementation against a local ES256 keypair.
- `/api/mock-skyfire/.well-known/jwks.json` serves the public key.
- `validateAndCharge` does real verification with 5 failure modes + happy path.
- Orders persist `payment_method = "kyapay"`, `payment_token_jti`, `skyfire_charge_id`.
- Spend cap decrements on each successful purchase.
- Mandate panel on order detail surfaces charge id + token jti.
- Demo agents import `mintKyaToken` directly (no `child_process`) — no command-injection risk.
- ~80 unit tests + 10 e2e tests.

**Phase 6 follow-ups (deferred):**
- Persist decoded KYA claims as JSON on the order so the Mandate panel can show full claim detail. Phase 10 polish.
- Spend cap behavior: currently decrements; consider a "per-transaction max" mode too. Phase 7 may revisit.
- The `MockKyaPayProvider`'s replay-protection set is in-memory — across server restarts, charged JTIs can be re-used. Acceptable for the demo; production would persist.

**Next:** Phase 7 — Custom Login & Consent app + token hook (against real Hydra). The agent's KYA token bootstraps a Hydra OAuth2 flow; the Login app validates the KYA, mints a Hydra-issued user-bound access token with `act` claim, the merchant authorizes against THAT token. This is the "Ory delegation envelope" payoff. See `phase-7-hydra-login-consent.md`.
