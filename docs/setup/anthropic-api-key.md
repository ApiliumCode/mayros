# Anthropic API Key Setup

Mayros uses Claude (by Anthropic) as its default language model. This guide covers obtaining and configuring your API key.

## 1. Get an API Key

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Navigate to **API Keys** in the sidebar
4. Click **Create Key**, give it a name (e.g. `mayros`), and copy the key

## 2. Configure the Environment Variable

Set `ANTHROPIC_API_KEY` in your shell profile:

```bash
# ~/.bashrc, ~/.zshrc, or ~/.profile
export ANTHROPIC_API_KEY="sk-ant-api03-..."
```

Reload your shell:

```bash
source ~/.zshrc  # or ~/.bashrc
```

## 3. Verify

```bash
mayros doctor
```

Look for the Anthropic provider check — it should show a green status.

## 4. Choose Your Model

Mayros defaults to `claude-opus-4-6`. You can override this in `mayros.json`:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-opus-4-6"
      }
    }
  }
}
```

Available aliases:

| Alias    | Model                         |
| -------- | ----------------------------- |
| `opus`   | `anthropic/claude-opus-4-6`   |
| `sonnet` | `anthropic/claude-sonnet-4-6` |
| `haiku`  | `anthropic/claude-haiku-4-5`  |

Use `sonnet` for a good balance of speed and capability. Use `haiku` for fast, low-cost tasks and subagents.

## 5. OAuth (Alternative)

If you prefer OAuth over API keys, set:

```bash
export ANTHROPIC_OAUTH_TOKEN="your-oauth-token"
```

Mayros auto-detects which auth method is available. If both are set, configure priority in `mayros.json` under `auth.order.anthropic`.
