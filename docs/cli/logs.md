---
summary: "CLI reference for `mayros logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
title: "logs"
---

# `mayros logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:

- Logging overview: [Logging](/logging)

## Examples

```bash
mayros logs
mayros logs --follow
mayros logs --json
mayros logs --limit 500
mayros logs --local-time
mayros logs --follow --local-time
```

Use `--local-time` to render timestamps in your local timezone.
