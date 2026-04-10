#!/usr/bin/env bash
set -euo pipefail

echo "=== JWKS Bootstrap for Convex Auth ==="
echo ""
echo "Prerequisites:"
echo "  1. pnpm dev is running (port 3002)"
echo "  2. You have logged in with Google at least once"
echo "  3. npx convex dev is running"
echo ""

SITE_URL="${CONVEX_SITE_URL:-http://localhost:3002}"

echo "Fetching JWKS from $SITE_URL/api/auth/convex/latest-jwks ..."
JWKS=$(curl -s -X POST "$SITE_URL/api/auth/convex/latest-jwks")

if [ -z "$JWKS" ] || [ "$JWKS" = "null" ]; then
  echo "ERROR: No JWKS returned. Have you logged in with Google at least once?"
  echo "The first login generates JWKS keys in the SQLite auth database."
  exit 1
fi

echo "Setting Convex env vars..."
npx convex env set JWKS "$JWKS"
npx convex env set CONVEX_SITE_URL "$SITE_URL"

echo ""
echo "Done! Convex auth is now configured."
echo "Restart 'npx convex dev' to pick up the new auth config."
