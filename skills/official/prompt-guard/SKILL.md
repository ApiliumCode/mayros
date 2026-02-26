---
name: prompt-guard
description: Detects prompt injection patterns in graph content with risk classification
type: semantic
user-invocable: true
semantic:
  skillVersion: 1
  permissions:
    graph: [read, write]
    proofs: [request]
    memory: [recall]
  assertions:
    - predicate: "guard:injection-detected"
      requireProof: true
    - predicate: "guard:scan-result"
      requireProof: false
  queries:
    - predicate: "guard:history"
      scope: agent
---

# prompt-guard

Detects prompt injection patterns in graph content and classifies findings by risk level.

## When to Use

Use this skill when:

- Inspecting user-submitted text stored in the knowledge graph for injection attempts
- Auditing graph content before it reaches downstream agents or tools
- Monitoring for adversarial inputs such as role overrides, encoding evasion, or jailbreak prompts

## Risk Classification

Each finding is classified into one of three levels:

- **dangerous** -- Active injection attempts (role overrides, system overrides, jailbreak, shell commands)
- **suspicious** -- Evasion techniques or anomalies (zero-width characters, homoglyphs, encoding tricks, template injection)
- **safe** -- No injection patterns detected

The overall classification for a scanned item is `dangerous` if any dangerous finding exists, `suspicious` if only suspicious findings exist, and `safe` otherwise.

## Instructions

1. Store text content in the graph using `skill_assert` or `skill_graph_query`
2. Query with predicate `guard:scan-result` to trigger the prompt-guard runtime
3. The skill enriches each result with a `classification` field and a `findings` array
4. Use `guard:injection-detected` (with proof) to record confirmed injection attempts
5. Query `guard:history` to review past scan results for the current agent
