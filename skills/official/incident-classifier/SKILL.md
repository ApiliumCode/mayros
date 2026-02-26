---
name: incident-classifier
description: Classifies errors and incidents by type, severity, and remediation steps
type: semantic
user-invocable: true
semantic:
  skillVersion: 1
  permissions:
    graph: [read, write]
    proofs: [request]
    memory: [recall, remember]
  assertions:
    - predicate: "incident:classified"
      requireProof: true
    - predicate: "incident:finding"
      requireProof: false
  queries:
    - predicate: "incident:history"
      scope: agent
---

# incident-classifier

Classify errors and incidents by type, severity, and remediation steps using HTTP status codes and error pattern analysis.

## When to Use

Use when triaging production incidents, analyzing error logs, or building automated incident response workflows. The skill recognizes HTTP status codes (400-504) and 8 common error type patterns including timeouts, authentication failures, rate limits, network errors, validation issues, memory exhaustion, deadlocks, and disk space problems.

## Instructions

1. Recall previous incident history with `skill_memory_context` using predicate `incident:history`
2. For each error or incident, the skill classifies it by type and assigns a severity level (P0-P4)
3. Critical findings (P0/P1) are asserted with `skill_assert` using predicate `incident:classified` with proof required
4. Informational findings use predicate `incident:finding` without proof
5. Query incident history to track patterns and recurring issues over time
