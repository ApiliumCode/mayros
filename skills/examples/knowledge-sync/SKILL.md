---
name: knowledge-sync
description: Synchronize and verify knowledge across agent namespaces
type: semantic
user-invocable: true
semantic:
  version: 1
  permissions:
    graph: [read, write]
    proofs: [request, verify, publish]
    memory: [recall, remember]
  assertions:
    - predicate: "sync:checkpoint"
      requireProof: true
    - predicate: "sync:conflict"
      requireProof: false
  queries:
    - predicate: "sync:checkpoint"
      scope: global
    - predicate: "sync:conflict"
      scope: namespace
---

# knowledge-sync

Synchronize knowledge across agent namespaces with provable consistency checkpoints.

## When to Use

Use when coordinating knowledge between multiple agents or merging namespace data.

## Instructions

1. Query global sync checkpoints to find the latest state
2. Compare local namespace state against the checkpoint
3. Assert `sync:conflict` for any detected inconsistencies
4. After resolution, assert `sync:checkpoint` with proof to create a new verified state
5. Remember sync metadata for future reconciliation
