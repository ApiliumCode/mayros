#!/usr/bin/env bash
set -euo pipefail

cd /repo

export MAYROS_STATE_DIR="/tmp/mayros-test"
export MAYROS_CONFIG_PATH="${MAYROS_STATE_DIR}/mayros.json"

echo "==> Build"
pnpm build

echo "==> Seed state"
mkdir -p "${MAYROS_STATE_DIR}/credentials"
mkdir -p "${MAYROS_STATE_DIR}/agents/main/sessions"
echo '{}' >"${MAYROS_CONFIG_PATH}"
echo 'creds' >"${MAYROS_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${MAYROS_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm mayros reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${MAYROS_CONFIG_PATH}"
test ! -d "${MAYROS_STATE_DIR}/credentials"
test ! -d "${MAYROS_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${MAYROS_STATE_DIR}/credentials"
echo '{}' >"${MAYROS_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm mayros uninstall --state --yes --non-interactive

test ! -d "${MAYROS_STATE_DIR}"

echo "OK"
