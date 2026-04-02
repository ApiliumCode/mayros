---
name: canvas
description: "Display HTML content on connected Mayros nodes (Mac, iOS, Android) via the canvas tool. Use when presenting games, visualizations, dashboards, or interactive HTML demos on remote nodes. Actions: present, hide, navigate, eval, snapshot. Requires canvasHost enabled in mayros.json."
---

# Canvas

Display HTML content on connected Mayros nodes (Mac app, iOS, Android) via the canvas tool.

## When to Use

Use when the user wants to present web content (games, visualizations, dashboards, interactive demos) on a connected Mayros node's canvas view.

**Not for:** non-HTML content, direct file transfers, or streaming media.

## Actions

| Action     | Description                          |
| ---------- | ------------------------------------ |
| `present`  | Show canvas with optional target URL |
| `hide`     | Hide the canvas                      |
| `navigate` | Navigate to a new URL                |
| `eval`     | Execute JavaScript in the canvas     |
| `snapshot` | Capture screenshot of canvas         |

## Workflow

### 1. Create HTML content

Place files in the canvas root directory (default `~/mayros/canvas/`):

```bash
cat > ~/mayros/canvas/my-game.html << 'HTML'
<!DOCTYPE html>
<html>
<head><title>My Game</title></head>
<body>
  <h1>Hello Canvas!</h1>
</body>
</html>
HTML
```

### 2. Determine canvas host URL

Check gateway bind mode:

```bash
cat ~/.mayros/mayros.json | jq '.gateway.bind'
```

Construct URL based on bind mode:

- **loopback**: `http://127.0.0.1:18793/__mayros__/canvas/<file>.html`
- **lan/tailnet/auto**: `http://<hostname>:18793/__mayros__/canvas/<file>.html`

Find Tailscale hostname (if using tailnet/auto):

```bash
tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//'
```

### 3. Find connected nodes

```bash
mayros nodes list
```

Look for Mac/iOS/Android nodes with canvas capability.

### 4. Present content

```
canvas action:present node:<node-id> target:<full-url>
```

Example:

```
canvas action:present node:mac-63599bc4 target:http://my-host.ts.net:18793/__mayros__/canvas/snake.html
```

### 5. Navigate, snapshot, or hide

```
canvas action:navigate node:<node-id> url:<new-url>
canvas action:snapshot node:<node-id>
canvas action:hide node:<node-id>
```

## Configuration

In `~/.mayros/mayros.json`:

```json
{
  "canvasHost": {
    "enabled": true,
    "port": 18793,
    "root": "/Users/you/mayros/canvas",
    "liveReload": true
  },
  "gateway": {
    "bind": "auto"
  }
}
```

When `liveReload: true` (default), the canvas host watches the root directory and auto-reloads connected canvases on file changes.

## Troubleshooting

- **White screen**: URL mismatch — use the full hostname matching your bind mode, not `localhost`. Debug: `curl http://<hostname>:18793/__mayros__/canvas/<file>.html`
- **"node required" error**: Always specify `node:<node-id>` parameter.
- **"node not connected"**: Node is offline. Run `mayros nodes list` to find online nodes.
- **Content not updating**: Verify `liveReload: true` in config and that the file is in the canvas root directory.
