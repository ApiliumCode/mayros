---
summary: "CLI reference for `mayros agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
title: "agents"
---

# `mayros agents`

Manage isolated agents (workspaces + auth + routing).

Related:

- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
mayros agents list
mayros agents add work --workspace ~/.mayros/workspace-work
mayros agents set-identity --workspace ~/.mayros/workspace --from-identity
mayros agents set-identity --agent main --avatar avatars/mayros.png
mayros agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:

- Example path: `~/.mayros/workspace/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:

- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
mayros agents set-identity --workspace ~/.mayros/workspace --from-identity
```

Override fields explicitly:

```bash
mayros agents set-identity --agent main --name "Mayros" --emoji "⚡🛡️" --avatar avatars/mayros.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "Mayros",
          theme: "knowledge navigator",
          emoji: "⚡🛡️",
          avatar: "avatars/mayros.png",
        },
      },
    ],
  },
}
```
