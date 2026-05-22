#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env.local ]]; then
  set -a; source .env.local; set +a
fi

: "${ORY_PROJECT_ID:?ORY_PROJECT_ID required}"

ory patch project --project "${ORY_PROJECT_ID}" \
  --replace '/services/identity/config/selfservice/allowed_return_urls=["http://localhost:3000","http://localhost:3000/","http://localhost:4000","http://localhost:4000/"]' \
  --replace '/services/identity/config/selfservice/default_browser_return_url="http://localhost:3000/"' \
  --replace '/services/identity/config/selfservice/flows/logout/after/default_browser_return_url="http://localhost:3000/"'
