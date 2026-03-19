#!/usr/bin/env bash
# build-deb.sh — Builds a Mayros .deb package for Debian/Ubuntu
# Usage: ./build-deb.sh [--arch x64|arm64]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER_DIR="$(dirname "$SCRIPT_DIR")"
SHARED_DIR="$INSTALLER_DIR/shared"
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
DEB_ARCH="amd64"
[[ "$TARGET_ARCH" == "arm64" ]] && DEB_ARCH="arm64"

# Read versions from manifest
MANIFEST="$SHARED_DIR/bundle-manifest.json"
read_json() { python3 -c "import json;print(json.load(open('$MANIFEST'))$1)"; }

MAYROS_VERSION=$(read_json "['mayros']")
NODE_VERSION=$(read_json "['node']")
CORTEX_VERSION=$(read_json "['cortex']")

PKG_NAME="mayros_${MAYROS_VERSION}_${DEB_ARCH}"

echo "==> Mayros $MAYROS_VERSION .deb Builder ($DEB_ARCH)"
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
# 2. Create package directory structure
# ---------------------------------------------------------------------------
PKG_DIR="$BUILD_DIR/$PKG_NAME"
rm -rf "$PKG_DIR"

echo "==> Creating package structure..."
mkdir -p "$PKG_DIR/opt/mayros/node"
mkdir -p "$PKG_DIR/opt/mayros/cli"
mkdir -p "$PKG_DIR/opt/mayros/bin"
mkdir -p "$PKG_DIR/usr/local/bin"
mkdir -p "$PKG_DIR/usr/share/applications"
mkdir -p "$PKG_DIR/usr/share/icons/hicolor/256x256/apps"
mkdir -p "$PKG_DIR/usr/lib/systemd/user"
mkdir -p "$PKG_DIR/DEBIAN"

# Extract Node.js
NODE_FILE=$(read_json "['platforms']['$PLATFORM']['node']")
echo "  -> Extracting Node.js..."
tar -xJf "$DEPS_DIR/$NODE_FILE" -C "$PKG_DIR/opt/mayros/node" --strip-components=1

# Extract Cortex
CORTEX_FILE=$(read_json "['platforms']['$PLATFORM']['cortex']")
echo "  -> Extracting Cortex..."
tar -xzf "$DEPS_DIR/$CORTEX_FILE" -C "$PKG_DIR/opt/mayros/bin"
chmod +x "$PKG_DIR/opt/mayros/bin/"*

# Extract Mayros CLI
TARBALL=$(ls "$DEPS_DIR"/*.tgz 2>/dev/null | head -1)
if [[ -n "$TARBALL" ]]; then
  echo "  -> Extracting Mayros CLI..."
  tar -xzf "$TARBALL" -C "$PKG_DIR/opt/mayros/cli" --strip-components=1
fi

# Symlink
ln -sf /opt/mayros/bin/mayros "$PKG_DIR/usr/local/bin/mayros"

# Wrapper script
cat > "$PKG_DIR/opt/mayros/bin/mayros" <<'WRAPPER'
#!/usr/bin/env bash
exec /opt/mayros/node/bin/node /opt/mayros/cli/dist/index.js "$@"
WRAPPER
chmod +x "$PKG_DIR/opt/mayros/bin/mayros"

# Desktop file
cp "$SCRIPT_DIR/mayros.desktop" "$PKG_DIR/usr/share/applications/mayros.desktop"

# Systemd user service for gateway
cat > "$PKG_DIR/usr/lib/systemd/user/mayros-gateway.service" <<SERVICE
[Unit]
Description=Mayros Gateway
After=network.target

[Service]
Type=simple
ExecStart=/opt/mayros/bin/mayros gateway start --foreground
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
SERVICE

# ---------------------------------------------------------------------------
# 3. DEBIAN control files
# ---------------------------------------------------------------------------
cat > "$PKG_DIR/DEBIAN/control" <<CONTROL
Package: mayros
Version: ${MAYROS_VERSION}
Section: devel
Priority: optional
Architecture: ${DEB_ARCH}
Maintainer: Apilium Technologies <hello@apilium.com>
Homepage: https://mayros.apilium.com
Description: Mayros - AI agent framework
 Mayros is a framework for building, deploying, and managing
 AI agents across terminals, messaging channels, and devices.
 .
 This package includes the Mayros CLI, a portable Node.js runtime,
 and the AIngle Cortex semantic memory engine.
CONTROL

cat > "$PKG_DIR/DEBIAN/postinst" <<'POSTINST'
#!/bin/bash
set -e

# Run onboarding for the installing user
if [ -n "$SUDO_USER" ]; then
  su - "$SUDO_USER" -c "/opt/mayros/bin/mayros onboard --non-interactive --defaults" || true
  # Enable gateway service for the user
  su - "$SUDO_USER" -c "systemctl --user daemon-reload" || true
  su - "$SUDO_USER" -c "systemctl --user enable mayros-gateway.service" || true
  su - "$SUDO_USER" -c "systemctl --user start mayros-gateway.service" || true
else
  /opt/mayros/bin/mayros onboard --non-interactive --defaults || true
fi

echo "Mayros installed successfully. Run 'mayros' to get started."
POSTINST
chmod 755 "$PKG_DIR/DEBIAN/postinst"

cat > "$PKG_DIR/DEBIAN/prerm" <<'PRERM'
#!/bin/bash
set -e

# Stop gateway service
if [ -n "$SUDO_USER" ]; then
  su - "$SUDO_USER" -c "systemctl --user stop mayros-gateway.service" 2>/dev/null || true
  su - "$SUDO_USER" -c "systemctl --user disable mayros-gateway.service" 2>/dev/null || true
fi

# Run uninstall cleanup
/opt/mayros/bin/mayros uninstall --all --yes --non-interactive 2>/dev/null || true
PRERM
chmod 755 "$PKG_DIR/DEBIAN/prerm"

# ---------------------------------------------------------------------------
# 4. Build .deb
# ---------------------------------------------------------------------------
mkdir -p "$OUTPUT_DIR"
DEB_PATH="$OUTPUT_DIR/${PKG_NAME}.deb"

echo "==> Building .deb package..."
dpkg-deb --build --root-owner-group "$PKG_DIR" "$DEB_PATH"

echo ""
echo "==> Package created: $DEB_PATH"
echo "    Size: $(du -h "$DEB_PATH" | awk '{print $1}')"
echo ""
echo "Install with: sudo dpkg -i $DEB_PATH"
echo "Done."
