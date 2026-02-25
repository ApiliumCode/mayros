---
name: api-monitor
description: Monitor API health and assert endpoint status with ZK proofs
type: semantic
user-invocable: true
semantic:
  version: 1
  permissions:
    graph: [read, write]
    proofs: [request, verify]
    memory: [recall, remember]
  assertions:
    - predicate: "api:healthy"
      requireProof: false
    - predicate: "api:degraded"
      requireProof: true
    - predicate: "api:down"
      requireProof: true
  queries:
    - predicate: "api:healthy"
      scope: namespace
    - predicate: "api:degraded"
      scope: namespace
---

# api-monitor

Monitor API endpoints and store health status as semantic assertions.

## When to Use

Use for API health monitoring, SLA tracking, and incident detection.

## Instructions

1. Recall previous API status from memory
2. Check endpoint health and assert current status
3. Use ZK proofs for degraded/down assertions to ensure tamper-proof incident records
4. Query historical health data for trend analysis
