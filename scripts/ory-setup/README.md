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
