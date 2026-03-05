# MAYROS v0.1.0 — Project Instructions

## Project Info

- **Product**: [apilium.com/us/products/mayros](https://apilium.com/us/products/mayros)
- **Download**: [mayros.apilium.com](https://mayros.apilium.com)
- **Documentation**: [apilium.com/us/doc/mayros](https://apilium.com/us/doc/mayros)
- **Repo (public)**: [github.com/ApiliumCode/mayros](https://github.com/ApiliumCode/mayros)
- **Repo (dev)**: `/Users/carlostovar/repositorios/apilium/maryosCode`
- **AIngle**: [github.com/ApiliumCode/aingle](https://github.com/ApiliumCode/aingle)
- **Skills Hub**: [github.com/ApiliumCode/skills-hub](https://github.com/ApiliumCode/skills-hub)

## Repository Structure

```
src/                          # Core: CLI, commands, infra, media, agents
extensions/                   # Plugin extensions (38 packages)
  semantic-skills/            # Semantic skill SDK, 6 tools, sandbox
    sandbox/                  # QuickJS WASM sandbox (quickjs-sandbox, marshal, transpiler)
  agent-mesh/                 # Multi-agent coordination, delegation, fusion
  skill-hub/                  # Apilium Hub marketplace, Ed25519 signing
  memory-semantic/            # AIngle Cortex integration
  semantic-observability/     # Trace emitter, decision graph
  token-economy/              # Budget tracking, prompt cache
  shared/                     # CortexClient, cortex-config, cortex-resilience
  iot-bridge/                 # IoT node fleet management
skills/examples/              # 5 example skills (verify-kyc, code-review, etc.)
docs/                         # Product page, architecture docs
```

## Build & Test

- Runtime: **Node >= 22**, pnpm 10.23.0
- Install: `pnpm install`
- Build: `pnpm build`
- Tests: `pnpm test` (vitest) — 9205 tests, 1035 files
- Type check: `pnpm tsgo` or `npx tsc --noEmit`
- Sync extension versions: `pnpm plugins:sync` (reads root package.json)

## Coding Conventions

- TypeScript ESM, strict typing, no `any`
- Plugin SDK: `@sinclair/typebox` for params, manual config validation (not Zod)
- Tests: colocated `*.test.ts`, vitest
- Product name: **Mayros** (headings), `mayros` (CLI, paths, config)
- Extensions: keep plugin deps in extension `package.json`, not root

## Security Architecture (18 layers)

### Sandbox (Phase 7)

Skills run in **QuickJS WASM** (`quickjs-emscripten@0.31.0`). The sandbox exposes only 7 host functions:

- `graphClient`: createTriple, listTriples, patternQuery, deleteTriple
- `logger`: info, warn, error

**No access to**: fs, net, process, require, import, fetch, setTimeout, Worker, eval (harmless in WASM).

Config: `extensions/semantic-skills/config.ts` — `SkillSandboxConfig`

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

**Anti-evasion preprocessing** (H5):

- `stripComments()` — preserves string literals, strips // and /\* \*/
- `joinSplitStatements()` — tracks parens balance across lines (catches `eval\n(...)`)
- `countNetParens()` — skips parens inside string literals

### Enrichment Sanitizer (`extensions/semantic-skills/enrichment-sanitizer.ts`)

- **Unicode normalization** (C3): NFC + homoglyph map (Cyrillic/Greek→ASCII) + zero-width strip + fullwidth collapse
- **8 injection patterns**: ignore/disregard previous, you are/act as, system:override, execute the following, new instructions, important: you must, curl/wget/bash, rm -rf
- **Depth limits**: MAX_DEPTH=4, MAX_ARRAY_LENGTH=50, MAX_STRING_LENGTH=512, MAX_ENRICHMENT_CHARS=4096
- **Output**: wrapped in `<skill-enrichment type="data">` tags

### Namespace Isolation

- `enforceNsPrefix()` in index.ts — ALL queries forced to `${ns}:` prefix
- scope:"global" is capped to own namespace (no cross-namespace)
- scope:"agent" → `${ns}:agent:${agentId}`
- Sandbox graphClient enforces ns prefix on createTriple/deleteTriple/listTriples/patternQuery
- `skill_memory_context` scopes subject to `${ns}:` + defense-in-depth filter

### Tool Allowlist

- **Intersection model**: ALL active skills must allow a tool (not just any one)
- Default: `DEFAULT_ALLOWED_TOOLS` (9 safe tools) applied when manifest omits allowedTools
- `["*"]` escape hatch for unrestricted access
- 6 core semantic tools always allowed

### Rate Limiter

- `SkillRateLimiter` class — sliding window (1-minute) per skill
- Applied to: `skill_graph_query`, `skill_assert`, `skill_memory_context`
- Default: 60 calls/min, configurable via `maxCallsPerMinute`

### Query & Write Limits

- Per-skill query counter (`queryCountPerSkill` Map)
- `maxQueries` per manifest + global cap = maxGraphQueries x activeSkillCount
- Write limits per sandbox (createTriple/deleteTriple)
- `checkWriteLimit()` in QuickJS sandbox

### Enrichment Timeout

- `invokeQuery()` wrapped in `Promise.race()` with 2s timeout (C5)
- Prevents DoS via slow enrichment

### Hot-Reload Security

- **Atomic swap** (H6): build temp maps → clear → swap
- **Manifest validation** (H7): `validateManifest()` on reload
- **Downgrade block**: rejects if `allowedTools` removed from original
- **Diff logging**: `diffManifests()` logs changes to allowedTools, permissions, assertions, maxQueries

### Other Controls

- Path traversal: reject `..` + `isPathInside()` double-check
- Verify-then-promote: temp extract → verify hashes → atomic promote
- Circuit breaker: 3-state (closed/open/half-open) + exponential backoff
- Audit logging: skill name + operation tagged on all sandbox writes
- No default AssertionEngine: `skill_assert` / `skill_verify_assertion` fail without declared engine
- Per-request skill tracking: `resolveCurrentSkill()` round-robin for multi-skill

## Versioning

- Mayros: **v0.1.0** (package.json + 38 extensions synced)
- Cortex: aingle_cortex **0.2.6** (`REQUIRED_CORTEX_VERSION`)
- Crates: aingle 0.0.101, zome_types 0.0.4
- Sync versions: update root `package.json` → `pnpm plugins:sync`
- Release: `git tag v0.1.0 && git push origin v0.1.0`

## Key Files

| File                                                    | Purpose                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `extensions/semantic-skills/index.ts`                   | Plugin entry: 6 tools, 3 hooks, CLI, rate limiter, namespace enforcement |
| `extensions/semantic-skills/config.ts`                  | SkillSandboxConfig, VerificationConfig, clampInt                         |
| `extensions/semantic-skills/sandbox/quickjs-sandbox.ts` | QuickJS WASM sandbox core                                                |
| `extensions/semantic-skills/enrichment-sanitizer.ts`    | Injection detection + Unicode normalization                              |
| `extensions/semantic-skills/skill-loader.ts`            | Sandbox/direct loading, scan gate, enrichment sanitization               |
| `extensions/semantic-skills/skill-manifest.ts`          | Manifest parsing, DEFAULT_ALLOWED_TOOLS, validation                      |
| `extensions/semantic-skills/permission-resolver.ts`     | Tool allowlist, permission checking                                      |
| `src/security/skill-scanner.ts`                         | 16-rule scanner + preprocessing                                          |
| `extensions/shared/cortex-client.ts`                    | Unified CortexClient, DTOs                                               |
| `extensions/shared/cortex-resilience.ts`                | CircuitBreaker + resilientFetch                                          |

## Translations (i18n)

| Language        | Dir           | Status                            |
| --------------- | ------------- | --------------------------------- |
| Chinese (zh-CN) | `docs/zh-CN/` | **Complete**                      |
| Spanish (es)    | `docs/es/`    | Pending — full translation needed |
| Japanese (ja)   | `docs/ja/`    | Pending — full translation needed |
| Korean (ko)     | `docs/ko/`    | Pending — full translation needed |
| Hindi (hi)      | `docs/hi/`    | Pending — full translation needed |
