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
# Mayros application launcher — runs on every app open
RESOURCES="$(dirname "$0")/../Resources"
NODE="$RESOURCES/node/bin/node"
NPM="$RESOURCES/node/bin/npm"
CORTEX="$RESOURCES/bin/aingle-cortex"
MAYROS_DIR="$HOME/.mayros"
CLI="$MAYROS_DIR/lib/node_modules/@apilium/mayros/dist/index.js"
LOG="$MAYROS_DIR/install.log"
SETUP_SCRIPT="$MAYROS_DIR/.mayros-setup.sh"

export PATH="$RESOURCES/bin:$RESOURCES/node/bin:$PATH"
mkdir -p "$MAYROS_DIR/bin"

# If first launch, open a visible Terminal window so user sees progress
if [[ ! -f "$CLI" ]]; then
  # Create the setup script that Terminal.app will run
  cat > "$SETUP_SCRIPT" <<SETUP
#!/usr/bin/env bash
clear
echo ""
echo "  ====================================="
echo "     Mayros — First Launch Setup"
echo "  ====================================="
echo ""

# Step 1: Install CLI
echo "  [1/6] Installing Mayros CLI..."
echo "         This may take 1-2 minutes."
echo ""
"$NPM" install -g @apilium/mayros@latest --prefix "$MAYROS_DIR" --force --no-fund --no-audit 2>&1 | tail -5
if [[ ! -f "$CLI" ]]; then
  echo ""
  echo "  ERROR: Installation failed."
  echo "  Check your internet connection and try again."
  echo ""
  read -p "  Press Enter to close..."
  exit 1
fi
echo "  ✓ Mayros CLI installed"
echo ""

# Step 2: Setup PATH
echo "  [2/6] Configuring terminal PATH..."
SHELL_PROFILE=""
[[ -f "\$HOME/.zshrc" ]] && SHELL_PROFILE="\$HOME/.zshrc"
[[ -z "\$SHELL_PROFILE" && -f "\$HOME/.bash_profile" ]] && SHELL_PROFILE="\$HOME/.bash_profile"
[[ -z "\$SHELL_PROFILE" && -f "\$HOME/.bashrc" ]] && SHELL_PROFILE="\$HOME/.bashrc"
if [[ -n "\$SHELL_PROFILE" ]] && ! grep -q '.mayros/bin' "\$SHELL_PROFILE" 2>/dev/null; then
  printf '\n# Mayros CLI\nexport PATH="\$HOME/.mayros/bin:\$PATH"\n' >> "\$SHELL_PROFILE"
fi
echo "  ✓ PATH configured"
echo ""

# Step 3: Copy Cortex
echo "  [3/6] Setting up AIngle Cortex..."
if [[ ! -f "$MAYROS_DIR/bin/aingle-cortex" ]]; then
  cp "$CORTEX" "$MAYROS_DIR/bin/aingle-cortex"
  chmod +x "$MAYROS_DIR/bin/aingle-cortex"
fi
echo "  ✓ Cortex ready"
echo ""

# Step 4: Create CLI wrapper
echo "  [4/6] Creating CLI wrapper..."
cat > "$MAYROS_DIR/bin/mayros" <<'WRAP'
#!/usr/bin/env bash
MAYROS_DIR="\$HOME/.mayros"
NODE="\$MAYROS_DIR/node/bin/node"
[[ ! -f "\$NODE" ]] && NODE="/Applications/Mayros.app/Contents/Resources/node/bin/node"
CLI="\$MAYROS_DIR/lib/node_modules/@apilium/mayros/dist/index.js"
[[ ! -f "\$CLI" ]] && CLI="\$MAYROS_DIR/node_modules/@apilium/mayros/dist/index.js"
if [[ ! -f "\$CLI" ]]; then
  echo "Mayros not installed. Open Mayros.app or: npm install -g @apilium/mayros"
  exit 1
fi
exec "\$NODE" "\$CLI" "\$@"
WRAP
chmod +x "$MAYROS_DIR/bin/mayros"

# Link node for terminal use
if [[ ! -d "$MAYROS_DIR/node" ]]; then
  if [[ -d "/Applications/Mayros.app/Contents/Resources/node" ]]; then
    ln -sf "/Applications/Mayros.app/Contents/Resources/node" "$MAYROS_DIR/node"
  else
    cp -R "$RESOURCES/node" "$MAYROS_DIR/node"
  fi
fi
echo "  ✓ CLI wrapper created"
echo ""

# Step 5: Configure gateway (skip onboard so portal wizard shows)
echo "  [5/6] Running initial configuration..."
# Minimal config: gateway.mode=local + auth.mode=none (portal wizard configures auth later)
CONFIG_FILE="$MAYROS_DIR/mayros.json"
if [[ -f "\$CONFIG_FILE" ]]; then
  "$NODE" -e "
    const fs = require('fs');
    const f = '\$CONFIG_FILE';
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!c.gateway) c.gateway = {};
    if (!c.gateway.mode) c.gateway.mode = 'local';
    if (!c.gateway.auth) c.gateway.auth = {};
    if (!c.gateway.auth.mode) c.gateway.auth.mode = 'none';
    fs.writeFileSync(f, JSON.stringify(c, null, 2));
  " 2>/dev/null || true
else
  echo '{\"gateway\":{\"mode\":\"local\",\"auth\":{\"mode\":\"none\"}}}' > "\$CONFIG_FILE"
fi
echo "  ✓ Configuration complete"
echo ""

# Step 6: Start services
echo "  [6/6] Starting services..."
if ! pgrep -f "aingle-cortex" >/dev/null 2>&1; then
  "$MAYROS_DIR/bin/aingle-cortex" --port 19090 >> "$LOG" 2>&1 &
fi
echo -n "         Waiting for Cortex."
for i in \$(seq 1 20); do
  curl -s --max-time 2 "http://127.0.0.1:19090/health" >/dev/null 2>&1 && break
  echo -n "."
  sleep 1
done
echo " ✓"

if ! pgrep -f "mayros gateway" >/dev/null 2>&1; then
  "$NODE" "$CLI" gateway install 2>/dev/null || true
  "$NODE" "$CLI" gateway start 2>/dev/null &
fi
echo -n "         Waiting for Gateway."
for i in \$(seq 1 30); do
  curl -s --max-time 2 "http://127.0.0.1:18789/health" >/dev/null 2>&1 && break
  echo -n "."
  sleep 1
done
echo " ✓"

echo ""
echo "  ====================================="
echo "     Mayros is ready!"
echo "     Opening dashboard..."
echo "  ====================================="
echo ""
echo "  You can now use 'mayros' from any"
echo "  terminal (open a new tab first)."
echo ""
echo "  Try: mayros code"
echo ""

# Open portal
open "http://127.0.0.1:18789"

sleep 3
rm -f "$SETUP_SCRIPT"
SETUP
  chmod +x "$SETUP_SCRIPT"

  # Open Terminal.app with the setup script (user sees everything)
  open -a Terminal "$SETUP_SCRIPT"
  exit 0
fi

# ── Normal launch (not first time) ───────────────────────────────────

# Start Cortex if not running
if ! pgrep -f "aingle-cortex" >/dev/null 2>&1; then
  "$MAYROS_DIR/bin/aingle-cortex" --port 19090 &>/dev/null &
  for i in $(seq 1 15); do
    curl -s --max-time 2 "http://127.0.0.1:19090/health" >/dev/null 2>&1 && break
    sleep 1
  done
fi

# Start Gateway if not running
if ! pgrep -f "mayros gateway" >/dev/null 2>&1; then
  "$NODE" "$CLI" gateway install 2>/dev/null || true
  "$NODE" "$CLI" gateway start 2>/dev/null &
  for i in $(seq 1 20); do
    curl -s --max-time 2 "http://127.0.0.1:18789/health" >/dev/null 2>&1 && break
    sleep 1
  done
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
