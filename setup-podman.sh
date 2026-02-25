#!/usr/bin/env bash
# One-time host setup for rootless Mayros in Podman: creates the mayros
# user, builds the image, loads it into that user's Podman store, and installs
# the launch script. Run from repo root with sudo capability.
#
# Usage: ./setup-podman.sh [--quadlet|--container]
#   --quadlet   Install systemd Quadlet so the container runs as a user service
#   --container Only install user + image + launch script; you start the container manually (default)
#   Or set MAYROS_PODMAN_QUADLET=1 (or 0) to choose without a flag.
#
# After this, start the gateway manually:
#   ./scripts/run-mayros-podman.sh launch
#   ./scripts/run-mayros-podman.sh launch setup   # onboarding wizard
# Or as the mayros user: sudo -u mayros /home/mayros/run-mayros-podman.sh
# If you used --quadlet, you can also: sudo systemctl --machine mayros@ --user start mayros.service
set -euo pipefail

MAYROS_USER="${MAYROS_PODMAN_USER:-mayros}"
REPO_PATH="${MAYROS_REPO_PATH:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
RUN_SCRIPT_SRC="$REPO_PATH/scripts/run-mayros-podman.sh"
QUADLET_TEMPLATE="$REPO_PATH/scripts/podman/mayros.container.in"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing dependency: $1" >&2
    exit 1
  fi
}

is_root() { [[ "$(id -u)" -eq 0 ]]; }

run_root() {
  if is_root; then
    "$@"
  else
    sudo "$@"
  fi
}

run_as_user() {
  local user="$1"
  shift
  if command -v sudo >/dev/null 2>&1; then
    sudo -u "$user" "$@"
  elif is_root && command -v runuser >/dev/null 2>&1; then
    runuser -u "$user" -- "$@"
  else
    echo "Need sudo (or root+runuser) to run commands as $user." >&2
    exit 1
  fi
}

run_as_mayros() {
  # Avoid root writes into $MAYROS_HOME (symlink/hardlink/TOCTOU footguns).
  # Anything under the target user's home should be created/modified as that user.
  run_as_user "$MAYROS_USER" env HOME="$MAYROS_HOME" "$@"
}

# Quadlet: opt-in via --quadlet or MAYROS_PODMAN_QUADLET=1
INSTALL_QUADLET=false
for arg in "$@"; do
  case "$arg" in
    --quadlet)   INSTALL_QUADLET=true ;;
    --container) INSTALL_QUADLET=false ;;
  esac
done
if [[ -n "${MAYROS_PODMAN_QUADLET:-}" ]]; then
  case "${MAYROS_PODMAN_QUADLET,,}" in
    1|yes|true)  INSTALL_QUADLET=true ;;
    0|no|false) INSTALL_QUADLET=false ;;
  esac
fi

require_cmd podman
if ! is_root; then
  require_cmd sudo
fi
if [[ ! -f "$REPO_PATH/Dockerfile" ]]; then
  echo "Dockerfile not found at $REPO_PATH. Set MAYROS_REPO_PATH to the repo root." >&2
  exit 1
fi
if [[ ! -f "$RUN_SCRIPT_SRC" ]]; then
  echo "Launch script not found at $RUN_SCRIPT_SRC." >&2
  exit 1
fi

generate_token_hex_32() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import secrets
print(secrets.token_hex(32))
PY
    return 0
  fi
  if command -v od >/dev/null 2>&1; then
    # 32 random bytes -> 64 lowercase hex chars
    od -An -N32 -tx1 /dev/urandom | tr -d " \n"
    return 0
  fi
  echo "Missing dependency: need openssl or python3 (or od) to generate MAYROS_GATEWAY_TOKEN." >&2
  exit 1
}

user_exists() {
  local user="$1"
  if command -v getent >/dev/null 2>&1; then
    getent passwd "$user" >/dev/null 2>&1 && return 0
  fi
  id -u "$user" >/dev/null 2>&1
}

resolve_user_home() {
  local user="$1"
  local home=""
  if command -v getent >/dev/null 2>&1; then
    home="$(getent passwd "$user" 2>/dev/null | cut -d: -f6 || true)"
  fi
  if [[ -z "$home" && -f /etc/passwd ]]; then
    home="$(awk -F: -v u="$user" '$1==u {print $6}' /etc/passwd 2>/dev/null || true)"
  fi
  if [[ -z "$home" ]]; then
    home="/home/$user"
  fi
  printf '%s' "$home"
}

resolve_nologin_shell() {
  for cand in /usr/sbin/nologin /sbin/nologin /usr/bin/nologin /bin/false; do
    if [[ -x "$cand" ]]; then
      printf '%s' "$cand"
      return 0
    fi
  done
  printf '%s' "/usr/sbin/nologin"
}

# Create mayros user (non-login, with home) if missing
if ! user_exists "$MAYROS_USER"; then
  NOLOGIN_SHELL="$(resolve_nologin_shell)"
  echo "Creating user $MAYROS_USER ($NOLOGIN_SHELL, with home)..."
  if command -v useradd >/dev/null 2>&1; then
    run_root useradd -m -s "$NOLOGIN_SHELL" "$MAYROS_USER"
  elif command -v adduser >/dev/null 2>&1; then
    # Debian/Ubuntu: adduser supports --disabled-password/--gecos. Busybox adduser differs.
    run_root adduser --disabled-password --gecos "" --shell "$NOLOGIN_SHELL" "$MAYROS_USER"
  else
    echo "Neither useradd nor adduser found, cannot create user $MAYROS_USER." >&2
    exit 1
  fi
else
  echo "User $MAYROS_USER already exists."
fi

MAYROS_HOME="$(resolve_user_home "$MAYROS_USER")"
MAYROS_UID="$(id -u "$MAYROS_USER" 2>/dev/null || true)"
MAYROS_CONFIG="$MAYROS_HOME/.mayros"
LAUNCH_SCRIPT_DST="$MAYROS_HOME/run-mayros-podman.sh"

# Prefer systemd user services (Quadlet) for production. Enable lingering early so rootless Podman can run
# without an interactive login.
if command -v loginctl &>/dev/null; then
  run_root loginctl enable-linger "$MAYROS_USER" 2>/dev/null || true
fi
if [[ -n "${MAYROS_UID:-}" && -d /run/user ]] && command -v systemctl &>/dev/null; then
  run_root systemctl start "user@${MAYROS_UID}.service" 2>/dev/null || true
fi

# Rootless Podman needs subuid/subgid for the run user
if ! grep -q "^${MAYROS_USER}:" /etc/subuid 2>/dev/null; then
  echo "Warning: $MAYROS_USER has no subuid range. Rootless Podman may fail." >&2
  echo "  Add a line to /etc/subuid and /etc/subgid, e.g.: $MAYROS_USER:100000:65536" >&2
fi

echo "Creating $MAYROS_CONFIG and workspace..."
run_as_mayros mkdir -p "$MAYROS_CONFIG/workspace"
run_as_mayros chmod 700 "$MAYROS_CONFIG" "$MAYROS_CONFIG/workspace" 2>/dev/null || true

ENV_FILE="$MAYROS_CONFIG/.env"
if run_as_mayros test -f "$ENV_FILE"; then
  if ! run_as_mayros grep -q '^MAYROS_GATEWAY_TOKEN=' "$ENV_FILE" 2>/dev/null; then
    TOKEN="$(generate_token_hex_32)"
    printf 'MAYROS_GATEWAY_TOKEN=%s\n' "$TOKEN" | run_as_mayros tee -a "$ENV_FILE" >/dev/null
    echo "Added MAYROS_GATEWAY_TOKEN to $ENV_FILE."
  fi
  run_as_mayros chmod 600 "$ENV_FILE" 2>/dev/null || true
else
  TOKEN="$(generate_token_hex_32)"
  printf 'MAYROS_GATEWAY_TOKEN=%s\n' "$TOKEN" | run_as_mayros tee "$ENV_FILE" >/dev/null
  run_as_mayros chmod 600 "$ENV_FILE" 2>/dev/null || true
  echo "Created $ENV_FILE with new token."
fi

# The gateway refuses to start unless gateway.mode=local is set in config.
# Make first-run non-interactive; users can run the wizard later to configure channels/providers.
MAYROS_JSON="$MAYROS_CONFIG/mayros.json"
if ! run_as_mayros test -f "$MAYROS_JSON"; then
  printf '%s\n' '{ gateway: { mode: "local" } }' | run_as_mayros tee "$MAYROS_JSON" >/dev/null
  run_as_mayros chmod 600 "$MAYROS_JSON" 2>/dev/null || true
  echo "Created $MAYROS_JSON (minimal gateway.mode=local)."
fi

echo "Building image from $REPO_PATH..."
podman build -t mayros:local -f "$REPO_PATH/Dockerfile" "$REPO_PATH"

echo "Loading image into $MAYROS_USER's Podman store..."
TMP_IMAGE="$(mktemp -p /tmp mayros-image.XXXXXX.tar)"
trap 'rm -f "$TMP_IMAGE"' EXIT
podman save mayros:local -o "$TMP_IMAGE"
chmod 644 "$TMP_IMAGE"
(cd /tmp && run_as_user "$MAYROS_USER" env HOME="$MAYROS_HOME" podman load -i "$TMP_IMAGE")
rm -f "$TMP_IMAGE"
trap - EXIT

echo "Copying launch script to $LAUNCH_SCRIPT_DST..."
run_root cat "$RUN_SCRIPT_SRC" | run_as_mayros tee "$LAUNCH_SCRIPT_DST" >/dev/null
run_as_mayros chmod 755 "$LAUNCH_SCRIPT_DST"

# Optionally install systemd quadlet for mayros user (rootless Podman + systemd)
QUADLET_DIR="$MAYROS_HOME/.config/containers/systemd"
if [[ "$INSTALL_QUADLET" == true && -f "$QUADLET_TEMPLATE" ]]; then
  echo "Installing systemd quadlet for $MAYROS_USER..."
  run_as_mayros mkdir -p "$QUADLET_DIR"
  MAYROS_HOME_SED="$(printf '%s' "$MAYROS_HOME" | sed -e 's/[\\/&|]/\\\\&/g')"
  sed "s|{{MAYROS_HOME}}|$MAYROS_HOME_SED|g" "$QUADLET_TEMPLATE" | run_as_mayros tee "$QUADLET_DIR/mayros.container" >/dev/null
  run_as_mayros chmod 700 "$MAYROS_HOME/.config" "$MAYROS_HOME/.config/containers" "$QUADLET_DIR" 2>/dev/null || true
  run_as_mayros chmod 600 "$QUADLET_DIR/mayros.container" 2>/dev/null || true
  if command -v systemctl &>/dev/null; then
    run_root systemctl --machine "${MAYROS_USER}@" --user daemon-reload 2>/dev/null || true
    run_root systemctl --machine "${MAYROS_USER}@" --user enable mayros.service 2>/dev/null || true
    run_root systemctl --machine "${MAYROS_USER}@" --user start mayros.service 2>/dev/null || true
  fi
fi

echo ""
echo "Setup complete. Start the gateway:"
echo "  $RUN_SCRIPT_SRC launch"
echo "  $RUN_SCRIPT_SRC launch setup   # onboarding wizard"
echo "Or as $MAYROS_USER (e.g. from cron):"
echo "  sudo -u $MAYROS_USER $LAUNCH_SCRIPT_DST"
echo "  sudo -u $MAYROS_USER $LAUNCH_SCRIPT_DST setup"
if [[ "$INSTALL_QUADLET" == true ]]; then
  echo "Or use systemd (quadlet):"
  echo "  sudo systemctl --machine ${MAYROS_USER}@ --user start mayros.service"
  echo "  sudo systemctl --machine ${MAYROS_USER}@ --user status mayros.service"
else
  echo "To install systemd quadlet later: $0 --quadlet"
fi
