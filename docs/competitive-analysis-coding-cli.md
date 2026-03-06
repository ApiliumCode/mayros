# Mayros vs Claude Code vs Gemini CLI — Competitive Gap Analysis

> Date: 2026-03-06 | Branch: `fix/ui-polish` | Version: v0.1.4

---

## Lo que Mayros YA tiene y ellos NO

| Ventaja Mayros                                      | Claude Code                   | Gemini CLI                |
| --------------------------------------------------- | ----------------------------- | ------------------------- |
| 38+ extensiones con plugin SDK                      | No extensible (closed-source) | Extensions (Apache 2.0)   |
| 30+ canales (Discord, Slack, Telegram, WhatsApp...) | Solo terminal + IDE           | Solo terminal + IDE       |
| 18 capas de seguridad (QuickJS WASM sandbox)        | Seatbelt + bubblewrap         | Seatbelt + Docker         |
| 29 tipos de hooks                                   | 4 eventos + HTTP hooks        | 9+ eventos + plugin hooks |
| Agent mesh (teams, workflows, mailbox, dashboard)   | Sub-agents basicos            | Subagents experimentales  |
| Knowledge Graph (AIngle Cortex)                     | Ninguno                       | Ninguno                   |
| IoT bridge, device pairing, gateway multi-canal     | Ninguno                       | Ninguno                   |
| Rules engine, session fork/rewind                   | Ninguno                       | `/undo` basico            |
| Semantic planning con Cortex                        | Plan mode (LLM-only)          | `/plan` basico            |
| Multi-provider nativo (10+ LLM providers)           | Solo Anthropic (+ proxy)      | Solo Google (+ proxy)     |

Mayros tiene una plataforma mucho mas ambiciosa. **Pero para competir especificamente como coding CLI**, le faltan las herramientas fundamentales que hacen a Claude Code y Gemini CLI utiles para desarrollo.

---

## Feature Comparison Matrix — Detalle completo

### 1. Tool / Function Calling Surface (Built-in Tools)

#### Claude Code CLI

- **Read** — reads files (text, images, PDFs with page selection, Jupyter notebooks)
- **Write** — creates or overwrites files
- **Edit** — exact string replacement in files (requires prior Read)
- **MultiEdit** — batch multiple edits to a single file
- **Bash** — executes shell commands with sandboxing support
- **Glob** — fast file pattern matching (e.g., `**/*.ts`)
- **Grep** — regex-based content search (built on ripgrep)
- **LS** — list directory contents
- **WebFetch** — fetches and AI-processes web page content
- **WebSearch** — real-time web search for current information
- **NotebookRead / NotebookEdit** — Jupyter notebook cell read/write
- **TodoRead / TodoWrite** — task list management within sessions
- **Agent** — spawns sub-agents (with optional worktree isolation)
- **ToolSearch** — discovers and loads deferred/MCP tools dynamically
- **EnterWorktree** — creates isolated git worktrees for parallel work

**Total: ~16 built-in tools**

#### Gemini CLI

- **ReadFile** (`read_file`) — reads file contents
- **WriteFile** (`write_file`) — writes files
- **Edit** (`replace`) — string replacement in files
- **Shell** (`run_shell_command`) — executes bash/powershell commands
- **FindFiles** (`glob`) — file pattern matching
- **SearchText** (`search_file_content`) — text search in files
- **ReadFolder** (`list_directory`) — list directory contents
- **GoogleSearch** (`google_web_search`) — Google Search grounding
- **WebFetch** (`web_fetch`) — fetches web content
- **SaveMemory** (`save_memory`) — saves to GEMINI.md
- **WriteTodos** (`write_todos`) — task list management
- **Codebase Investigator Agent** — multi-step code analysis sub-agent

**Total: ~12 built-in tools**

#### Mayros

- `web-search` — Search the web
- `web-fetch` — Fetch and parse web content with Readability/Firecrawl support
- `browser-tool` — Headless browser automation (Playwright)
- `image-tool` — Vision model image analysis (multi-provider support)
- `canvas-tool` — Draw diagrams/charts
- `tts-tool` — Text-to-speech
- `cron-tool` — Schedule tasks with cron syntax
- `message-tool` — Send messages to other channels
- `gateway-tool` — Call other gateway methods
- `sessions-send-tool` — Send messages to sessions (A2A)
- `sessions-list-tool` — List active sessions
- `sessions-history-tool` — Query session history
- `sessions-spawn-tool` — Create new sessions
- `session-status-tool` — Check session status
- `agents-list-tool` — List available agents
- `subagents-tool` — Delegate to sub-agents
- `nodes-tool` — Control IoT nodes
- `memory-tool` — Semantic memory queries
- `agent-step` — Multi-step agent planning

**Total: ~19 tools (platform-oriented, no local file tools)**

**Key Differences**: Claude Code has dedicated Jupyter notebook tools, a separate MultiEdit tool, explicit ToolSearch for dynamic tool loading, and a first-class worktree tool. Gemini CLI has native Google Search grounding (using Google's own search index). **Mayros has more total tools but none for local file manipulation** — all are platform/agent-oriented.

---

### 2. TUI Features

#### Claude Code CLI

- Markdown rendering with syntax highlighting in terminal output
- Vim mode (`/vim` command — insert/normal mode with motions and operators)
- ANSI color theme support
- Prompt suggestions/autocomplete
- Ctrl+O transcript mode (shows real-time thinking blocks)
- Ctrl+R to re-enter previous prompts
- Shift+Tab to cycle permission modes
- `/context` to visualize token usage with bar charts
- File references via `@file` mentions
- Diff display for proposed changes
- Session teleportation (`/teleport`) — resume web sessions locally
- `/desktop` — hand off to Desktop app
- Custom powerline/statusline via community tools

#### Gemini CLI

- Markdown rendering in terminal output
- `!` prefix toggles shell mode (direct shell access from within CLI)
- Screen reader mode for accessibility
- `/settings` interactive settings editor
- `@file` references for context injection
- `/undo` command with checkpoint restoration
- Theme customization via terminal/settings
- No native vim mode
- No native diff viewer built into TUI
- IDE companion integration for VS Code (syncs terminal and editor)

#### Mayros

- Markdown rendering with syntax highlighting (`@mariozechner/pi-tui`)
- Vim mode (`/vim` — insert/normal with motions/operators/undo)
- Theme system (dark/light/high-contrast) with factory pattern
- Keybinding customization (`keybinding-resolver.ts`)
- Enriched autocomplete (Cortex-backed symbol completion)
- Diff viewer with stats (`/diff`)
- Context visualization with bar charts (`/context`)
- Output style modes (standard/explanatory/learning — `/style`)
- Local shell bash mode (`tui-local-shell.ts`)
- Clipboard image support
- Path linkification (OSC 8 clickable links)
- 30+ slash commands
- Settings overlay
- Session actions, overlays/modals
- Searchable/filterable select lists

**Key Differences**: Mayros and Claude Code have very similar TUI richness (vim mode, diff viewing, context visualization, themes). Gemini CLI has a simpler TUI. Mayros has enriched autocomplete and output style modes that neither competitor has. Claude Code uniquely has session teleportation across surfaces. Gemini CLI has screen reader accessibility mode.

---

### 3. Context Management

#### Claude Code CLI

- **CLAUDE.md files** — hierarchical instructions: `~/.claude/CLAUDE.md` (global), project root, subdirectories
- **Auto-compact** — triggers at ~98% context usage, intelligently summarizes conversation history
- **Manual /compact** — with optional instructions for what to preserve
- **CLAUDE.md survives compaction** — re-read from disk after compact
- **Prompt caching** — enabled by default, reduces repeated context costs
- **1M token context window** (Opus 4.6 fast mode)
- **/context** — visualize current token usage breakdown
- **Auto-memory** — `~/.claude/memory/MEMORY.md` persists across conversations
- **add-dir** — `/add-dir` to include additional directories in context

#### Gemini CLI

- **GEMINI.md files** — hierarchical: `~/.gemini/GEMINI.md` (global), project root, subdirectories
- **Modular imports** — `@file.md` syntax to break large context files into components
- **Configurable filename** — `context.fileName` setting to use custom names
- **/memory commands** — `/memory show`, `/memory refresh`, `/memory add`
- **/compress** — manual context compression (has known issues with large contexts)
- **Token caching** — automatic with API key auth (not OAuth)
- **1M token context window** (Gemini 3 Flash / 3.1 Pro)
- **/stats** — shows token usage and cached savings

#### Mayros

- **Per-session transcript storage** (`sessions/transcript.ts`)
- **Session metadata** (created, last accessed, etc.)
- **Session groups** (organize related sessions)
- **Smart compaction** (`compaction-extractor.ts`) — extracts key findings before compression
- **Cross-session recall** — enhanced `before_prompt_build` hook
- **Project memory** (`project-memory.ts`) — Cortex-backed project knowledge
- **Session fork/rewind** (`session-fork.ts`) — checkpoint system
- **History limit configuration** (default: 200 messages)
- **No hierarchical instruction file** (no MAYROS.md equivalent)

**Key Differences**: Both Claude Code and Gemini CLI have hierarchical instruction files (CLAUDE.md / GEMINI.md) that auto-inject into every prompt — **Mayros lacks this**. Mayros has smarter compaction (extracts findings before compressing) and cross-session recall via Cortex, which neither competitor has. Gemini CLI's `@import` syntax for modular context files is unique.

---

### 4. Permission System

#### Claude Code CLI

- **5 permission modes**: Default (ask), AcceptEdits, Plan (exploration only), DontAsk (full auto), BypassPermissions (isolated environments)
- **Shift+Tab** cycling between modes in TUI
- **Wildcard tool permissions** — e.g., `Bash(npm *)`, `Bash(*-h*)`
- **Settings-based allowlists/denylists** in `settings.json`
- **Per-project and per-user** permission configurations
- **Managed policies** — enterprise/MDM-level policy enforcement
- **Sandbox + permissions** — layered defense

#### Gemini CLI

- **3 approval modes**: Default (prompt each), Auto-edit (auto-approve edits only), YOLO (approve all)
- **--yolo flag** or **Ctrl+Y** to enable auto-approve
- **Tool allowlist** — specific tool+argument patterns bypass confirmation
- **Tool excludeTools** — denylist for blocking specific tools
- **MCP server allowlist/denylist**
- **Enterprise policy** — can disable YOLO mode at policy level
- **Settings-based** in `settings.json` (project and user levels)

#### Mayros

- **Interactive permission system** (`extensions/interactive-permissions/`)
- **Intent classifier** — classifies tool call intent before prompting
- **Policy store** — persistent permission policies
- **Cortex-based audit logging** — all permission decisions logged to KG
- **Permission modes**: auto/ask/deny (`/permission` command + Shift+Tab cycling)
- **Tool allowlist/blocklist** (intersection model for skills)
- **18-layer security** including QuickJS WASM sandbox, 16-rule scanner, enrichment sanitizer, namespace isolation, rate limiter
- **Hot-reload security** with atomic swap and downgrade blocking

**Key Differences**: Mayros has the most comprehensive security architecture by far (18 layers vs. Claude Code's ~3 and Gemini's ~3). Intent classification for permissions is unique to Mayros. Claude Code has managed/MDM enterprise policies. Gemini CLI's YOLO mode is the simplest auto-approve.

---

### 5. MCP Server/Client Support

#### Claude Code CLI

- Full MCP client support — connects to external MCP servers
- **300+ external service integrations**
- Pre-configured OAuth for servers without Dynamic Client Registration
- `.mcp.json` files (project-level) and `~/.claude.json` (user-level)
- Can act as an MCP server itself (via `claude-code-mcp`)
- MCP tools appear alongside built-in tools
- `/mcp` command to manage/disable servers

#### Gemini CLI

- Full MCP client support — connects to local and remote MCP servers
- Configuration in `.gemini/settings.json`
- MCP server allowlist/denylist for security
- Extension-level MCP configuration
- Google-provided MCP extensions for Cloud SQL, AlloyDB, BigQuery
- Browsable extensions directory at `geminicli.com/extensions/`

#### Mayros

- **Multi-transport MCP client** (`extensions/mcp-client/`) — stdio, SSE, HTTP
- **Tool bridge** to Mayros tools
- **Cortex tool registry** integration
- **Session management**
- **Tools**: `mcp_connect`, `mcp_disconnect`, `mcp_list_tools`, `mcp_call_tool`
- **CLI**: `mayros mcp connect|disconnect|list|tools|status`

**Key Differences**: All three have solid MCP client support. Claude Code uniquely can also act AS an MCP server. Gemini CLI has a browsable marketplace. Mayros bridges MCP tools into its Cortex registry, which is unique.

---

### 6. Model Provider Support

#### Claude Code CLI

- **Native**: Anthropic (Claude Opus 4.6, Haiku, Sonnet)
- **Cloud providers**: Amazon Bedrock, Google Vertex AI, Microsoft Azure/Foundry
- **Third-party routing**: Via LiteLLM proxy, OpenRouter
- **Not natively multi-provider** — requires proxy layer for non-Anthropic models

#### Gemini CLI

- **Native**: Google Gemini models only (Gemini 3 Flash, Gemini 3.1 Pro, etc.)
- **Third-party via LiteLLM**: Can route to Anthropic, OpenAI, Bedrock, etc.
- **No official non-Google model support**

#### Mayros

- **OpenAI** (GPT-4, GPT-4o, GPT-3.5, GPT-4-vision)
- **Anthropic** (Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku)
- **Google** (Gemini 1.5, Gemini Pro)
- **Amazon Bedrock** (multi-model)
- **GitHub Copilot**
- **Groq, Replicate, Together AI, Mistral, Minimax, Qwen**
- **Custom/local models** via gateway
- **Model alias defaults** and fallbacks
- **Prompt caching support** (Claude)

**Key Differences**: **Mayros wins decisively here** with 10+ native providers vs. Claude Code (1 + proxy) and Gemini CLI (1 + proxy). Model switching is a first-class feature.

---

### 7. Authentication Methods

#### Claude Code CLI

- Claude.ai subscription (Pro/Max) — OAuth 2.0 with PKCE
- API key — `ANTHROPIC_API_KEY`
- `apiKeyHelper` — custom shell script for dynamic key retrieval
- Amazon Bedrock — AWS credentials
- Google Vertex AI — GCP credentials
- Microsoft Azure/Foundry — Azure env vars
- Enterprise SSO
- `claude auth login/status/logout`

#### Gemini CLI

- Google account — OAuth login via browser
- Gemini API key — `GEMINI_API_KEY`
- Google Cloud API key — `GOOGLE_API_KEY`
- Application Default Credentials (ADC)
- Service accounts — JSON key file
- Cloud Shell — automatic auth
- Compute Engine — automatic ADC

#### Mayros

- **API key management** (`model-auth.ts`) per provider
- **Auth profile store** (keychain integration)
- **OAuth/OIDC** for various providers (configured in extensions)
- **Device pairing** (`extensions/device-pair/`)
- **Google Gemini CLI auth** (`extensions/google-gemini-cli-auth/`)
- **Minimax, Qwen portal auth** (dedicated extensions)
- **WebSocket token-based** authentication
- **Password-based** authentication (optional)
- **TLS/WSS** support

**Key Differences**: Mayros supports the widest range of auth methods due to its multi-provider architecture. Claude Code has enterprise SSO. Gemini CLI has deep Google Cloud integration.

---

### 8. IDE Integrations

#### Claude Code CLI

- **VS Code extension** — native chat panel, checkpoint undo, `@file` references, `@terminal` output, parallel conversations, diff viewer
- **JetBrains plugin** (Beta) — IntelliJ IDEA, WebStorm, PyCharm; diff viewer, automatic error/warning piping
- **Desktop app** — hand off sessions via `/desktop`
- **Web/Mobile** — remote sessions via `/teleport`

#### Gemini CLI

- **VS Code** — via Gemini Code Assist extension + IDE companion plugin
- **JetBrains** — via Gemini Code Assist
- **IDE companion spec** — documented protocol for third-party integration
- **No desktop app or mobile continuation**

#### Mayros

- **VSCode Extension** (`tools/vscode-extension/`) — Tree views (Sessions, Agents, Skills), Webview panels (Chat, Plan, KG, Trace), code actions, gutter markers, real-time status
- **JetBrains Plugin** (`tools/jetbrains-plugin/`) — in development
- **No desktop app or mobile continuation**

**Key Differences**: Claude Code uniquely supports cross-surface session teleportation (terminal to web to mobile to desktop). Mayros's VS Code extension has KG and Trace panels that neither competitor has. Gemini CLI has a documented IDE companion protocol for third-party integration.

---

### 9. Streaming and Extended Thinking

#### Claude Code CLI

- **Streaming by default** — output appears as generated
- **Extended thinking** — enabled by default with 31,999 token budget
- **Configurable thinking budget** — `MAX_THINKING_TOKENS` env var
- **Ctrl+O** — real-time thinking block display
- **Effort levels** — adjustable for Opus 4.6

#### Gemini CLI

- **Streaming by default**
- **Thinking/reasoning** — Gemini 3 models include thinking capabilities
- **No configurable thinking budget** documented
- **No explicit toggle** in CLI interface

#### Mayros

- **WebSocket-based streaming** (chat.delta, chat.final, chat.error)
- **SSE support**
- **TUI stream assembler** (`tui-stream-assembler.ts`)
- **Thinking display control** (on/off/verbose — `/reasoning`, `/think`)
- **Real-time token counting**
- **Progressive rendering**

**Key Differences**: Claude Code has the most mature extended thinking with configurable budgets and real-time visualization. Mayros has good streaming but thinking budget configuration depends on provider support.

---

### 10. Cost / Token Tracking

#### Claude Code CLI

- `/cost` — shows API token usage
- `/context` — breakdown by category
- Prompt caching enabled by default
- Community tools: `ccusage`, `Claude-Code-Usage-Monitor`
- Max subscription — flat-rate option

#### Gemini CLI

- `/stats` — session statistics, token usage, cached savings
- `/stats model` — quota snapshot
- Token caching with API key auth
- **Free tier** — 60 req/min, 1,000 req/day at no charge (1M context)

#### Mayros

- **Input/output token counts** (`usage.ts`)
- **Cache read/write tokens**
- **Session total accumulation**
- **Context token usage percentage**
- **Per-response usage display** (off/tokens/full — `/usage`)
- **Token economy extension** (`extensions/token-economy/`) — budget tracking, prompt cache

**Key Differences**: Gemini CLI has a very generous free tier (1,000 req/day with 1M context). Mayros has a dedicated token economy extension for budget management. Claude Code has better community tooling for usage analysis.

---

### 11. Headless / Non-Interactive Mode

#### Claude Code CLI

- `claude -p "query"` — non-interactive prompt
- Pipe support — `echo "fix bug" | claude`
- Streaming JSON-lines output
- Hooks supported in headless
- CI/CD integration — usable in GitHub Actions
- Background execution

#### Gemini CLI

- `gemini "query"` — positional argument headless
- Non-TTY auto-detection
- Text or JSON output modes
- **Official GitHub Action** — `google-github-actions/run-gemini-cli`
- CI/CD designed for automation

#### Mayros

- `mayros -p "query"` — headless mode (`headless-cli.ts`)
- Stdin piping support
- JSON-lines streaming output
- Session key override
- `mayros batch run <file>` — batch processing (JSONL or `---` separated)
- Configurable concurrency

**Key Differences**: All three have solid headless modes. Gemini CLI has an official GitHub Action. Mayros uniquely has built-in batch processing with concurrency control. Claude Code has background execution.

---

### 12. Git Integration

#### Claude Code CLI

- Automatic `git log`, `git diff`, `git branch` context awareness
- Commit generation — understands branch, creates commits
- PR creation — `/create-pr` skill, GitHub CLI integration
- PR review — `/install-github-app` for automatic PR reviews
- **First-class worktrees** — `EnterWorktree` tool, isolation for parallel work
- Branch management via natural language

#### Gemini CLI

- Git command execution via Shell tool
- Commit generation via shell or community tools
- PR creation via GitHub MCP or shell
- PR review via `run-gemini-cli` GitHub Action
- No first-class worktree support
- Branch management via shell

#### Mayros

- **Git worktree management** (`git-worktree.ts`) — create/remove/list/prune/find
- **Git commit hash resolution** (`git-commit.ts`)
- **Git root detection** (`git-root.ts`)
- `/diff` command shows diffs
- Git context available to agents
- **No git-as-tool** for the coding agent (worktrees are infrastructure, not agent tools)

**Key Differences**: Claude Code has the deepest git integration with first-class worktree tools AND automatic PR reviews. Mayros has worktree infrastructure but it's not exposed as an agent tool for the coding flow. Gemini CLI relies entirely on shell commands.

---

### 13. Sub-Agents / Background Agents / Parallel Execution

#### Claude Code CLI

- **Agent tool** — spawns sub-agents for focused subtasks
- **Worktree isolation** — `isolation: worktree` for parallel non-conflicting work
- **Background execution** — `run_in_background: true`
- **Concurrent sub-agents** — multiple running simultaneously
- **Custom agents** — `.claude/agents/` with Markdown frontmatter
- `/batch` — large-scale parallel changes
- **Agent SDK** — `@anthropic-ai/claude-agent-sdk` (TS + Python)

#### Gemini CLI

- **Subagents (experimental)** — specialist agents with custom system prompts
- **Remote subagents** — Agent-to-Agent (A2A) protocol for remote services
- **Isolated agents** — separate `gemini-cli` instances
- No native background task tracking
- Extensions-based agent definitions

#### Mayros

- **Agent mesh** (`extensions/agent-mesh/`) — full multi-agent coordination
- **Team manager** — Cortex-backed team lifecycle
- **Workflow orchestrator** — 3 built-in workflow definitions + registry
- **Background tracker** — Cortex-backed task tracking
- **Agent mailbox** — persistent inter-agent messaging
- **Team dashboard** — aggregated team status
- **Markdown agents** — `.mayros/agents/` with markdown definitions
- **Subagents tool** — delegate to sub-agents
- **Session spawning** — create new sessions for agents
- **Worktree infrastructure** — available but not tool-level for agents

**Key Differences**: **Mayros has the most sophisticated multi-agent system** with team management, workflow orchestration, mailbox, and dashboard. Claude Code's Agent SDK is the most developer-friendly for programmatic use. Gemini's A2A protocol for remote agent delegation is forward-looking and unique.

---

### 14. Hooks System

#### Claude Code CLI

- **PreToolUse** — before tool execution; can allow/deny/ask
- **PostToolUse** — after tool execution
- **UserPromptSubmit** — before prompt processing
- **Stop / SubagentStop** — when agent/subagent completes
- **HTTP hooks** — POST JSON to URL with JSON response
- **Scoped hooks** — in skills/agents frontmatter
- Configuration in `settings.json`

#### Gemini CLI

- **BeforeTool / AfterTool** — tool lifecycle
- **BeforeAgent / AfterAgent** — agent lifecycle
- **SessionStart / SessionEnd** — session lifecycle
- **PreCompress** — before context compression
- **BeforeModel / AfterModel** — before/after model calls
- **BeforeToolSelection** — before tool selection
- **Command hooks** — shell command execution
- **Plugin hooks** — npm packages
- Enabled by default since v0.26.0

#### Mayros

- **29 hook types** including:
  - `before_prompt_build` — modify prompt before LLM call
  - `after_response` — process response
  - `before_tool_call` — authorize/modify tool calls
  - `after_tool_result` — process tool results
  - `permission_request` — override permissions
  - `notification` — system notifications
  - `config_change` — config mutations
  - `before_compaction` — pre-compaction processing
  - `agent_end` — agent session completion
  - `teammate_idle` — team coordination
  - `task_completed` — task completion event
- **HTTP hook dispatcher** — HMAC-SHA256 signatures, retry + backoff, dead-letter queue
- **Async hook queue** — background execution, concurrency limits
- **LLM hooks** — LLM-based condition evaluation

**Key Differences**: **Mayros has by far the most hook types (29)** vs. Gemini (9+) and Claude Code (4). Mayros uniquely has LLM-evaluated hooks and HTTP hooks with HMAC signatures. Gemini has more lifecycle hook points (BeforeModel, AfterModel). Claude Code has scoped hooks in skills.

---

### 15. Image / Multimodal Support

#### Claude Code CLI

- Image reading — Read tool displays images visually (PNG, JPG)
- PDF reading — Read tool with page selection (`pages: "1-5"`)
- Jupyter notebooks — dedicated NotebookRead/NotebookEdit
- No audio/video
- `@image.png` references

#### Gemini CLI

- Image analysis — `@image.png` processed by multimodal model
- PDF processing — `@report.pdf` with text extraction
- **Audio** — `@audio.mp3` with speech-to-text
- **Video** — video understanding capabilities
- MCP image limitations (cannot see base64 in tool results)

#### Mayros

- **Vision model image analysis** (`image-tool.ts`) — multi-provider support
- **Data URL decoding** (base64 images)
- **Image file loading** from local filesystem
- **Multiple image support** (up to 20)
- **Clipboard image pasting** in TUI
- **Auto image injection** in prompts (`detect-and-load-prompt-images`)
- **Canvas/drawing tool** — diagram generation
- **TTS tool** — text-to-speech output

**Key Differences**: Gemini CLI has the broadest multimodal support (audio, video). Claude Code has Jupyter and PDF page selection. Mayros has canvas drawing and TTS that neither competitor offers. All three support image analysis.

---

### 16. Notebook (Jupyter) Support

| Feature        | Claude Code                            | Gemini CLI         | Mayros |
| -------------- | -------------------------------------- | ------------------ | ------ |
| Read notebook  | First-class `NotebookRead`             | Read as JSON       | No     |
| Edit cells     | `NotebookEdit` (replace/insert/delete) | Via shell commands | No     |
| Cell-level ops | Yes (code + markdown types)            | No                 | No     |

---

### 17. SDK / API for Building Custom Agents

#### Claude Code CLI

- **Claude Agent SDK** — `@anthropic-ai/claude-agent-sdk` (TypeScript), `claude-agent-sdk` (Python)
- Full programmatic access to runtime
- Custom tools (in-process MCP servers)
- Hooks, subagents, sessions, cost tracking
- SDK powers Claude Code itself

#### Gemini CLI

- **Open-source codebase** — Apache 2.0, full source on GitHub
- **SDK & Custom Skills** — v0.30.0; dynamic system instructions, SessionContext
- **npm package** — `@google/gemini-cli`
- **Extensions framework** — `gemini-extension.json` manifest
- **Plugin hooks** — npm packages with `geminicli-plugin` label
- **No standalone agent SDK library**

#### Mayros

- **Plugin SDK** — `mayros/plugin-sdk` with TypeBox params
- **38+ extensions** demonstrating SDK usage
- **Hooks, tools, commands, configuration** registration
- **Semantic skills SDK** with QuickJS WASM sandbox
- **No standalone agent SDK** outside the gateway

**Key Differences**: Claude Code has the most developer-friendly standalone Agent SDK. Gemini CLI being Apache 2.0 open-source is a major differentiator (anyone can fork). Mayros has the richest plugin ecosystem but no standalone SDK for use outside the gateway.

---

### 18. Slash Commands

#### Claude Code CLI (~23 built-in)

`/help`, `/clear`, `/compact`, `/context`, `/memory`, `/model`, `/config`, `/cost`, `/vim`, `/permissions`, `/status`, `/resume`, `/rename`, `/stats`, `/teleport`, `/desktop`, `/hooks`, `/batch`, `/simplify`, `/mcp`, `/agents`, `/init`, `/add-dir`

- Custom commands: `.claude/commands/` (Markdown files)
- Skills as commands: `.claude/skills/` — unified with slash commands
- Auto-invocation by model

#### Gemini CLI (~10 built-in)

`/help`, `/bug`, `/undo`, `/settings`, `/memory show|refresh|add`, `/stats`, `/stats model`, `/compress`, `/model`, `/ide enable`, `/plan`

- Custom commands: `.gemini/commands/` (TOML format)
- Parameterizable prompts
- Extension-defined commands

#### Mayros (~35 built-in)

`/help`, `/status`, `/agent`, `/session`, `/model`, `/think`, `/verbose`, `/reasoning`, `/usage`, `/elevated`, `/activation`, `/theme`, `/diff`, `/context`, `/style`, `/vim`, `/permission`, `/fast`, `/copy`, `/export`, `/abort`, `/new`, `/settings`, `/plan`, `/kg`, `/trace`, `/team`, `/tasks`, `/workflow`, `/rules`, `/mailbox`, `/batch`, `/teleport`, `/sync`, `/onboard`, `/exit`

- Custom commands: `.mayros/commands/` (Markdown files)
- Gateway-provided custom commands
- User-defined markdown commands

**Key Differences**: **Mayros has the most slash commands (~35)** vs. Claude Code (~23) and Gemini CLI (~10). Mayros has unique commands for KG, team, workflow, rules, mailbox. Claude Code has unique `/teleport`, `/desktop`, `/simplify`. Gemini has `/undo` and `/bug`.

---

### 19. Configuration System

#### Claude Code CLI

- `settings.json` — user and project levels
- `CLAUDE.md` — instructions (hierarchical)
- `.mcp.json` — MCP server config
- Environment variables — extensive
- Managed settings — server-managed, MDM/OS-level policies
- `/config` — interactive TUI configuration
- `apiKeyHelper` — dynamic key retrieval

#### Gemini CLI

- `settings.json` — user and project levels
- `GEMINI.md` — context files (hierarchical, configurable filename)
- `gemini-extension.json` — extension configuration
- Environment variables
- Multi-layer merging
- `/settings` — interactive editor
- Sandbox profiles

#### Mayros

- `mayros.json` (or `mayros.yaml`) — comprehensive config
- Agents, models, channels, plugins, gateway, hooks, UI sections
- YAML/JSON support
- Environment variable substitution
- Config validation with Zod schemas
- Plugin auto-enable
- Sensitive data redaction
- Backup rotation
- **No hierarchical instruction file** (critical gap)

**Key Differences**: Mayros has the most comprehensive config schema (agents, channels, plugins, gateway, hooks). Both competitors have hierarchical instruction files that Mayros lacks. Gemini CLI supports configurable context filenames.

---

### 20. Security Features

#### Claude Code CLI

- macOS Seatbelt — filesystem and network sandbox
- Linux bubblewrap — container-like isolation
- 5 permission modes + wildcard rules + managed policies
- Layered defense — permissions + sandbox
- 84% reduction in permission prompts with sandboxing
- Enterprise MDM/policy support

#### Gemini CLI

- macOS Seatbelt — 5 built-in profiles
- Docker/Podman — container-based isolation
- Custom sandbox profiles
- Filesystem/network restrictions
- Enterprise policy — can disable YOLO mode
- Open-source — full code inspection (Apache 2.0)

#### Mayros (18 layers)

1. **QuickJS WASM sandbox** — skills run in isolated WASM
2. **16-rule static scanner** — dangerous-exec, dynamic-code, crypto-mining, etc.
3. **Anti-evasion preprocessing** — strip comments, join split statements
4. **Enrichment sanitizer** — Unicode normalization, 8 injection patterns
5. **Namespace isolation** — forced prefix on all queries
6. **Tool allowlist** — intersection model (ALL skills must allow)
7. **Rate limiter** — sliding window per skill (60/min default)
8. **Query & write limits** — per-skill counters
9. **Enrichment timeout** — 2s Promise.race
10. **Hot-reload security** — atomic swap, manifest validation, downgrade block
11. **Path traversal protection** — reject `..` + `isPathInside()`
12. **Verify-then-promote** — temp extract, verify hashes, promote
13. **Circuit breaker** — 3-state with exponential backoff
14. **Audit logging** — skill name + operation on all writes
15. **No default AssertionEngine** — fails without declared engine
16. **Per-request skill tracking** — round-robin for multi-skill
17. **Interactive permissions** — intent classification + policy store
18. **HTTP hook signatures** — HMAC-SHA256 on webhooks

**Key Differences**: **Mayros's security architecture is vastly more comprehensive** than either competitor. The WASM sandbox + static scanner + enrichment sanitizer is unique. Claude Code's Seatbelt+bubblewrap and Gemini's Docker profiles are OS-level only. Mayros operates at the application layer with 18 defense layers.

---

## Gap Analysis — What Mayros Needs to Compete as Coding CLI

### TIER 1 — Bloqueante (sin esto no se compite)

#### 1. Local File Tools (Read / Write / Edit / Glob / Grep)

**El gap mas critico.** Ambos competidores tienen esto como nucleo:

| Tool           | Claude Code                         | Gemini CLI            | Mayros |
| -------------- | ----------------------------------- | --------------------- | ------ |
| Read file      | `Read` (text, image, PDF, notebook) | `read_file`           | **NO** |
| Write file     | `Write`                             | `write_file`          | **NO** |
| Edit file      | `Edit` + `MultiEdit`                | `replace`             | **NO** |
| Find files     | `Glob` (fast pattern matching)      | `glob`                | **NO** |
| Search content | `Grep` (ripgrep-based)              | `search_file_content` | **NO** |
| List directory | `LS`                                | `list_directory`      | **NO** |

Mayros tiene `browser-tool`, `web-fetch`, `image-tool`, `memory-tool` — todos orientados a plataforma, ninguno a manipulacion de archivos locales.

**Implementacion estimada**: Nueva extension `extensions/code-tools/` con 6-7 tools:

- `code_read` — leer archivos (text, image, PDF)
- `code_write` — crear/sobreescribir archivos
- `code_edit` — reemplazo exacto de strings (requiere previo read)
- `code_glob` — busqueda de archivos por pattern
- `code_grep` — busqueda de contenido (regex) con ripgrep
- `code_ls` — listar directorios

#### 2. Shell/Bash Tool (ejecucion de comandos)

Claude Code tiene `Bash`, Gemini tiene `run_shell_command`. Mayros tiene `bash-sandbox` pero para sandboxing de skills, no como herramienta del agente para el usuario.

**Implementacion**: Tool `code_shell` que ejecuta comandos con:

- Timeout configurable
- Background execution
- Working directory persistence
- Integracion con `bash-sandbox` para sandboxing

#### 3. Archivo de instrucciones jerarquico (`.mayros/MAYROS.md`)

Claude Code tiene `CLAUDE.md` (global -> proyecto -> subdirectorio). Gemini tiene `GEMINI.md`. Estos archivos se inyectan automaticamente en cada prompt.

Mayros tiene markdown agents y markdown commands, pero **no tiene un archivo de instrucciones de proyecto** que se inyecte automaticamente en cada conversacion del coding CLI.

**Implementacion**: Hook `before_prompt_build` que busca y carga:

- `~/.mayros/MAYROS.md` (global)
- `./MAYROS.md` o `.mayros/MAYROS.md` (proyecto)
- Subdirectory-level MAYROS.md

#### 4. Auto-compaction inteligente

Claude Code auto-compacta al 98% del contexto. Mayros tiene `compaction-extractor.ts` pero no es claro que se dispare automaticamente con un threshold.

**Implementacion**: Trigger automatico en el loop de agente cuando `tokens_used / context_window > 0.95`.

---

### TIER 2 — Importante (diferenciadores clave)

#### 5. Diff preview antes de aplicar cambios

Claude Code muestra un diff visual antes de escribir archivos. Gemini muestra cambios propuestos. Mayros tiene `diff-renderer.ts` pero no esta integrado en el flujo de tool execution.

**Implementacion**: Cuando `code_write` o `code_edit` se ejecutan, mostrar diff en el TUI antes de confirmar.

#### 6. Checkpoint / Undo de acciones

Claude Code tiene worktree-based undo. Gemini tiene `/undo` con checkpoints. Mayros tiene `session-fork.ts` pero no tiene undo granular de operaciones de archivo.

**Implementacion**: Git-stash o snapshot antes de cada escritura, con `/undo` que restaura.

#### 7. `@file` mentions en prompts

Ambos competidores permiten `@archivo.ts` en el prompt para inyectar contenido del archivo al contexto.

**Implementacion**: Parser en `custom-editor.ts` que detecta `@path` y lo resuelve al contenido del archivo.

#### 8. Token cost display integrado en TUI

Claude Code tiene `/cost` y `/context` con visualizacion de barras. Mayros tiene `usage.ts` y `context-visualizer.ts`. Verificar que esten wired end-to-end en la TUI con datos reales.

#### 9. GitHub App / PR review automatico

Claude Code tiene `/install-github-app` para review automatico de PRs. Gemini tiene GitHub Action oficial.

**Implementacion**: GitHub Action o App que invoque `mayros -p` sobre diffs de PR.

---

### TIER 3 — Polish competitivo

#### 10. Jupyter notebook tools

Claude Code tiene `NotebookRead/NotebookEdit` first-class. Ni Gemini ni Mayros lo tienen nativo.

#### 11. PDF reading con seleccion de paginas

Claude Code puede leer PDFs con `pages: "1-5"`.

#### 12. Session teleportation

Claude Code tiene `/teleport` (terminal -> web -> mobile -> desktop). Feature unica.

#### 13. Audio/video understanding

Gemini tiene esto nativamente por capacidad del modelo. Depende del provider.

#### 14. Agent SDK standalone

Claude Code tiene `@anthropic-ai/claude-agent-sdk` (TypeScript + Python). Mayros tiene plugin SDK pero no un SDK standalone para construir agentes programaticamente fuera del gateway.

---

## Resumen visual

```
                        Claude Code    Gemini CLI     Mayros
File tools (R/W/E)      ████████████   ████████████   ░░░░░░░░░░░░  <- #1 gap
Shell/Bash tool         ████████████   ████████████   ░░░░░░░░░░░░  <- #2 gap
Project instructions    ████████████   ████████████   ██░░░░░░░░░░  <- #3 gap
Auto-compaction         ████████████   ██████░░░░░░   ████████░░░░
Diff preview            ████████████   ████████████   ████░░░░░░░░
@file mentions          ████████████   ████████████   ░░░░░░░░░░░░
Undo/checkpoint         ████████████   ████████████   ████░░░░░░░░
Multi-provider          ██████░░░░░░   ████░░░░░░░░   ████████████  <- Mayros gana
Plugin ecosystem        ░░░░░░░░░░░░   ████████░░░░   ████████████  <- Mayros gana
Security layers         ████████░░░░   ████████░░░░   ████████████  <- Mayros gana
Multi-channel           ░░░░░░░░░░░░   ░░░░░░░░░░░░   ████████████  <- Mayros gana
Agent orchestration     ████████░░░░   ████░░░░░░░░   ████████████  <- Mayros gana
Knowledge graph         ░░░░░░░░░░░░   ░░░░░░░░░░░░   ████████████  <- Mayros gana
Hooks (# types)         ████░░░░░░░░   ██████████░░   ████████████  <- Mayros gana
Slash commands          ████████████   ██████░░░░░░   ████████████  <- Mayros gana
TUI richness            ████████████   ████████░░░░   ████████████  <- Mayros empata
```

---

## Bottom Line

Los 3 gaps de Tier 1 (file tools, shell tool, project instructions) son los que impiden a Mayros competir como coding CLI. Todo lo demas ya lo tiene igual o mejor. Si se implementan esos 3, Mayros tendria la plataforma de coding CLI mas completa del mercado gracias a todo lo que ya tiene por debajo (multi-provider, 38 extensiones, 18 capas de seguridad, agent mesh, KG).

La estrategia optima es: **cerrar los 3 gaps de Tier 1, luego los 5 de Tier 2** — con eso Mayros seria competitivo no solo como coding CLI, sino como la unica plataforma que ademas ofrece multi-canal, multi-provider, orquestacion de equipos, y knowledge graph.
