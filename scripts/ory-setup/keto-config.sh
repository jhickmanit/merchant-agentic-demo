#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env.local ]]; then
  set -a; source .env.local; set +a
fi

: "${ORY_PROJECT_ID:?ORY_PROJECT_ID required}"

DIR="$(cd "$(dirname "$0")" && pwd)"
OPL_FILE="${DIR}/keto-namespaces/namespaces.ts"

echo "  → Registering Keto namespaces (OPL file: ${OPL_FILE})"

# Ory Network uses JSON-based namespace registration (not TypeScript OPL, which
# is only supported on self-hosted Keto). We register the 5 namespaces by name
# using `patch permission-config --replace`.
#
# NOTE: The OPL TypeScript file (namespaces.ts) documents the intended schema
# and permits rules, but the `permits.view` computed rule is NOT enforceable on
# Ory Network — only direct relation tuples work. P3.2 must write both `owner`
# AND `view` tuples per order to support view checks.

NAMESPACES_JSON='[{"name":"User","id":0},{"name":"Order","id":1},{"name":"Merchant","id":2},{"name":"Agent","id":3},{"name":"SpendCap","id":4}]'

# Use `patch permission-config` (available in Ory CLI v1.x+)
if ory help patch permission-config >/dev/null 2>&1; then
  ory patch permission-config --project "${ORY_PROJECT_ID}" \
    --replace "/namespaces=${NAMESPACES_JSON}" \
    --format json-pretty
  echo "  → Applied via patch permission-config (5 namespaces: User, Order, Merchant, Agent, SpendCap)"
elif ory help update permission-config >/dev/null 2>&1; then
  # Construct a JSON config file and update
  TMPFILE=$(mktemp /tmp/ory-keto-config-XXXXXX.json)
  trap 'rm -f "${TMPFILE}"' EXIT
  printf '{"namespaces":%s}\n' "${NAMESPACES_JSON}" > "${TMPFILE}"
  ory update permission-config --project "${ORY_PROJECT_ID}" \
    --file "file://${TMPFILE}" \
    --format json-pretty
  echo "  → Applied via update permission-config (5 namespaces)"
else
  # Fall back to patching the project's services.permission.config directly
  ory patch project --project "${ORY_PROJECT_ID}" \
    --replace "/services/permission/config/namespaces=${NAMESPACES_JSON}"
  echo "  → Registered namespace names via project patch fallback"
fi

echo "  → NOTE: OPL permits.view rule is NOT enforceable on Ory Network."
echo "  →       P3.2 must write both 'owner' and 'view' tuples per order."
