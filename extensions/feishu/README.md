# @apilium/mayros-feishu

Mayros Feishu/Lark channel plugin -- connect your Mayros agent to Feishu or Lark enterprise messaging.

Community maintained by [@m1heng](https://github.com/m1heng).

## Installation

```bash
mayros plugin install @apilium/mayros-feishu
```

## Configuration

Add to your `mayros.toml`:

```toml
[channels.feishu]
enabled = true
appId = "cli_xxxx"
appSecret = "your-app-secret"
# encryptKey = ""              # event subscription encrypt key
# verificationToken = ""       # event subscription verification token
# domain = "feishu"            # "feishu" | "lark" | custom https:// URL
# connectionMode = "websocket" # "websocket" | "webhook"

# Webhook mode settings (ignored in websocket mode)
# webhookPath = "/feishu/webhook"
# webhookHost = "0.0.0.0"
# webhookPort = 3000

# DM security
# dmPolicy = "pairing"        # "open" | "pairing" | "allowlist"
# allowFrom = []

# Group settings
# groupPolicy = "allowlist"   # "open" | "allowlist" | "disabled"
# groupAllowFrom = []
# requireMention = true
# historyLimit = 50
# mediaMaxMb = 25
# renderMode = "auto"         # "auto" | "raw" | "card"

# Multi-account support
# [channels.feishu.accounts.secondary]
# appId = "cli_yyyy"
# appSecret = "another-secret"
```

## Environment Variables

- `FEISHU_APP_ID` -- fallback app ID (onboarding only)
- `FEISHU_APP_SECRET` -- fallback app secret (onboarding only)

## Features

- Direct messages and group chat support
- WebSocket and webhook connection modes
- Interactive cards for rich messages
- Media attachments (images, files)
- Reactions and message editing
- Integrated tools: Docs, Wiki, Drive, Bitable, and Permissions
- Multi-account support
- Feishu and Lark (international) domain support

## License

MIT -- Apilium Technologies
