# Research Summary — Merchant + Agentic Commerce Demo

Compiled 2026-05-13 from three parallel research agents.

## TL;DR

This demo sits at the intersection of three things that have all matured significantly in 2025–2026:

1. **Ory** has an official **Agentic IAM** reference architecture (`ory.com/docs/solutions/agentic`) that names Kratos / Hydra / Keto / Oathkeeper by role for exactly this use case.
2. **Skyfire** ships **KYAPay** as an open protocol (CC BY-SA, June 2025) with real ES256-signed JWTs, a hosted settlement layer, and a published partnership with Ory.
3. The merchant side has converged on **ACP** (Stripe/OpenAI/Meta's Agentic Commerce Protocol) + **MCP** for the agent surface, alongside a normal human web UI.

We are building the canonical reference for "Ory authenticates → Skyfire pays → ACP/MCP shape the agent surface." It is not greenfield architecture — we are wiring together existing standards.

---

## Ory side — what each product does

| Product | Role |
|---|---|
| **Kratos** | Identity store for **both humans and agents**, using two identity schemas. Agent traits include `agent_id`, `owner_identity_id` (FK to user), `kya_credential_id`, `agent_type`, `attestation_url`. |
| **Hydra** | OAuth2/OIDC provider. Mints **delegated agent tokens** via RFC 8693 token exchange (KYA JWT in, merchant-scoped access token out). Uses **RFC 9396 Rich Authorization Requests** for spend caps and merchant constraints. |
| **Keto** | Authorization. Models the user → agent delegation graph, per-merchant grants, spend caps. Each agent is a subject set with relations like `can_purchase_at`, `spend_cap`. |
| **Oathkeeper** | Identity-aware proxy in front of the agent API surface only. Validates JWTs, calls Keto, injects identity headers. Humans use Kratos sessions directly — no Oathkeeper hop. |
| **Ory Network** | Managed hosting for the above. Use the free tier for the demo. |

### Identity model

- **Two Kratos identity schemas:** `user.schema.json` and `agent.schema.json`.
- Agents are first-class Kratos identities, **plus** each agent has a Hydra OAuth2 client linked via `client_metadata.kratos_identity_id`.
- The user → agent delegation link lives in **Keto**, not in Kratos traits — atomic revocation.

### Keto namespace sketch (Zanzibar-style tuples)

```
User:alice#self@alice
Order:order-123#owner@alice

Agent:shoppy#owner@alice
Agent:shoppy#can_browse@(Agent:shoppy#owner)
Agent:shoppy#can_purchase_at@merchant-demo
Agent:shoppy#spend_cap@(SpendCap:shoppy-200usd-2026-05-20)

Merchant:demo#purchasable_by@(Agent:shoppy#can_purchase_at)
```

Spend caps are a separate subject set so they can be rotated/revoked without touching the agent.

### Delegated-agent-token flow (CORRECTED 2026-05-13)

**Hydra does NOT support RFC 8693 token exchange.** The v2.0.0 release notes incorrectly claimed support; the maintainer retracted that in [discussion #3359](https://github.com/ory/hydra/discussions/3359). [Feature request #1218](https://github.com/ory/hydra/issues/1218) has been open since December 2018 with no PR. The earlier research summary read #3359 backwards.

The idiomatic Ory pattern for "agent presents external attestation, gets back a Hydra-issued scoped access token" is **Login & Consent app + token hook**, not a grant-type swap:

1. Agent obtains a Skyfire KYAPay JWT out-of-band.
2. Agent kicks off a standard OAuth2 flow against Hydra. **RFC 8628 Device Authorization Grant** (added v25.4.0) is Ory's blessed primitive for agent flows; `authorization_code` or `client_credentials` also work. Note: **RFC 8628, not 8693.**
3. The **Login App** (which the integrator builds — Hydra has no user DB) receives the KYAPay JWT (via custom header, form param, or pre-redirect bootstrap), validates it against Skyfire's JWKS, then calls `PUT /admin/oauth2/auth/requests/login/accept` with `subject = <delegating user>` and the agent + KYA claims stashed in `context`.
4. The **Consent App** reads `context`, auto-accepts when a valid delegation is present, and writes the delegation envelope into `session.access_token` — including a synthetic `act` claim (Hydra has no first-class `act` slot; you assemble it yourself as an extra claim), the merchant-scoped grant, and any RFC 9396 `authorization_details`.
5. A configured **OAuth2 token hook** (Hydra webhook fired on issuance and refresh) re-asserts these claims at refresh time and can enforce per-merchant spend caps server-side.

Reference: [Login & Consent flow doc](https://www.ory.com/docs/oauth2-oidc/custom-login-consent/flow), [Customize claims with OAuth2 webhooks](https://www.ory.com/docs/hydra/guides/claims-at-refresh). The Ory + Skyfire blog posts describe this as "joint middleware available on GitHub" — i.e. integrator code, not a built-in grant.

The earlier-cited `act`/`sub` shape of RFC 8693 is conceptually what we mint, but it's done by writing the claim ourselves at consent time and on token-hook refresh — not by Hydra implementing 8693.

### Recent Ory updates that matter

- **Ory × Skyfire partnership posts** (multiple) confirming KYAPay over OAuth2/OIDC is the intended integration shape. These are the only public Ory guidance on the integration; they describe the bridging as "joint middleware (available on GitHub)."
- **RFC 8628 Device Authorization Grant** added in Hydra v25.4.0 — Ory's chosen primitive for agent authorization (not RFC 8693).
- Note: `ory.com/docs/solutions/agentic` currently returns **404**. Don't cite it; there is no formal solution page yet.

---

## Skyfire KYAPay — the agent payment side

### What it is

- **KYA** = identity attestation layer (Experian adopted it as the identity layer for their "Know Your Agent" framework).
- **KYAPay** = payment extension on top of KYA. Open protocol (CC BY-SA), published 2025-06-26 at kyapay.org. The deep spec pages on kyapay.org are still placeholder marketing; the real content is in `docs.skyfire.xyz` and `github.com/skyfire-xyz/kyapay`.

### Token format

ES256-signed JWT. Three token types: `kya` (identity only), `pay` (payment only), `kya-pay` (combined). JWT `typ` header is `pay+jwt` or `kya-pay+jwt`. Verified against Skyfire's JWKS (`/.well-known/jwks.json`).

Key claims a merchant verifies on a pay token:
- `iss = https://api.skyfire.xyz/`, `alg = ES256`, `jti`, `iat`, `exp`
- `aud` = merchant's Skyfire agent account ID
- `ssi` = seller service ID
- `value` / `amount` > 0, `cur = USD`
- `sps` / `spr` match published pricing

KYA claims add:
- `hid` (human identity): `email`, optional name/DOB/phone, organization, `verifier`/`verification_status`/`verification_id`
- `aid` (agent identity): `name`, `creation_ip`, optional `source_ips`

### Merchant-side flow

1. Agent arrives at merchant endpoint with a KYAPay JWT in `Authorization` header (or wherever the merchant's published service declares).
2. Merchant validates JWT signature against JWKS.
3. Merchant checks claims (audience, seller service ID, amount, currency).
4. Merchant calls `POST {api}/api/v1/tokens/charge` with `{token, chargeAmount}` and `skyfire-api-key` header. This is what actually moves money — Skyfire debits the buyer wallet, credits the seller wallet.
5. No webhook is required on the merchant side; Skyfire's dashboard handles reporting.

**No PCI scope** — no card form, no Stripe Elements equivalent. The agent shows up with a bearer token.

### Settlement

Real money. Skyfire is custodian. Funding sources: debit/credit cards, ACH, wires, or USDC. Internal settlement is USDC for instant micro-payments. Merchants withdraw to fiat or hold USDC. Sandbox via the seller dashboard.

### SDKs

- Node: `@skyfire-xyz/skyfire-seller-sdk-node` (npm) — `validate(token)` + charge helpers.
- Python: SDK referenced; `kyapay_a2a` repo for A2A agents.
- Go: referenced in coverage.

### Relationship to Ory

KYAPay does **not** authenticate the human principal — it treats the human as an attested claim (`hid`) inside the JWT. The verifier of that claim is an external IdP (Experian's H2A binding, or any OIDC IdP).

**Skyfire's published reference uses Ory by default** (verified 2026-05-13). The flagship demo, [`skyfire-xyz/skyfire-solutions-demo`](https://github.com/skyfire-xyz/skyfire-solutions-demo), wires Ory as the IdP and uses **`@ory/mcp-access-control`** — an Ory-published package — inside the merchant MCP server to gate access. Variants exist for Keycloak (`-keycloak-demo`) and Okta (`-okta-demo`). The natural integration is therefore already exemplified: Ory mints the human OIDC identity → custom-token-exchange (via Login/Consent + token hook, see §3) binds the human into a Skyfire-issued KYA token → agent calls merchant MCP, which validates the KYAPay JWT (via `@skyfire-xyz/skyfire-seller-sdk-node`) and charges.

### How the Skyfire published reference is built (verified)

- **Agent side:** TypeScript using Vercel AI SDK, or Python using Strands or AutoGen. **No headless browser** — agents connect over MCP (StreamableHTTP transport), not HTML scraping.
- **Merchant side (e.g. `dappier-seller-server`):** Node + official MCP SDK + `@skyfire-xyz/skyfire-seller-sdk-node` (`validate`, `chargeToken`) + `@ory/mcp-access-control` for the auth gate.
- **Identity:** Skyfire MCP at `mcp.skyfire.xyz/mcp` mints KYA + PAY tokens. The KYA token's `hid` claim is bound to a real human via Ory (or Keycloak/Okta in the variants) using their CTE feature inside the consent flow.
- **No A2A in the flagship demo.** A separate repo, `kyapay_a2a`, demonstrates Google A2A protocol — Python + Gemini ADK, alternative to MCP.
- **Browser-driven Skyfire demo, if it exists, is non-public:** the Visa Intelligent Commerce / Bose.com press demo (Dec 2025) is described in press only; no repo. It may have used Playwright on a real merchant site, but that is not Skyfire's published reference.

---

## Merchant-shell architecture

### Stack

**Next.js 15 (App Router) + Tailwind v4 + shadcn/ui + Drizzle + SQLite.**

- shadcn/ui ships polished product-card / sheet / dialog primitives — saves days of design work for a Target/Amazon-style mock.
- Drizzle + SQLite means zero infrastructure overhead, all engineering budget on the integration.
- Next.js Route Handlers double as the ACP JSON endpoints and host the MCP server in the same repo.

Reject: SvelteKit (smaller bundles, worse component library breadth — wrong tradeoff for a demo); Vite SPA (no built-in routing/API/SEO).

### Agent surface

The 2026 pattern is **parallel surfaces**, not "detect agent and adapt":

- `/` — human web UI (HTML)
- `/api/acp/*` — Agentic Commerce Protocol JSON endpoints (product feed, cart/checkout session, delegate payment). Current ACP spec: `2026-04-17`. OpenAPI-described.
- `/api/mcp` — MCP server using `@modelcontextprotocol/sdk`. Advertises tools that wrap the ACP endpoints. This is how Claude/ChatGPT *discover* the merchant.

Side-by-side surfaces make the demo narrative crisp: "Here's what Jeff sees in his browser. Here's what Jeff's agent sees over MCP." Adaptive detection from user agent is fragile (Copilot Actions = Edge) and muddles what Ory is authenticating.

### Catalog

Drizzle schema with three tables: `products`, `carts`, `orders`. SQLite file in the repo, Faker-seeded products, Unsplash images. No commerce engineering effort.

### Public references to borrow from

- **ChatGPT Instant Checkout** (Etsy/Shopify, Sept 2025) — canonical ACP reference.
- **Shopify Storefront MCP UI Server prototype** — MCP-UI pattern (rich cards rendered by chat clients).
- **Skyfire + Visa Intelligent Commerce** (Dec 2025 demo) — directly relevant to the stack we're building.
- **Mastercard Agent Pay** (live with Santander, Feb 2026).

Borrow specifically: side-by-side "human vs agent" split-screen view; MCP-UI rich product cards; a visible "mandate" panel showing the signed authorization (perfect KYA Pay storytelling).

---

## Key source URLs

### Ory
- https://www.ory.com/docs/solutions/agentic
- https://www.ory.com/blog/enabling-the-agentic-economy-with-ory-and-skyfire
- https://www.ory.com/blog/autonomous-commerce-agentic-ai-identity-skyfire-ory
- https://www.ory.com/partners/skyfire
- https://www.ory.com/docs/kratos/manage-identities/customize-identity-schema
- https://www.ory.com/docs/hydra/self-hosted/quickstart
- https://github.com/ory/hydra/discussions/3359 (RFC 8693 status)

### Skyfire / KYAPay
- https://kyapay.org/
- https://docs.skyfire.xyz/docs/introduction-to-skyfire
- https://docs.skyfire.xyz/docs/seller-onboarding
- https://docs.skyfire.xyz/docs/kya-token
- https://github.com/skyfire-xyz/kyapay/blob/main/docs/example-api.md
- https://github.com/skyfire-xyz (SDKs, Keycloak/Okta demos, solutions demo)
- https://www.npmjs.com/package/@skyfire-xyz/skyfire-seller-sdk-node
- https://skyfire.xyz/skyfires-kya-protocol-is-now-the-identity-layer-for-experians-know-your-agent-framework/

### Protocols
- https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
- https://docs.stripe.com/agentic-commerce/acp
- https://ap2-protocol.org/
- https://shopify.dev/docs/agents
- https://shopify.dev/docs/apps/build/storefront-mcp

### Stack
- https://ui.shadcn.com/docs/installation/next
- https://github.com/siddharthamaity/nextjs-15-starter-shadcn
- https://www.bytebase.com/blog/drizzle-vs-prisma/
