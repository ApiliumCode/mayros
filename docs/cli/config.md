---
summary: "CLI reference for `mayros config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
title: "config"
---

# `mayros config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `mayros configure`).

## Examples

```bash
mayros config get browser.executablePath
mayros config set browser.executablePath "/usr/bin/google-chrome"
mayros config set agents.defaults.heartbeat.every "2h"
mayros config set agents.list[0].tools.exec.node "node-id-or-name"
mayros config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
mayros config get agents.defaults.workspace
mayros config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
mayros config get agents.list
mayros config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--strict-json` to require JSON5 parsing. `--json` remains supported as a legacy alias.

```bash
mayros config set agents.defaults.heartbeat.every "0m"
mayros config set gateway.port 19001 --strict-json
mayros config set channels.whatsapp.groups '["*"]' --strict-json
```

Restart the gateway after edits.
