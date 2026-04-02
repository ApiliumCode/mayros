---
name: cost-optimizer
description: "Analyze Claude API usage patterns and detect cost optimization opportunities across 6 rules: prompt caching, model downgrade, Batch API, streaming, output limits, and context trimming. Use when the user asks about reducing API costs, optimizing token usage, reviewing Claude billing, or saving money on API calls."
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

Analyze Claude API usage patterns and recommend cost optimization strategies across 6 rules.

## When to Use

Use when the user asks about reducing API costs, optimizing token usage, reviewing Claude billing, or planning batch processing workflows. Triggers on: "reduce spending", "API costs", "token usage", "save money", "expensive prompts", "billing optimization".

## Optimization Rules

| Rule | Trigger Pattern | Estimated Savings |
|------|----------------|-------------------|
| **Prompt Caching** | Repeated system prompts / identical prefixes | Up to 90% on cached input reads |
| **Model Downgrade** | Simple tasks (classification, extraction, formatting) | Up to 94% vs Opus (Haiku: $0.80 vs Opus: $15/MTok input) |
| **Batch API** | Non-urgent / bulk processing workloads | 50% on all model pricing |
| **Streaming** | Interactive / user-facing latency-sensitive use cases | Same cost, improved perceived latency |
| **Output Limits** | Verbose / long responses | Variable — output tokens cost 5x input |
| **Context Trimming** | Large context windows / full documents | Proportional to input token reduction |

## Instructions

1. Check for prior analysis: query `skill_memory_context` with predicate `cost:opportunity`. If no prior context exists, proceed with fresh analysis
2. Describe the usage pattern or paste usage data — the skill's runtime scans text for keyword matches against each rule's trigger patterns (e.g. mentions of "repeated prompt" triggers prompt-caching, "classification" triggers model-downgrade)
3. Review the returned `costAnalysis` object per result — each detected opportunity includes `rule`, `savings`, and `detectedModel` with pricing context
4. Prioritize by impact: model downgrade and prompt caching typically yield the largest savings
5. Re-run periodically to track cost reduction progress

## Example Output

When the skill detects optimization opportunities, it returns structured results:

```json
{
  "costAnalysis": {
    "opportunities": [
      { "rule": "Model Downgrade", "savings": "Up to 94% vs Opus" },
      { "rule": "Prompt Caching", "savings": "Up to 90% on cached input reads" }
    ],
    "detectedModel": "claude-opus-4-6: input $15/MTok, output $75/MTok, cache_write $18.75/MTok, cache_read $1.5/MTok (Batch: 50% discount)",
    "batchDiscount": "50%"
  }
}
```

When no opportunities are detected, `costAnalysis` is `null`.

## Decision Criteria

- **>10 requests with identical system prompt** → recommend prompt caching
- **Simple tasks (classify, extract, format)** → recommend Haiku over Opus/Sonnet
- **Non-urgent bulk work (>100 requests)** → recommend Batch API (50% discount)
- **User-facing latency matters** → recommend streaming (same cost)
- **Output consistently >1000 tokens** → recommend setting `max_tokens`
- **Input context >50k tokens** → recommend summarization or retrieval

## Pricing Reference (USD per million tokens)

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| claude-opus-4-6 | $15 | $75 | $18.75 | $1.50 |
| claude-sonnet-4-6 | $3 | $15 | $3.75 | $0.30 |
| claude-haiku-4-5 | $0.80 | $4 | $1.00 | $0.08 |

All models receive a 50% discount when using the Batch API.
