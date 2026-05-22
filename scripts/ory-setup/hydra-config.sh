#!/usr/bin/env bash
set -euo pipefail

# scripts/ory-setup/hydra-config.sh
# Configure Hydra (Ory OAuth2) login/consent URLs and optionally the token-hook.
#
# P7.1 probe findings:
#   - `ory patch oauth2-config --replace '/urls/login="<url>"'` works on hosted Network.
#   - Token hook webhooks (/webhooks/hooks/token/url) are silently ignored on Ory Network.
#     The patch "succeeds" but the key never appears in get oauth2-config. This is a
#     hosted-only constraint (same pattern as Keto computed permissions in Phase 6).
#   - Verdict: YELLOW — custom Login/Consent works; token hook enforcement must fall back
#     to validateAndCharge-time spend-cap check inside the app.

if [[ -f .env.local ]]; then
  set -a; source .env.local; set +a
fi

: "${ORY_PROJECT_ID:?ORY_PROJECT_ID required}"

# Where the Login/Consent apps live. For dev with Ory Tunnel, these may need to
# be the tunnel's localhost URL; for production, the merchant's real domain.
LOGIN_URL="${MERCHANT_BASE_URL:-http://localhost:3000}/oauth/login"
CONSENT_URL="${MERCHANT_BASE_URL:-http://localhost:3000}/oauth/consent"
TOKEN_HOOK_URL="${MERCHANT_BASE_URL:-http://localhost:3000}/api/token-hook"

echo "  Patching oauth2-config login URL: ${LOGIN_URL}"
echo "  Patching oauth2-config consent URL: ${CONSENT_URL}"

# The correct JSON-pointer path on this version of the CLI is `/urls/login` (no leading
# `/oauth2/`), because `ory patch oauth2-config` scopes automatically to the oauth2
# config namespace. Confirmed: `patch oauth2-config` uses shorter paths vs `patch project`.
ory patch oauth2-config --project "${ORY_PROJECT_ID}" \
  --replace "/urls/login=\"${LOGIN_URL}\"" \
  --replace "/urls/consent=\"${CONSENT_URL}\"" \
  --format json > /dev/null

echo "  → Login/Consent URLs set."

# Token hook: attempt the patch but do NOT fail apply.sh if it's silently dropped.
# On Ory Network (hosted), webhooks are not user-configurable; the key is accepted by
# the CLI but never persisted. Spend-cap enforcement falls back to validateAndCharge().
echo "  Attempting token hook patch: ${TOKEN_HOOK_URL}"
HOOK_OUT=$(ory patch oauth2-config --project "${ORY_PROJECT_ID}" \
  --replace "/webhooks/hooks/token/url=\"${TOKEN_HOOK_URL}\"" \
  --format json 2>&1 || true)

# Verify whether the hook was actually persisted.
HOOK_ACTUAL=$(ory get oauth2-config --project "${ORY_PROJECT_ID}" --format json \
  | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d.get('webhooks', 'MISSING'))" 2>/dev/null || echo "MISSING")

if [[ "${HOOK_ACTUAL}" == "MISSING" ]]; then
  echo "  → Token hook patch SILENTLY DROPPED (Ory Network hosted constraint)."
  echo "  → Spend-cap enforcement falls back to validateAndCharge() in the app."
else
  echo "  → Token hook patch persisted: ${TOKEN_HOOK_URL}"
fi

echo "  → Login URL: ${LOGIN_URL}"
echo "  → Consent URL: ${CONSENT_URL}"
echo "  → Token Hook URL: ${TOKEN_HOOK_URL} (supported: ${HOOK_ACTUAL})"

# ---------------------------------------------------------------------------
# Phase 10: skyfire-bridge OAuth2 client
# A single shared Hydra client used by EVERY auto-provisioned Skyfire-attested
# agent to bootstrap a delegated access token. Per-agent Hydra clients would
# be redundant — KYA already attests the agent identity; the per-agent value
# lives in the issued token's `act.sub` claim instead.
# ---------------------------------------------------------------------------

BRIDGE_NAME="skyfire-bridge"
BRIDGE_REDIRECT_URI="${MERCHANT_BASE_URL:-http://localhost:3000}/api/oauth/bootstrap-callback"

echo
echo "  Provisioning skyfire-bridge OAuth2 client…"

# `ory list oauth2-clients` doesn't filter by name natively; pull the full list
# and grep client_name. Idempotent: skip creation if a client with this name
# already exists.
EXISTING=$(ory list oauth2-clients --project "${ORY_PROJECT_ID}" --format json 2>/dev/null \
  | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    items = data.get('items', data) if isinstance(data, dict) else data
    for c in items or []:
        if c.get('client_name') == '${BRIDGE_NAME}':
            print(c.get('client_id', ''))
            break
except Exception:
    pass
" 2>/dev/null || true)

if [[ -n "${EXISTING}" ]]; then
  echo "  → skyfire-bridge already exists: client_id=${EXISTING}"
  echo "  → If you need the client_secret, re-create the client (it's only shown once)."
  BRIDGE_CLIENT_ID="${EXISTING}"
  BRIDGE_CLIENT_SECRET=""
else
  CREATED=$(ory create oauth2-client --project "${ORY_PROJECT_ID}" \
    --name "${BRIDGE_NAME}" \
    --grant-type authorization_code,refresh_token \
    --response-type code \
    --token-endpoint-auth-method client_secret_basic \
    --redirect-uri "${BRIDGE_REDIRECT_URI}" \
    --scope "offline_access openid" \
    --format json)

  BRIDGE_CLIENT_ID=$(echo "${CREATED}" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['client_id'])")
  BRIDGE_CLIENT_SECRET=$(echo "${CREATED}" | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('client_secret', ''))")

  echo "  → skyfire-bridge created."
  echo
  echo "  ┌─────────────────────────────────────────────────────────────────┐"
  echo "  │ Copy these into .env.local — the secret is shown only ONCE:     │"
  echo "  ├─────────────────────────────────────────────────────────────────┤"
  echo "  │ SKYFIRE_BRIDGE_CLIENT_ID=${BRIDGE_CLIENT_ID}"
  echo "  │ SKYFIRE_BRIDGE_CLIENT_SECRET=${BRIDGE_CLIENT_SECRET}"
  echo "  └─────────────────────────────────────────────────────────────────┘"
fi

echo "  → skyfire-bridge client_id: ${BRIDGE_CLIENT_ID}"
