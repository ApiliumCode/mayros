# ⚡🛡️ Mayros — Personal AI Assistant

<p align="center">
    <img src="docs/assets/mayros-logo.svg" alt="Mayros" width="200">
</p>

<p align="center">
  <a href="https://github.com/ApiliumCode/mayros/actions/workflows/ci.yml?branch=main"><img src="https://img.shields.io/github/actions/workflow/status/ApiliumCode/mayros/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="https://github.com/ApiliumCode/mayros/releases"><img src="https://img.shields.io/github/v/release/ApiliumCode/mayros?include_prereleases&style=for-the-badge" alt="GitHub release"></a>
  <a href="https://discord.com/channels/1476351587105636404"><img src="https://img.shields.io/discord/1476351587105636404?label=Discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge" alt="Discord"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

**Mayros** is a _personal AI assistant_ you run on your own devices.
It answers you on the channels you already use (WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Microsoft Teams, WebChat), plus extension channels like BlueBubbles, Matrix, Zalo, and Zalo Personal. It can speak and listen on macOS/iOS/Android, and can render a live Canvas you control. The Gateway is just the control plane — the product is the assistant.

If you want a personal, single-user assistant that feels local, fast, and always-on, this is it.

[Product](https://apilium.com/us/products/maryos) · [Download](https://maryos.apilium.com) · [Docs](https://apilium.com/us/doc/maryos) · [Vision](VISION.md) · [Getting Started](https://apilium.com/us/doc/maryos/start/getting-started) · [Updating](https://apilium.com/us/doc/maryos/install/updating) · [FAQ](https://apilium.com/us/doc/maryos/start/faq) · [Docker](https://apilium.com/us/doc/maryos/install/docker)

Preferred setup: run the onboarding wizard (`mayros onboard`) in your terminal.
The wizard guides you step by step through setting up the gateway, workspace, channels, and skills. The CLI wizard is the recommended path and works on **macOS, Linux, and Windows (via WSL2; strongly recommended)**.
Works with npm, pnpm, or bun.
New install? Start here: [Getting started](https://apilium.com/us/doc/maryos/start/getting-started)

## Models (selection + auth)

- Models config + CLI: [Models](https://apilium.com/us/doc/maryos/concepts/models)
- Auth profile rotation (OAuth vs API keys) + fallbacks: [Model failover](https://apilium.com/us/doc/maryos/concepts/model-failover)

## Install (recommended)

Runtime: **Node ≥22**.

```bash
npm install -g mayros@latest
# or: pnpm add -g mayros@latest

mayros onboard --install-daemon
```

The wizard installs the Gateway daemon (launchd/systemd user service) so it stays running.

## Quick start (TL;DR)

Runtime: **Node ≥22**.

Full beginner guide (auth, pairing, channels): [Getting started](https://apilium.com/us/doc/maryos/start/getting-started)

```bash
mayros onboard --install-daemon

mayros gateway --port 18789 --verbose

# Send a message
mayros message send --to +1234567890 --message "Hello from Mayros"

# Talk to the assistant (optionally deliver back to any connected channel: WhatsApp/Telegram/Slack/Discord/Google Chat/Signal/iMessage/BlueBubbles/Microsoft Teams/Matrix/Zalo/Zalo Personal/WebChat)
mayros agent --message "Ship checklist" --thinking high
```

Upgrading? [Updating guide](https://apilium.com/us/doc/maryos/install/updating) (and run `mayros doctor`).

## Development channels

- **stable**: tagged releases (`vYYYY.M.D` or `vYYYY.M.D-<patch>`), npm dist-tag `latest`.
- **beta**: prerelease tags (`vYYYY.M.D-beta.N`), npm dist-tag `beta` (macOS app may be missing).
- **dev**: moving head of `main`, npm dist-tag `dev` (when published).

Switch channels (git + npm): `mayros update --channel stable|beta|dev`.
Details: [Development channels](https://apilium.com/us/doc/maryos/install/development-channels).

## From source (development)

Prefer `pnpm` for builds from source. Bun is optional for running TypeScript directly.

```bash
git clone https://github.com/ApiliumCode/mayros.git
cd mayros

pnpm install
pnpm ui:build # auto-installs UI deps on first run
pnpm build

pnpm mayros onboard --install-daemon

# Dev loop (auto-reload on TS changes)
pnpm gateway:watch
```

Note: `pnpm mayros ...` runs TypeScript directly (via `tsx`). `pnpm build` produces `dist/` for running via Node / the packaged `mayros` binary.

## Security defaults (DM access)

Mayros connects to real messaging surfaces. Treat inbound DMs as **untrusted input**.

Full security guide: [Security](https://apilium.com/us/doc/maryos/gateway/security)

Default behavior on Telegram/WhatsApp/Signal/iMessage/Microsoft Teams/Discord/Google Chat/Slack:

- **DM pairing** (`dmPolicy="pairing"` / `channels.discord.dmPolicy="pairing"` / `channels.slack.dmPolicy="pairing"`; legacy: `channels.discord.dm.policy`, `channels.slack.dm.policy`): unknown senders receive a short pairing code and the bot does not process their message.
- Approve with: `mayros pairing approve <channel> <code>` (then the sender is added to a local allowlist store).
- Public inbound DMs require an explicit opt-in: set `dmPolicy="open"` and include `"*"` in the channel allowlist (`allowFrom` / `channels.discord.allowFrom` / `channels.slack.allowFrom`; legacy: `channels.discord.dm.allowFrom`, `channels.slack.dm.allowFrom`).

Run `mayros doctor` to surface risky/misconfigured DM policies.

## Highlights

- **[Local-first Gateway](https://apilium.com/us/doc/maryos/gateway)** — single control plane for sessions, channels, tools, and events.
- **[Multi-channel inbox](https://apilium.com/us/doc/maryos/channels)** — WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, BlueBubbles (iMessage), iMessage (legacy), Microsoft Teams, Matrix, Zalo, Zalo Personal, WebChat, macOS, iOS/Android.
- **[Multi-agent routing](https://apilium.com/us/doc/maryos/gateway/configuration)** — route inbound channels/accounts/peers to isolated agents (workspaces + per-agent sessions).
- **[Voice Wake](https://apilium.com/us/doc/maryos/nodes/voicewake) + [Talk Mode](https://apilium.com/us/doc/maryos/nodes/talk)** — always-on speech for macOS/iOS/Android with ElevenLabs.
- **[Live Canvas](https://apilium.com/us/doc/maryos/platforms/mac/canvas)** — agent-driven visual workspace with [A2UI](https://apilium.com/us/doc/maryos/platforms/mac/canvas#canvas-a2ui).
- **[First-class tools](https://apilium.com/us/doc/maryos/tools)** — browser, canvas, nodes, cron, sessions, and Discord/Slack actions.
- **[Companion apps](https://apilium.com/us/doc/maryos/platforms/macos)** — macOS menu bar app + iOS/Android [nodes](https://apilium.com/us/doc/maryos/nodes).
- **[Onboarding](https://apilium.com/us/doc/maryos/start/wizard) + [skills](https://apilium.com/us/doc/maryos/tools/skills)** — wizard-driven setup with bundled/managed/workspace skills.

## Semantic Memory (AIngle Cortex)

Mayros includes a three-tier memory architecture so the assistant remembers context across conversations and channels:

1. **MAYROS.md** — flat-file persona and instructions, always loaded into the system prompt.
2. **[AIngle Cortex](https://github.com/ApiliumCode/aingle)** — an RDF triple store that runs as an HTTP sidecar. Skills and the agent read/write semantic triples (`subject → predicate → object`) scoped by namespace. Cortex is optional: when unavailable the assistant falls back to markdown-based memory.
3. **Titans STM/LTM** — short-term and long-term memory layers that complement the graph with temporal recall.

Key design points:

- **Namespace isolation** — every query is forced to `{ns}:` prefix; no cross-namespace reads.
- **Graceful degradation** — Cortex is an HTTP sidecar, not an FFI binding. If the sidecar is down, the gateway continues working with file-based memory.
- **Circuit breaker** — `cortex-resilience.ts` wraps all Cortex calls with a 3-state circuit breaker and exponential backoff.
- **Skill access** — skills interact with memory through 6 semantic tools (`skill_graph_query`, `skill_assert`, `skill_memory_context`, etc.) inside the QuickJS WASM sandbox.

Cortex version: **aingle_cortex 0.2.6** · AIngle crate: **0.0.101** · Zome types: **0.0.4**

## Everything we built so far

### Core platform

- [Gateway WS control plane](https://apilium.com/us/doc/maryos/gateway) with sessions, presence, config, cron, webhooks, [Control UI](https://apilium.com/us/doc/maryos/web), and [Canvas host](https://apilium.com/us/doc/maryos/platforms/mac/canvas#canvas-a2ui).
- [CLI surface](https://apilium.com/us/doc/maryos/tools/agent-send): gateway, agent, send, [wizard](https://apilium.com/us/doc/maryos/start/wizard), and [doctor](https://apilium.com/us/doc/maryos/gateway/doctor).
- [Pi agent runtime](https://apilium.com/us/doc/maryos/concepts/agent) in RPC mode with tool streaming and block streaming.
- [Session model](https://apilium.com/us/doc/maryos/concepts/session): `main` for direct chats, group isolation, activation modes, queue modes, reply-back. Group rules: [Groups](https://apilium.com/us/doc/maryos/concepts/groups).
- [Media pipeline](https://apilium.com/us/doc/maryos/nodes/images): images/audio/video, transcription hooks, size caps, temp file lifecycle. Audio details: [Audio](https://apilium.com/us/doc/maryos/nodes/audio).

### Channels

- [Channels](https://apilium.com/us/doc/maryos/channels): [WhatsApp](https://apilium.com/us/doc/maryos/channels/whatsapp) (Baileys), [Telegram](https://apilium.com/us/doc/maryos/channels/telegram) (grammY), [Slack](https://apilium.com/us/doc/maryos/channels/slack) (Bolt), [Discord](https://apilium.com/us/doc/maryos/channels/discord) (discord.js), [Google Chat](https://apilium.com/us/doc/maryos/channels/googlechat) (Chat API), [Signal](https://apilium.com/us/doc/maryos/channels/signal) (signal-cli), [BlueBubbles](https://apilium.com/us/doc/maryos/channels/bluebubbles) (iMessage, recommended), [iMessage](https://apilium.com/us/doc/maryos/channels/imessage) (legacy imsg), [Microsoft Teams](https://apilium.com/us/doc/maryos/channels/msteams) (extension), [Matrix](https://apilium.com/us/doc/maryos/channels/matrix) (extension), [Zalo](https://apilium.com/us/doc/maryos/channels/zalo) (extension), [Zalo Personal](https://apilium.com/us/doc/maryos/channels/zalouser) (extension), [WebChat](https://apilium.com/us/doc/maryos/web/webchat).
- [Group routing](https://apilium.com/us/doc/maryos/concepts/group-messages): mention gating, reply tags, per-channel chunking and routing. Channel rules: [Channels](https://apilium.com/us/doc/maryos/channels).

### Apps + nodes

- [macOS app](https://apilium.com/us/doc/maryos/platforms/macos): menu bar control plane, [Voice Wake](https://apilium.com/us/doc/maryos/nodes/voicewake)/PTT, [Talk Mode](https://apilium.com/us/doc/maryos/nodes/talk) overlay, [WebChat](https://apilium.com/us/doc/maryos/web/webchat), debug tools, [remote gateway](https://apilium.com/us/doc/maryos/gateway/remote) control.
- [iOS node](https://apilium.com/us/doc/maryos/platforms/ios): [Canvas](https://apilium.com/us/doc/maryos/platforms/mac/canvas), [Voice Wake](https://apilium.com/us/doc/maryos/nodes/voicewake), [Talk Mode](https://apilium.com/us/doc/maryos/nodes/talk), camera, screen recording, Bonjour pairing.
- [Android node](https://apilium.com/us/doc/maryos/platforms/android): [Canvas](https://apilium.com/us/doc/maryos/platforms/mac/canvas), [Talk Mode](https://apilium.com/us/doc/maryos/nodes/talk), camera, screen recording, optional SMS.
- [macOS node mode](https://apilium.com/us/doc/maryos/nodes): system.run/notify + canvas/camera exposure.

### Tools + automation

- [Browser control](https://apilium.com/us/doc/maryos/tools/browser): dedicated mayros Chrome/Chromium, snapshots, actions, uploads, profiles.
- [Canvas](https://apilium.com/us/doc/maryos/platforms/mac/canvas): [A2UI](https://apilium.com/us/doc/maryos/platforms/mac/canvas#canvas-a2ui) push/reset, eval, snapshot.
- [Nodes](https://apilium.com/us/doc/maryos/nodes): camera snap/clip, screen record, [location.get](https://apilium.com/us/doc/maryos/nodes/location-command), notifications.
- [Cron + wakeups](https://apilium.com/us/doc/maryos/automation/cron-jobs); [webhooks](https://apilium.com/us/doc/maryos/automation/webhook); [Gmail Pub/Sub](https://apilium.com/us/doc/maryos/automation/gmail-pubsub).
- [Skills platform](https://apilium.com/us/doc/maryos/tools/skills): bundled, managed, and workspace skills with install gating + UI.

### Runtime + safety

- [Channel routing](https://apilium.com/us/doc/maryos/concepts/channel-routing), [retry policy](https://apilium.com/us/doc/maryos/concepts/retry), and [streaming/chunking](https://apilium.com/us/doc/maryos/concepts/streaming).
- [Presence](https://apilium.com/us/doc/maryos/concepts/presence), [typing indicators](https://apilium.com/us/doc/maryos/concepts/typing-indicators), and [usage tracking](https://apilium.com/us/doc/maryos/concepts/usage-tracking).
- [Models](https://apilium.com/us/doc/maryos/concepts/models), [model failover](https://apilium.com/us/doc/maryos/concepts/model-failover), and [session pruning](https://apilium.com/us/doc/maryos/concepts/session-pruning).
- [Security](https://apilium.com/us/doc/maryos/gateway/security) and [troubleshooting](https://apilium.com/us/doc/maryos/channels/troubleshooting).

### Ops + packaging

- [Control UI](https://apilium.com/us/doc/maryos/web) + [WebChat](https://apilium.com/us/doc/maryos/web/webchat) served directly from the Gateway.
- [Tailscale Serve/Funnel](https://apilium.com/us/doc/maryos/gateway/tailscale) or [SSH tunnels](https://apilium.com/us/doc/maryos/gateway/remote) with token/password auth.
- [Docker](https://apilium.com/us/doc/maryos/install/docker)-based installs.
- [Doctor](https://apilium.com/us/doc/maryos/gateway/doctor) migrations, [logging](https://apilium.com/us/doc/maryos/logging).

## How it works (short)

```
WhatsApp / Telegram / Slack / Discord / Google Chat / Signal / iMessage / BlueBubbles / Microsoft Teams / Matrix / Zalo / Zalo Personal / WebChat
               │
               ▼
┌───────────────────────────────┐
│            Gateway            │
│       (control plane)         │
│     ws://127.0.0.1:18789      │
└──────────────┬────────────────┘
               │
               ├─ Pi agent (RPC)
               ├─ CLI (mayros …)
               ├─ WebChat UI
               ├─ macOS app
               └─ iOS / Android nodes
```

## Key subsystems

- **[Gateway WebSocket network](https://apilium.com/us/doc/maryos/concepts/architecture)** — single WS control plane for clients, tools, and events (plus ops: [Gateway runbook](https://apilium.com/us/doc/maryos/gateway)).
- **[Tailscale exposure](https://apilium.com/us/doc/maryos/gateway/tailscale)** — Serve/Funnel for the Gateway dashboard + WS (remote access: [Remote](https://apilium.com/us/doc/maryos/gateway/remote)).
- **[Browser control](https://apilium.com/us/doc/maryos/tools/browser)** — mayros‑managed Chrome/Chromium with CDP control.
- **[Canvas + A2UI](https://apilium.com/us/doc/maryos/platforms/mac/canvas)** — agent‑driven visual workspace (A2UI host: [Canvas/A2UI](https://apilium.com/us/doc/maryos/platforms/mac/canvas#canvas-a2ui)).
- **[Voice Wake](https://apilium.com/us/doc/maryos/nodes/voicewake) + [Talk Mode](https://apilium.com/us/doc/maryos/nodes/talk)** — always‑on speech and continuous conversation.
- **[Nodes](https://apilium.com/us/doc/maryos/nodes)** — Canvas, camera snap/clip, screen record, `location.get`, notifications, plus macOS‑only `system.run`/`system.notify`.

## Tailscale access (Gateway dashboard)

Mayros can auto-configure Tailscale **Serve** (tailnet-only) or **Funnel** (public) while the Gateway stays bound to loopback. Configure `gateway.tailscale.mode`:

- `off`: no Tailscale automation (default).
- `serve`: tailnet-only HTTPS via `tailscale serve` (uses Tailscale identity headers by default).
- `funnel`: public HTTPS via `tailscale funnel` (requires shared password auth).

Notes:

- `gateway.bind` must stay `loopback` when Serve/Funnel is enabled (Mayros enforces this).
- Serve can be forced to require a password by setting `gateway.auth.mode: "password"` or `gateway.auth.allowTailscale: false`.
- Funnel refuses to start unless `gateway.auth.mode: "password"` is set.
- Optional: `gateway.tailscale.resetOnExit` to undo Serve/Funnel on shutdown.

Details: [Tailscale guide](https://apilium.com/us/doc/maryos/gateway/tailscale) · [Web surfaces](https://apilium.com/us/doc/maryos/web)

## Remote Gateway (Linux is great)

It’s perfectly fine to run the Gateway on a small Linux instance. Clients (macOS app, CLI, WebChat) can connect over **Tailscale Serve/Funnel** or **SSH tunnels**, and you can still pair device nodes (macOS/iOS/Android) to execute device‑local actions when needed.

- **Gateway host** runs the exec tool and channel connections by default.
- **Device nodes** run device‑local actions (`system.run`, camera, screen recording, notifications) via `node.invoke`.
  In short: exec runs where the Gateway lives; device actions run where the device lives.

Details: [Remote access](https://apilium.com/us/doc/maryos/gateway/remote) · [Nodes](https://apilium.com/us/doc/maryos/nodes) · [Security](https://apilium.com/us/doc/maryos/gateway/security)

## macOS permissions via the Gateway protocol

The macOS app can run in **node mode** and advertises its capabilities + permission map over the Gateway WebSocket (`node.list` / `node.describe`). Clients can then execute local actions via `node.invoke`:

- `system.run` runs a local command and returns stdout/stderr/exit code; set `needsScreenRecording: true` to require screen-recording permission (otherwise you’ll get `PERMISSION_MISSING`).
- `system.notify` posts a user notification and fails if notifications are denied.
- `canvas.*`, `camera.*`, `screen.record`, and `location.get` are also routed via `node.invoke` and follow TCC permission status.

Elevated bash (host permissions) is separate from macOS TCC:

- Use `/elevated on|off` to toggle per‑session elevated access when enabled + allowlisted.
- Gateway persists the per‑session toggle via `sessions.patch` (WS method) alongside `thinkingLevel`, `verboseLevel`, `model`, `sendPolicy`, and `groupActivation`.

Details: [Nodes](https://apilium.com/us/doc/maryos/nodes) · [macOS app](https://apilium.com/us/doc/maryos/platforms/macos) · [Gateway protocol](https://apilium.com/us/doc/maryos/concepts/architecture)

## Agent to Agent (sessions\_\* tools)

- Use these to coordinate work across sessions without jumping between chat surfaces.
- `sessions_list` — discover active sessions (agents) and their metadata.
- `sessions_history` — fetch transcript logs for a session.
- `sessions_send` — message another session; optional reply‑back ping‑pong + announce step (`REPLY_SKIP`, `ANNOUNCE_SKIP`).

Details: [Session tools](https://apilium.com/us/doc/maryos/concepts/session-tool)

## Skills registry (Skills Hub)

Skills Hub is a minimal skill registry. With Skills Hub enabled, the agent can search for skills automatically and pull in new ones as needed.

[Skills Hub](https://hub.apilium.com)

## Chat commands

Send these in WhatsApp/Telegram/Slack/Google Chat/Microsoft Teams/WebChat (group commands are owner-only):

- `/status` — compact session status (model + tokens, cost when available)
- `/new` or `/reset` — reset the session
- `/compact` — compact session context (summary)
- `/think <level>` — off|minimal|low|medium|high|xhigh (GPT-5.2 + Codex models only)
- `/verbose on|off`
- `/usage off|tokens|full` — per-response usage footer
- `/restart` — restart the gateway (owner-only in groups)
- `/activation mention|always` — group activation toggle (groups only)

## Apps (optional)

The Gateway alone delivers a great experience. All apps are optional and add extra features.

If you plan to build/run companion apps, follow the platform runbooks below.

### macOS (Mayros.app) (optional)

- Menu bar control for the Gateway and health.
- Voice Wake + push-to-talk overlay.
- WebChat + debug tools.
- Remote gateway control over SSH.

Note: signed builds required for macOS permissions to stick across rebuilds (see `docs/mac/permissions.md`).

### iOS node (optional)

- Pairs as a node via the Bridge.
- Voice trigger forwarding + Canvas surface.
- Controlled via `mayros nodes …`.

Runbook: [iOS connect](https://apilium.com/us/doc/maryos/platforms/ios).

### Android node (optional)

- Pairs via the same Bridge + pairing flow as iOS.
- Exposes Canvas, Camera, and Screen capture commands.
- Runbook: [Android connect](https://apilium.com/us/doc/maryos/platforms/android).

## Agent workspace + skills

- Workspace root: `~/.mayros/workspace` (configurable via `agents.defaults.workspace`).
- Injected prompt files: `AGENTS.md`, `SOUL.md`, `TOOLS.md`.
- Skills: `~/.mayros/workspace/skills/<skill>/SKILL.md`.

## Configuration

Minimal `~/.mayros/mayros.json` (model + defaults):

```json5
{
  agent: {
    model: "anthropic/claude-opus-4-6",
  },
}
```

[Full configuration reference (all keys + examples).](https://apilium.com/us/doc/maryos/gateway/configuration)

## Security model (important)

- **Default:** tools run on the host for the **main** session, so the agent has full access when it’s just you.
- **Group/channel safety:** set `agents.defaults.sandbox.mode: "non-main"` to run **non‑main sessions** (groups/channels) inside per‑session Docker sandboxes; bash then runs in Docker for those sessions.
- **Sandbox defaults:** allowlist `bash`, `process`, `read`, `write`, `edit`, `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`; denylist `browser`, `canvas`, `nodes`, `cron`, `discord`, `gateway`.

Details: [Security guide](https://apilium.com/us/doc/maryos/gateway/security) · [Docker + sandboxing](https://apilium.com/us/doc/maryos/install/docker) · [Sandbox config](https://apilium.com/us/doc/maryos/gateway/configuration)

### [WhatsApp](https://apilium.com/us/doc/maryos/channels/whatsapp)

- Link the device: `pnpm mayros channels login` (stores creds in `~/.mayros/credentials`).
- Allowlist who can talk to the assistant via `channels.whatsapp.allowFrom`.
- If `channels.whatsapp.groups` is set, it becomes a group allowlist; include `"*"` to allow all.

### [Telegram](https://apilium.com/us/doc/maryos/channels/telegram)

- Set `TELEGRAM_BOT_TOKEN` or `channels.telegram.botToken` (env wins).
- Optional: set `channels.telegram.groups` (with `channels.telegram.groups."*".requireMention`); when set, it is a group allowlist (include `"*"` to allow all). Also `channels.telegram.allowFrom` or `channels.telegram.webhookUrl` + `channels.telegram.webhookSecret` as needed.

```json5
{
  channels: {
    telegram: {
      botToken: "123456:ABCDEF",
    },
  },
}
```

### [Slack](https://apilium.com/us/doc/maryos/channels/slack)

- Set `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` (or `channels.slack.botToken` + `channels.slack.appToken`).

### [Discord](https://apilium.com/us/doc/maryos/channels/discord)

- Set `DISCORD_BOT_TOKEN` or `channels.discord.token` (env wins).
- Optional: set `commands.native`, `commands.text`, or `commands.useAccessGroups`, plus `channels.discord.allowFrom`, `channels.discord.guilds`, or `channels.discord.mediaMaxMb` as needed.

```json5
{
  channels: {
    discord: {
      token: "1234abcd",
    },
  },
}
```

### [Signal](https://apilium.com/us/doc/maryos/channels/signal)

- Requires `signal-cli` and a `channels.signal` config section.

### [BlueBubbles (iMessage)](https://apilium.com/us/doc/maryos/channels/bluebubbles)

- **Recommended** iMessage integration.
- Configure `channels.bluebubbles.serverUrl` + `channels.bluebubbles.password` and a webhook (`channels.bluebubbles.webhookPath`).
- The BlueBubbles server runs on macOS; the Gateway can run on macOS or elsewhere.

### [iMessage (legacy)](https://apilium.com/us/doc/maryos/channels/imessage)

- Legacy macOS-only integration via `imsg` (Messages must be signed in).
- If `channels.imessage.groups` is set, it becomes a group allowlist; include `"*"` to allow all.

### [Microsoft Teams](https://apilium.com/us/doc/maryos/channels/msteams)

- Configure a Teams app + Bot Framework, then add a `msteams` config section.
- Allowlist who can talk via `msteams.allowFrom`; group access via `msteams.groupAllowFrom` or `msteams.groupPolicy: "open"`.

### [WebChat](https://apilium.com/us/doc/maryos/web/webchat)

- Uses the Gateway WebSocket; no separate WebChat port/config.

Browser control (optional):

```json5
{
  browser: {
    enabled: true,
    color: "#FF4500",
  },
}
```

## Docs

Use these when you’re past the onboarding flow and want the deeper reference.

- [Start with the docs index for navigation and “what’s where.”](https://apilium.com/us/doc/maryos)
- [Read the architecture overview for the gateway + protocol model.](https://apilium.com/us/doc/maryos/concepts/architecture)
- [Use the full configuration reference when you need every key and example.](https://apilium.com/us/doc/maryos/gateway/configuration)
- [Run the Gateway by the book with the operational runbook.](https://apilium.com/us/doc/maryos/gateway)
- [Learn how the Control UI/Web surfaces work and how to expose them safely.](https://apilium.com/us/doc/maryos/web)
- [Understand remote access over SSH tunnels or tailnets.](https://apilium.com/us/doc/maryos/gateway/remote)
- [Follow the onboarding wizard flow for a guided setup.](https://apilium.com/us/doc/maryos/start/wizard)
- [Wire external triggers via the webhook surface.](https://apilium.com/us/doc/maryos/automation/webhook)
- [Set up Gmail Pub/Sub triggers.](https://apilium.com/us/doc/maryos/automation/gmail-pubsub)
- [Learn the macOS menu bar companion details.](https://apilium.com/us/doc/maryos/platforms/mac/menu-bar)
- [Platform guides: Windows (WSL2)](https://apilium.com/us/doc/maryos/platforms/windows), [Linux](https://apilium.com/us/doc/maryos/platforms/linux), [macOS](https://apilium.com/us/doc/maryos/platforms/macos), [iOS](https://apilium.com/us/doc/maryos/platforms/ios), [Android](https://apilium.com/us/doc/maryos/platforms/android)
- [Debug common failures with the troubleshooting guide.](https://apilium.com/us/doc/maryos/channels/troubleshooting)
- [Review security guidance before exposing anything.](https://apilium.com/us/doc/maryos/gateway/security)

## Advanced docs (discovery + control)

- [Discovery + transports](https://apilium.com/us/doc/maryos/gateway/discovery)
- [Bonjour/mDNS](https://apilium.com/us/doc/maryos/gateway/bonjour)
- [Gateway pairing](https://apilium.com/us/doc/maryos/gateway/pairing)
- [Remote gateway README](https://apilium.com/us/doc/maryos/gateway/remote-gateway-readme)
- [Control UI](https://apilium.com/us/doc/maryos/web/control-ui)
- [Dashboard](https://apilium.com/us/doc/maryos/web/dashboard)

## Operations & troubleshooting

- [Health checks](https://apilium.com/us/doc/maryos/gateway/health)
- [Gateway lock](https://apilium.com/us/doc/maryos/gateway/gateway-lock)
- [Background process](https://apilium.com/us/doc/maryos/gateway/background-process)
- [Browser troubleshooting (Linux)](https://apilium.com/us/doc/maryos/tools/browser-linux-troubleshooting)
- [Logging](https://apilium.com/us/doc/maryos/logging)

## Deep dives

- [Agent loop](https://apilium.com/us/doc/maryos/concepts/agent-loop)
- [Presence](https://apilium.com/us/doc/maryos/concepts/presence)
- [TypeBox schemas](https://apilium.com/us/doc/maryos/concepts/typebox)
- [RPC adapters](https://apilium.com/us/doc/maryos/reference/rpc)
- [Queue](https://apilium.com/us/doc/maryos/concepts/queue)

## Workspace & skills

- [Skills config](https://apilium.com/us/doc/maryos/tools/skills-config)
- [Default AGENTS](https://apilium.com/us/doc/maryos/reference/AGENTS.default)
- [Templates: AGENTS](https://apilium.com/us/doc/maryos/reference/templates/AGENTS)
- [Templates: BOOTSTRAP](https://apilium.com/us/doc/maryos/reference/templates/BOOTSTRAP)
- [Templates: IDENTITY](https://apilium.com/us/doc/maryos/reference/templates/IDENTITY)
- [Templates: SOUL](https://apilium.com/us/doc/maryos/reference/templates/SOUL)
- [Templates: TOOLS](https://apilium.com/us/doc/maryos/reference/templates/TOOLS)
- [Templates: USER](https://apilium.com/us/doc/maryos/reference/templates/USER)

## Platform internals

- [macOS dev setup](https://apilium.com/us/doc/maryos/platforms/mac/dev-setup)
- [macOS menu bar](https://apilium.com/us/doc/maryos/platforms/mac/menu-bar)
- [macOS voice wake](https://apilium.com/us/doc/maryos/platforms/mac/voicewake)
- [iOS node](https://apilium.com/us/doc/maryos/platforms/ios)
- [Android node](https://apilium.com/us/doc/maryos/platforms/android)
- [Windows (WSL2)](https://apilium.com/us/doc/maryos/platforms/windows)
- [Linux app](https://apilium.com/us/doc/maryos/platforms/linux)

## Email hooks (Gmail)

- [apilium.com/us/doc/maryos/gmail-pubsub](https://apilium.com/us/doc/maryos/automation/gmail-pubsub)

## Community

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, maintainers, and how to submit PRs.
AI/vibe-coded PRs welcome! 🤖

Special thanks to [Mario Zechner](https://mariozechner.at/) for his support and for
[pi-mono](https://github.com/badlogic/pi-mono).
