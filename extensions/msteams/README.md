# @apilium/mayros-msteams

Mayros Microsoft Teams channel plugin -- connect your Mayros agent to Microsoft Teams via Bot Framework.

## Installation

```bash
mayros plugin install @apilium/mayros-msteams
```

## Configuration

Add to your `mayros.toml`:

```toml
[channels.msteams]
enabled = true
appId = "your-azure-app-id"
appPassword = "your-azure-app-password"
tenantId = "your-tenant-id"

# DM security
# allowFrom = []
# defaultTo = ""

# Group settings
# groupPolicy = "allowlist"   # "open" | "allowlist" | "disabled"
# groupAllowFrom = []

# Webhook server
# [channels.msteams.webhook]
# port = 3978
```

## Required Environment Variables

- `MSTEAMS_APP_ID` -- Azure Bot registration app ID (fallback when not in config)
- `MSTEAMS_APP_PASSWORD` -- Azure Bot registration app password (fallback when not in config)
- `MSTEAMS_TENANT_ID` -- Azure AD tenant ID (fallback when not in config)

## Features

- Direct messages, channel messages, and thread support
- Adaptive Cards for rich interactive messages
- Polls
- Media attachments
- Team and channel allowlist resolution via Graph API
- User resolution by display name or ID
- Configurable webhook port for incoming messages
- Per-team/channel access control and tool policies
- Live directory lookup for peers and groups

## License

MIT -- Apilium Technologies
