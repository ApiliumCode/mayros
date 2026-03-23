#!/usr/bin/env bash
# build-dmg.sh — Builds a Mayros .dmg installer for macOS
# Usage: ./build-dmg.sh [--sign <identity>]
# Prerequisites: Xcode command-line tools, create-dmg (brew install create-dmg)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER_DIR="$(dirname "$SCRIPT_DIR")"
SHARED_DIR="$INSTALLER_DIR/shared"
ASSETS_DIR="$INSTALLER_DIR/assets"
BUILD_DIR="$SCRIPT_DIR/build"
OUTPUT_DIR="$SCRIPT_DIR/output"

SIGN_IDENTITY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sign) SIGN_IDENTITY="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Read versions from manifest using node (python3 may not be present)
MANIFEST="$SHARED_DIR/bundle-manifest.json"
read_json() {
  node -e "const m=JSON.parse(require('fs').readFileSync('$MANIFEST','utf8'));console.log(m$1)"
}

MAYROS_VERSION=$(read_json "['mayros']")
NODE_VERSION=$(read_json "['node']")
CORTEX_VERSION=$(read_json "['cortex']")

echo "==> Mayros $MAYROS_VERSION macOS DMG Builder"
echo "    Node.js $NODE_VERSION | Cortex $CORTEX_VERSION"
echo ""

# ---------------------------------------------------------------------------
# Detect architecture
# ---------------------------------------------------------------------------
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
  PLATFORM="macos-arm64"
else
  PLATFORM="macos-x64"
fi

# ---------------------------------------------------------------------------
# 1. Download dependencies
# ---------------------------------------------------------------------------
DEPS_DIR="$BUILD_DIR/deps"
mkdir -p "$DEPS_DIR"

echo "==> Downloading dependencies for $PLATFORM..."
bash "$SHARED_DIR/download-deps.sh" "$PLATFORM" "$DEPS_DIR"

# ---------------------------------------------------------------------------
# 2. Build .app bundle
# ---------------------------------------------------------------------------
APP_DIR="$BUILD_DIR/Mayros.app"
rm -rf "$APP_DIR"

echo "==> Creating application bundle..."
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources/bin"
mkdir -p "$APP_DIR/Contents/Resources/node"

# Info.plist
cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Mayros</string>
    <key>CFBundleDisplayName</key>
    <string>Mayros</string>
    <key>CFBundleIdentifier</key>
    <string>com.apilium.mayros</string>
    <key>CFBundleVersion</key>
    <string>${MAYROS_VERSION}</string>
    <key>CFBundleShortVersionString</key>
    <string>${MAYROS_VERSION}</string>
    <key>CFBundleExecutable</key>
    <string>mayros-launcher</string>
    <key>CFBundleIconFile</key>
    <string>mayros</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST

# Extract Node.js into bundle
NODE_FILE=$(read_json ".platforms['$PLATFORM']['node']")
echo "  -> Extracting Node.js..."
tar -xzf "$DEPS_DIR/$NODE_FILE" -C "$APP_DIR/Contents/Resources/node" --strip-components=1

# Extract Cortex binary into bundle
CORTEX_FILE=$(read_json ".platforms['$PLATFORM']['cortex']")
echo "  -> Extracting Cortex..."
tar -xzf "$DEPS_DIR/$CORTEX_FILE" -C "$APP_DIR/Contents/Resources/bin"
chmod +x "$APP_DIR/Contents/Resources/bin/"*

# Rename platform-suffixed Cortex binary (e.g., aingle-cortex-darwin-aarch64 -> aingle-cortex)
for f in "$APP_DIR/Contents/Resources/bin/"aingle-cortex-*; do
  if [[ -f "$f" ]]; then
    mv "$f" "$APP_DIR/Contents/Resources/bin/aingle-cortex"
    echo "  -> Renamed $(basename "$f") -> aingle-cortex"
    break
  fi
done

# Copy icon
if [[ -f "$ASSETS_DIR/mayros.icns" ]]; then
  cp "$ASSETS_DIR/mayros.icns" "$APP_DIR/Contents/Resources/mayros.icns"
fi

# Launcher script
cat > "$APP_DIR/Contents/MacOS/mayros-launcher" <<'LAUNCHER'
#!/usr/bin/env bash
# Mayros application launcher
RESOURCES="$(dirname "$0")/../Resources"
NODE="$RESOURCES/node/bin/node"
NPM="$RESOURCES/node/bin/npm"
CORTEX="$RESOURCES/bin/aingle-cortex"
MAYROS_DIR="$HOME/.mayros"
CLI="$MAYROS_DIR/lib/node_modules/@apilium/mayros/dist/index.js"
ONBOARD_MARKER="$MAYROS_DIR/.onboarded"

export PATH="$RESOURCES/bin:$RESOURCES/node/bin:$PATH"

# First launch: install Mayros CLI via npm
if [[ ! -f "$CLI" ]]; then
  osascript -e 'display notification "Installing Mayros..." with title "Mayros"' 2>/dev/null || true
  "$NPM" install -g @apilium/mayros@latest --prefix "$MAYROS_DIR" --force --no-fund --no-audit 2>/dev/null
fi

# Copy Cortex binary to ~/.mayros/bin/
mkdir -p "$MAYROS_DIR/bin"
if [[ ! -f "$MAYROS_DIR/bin/aingle-cortex" ]]; then
  cp "$CORTEX" "$MAYROS_DIR/bin/aingle-cortex"
  chmod +x "$MAYROS_DIR/bin/aingle-cortex"
fi

# Onboard if needed
if [[ ! -f "$ONBOARD_MARKER" ]]; then
  "$NODE" "$CLI" onboard --non-interactive --defaults 2>/dev/null || true
fi

# Start gateway if not running
if ! pgrep -f "mayros gateway" >/dev/null 2>&1; then
  "$NODE" "$CLI" gateway start --background 2>/dev/null &
fi

# Open the portal
exec "$NODE" "$CLI" dashboard
LAUNCHER
chmod +x "$APP_DIR/Contents/MacOS/mayros-launcher"

# ---------------------------------------------------------------------------
# 3. Codesign (optional)
# ---------------------------------------------------------------------------
if [[ -n "$SIGN_IDENTITY" ]]; then
  echo "==> Codesigning with identity: $SIGN_IDENTITY"
  codesign --deep --force --options runtime \
    --sign "$SIGN_IDENTITY" \
    --entitlements /dev/null \
    "$APP_DIR"
  echo "  -> Signed successfully"
fi

# ---------------------------------------------------------------------------
# 4. Create DMG
# ---------------------------------------------------------------------------
mkdir -p "$OUTPUT_DIR"
DMG_PATH="$OUTPUT_DIR/Mayros-${MAYROS_VERSION}.dmg"
rm -f "$DMG_PATH"

echo "==> Creating DMG..."
if command -v create-dmg &>/dev/null; then
  create-dmg \
    --volname "Mayros ${MAYROS_VERSION}" \
    --volicon "$ASSETS_DIR/mayros.icns" \
    --window-pos 200 120 \
    --window-size 600 400 \
    --icon-size 100 \
    --icon "Mayros.app" 150 200 \
    --app-drop-link 450 200 \
    --hide-extension "Mayros.app" \
    --no-internet-enable \
    "$DMG_PATH" \
    "$APP_DIR"
else
  echo "  -> create-dmg not found, using hdiutil fallback"
  TEMP_DMG="$BUILD_DIR/temp.dmg"
  hdiutil create -volname "Mayros ${MAYROS_VERSION}" \
    -srcfolder "$APP_DIR" \
    -ov -format UDBZ \
    "$DMG_PATH"
fi

echo ""
echo "==> DMG created: $DMG_PATH"
echo "    Size: $(du -h "$DMG_PATH" | awk '{print $1}')"
echo "Done."
