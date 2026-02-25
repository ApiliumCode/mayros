# MayrosDock <!-- omit in toc -->

Stop typing `docker-compose` commands. Just type `mayrosdock-start`.

Inspired by Simon Willison's [Running Mayros in Docker](https://til.simonwillison.net/llms/mayros-docker).

- [Quickstart](#quickstart)
- [Available Commands](#available-commands)
  - [Basic Operations](#basic-operations)
  - [Container Access](#container-access)
  - [Web UI \& Devices](#web-ui--devices)
  - [Setup \& Configuration](#setup--configuration)
  - [Maintenance](#maintenance)
  - [Utilities](#utilities)
- [Common Workflows](#common-workflows)
  - [Check Status and Logs](#check-status-and-logs)
  - [Set Up WhatsApp Bot](#set-up-whatsapp-bot)
  - [Troubleshooting Device Pairing](#troubleshooting-device-pairing)
  - [Fix Token Mismatch Issues](#fix-token-mismatch-issues)
  - [Permission Denied](#permission-denied)
- [Requirements](#requirements)

## Quickstart

**Install:**

```bash
mkdir -p ~/.mayrosdock && curl -sL https://raw.githubusercontent.com/mayros/mayros/main/scripts/shell-helpers/mayrosdock-helpers.sh -o ~/.mayrosdock/mayrosdock-helpers.sh
```

```bash
echo 'source ~/.mayrosdock/mayrosdock-helpers.sh' >> ~/.zshrc && source ~/.zshrc
```

**See what you get:**

```bash
mayrosdock-help
```

On first command, MayrosDock auto-detects your Mayros directory:

- Checks common paths (`~/mayros`, `~/workspace/mayros`, etc.)
- If found, asks you to confirm
- Saves to `~/.mayrosdock/config`

**First time setup:**

```bash
mayrosdock-start
```

```bash
mayrosdock-fix-token
```

```bash
mayrosdock-dashboard
```

If you see "pairing required":

```bash
mayrosdock-devices
```

And approve the request for the specific device:

```bash
mayrosdock-approve <request-id>
```

## Available Commands

### Basic Operations

| Command              | Description                     |
| -------------------- | ------------------------------- |
| `mayrosdock-start`   | Start the gateway               |
| `mayrosdock-stop`    | Stop the gateway                |
| `mayrosdock-restart` | Restart the gateway             |
| `mayrosdock-status`  | Check container status          |
| `mayrosdock-logs`    | View live logs (follows output) |

### Container Access

| Command                     | Description                                    |
| --------------------------- | ---------------------------------------------- |
| `mayrosdock-shell`          | Interactive shell inside the gateway container |
| `mayrosdock-cli <command>`  | Run Mayros CLI commands                        |
| `mayrosdock-exec <command>` | Execute arbitrary commands in the container    |

### Web UI & Devices

| Command                   | Description                                |
| ------------------------- | ------------------------------------------ |
| `mayrosdock-dashboard`    | Open web UI in browser with authentication |
| `mayrosdock-devices`      | List device pairing requests               |
| `mayrosdock-approve <id>` | Approve a device pairing request           |

### Setup & Configuration

| Command                | Description                                       |
| ---------------------- | ------------------------------------------------- |
| `mayrosdock-fix-token` | Configure gateway authentication token (run once) |

### Maintenance

| Command              | Description                                      |
| -------------------- | ------------------------------------------------ |
| `mayrosdock-rebuild` | Rebuild the Docker image                         |
| `mayrosdock-clean`   | Remove all containers and volumes (destructive!) |

### Utilities

| Command                | Description                               |
| ---------------------- | ----------------------------------------- |
| `mayrosdock-health`    | Run gateway health check                  |
| `mayrosdock-token`     | Display the gateway authentication token  |
| `mayrosdock-cd`        | Jump to the Mayros project directory      |
| `mayrosdock-config`    | Open the Mayros config directory          |
| `mayrosdock-workspace` | Open the workspace directory              |
| `mayrosdock-help`      | Show all available commands with examples |

## Common Workflows

### Check Status and Logs

**Restart the gateway:**

```bash
mayrosdock-restart
```

**Check container status:**

```bash
mayrosdock-status
```

**View live logs:**

```bash
mayrosdock-logs
```

### Set Up WhatsApp Bot

**Shell into the container:**

```bash
mayrosdock-shell
```

**Inside the container, login to WhatsApp:**

```bash
mayros channels login --channel whatsapp --verbose
```

Scan the QR code with WhatsApp on your phone.

**Verify connection:**

```bash
mayros status
```

### Troubleshooting Device Pairing

**Check for pending pairing requests:**

```bash
mayrosdock-devices
```

**Copy the Request ID from the "Pending" table, then approve:**

```bash
mayrosdock-approve <request-id>
```

Then refresh your browser.

### Fix Token Mismatch Issues

If you see "gateway token mismatch" errors:

```bash
mayrosdock-fix-token
```

This will:

1. Read the token from your `.env` file
2. Configure it in the Mayros config
3. Restart the gateway
4. Verify the configuration

### Permission Denied

**Ensure Docker is running and you have permission:**

```bash
docker ps
```

## Requirements

- Docker and Docker Compose installed
- Bash or Zsh shell
- Mayros project (from `docker-setup.sh`)

## Development

**Test with fresh config (mimics first-time install):**

```bash
unset MAYROSDOCK_DIR && rm -f ~/.mayrosdock/config && source scripts/shell-helpers/mayrosdock-helpers.sh
```

Then run any command to trigger auto-detect:

```bash
mayrosdock-start
```
