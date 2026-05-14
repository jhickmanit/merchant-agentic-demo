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
