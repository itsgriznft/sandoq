#!/usr/bin/env bash
#
# Deploy sandoq to a Stellar network.
#
#   ./scripts/deploy.sh [network] [identity]
#
# Uploads the circle wasm, deploys the factory pointing at that wasm hash, and
# writes the resulting ids to deployments/<network>.json. Re-running is safe:
# uploading the same bytes yields the same hash, and a fresh factory is deployed.
#
# Requires: stellar CLI, jq.

set -euo pipefail

NETWORK="${1:-testnet}"
IDENTITY="${2:-deployer}"

CIRCLE_WASM="target/wasm32v1-none/release/circle.wasm"
FACTORY_WASM="target/wasm32v1-none/release/factory.wasm"
FEEDBACK_WASM="target/wasm32v1-none/release/feedback.wasm"
OUT_DIR="deployments"
OUT="$OUT_DIR/$NETWORK.json"

step() { printf '\n\033[1;33m==>\033[0m %s\n' "$1"; }

for tool in stellar jq; do
  command -v "$tool" >/dev/null || { echo "error: $tool is not installed" >&2; exit 1; }
done

step "Building contracts"
make build

step "Ensuring identity '$IDENTITY' exists and is funded"
if ! stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  stellar keys generate "$IDENTITY" --network "$NETWORK" --fund
fi
ADMIN="$(stellar keys address "$IDENTITY")"
echo "admin: $ADMIN"

step "Resolving the native XLM asset contract"
TOKEN="$(stellar contract id asset --asset native --network "$NETWORK")"
echo "token: $TOKEN"

step "Uploading circle wasm"
CIRCLE_HASH="$(stellar contract upload \
  --wasm "$CIRCLE_WASM" \
  --source "$IDENTITY" --network "$NETWORK")"
echo "circle wasm hash: $CIRCLE_HASH"

step "Deploying factory"
FACTORY_ID="$(stellar contract deploy \
  --wasm "$FACTORY_WASM" \
  --source "$IDENTITY" --network "$NETWORK" \
  -- \
  --admin "$ADMIN" \
  --token "$TOKEN" \
  --circle_wasm "$CIRCLE_HASH")"
echo "factory: $FACTORY_ID"

step "Deploying feedback registry"
FEEDBACK_ID="$(stellar contract deploy \
  --wasm "$FEEDBACK_WASM" \
  --source "$IDENTITY" --network "$NETWORK")"
echo "feedback: $FEEDBACK_ID"

step "Writing $OUT"
mkdir -p "$OUT_DIR"
jq -n \
  --arg network "$NETWORK" \
  --arg admin "$ADMIN" \
  --arg token "$TOKEN" \
  --arg circleWasmHash "$CIRCLE_HASH" \
  --arg factoryId "$FACTORY_ID" \
  --arg feedbackId "$FEEDBACK_ID" \
  '{network: $network, admin: $admin, token: $token, circleWasmHash: $circleWasmHash, factoryId: $factoryId, feedbackId: $feedbackId}' \
  > "$OUT"
cat "$OUT"

cat <<EOF

Done. Point the frontend at this deployment:

  VITE_FACTORY_ID=$FACTORY_ID npm --prefix web run dev

Create a circle (amounts in stroops, period/deadline in seconds):

  stellar contract invoke --id $FACTORY_ID --source $IDENTITY --network $NETWORK \\
    -- create --organizer $ADMIN --name "Family sandoq" \\
    --contribution 100000000 --period 604800 --size 5 \\
    --collateral 100000000 --fill_deadline \$(( \$(date +%s) + 604800 ))
EOF
