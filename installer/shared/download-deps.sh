#!/usr/bin/env bash
# Downloads Node.js portable and AIngle Cortex for the specified platform
# Usage: ./download-deps.sh <platform> <output-dir>
# Platforms: macos-arm64, macos-x64, linux-x64, linux-arm64, windows-x64

set -euo pipefail

MAYROS_VERSION="0.3.2"
NODE_VERSION="22.16.0"
CORTEX_VERSION="0.6.3"
CORTEX_REPO="ApiliumCode/aingle"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/bundle-manifest.json"

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
PLATFORM="${1:-}"
OUTPUT_DIR="${2:-}"

if [[ -z "$PLATFORM" || -z "$OUTPUT_DIR" ]]; then
  echo "Usage: $0 <platform> <output-dir>"
  echo "Platforms: macos-arm64, macos-x64, linux-x64, linux-arm64, windows-x64"
  exit 1
fi

VALID_PLATFORMS="macos-arm64 macos-x64 linux-x64 linux-arm64 windows-x64"
if ! echo "$VALID_PLATFORMS" | grep -qw "$PLATFORM"; then
  echo "Error: unsupported platform '$PLATFORM'"
  echo "Valid: $VALID_PLATFORMS"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

# ---------------------------------------------------------------------------
# Network connectivity check
# ---------------------------------------------------------------------------
echo "==> Checking network connectivity..."
if command -v curl &>/dev/null; then
  if ! curl -s --max-time 5 https://github.com > /dev/null 2>&1; then
    echo "Error: no internet connection detected."
    echo "Please check your network and try again."
    exit 1
  fi
elif command -v wget &>/dev/null; then
  if ! wget -q --timeout=5 --spider https://github.com 2>/dev/null; then
    echo "Error: no internet connection detected."
    echo "Please check your network and try again."
    exit 1
  fi
fi
echo "  -> Connection OK"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
download() {
  local url="$1" dest="$2"
  echo "  -> $url"
  if command -v curl &>/dev/null; then
    curl -fSL --retry 3 --progress-bar -o "$dest" "$url"
  elif command -v wget &>/dev/null; then
    wget -q --show-progress -O "$dest" "$url"
  else
    echo "Error: curl or wget required" >&2
    exit 1
  fi
}

verify_sha256() {
  local file="$1" expected="$2"
  local actual
  if command -v sha256sum &>/dev/null; then
    actual=$(sha256sum "$file" | awk '{print $1}')
  elif command -v shasum &>/dev/null; then
    actual=$(shasum -a 256 "$file" | awk '{print $1}')
  else
    echo "Warning: no sha256sum/shasum found, skipping checksum verification"
    return 0
  fi
  if [[ "$actual" != "$expected" ]]; then
    echo "Error: SHA256 mismatch for $(basename "$file")"
    echo "  expected: $expected"
    echo "  actual:   $actual"
    return 1
  fi
  echo "  checksum OK"
}

# ---------------------------------------------------------------------------
# Read manifest entries for this platform
# ---------------------------------------------------------------------------
if ! command -v node &>/dev/null && ! command -v python3 &>/dev/null; then
  echo "Error: node or python3 required to parse manifest" >&2
  exit 1
fi

read_manifest() {
  local key="$1"
  if command -v node &>/dev/null; then
    node -e "const m=JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));console.log(m.platforms['$PLATFORM']['$key'])"
  else
    python3 -c "import json;m=json.load(open('$MANIFEST'));print(m['platforms']['$PLATFORM']['$key'])"
  fi
}

NODE_FILE=$(read_manifest "node")
CORTEX_FILE=$(read_manifest "cortex")

# ---------------------------------------------------------------------------
# 1. Download Node.js portable
# ---------------------------------------------------------------------------
echo "==> Downloading Node.js $NODE_VERSION ($PLATFORM)..."
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_FILE}"
download "$NODE_URL" "$OUTPUT_DIR/$NODE_FILE"

# Download SHASUMS for verification
SHASUMS_URL="https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
download "$SHASUMS_URL" "$OUTPUT_DIR/node-shasums.txt"

EXPECTED_SHA=$(grep "$NODE_FILE" "$OUTPUT_DIR/node-shasums.txt" | awk '{print $1}')
if [[ -n "$EXPECTED_SHA" ]]; then
  verify_sha256 "$OUTPUT_DIR/$NODE_FILE" "$EXPECTED_SHA"
fi
rm -f "$OUTPUT_DIR/node-shasums.txt"

# ---------------------------------------------------------------------------
# 2. Download Cortex binary
# ---------------------------------------------------------------------------
echo "==> Downloading AIngle Cortex $CORTEX_VERSION ($PLATFORM)..."
CORTEX_URL="https://github.com/${CORTEX_REPO}/releases/download/v${CORTEX_VERSION}/${CORTEX_FILE}"
download "$CORTEX_URL" "$OUTPUT_DIR/$CORTEX_FILE"

# Download checksum file if available (with retries)
CORTEX_SHA_URL="https://github.com/${CORTEX_REPO}/releases/download/v${CORTEX_VERSION}/checksums.sha256"
CHECKSUM_OK=false
for attempt in 1 2 3; do
  if curl -fSL --head "$CORTEX_SHA_URL" &>/dev/null 2>&1; then
    if download "$CORTEX_SHA_URL" "$OUTPUT_DIR/cortex-checksums.sha256" 2>/dev/null; then
      EXPECTED_CORTEX_SHA=$(grep "$CORTEX_FILE" "$OUTPUT_DIR/cortex-checksums.sha256" | awk '{print $1}')
      if [[ -n "$EXPECTED_CORTEX_SHA" ]]; then
        verify_sha256 "$OUTPUT_DIR/$CORTEX_FILE" "$EXPECTED_CORTEX_SHA"
        CHECKSUM_OK=true
      fi
      rm -f "$OUTPUT_DIR/cortex-checksums.sha256"
      break
    fi
  fi
  [[ $attempt -lt 3 ]] && echo "  Retrying checksum download (attempt $((attempt + 1))/3)..." && sleep 2
done
if [[ "$CHECKSUM_OK" != "true" ]]; then
  echo "  Warning: could not verify Cortex checksum after 3 attempts. Continuing without verification."
fi

# ---------------------------------------------------------------------------
# 3. Download Mayros npm package (optional — installed at runtime if missing)
# ---------------------------------------------------------------------------
echo "==> Downloading Mayros CLI (optional, installed at runtime if not available)..."
if command -v npm &>/dev/null; then
  (cd "$OUTPUT_DIR" && npm pack "@apilium/mayros@latest" --quiet 2>/dev/null) || {
    echo "  Note: npm pack skipped — CLI will be installed at runtime"
  }
else
  echo "  npm not found — CLI will be installed at runtime"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "==> Dependencies downloaded to: $OUTPUT_DIR"
ls -lh "$OUTPUT_DIR"
echo ""
echo "Done."
