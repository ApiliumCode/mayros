#!/usr/bin/env bash
# Integration tests for install.sh — meant to run inside Docker containers.
# Usage: bash scripts/install.test.sh
#
# Tests:
#   1. detect_os_arch succeeds on Linux x64
#   2. check_node detects missing Node
#   3. MAYROS_SKIP_NODE=1 skips Node check
#   4. Full install flow completes (requires network)
#
# Each test runs the relevant portion of install.sh in a subshell.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_SCRIPT="$SCRIPT_DIR/install.sh"

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf "\033[32mPASS\033[0m %s\n" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf "\033[31mFAIL\033[0m %s\n" "$1"; }

# -------------------------------------------------------------------------
# Test 1: detect_os_arch succeeds
# -------------------------------------------------------------------------
test_detect_os_arch() {
  local output
  output=$(bash -c '
    source "'"$INSTALL_SCRIPT"'"
    detect_os_arch
    echo "$OS $ARCH"
  ' 2>&1) || true

  if echo "$output" | grep -qE "(darwin|linux)_(x64|arm64)"; then
    pass "detect_os_arch identifies current platform"
  else
    fail "detect_os_arch failed: $output"
  fi
}

# -------------------------------------------------------------------------
# Test 2: check_node detects missing Node
# -------------------------------------------------------------------------
test_check_node_missing() {
  local output exit_code=0
  output=$(bash -c '
    export PATH="/usr/bin:/bin"
    source "'"$INSTALL_SCRIPT"'"
    check_node
    echo "NODE_OK=$NODE_OK"
  ' 2>&1) || exit_code=$?

  if echo "$output" | grep -q "NODE_OK=false"; then
    pass "check_node detects missing Node"
  else
    fail "check_node should detect missing Node: $output"
  fi
}

# -------------------------------------------------------------------------
# Test 3: MAYROS_SKIP_NODE=1 skips Node check
# -------------------------------------------------------------------------
test_skip_node() {
  local output
  output=$(bash -c '
    export MAYROS_SKIP_NODE=1
    export PATH="/usr/bin:/bin"
    source "'"$INSTALL_SCRIPT"'"
    check_node
    echo "NODE_OK=$NODE_OK"
  ' 2>&1) || true

  if echo "$output" | grep -q "NODE_OK=true"; then
    pass "MAYROS_SKIP_NODE=1 skips Node check"
  else
    fail "MAYROS_SKIP_NODE should skip: $output"
  fi
}

# -------------------------------------------------------------------------
# Test 4: NO_COLOR disables colored output
# -------------------------------------------------------------------------
test_no_color() {
  local output
  output=$(bash -c '
    export NO_COLOR=1
    source "'"$INSTALL_SCRIPT"'"
    if [ -z "$GREEN" ] && [ -z "$RED" ] && [ -z "$CYAN" ]; then
      echo "COLORS_DISABLED=true"
    else
      echo "COLORS_DISABLED=false"
    fi
  ' 2>&1) || true

  if echo "$output" | grep -q "COLORS_DISABLED=true"; then
    pass "NO_COLOR disables colored output"
  else
    fail "NO_COLOR should disable colors: $output"
  fi
}

# -------------------------------------------------------------------------
# Run
# -------------------------------------------------------------------------

echo ""
echo "install.sh tests"
echo "================"
echo ""

test_detect_os_arch
test_check_node_missing
test_skip_node
test_no_color

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
