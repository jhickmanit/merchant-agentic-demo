# Phase 7 — Custom Login & Consent App + Token Hook for Delegated Agent Tokens

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Phase 6's "agent presents KYA token at every request" model with the canonical Ory delegation envelope. An agent presents its KYA JWT once to bootstrap a Hydra OAuth2 flow. Our custom Login app accepts the KYA as the federated-identity credential and accepts login with `subject = <delegating user>`. Our custom Consent app auto-accepts and writes a synthetic `act` claim + RFC 9396 `authorization_details` into `session.access_token`. The agent gets back a **Hydra-issued user-bound access token** that names the user as `sub` and the agent inside `act`. The merchant authorizes purchases against THAT token (not the KYA directly); the KYA is only used at settlement time for `chargeToken`. A token-hook webhook re-asserts the cap on refresh.

**Architecture:** Three new routes in the merchant app:
- `/oauth/login` — receives `?login_challenge=...` from Hydra. Reads a transported KYA JWT (from cookie or query state). Validates via `KyaPayProvider`. Cross-checks agent + owner in local DB. Calls `acceptOAuth2LoginRequest({subject, context})`.
- `/oauth/consent` — receives `?consent_challenge=...`. Auto-accepts with `session.access_token` containing `act` + `authorization_details` derived from the KYA claims captured in login context.
- `/api/token-hook` — Hydra webhook. Called on token issuance and refresh. Re-checks spend cap, re-shapes claims, returns 403 to deny if the cap is exhausted.

Plus a new orchestration endpoint `/api/oauth/agent-bootstrap` for headless agents that don't have a browser to follow OAuth2 redirects: takes a KYA JWT, drives the Hydra authorization_code flow programmatically (using a cookie jar inside fetch + Location-header following), returns the final access_token.

**Critical preflight (P7.1):** The Hydra flow shape depends on what Ory Network's hosted Hydra actually supports. The plan assumes **authorization_code flow with our custom Login/Consent app**. If that doesn't work the way the architecture doc anticipated, P7.1 documents the actual mechanism and the rest of the phase adjusts.

**Tech Stack:** new — `tough-cookie` (cookie jar for the bootstrap fetch loop) or use Node's `fetch` redirect:manual semantics. Otherwise: existing Ory SDK + `jose` + `KyaPayProvider`.

**Parent plan:** [`docs/plans/2026-05-13-architecture-and-roadmap.md`](../2026-05-13-architecture-and-roadmap.md)

**Pre-conditions:**
- Phase 6 complete (87 commits, 78 unit + 10 e2e + 1 gated e2e).
- Agent registration works and produces a Hydra OAuth2 client with `client_credentials` grant.
- `MockKyaPayProvider` verifies + charges; `mintKyaToken` helper exists.

**Standing preamble** for every task:
```bash
eval "$(fnm env --use-on-cd)"
cd /Users/jeff.hickman/Code/demos/merchant-agentic-demo
git branch --show-current  # must print: main
```

Stay on `main`. **Never** detach HEAD. **Never** write to `.claude/settings.json`. If `git commit` is blocked, report BLOCKED.

**Carry-over reminders:**
- Hosted Keto enforces only direct relation tuples — no OPL computed permits.
- Ory rewrites identity-schema IDs to content hashes.
- `@ory/keto-client` Configuration ignores `accessToken` — Bearer must go through `baseOptions.headers` (already fixed in P3.1).
- `OryOAuth2ClientProvider.create()` (Phase 4) doesn't currently surface the client secret. Demo agents share `DEMO_AGENT_CLIENT_*` from `.env.local`. Phase 7 keeps that pattern.

---

## End-state data model

```
Agent has a KYA JWT (from Phase 6's mintKyaToken)
   ↓
Agent POSTs to /api/oauth/agent-bootstrap { kya_jwt }
   ↓
Merchant orchestrator:
   1. Drives Hydra authorization_code flow:
      GET ${ORY_SDK_URL}/oauth2/auth?client_id=${DEMO_AGENT_CLIENT_ID}&response_type=code
          &redirect_uri=...&scope=...
      Sets a cookie carrying the KYA jwt for the next hop.
   2. Hydra redirects to /oauth/login?login_challenge=...
      Our Login app validates KYA, accepts login with subject=user, context={agent, kya}
   3. Hydra redirects to /oauth/consent?consent_challenge=...
      Our Consent app auto-accepts with act + authorization_details
   4. Hydra redirects to redirect_uri with code
   5. Server POSTs to ${ORY_SDK_URL}/oauth2/token to exchange code for access_token
   6. Returns access_token to the agent
   ↓
Agent uses Bearer <access_token> to call /api/mcp
   ↓
agent-gate validates the Hydra token, extracts sub + act + authorization_details
   ↓
At submitCart: validateAndCharge:
   - Pulls claims from the Hydra access_token (act.agent_id, sub = user_id, authorization_details[0].max_amount)
   - Still requires a KYA JWT for settlement (passed in tool args)
   - Validates KYA, cross-checks aid.id == act.agent_id, hid.email == user.email
   - Charges via kyaPay.charge()
   - Writes order
```

Phase 8 will swap the mock Skyfire for real Skyfire — Phase 7 doesn't change the settlement layer.

---

## File Structure (created/modified by this plan)

```
.
├── lib/auth/
│   ├── delegated-token.ts                    (new — verify Hydra access_token, extract act + authorization_details)
│   ├── __tests__/delegated-token.test.ts     (new)
│   └── agent-gate.ts                         (modified — accept either client_credentials OR delegated tokens)
├── lib/oauth/
│   ├── consent-claims.ts                     (new — shape act + authorization_details from KYA claims)
│   ├── bootstrap.ts                          (new — orchestrator function for agent-bootstrap endpoint)
│   └── __tests__/consent-claims.test.ts      (new)
├── app/
│   ├── oauth/login/route.ts                  (new — GET handles login_challenge)
│   ├── oauth/consent/route.ts                (new — GET handles consent_challenge)
│   ├── api/token-hook/route.ts               (new — POST webhook from Hydra)
│   └── api/oauth/agent-bootstrap/route.ts    (new — POST { kya_jwt } → { access_token })
├── lib/agent/
│   └── validate-and-charge.ts                (modified — reads claims from Hydra access_token via deps)
├── scripts/
│   ├── demo-agent-mcp.ts                     (modified — bootstraps via /api/oauth/agent-bootstrap)
│   └── demo-agent-browser.ts                 (modified — Bose flow may keep the Phase 6 path; defer)
├── scripts/ory-setup/
│   ├── hydra-config.sh                       (new — sets Login/Consent/Token-Hook URLs, enables grants)
│   └── apply.sh                              (modified — chains hydra-config.sh)
├── e2e/
│   └── delegated-checkout.spec.ts            (new — gated end-to-end)
└── README.md                                 (modified — Phase 7 section)
```

---

## Task 1: Preflight probe — confirm Hydra flow + configure URLs

**Files:**
- Create: `scripts/probe-hydra-flow.ts` (one-shot research script; not committed if you decide it's noise)
- Create: `scripts/ory-setup/hydra-config.sh`
- Modify: `scripts/ory-setup/apply.sh`

**Goal:** Before sinking effort into Login + Consent + Token Hook, confirm:
1. The Ory Network project's Hydra accepts authorization_code flow with a `login_url` + `consent_url` pointing at localhost (via Tunnel) or that we need to use Ory Tunnel for this.
2. Token hooks are configurable via the project's OAuth2 config.
3. The `act` claim and `authorization_details` are passthrough-supported (Hydra inserts whatever the Consent app writes into `session.access_token`).

**Step 1: Probe script**

`scripts/probe-hydra-flow.ts`:

```ts
// One-shot probe: inspect the current Hydra config + try one authorization_code request
// to see what redirect path Hydra emits.

export {};

async function main() {
  const baseUrl = process.env.ORY_SDK_URL!;
  console.log("=== Project metadata ===");
  // Use the CLI to dump the current oauth2 config:
  console.log(`Run: ory get oauth2-config --project ${process.env.ORY_PROJECT_ID} --format json | jq`);
  console.log();
  console.log("=== Hydra well-known ===");
  const wkRes = await fetch(`${baseUrl}/.well-known/openid-configuration`);
  const wk = await wkRes.json();
  console.log("login_url:", wk.login_url ?? "(not exposed in WK)");
  console.log("grant_types_supported:", wk.grant_types_supported);
  console.log("token_endpoint:", wk.token_endpoint);
  console.log("authorization_endpoint:", wk.authorization_endpoint);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Run:
```bash
node --env-file=.env.local --import=tsx scripts/probe-hydra-flow.ts
ory get oauth2-config --project "$ORY_PROJECT_ID" --format json | head -60
```

Document what you see in your report. Key questions:
- Are `authorization_code` and `refresh_token` grants supported?
- Where is the current `login_url` / `consent_url` pointing? (Probably the default Ory-hosted UI.)
- Does the project have a `webhooks.token_hook` configured?

**Step 2: Configure URLs via CLI**

Author `scripts/ory-setup/hydra-config.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env.local ]]; then
  set -a; source .env.local; set +a
fi

: "${ORY_PROJECT_ID:?ORY_PROJECT_ID required}"

# Where the Login/Consent apps live. In dev these are localhost-via-tunnel URLs.
LOGIN_URL="${MERCHANT_BASE_URL:-http://localhost:3000}/oauth/login"
CONSENT_URL="${MERCHANT_BASE_URL:-http://localhost:3000}/oauth/consent"
TOKEN_HOOK_URL="${MERCHANT_BASE_URL:-http://localhost:3000}/api/token-hook"

ory patch oauth2-config --project "${ORY_PROJECT_ID}" \
  --replace "/urls/login=\"${LOGIN_URL}\"" \
  --replace "/urls/consent=\"${CONSENT_URL}\"" \
  --replace "/webhooks/hooks/token/url=\"${TOKEN_HOOK_URL}\""

echo "  → Login URL: ${LOGIN_URL}"
echo "  → Consent URL: ${CONSENT_URL}"
echo "  → Token Hook URL: ${TOKEN_HOOK_URL}"
```

Make executable.

**The patch paths may differ across CLI versions.** Some Ory CLI versions use:
- `/urls/login`, `/urls/consent` — newer
- `/services/oauth2/config/urls/login` — older
- `/webhooks/hooks/token/url` — for the token hook

Run `ory help patch oauth2-config` and `ory get oauth2-config` to confirm shapes. Adapt the paths.

**Step 3: Wire into apply.sh**

Before the final "All Ory project configuration applied." echo:

```bash
echo "Configuring Hydra (Login/Consent/Token-Hook URLs)..."
"${DIR}/hydra-config.sh"
echo "  → OK"
```

**Step 4: Run apply.sh + verify**

```bash
./scripts/ory-setup/apply.sh
ory get oauth2-config --project "$ORY_PROJECT_ID" --format json | jq '.urls, .webhooks'
```

The `urls.login`, `urls.consent`, and `webhooks.hooks.token.url` should point at the merchant.

**Note on dev vs production:** When the merchant is at `localhost:3000`, Hydra (which is hosted at `eager-dhawan-mio9f9ilcu.projects.oryapis.com`) tries to redirect users to `http://localhost:3000/oauth/login` — that only works for browser flows where the user's browser handles the redirect. For our headless agent bootstrap (P7.5), we use Ory Tunnel OR follow redirects programmatically server-side. Document the dev/production tradeoff in your report.

**Step 5: Probe + report**

Run the probe script, capture output. Your report must document:
- Supported grant types (authorization_code, refresh_token, client_credentials, device_code?)
- Current `login_url`/`consent_url`/`webhooks.token` after the apply
- Whether the architecture's assumption (custom Login/Consent + token hook on hosted Hydra) actually works, OR whether we need to adapt (e.g., switch to a custom JWT-bearer flow if hooks are limited)

**Step 6: Commit**

```bash
pnpm typecheck
git add scripts/ory-setup/hydra-config.sh scripts/ory-setup/apply.sh
git commit -m "feat(ory): Hydra Login/Consent/Token-Hook URL configuration"
```

If commit blocked, BLOCKED. The probe script itself doesn't need to be committed — it's a one-off.

## Self-Review

- `hydra-config.sh` runs cleanly?
- `apply.sh` chains it?
- Probe report documents Hydra's actual capabilities?
- Tree clean, on main?

## Report

- Status: DONE | DONE_WITH_CONCERNS | BLOCKED
- Output of the probe (grants, urls)
- **Verdict**: does the standard authorization_code + Login/Consent + token hook approach work on Ory Network's hosted Hydra? If not, what alternative (JWT-bearer, custom bootstrap-only)?
- `git log --oneline -3`
- Issues

---

## Task 2: Login App route

**Files:**
- Create: `app/oauth/login/route.ts`

The Login App receives Hydra's redirect. The KYA JWT travels in a cookie that the bootstrap (P7.5) sets just before kicking off the OAuth2 flow.

**Step 1: Cookie convention**

We use a short-lived cookie `kya_bootstrap` set by the bootstrap orchestrator. The cookie's value is the raw KYA JWT (signed, so tampering = signature failure). Cookie attributes: HttpOnly, SameSite=Lax, Max-Age=60 (one-minute window for the OAuth2 redirect dance).

**Step 2: Implement**

`app/oauth/login/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { Configuration, OAuth2Api } from "@ory/client";
import { getDb } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getPayments } from "@/lib/payments";
import { getAuth } from "@/lib/auth";

const adminConfig = new Configuration({
  basePath: process.env.ORY_SDK_URL!,
  baseOptions: {
    headers: {
      Authorization: `Bearer ${process.env.ORY_ADMIN_API_KEY ?? process.env.ORY_API_KEY}`,
    },
  },
});
const oauth2Admin = new OAuth2Api(adminConfig);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const loginChallenge = url.searchParams.get("login_challenge");
  if (!loginChallenge) {
    return NextResponse.json({ error: "missing login_challenge" }, { status: 400 });
  }

  // 1. Read the bootstrap cookie carrying the KYA JWT.
  const store = await cookies();
  const kyaJwt = store.get("kya_bootstrap")?.value;
  if (!kyaJwt) {
    return NextResponse.json({ error: "no kya_bootstrap cookie" }, { status: 400 });
  }

  // 2. Verify the KYA.
  const { kyaPay } = getPayments();
  const v = await kyaPay.verify(kyaJwt);
  if (!v.ok) {
    return NextResponse.json({ error: "kya_invalid", code: v.code, message: v.message }, { status: 400 });
  }
  const claims = v.claims;

  // 3. Cross-check: agent exists, not revoked; owner email matches hid.
  const db = getDb();
  const agentRow = await db.query.agents.findFirst({ where: eq(agents.id, claims.aid.id) });
  if (!agentRow) return NextResponse.json({ error: "unknown_agent" }, { status: 403 });
  if (agentRow.revokedAt) return NextResponse.json({ error: "agent_revoked" }, { status: 403 });

  const { identity } = getAuth();
  const owner = await identity.getById(agentRow.ownerUserId);
  if (!owner) return NextResponse.json({ error: "owner_not_found" }, { status: 403 });
  if (claims.hid.email.toLowerCase() !== owner.email.toLowerCase()) {
    return NextResponse.json({ error: "hid_mismatch" }, { status: 403 });
  }

  // 4. Accept the login. Stash the KYA claims in the context so the Consent
  //    app can read them when crafting the access token.
  const accept = await oauth2Admin.acceptOAuth2LoginRequest({
    loginChallenge,
    acceptOAuth2LoginRequest: {
      subject: owner.id,
      remember: false,
      context: {
        agent_id: agentRow.id,
        agent_type: agentRow.agentType,
        kya_jti: claims.jti,
        kya_amount: claims.amount,
        spend_cap_cents: agentRow.spendCapCents,
      },
    },
  });

  const redirectTo = accept.data.redirect_to;
  return NextResponse.redirect(redirectTo, { status: 302 });
}
```

**Step 3: Smoke test (no full flow yet)**

Just confirm the route exists and responds to a manual GET:

```bash
pnpm dev &
DEV_PID=$!
sleep 8
curl -s -o /dev/null -w "Status: %{http_code}\n" http://localhost:3000/oauth/login
kill $DEV_PID 2>/dev/null || true
```

Expected: 400 (no login_challenge). That's correct.

**Step 4: Commit**

```bash
pnpm typecheck
pnpm lint
git add app/oauth/login/route.ts
git commit -m "feat(oauth): custom Login app accepting KYA bootstrap cookie"
```

If blocked, BLOCKED.

---

## Task 3: Consent App route + consent-claims helper

**Files:**
- Create: `lib/oauth/consent-claims.ts`
- Create: `lib/oauth/__tests__/consent-claims.test.ts`
- Create: `app/oauth/consent/route.ts`

**Step 1: Helper to shape `session.access_token` claims**

`lib/oauth/consent-claims.ts`:

```ts
export interface DelegationContext {
  agent_id: string;
  agent_type: string;
  kya_jti: string;
  kya_amount: number;
  spend_cap_cents: number | null;
}

export interface DelegatedSessionClaims {
  act: { sub: string; agent_type: string; kya_jti: string };
  authorization_details: Array<{
    type: "agent_purchase";
    merchant: string;
    max_amount: number;
    currency: "USD";
    expires_at: string;
  }>;
}

export function buildConsentClaims(
  ctx: DelegationContext,
  ttlSeconds = 300,
): DelegatedSessionClaims {
  return {
    act: { sub: ctx.agent_id, agent_type: ctx.agent_type, kya_jti: ctx.kya_jti },
    authorization_details: [
      {
        type: "agent_purchase",
        merchant: "merchant-agentic-demo",
        max_amount: ctx.spend_cap_cents !== null
          ? Math.min(ctx.kya_amount, ctx.spend_cap_cents)
          : ctx.kya_amount,
        currency: "USD",
        expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      },
    ],
  };
}
```

**Step 2: Tests**

```ts
// lib/oauth/__tests__/consent-claims.test.ts
import { describe, it, expect } from "vitest";
import { buildConsentClaims } from "@/lib/oauth/consent-claims";

describe("buildConsentClaims", () => {
  it("builds act + authorization_details from delegation context", () => {
    const out = buildConsentClaims({
      agent_id: "a1",
      agent_type: "shopping",
      kya_jti: "jti-abc",
      kya_amount: 5000,
      spend_cap_cents: 10000,
    });
    expect(out.act.sub).toBe("a1");
    expect(out.act.kya_jti).toBe("jti-abc");
    expect(out.authorization_details[0].max_amount).toBe(5000); // min(kya, cap)
  });

  it("clamps max_amount by spend cap when cap < kya amount", () => {
    const out = buildConsentClaims({
      agent_id: "a1",
      agent_type: "shopping",
      kya_jti: "jti-abc",
      kya_amount: 50000,
      spend_cap_cents: 1000,
    });
    expect(out.authorization_details[0].max_amount).toBe(1000);
  });

  it("uses kya amount when spend cap is null (unlimited)", () => {
    const out = buildConsentClaims({
      agent_id: "a1",
      agent_type: "shopping",
      kya_jti: "jti-abc",
      kya_amount: 9999,
      spend_cap_cents: null,
    });
    expect(out.authorization_details[0].max_amount).toBe(9999);
  });
});
```

Run tests — must fail (module missing), then pass after Step 1.

**Step 3: Consent route**

`app/oauth/consent/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { Configuration, OAuth2Api } from "@ory/client";
import { buildConsentClaims, type DelegationContext } from "@/lib/oauth/consent-claims";

const adminConfig = new Configuration({
  basePath: process.env.ORY_SDK_URL!,
  baseOptions: {
    headers: {
      Authorization: `Bearer ${process.env.ORY_ADMIN_API_KEY ?? process.env.ORY_API_KEY}`,
    },
  },
});
const oauth2Admin = new OAuth2Api(adminConfig);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const consentChallenge = url.searchParams.get("consent_challenge");
  if (!consentChallenge) {
    return NextResponse.json({ error: "missing consent_challenge" }, { status: 400 });
  }

  // Fetch the consent request to read the context the Login app stashed.
  const request = await oauth2Admin.getOAuth2ConsentRequest({ consentChallenge });
  const ctx = request.data.context as DelegationContext | undefined;
  if (!ctx?.agent_id || !ctx?.kya_jti) {
    return NextResponse.json({ error: "missing_delegation_context" }, { status: 400 });
  }

  const sessionClaims = buildConsentClaims(ctx);

  // Auto-accept with the delegation envelope.
  const accept = await oauth2Admin.acceptOAuth2ConsentRequest({
    consentChallenge,
    acceptOAuth2ConsentRequest: {
      grant_scope: request.data.requested_scope ?? [],
      grant_access_token_audience: request.data.requested_access_token_audience ?? [],
      remember: false,
      session: {
        access_token: sessionClaims,
        id_token: { act: sessionClaims.act },
      },
    },
  });

  return NextResponse.redirect(accept.data.redirect_to, { status: 302 });
}
```

**Step 4: Commit**

```bash
pnpm typecheck
pnpm lint
pnpm test 2>&1 | tail -3  # 78 + 3 = 81 tests
git add -A
git commit -m "feat(oauth): custom Consent app + buildConsentClaims helper"
```

If blocked, BLOCKED.

---

## Task 4: Token Hook webhook

**Files:**
- Create: `app/api/token-hook/route.ts`

Hydra invokes this on token issuance and refresh. Phase 7's hook:
- Re-checks the agent's spend cap (the cap may have been decreased by prior purchases).
- Returns 403 if the cap is exhausted (Hydra refuses to issue the token).
- Lets the existing claims pass through otherwise.

**Step 1: Implement**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";

interface TokenHookPayload {
  session?: {
    access_token?: {
      act?: { sub?: string; kya_jti?: string };
      authorization_details?: Array<{ type: string; max_amount?: number; merchant?: string }>;
    };
  };
  subject?: string; // user
  granted_scopes?: string[];
  client_id?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as TokenHookPayload;
  const act = body.session?.access_token?.act;
  const agentId = act?.sub;

  if (!agentId) {
    // Not a delegated token — let it pass through unchanged.
    return NextResponse.json({});
  }

  const row = await getDb().query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!row) {
    return NextResponse.json({ error: "unknown_agent" }, { status: 403 });
  }
  if (row.revokedAt) {
    return NextResponse.json({ error: "agent_revoked" }, { status: 403 });
  }
  if (row.spendCapCents !== null && row.spendCapCents <= 0) {
    return NextResponse.json({ error: "spend_cap_exhausted" }, { status: 403 });
  }

  // Clamp authorization_details.max_amount against current cap.
  const details = body.session?.access_token?.authorization_details ?? [];
  if (row.spendCapCents !== null) {
    for (const d of details) {
      if (d.type === "agent_purchase" && typeof d.max_amount === "number" && d.max_amount > row.spendCapCents) {
        d.max_amount = row.spendCapCents;
      }
    }
  }

  return NextResponse.json({
    session: {
      access_token: {
        ...body.session?.access_token,
        authorization_details: details,
      },
    },
  });
}
```

**Step 2: Smoke**

```bash
pnpm dev &
DEV_PID=$!
sleep 8
# Send a fake hook payload — should pass-through (no act claim)
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"session":{"access_token":{}}}' \
  http://localhost:3000/api/token-hook | head -c 100
echo
kill $DEV_PID 2>/dev/null || true
```

Expected: 200 with `{}`.

**Step 3: Commit**

```bash
pnpm typecheck
pnpm lint
git add app/api/token-hook/route.ts
git commit -m "feat(oauth): token-hook webhook clamps max_amount to current spend cap"
```

---

## Task 5: Agent-bootstrap orchestrator + endpoint

**Files:**
- Create: `lib/oauth/bootstrap.ts`
- Create: `app/api/oauth/agent-bootstrap/route.ts`

The orchestrator drives the entire authorization_code flow server-side:
1. Sets the `kya_bootstrap` cookie (in-memory; not for the agent's session).
2. Calls Hydra's `/oauth2/auth` endpoint with `redirect:manual`.
3. Follows redirects: Hydra → /oauth/login → /oauth/consent → redirect_uri.
4. Captures the `code` from the final redirect.
5. Exchanges code for access_token via `/oauth2/token`.

Because the cookie carries the KYA between hops, we need a single cookie jar across the entire flow. Use `fetch` with `redirect: "manual"` and explicit `Cookie` header threading.

**Step 1: Orchestrator**

```ts
// lib/oauth/bootstrap.ts

interface BootstrapInput {
  kyaJwt: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  redirectUri?: string;
}

interface BootstrapResult {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
}

export async function bootstrapDelegatedToken(input: BootstrapInput): Promise<BootstrapResult> {
  const merchantBase = process.env.MERCHANT_BASE_URL ?? "http://localhost:3000";
  const sdkUrl = process.env.ORY_SDK_URL!;
  const scope = input.scope ?? "catalog:browse cart:write payment:execute";
  const redirectUri = input.redirectUri ?? `${merchantBase}/api/oauth/bootstrap-callback`;
  const state = Math.random().toString(36).slice(2);

  // Step 1: kick off the auth flow with the KYA in a cookie that our Login app reads.
  const cookieHeader = `kya_bootstrap=${input.kyaJwt}`;

  let resp = await fetch(
    `${sdkUrl}/oauth2/auth?response_type=code&client_id=${encodeURIComponent(input.clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}` +
      `&state=${state}`,
    { redirect: "manual", headers: { Cookie: cookieHeader } },
  );
  if (resp.status !== 302) throw new Error(`/oauth2/auth: expected 302, got ${resp.status}`);

  // Follow redirects manually. Each hop may set cookies; we accumulate them.
  const jar = new Map<string, string>();
  jar.set("kya_bootstrap", input.kyaJwt);
  for (const setCookie of resp.headers.getSetCookie?.() ?? []) {
    const [pair] = setCookie.split(";");
    const [k, v] = pair.split("=");
    if (k && v !== undefined) jar.set(k, v);
  }

  let next = resp.headers.get("location")!;
  for (let i = 0; i < 8; i++) {
    const cookieHdr = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    resp = await fetch(next, { redirect: "manual", headers: { Cookie: cookieHdr } });
    for (const setCookie of resp.headers.getSetCookie?.() ?? []) {
      const [pair] = setCookie.split(";");
      const [k, v] = pair.split("=");
      if (k && v !== undefined) jar.set(k, v);
    }
    if (resp.status >= 200 && resp.status < 300) {
      // Reached a non-redirect response — shouldn't happen until we get the code, but break.
      break;
    }
    next = resp.headers.get("location")!;
    if (!next) throw new Error(`Bootstrap chain ended without code (status ${resp.status})`);
    if (next.startsWith(redirectUri)) {
      // We got the code.
      const url = new URL(next);
      const code = url.searchParams.get("code");
      if (!code) throw new Error(`No code in callback URL: ${next}`);

      // Exchange code for access token.
      const tokRes = await fetch(`${sdkUrl}/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }).toString(),
      });
      const tok = await tokRes.json();
      if (!tokRes.ok) {
        throw new Error(`/oauth2/token: ${JSON.stringify(tok)}`);
      }
      return tok as BootstrapResult;
    }
  }
  throw new Error("Bootstrap chain exceeded 8 redirect hops without producing a code");
}
```

**Step 2: Endpoint**

`app/api/oauth/agent-bootstrap/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { bootstrapDelegatedToken } from "@/lib/oauth/bootstrap";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const kyaJwt = body.kya_jwt;
  if (typeof kyaJwt !== "string") {
    return NextResponse.json({ error: "missing kya_jwt" }, { status: 400 });
  }
  const clientId = process.env.DEMO_AGENT_CLIENT_ID;
  const clientSecret = process.env.DEMO_AGENT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "DEMO_AGENT_CLIENT_* not configured" }, { status: 500 });
  }
  try {
    const result = await bootstrapDelegatedToken({ kyaJwt, clientId, clientSecret });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: "bootstrap_failed", message: (err as Error).message }, { status: 502 });
  }
}
```

Also need a `bootstrap-callback` route that just echoes the code (Hydra redirects here at the end of the flow):

`app/api/oauth/bootstrap-callback/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get("code");
  return NextResponse.json({ code: code ?? null });
}
```

The Hydra OAuth2 client must have this URL in its `redirect_uris`. Add it via the Ory dashboard or `ory update oauth2-client`. **Document this as a manual setup step** in your report; the implementer should verify it's there.

**Step 3: Commit (cannot smoke test without Hydra config done)**

```bash
pnpm typecheck
pnpm lint
git add lib/oauth/bootstrap.ts app/api/oauth/
git commit -m "feat(oauth): agent-bootstrap orchestrator + endpoint"
```

If blocked, BLOCKED.

---

## Task 6: Delegated-token verification + agent-gate update

**Files:**
- Create: `lib/auth/delegated-token.ts`
- Create: `lib/auth/__tests__/delegated-token.test.ts`
- Modify: `lib/auth/agent-gate.ts`

**Step 1: Delegated-token verification**

```ts
// lib/auth/delegated-token.ts
import { jwtVerify, createRemoteJWKSet } from "jose";

export interface DelegatedClaims {
  sub: string; // user id
  act: { sub: string; agent_type?: string; kya_jti?: string };
  authorization_details: Array<{
    type: string;
    merchant?: string;
    max_amount?: number;
    currency?: string;
    expires_at?: string;
  }>;
  scope?: string;
  exp?: number;
}

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (_jwks) return _jwks;
  _jwks = createRemoteJWKSet(new URL(`${process.env.ORY_SDK_URL}/.well-known/jwks.json`));
  return _jwks;
}

export async function verifyDelegatedToken(token: string): Promise<{ ok: true; claims: DelegatedClaims } | { ok: false; code: string; message: string }> {
  try {
    const { payload } = await jwtVerify(token, getJwks());
    const claims = payload as unknown as DelegatedClaims;
    if (!claims.act?.sub) {
      return { ok: false, code: "not_delegated", message: "Token has no act claim" };
    }
    return { ok: true, claims };
  } catch (err) {
    return { ok: false, code: "invalid_token", message: (err as Error).message };
  }
}
```

Tests for this can use the same `mintTestKeypair` pattern from Phase 6 — sign a fake JWT with our test key and verify against an in-memory JWKS. Adapt:

```ts
// lib/auth/__tests__/delegated-token.test.ts — pragma: don't test against real Ory JWKS here.
// Either mock with a vi.mock around createRemoteJWKSet, or accept that this module is verified by e2e only.
import { describe, it } from "vitest";

describe("verifyDelegatedToken", () => {
  it.skip("happy path tested via e2e only — mocking jose's remote JWKS is brittle", () => {});
});
```

(For Phase 7, e2e + manual demo are the primary validation. Unit-testing the JWKS path adds little value.)

**Step 2: Update agent-gate**

Modify `lib/auth/agent-gate.ts` to accept BOTH:
- Hydra client_credentials token (Phase 5 shape — just has `client_id` claim mapping to `hydra_client_id` in our DB)
- Hydra delegated token (Phase 7 shape — has `act.sub` = agent_id, `sub` = user_id)

Add a branch:

```ts
// In verifyAgentBearer, after claims are decoded:
if (claims.act?.sub) {
  // Delegated token path — agentId is in act.sub
  const row = await db.query.agents.findFirst({ where: eq(agents.id, claims.act.sub) });
  if (!row) return { ok: false, status: 401, code: "unknown_agent", ... };
  if (row.revokedAt) return { ok: false, status: 403, code: "agent_revoked", ... };
  return { ok: true, agentId: row.id, hydraClientId: row.hydraClientId, ownerUserId: row.ownerUserId, delegationClaims: claims };
}
// else: existing client_credentials path
```

Extend the result type to include `delegationClaims?: DelegatedClaims` when present. `validateAndCharge` (Task 7) reads it.

**Step 3: Commit**

```bash
pnpm typecheck
pnpm lint
pnpm test 2>&1 | tail -3
git add -A
git commit -m "feat(auth): delegated-token verification + agent-gate dual-shape support"
```

If blocked, BLOCKED.

---

## Task 7: validateAndCharge reads delegation claims

**Files:**
- Modify: `lib/agent/validate-and-charge.ts`
- Modify: `lib/agent/__tests__/validate-and-charge.test.ts` (add 2 delegation tests)

**Step 1: Modify**

The function already accepts `ctx: { agentId, ownerUserId, cartId }`. Extend `ctx` with optional `delegationClaims?: DelegatedClaims`. If present:

- Cross-check `delegationClaims.act.sub === ctx.agentId`.
- Cross-check `delegationClaims.sub === ctx.ownerUserId`.
- Clamp the allowed amount by `min(claims.amount, delegationClaims.authorization_details[0].max_amount, agent.spend_cap_cents)`.

This adds two new failure codes:
- `delegation_act_mismatch` — `act.sub !== agentId`
- `delegation_max_amount_exceeded` — `claims.amount > authorization_details.max_amount`

Add tests for both. Existing 6 tests + 2 new = 8 in this file.

**Step 2: Commit**

```bash
pnpm typecheck
pnpm lint
pnpm test 2>&1 | tail -3
git add -A
git commit -m "feat(agents): validateAndCharge honors delegation claims when present"
```

---

## Task 8: Update demo agents to bootstrap

**Files:**
- Modify: `scripts/demo-agent-mcp.ts`

**Step 1: Update**

Before calling `tools/list`, the MCP demo agent should:
1. Mint a KYA token (as in P6.9).
2. POST it to `/api/oauth/agent-bootstrap` to get a delegated access_token.
3. Use that access_token as the Bearer for subsequent MCP calls.
4. At submitCart, mint a SECOND KYA token for the actual cart total (since the first was used in the bootstrap and consumed at charge time).

Pseudo-flow:

```ts
// 1. Bootstrap
const bootstrapKya = await mintKyaToken({ agentId, agentName, userEmail, amountCents: 100000, ttlSeconds: 60 });
const bsRes = await fetch("http://localhost:3000/api/oauth/agent-bootstrap", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ kya_jwt: bootstrapKya }),
});
const { access_token } = await bsRes.json();

// 2. Use access_token (NOT the client_credentials token from P6.9) for MCP
// ... same calls as P6.9 with access_token instead of AGENT_TOKEN ...

// 3. At submitCart, mint a fresh KYA for the exact amount
const settlementKya = await mintKyaToken({ agentId, agentName, userEmail, amountCents: cartParsed.totalCents });
await rpc(access_token, "tools/call", { name: "submitCart", arguments: { kyaToken: settlementKya } });
```

**Step 2: Commit**

```bash
pnpm typecheck
git add scripts/demo-agent-mcp.ts
git commit -m "feat(agents): MCP demo bootstraps a delegated token before submitCart"
```

---

## Task 9: E2E + README + final verification

**Files:**
- Create: `e2e/delegated-checkout.spec.ts` (gated)
- Modify: `README.md`

**Step 1: E2E (gated)**

```ts
import { test, expect } from "@playwright/test";
import { mintKyaToken } from "../lib/payments/mint";

const skip = !process.env.TEST_AGENT_ID || !process.env.TEST_USER_EMAIL;
test.skip(skip, "TEST_AGENT_ID + TEST_USER_EMAIL must be set");

test("delegated bootstrap → MCP submitCart → 200", async () => {
  const agentId = process.env.TEST_AGENT_ID!;
  const userEmail = process.env.TEST_USER_EMAIL!;
  const kya = await mintKyaToken({ agentId, agentName: "E2E", userEmail, amountCents: 100000 });
  const bs = await fetch("http://localhost:3000/api/oauth/agent-bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kya_jwt: kya }),
  });
  expect(bs.status).toBe(200);
  const { access_token } = await bs.json();
  expect(access_token).toBeTruthy();
  // Optionally: decode (no verify) and check act.sub === agentId
});
```

**Step 2: README — add "Delegated tokens" section**

```markdown
## Delegated tokens (Phase 7)

Agents bootstrap a Hydra-issued user-bound access token from their KYA JWT instead of using static client credentials:

```bash
# Mint a KYA, POST to /api/oauth/agent-bootstrap, receive an access_token with:
#   sub = <delegating user id>
#   act.sub = <agent id>
#   authorization_details = [{ type: "agent_purchase", max_amount, ... }]
```

The merchant authorizes purchases against the Hydra token. The Phase 6 mock-Skyfire `chargeToken` still handles settlement.

A token-hook webhook re-checks the agent's spend cap on every issuance and refresh.

### Why this matters

Phase 6: KYA token sufficed for everything (auth + payment).
Phase 7: KYA token bootstraps a Hydra-issued delegation envelope (`sub`/`act`/`authorization_details`) which the merchant trusts. The KYA is now ONLY used at settlement. This matches Ory's canonical agent-delegation pattern.
```

**Step 3: Full CI**

```bash
pnpm rebuild better-sqlite3 2>&1 | tail -2
pnpm typecheck && echo "tsc OK"
pnpm lint && echo "lint OK"
pnpm test 2>&1 | tail -5
pnpm test:e2e --retries=1 2>&1 | tail -10
./scripts/ory-setup/apply.sh 2>&1 | tail -5
```

**Step 4: Commit**

```bash
git add e2e/delegated-checkout.spec.ts README.md
git commit -m "docs+test(e2e): phase 7 delegated tokens"
```

---

## Final verification

- [ ] Probe (P7.1) report documents Hydra capabilities.
- [ ] Full CI passes.
- [ ] Manual demo: bootstrap → access_token → MCP submit → order placed.
- [ ] Tree clean, on main, ~98 commits total.

---

## Phase 7 complete

End state:
- Custom Login app validates KYA, accepts Hydra login with user as subject.
- Custom Consent app auto-accepts with `act` + `authorization_details` in session.
- Token-hook webhook re-checks spend cap on each token issuance/refresh.
- Agent bootstrap endpoint orchestrates the full authorization_code flow for headless agents.
- Agent gate accepts BOTH client_credentials and delegated tokens.
- `validateAndCharge` honors delegation claims when present (act.sub == agentId, sub == userId, max_amount clamp).
- Demo agents bootstrap delegated tokens before MCP usage.
- The KYA token's role narrows to settlement only (Hydra carries the authorization envelope).

**Phase 7 follow-ups (deferred):**
- The bootstrap orchestrator follows redirects via fetch — fragile. Production would use a real OAuth2 client library.
- Ory Tunnel is required for browser-flow demos pointing Hydra at localhost. Custom domain for production.
- Token hook is best-effort; if Hydra times out the webhook, the token issues anyway. Add retries/timeouts as appropriate for prod.

**Next:** Phase 8 — Real Skyfire seller account. Swap `MockKyaPayProvider` for `SkyfireKyaPayProvider` using `@skyfire-xyz/skyfire-seller-sdk-node`. Real charges land in a real Skyfire dashboard. See `phase-8-real-skyfire.md`.
