## Mayros Vision

Mayros is a personal AI assistant that runs on your devices, answers on your channels, and respects your data.

This document explains the current state and direction of the project.
We are still early, so iteration is fast.
Project overview and developer docs: [`README.md`](README.md)
Contribution guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)

Mayros is built by [Apilium Technologies](https://apilium.com). It is designed around a single principle: the user owns the assistant, the devices, and the data.

### Architecture

- **Gateway** — WebSocket control plane with sessions, presence, config, cron, webhooks, and Canvas host.
- **Semantic Memory** — three-tier architecture: MAYROS.md (lightweight persona), AIngle Cortex (RDF triples, namespace-isolated), Ineru STM/LTM. Cortex runs as an HTTP sidecar; when unavailable, Mayros degrades gracefully to markdown.
- **Agent Mesh** — multi-agent coordination, delegation, and fusion across devices and channels.
- **QuickJS WASM Sandbox** — skills run fully isolated with 18 security layers, no access to fs/net/process.
- **38 Extensions** — semantic-skills, agent-mesh, skill-hub, token-economy, IoT bridge, semantic observability, and more.

### Current Focus

Priority:

- Security and safe defaults (18 security layers, static scanner, enrichment sanitizer)
- Bug fixes and stability
- Setup reliability and first-run UX

Next priorities:

- Supporting all major model providers (20+ already: Anthropic, OpenAI, Google Gemini, Ollama, and more)
- Improving support for major messaging channels (WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Teams, and more)
- Performance and test infrastructure (9205 tests, 1035 files)
- Better computer-use and agent harness capabilities
- Ergonomics across CLI and web frontend
- Companion apps on macOS, iOS, Android, Windows, and Linux
- Live Canvas with A2UI (agent-driven visual workspace)

### Contribution Rules

- One PR = one issue/topic. Do not bundle multiple unrelated fixes/features.
- PRs over ~5,000 changed lines are reviewed only in exceptional circumstances.
- Do not open large batches of tiny PRs at once; each PR has review cost.
- For very small related fixes, grouping into one focused PR is encouraged.

## Security

Security in Mayros is a deliberate tradeoff: strong defaults without killing capability.
The goal is to stay powerful for real work while making risky paths explicit and operator-controlled.

Canonical security policy and reporting:

- [`SECURITY.md`](SECURITY.md)

The 18 security layers include: QuickJS WASM sandbox, static scanner (16 rules), enrichment sanitizer (Unicode normalization + injection detection), namespace isolation, tool allowlist (intersection model), rate limiter, query/write limits, execution timeouts, memory/stack limits, atomic hot-reload with manifest validation, circuit breaker, audit logging, and more.

## Plugins & Memory

Mayros has an extensive plugin API built on `@sinclair/typebox`.
Core stays lean; optional capability should usually ship as plugins.

Preferred plugin path is npm package distribution plus local extension loading for development.
If you build a plugin, host and maintain it in your own repository.
The bar for adding optional plugins to core is intentionally high.
Plugin docs: [`docs/tools/plugin.md`](docs/tools/plugin.md)
Community plugin listing: https://apilium.com/us/doc/mayros/plugins/community

Memory uses a three-tier architecture:

- **MAYROS.md** — lightweight persona file, always available
- **AIngle Cortex** — persistent semantic memory via RDF triples, namespace-isolated per agent
- **Ineru STM/LTM** — short-term and long-term memory layers

### Skills

Skills run in a QuickJS WASM sandbox with strict isolation.
New skills should be published to [Skills Hub](https://hub.apilium.com) first, not added to core by default.
Core skill additions should be rare and require a strong product or security reason.
Workspace skills are loaded from the local `skills/` directory.

### Setup

Mayros is currently terminal-first by design.
The onboarding wizard (`mayros onboard`) guides users through gateway, workspace, channels, and skills setup.

Long term, we want easier onboarding flows as hardening matures.
We do not want convenience wrappers that hide critical security decisions from users.

### Why TypeScript?

Mayros is primarily an orchestration system: prompts, tools, protocols, and integrations.
TypeScript was chosen to keep Mayros hackable by default.
It is widely known, fast to iterate in, and easy to read, modify, and extend.
Performance-critical components (Cortex, AIngle) are written in Rust.

## What We Will Not Merge (For Now)

- New core skills when they can live on Skills Hub
- Full-doc translation sets for all docs (deferred; we plan AI-generated translations later)
- Commercial service integrations that do not clearly fit the model-provider category
- Wrapper channels around already supported channels without a clear capability or security gap
- Agent-hierarchy frameworks (manager-of-managers / nested planner trees) as a default architecture
- Heavy orchestration layers that duplicate existing agent and tool infrastructure

This list is a roadmap guardrail, not a law of physics.
Strong user demand and strong technical rationale can change it.
