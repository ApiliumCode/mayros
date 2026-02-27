# @apilium/mayros-matrix

Mayros Matrix channel plugin -- connect your Mayros agent to Matrix homeservers.

## Installation

```bash
mayros plugin install @apilium/mayros-matrix
```

## Configuration

Add to your `mayros.toml`:

```toml
[channels.matrix]
enabled = true
homeserver = "https://matrix.example.com"
userId = "@bot:example.com"
accessToken = "syt_xxxx"
# password = "bot-password"         # alternative to accessToken
# deviceName = "Mayros"
# initialSyncLimit = 10
# encryption = false

# DM security
# [channels.matrix.dm]
# policy = "pairing"                # "open" | "pairing" | "allowlist" | "disabled"
# allowFrom = ["@admin:example.com"]

# Group settings
# groupPolicy = "allowlist"         # "open" | "allowlist" | "disabled"
# groupAllowFrom = []
# replyToMode = "off"               # "off" | "first" | "all"
# autoJoin = "allowlist"            # "always" | "allowlist" | "off"
# autoJoinAllowlist = []
# mediaMaxMb = 25
# textChunkLimit = 4000

# Per-room overrides
# [channels.matrix.groups."!roomid:example.com"]
# requireMention = true
# users = ["@user:example.com"]
```

## Environment Variables

- `MATRIX_HOMESERVER` -- homeserver URL
- `MATRIX_USER_ID` -- bot user ID (e.g. `@bot:example.com`)
- `MATRIX_ACCESS_TOKEN` -- access token for authentication
- `MATRIX_PASSWORD` -- password-based authentication (alternative to access token)

## Features

- Direct messages, group rooms, and thread support
- Polls and reactions
- Media attachments (images, files, audio)
- End-to-end encryption support (via matrix-sdk-crypto)
- Per-room access control and mention requirements
- Auto-join for invited rooms with allowlist filtering
- Multi-account support
- Message actions (reactions, pins, member/channel info)
- Live directory lookup for peers and groups

## License

MIT -- Apilium Technologies
