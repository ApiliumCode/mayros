---
summary: "CLI reference for `mayros voicecall` (voice-call plugin command surface)"
read_when:
  - You use the voice-call plugin and want the CLI entry points
  - You want quick examples for `voicecall call|continue|status|tail|expose`
title: "voicecall"
---

# `mayros voicecall`

`voicecall` is a plugin-provided command. It only appears if the voice-call plugin is installed and enabled.

Primary doc:

- Voice-call plugin: [Voice Call](/plugins/voice-call)

## Common commands

```bash
mayros voicecall status --call-id <id>
mayros voicecall call --to "+15555550123" --message "Hello" --mode notify
mayros voicecall continue --call-id <id> --message "Any questions?"
mayros voicecall end --call-id <id>
```

## Exposing webhooks (Tailscale)

```bash
mayros voicecall expose --mode serve
mayros voicecall expose --mode funnel
mayros voicecall unexpose
```

Security note: only expose the webhook endpoint to networks you trust. Prefer Tailscale Serve over Funnel when possible.
