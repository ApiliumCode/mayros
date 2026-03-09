# MAYROS v0.1.8 — Project Instructions

## Project Info

- **Product**: [apilium.com/en/products/mayros](https://apilium.com/en/products/mayros)
- **Download**: [mayros.apilium.com](https://mayros.apilium.com)
- **Documentation**: [apilium.com/en/doc/mayros](https://apilium.com/en/doc/mayros)
- **Repo (public)**: [github.com/ApiliumCode/mayros](https://github.com/ApiliumCode/mayros)
- **Repo (dev)**: This repository
- **AIngle**: [github.com/ApiliumCode/aingle](https://github.com/ApiliumCode/aingle)
- **Skills Hub**: [github.com/ApiliumCode/skills-hub](https://github.com/ApiliumCode/skills-hub)
- **Social**: X [@mayros_ai](https://x.com/mayros_ai), Instagram [@mayros_ai](https://instagram.com/mayros_ai), [Discord](https://discord.gg/RKk3ahyj)

## Repository Structure

```
src/                          # Core: CLI, commands, infra, media, agents
  agents/                     # Agent management, markdown-agents
  cli/                        # 49 CLI modules (*-cli.ts)
  commands/                   # Command handlers
  config/                     # Configuration system (types.mayros, types.hooks, io)
  cron/                       # Task scheduling
  daemon/                     # System service
  gateway/                    # WebSocket/HTTP server
  hooks/                      # Hook system (http-hook-dispatcher, internal-hooks)
  infra/                      # Infrastructure (git-worktree)
  plugins/                    # Plugin framework (types, hooks, async-hook-queue)
  security/                   # Static scanner (skill-scanner.ts)
  tui/                        # Terminal UI (themes, vim, diff, context, keybindings)
extensions/                   # 56 plugin extensions
  semantic-skills/            # Semantic skill SDK, 6 tools, WASM sandbox
    sandbox/                  # QuickJS sandbox (quickjs-sandbox, marshal, transpiler)
  agent-mesh/                 # Multi-agent: delegation, fusion, teams, workflows, mailbox, dashboard, background tracker
  bash-sandbox/               # Command parser, domain checker, blocklist, container isolation
  interactive-permissions/    # Intent classifier, policy store, Cortex audit
  llm-hooks/                  # Hook loader, LLM evaluator, safe condition parser
  mcp-client/                 # 4 transports (stdio, HTTP, WebSocket, SSE)
  mcp-server/                 # Expose tools via Model Context Protocol
  memory-core/                # Bundled memory search
  memory-lancedb/             # Long-term memory, auto-recall/capture
  memory-semantic/            # Cortex integration, project-memory, rules-engine, agent-memory, contextual-awareness, compaction-extractor
  code-indexer/               # RDF code mapper, incremental scanner
  skill-hub/                  # Marketplace, dependency-audit, update-checker, category-registry
  semantic-observability/     # Trace emitter, decision graph, session-fork
  token-economy/              # Budget tracking, prompt cache
  cortex-sync/                # P2P sync, gossip protocol, CortexClient bridge
  shared/                     # CortexClient, cortex-config, cortex-resilience, cortex-version
  browser-automation/         # Playwright, CDP, visual understanding
  voice-call/                 # Telnyx, Twilio, Plivo
  talk-voice/                 # Bidirectional voice conversation
  iot-bridge/                 # AIngle Minimal edge nodes
  device-pair/                # iOS/Android pairing
  [20 channel extensions]     # whatsapp, telegram, discord, slack, signal, irc, line, matrix, bluebubbles, googlechat, msteams, mattermost, feishu, nextcloud-talk, nostr, tlon, twitch, zalo, zalouser, lobster
  [5 auth extensions]         # google-antigravity-auth, google-gemini-cli-auth, qwen-portal-auth, minimax-portal-auth, copilot-proxy
skills/examples/              # 5 example skills (verify-kyc, code-review, etc.)
tools/vscode-extension/       # VSCode extension (tree views, webview panels, WebSocket)
docs/                         # Product page, architecture docs
```

## Build & Test

- Runtime: **Node >= 22.12**, pnpm 10.23.0
- Install: `pnpm install`
- Build: `pnpm build`
- Tests: `pnpm test` (vitest) — ~1500 test files across src/ and extensions/
- Type check: `pnpm tsgo` or `npx tsc --noEmit`
- Sync extension versions: `pnpm plugins:sync` (reads root package.json)

## Coding Conventions

- TypeScript ESM, strict typing, no `any`
- Plugin SDK: `@sinclair/typebox` for params, manual config validation (not Zod)
- Tests: colocated `*.test.ts`, vitest
- Product name: **Mayros** (headings), `mayros` (CLI, paths, config)
- Extensions: keep plugin deps in extension `package.json`, not root
- No AI mentions in commits, PRs, or code (repo is public)
- PRs target `dev` branch, never `main`

## Architecture Overview

Three layers:

1. **Gateway** — WebSocket/HTTP server: sessions, routing, hooks (29), tool execution, plugin loading
2. **Cortex (AIngle)** — Cryptographic semantic layer: RDF knowledge graph, Proof-of-Logic, ZK proofs
3. **Nodes** — Native clients: macOS (Swift 6), iOS, Android, Apple Watch

### Channels (20+)

WhatsApp, Telegram, Discord, Slack, iMessage (BlueBubbles), Signal, IRC, LINE, Matrix, Google Chat, MS Teams, Mattermost, Feishu, Nextcloud Talk, Nostr, Tlon, Twitch, Zalo, WebChat

### Providers (27+)

Anthropic, OpenAI, Google Gemini, Ollama, Amazon Bedrock, HuggingFace, Together, OpenRouter, Venice, vLLM, MiniMax, Moonshot, Qwen, Xiaomi, Baidu, BytePlus, NVIDIA, Cloudflare AI Gateway, Vercel AI Gateway, LiteLLM, Deepgram, GitHub Copilot, and more

### Lifecycle Hooks (29)

```
before_model_resolve, before_prompt_build, before_agent_start, llm_input, llm_output,
agent_end, before_compaction, after_compaction, before_reset, message_received,
message_sending, message_sent, before_tool_call, after_tool_call, tool_result_persist,
before_message_write, session_start, session_end, subagent_spawning,
subagent_delivery_target, subagent_spawned, subagent_ended, gateway_start, gateway_stop,
permission_request, notification, teammate_idle, task_completed, config_change
```

### Developer Experience

- **TUI**: 3 themes (dark/light/high-contrast), vim mode, @ file mentions, diff viewer, context visualization, output styles, keybinding customization
- **VSCode Extension**: 3 tree views, 4 webview panels, real-time Gateway sync
- **MCP Server**: `mayros serve` exposes tools via MCP (stdio + HTTP)
- **Headless CLI**: `mayros -p "query"` for scripts/CI (JSON-lines output)
- **Plan Mode**: Cortex-backed explore → assert → approve → execute lifecycle

## Security Architecture (18 layers)

### 5-Stage Skill Verification Pipeline

1. **Static Scanner** — 16 rules (dangerous-exec, crypto-mining, exfiltration, obfuscation, etc.) + anti-evasion preprocessing
2. **Ed25519 Signature** — author identity + file integrity
3. **Proof-of-Logic** — ontological consistency via AIngle
4. **WASM Sandbox** — QuickJS with only 7 host functions (graphClient + logger)
5. **Sandbox Test** — live execution in TTL-scoped namespace

### Sandbox Config (`extensions/semantic-skills/config.ts`)

- `sandboxEnabled` (default: true) — false requires `MAYROS_UNSAFE_DIRECT_LOAD=1`
- `memoryLimitBytes` (1MB–256MB, default 8MB)
- `maxStackSizeBytes` (64KB–8MB, default 512KB)
- `executionTimeoutMs` (100–60000, default 10s)
- `maxCallsPerMinute` (1–1000, default 60)

### Static Scanner (`src/security/skill-scanner.ts`)

16 rules (12 line + 4 source):

- dangerous-exec, dynamic-code-execution, crypto-mining, suspicious-network
- semantic-unbounded-query, semantic-unproven-assertion
- bracket-property-exec, dynamic-require, global-this-access, process-env-bracket, dynamic-import
- potential-exfiltration, obfuscated-code (hex + base64), env-harvesting

Anti-evasion: `stripComments()`, `joinSplitStatements()`, `countNetParens()`

### Enrichment Sanitizer (`extensions/semantic-skills/enrichment-sanitizer.ts`)

- Unicode normalization (NFC + homoglyph map + zero-width strip + fullwidth collapse)
- 8 injection patterns blocked
- Depth limits: MAX_DEPTH=4, MAX_ARRAY_LENGTH=50, MAX_STRING_LENGTH=512, MAX_ENRICHMENT_CHARS=4096

### Other Security Controls

- **Namespace Isolation**: `enforceNsPrefix()` — all queries forced to `${ns}:` prefix
- **Tool Allowlist**: Intersection model — ALL active skills must allow a tool
- **Rate Limiter**: Sliding window (1-min) per skill, default 60 calls/min
- **Query & Write Limits**: Per-skill counters + global caps
- **Enrichment Timeout**: 2s timeout via `Promise.race()`
- **Hot-Reload Security**: Atomic swap, manifest validation, downgrade block, diff logging
- **Bash Sandbox**: Command blocklists, 6 dangerous patterns, domain checking, container isolation
- **Path Traversal**: `..` rejection + `isPathInside()` double-check
- **Circuit Breaker**: 3-state (closed/open/half-open) + exponential backoff
- **Audit Logging**: Skill name + operation tagged on all sandbox writes

## Versioning

- Mayros: **v0.1.8** (package.json + extensions synced)
- Cortex: aingle_cortex **0.4.0** (`REQUIRED_CORTEX_VERSION` in `extensions/shared/cortex-version.ts`)
- Crates: aingle 0.0.101, zome_types 0.0.4
- Sync versions: update root `package.json` → `pnpm plugins:sync`

## Key Files

| File                                                    | Purpose                                                                |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `extensions/semantic-skills/index.ts`                   | Plugin entry: 6 tools, hooks, CLI, rate limiter, namespace enforcement |
| `extensions/semantic-skills/config.ts`                  | SkillSandboxConfig, VerificationConfig, clampInt                       |
| `extensions/semantic-skills/sandbox/quickjs-sandbox.ts` | QuickJS WASM sandbox core                                              |
| `extensions/semantic-skills/enrichment-sanitizer.ts`    | Injection detection + Unicode normalization                            |
| `extensions/semantic-skills/skill-loader.ts`            | Sandbox/direct loading, scan gate, enrichment sanitization             |
| `extensions/semantic-skills/skill-manifest.ts`          | Manifest parsing, DEFAULT_ALLOWED_TOOLS, validation                    |
| `extensions/semantic-skills/permission-resolver.ts`     | Tool allowlist, permission checking                                    |
| `src/security/skill-scanner.ts`                         | 16-rule scanner + preprocessing                                        |
| `extensions/shared/cortex-client.ts`                    | Unified CortexClient, DTOs                                             |
| `extensions/shared/cortex-resilience.ts`                | CircuitBreaker + resilientFetch                                        |
| `extensions/agent-mesh/index.ts`                        | Multi-agent plugin: teams, workflows, mailbox, dashboard               |
| `extensions/agent-mesh/team-manager.ts`                 | Cortex-backed team lifecycle                                           |
| `extensions/agent-mesh/workflow-orchestrator.ts`        | Workflow orchestrator + registry                                       |
| `extensions/memory-semantic/index.ts`                   | Memory plugin: rules, agent memory, contextual awareness               |
| `extensions/memory-semantic/project-memory.ts`          | ProjectMemory (code indexer integration)                               |
| `extensions/memory-semantic/rules-engine.ts`            | Hierarchical Cortex-backed rules                                       |
| `extensions/bash-sandbox/index.ts`                      | Bash sandbox plugin entry                                              |
| `extensions/interactive-permissions/index.ts`           | Permission system plugin entry                                         |
| `extensions/mcp-client/index.ts`                        | MCP client plugin (4 transports)                                       |
| `extensions/mcp-server/index.ts`                        | MCP server plugin (stdio + HTTP)                                       |
| `src/tui/vim-handler.ts`                                | Vim mode (normal/insert, motions, operators)                           |
| `src/tui/theme/palettes.ts`                             | 3 theme presets                                                        |
| `src/infra/git-worktree.ts`                             | Git worktree operations                                                |
| `src/cli/headless-cli.ts`                               | Headless runner (`mayros -p`)                                          |
| `src/cli/plan-cli.ts`                                   | Plan mode CLI                                                          |
| `src/plugins/types.ts`                                  | Plugin types, 29 hook definitions                                      |

## CLI Commands (49 modules)

```
acp, batch, browser, channels, code, completion, config, cortex, cron, daemon,
dashboard, devices, directory, dns, docs, doctor, exec-approvals, fork, gateway,
headless, hooks, kg, logs, lsp, mailbox, memory, models, node, nodes, pairing,
plan, plugins, qr, remote, rules, sandbox, search, security, serve, skills,
sync, system, tasks, teleport, trace, tui, update, webhooks, workflow
```

## Translations (i18n)

| Language        | Dir           | Status       |
| --------------- | ------------- | ------------ |
| Chinese (zh-CN) | `docs/zh-CN/` | **Complete** |
| Spanish (es)    | `docs/es/`    | Pending      |
| Japanese (ja)   | `docs/ja/`    | Pending      |
| Korean (ko)     | `docs/ko/`    | Pending      |
| Hindi (hi)      | `docs/hi/`    | Pending      |
