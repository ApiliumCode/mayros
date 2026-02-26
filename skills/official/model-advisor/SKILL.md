---
name: model-advisor
description: Recommends the optimal Claude model based on task requirements and cost analysis
type: semantic
user-invocable: true
semantic:
  skillVersion: 1
  permissions:
    graph: [read]
    memory: [recall]
  queries:
    - predicate: "advisor:recommendation"
      scope: agent
---

# model-advisor

Recommends the optimal Claude model based on task requirements, complexity analysis, and cost efficiency.

## When to Use

Use when choosing between Claude models for a specific task, when optimizing API costs, or when you need guidance on which model best fits a workload profile.

## Supported Models

| Model      | Input      | Output   | Best For                                                                              |
| ---------- | ---------- | -------- | ------------------------------------------------------------------------------------- |
| Opus 4.6   | $15/MTok   | $75/MTok | Complex reasoning, research, multi-step analysis, code architecture, creative writing |
| Sonnet 4.6 | $3/MTok    | $15/MTok | Coding, general tasks, data analysis, moderate complexity                             |
| Haiku 4.5  | $0.80/MTok | $4/MTok  | Classification, extraction, simple Q&A, high volume, low latency                      |

## Instructions

1. Recall any previous model recommendations with `skill_memory_context`
2. Analyze the task description from query results for complexity indicators
3. Match task keywords against model strengths to determine the best fit
4. Return the recommended model with rationale and cost comparison
