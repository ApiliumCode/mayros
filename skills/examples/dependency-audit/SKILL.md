---
name: dependency-audit
description: Audit project dependencies with verifiable security assertions
type: semantic
user-invocable: true
semantic:
  version: 1
  permissions:
    graph: [read, write]
    proofs: [request, verify]
    memory: [recall]
  assertions:
    - predicate: "dep:safe"
      requireProof: true
    - predicate: "dep:vulnerable"
      requireProof: true
    - predicate: "dep:outdated"
      requireProof: false
  queries:
    - predicate: "dep:safe"
      scope: namespace
    - predicate: "dep:vulnerable"
      scope: namespace
---

# dependency-audit

Audit project dependencies and store security findings as provable assertions.

## When to Use

Use when auditing npm, cargo, or other package manager dependencies for vulnerabilities.

## Instructions

1. Query existing dependency assertions with `skill_graph_query`
2. For each dependency analyzed, assert its status:
   - `dep:safe` with proof for verified safe packages
   - `dep:vulnerable` with proof for known vulnerabilities
   - `dep:outdated` for packages that need updating
3. Use `skill_verify_assertion` to validate previous audit results
