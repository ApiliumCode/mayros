# Changelog

Product: https://apilium.com/us/products/mayros
Download: https://mayros.apilium.com
Docs: https://apilium.com/us/doc/mayros

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
