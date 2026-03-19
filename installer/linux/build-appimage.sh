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

# Read versions from manifest
MANIFEST="$SHARED_DIR/bundle-manifest.json"
read_json() { python3 -c "import json;print(json.load(open('$MANIFEST'))$1)"; }

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
NODE_FILE=$(read_json "['platforms']['$PLATFORM']['node']")
echo "  -> Extracting Node.js..."
tar -xJf "$DEPS_DIR/$NODE_FILE" -C "$APPDIR/usr/lib/node" --strip-components=1

# Symlink node binary
ln -sf ../lib/node/bin/node "$APPDIR/usr/bin/node"

# Extract Cortex
CORTEX_FILE=$(read_json "['platforms']['$PLATFORM']['cortex']")
echo "  -> Extracting Cortex..."
tar -xzf "$DEPS_DIR/$CORTEX_FILE" -C "$APPDIR/usr/bin"
chmod +x "$APPDIR/usr/bin/"aingle-cortex*

# Extract Mayros CLI
TARBALL=$(ls "$DEPS_DIR"/*.tgz 2>/dev/null | head -1)
if [[ -n "$TARBALL" ]]; then
  echo "  -> Extracting Mayros CLI..."
  tar -xzf "$TARBALL" -C "$APPDIR/usr/lib/mayros" --strip-components=1
fi

# ---------------------------------------------------------------------------
# 3. Create mayros wrapper script
# ---------------------------------------------------------------------------
cat > "$APPDIR/usr/bin/mayros" <<'WRAPPER'
#!/usr/bin/env bash
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$SELF_DIR/../lib/node/bin/node"
CLI="$SELF_DIR/../lib/mayros/dist/index.js"
exec "$NODE" "$CLI" "$@"
WRAPPER
chmod +x "$APPDIR/usr/bin/mayros"

# ---------------------------------------------------------------------------
# 4. Create AppRun
# ---------------------------------------------------------------------------
cat > "$APPDIR/AppRun" <<'APPRUN'
#!/usr/bin/env bash
# AppRun — entry point for Mayros AppImage
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HERE/usr/bin:$PATH"

NODE="$HERE/usr/lib/node/bin/node"
CLI="$HERE/usr/lib/mayros/dist/index.js"

# Start gateway if not running
if ! pgrep -f "mayros gateway" >/dev/null 2>&1; then
  "$NODE" "$CLI" gateway start --background 2>/dev/null &
fi

# If launched without args (e.g., from desktop), open portal
if [[ $# -eq 0 ]]; then
  exec "$NODE" "$CLI" dashboard
else
  exec "$NODE" "$CLI" "$@"
fi
APPRUN
chmod +x "$APPDIR/AppRun"

# ---------------------------------------------------------------------------
# 5. Desktop file and icon
# ---------------------------------------------------------------------------
cp "$SCRIPT_DIR/mayros.desktop" "$APPDIR/mayros.desktop"

# Icon (use PNG from assets or generate a placeholder)
if [[ -f "$ASSETS_DIR/mayros.png" ]]; then
  cp "$ASSETS_DIR/mayros.png" "$APPDIR/mayros.png"
elif [[ -f "$ASSETS_DIR/mayros-logo.svg" ]]; then
  if command -v rsvg-convert &>/dev/null; then
    rsvg-convert -w 256 -h 256 "$ASSETS_DIR/mayros-logo.svg" > "$APPDIR/mayros.png"
  elif command -v convert &>/dev/null; then
    convert -background none -resize 256x256 "$ASSETS_DIR/mayros-logo.svg" "$APPDIR/mayros.png"
  else
    echo "  -> Warning: no SVG converter found, icon will be missing"
    # Create a minimal 1x1 placeholder
    printf '\x89PNG\r\n\x1a\n' > "$APPDIR/mayros.png"
  fi
fi

# Also place icon in hicolor structure for better integration
mkdir -p "$APPDIR/usr/share/icons/hicolor/256x256/apps"
if [[ -f "$APPDIR/mayros.png" ]]; then
  cp "$APPDIR/mayros.png" "$APPDIR/usr/share/icons/hicolor/256x256/apps/mayros.png"
fi

# ---------------------------------------------------------------------------
# 6. Download appimagetool and build AppImage
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
ARCH="$APPIMAGE_ARCH" "$APPIMAGETOOL" "$APPDIR" "$APPIMAGE_PATH"

chmod +x "$APPIMAGE_PATH"

echo ""
echo "==> AppImage created: $APPIMAGE_PATH"
echo "    Size: $(du -h "$APPIMAGE_PATH" | awk '{print $1}')"
echo "Done."
