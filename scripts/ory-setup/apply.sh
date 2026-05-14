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

echo "Uploading user identity schema..."
# Ory Network stores uploaded schemas in GCS and assigns a content-hash as the schema ID.
# We upload the schema via 'ory update identity-config', which merges it into the project.
# After upload, the schema's ID is a SHA hash of its content; we capture it and set it as default.
USER_SCHEMA_B64=$(base64 -i "${DIR}/identity-schemas/user.schema.json" | tr -d '\n')

TMPFILE=$(mktemp /tmp/ory-identity-config-XXXXXX.json)
trap 'rm -f "${TMPFILE}"' EXIT

# Get current config, inject our schema (replacing schemas list and setting default)
ory get identity-config --project "${ORY_PROJECT_ID}" --format json \
  | jq --arg b64 "${USER_SCHEMA_B64}" \
    '.identity.schemas = [{"id": "user", "url": ("base64://" + $b64)}] | .identity.default_schema_id = "user"' \
  > "${TMPFILE}"

RESULT=$(ory update identity-config \
  --project "${ORY_PROJECT_ID}" \
  --file "file://${TMPFILE}" \
  --format json 2>/dev/null)

# Ory Network normalises the schema ID to its content hash; capture that hash.
SCHEMA_ID=$(echo "${RESULT}" | jq -r '.identity.default_schema_id' 2>/dev/null || echo "(unavailable)")
echo "  → OK (schema id: ${SCHEMA_ID})"

echo "Configuring allowed return URLs..."
"${DIR}/return-urls.sh"
echo "  → OK"

echo "Configuring Keto namespaces..."
"${DIR}/keto-config.sh"
echo "  → OK"

echo "All Ory project configuration applied."
