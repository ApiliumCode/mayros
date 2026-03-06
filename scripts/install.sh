#!/usr/bin/env bash
set -euo pipefail

# Mayros Installer
# Usage: curl -fsSL https://mayros.apilium.com/install.sh | bash
#
# Installs Mayros CLI and ensures Node >= 22 is available.
# Uses fnm (Fast Node Manager) if Node is missing or too old.
#
# Environment variables:
#   NO_COLOR=1          Disable colored output
#   MAYROS_SKIP_NODE=1  Skip Node version check (assume Node >= 22 is in PATH)

# ---------------------------------------------------------------------------
# Color helpers
# ---------------------------------------------------------------------------

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD="\033[1m"
  GREEN="\033[32m"
  YELLOW="\033[33m"
  RED="\033[31m"
  CYAN="\033[36m"
  RESET="\033[0m"
else
  BOLD="" GREEN="" YELLOW="" RED="" CYAN="" RESET=""
fi

info()  { printf "${CYAN}info${RESET}  %s\n" "$*"; }
ok()    { printf "${GREEN}ok${RESET}    %s\n" "$*"; }
warn()  { printf "${YELLOW}warn${RESET}  %s\n" "$*"; }
error() { printf "${RED}error${RESET} %s\n" "$*" >&2; }
fatal() { error "$@"; exit 1; }

# ---------------------------------------------------------------------------
# OS / arch detection
# ---------------------------------------------------------------------------

detect_os_arch() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    darwin) OS="darwin" ;;
    linux)  OS="linux"  ;;
    *)      fatal "Unsupported OS: $os. Mayros supports macOS and Linux." ;;
  esac

  case "$arch" in
    x86_64|amd64)  ARCH="x64"   ;;
    aarch64|arm64) ARCH="arm64" ;;
    *)             fatal "Unsupported architecture: $arch" ;;
  esac

  info "Detected ${BOLD}${OS}_${ARCH}${RESET}"
}

# ---------------------------------------------------------------------------
# Node version check
# ---------------------------------------------------------------------------

REQUIRED_NODE_MAJOR=22

check_node() {
  if [ "${MAYROS_SKIP_NODE:-}" = "1" ]; then
    info "Skipping Node check (MAYROS_SKIP_NODE=1)"
    NODE_OK=true
    return
  fi

  if ! command -v node >/dev/null 2>&1; then
    NODE_OK=false
    return
  fi

  local version major
  version="$(node --version 2>/dev/null || echo "v0")"
  # Strip leading 'v' and extract major
  major="${version#v}"
  major="${major%%.*}"

  if [ "$major" -ge "$REQUIRED_NODE_MAJOR" ] 2>/dev/null; then
    ok "Node ${version} detected (>= ${REQUIRED_NODE_MAJOR} required)"
    NODE_OK=true
  else
    warn "Node ${version} is too old (>= ${REQUIRED_NODE_MAJOR} required)"
    NODE_OK=false
  fi
}

# ---------------------------------------------------------------------------
# Install Node via fnm
# ---------------------------------------------------------------------------

install_node_via_fnm() {
  info "Installing fnm (Fast Node Manager)..."

  if command -v fnm >/dev/null 2>&1; then
    info "fnm already installed"
  else
    curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
    # Source fnm into current shell
    export PATH="$HOME/.local/share/fnm:$HOME/.fnm:$PATH"
    if [ -f "$HOME/.local/share/fnm/fnm" ]; then
      eval "$("$HOME/.local/share/fnm/fnm" env)"
    elif command -v fnm >/dev/null 2>&1; then
      eval "$(fnm env)"
    else
      fatal "fnm installation failed. Install Node >= ${REQUIRED_NODE_MAJOR} manually."
    fi
  fi

  info "Installing Node ${REQUIRED_NODE_MAJOR} via fnm..."
  fnm install "$REQUIRED_NODE_MAJOR"
  fnm use "$REQUIRED_NODE_MAJOR"

  # Verify
  local version
  version="$(node --version 2>/dev/null || echo "unknown")"
  ok "Node ${version} installed via fnm"
}

# ---------------------------------------------------------------------------
# Install Mayros
# ---------------------------------------------------------------------------

install_mayros() {
  info "Installing ${BOLD}@apilium/mayros${RESET} globally..."
  npm install -g @apilium/mayros
  ok "@apilium/mayros installed"
}

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------

verify_installation() {
  if ! command -v mayros >/dev/null 2>&1; then
    warn "mayros not found in PATH. You may need to restart your shell."
    warn "Try: exec \$SHELL -l && mayros --version"
    return
  fi

  local ver
  ver="$(mayros --version 2>/dev/null || echo "unknown")"
  ok "Mayros ${ver} is ready"
  echo ""
  printf "${BOLD}Get started:${RESET}\n"
  echo "  mayros onboard    # First-time setup"
  echo "  mayros code       # Start coding session"
  echo ""
  printf "${CYAN}Docs:${RESET} https://apilium.com/us/doc/mayros\n"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  echo ""
  printf "${BOLD}${CYAN}Mayros Installer${RESET}\n"
  echo ""

  detect_os_arch
  check_node

  if [ "$NODE_OK" = false ]; then
    install_node_via_fnm
  fi

  install_mayros
  verify_installation
}

# Only run when executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
