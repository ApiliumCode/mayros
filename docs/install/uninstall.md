---
summary: "Uninstall Mayros completely (CLI, service, state, workspace)"
read_when:
  - You want to remove Mayros from a machine
  - The gateway service is still running after uninstall
title: "Uninstall"
---

# Uninstall

Two paths:

- **Easy path** if `mayros` is still installed.
- **Manual service removal** if the CLI is gone but the service is still running.

## Easy path (CLI still installed)

Recommended: use the built-in uninstaller:

```bash
mayros uninstall
```

Non-interactive (automation / npx):

```bash
mayros uninstall --all --yes --non-interactive
npx -y mayros uninstall --all --yes --non-interactive
```

Manual steps (same result):

1. Stop the gateway service:

```bash
mayros gateway stop
```

2. Uninstall the gateway service (launchd/systemd/schtasks):

```bash
mayros gateway uninstall
```

3. Delete state + config:

```bash
rm -rf "${MAYROS_STATE_DIR:-$HOME/.mayros}"
```

If you set `MAYROS_CONFIG_PATH` to a custom location outside the state dir, delete that file too.

4. Delete your workspace (optional, removes agent files):

```bash
rm -rf ~/.mayros/workspace
```

5. Remove the CLI install (pick the one you used):

```bash
npm rm -g mayros
pnpm remove -g mayros
bun remove -g mayros
```

6. If you installed the macOS app:

```bash
rm -rf /Applications/Mayros.app
```

Notes:

- If you used profiles (`--profile` / `MAYROS_PROFILE`), repeat step 3 for each state dir (defaults are `~/.mayros-<profile>`).
- In remote mode, the state dir lives on the **gateway host**, so run steps 1-4 there too.

## Manual service removal (CLI not installed)

Use this if the gateway service keeps running but `mayros` is missing.

### macOS (launchd)

Default label is `ai.mayros.gateway` (or `ai.mayros.<profile>`; legacy `com.mayros.*` may still exist):

```bash
launchctl bootout gui/$UID/ai.mayros.gateway
rm -f ~/Library/LaunchAgents/ai.mayros.gateway.plist
```

If you used a profile, replace the label and plist name with `ai.mayros.<profile>`. Remove any legacy `com.mayros.*` plists if present.

### Linux (systemd user unit)

Default unit name is `mayros-gateway.service` (or `mayros-gateway-<profile>.service`):

```bash
systemctl --user disable --now mayros-gateway.service
rm -f ~/.config/systemd/user/mayros-gateway.service
systemctl --user daemon-reload
```

### Windows (Scheduled Task)

Default task name is `Mayros Gateway` (or `Mayros Gateway (<profile>)`).
The task script lives under your state dir.

```powershell
schtasks /Delete /F /TN "Mayros Gateway"
Remove-Item -Force "$env:USERPROFILE\.mayros\gateway.cmd"
```

If you used a profile, delete the matching task name and `~\.mayros-<profile>\gateway.cmd`.

## Normal install vs source checkout

### Normal install (install.sh / npm / pnpm / bun)

If you used `https://mayros.apilium.com/install.sh` or `install.ps1`, the CLI was installed with `npm install -g mayros@latest`.
Remove it with `npm rm -g mayros` (or `pnpm remove -g` / `bun remove -g` if you installed that way).

### Source checkout (git clone)

If you run from a repo checkout (`git clone` + `mayros ...` / `bun run mayros ...`):

1. Uninstall the gateway service **before** deleting the repo (use the easy path above or manual service removal).
2. Delete the repo directory.
3. Remove state + workspace as shown above.
