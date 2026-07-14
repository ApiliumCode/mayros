# Changelog

## 1.0.1 (2026-07-14)

- Cross-note tracing recipe: compose `aingle_note_context` and
  `aingle_backlinks` to report how two notes connect, with citations for
  every hop.
- Clearer savings framing: about 18x more of your knowledge per token spent.

## 1.0.0 (2026-07-14)

First release of the official Akashi skill for Mayros.

- Connection bootstrap via the `mcp-client` extension (HTTP transport,
  per-runtime bearer token).
- Query-first grounded retrieval protocol over `aingle_ground`,
  `aingle_vault_map`, `aingle_note_context`, and `aingle_sources`.
- Honesty rules: mandatory `source:lines` citations, groundedness verdicts
  surfaced, stale-index warnings, no invented vault content.
- Consent-based write-back following vault conventions.
- Typed helpers for the ground response shape and canonical citations
  (`types.ts`, `citations.ts`) with tests.
