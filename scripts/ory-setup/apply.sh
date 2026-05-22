#!/usr/bin/env bash
set -euo pipefail

# scripts/ory-setup/apply.sh
# Idempotently applies all Ory project configuration committed to this repo.
#
# Fresh-clone path: if no .env.local exists (or ORY_PROJECT_ID isn't set),
# the script will create a new Ory Network project for you, write the
# project_id / sdk_url to .env.local, then proceed with schemas / namespaces
# / Hydra config / return URLs / bridge client. End-to-end this gets a
# Skyfire engineer from `git clone` to "Flow 7 ready" in one command,
# assuming they've already run `ory auth` once against their account.

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${DIR}/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env.local"

if [[ -f "${ENV_FILE}" ]]; then
  set -a; source "${ENV_FILE}"; set +a
fi

# Verify the operator has authed the CLI once. We use `ory list workspaces`
# as the cheapest authed call; it errors if the token is missing/expired.
if ! ory list workspaces --format json >/dev/null 2>&1; then
  echo "✗ ory CLI is not authenticated."
  echo "  Run \`ory auth\` once to log in against your Ory account, then re-run this script."
  exit 1
fi

# Fresh-tenant path: no project id → create one.
if [[ -z "${ORY_PROJECT_ID:-}" ]]; then
  DEFAULT_NAME="skyfire-merchant-demo-$(whoami)-$(date +%Y%m%d)"
  PROJECT_NAME="${ORY_PROJECT_NAME:-${DEFAULT_NAME}}"
  echo "No ORY_PROJECT_ID found. Creating a new Ory Network project: ${PROJECT_NAME}"

  CREATE_OUT=$(ory create project --name "${PROJECT_NAME}" --format json)
  ORY_PROJECT_ID=$(echo "${CREATE_OUT}" | jq -r '.id')
  ORY_SDK_URL=$(echo "${CREATE_OUT}" | jq -r '.slug + ".projects.oryapis.com"')
  ORY_SDK_URL="https://${ORY_SDK_URL}"

  echo "  → project_id: ${ORY_PROJECT_ID}"
  echo "  → sdk_url:    ${ORY_SDK_URL}"

  # Persist to .env.local so future runs of pnpm dev / scripts see them.
  # Create the file if it doesn't exist; otherwise append the two lines.
  if [[ ! -f "${ENV_FILE}" ]]; then
    touch "${ENV_FILE}"
  fi
  {
    echo ""
    echo "# Auto-written by scripts/ory-setup/apply.sh on $(date +%Y-%m-%d)"
    echo "ORY_PROJECT_ID=${ORY_PROJECT_ID}"
    echo "ORY_SDK_URL=${ORY_SDK_URL}"
  } >> "${ENV_FILE}"
  echo "  → wrote ORY_PROJECT_ID and ORY_SDK_URL to ${ENV_FILE}"

  # Remind the operator that they still need an admin API key for the
  # server-side admin calls — that one we can't create via the CLI here,
  # they have to mint it in the dashboard.
  if [[ -z "${ORY_ADMIN_API_KEY:-}" ]]; then
    echo "  ⚠ ORY_ADMIN_API_KEY is required for server-side admin calls"
    echo "    (Kratos identity creation, Hydra client management, e2e fixtures)."
    echo "    Mint one at: https://console.ory.sh/projects/${ORY_PROJECT_ID}/developers"
    echo "    and add ORY_ADMIN_API_KEY=… to ${ENV_FILE} before running pnpm dev."
  fi

  export ORY_PROJECT_ID ORY_SDK_URL
fi

echo "Confirming ory CLI sees project ${ORY_PROJECT_ID}..."
ory get project "${ORY_PROJECT_ID}" --format json > /dev/null
echo "  → OK"

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
