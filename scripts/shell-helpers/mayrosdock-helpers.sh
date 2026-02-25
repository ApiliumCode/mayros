#!/usr/bin/env bash
# MayrosDock - Docker helpers for Mayros
# Inspired by Simon Willison's "Running Mayros in Docker"
# https://til.simonwillison.net/llms/mayros-docker
#
# Installation:
#   mkdir -p ~/.mayrosdock && curl -sL https://raw.githubusercontent.com/mayros/mayros/main/scripts/shell-helpers/mayrosdock-helpers.sh -o ~/.mayrosdock/mayrosdock-helpers.sh
#   echo 'source ~/.mayrosdock/mayrosdock-helpers.sh' >> ~/.zshrc
#
# Usage:
#   mayrosdock-help    # Show all available commands

# =============================================================================
# Colors
# =============================================================================
_CLR_RESET='\033[0m'
_CLR_BOLD='\033[1m'
_CLR_DIM='\033[2m'
_CLR_GREEN='\033[0;32m'
_CLR_YELLOW='\033[1;33m'
_CLR_BLUE='\033[0;34m'
_CLR_MAGENTA='\033[0;35m'
_CLR_CYAN='\033[0;36m'
_CLR_RED='\033[0;31m'

# Styled command output (green + bold)
_clr_cmd() {
  echo -e "${_CLR_GREEN}${_CLR_BOLD}$1${_CLR_RESET}"
}

# Inline command for use in sentences
_cmd() {
  echo "${_CLR_GREEN}${_CLR_BOLD}$1${_CLR_RESET}"
}

# =============================================================================
# Config
# =============================================================================
MAYROSDOCK_CONFIG="${HOME}/.mayrosdock/config"

# Common paths to check for Mayros
MAYROSDOCK_COMMON_PATHS=(
  "${HOME}/mayros"
  "${HOME}/workspace/mayros"
  "${HOME}/projects/mayros"
  "${HOME}/dev/mayros"
  "${HOME}/code/mayros"
  "${HOME}/src/mayros"
)

_mayrosdock_filter_warnings() {
  grep -v "^WARN\|^time="
}

_mayrosdock_trim_quotes() {
  local value="$1"
  value="${value#\"}"
  value="${value%\"}"
  printf "%s" "$value"
}

_mayrosdock_read_config_dir() {
  if [[ ! -f "$MAYROSDOCK_CONFIG" ]]; then
    return 1
  fi
  local raw
  raw=$(sed -n 's/^MAYROSDOCK_DIR=//p' "$MAYROSDOCK_CONFIG" | head -n 1)
  if [[ -z "$raw" ]]; then
    return 1
  fi
  _mayrosdock_trim_quotes "$raw"
}

# Ensure MAYROSDOCK_DIR is set and valid
_mayrosdock_ensure_dir() {
  # Already set and valid?
  if [[ -n "$MAYROSDOCK_DIR" && -f "${MAYROSDOCK_DIR}/docker-compose.yml" ]]; then
    return 0
  fi

  # Try loading from config
  local config_dir
  config_dir=$(_mayrosdock_read_config_dir)
  if [[ -n "$config_dir" && -f "${config_dir}/docker-compose.yml" ]]; then
    MAYROSDOCK_DIR="$config_dir"
    return 0
  fi

  # Auto-detect from common paths
  local found_path=""
  for path in "${MAYROSDOCK_COMMON_PATHS[@]}"; do
    if [[ -f "${path}/docker-compose.yml" ]]; then
      found_path="$path"
      break
    fi
  done

  if [[ -n "$found_path" ]]; then
    echo ""
    echo "⚛️ Found Mayros at: $found_path"
    echo -n "   Use this location? [Y/n] "
    read -r response
    if [[ "$response" =~ ^[Nn] ]]; then
      echo ""
      echo "Set MAYROSDOCK_DIR manually:"
      echo "  export MAYROSDOCK_DIR=/path/to/mayros"
      return 1
    fi
    MAYROSDOCK_DIR="$found_path"
  else
    echo ""
    echo "❌ Mayros not found in common locations."
    echo ""
    echo "Clone it first:"
    echo ""
    echo "  git clone https://github.com/ApiliumCode/mayros.git ~/mayros"
    echo "  cd ~/mayros && ./docker-setup.sh"
    echo ""
    echo "Or set MAYROSDOCK_DIR if it's elsewhere:"
    echo ""
    echo "  export MAYROSDOCK_DIR=/path/to/mayros"
    echo ""
    return 1
  fi

  # Save to config
  if [[ ! -d "${HOME}/.mayrosdock" ]]; then
    /bin/mkdir -p "${HOME}/.mayrosdock"
  fi
  echo "MAYROSDOCK_DIR=\"$MAYROSDOCK_DIR\"" > "$MAYROSDOCK_CONFIG"
  echo "✅ Saved to $MAYROSDOCK_CONFIG"
  echo ""
  return 0
}

# Wrapper to run docker compose commands
_mayrosdock_compose() {
  _mayrosdock_ensure_dir || return 1
  local compose_args=(-f "${MAYROSDOCK_DIR}/docker-compose.yml")
  if [[ -f "${MAYROSDOCK_DIR}/docker-compose.extra.yml" ]]; then
    compose_args+=(-f "${MAYROSDOCK_DIR}/docker-compose.extra.yml")
  fi
  command docker compose "${compose_args[@]}" "$@"
}

_mayrosdock_read_env_token() {
  _mayrosdock_ensure_dir || return 1
  if [[ ! -f "${MAYROSDOCK_DIR}/.env" ]]; then
    return 1
  fi
  local raw
  raw=$(sed -n 's/^MAYROS_GATEWAY_TOKEN=//p' "${MAYROSDOCK_DIR}/.env" | head -n 1)
  if [[ -z "$raw" ]]; then
    return 1
  fi
  _mayrosdock_trim_quotes "$raw"
}

# Basic Operations
mayrosdock-start() {
  _mayrosdock_compose up -d mayros-gateway
}

mayrosdock-stop() {
  _mayrosdock_compose down
}

mayrosdock-restart() {
  _mayrosdock_compose restart mayros-gateway
}

mayrosdock-logs() {
  _mayrosdock_compose logs -f mayros-gateway
}

mayrosdock-status() {
  _mayrosdock_compose ps
}

# Navigation
mayrosdock-cd() {
  _mayrosdock_ensure_dir || return 1
  cd "${MAYROSDOCK_DIR}"
}

mayrosdock-config() {
  cd ~/.mayros
}

mayrosdock-workspace() {
  cd ~/.mayros/workspace
}

# Container Access
mayrosdock-shell() {
  _mayrosdock_compose exec mayros-gateway \
    bash -c 'echo "alias mayros=\"./mayros.mjs\"" > /tmp/.bashrc_mayros && bash --rcfile /tmp/.bashrc_mayros'
}

mayrosdock-exec() {
  _mayrosdock_compose exec mayros-gateway "$@"
}

mayrosdock-cli() {
  _mayrosdock_compose run --rm mayros-cli "$@"
}

# Maintenance
mayrosdock-rebuild() {
  _mayrosdock_compose build mayros-gateway
}

mayrosdock-clean() {
  _mayrosdock_compose down -v --remove-orphans
}

# Health check
mayrosdock-health() {
  _mayrosdock_ensure_dir || return 1
  local token
  token=$(_mayrosdock_read_env_token)
  if [[ -z "$token" ]]; then
    echo "❌ Error: Could not find gateway token"
    echo "   Check: ${MAYROSDOCK_DIR}/.env"
    return 1
  fi
  _mayrosdock_compose exec -e "MAYROS_GATEWAY_TOKEN=$token" mayros-gateway \
    node dist/index.js health
}

# Show gateway token
mayrosdock-token() {
  _mayrosdock_read_env_token
}

# Fix token configuration (run this once after setup)
mayrosdock-fix-token() {
  _mayrosdock_ensure_dir || return 1

  echo "🔧 Configuring gateway token..."
  local token
  token=$(mayrosdock-token)
  if [[ -z "$token" ]]; then
    echo "❌ Error: Could not find gateway token"
    echo "   Check: ${MAYROSDOCK_DIR}/.env"
    return 1
  fi

  echo "📝 Setting token: ${token:0:20}..."

  _mayrosdock_compose exec -e "TOKEN=$token" mayros-gateway \
    bash -c './mayros.mjs config set gateway.remote.token "$TOKEN" && ./mayros.mjs config set gateway.auth.token "$TOKEN"' 2>&1 | _mayrosdock_filter_warnings

  echo "🔍 Verifying token was saved..."
  local saved_token
  saved_token=$(_mayrosdock_compose exec mayros-gateway \
    bash -c "./mayros.mjs config get gateway.remote.token 2>/dev/null" 2>&1 | _mayrosdock_filter_warnings | tr -d '\r\n' | head -c 64)

  if [[ "$saved_token" == "$token" ]]; then
    echo "✅ Token saved correctly!"
  else
    echo "⚠️  Token mismatch detected"
    echo "   Expected: ${token:0:20}..."
    echo "   Got: ${saved_token:0:20}..."
  fi

  echo "🔄 Restarting gateway..."
  _mayrosdock_compose restart mayros-gateway 2>&1 | _mayrosdock_filter_warnings

  echo "⏳ Waiting for gateway to start..."
  sleep 5

  echo "✅ Configuration complete!"
  echo -e "   Try: $(_cmd mayrosdock-devices)"
}

# Open dashboard in browser
mayrosdock-dashboard() {
  _mayrosdock_ensure_dir || return 1

  echo "⚛️ Getting dashboard URL..."
  local output exit_status url
  output=$(_mayrosdock_compose run --rm mayros-cli dashboard --no-open 2>&1)
  exit_status=$?
  url=$(printf "%s\n" "$output" | _mayrosdock_filter_warnings | grep -o 'http[s]\?://[^[:space:]]*' | head -n 1)
  if [[ $exit_status -ne 0 ]]; then
    echo "❌ Failed to get dashboard URL"
    echo -e "   Try restarting: $(_cmd mayrosdock-restart)"
    return 1
  fi

  if [[ -n "$url" ]]; then
    echo "✅ Opening: $url"
    open "$url" 2>/dev/null || xdg-open "$url" 2>/dev/null || echo "   Please open manually: $url"
    echo ""
    echo -e "${_CLR_CYAN}💡 If you see 'pairing required' error:${_CLR_RESET}"
    echo -e "   1. Run: $(_cmd mayrosdock-devices)"
    echo "   2. Copy the Request ID from the Pending table"
    echo -e "   3. Run: $(_cmd 'mayrosdock-approve <request-id>')"
  else
    echo "❌ Failed to get dashboard URL"
    echo -e "   Try restarting: $(_cmd mayrosdock-restart)"
  fi
}

# List device pairings
mayrosdock-devices() {
  _mayrosdock_ensure_dir || return 1

  echo "🔍 Checking device pairings..."
  local output exit_status
  output=$(_mayrosdock_compose exec mayros-gateway node dist/index.js devices list 2>&1)
  exit_status=$?
  printf "%s\n" "$output" | _mayrosdock_filter_warnings
  if [ $exit_status -ne 0 ]; then
    echo ""
    echo -e "${_CLR_CYAN}💡 If you see token errors above:${_CLR_RESET}"
    echo -e "   1. Verify token is set: $(_cmd mayrosdock-token)"
    echo "   2. Try manual config inside container:"
    echo -e "      $(_cmd mayrosdock-shell)"
    echo -e "      $(_cmd 'mayros config get gateway.remote.token')"
    return 1
  fi

  echo ""
  echo -e "${_CLR_CYAN}💡 To approve a pairing request:${_CLR_RESET}"
  echo -e "   $(_cmd 'mayrosdock-approve <request-id>')"
}

# Approve device pairing request
mayrosdock-approve() {
  _mayrosdock_ensure_dir || return 1

  if [[ -z "$1" ]]; then
    echo -e "❌ Usage: $(_cmd 'mayrosdock-approve <request-id>')"
    echo ""
    echo -e "${_CLR_CYAN}💡 How to approve a device:${_CLR_RESET}"
    echo -e "   1. Run: $(_cmd mayrosdock-devices)"
    echo "   2. Find the Request ID in the Pending table (long UUID)"
    echo -e "   3. Run: $(_cmd 'mayrosdock-approve <that-request-id>')"
    echo ""
    echo "Example:"
    echo -e "   $(_cmd 'mayrosdock-approve 6f9db1bd-a1cc-4d3f-b643-2c195262464e')"
    return 1
  fi

  echo "✅ Approving device: $1"
  _mayrosdock_compose exec mayros-gateway \
    node dist/index.js devices approve "$1" 2>&1 | _mayrosdock_filter_warnings

  echo ""
  echo "✅ Device approved! Refresh your browser."
}

# Show all available mayrosdock helper commands
mayrosdock-help() {
  echo -e "\n${_CLR_BOLD}${_CLR_CYAN}⚛️ MayrosDock - Docker Helpers for Mayros${_CLR_RESET}\n"

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}⚡ Basic Operations${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-start)       ${_CLR_DIM}Start the gateway${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-stop)        ${_CLR_DIM}Stop the gateway${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-restart)     ${_CLR_DIM}Restart the gateway${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-status)      ${_CLR_DIM}Check container status${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-logs)        ${_CLR_DIM}View live logs (follows)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🐚 Container Access${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-shell)       ${_CLR_DIM}Shell into container (mayros alias ready)${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-cli)         ${_CLR_DIM}Run CLI commands (e.g., mayrosdock-cli status)${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-exec) ${_CLR_CYAN}<cmd>${_CLR_RESET}  ${_CLR_DIM}Execute command in gateway container${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🌐 Web UI & Devices${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-dashboard)   ${_CLR_DIM}Open web UI in browser ${_CLR_CYAN}(auto-guides you)${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-devices)     ${_CLR_DIM}List device pairings ${_CLR_CYAN}(auto-guides you)${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-approve) ${_CLR_CYAN}<id>${_CLR_RESET} ${_CLR_DIM}Approve device pairing ${_CLR_CYAN}(with examples)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}⚙️  Setup & Configuration${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-fix-token)   ${_CLR_DIM}Configure gateway token ${_CLR_CYAN}(run once)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🔧 Maintenance${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-rebuild)     ${_CLR_DIM}Rebuild Docker image${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-clean)       ${_CLR_RED}⚠️  Remove containers & volumes (nuclear)${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_MAGENTA}🛠️  Utilities${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-health)      ${_CLR_DIM}Run health check${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-token)       ${_CLR_DIM}Show gateway auth token${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-cd)          ${_CLR_DIM}Jump to mayros project directory${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-config)      ${_CLR_DIM}Open config directory (~/.mayros)${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-workspace)   ${_CLR_DIM}Open workspace directory${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${_CLR_RESET}"
  echo -e "${_CLR_BOLD}${_CLR_GREEN}🚀 First Time Setup${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  1.${_CLR_RESET} $(_cmd mayrosdock-start)          ${_CLR_DIM}# Start the gateway${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  2.${_CLR_RESET} $(_cmd mayrosdock-fix-token)      ${_CLR_DIM}# Configure token${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  3.${_CLR_RESET} $(_cmd mayrosdock-dashboard)      ${_CLR_DIM}# Open web UI${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  4.${_CLR_RESET} $(_cmd mayrosdock-devices)        ${_CLR_DIM}# If pairing needed${_CLR_RESET}"
  echo -e "${_CLR_CYAN}  5.${_CLR_RESET} $(_cmd mayrosdock-approve) ${_CLR_CYAN}<id>${_CLR_RESET}   ${_CLR_DIM}# Approve pairing${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_GREEN}💬 WhatsApp Setup${_CLR_RESET}"
  echo -e "  $(_cmd mayrosdock-shell)"
  echo -e "    ${_CLR_BLUE}>${_CLR_RESET} $(_cmd 'mayros channels login --channel whatsapp')"
  echo -e "    ${_CLR_BLUE}>${_CLR_RESET} $(_cmd 'mayros status')"
  echo ""

  echo -e "${_CLR_BOLD}${_CLR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${_CLR_RESET}"
  echo ""

  echo -e "${_CLR_CYAN}💡 All commands guide you through next steps!${_CLR_RESET}"
  echo -e "${_CLR_BLUE}📚 Docs: ${_CLR_RESET}${_CLR_CYAN}https://apilium.com/us/doc/maryos${_CLR_RESET}"
  echo ""
}
