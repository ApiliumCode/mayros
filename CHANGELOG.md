# Changelog

Product: https://apilium.com/us/products/mayros
Download: https://mayros.apilium.com
Docs: https://apilium.com/us/doc/mayros

## 0.2.1 (2026-03-14)

Memory health tools — conflict detection and digest summaries for proactive memory maintenance.

### MCP Server

- `mayros_memory_conflicts` — scan for duplicate memories and graph-level contradictions (same subject+predicate, different values)
- `mayros_memory_digest` — summarize memory state: total count, category distribution, recent entries, DAG stats
- Parallel fetching in digest tool (content, categories, graph stats, DAG stats via `Promise.all`)
- Both tools degrade gracefully when Cortex is down or DAG is disabled

### CLI

- `mayros memory conflicts` — scan Cortex for contradictions and duplicates (supports `--json`, `--limit`)
- `mayros memory digest` — summarize stored memories with categories and recency (supports `--json`, `--limit`)
- Both commands support `--cortex-host`, `--cortex-port`, `--cortex-token` flags

### Tests

- 13 new tests for memory health tools (duplicates, graph conflicts, empty state, Cortex down, limit capping, sort order, DAG disabled)

---

## 0.2.0 (2026-03-13)

Semantic DAG integration — full audit trail, time-travel, and verifiable history for the knowledge graph.

### Semantic DAG

- 12 new CortexClient methods: `dagTips`, `dagAction`, `dagHistory`, `dagChain`, `dagStats`, `dagPrune`, `dagAt`, `dagDiff`, `dagExport`, `dagSync`, `dagSyncPull`, `dagVerify`
- DAG DTOs: `DagActionDto` (with `signature` field), `DagTipsResponse`, `DagStatsResponse`, `DagTimeTravelResponse`, `DagDiffResponse`, `DagPruneRequest/Response`, `DagSyncRequest/Response`, `DagPullRequest/Response`, `DagVerifyResponse`
- `DagSyncResponse.actions` properly typed as `DagActionDto[]`

### MCP Server

- 10 new DAG tools: `mayros_dag_tips`, `mayros_dag_action`, `mayros_dag_chain`, `mayros_dag_history`, `mayros_dag_time_travel`, `mayros_dag_diff`, `mayros_dag_export`, `mayros_dag_stats`, `mayros_dag_verify`, `mayros_dag_prune`
- 2 new DAG resources: `mayros:///dag/tips`, `mayros:///dag/stats`
- 1 new prompt: `dag-audit` — guided audit workflow with history, verification, and diff
- Total MCP tools: 19
- All MCP tools now have 30s request timeout (`AbortSignal.timeout`)
- `mayros_memory_stats` fetches 3 endpoints in parallel (`Promise.allSettled`)
- `mayros_remember` stores triples + Ineru entry in parallel
- `min_similarity` parameter now wired through to Cortex in `mayros_search`
- Fixed: `importance: 0` was impossible to set (changed `||` to `??`)
- Fixed: `listGraphSubjects` resource null guard for Cortex offline
- Fixed: agent ID regex now accepts uppercase, dots, and dashes
- Fixed: negative `depth` in `dag-audit` prompt now clamped to minimum 1

### CLI

- `mayros dag` with 10 subcommands: `tips`, `action`, `history`, `chain`, `stats`, `export`, `diff`, `at`, `verify`, `prune`
- `mayros dag prune` now requires interactive confirmation (`[y/N]`) or `--yes` flag
- All 7 CLI modules now use `try/finally { client.destroy() }` (dashboard, session, mailbox, tasks, sync, workflow, teleport)

### Infrastructure

- Require AIngle Cortex >= 0.6.1
- Version 0.1.16 → 0.2.0
- Removed unused `parseWorktreeConfig` import from workflow-cli

---

## 0.1.16 (2026-03-13)

MCP server production hardening and Cortex version bump.

- Deep hardening for MCP server production readiness (input validation, error boundaries)
- Resolved lint warnings in hardening code
- Require AIngle Cortex >= 0.5.0

---

## 0.1.15 (2026-03-12)

MCP Server production-ready, Claude Desktop and Claude Code integration, documentation, and product page update.

### MCP Server

- 9 tools exposed via Model Context Protocol: memory (remember, recall, search, forget), budget, governance, cortex (query, store, stats)
- Cortex sidecar auto-starts on `mayros serve`, persistent storage at `~/.mayros/cortex-data/`
- Dual transport: `--stdio` for IDE/Claude Desktop, `--http` for remote clients
- Default port aligned to Mayros convention: 19100

### MCP Setup

- `mayros mcp-setup` — one-command registration for Claude Code (stdio or HTTP)
- `mayros mcp-setup --desktop` — auto-configures Claude Desktop config file
- Resolves absolute paths to `node` and `mayros.mjs` for Claude Desktop compatibility
- Cross-platform config detection: macOS, Windows, Linux

### Documentation

- New: `tools/mcp-server.mdx` — architecture, 9 tools reference, setup guides, configuration
- New: `cli/mcp-setup.mdx` — CLI reference with options and platform-specific paths
- Updated: `cli/serve.mdx` — port 19100, tools table, Cortex sidecar section
- Updated: `README.md` — step-by-step MCP setup guides, usage examples

### Product Page

- New capability cards: Intelligent Model Routing (Q-learning) and Policy Enforcement (governance)
- Updated capabilities: HNSW vector search, Byzantine consensus, response caching, budget tracking
- Updated architecture layers: Q-learning routing, governance gates, MCP Server, WASM transforms
- Security layers expanded from 6 to 10 (governance gates, HMAC audit trail, trust tiers, rate limiting)
- Updated numbers: 67 extensions, 75+ CLI commands, 20 security layers
- FAQ updated with MCP server and HNSW references

### Badges

- MCP Compatible badge (shields.io)
- Works with Claude badge (Anthropic logo)

### Infrastructure

- Require AIngle Cortex >= 0.4.3

---

## 0.1.14 (2026-03-11)

Intelligent routing, multi-agent consensus, execution safety, code transforms, governance, dual-platform coordination, and MCP server enhancements.

### Eruberu — Adaptive Model Routing

- Q-Learning model selector: learns optimal provider/model per task type, budget level, and time slot
- Budget-driven fallback: auto-switches to cheaper models when budget exceeds configurable thresholds
- Task classifier: keyword-based prompt classification (code, chat, analysis, creative)
- Cortex persistence: Q-table stored as RDF triples with JSON file fallback
- Integrates via `before_model_resolve` hook — zero changes to core execution path
- New tools: `routing_status`, `routing_set_strategy`
- New CLI: `mayros routing status|strategy|reset`

### Miteru — Intelligent Task-to-Agent Routing

- Q-Learning agent selector: learns which agent handles each task type best
- Task classification by type, complexity, and language domain
- Performance tracker: EMA-based agent scoring with Cortex persistence
- Integrated into workflow orchestrator as optional routing layer
- New tool: `mesh_route_task`

### Kimeru — Multi-Agent Consensus

- Three consensus strategies: majority vote, weighted (by EMA score), LLM-arbitrated
- Automatic conflict resolution when parallel agents produce conflicting results
- Confidence scoring and detailed vote breakdown
- New tools: `mesh_agent_performance`, `mesh_consensus`

### Tomeru — Rate Limiting & Loop Breaking

- Sliding window rate limiter: per-tool call limits with configurable windows
- Global token bucket: burst protection across all tools
- Loop breaker: SHA256-based identical-call sequence detection
- Velocity circuit breaker: hard block on runaway execution
- Configurable modes: enforce, warn, off
- New tools: `rate_limit_status`, `rate_limit_adjust`
- New CLI: `mayros ratelimit status|adjust|reset`

### Token Economy Enhancements

- Response cache (Oboeru): LRU cache with TTL for observational response deduplication
- Budget bridge: Symbol-based cross-plugin bridge exposes BudgetTracker to routing subsystems
- Cache savings tracking in budget summaries

### Model Router

- `buildFromPricingCatalog()`: construct router from token-economy pricing catalog
- `routeWithBudget()`: budget-aware routing that filters by remaining spend

### Hayameru — WASM Code Transforms

- Deterministic code transforms that bypass LLM for simple edits (0 tokens, sub-millisecond)
- Intent detector: keyword-based prompt classification with confidence scoring
- 5 transforms: var→const, remove console, sort imports, add semicolons, remove comments
- Path safety validation and atomic file writes
- Integrates via `before_agent_run` hook — short-circuits LLM when confidence is high
- Metrics tracking: token savings, transform counts, timing

### Kimeru — Byzantine & Raft Consensus

- Byzantine fault tolerance: HMAC-SHA256 signed votes, PBFT phases (pre-prepare → prepare → commit)
- Quorum math: 2f+1 agreement required, minimum 4 agents, auto-fallback to weighted
- Raft leader election: highest EMA score wins, majority follower confirmation
- Re-election support with agent exclusion

### Osameru — Governance Control Plane

- Policy compiler: parses MAYROS.md for ALLOW/DENY/REQUIRE-APPROVAL rules
- Enforcement gate: evaluates tool calls, agent starts, and content against policy bundle
- HMAC-signed append-only audit trail with hash chain integrity verification
- Trust tiers: 3-level system (new → established → trusted) based on EMA performance scores
- Configurable modes: enforce, warn, audit-only, off

### Kakeru — Dual-Platform Bridge

- Platform bridge interface for heterogeneous agent coordination
- Claude bridge: native subagent integration (always connected)
- Codex bridge: subprocess-based OpenAI Codex CLI integration with git branch isolation
- Coordinator: parallel task execution, file lock coordination, branch management

### MCP Server Enhancements

- 9 dedicated MCP tools: remember, recall, search, forget, budget, policy_check, cortex_query, cortex_store, memory_stats
- Auto-start Cortex sidecar when running `mayros serve`
- Legacy SSE transport (MCP spec 2024-11-05) for Claude Desktop compatibility
- `mayros mcp-setup` command for one-step registration in Claude Code
- Enhanced health endpoint with Cortex sidecar status

### Infrastructure

- 55 extensions synced at v0.1.14
- 112 Phase 2 tests across 16 test files (transforms, intent detection, Byzantine consensus, Raft election, policy compilation, audit trail, trust tiers, enforcement, platform coordination)
- 55 Phase 1 tests across 7 test files (Q-Learning, task classification, routing, performance tracking, consensus, rate limiting, loop breaking)
- Auto-release workflow: GitHub Releases created automatically on version tags

## 0.1.13 (2026-03-08)

Fix plugin loading, headless mode, and postinstall reliability.

- Fix gateway health check in headless mode
- Add postinstall retry logic for flaky network environments
- Include `src/` in npm package for extension runtime imports

## 0.1.12 (2026-03-07)

Auto-install gateway daemon on first run.

- Auto-install gateway daemon service on first run
- Fix duplicate `resolveGatewayPort` call in ensure-services

## 0.1.11 (2026-03-06)

Auto-update outdated Cortex binary.

- Auto-update outdated Cortex binary on sidecar start
- Require Cortex >= 0.4.1

## 0.1.10 (2026-03-05)

Persistent Cortex storage and sidecar hardening.

- Persistent Cortex storage via Sled backend (`~/.mayros/cortex-data/`)
- Lifecycle callback registry for flush-before-update flow
- Graceful sidecar restart with binary update
- Lock file reclaim on sidecar auto-restart
- Drain timeout and external Cortex detection fixes
- Complete sidecar lifecycle hardening (10 gaps)
- Hide internal instructions from slash command display

## 0.1.9 (2026-03-04)

Ineru rename and Cortex 0.4.0.

- Rename Titans memory client to Ineru across all modules
- Require Cortex >= 0.4.0

## 0.1.8 (2026-03-03)

P2P sync and enhanced Cortex networking.

- Native P2P sync mode with pairing, gossip, and status CLI
- Dual sync mode bridge: native P2P with polled fallback
- P2P config, CortexClient P2P methods, and sidecar flag forwarding
- Require Cortex >= 0.3.8

## 0.1.7 (2026-03-02)

Scoped package and update runner fix.

- Fix update-runner for scoped package name (`@apilium/mayros`)

## 0.1.6 (2026-03-01)

Cortex auto-start, resilience, and TUI improvements.

- Auto-start gateway and Cortex before TUI
- Cortex CLI commands, gateway methods, and TUI view
- Cortex auto-restart with resilience monitor
- Change default Cortex port from 8080 to 19090
- Enable semantic ecosystem plugins by default
- Zero-config semantic plugin startup
- `/kg` handler with tool fallback and diagnostic hints
- `/mouse` toggle for native text selection
- Dynamic VERSION in TUI welcome screen
- Pixel avatar art banner
- Adapt sidecar for Cortex 0.3.7

## 0.1.5 (2026-02-28)

Stability, resource cleanup, and IDE plugin hardening.

- Clear feedNext timer chain on PTY exit
- Replace eval with array-based command execution in mayroslog.sh
- Nullable TeamManager parameters with runtime guards
- Headless CLI timeout cleanup and prototype pollution guard
- Cap trace events at 5000 entries
- EventEmitter dispose in tree providers
- WebView message listener lifecycle management
- JetBrains plugin: daemon threads, error logging, panel disposal
- Thread-safe stream buffering (StringBuilder → StringBuffer)
- Synchronized disconnect to prevent race conditions
- Migrate gateway token to IntelliJ PasswordSafe
- Per-request cache key map for token-economy concurrency

## 0.1.4 (2026-02-27)

IDE extensions, CLI evolution, and security updates.

- VSCode extension: context menu actions, gutter markers, protocol v3
- JetBrains plugin: unified tabbed panel, Skills/Plan/KG views, protocol v3
- Welcome screen, image paste, and onboarding UX
- Heartbeat filtering, interactive selectors, and command cleanup
- Bump hono, @hono/node-server, and dompurify for security fixes
- Fix timer leak in sync timeout, stats filter, and panel disposal

## 0.1.3 (2026-02-26)

CI fixes and plugin loading.

- Fix CI: skip Android playstore without keystore
- Strip `mayros-` prefix from plugin entry hints to match manifest IDs

## 0.1.2 (2026-02-26)

Post-launch fixes and dependency updates.

- Fix 15 test files for vitest 4.x mock hoisting compatibility
- Fix 15 broken internal links in docs
- Fix README links
- Update plugin SDK exports and rename legacy plist references
- Update extensions: zod v4, observability route API, esbuild import
- Update CI workflow and build scripts
- Platform app updates: macOS, iOS, Android

## 0.1.1 (2026-02-25)

Skills Hub launch.

- Add 8 official Apilium skills with Ed25519 signatures
- Platinum skill structure and documentation
- Add markdownlint configuration

## 0.1.0 (2026-02-25)

First public release of Mayros — personal AI assistant platform.

### Core Platform

- Multi-channel gateway: WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Microsoft Teams, Google Chat, WebChat, BlueBubbles, Matrix, Zalo
- CLI surface with onboarding wizard (`mayros onboard`), doctor, and 35+ commands
- Companion apps: macOS menu bar, iOS, Android
- Live Canvas with A2UI (agent-driven visual workspace)
- 20+ model providers: Anthropic, OpenAI, Google Gemini, Ollama, and more

### Semantic Intelligence

- AIngle Cortex sidecar: persistent semantic memory via RDF triples
- Three-tier memory: MAYROS.md (persona) + Cortex (RDF) + Ineru STM/LTM
- Agent Mesh: multi-agent delegation, knowledge fusion, semantic observability
- Semantic skill SDK: 6 tools, 3 hooks, Forge CLI
- Skills Hub marketplace with Ed25519 signing
- Token Economy: per-session cost tracking, budgets, prompt memoization

### Security (18 layers)

- QuickJS WASM sandbox: skills run in hermetic WASM with no Node.js APIs
- Static scanner: 16 rules + anti-evasion preprocessing
- Enrichment sanitizer: Unicode normalization, 8 injection patterns, depth/length limits
- Namespace isolation enforced at all layers
- Tool allowlist intersection model
- Rate limiter (sliding window per skill per minute)
- Path traversal protection, verify-then-promote atomic installations
- Circuit breaker with exponential backoff
- Audit logging on all write operations
- Manifest validation + diff logging on hot-reload

### Infrastructure

- 38 extensions synced at v0.1.0
- 9205 tests, 0 failures, 1035 test files
- Node.js >= 22.12.0, pnpm 10.23.0
