# @apilium/mayros-discord

Mayros Discord channel plugin -- connect your Mayros agent to Discord as a bot.

## Installation

```bash
mayros plugin install @apilium/mayros-discord
```

## Configuration

Add to your `mayros.toml`:

```toml
[channels.discord]
enabled = true
# token = "your-bot-token"    # or use DISCORD_BOT_TOKEN env var

# DM security
# dmPolicy = "pairing"        # "open" | "pairing" | "allowlist"
# allowFrom = []               # user IDs allowed to DM

# Group/guild settings
# groupPolicy = "open"        # "open" | "allowlist" | "disabled"
# replyToMode = "off"         # "off" | "first" | "all"
# mediaMaxMb = 25
# historyLimit = 50

# Multi-account support
# [channels.discord.accounts.secondary]
# token = "another-bot-token"
# enabled = true
```

## Required Environment Variables

- `DISCORD_BOT_TOKEN` -- bot token (used for the default account when not set in config)

## Features

- Direct messages, channel messages, and thread support
- Media attachments (images, files)
- Polls and reactions
- Interactive components (buttons, selects, modals/forms)
- Multi-account support with per-account configuration
- Guild/channel allowlists for granular access control
- Subagent hooks for multi-agent workflows
- Configurable mention requirements per guild/channel

## License

MIT -- Apilium Technologies
