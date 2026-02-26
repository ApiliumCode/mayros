---
name: cost-optimizer
description: Detects cost optimization opportunities for Claude API usage
type: semantic
user-invocable: true
semantic:
  skillVersion: 1
  permissions:
    graph: [read]
    memory: [recall]
  queries:
    - predicate: "cost:opportunity"
      scope: agent
---

# cost-optimizer

Detect cost optimization opportunities for Claude API usage by analyzing usage patterns and recommending pricing-aware strategies.

## When to Use

Use when analyzing API usage costs, planning batch processing workflows, or optimizing prompt engineering for cost efficiency. The skill evaluates 6 optimization rules: prompt caching, model downgrade, Batch API, streaming, output limits, and context trimming.

## Instructions

1. Recall previous cost analysis with `skill_memory_context` using predicate `cost:opportunity`
2. The skill scans usage data for patterns indicating optimization potential
3. Each detected opportunity includes an estimated savings percentage
4. Review recommendations and apply the most impactful changes first
5. Re-run periodically to track cost reduction progress over time
