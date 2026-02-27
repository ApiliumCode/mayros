# @apilium/mayros-nextcloud-talk

Mayros Nextcloud Talk channel plugin -- connect your Mayros agent to self-hosted Nextcloud Talk via webhook bots.

## Installation

```bash
mayros plugin install @apilium/mayros-nextcloud-talk
```

## Configuration

Add to your `mayros.toml`:

```toml
[channels.nextcloud-talk]
enabled = true
baseUrl = "https://cloud.example.com"
botSecret = "your-bot-secret"
# botSecretFile = "/path/to/secret"

# Webhook server
# webhookPort = 3000
# webhookHost = "0.0.0.0"
# webhookPath = "/nextcloud-talk/webhook"
# webhookPublicUrl = "https://bot.example.com"

# API credentials (for extended features)
# apiUser = "bot-user"
# apiPassword = "api-password"
# apiPasswordFile = "/path/to/api-password"

# DM security
# dmPolicy = "pairing"        # "open" | "pairing" | "allowlist"
# allowFrom = []

# Group settings
# groupPolicy = "allowlist"   # "open" | "allowlist" | "disabled"
# groupAllowFrom = []
# historyLimit = 50
# textChunkLimit = 4000
# mediaMaxMb = 25

# Per-room overrides
# [channels.nextcloud-talk.rooms."roomtoken"]
# requireMention = true
# enabled = true

# Multi-account support
# [channels.nextcloud-talk.accounts.secondary]
# baseUrl = "https://other.example.com"
# botSecret = "other-secret"
```

## Required Environment Variables

- `NEXTCLOUD_TALK_BOT_SECRET` -- webhook bot secret (used for the default account when not in config)

## Features

- Direct messages and group room support
- Reactions and media attachments
- Self-hosted webhook bot integration
- Per-room access control and mention requirements
- Multi-account support for multiple Nextcloud instances
- Configurable webhook server (host, port, path, public URL)
- Markdown message chunking for long responses
- Logout support with secret cleanup

## License

MIT -- Apilium Technologies
