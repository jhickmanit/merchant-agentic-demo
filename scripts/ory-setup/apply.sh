#!/usr/bin/env bash
set -euo pipefail

# scripts/ory-setup/apply.sh
# Idempotently applies all Ory project configuration committed to this repo.

if [[ -f .env.local ]]; then
  set -a; source .env.local; set +a
fi

: "${ORY_PROJECT_ID:?ORY_PROJECT_ID is required (set in .env.local)}"

echo "Confirming ory CLI sees project ${ORY_PROJECT_ID}..."
ory get project "${ORY_PROJECT_ID}" --format json > /dev/null
echo "  → OK"

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Uploading user + agent identity schemas..."
# Ory Network stores uploaded schemas in GCS and assigns a content-hash as the schema ID.
# We upload both schemas via 'ory update identity-config', which merges them into the project.
# After upload, schema IDs are SHA hashes of their content; we set 'user' as the default.
USER_SCHEMA_B64=$(base64 -i "${DIR}/identity-schemas/user.schema.json" | tr -d '\n')
AGENT_SCHEMA_B64=$(base64 -i "${DIR}/identity-schemas/agent.schema.json" | tr -d '\n')

TMPFILE=$(mktemp /tmp/ory-identity-config-XXXXXX.json)
trap 'rm -f "${TMPFILE}"' EXIT

# Get current config, inject both schemas (replacing schemas list and setting default to 'user')
ory get identity-config --project "${ORY_PROJECT_ID}" --format json \
  | jq --arg user_b64 "${USER_SCHEMA_B64}" --arg agent_b64 "${AGENT_SCHEMA_B64}" \
    '.identity.schemas = [{"id": "user", "url": ("base64://" + $user_b64)}, {"id": "agent", "url": ("base64://" + $agent_b64)}] | .identity.default_schema_id = "user"' \
  > "${TMPFILE}"

RESULT=$(ory update identity-config \
  --project "${ORY_PROJECT_ID}" \
  --file "file://${TMPFILE}" \
  --format json 2>/dev/null)

# Ory Network normalises the schema ID to its content hash; capture that hash.
SCHEMA_ID=$(echo "${RESULT}" | jq -r '.identity.default_schema_id' 2>/dev/null || echo "(unavailable)")
SCHEMA_COUNT=$(echo "${RESULT}" | jq -r '.identity.schemas | length' 2>/dev/null || echo "(unavailable)")
echo "  → OK (default schema id: ${SCHEMA_ID}, total schemas: ${SCHEMA_COUNT})"

echo "Configuring allowed return URLs..."
"${DIR}/return-urls.sh"
echo "  → OK"

echo "Configuring Keto namespaces..."
"${DIR}/keto-config.sh"
echo "  → OK"

echo "Configuring Hydra (Login/Consent/Token-Hook URLs)..."
"${DIR}/hydra-config.sh"
echo "  → OK"

echo "All Ory project configuration applied."

# Sanity-check Flow 7's prerequisites and remind the operator if anything's
# missing. apply.sh is the natural place for this because hydra-config.sh
# prints the bridge client creds inline — easy to miss if the operator looks
# only at the final line of output.
echo
echo "Flow 7 (Skyfire + Hydra delegation) readiness check:"

MISSING=()
[[ -z "${SKYFIRE_BRIDGE_CLIENT_ID:-}" ]] && MISSING+=("SKYFIRE_BRIDGE_CLIENT_ID")
[[ -z "${SKYFIRE_BRIDGE_CLIENT_SECRET:-}" ]] && MISSING+=("SKYFIRE_BRIDGE_CLIENT_SECRET")
[[ -z "${KYAPAY_PROVIDER:-}" || "${KYAPAY_PROVIDER:-}" != "skyfire" ]] && MISSING+=("KYAPAY_PROVIDER=skyfire")
[[ -z "${SKYFIRE_BUYER_API_KEY:-}" ]] && MISSING+=("SKYFIRE_BUYER_API_KEY")

if [[ ${#MISSING[@]} -eq 0 ]]; then
  echo "  ✓ All Flow 7 env vars present. Run \`pnpm dev\` + \`ory tunnel\` and hit /api/checkout with a Skyfire KYA."
else
  echo "  ⚠ Missing in .env.local:"
  for var in "${MISSING[@]}"; do echo "      - ${var}"; done
  echo "  → Flow 7 will fall back to Flow 6 behavior (auto-provision, no Hydra delegation) until these are set."
  echo "  → For SKYFIRE_BRIDGE_CLIENT_ID/SECRET: scroll up to the 'skyfire-bridge created' banner above (secret is shown only once)."
fi
