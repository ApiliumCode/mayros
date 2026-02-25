---
name: code-review
description: Semantic code review with provable assertions about code quality
type: semantic
user-invocable: true
semantic:
  version: 1
  permissions:
    graph: [read, write]
    proofs: [request]
    memory: [recall, remember]
  assertions:
    - predicate: "review:passed"
      requireProof: true
    - predicate: "review:finding"
      requireProof: false
  queries:
    - predicate: "review:history"
      scope: agent
---

# code-review

Perform semantic code reviews that store findings as provable assertions in the knowledge graph.

## When to Use

Use when reviewing code changes, pull requests, or performing quality audits.

## Instructions

1. Recall previous review context with `skill_memory_context`
2. For each finding, assert it with `skill_assert` using predicate `review:finding`
3. If the review passes, assert `review:passed` with proof required
4. Query review history to track quality trends over time
