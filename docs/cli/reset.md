---
summary: "CLI reference for `mayros reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `mayros reset`

Reset local config/state (keeps the CLI installed).

```bash
mayros reset
mayros reset --dry-run
mayros reset --scope config+creds+sessions --yes --non-interactive
```
