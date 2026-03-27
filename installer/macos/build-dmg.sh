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

export PATH="$RESOURCES/bin:$RESOURCES/node/bin:$PATH"
mkdir -p "$MAYROS_DIR/bin"

# ── Helpers ──
# Use Mayros.app's bundle identifier so macOS shows its icon in notifications.
_notify() {
  osascript -e "tell application id \"com.apilium.mayros\" to display notification \"$1\" with title \"Mayros\"" 2>/dev/null \
    || osascript -e "display notification \"$1\" with title \"Mayros\"" 2>/dev/null
}
_fail() {
  osascript -e "display dialog \"$1\" with title \"Mayros\" buttons {\"OK\"} default button \"OK\" with icon stop" 2>/dev/null
  exit 1
}
_log() { echo "$1" >> "$LOG"; }

# ── First-time setup ──
# The actual work runs HERE in bash (no zsh/oh-my-zsh/fish dependency).
# A Terminal window opens as a read-only observer showing progress via
# tail -f on the log. If Terminal fails to open, setup still completes.
if [[ ! -f "$CLI" ]]; then

  # Prepare log
  echo "[$(date -Iseconds)] First-launch setup starting" > "$LOG"

  _notify "Installing Mayros CLI... (1-2 minutes)"

  # ── Step 1: Install CLI ──
  _log "  [1/6] Installing Mayros CLI..."
  _log "         This may take 1-2 minutes."
  _log ""
  # Prefer bundled tarball (includes all local changes); fall back to npm registry
  LOCAL_TGZ="$RESOURCES/mayros-local.tgz"
  if [[ -f "$LOCAL_TGZ" ]]; then
    "$NPM" install -g "$LOCAL_TGZ" --prefix "$MAYROS_DIR" --force --no-fund --no-audit >> "$LOG" 2>&1
  fi
  if [[ ! -f "$CLI" ]]; then
    "$NPM" install -g @apilium/mayros@latest --prefix "$MAYROS_DIR" --force --no-fund --no-audit >> "$LOG" 2>&1
  fi
  if [[ ! -f "$CLI" ]]; then
    _log ""
    _log "  ERROR: Installation failed."
    _log "  Check your internet connection and try again."
    _fail "Mayros installation failed. Check ~/.mayros/install.log for details."
  fi
  _log "  Done."
  _log ""

  # ── Step 2: Setup PATH ──
  _log "  [2/6] Configuring terminal PATH..."
  SHELL_PROFILE=""
  [[ -f "$HOME/.zshrc" ]] && SHELL_PROFILE="$HOME/.zshrc"
  [[ -z "$SHELL_PROFILE" && -f "$HOME/.bash_profile" ]] && SHELL_PROFILE="$HOME/.bash_profile"
  [[ -z "$SHELL_PROFILE" && -f "$HOME/.bashrc" ]] && SHELL_PROFILE="$HOME/.bashrc"
  if [[ -n "$SHELL_PROFILE" ]] && ! grep -q '.mayros/bin' "$SHELL_PROFILE" 2>/dev/null; then
    printf '\n# Mayros CLI\nexport PATH="$HOME/.mayros/bin:$PATH"\n' >> "$SHELL_PROFILE"
  fi
  _log "  Done."
  _log ""

  # ── Step 3: Copy Cortex binary ──
  _log "  [3/6] Setting up AIngle Cortex..."
  if [[ ! -f "$MAYROS_DIR/bin/aingle-cortex" ]]; then
    cp "$CORTEX" "$MAYROS_DIR/bin/aingle-cortex"
    chmod +x "$MAYROS_DIR/bin/aingle-cortex"
  fi
  _log "  Done."
  _log ""

  # ── Step 4: Create CLI wrapper ──
  _log "  [4/6] Creating CLI wrapper..."
  cat > "$MAYROS_DIR/bin/mayros" <<'WRAP'
#!/usr/bin/env bash
MAYROS_DIR="$HOME/.mayros"
NODE="$MAYROS_DIR/node/bin/node"
[[ ! -f "$NODE" ]] && NODE="/Applications/Mayros.app/Contents/Resources/node/bin/node"
CLI="$MAYROS_DIR/lib/node_modules/@apilium/mayros/dist/index.js"
[[ ! -f "$CLI" ]] && CLI="$MAYROS_DIR/node_modules/@apilium/mayros/dist/index.js"
if [[ ! -f "$CLI" ]]; then
  echo "Mayros not installed. Open Mayros.app or: npm install -g @apilium/mayros"
  exit 1
fi
exec "$NODE" "$CLI" "$@"
WRAP
  chmod +x "$MAYROS_DIR/bin/mayros"
  if [[ ! -d "$MAYROS_DIR/node" ]]; then
    if [[ -d "/Applications/Mayros.app/Contents/Resources/node" ]]; then
      ln -sf "/Applications/Mayros.app/Contents/Resources/node" "$MAYROS_DIR/node"
    else
      cp -R "$RESOURCES/node" "$MAYROS_DIR/node"
    fi
  fi
  _log "  Done."
  _log ""

  # ── Step 5: Write config + bootstrap workspace ──
  _log "  [5/6] Running initial configuration..."
  CONFIG_FILE="$MAYROS_DIR/mayros.json"
  "$NODE" -e "
    const fs = require('fs');
    const f = '$CONFIG_FILE';
    let c = {};
    try { c = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    if (!c.gateway) c.gateway = {};
    if (!c.gateway.mode) c.gateway.mode = 'local';
    if (!c.gateway.auth) c.gateway.auth = {};
    c.gateway.auth.mode = 'none';
    fs.writeFileSync(f, JSON.stringify(c, null, 2) + '\n');
  " >> "$LOG" 2>&1 || echo '{"gateway":{"mode":"local","auth":{"mode":"none"}}}' > "$CONFIG_FILE"

  # Bootstrap workspace with templates so the agent can start
  WORKSPACE="$MAYROS_DIR/workspace"
  TEMPLATES="$MAYROS_DIR/lib/node_modules/@apilium/mayros/docs/reference/templates"
  if [[ -d "$TEMPLATES" ]]; then
    mkdir -p "$WORKSPACE"
    for tmpl in AGENTS.md MAYROS.md TOOLS.md IDENTITY.md USER.md HOPE.md BOOTSTRAP.md; do
      [[ -f "$TEMPLATES/$tmpl" ]] && [[ ! -f "$WORKSPACE/$tmpl" ]] && cp "$TEMPLATES/$tmpl" "$WORKSPACE/$tmpl"
    done
    [[ ! -f "$WORKSPACE/MEMORY.md" ]] && echo "# Memory" > "$WORKSPACE/MEMORY.md"
  fi
  _log "  Done."
  _log ""

  # ── Step 6: Start services ──
  _log "  [6/6] Starting services..."

  if ! pgrep -f "aingle-cortex" >/dev/null 2>&1; then
    "$MAYROS_DIR/bin/aingle-cortex" --port 19090 >> "$LOG" 2>&1 &
  fi
  _log "         Waiting for Cortex..."
  for i in $(seq 1 20); do
    curl -s --max-time 2 "http://127.0.0.1:19090/health" >/dev/null 2>&1 && break
    sleep 1
  done
  _log "         Cortex ready."

  if ! pgrep -f "mayros gateway" >/dev/null 2>&1; then
    "$NODE" "$CLI" gateway install >> "$LOG" 2>&1 || true
    "$NODE" "$CLI" gateway start >> "$LOG" 2>&1 &
  fi
  _log "         Waiting for Gateway..."
  for i in $(seq 1 30); do
    curl -s --max-time 2 "http://127.0.0.1:18789/health" >/dev/null 2>&1 && break
    sleep 1
  done
  _log "         Gateway ready."
  _log ""
  _log "  ====================================="
  _log "     Mayros is ready!"
  _log "  ====================================="
  _log ""
  _log "  You can now use 'mayros' from any"
  _log "  terminal (open a new tab first)."
  _log ""
  _log "  Try: mayros code"
  _log ""

  open "http://127.0.0.1:18789"
  exit 0
fi

# ── Normal launch (not first time) ───────────────────────────────────

# Start Cortex if not running
if ! pgrep -f "aingle-cortex" >/dev/null 2>&1; then
  "$MAYROS_DIR/bin/aingle-cortex" --port 19090 >>"$LOG" 2>&1 &
fi
# Always wait for Cortex to be healthy
for i in $(seq 1 15); do
  curl -s --max-time 2 "http://127.0.0.1:19090/health" >/dev/null 2>&1 && break
  sleep 1
done

# Start Gateway if not running
if ! pgrep -f "mayros gateway" >/dev/null 2>&1; then
  "$NODE" "$CLI" gateway install >>"$LOG" 2>&1 || true
  "$NODE" "$CLI" gateway start >>"$LOG" 2>&1 &
fi
# Always wait for Gateway to be healthy before opening dashboard
for i in $(seq 1 30); do
  curl -s --max-time 2 "http://127.0.0.1:18789/health" >/dev/null 2>&1 && break
  sleep 1
done

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
