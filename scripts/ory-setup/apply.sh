#!/usr/bin/env bash
set -euo pipefail

# scripts/ory-setup/apply.sh
# Idempotently applies all Ory project configuration committed to this repo.
# Real content lands in Phases 2, 3, 4, and 7. This is a Phase 0 placeholder
# that verifies the CLI is wired correctly.

if [[ -f .env.local ]]; then
  set -a; source .env.local; set +a
fi

: "${ORY_PROJECT_ID:?ORY_PROJECT_ID is required (set in .env.local)}"

echo "Confirming ory CLI sees project ${ORY_PROJECT_ID}..."
ory get project "${ORY_PROJECT_ID}" --format json | head -c 200
echo
echo "OK — apply.sh has nothing to apply yet (Phase 0 placeholder)."
