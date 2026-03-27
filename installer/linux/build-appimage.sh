#!/usr/bin/env bash
# build-appimage.sh — Builds a Mayros AppImage for Linux
# Usage: ./build-appimage.sh [--arch x64|arm64]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER_DIR="$(dirname "$SCRIPT_DIR")"
SHARED_DIR="$INSTALLER_DIR/shared"
ASSETS_DIR="$INSTALLER_DIR/assets"
BUILD_DIR="$SCRIPT_DIR/build"
OUTPUT_DIR="$SCRIPT_DIR/output"

TARGET_ARCH="x64"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) TARGET_ARCH="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

PLATFORM="linux-$TARGET_ARCH"

# Read versions from manifest using node (python3 may not be present)
MANIFEST="$SHARED_DIR/bundle-manifest.json"
read_json() {
  node -e "const m=JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));console.log(m$1)"
}

MAYROS_VERSION=$(read_json "['mayros']")
NODE_VERSION=$(read_json "['node']")
CORTEX_VERSION=$(read_json "['cortex']")

echo "==> Mayros $MAYROS_VERSION Linux AppImage Builder ($TARGET_ARCH)"
echo "    Node.js $NODE_VERSION | Cortex $CORTEX_VERSION"
echo ""

# ---------------------------------------------------------------------------
# 1. Download dependencies
# ---------------------------------------------------------------------------
DEPS_DIR="$BUILD_DIR/deps"
mkdir -p "$DEPS_DIR"

echo "==> Downloading dependencies..."
bash "$SHARED_DIR/download-deps.sh" "$PLATFORM" "$DEPS_DIR"

# ---------------------------------------------------------------------------
# 2. Create AppDir structure
# ---------------------------------------------------------------------------
APPDIR="$BUILD_DIR/Mayros.AppDir"
rm -rf "$APPDIR"

echo "==> Creating AppDir..."
mkdir -p "$APPDIR/usr/bin"
mkdir -p "$APPDIR/usr/lib/node"
mkdir -p "$APPDIR/usr/lib/mayros"
mkdir -p "$APPDIR/etc"

# Extract Node.js
NODE_FILE=$(read_json ".platforms['$PLATFORM']['node']")
echo "  -> Extracting Node.js..."
tar -xJf "$DEPS_DIR/$NODE_FILE" -C "$APPDIR/usr/lib/node" --strip-components=1

# Symlink node binary
ln -sf ../lib/node/bin/node "$APPDIR/usr/bin/node"
ln -sf ../lib/node/bin/npm "$APPDIR/usr/bin/npm"

# Extract Cortex
CORTEX_FILE=$(read_json ".platforms['$PLATFORM']['cortex']")
echo "  -> Extracting Cortex..."
tar -xzf "$DEPS_DIR/$CORTEX_FILE" -C "$APPDIR/usr/bin"
chmod +x "$APPDIR/usr/bin/"aingle-cortex*

# Rename platform-suffixed Cortex binary (e.g., aingle-cortex-linux-x86_64 -> aingle-cortex)
for f in "$APPDIR/usr/bin/"aingle-cortex-*; do
  if [[ -f "$f" ]]; then
    mv "$f" "$APPDIR/usr/bin/aingle-cortex"
    echo "  -> Renamed $(basename "$f") -> aingle-cortex"
    break
  fi
done

# Mayros CLI: skip tarball extraction, install via npm at first launch
TARBALL=$(ls "$DEPS_DIR"/*.tgz 2>/dev/null | head -1 || true)
if [[ -n "$TARBALL" ]]; then
  echo "  -> Caching CLI tarball for offline install..."
  cp "$TARBALL" "$APPDIR/usr/lib/mayros/mayros-cli.tgz"
fi

# ---------------------------------------------------------------------------
# 3. Create first-launch install script
# ---------------------------------------------------------------------------
cat > "$APPDIR/usr/lib/mayros/install-cli.sh" <<'INSTALL_SCRIPT'
#!/usr/bin/env bash
# Installs Mayros CLI via npm on first launch
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
APPDIR="$(cd "$HERE/../../.." && pwd)"
NODE="$APPDIR/usr/lib/node/bin/node"
NPM="$APPDIR/usr/lib/node/bin/npm"
MAYROS_LIB="$APPDIR/usr/lib/mayros"
CLI_ENTRY="$MAYROS_LIB/node_modules/@apilium/mayros/dist/index.js"

if [[ -f "$CLI_ENTRY" ]]; then
  exit 0
fi

echo "First launch: installing Mayros CLI..."

# Try cached tarball first, then npm registry
if [[ -f "$MAYROS_LIB/mayros-cli.tgz" ]]; then
  echo "Using cached CLI package..."
  "$NPM" install "$MAYROS_LIB/mayros-cli.tgz" --prefix "$MAYROS_LIB" --force --no-fund --no-audit 2>/dev/null || {
    echo "Cached install failed, falling back to npm registry..."
    "$NPM" install @apilium/mayros@latest --prefix "$MAYROS_LIB" --force --no-fund --no-audit 2>/dev/null
  }
else
  echo "No cached package found, installing from npm registry..."
  "$NPM" install @apilium/mayros@latest --prefix "$MAYROS_LIB" --force --no-fund --no-audit 2>/dev/null
fi

echo "Mayros CLI installed."
INSTALL_SCRIPT
chmod +x "$APPDIR/usr/lib/mayros/install-cli.sh"

# ---------------------------------------------------------------------------
# 4. Create mayros wrapper script
# ---------------------------------------------------------------------------
cat > "$APPDIR/usr/bin/mayros" <<'WRAPPER'
#!/usr/bin/env bash
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$SELF_DIR/../lib/node/bin/node"
CLI="$SELF_DIR/../lib/mayros/node_modules/@apilium/mayros/dist/index.js"

# Install CLI on first use if not present
if [[ ! -f "$CLI" ]]; then
  bash "$SELF_DIR/../lib/mayros/install-cli.sh"
fi

exec "$NODE" "$CLI" "$@"
WRAPPER
chmod +x "$APPDIR/usr/bin/mayros"

# ---------------------------------------------------------------------------
# 5. Create AppRun
# ---------------------------------------------------------------------------
cat > "$APPDIR/AppRun" <<'APPRUN'
#!/usr/bin/env bash
# AppRun — entry point for Mayros AppImage
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HERE/usr/bin:$PATH"

NODE="$HERE/usr/lib/node/bin/node"
CLI="$HERE/usr/lib/mayros/node_modules/@apilium/mayros/dist/index.js"

# First launch: install CLI via npm if not present
if [[ ! -f "$CLI" ]]; then
  echo "Installing Mayros... this may take a minute."
  notify-send "Mayros" "Installing Mayros... please wait." 2>/dev/null || true
  bash "$HERE/usr/lib/mayros/install-cli.sh"
fi

# Minimal config: gateway.mode=local + auth.mode=none (portal wizard configures auth later)
CONFIG_FILE="$HOME/.mayros/mayros.json"
if [[ -f "$CONFIG_FILE" ]]; then
  "$NODE" -e "const fs=require('fs');const f='$CONFIG_FILE';const c=JSON.parse(fs.readFileSync(f,'utf8'));if(!c.gateway)c.gateway={};if(!c.gateway.mode)c.gateway.mode='local';if(!c.gateway.auth)c.gateway.auth={};if(!c.gateway.auth.mode)c.gateway.auth.mode='none';fs.writeFileSync(f,JSON.stringify(c,null,2));" 2>/dev/null || true
else
  echo '{"gateway":{"mode":"local","auth":{"mode":"none"}}}' > "$CONFIG_FILE"
fi

# Start Cortex if not running and wait for it
if ! pgrep -f "aingle-cortex" >/dev/null 2>&1; then
  "$HERE/usr/bin/aingle-cortex" --port 19090 &>/dev/null &
fi
CORTEX_TRIES=0
while [[ $CORTEX_TRIES -lt 20 ]]; do
  if curl -s --max-time 2 "http://127.0.0.1:19090/health" >/dev/null 2>&1; then
    break
  fi
  CORTEX_TRIES=$((CORTEX_TRIES + 1))
  sleep 1
done

# Start gateway if not running
if ! pgrep -f "mayros gateway" >/dev/null 2>&1; then
  echo "Starting Mayros Gateway..."
  "$NODE" "$CLI" gateway start --background 2>/dev/null &
fi

# If launched without args (e.g., from desktop), open portal
if [[ $# -eq 0 ]]; then
  # Wait for gateway to be ready
  TRIES=0
  while [[ $TRIES -lt 30 ]]; do
    curl -s --max-time 2 "http://127.0.0.1:18789/health" >/dev/null 2>&1 && break
    TRIES=$((TRIES + 1))
    sleep 1
  done
  exec "$NODE" "$CLI" dashboard
else
  exec "$NODE" "$CLI" "$@"
fi
APPRUN
chmod +x "$APPDIR/AppRun"

# ---------------------------------------------------------------------------
# 6. Desktop file and icon
# ---------------------------------------------------------------------------
cp "$SCRIPT_DIR/mayros.desktop" "$APPDIR/mayros.desktop"

# Generate PNG icon from SVG using node+sharp
if [[ ! -f "$ASSETS_DIR/mayros.png" ]]; then
  SVG_SOURCE=""
  if [[ -f "$ASSETS_DIR/mayros-logo.svg" ]]; then
    SVG_SOURCE="$ASSETS_DIR/mayros-logo.svg"
  elif [[ -f "$INSTALLER_DIR/../ui/public/favicon.svg" ]]; then
    SVG_SOURCE="$INSTALLER_DIR/../ui/public/favicon.svg"
  fi

  if [[ -n "$SVG_SOURCE" ]]; then
    echo "  -> Generating icon PNG from SVG..."
    node -e "
      const sharp = require('sharp');
      const fs = require('fs');
      const svg = fs.readFileSync('$SVG_SOURCE');
      sharp(svg, { density: 300 })
        .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile('$ASSETS_DIR/mayros.png')
        .then(() => console.log('  -> Icon generated'));
    " 2>/dev/null || echo "  -> Warning: could not generate icon (sharp not available)"
  fi
fi

# Copy icon into AppDir — use pre-built 256px PNG from assets
if [[ -f "$ASSETS_DIR/mayros-icon-256.png" ]]; then
  cp "$ASSETS_DIR/mayros-icon-256.png" "$APPDIR/mayros.png"
elif [[ -f "$ASSETS_DIR/mayros.png" ]]; then
  cp "$ASSETS_DIR/mayros.png" "$APPDIR/mayros.png"
elif [[ -f "$ASSETS_DIR/mayros-logo.svg" ]]; then
  if command -v rsvg-convert &>/dev/null; then
    rsvg-convert -w 256 -h 256 "$ASSETS_DIR/mayros-logo.svg" > "$APPDIR/mayros.png"
  elif command -v convert &>/dev/null; then
    convert -background none -resize 256x256 "$ASSETS_DIR/mayros-logo.svg" "$APPDIR/mayros.png"
  else
    echo "  -> Warning: no icon converter found, icon will be missing"
  fi
fi

# Also place icon in hicolor structure for better integration
mkdir -p "$APPDIR/usr/share/icons/hicolor/256x256/apps"
if [[ -f "$APPDIR/mayros.png" ]]; then
  cp "$APPDIR/mayros.png" "$APPDIR/usr/share/icons/hicolor/256x256/apps/mayros.png"
fi

# ---------------------------------------------------------------------------
# 7. Download appimagetool and build AppImage
# ---------------------------------------------------------------------------
mkdir -p "$OUTPUT_DIR"

APPIMAGETOOL="$BUILD_DIR/appimagetool"
if [[ ! -x "$APPIMAGETOOL" ]]; then
  echo "==> Downloading appimagetool..."
  TOOL_ARCH="x86_64"
  [[ "$TARGET_ARCH" == "arm64" ]] && TOOL_ARCH="aarch64"
  curl -fSL -o "$APPIMAGETOOL" \
    "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-${TOOL_ARCH}.AppImage"
  chmod +x "$APPIMAGETOOL"
fi

APPIMAGE_ARCH="x86_64"
[[ "$TARGET_ARCH" == "arm64" ]] && APPIMAGE_ARCH="aarch64"

APPIMAGE_PATH="$OUTPUT_DIR/Mayros-${MAYROS_VERSION}-${APPIMAGE_ARCH}.AppImage"
rm -f "$APPIMAGE_PATH"

echo "==> Building AppImage..."
ARCH="$APPIMAGE_ARCH" "$APPIMAGETOOL" --no-appstream "$APPDIR" "$APPIMAGE_PATH"

chmod +x "$APPIMAGE_PATH"

echo ""
echo "==> AppImage created: $APPIMAGE_PATH"
echo "    Size: $(du -h "$APPIMAGE_PATH" | awk '{print $1}')"
echo "Done."
