# @apilium/mayros-irc

Mayros IRC channel plugin -- connect your Mayros agent to IRC networks.

## Installation

```bash
mayros plugin install @apilium/mayros-irc
```

## Configuration

Add to your `mayros.toml`:

```toml
[channels.irc]
enabled = true
host = "irc.libera.chat"
port = 6697
tls = true
nick = "mayros-bot"
# username = "mayros"
# realname = "Mayros Bot"
# password = "server-password"
# passwordFile = "/path/to/password"
# channels = ["#mychannel"]

# DM security
# dmPolicy = "pairing"        # "open" | "pairing" | "allowlist"
# allowFrom = []

# Group settings
# groupPolicy = "allowlist"   # "open" | "allowlist" | "disabled"
# groupAllowFrom = []
# historyLimit = 50
# textChunkLimit = 350
# mediaMaxMb = 10

# NickServ authentication
# [channels.irc.nickserv]
# enabled = true
# password = "nickserv-password"
# passwordFile = "/path/to/ns-password"
# register = false
# registerEmail = "bot@example.com"

# Per-channel overrides
# [channels.irc.groups."#mychannel"]
# requireMention = true
# enabled = true

# Multi-account support
# [channels.irc.accounts.secondary]
# host = "irc.oftc.net"
# nick = "mayros-alt"
```

## Environment Variables

- `IRC_HOST` -- server hostname (default account)
- `IRC_PORT` -- server port (default account)
- `IRC_TLS` -- enable TLS (`true`/`false`, default account)
- `IRC_NICK` -- bot nickname (default account)
- `IRC_USERNAME` -- IRC username (default account)
- `IRC_REALNAME` -- IRC real name (default account)
- `IRC_PASSWORD` -- server password (default account)
- `IRC_CHANNELS` -- comma-separated channel list (default account)
- `IRC_NICKSERV_PASSWORD` -- NickServ password (default account)
- `IRC_NICKSERV_REGISTER_EMAIL` -- NickServ registration email (default account)

## Features

- Direct messages and channel support
- TLS/SSL connections
- NickServ authentication and registration
- Per-channel access control and mention requirements
- Multi-account support for connecting to multiple networks
- Media attachments via URL
- Configurable message chunking for long responses

## License

MIT -- Apilium Technologies
