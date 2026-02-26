---
name: workflow-insights
description: Detects anti-patterns in agent workflows and computes health scores
type: semantic
user-invocable: true
semantic:
  skillVersion: 1
  permissions:
    graph: [read]
    memory: [recall]
  queries:
    - predicate: "workflow:analysis"
      scope: agent
---

# workflow-insights

Detect anti-patterns in agent workflows and compute health scores based on 7 weighted pattern detectors.

## When to Use

Use when analyzing agent execution traces, debugging sluggish workflows, or auditing multi-step agent pipelines for inefficiency. The skill evaluates delegation chains, error patterns, resource usage, and tool utilization to produce a 0-100 health score.

## Anti-Pattern Detectors

| #   | Pattern          | Weight | Description                                                                               |
| --- | ---------------- | ------ | ----------------------------------------------------------------------------------------- |
| 1   | Repeated Failure | 20     | Same error appearing 3+ times suggests retry without fix                                  |
| 2   | Long Chain       | 15     | Delegation chain exceeding 5 steps suggests over-decomposition                            |
| 3   | Unused Tool      | 5      | Tool registered but never called suggests bloated configuration                           |
| 4   | Redundant Query  | 10     | Same query pattern appearing multiple times suggests missing caching                      |
| 5   | Timeout Pattern  | 20     | Multiple timeouts in sequence suggests resource contention                                |
| 6   | Resource Waste   | 15     | Large context sent to simple tasks suggests poor task routing                             |
| 7   | Error Cascade    | 15     | Error in one step causing errors in 3+ downstream steps suggests missing error boundaries |

## Health Score

- **80-100**: Healthy
- **60-79**: Needs attention
- **40-59**: Degraded
- **0-39**: Critical

## Instructions

1. Recall previous workflow analysis with `skill_memory_context` using predicate `workflow:analysis`
2. The skill scans query results for the 7 anti-pattern indicators listed above
3. Each detected pattern reduces the health score by its weight (starting from 100)
4. Review detected anti-patterns and address the highest-weight issues first
5. Re-run periodically to track workflow health improvements over time
