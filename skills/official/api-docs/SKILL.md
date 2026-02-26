---
name: api-docs
description: Enriches API queries with multi-language SDK code snippets
type: semantic
user-invocable: true
semantic:
  skillVersion: 1
  permissions:
    graph: [read]
    memory: [recall]
  queries:
    - predicate: "docs:snippet"
      scope: agent
---

# api-docs

Enriches API-related queries with compact, multi-language SDK code snippets for the Anthropic Messages API.

## When to Use

Use when working with the Anthropic API, generating SDK examples, or when you need quick reference snippets for common API operations across multiple programming languages.

## Supported Operations

- **messages** -- Basic message creation
- **streaming** -- Server-sent events streaming
- **tool_use** -- Tool/function calling
- **vision** -- Image input processing
- **batch** -- Batch message processing
- **embeddings** -- Text embeddings

## Supported Languages

Python, TypeScript, Java, Go, Ruby, PHP, C#

## Instructions

1. Recall any previous API documentation context with `skill_memory_context`
2. Analyze query results for operation keywords (e.g., "stream", "tool", "vision")
3. Detect the target programming language from context
4. Return matching code snippets; defaults to Python and TypeScript if no language is detected
