# ⚡🛡️ Mayros

<p align="center">
    <img src="docs/assets/mayros-logo.svg" alt="Mayros" width="200">
</p>

<p align="center">
  <strong>AI agent framework · Coding CLI · Personal assistant</strong><br>
  <em>One platform. Your terminal, your channels, your devices.</em>
</p>

<p align="center">
  <a href="https://github.com/ApiliumCode/mayros/actions/workflows/ci.yml?branch=main"><img src="https://img.shields.io/github/actions/workflow/status/ApiliumCode/mayros/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="https://www.npmjs.com/package/@apilium/mayros"><img src="https://img.shields.io/npm/v/@apilium/mayros?style=for-the-badge&color=cb3837" alt="npm version"></a>
  <a href="https://github.com/ApiliumCode/mayros/releases"><img src="https://img.shields.io/github/v/release/ApiliumCode/mayros?include_prereleases&style=for-the-badge" alt="GitHub release"></a>
  <a href="https://discord.com/channels/1476351587105636404"><img src="https://img.shields.io/discord/1476351587105636404?label=Discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://apilium.com/en/products/mayros">Product</a> · <a href="https://mayros.apilium.com">Download</a> · <a href="https://apilium.com/en/doc/mayros">Docs</a> · <a href="https://apilium.com/en/doc/mayros/start/getting-started">Getting Started</a> · <a href="VISION.md">Vision</a> · <a href="https://discord.com/channels/1476351587105636404">Discord</a>
</p>

---

**Mayros** is an open-source AI agent framework that runs on your own devices. It ships with an interactive **coding CLI** (`mayros code`), connects to **17 messaging channels** (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, and more), speaks and listens on **macOS/iOS/Android**, and has a **knowledge graph** that remembers everything across sessions. All backed by a local-first Gateway and an 18-layer security architecture.

> **55 extensions · 9,200+ tests · 29 hooks · MCP support · Multi-model · Multi-agent**

```bash
npm install -g @apilium/mayros@latest
mayros onboard
mayros code   # interactive coding CLI
```

---

## Why Mayros?

|                        | Mayros                                                                                               | Others                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------- |
| 🧠 **Knowledge Graph** | AIngle Cortex — persistent memory across sessions, projects, and agents                              | Flat conversation history |
| 🤖 **Multi-Agent**     | Teams, workflows, mailbox, background tasks, git worktree isolation                                  | Single agent              |
| 📱 **Multi-Channel**   | 17 channels — WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, Matrix, WebChat, and more | Terminal only             |
| 🔒 **Security**        | 18 layers — WASM sandbox, bash scanner, interactive permissions, namespace isolation, rate limiter   | Basic sandboxing          |
| 🎙️ **Voice**           | Always-on Voice Wake + Talk Mode on macOS, iOS, Android                                              | None                      |
| 🖥️ **IDE**             | VSCode + JetBrains plugins with chat, plan, traces, KG                                               | VSCode only               |
| 📊 **Observability**   | Full trace system, decision graph, session fork/rewind                                               | Basic logging             |
| 🔌 **Extensions**      | 55 plugin extensions, 29 hook types, MCP client (4 transports)                                       | Limited plugins           |
| 🗺️ **Plan Mode**       | Cortex-backed semantic planning: explore → assert → approve → execute                                | Simple plan files         |

---

## Install

Runtime: **Node ≥ 22**. Works with npm, pnpm, or bun.

```bash
npm install -g @apilium/mayros@latest
# or: pnpm add -g @apilium/mayros@latest

mayros onboard --install-daemon
```

The wizard sets up the Gateway, workspace, channels, and skills. It installs the Gateway as a background daemon (launchd/systemd) so it stays running.

New install? Start here: **[Getting Started](https://apilium.com/en/doc/mayros/start/getting-started)** · Upgrading? **[Updating guide](https://apilium.com/en/doc/mayros/install/updating)** (and run `mayros doctor`)

---

## Coding CLI

`mayros code` is an interactive terminal UI for coding, conversation, and agent-driven workflows.

<p align="center">
  <img src="docs/assets/mayros-coding-cli-terminal-interface.png" alt="Mayros coding CLI terminal interface — welcome screen with mascot, quick start commands, session info, and status bar" width="720">
</p>

```bash
mayros code                    # interactive TUI session
mayros tui                     # alias
mayros -p "refactor auth flow" # headless mode (non-interactive)
```

**Features:**

- 🎨 3 themes (dark, light, high-contrast) — `/theme`
- 📝 3 output styles (standard, explanatory, learning) — `/style`
- ⌨️ Vim mode with motions, operators, undo — `/vim`
- 📋 `Ctrl+V` image paste from clipboard
- 📊 `/diff` inline diff viewer · `/context` token usage chart
- 🗺️ `/plan` semantic plan mode (Cortex-backed)
- 📎 `/copy` to clipboard · `/export [file]` to disk
- 🔀 `/model` switch models · `/think` set thinking level · `/fast` toggle fast mode

**Slash commands (30+):**

| Command          | Description       | Command          | Description          |
| ---------------- | ----------------- | ---------------- | -------------------- |
| `/help`          | List all commands | `/plan`          | Semantic plan mode   |
| `/new`           | Reset session     | `/diff`          | Show pending changes |
| `/compact`       | Compact context   | `/context`       | Token usage chart    |
| `/think <level>` | Set thinking      | `/theme`         | Cycle themes         |
| `/model <name>`  | Switch model      | `/vim`           | Toggle vim mode      |
| `/permission`    | Permission mode   | `/copy`          | Copy last response   |
| `/fast`          | Fast mode         | `/export [file]` | Export session       |

**Markdown-driven extensibility:**

- Custom agents: `~/.mayros/agents/*.md` — define persona, tools, and behavior in markdown
- Custom commands: `~/.mayros/commands/*.md` — define slash commands as markdown templates

---

## Quick Start

```bash
# 1. Install and onboard
mayros onboard --install-daemon

# 2. Start the Gateway
mayros gateway --port 18789 --verbose

# 3. Code interactively
mayros code

# 4. Or use the agent directly
mayros agent --message "Ship checklist" --thinking high

# 5. Or send a message to any channel
mayros message send --to +1234567890 --message "Hello from Mayros"
```

Full beginner guide: **[Getting started](https://apilium.com/en/doc/mayros/start/getting-started)**

---

## Architecture

```
  WhatsApp · Telegram · Slack · Discord · Signal · iMessage · Teams · Matrix · WebChat
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │          ⚡ Gateway             │
                    │     (local control plane)      │
                    │     ws://127.0.0.1:18789       │
                    └──────────────┬────────────────┘
                                   │
          ┌────────────┬───────────┼───────────┬────────────┐
          │            │           │           │            │
     mayros code   VSCode /   Pi Agent    macOS App    iOS/Android
      (TUI)       JetBrains   (RPC)      (menu bar)     Nodes
```

The Gateway is the single control plane — every client, channel, tool, and event connects through it.

---

## Multi-Channel Inbox

Mayros connects to the channels you already use. One assistant, everywhere.

| Channel                                                              | Transport  | Channel                                                                                                                   | Transport              |
| -------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| [WhatsApp](https://apilium.com/en/doc/mayros/channels/whatsapp)      | Baileys    | [Microsoft Teams](https://apilium.com/en/doc/mayros/channels/msteams)                                                     | Bot Framework          |
| [Telegram](https://apilium.com/en/doc/mayros/channels/telegram)      | grammY     | [Matrix](https://apilium.com/en/doc/mayros/channels/matrix)                                                               | matrix-js-sdk          |
| [Slack](https://apilium.com/en/doc/mayros/channels/slack)            | Bolt       | [BlueBubbles](https://apilium.com/en/doc/mayros/channels/bluebubbles)                                                     | iMessage (recommended) |
| [Discord](https://apilium.com/en/doc/mayros/channels/discord)        | discord.js | [iMessage](https://apilium.com/en/doc/mayros/channels/imessage)                                                           | Legacy macOS           |
| [Google Chat](https://apilium.com/en/doc/mayros/channels/googlechat) | Chat API   | [Zalo](https://apilium.com/en/doc/mayros/channels/zalo) / [Personal](https://apilium.com/en/doc/mayros/channels/zalouser) | Extension              |
| [Signal](https://apilium.com/en/doc/mayros/channels/signal)          | signal-cli | [WebChat](https://apilium.com/en/doc/mayros/web/webchat)                                                                  | Gateway WS             |

**Security defaults:** DM pairing — unknown senders get a pairing code. You approve with `mayros pairing approve <channel> <code>`. Public DMs require explicit opt-in.

---

## Knowledge Graph (AIngle Cortex)

Mayros remembers. Not just conversation history — semantic knowledge stored as RDF triples in [AIngle Cortex](https://github.com/ApiliumCode/aingle).

**Three-tier memory:**

1. **MAYROS.md** — flat-file persona and instructions, always loaded into the system prompt
2. **AIngle Cortex** — RDF triple store (`subject → predicate → object`) scoped by namespace. Optional: falls back to file-based memory when unavailable
3. **Titans STM/LTM** — short-term and long-term memory with temporal recall

**Built on top:**

- **Code indexer** — scans your codebase → RDF triples in Cortex (incremental, only re-indexes changed files)
- **Project memory** — persists conventions, findings, and architecture decisions across sessions
- **Smart compaction** — extracts key information before context pruning
- **Cross-session recall** — injects relevant knowledge from previous sessions into new prompts

**Design principles:** namespace isolation (no cross-namespace reads), graceful degradation (Cortex is a sidecar, not an FFI binding), circuit breaker with exponential backoff.

CLI: `mayros kg search|explore|query|stats|triples|namespaces|export|import`

---

## Multi-Agent Mesh

Agents that work together. Mayros supports coordinated multi-agent workflows with shared knowledge.

- **Team manager** — Cortex-backed lifecycle: create, assign roles, merge results, disband
- **Workflow orchestrator** — built-in workflows (code-review, research, refactor) + custom definitions
- **Agent mailbox** — persistent inter-agent messaging (send/inbox/outbox/archive)
- **Background task tracker** — long-running tasks with status and cancellation
- **Git worktree isolation** — each agent works in its own worktree to avoid conflicts
- **Session fork/rewind** — checkpoint-based exploration with rewind capability

CLI: `mayros workflow run|list` · `mayros dashboard team|summary|agent` · `mayros tasks list|status|cancel|summary` · `mayros mailbox list|read|send|archive|stats`

---

## IDE Plugins

Mayros lives inside your editor, connected via Gateway WebSocket.

**VSCode** (`tools/vscode-extension/`):

- Sidebar tree views: sessions, agents, skills
- Webview panels: chat, plan mode, trace viewer, knowledge graph
- Context menu actions and gutter markers

**JetBrains** (`tools/jetbrains-plugin/`):

- Unified tabbed panel with the same feature set
- Protocol v3 compatibility

Both connect to `ws://127.0.0.1:18789`.

---

## Voice & Companion Apps

- **[Voice Wake](https://apilium.com/en/doc/mayros/nodes/voicewake) + [Talk Mode](https://apilium.com/en/doc/mayros/nodes/talk)** — always-on speech for macOS/iOS/Android with ElevenLabs
- **[Live Canvas](https://apilium.com/en/doc/mayros/platforms/mac/canvas)** — agent-driven visual workspace with [A2UI](https://apilium.com/en/doc/mayros/platforms/mac/canvas#canvas-a2ui)
- **[macOS app](https://apilium.com/en/doc/mayros/platforms/macos)** — menu bar control, Voice Wake, Talk Mode overlay, WebChat, debug tools
- **[iOS node](https://apilium.com/en/doc/mayros/platforms/ios)** — Canvas, Voice Wake, Talk Mode, camera, screen recording, Bonjour pairing
- **[Android node](https://apilium.com/en/doc/mayros/platforms/android)** — Canvas, Talk Mode, camera, screen recording, optional SMS

---

## Extensions Ecosystem

55 extensions loaded as plugins at startup:

| Category      | Extension                 | Purpose                                                                   |
| ------------- | ------------------------- | ------------------------------------------------------------------------- |
| Skills        | `semantic-skills`         | QuickJS WASM sandbox, 6 semantic tools, skill marketplace                 |
| Agents        | `agent-mesh`              | Teams, workflows, delegation, mailbox, background tasks                   |
| Memory        | `memory-semantic`         | Cortex integration, rules engine, agent memory, contextual awareness      |
| Observability | `semantic-observability`  | Traces, decision graph, session fork/rewind                               |
| Indexer       | `code-indexer`            | Codebase scanning + RDF mapping (incremental)                             |
| Security      | `bash-sandbox`            | Command parsing, domain checker, blocklist, audit log                     |
| Permissions   | `interactive-permissions` | Runtime permission dialogs, intent classification, policy store           |
| Hooks         | `llm-hooks`               | Markdown-defined hook evaluation with safe condition parser               |
| MCP           | `mcp-client`              | Model Context Protocol client (stdio, SSE, WebSocket, HTTP)               |
| Economy       | `token-economy`           | Budget tracking, prompt cache optimization                                |
| Hub           | `skill-hub`               | Apilium Hub marketplace, Ed25519 signing, dependency audit                |
| IoT           | `iot-bridge`              | IoT node fleet management                                                 |
| Channels      | 17 plugins                | Discord, Telegram, WhatsApp, Slack, Signal, iMessage, Teams, Matrix, etc. |

---

## Hooks System

29 hook types across the assistant lifecycle:

- **Lifecycle** — `before_prompt_build`, `after_response`, `before_compaction`, `agent_end`, etc.
- **Security** — `permission_request` (modifying: allow/deny/ask), `config_change`
- **Coordination** — `teammate_idle`, `task_completed`, `notification`
- **HTTP webhooks** — POST delivery with HMAC-SHA256 signatures, retry + exponential backoff
- **Async queue** — background execution with concurrency limits and dead-letter queue
- **Markdown hooks** — place `.md` files in `~/.mayros/hooks/` for custom logic

---

## Security (18 layers)

Mayros takes security seriously. 18 layers of defense:

| Layer                       | Description                                                     |
| --------------------------- | --------------------------------------------------------------- |
| QuickJS WASM Sandbox        | Skills run in isolated WASM — no fs, net, process, eval         |
| Static Scanner              | 16 rules + anti-evasion preprocessing                           |
| Enrichment Sanitizer        | Unicode normalization, injection detection, depth limits        |
| Bash Sandbox                | Command parsing, domain blocklist, audit logging                |
| Interactive Permissions     | Runtime dialogs, intent classification, policy store            |
| Namespace Isolation         | All queries forced to `{ns}:` prefix — no cross-namespace reads |
| Tool Allowlist              | Intersection model — ALL active skills must allow a tool        |
| Rate Limiter                | Sliding window per skill (default: 60 calls/min)                |
| Query/Write Limits          | Per-skill caps on graph reads and writes                        |
| Enrichment Timeout          | 2s timeout prevents DoS via slow enrichment                     |
| Hot-Reload Validation       | Atomic swap, manifest validation, downgrade blocking            |
| Path Traversal Protection   | Reject `..` + `isPathInside()` double-check                     |
| Verify-then-Promote         | Temp extract → verify hashes → atomic promote                   |
| Circuit Breaker             | 3-state (closed/open/half-open) + exponential backoff           |
| DM Pairing                  | Unknown senders get pairing code, not access                    |
| Audit Logging               | Skill name + operation tagged on all sandbox writes             |
| Docker Sandboxing           | Per-session Docker containers for non-main sessions             |
| Enterprise Managed Settings | Enforced config overrides with locked keys                      |

---

## Models

Mayros is multi-model. Bring any provider.

- Models config + CLI: **[Models](https://apilium.com/en/doc/mayros/concepts/models)**
- Auth profile rotation (OAuth vs API keys) + fallbacks: **[Model failover](https://apilium.com/en/doc/mayros/concepts/model-failover)**

Minimal config:

```json5
{
  agent: {
    model: "anthropic/claude-opus-4-6",
  },
}
```

Full reference: **[Configuration](https://apilium.com/en/doc/mayros/gateway/configuration)**

---

## Plan Mode

Cortex-backed semantic planning for complex multi-step tasks.

- **Explore** — gather context from the codebase and Cortex graph
- **Assert** — declare facts and constraints the plan must satisfy
- **Approve** — review the plan before execution
- **Execute** — run the approved plan with progress tracking

CLI: `mayros plan start|explore|assert|show|approve|execute|done|list|status` · TUI: `/plan`

---

## Remote Gateway

Run the Gateway on a small Linux instance. Clients connect over **Tailscale Serve/Funnel** or **SSH tunnels**, and device nodes (macOS/iOS/Android) handle local actions via `node.invoke`.

Tailscale modes: `off` (default) · `serve` (tailnet-only HTTPS) · `funnel` (public HTTPS, requires password auth).

Details: **[Remote access](https://apilium.com/en/doc/mayros/gateway/remote)** · **[Tailscale guide](https://apilium.com/en/doc/mayros/gateway/tailscale)** · **[Docker](https://apilium.com/en/doc/mayros/install/docker)**

---

## Chat Commands (Channels)

Send these in WhatsApp/Telegram/Slack/Discord/Google Chat/Microsoft Teams/WebChat:

| Command                       | Description                                            |
| ----------------------------- | ------------------------------------------------------ |
| `/status`                     | Session status (model, tokens, cost)                   |
| `/new`, `/reset`              | Reset the session                                      |
| `/compact`                    | Compact session context                                |
| `/think <level>`              | Set thinking level (off/minimal/low/medium/high/xhigh) |
| `/verbose on\|off`            | Toggle verbose mode                                    |
| `/usage off\|tokens\|full`    | Per-response usage footer                              |
| `/restart`                    | Restart the gateway (owner-only)                       |
| `/activation mention\|always` | Group activation (groups only)                         |

---

## From Source

```bash
git clone https://github.com/ApiliumCode/mayros.git
cd mayros

pnpm install
pnpm ui:build   # auto-installs UI deps on first run
pnpm build

pnpm mayros onboard --install-daemon

# Dev loop (auto-reload)
pnpm gateway:watch
```

`pnpm mayros ...` runs TypeScript directly (via `tsx`). `pnpm build` produces `dist/`.

**Development channels:**

- **stable** — tagged releases, npm dist-tag `latest`
- **beta** — prerelease tags, npm dist-tag `beta`
- **dev** — moving head of `main`, npm dist-tag `dev`

Switch: `mayros update --channel stable|beta|dev`. Details: **[Development channels](https://apilium.com/en/doc/mayros/install/development-channels)**

---

## Skills Hub

[Skills Hub](https://hub.apilium.com) is a skill marketplace. With it enabled, the agent can search for skills automatically and pull in new ones.

- Workspace root: `~/.mayros/workspace`
- Skills: `~/.mayros/workspace/skills/<skill>/SKILL.md`
- Injected prompt files: `AGENTS.md`, `SOUL.md`, `TOOLS.md`

---

## Channel Setup

<details>
<summary><strong>WhatsApp</strong></summary>

- Link the device: `pnpm mayros channels login` (stores creds in `~/.mayros/credentials`)
- Allowlist: `channels.whatsapp.allowFrom`
- Groups: `channels.whatsapp.groups` (include `"*"` to allow all)

[Full guide →](https://apilium.com/en/doc/mayros/channels/whatsapp)

</details>

<details>
<summary><strong>Telegram</strong></summary>

Set `TELEGRAM_BOT_TOKEN` or `channels.telegram.botToken`:

```json5
{ channels: { telegram: { botToken: "123456:ABCDEF" } } }
```

[Full guide →](https://apilium.com/en/doc/mayros/channels/telegram)

</details>

<details>
<summary><strong>Slack</strong></summary>

Set `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` (or config equivalents).

[Full guide →](https://apilium.com/en/doc/mayros/channels/slack)

</details>

<details>
<summary><strong>Discord</strong></summary>

Set `DISCORD_BOT_TOKEN` or `channels.discord.token`:

```json5
{ channels: { discord: { token: "1234abcd" } } }
```

[Full guide →](https://apilium.com/en/doc/mayros/channels/discord)

</details>

<details>
<summary><strong>Signal · BlueBubbles · iMessage · Teams · Matrix · Zalo · WebChat</strong></summary>

- **Signal** — requires `signal-cli` + config section
- **BlueBubbles** (recommended iMessage) — `channels.bluebubbles.serverUrl` + `password` + webhook
- **iMessage** (legacy) — macOS-only via `imsg`
- **Microsoft Teams** — Bot Framework app + `msteams` config
- **Matrix** — `matrix-js-sdk` extension
- **Zalo / Zalo Personal** — extension channels
- **WebChat** — uses Gateway WebSocket directly

[Channel docs →](https://apilium.com/en/doc/mayros/channels)

</details>

---

## Documentation

**Start here:**

- [Getting started](https://apilium.com/en/doc/mayros/start/getting-started) — first-time setup
- [Architecture](https://apilium.com/en/doc/mayros/concepts/architecture) — gateway + protocol model
- [Configuration](https://apilium.com/en/doc/mayros/gateway/configuration) — every key + examples
- [Security](https://apilium.com/en/doc/mayros/gateway/security) — security model and guidance

**Platform guides:**

[macOS](https://apilium.com/en/doc/mayros/platforms/macos) · [iOS](https://apilium.com/en/doc/mayros/platforms/ios) · [Android](https://apilium.com/en/doc/mayros/platforms/android) · [Linux](https://apilium.com/en/doc/mayros/platforms/linux) · [Windows (WSL2)](https://apilium.com/en/doc/mayros/platforms/windows)

**Operations:**

[Gateway runbook](https://apilium.com/en/doc/mayros/gateway) · [Docker](https://apilium.com/en/doc/mayros/install/docker) · [Health checks](https://apilium.com/en/doc/mayros/gateway/health) · [Doctor](https://apilium.com/en/doc/mayros/gateway/doctor) · [Logging](https://apilium.com/en/doc/mayros/logging) · [Troubleshooting](https://apilium.com/en/doc/mayros/channels/troubleshooting)

**Deep dives:**

[Agent loop](https://apilium.com/en/doc/mayros/concepts/agent-loop) · [Sessions](https://apilium.com/en/doc/mayros/concepts/session) · [Models](https://apilium.com/en/doc/mayros/concepts/models) · [Presence](https://apilium.com/en/doc/mayros/concepts/presence) · [Streaming](https://apilium.com/en/doc/mayros/concepts/streaming) · [Skills](https://apilium.com/en/doc/mayros/tools/skills) · [Browser](https://apilium.com/en/doc/mayros/tools/browser) · [Canvas](https://apilium.com/en/doc/mayros/platforms/mac/canvas) · [Nodes](https://apilium.com/en/doc/mayros/nodes) · [Cron](https://apilium.com/en/doc/mayros/automation/cron-jobs) · [Webhooks](https://apilium.com/en/doc/mayros/automation/webhook) · [Gmail Pub/Sub](https://apilium.com/en/doc/mayros/automation/gmail-pubsub)

**Advanced:**

[Discovery + transports](https://apilium.com/en/doc/mayros/gateway/discovery) · [Bonjour/mDNS](https://apilium.com/en/doc/mayros/gateway/bonjour) · [Gateway pairing](https://apilium.com/en/doc/mayros/gateway/pairing) · [Tailscale](https://apilium.com/en/doc/mayros/gateway/tailscale) · [Remote gateway](https://apilium.com/en/doc/mayros/gateway/remote) · [Control UI](https://apilium.com/en/doc/mayros/web/control-ui) · [RPC adapters](https://apilium.com/en/doc/mayros/reference/rpc) · [TypeBox schemas](https://apilium.com/en/doc/mayros/concepts/typebox)

**Templates:**

[AGENTS](https://apilium.com/en/doc/mayros/reference/templates/AGENTS) · [BOOTSTRAP](https://apilium.com/en/doc/mayros/reference/templates/BOOTSTRAP) · [IDENTITY](https://apilium.com/en/doc/mayros/reference/templates/IDENTITY) · [TOOLS](https://apilium.com/en/doc/mayros/reference/templates/TOOLS) · [USER](https://apilium.com/en/doc/mayros/reference/templates/USER) · [Default AGENTS](https://apilium.com/en/doc/mayros/reference/AGENTS.default) · [Skills config](https://apilium.com/en/doc/mayros/tools/skills-config)

---

## Community

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, maintainers, and how to submit PRs.
AI/vibe-coded PRs welcome! 🤖

Special thanks to [Mario Zechner](https://mariozechner.at/) for his support and for
[pi-mono](https://github.com/badlogic/pi-mono).
