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
else
  echo "Error: $ASSETS_DIR/mayros.icns not found. Cannot build .app without icon."
  exit 1
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

# Progress notification helper (non-blocking, uses app icon, no buttons)
show_progress() {
  osascript -e "display notification \"$1\" with title \"Mayros\"" 2>/dev/null || true
}
dismiss_progress() {
  : # notifications auto-dismiss
}

# First launch: install Mayros CLI via npm
if [[ ! -f "$CLI" ]]; then
  show_progress "Installing Mayros...\n\nThis may take a minute. Please wait."
  if ! "$NPM" install -g @apilium/mayros@latest --prefix "$MAYROS_DIR" --force --no-fund --no-audit 2>/dev/null; then
    dismiss_progress
    osascript -e 'display alert "Mayros Installation Failed" message "npm install failed. Check your internet connection and try again." as critical' 2>/dev/null || true
    exit 1
  fi
  dismiss_progress
fi

# Add ~/.mayros/bin to PATH right after install, so PATH is set even if user quits early
SHELL_PROFILE=""
if [[ -f "$HOME/.zshrc" ]]; then
  SHELL_PROFILE="$HOME/.zshrc"
elif [[ -f "$HOME/.bash_profile" ]]; then
  SHELL_PROFILE="$HOME/.bash_profile"
elif [[ -f "$HOME/.bashrc" ]]; then
  SHELL_PROFILE="$HOME/.bashrc"
fi
if [[ -n "$SHELL_PROFILE" ]] && ! grep -q '.mayros/bin' "$SHELL_PROFILE" 2>/dev/null; then
  echo '' >> "$SHELL_PROFILE"
  echo '# Mayros CLI' >> "$SHELL_PROFILE"
  echo 'export PATH="$HOME/.mayros/bin:$PATH"' >> "$SHELL_PROFILE"
fi

# Copy Cortex binary to ~/.mayros/bin/
mkdir -p "$MAYROS_DIR/bin"
if [[ ! -f "$MAYROS_DIR/bin/aingle-cortex" ]]; then
  show_progress "Setting up AIngle Cortex..."
  cp "$CORTEX" "$MAYROS_DIR/bin/aingle-cortex"
  chmod +x "$MAYROS_DIR/bin/aingle-cortex"
  dismiss_progress
fi

# Create CLI wrapper so 'mayros' works from any terminal
WRAPPER="$MAYROS_DIR/bin/mayros"
if [[ ! -f "$WRAPPER" ]]; then
  cat > "$WRAPPER" <<'WRAP'
#!/usr/bin/env bash
MAYROS_DIR="$HOME/.mayros"
NODE="$MAYROS_DIR/node/bin/node"
# Fallback: use app bundle node if ~/.mayros/node doesn't exist
if [[ ! -f "$NODE" ]]; then
  APP_NODE="/Applications/Mayros.app/Contents/Resources/node/bin/node"
  [[ -f "$APP_NODE" ]] && NODE="$APP_NODE"
fi
# Try installer location (npm --prefix)
CLI="$MAYROS_DIR/lib/node_modules/@apilium/mayros/dist/index.js"
# Fallback: node_modules at root (some npm versions)
if [[ ! -f "$CLI" ]]; then
  CLI="$MAYROS_DIR/node_modules/@apilium/mayros/dist/index.js"
fi
# Fallback: standard npm global install
if [[ ! -f "$CLI" ]]; then
  GLOBAL_CLI="$(which mayros 2>/dev/null)"
  if [[ -n "$GLOBAL_CLI" && "$GLOBAL_CLI" != "$0" ]]; then
    exec "$GLOBAL_CLI" "$@"
  fi
  echo "Mayros is not installed. Open Mayros.app first or run: npm install -g @apilium/mayros"
  exit 1
fi
exec "$NODE" "$CLI" "$@"
WRAP
  chmod +x "$WRAPPER"
fi

# Link bundled node to ~/.mayros/node/ for CLI use outside the app
# Use symlink if the app is in /Applications to avoid ~500MB copy
if [[ ! -d "$MAYROS_DIR/node" ]]; then
  if [[ -d "/Applications/Mayros.app/Contents/Resources/node" ]]; then
    ln -s "/Applications/Mayros.app/Contents/Resources/node" "$MAYROS_DIR/node"
  else
    cp -R "$RESOURCES/node" "$MAYROS_DIR/node"
  fi
fi

# Onboard if needed
if [[ ! -f "$ONBOARD_MARKER" ]]; then
  show_progress "Configuring Mayros for first use..."
  if ! "$NODE" "$CLI" onboard --non-interactive --defaults 2>/dev/null; then
    osascript -e 'display notification "Initial setup had issues. You can re-run: mayros onboard" with title "Mayros"' 2>/dev/null || true
  fi
  dismiss_progress
fi

# Start Cortex if not running and wait for it
if ! pgrep -f "aingle-cortex" >/dev/null 2>&1; then
  "$MAYROS_DIR/bin/aingle-cortex" --port 19090 &>/dev/null &
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
  show_progress "Starting Mayros Gateway..."
  "$NODE" "$CLI" gateway start --background 2>/dev/null &
fi

# Wait for gateway to be ready before opening the portal
GATEWAY_URL="http://127.0.0.1:18789/health"
TRIES=0
MAX_TRIES=30
while [[ $TRIES -lt $MAX_TRIES ]]; do
  if curl -s --max-time 2 "$GATEWAY_URL" >/dev/null 2>&1; then
    break
  fi
  TRIES=$((TRIES + 1))
  sleep 1
done
dismiss_progress 2>/dev/null || true

if [[ $TRIES -ge $MAX_TRIES ]]; then
  osascript -e 'display notification "Gateway is taking longer than expected. Opening portal anyway." with title "Mayros"' 2>/dev/null || true
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
