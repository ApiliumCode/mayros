---
name: changelog-tracker
description: Monitors version changes with semantic versioning analysis and breaking change detection
type: semantic
user-invocable: true
semantic:
  skillVersion: 1
  permissions:
    graph: [read, write]
    proofs: [request]
    memory: [recall, remember]
  assertions:
    - predicate: "changelog:breaking-change"
      requireProof: true
    - predicate: "changelog:version-update"
      requireProof: false
  queries:
    - predicate: "changelog:history"
      scope: agent
---

# changelog-tracker

Monitor version changes with semantic versioning analysis and breaking change detection across changelogs, release notes, and dependency updates.

## When to Use

Use when tracking version updates across dependencies, reviewing changelogs for breaking changes, or auditing release notes before upgrading. The skill parses semver strings, classifies bump types, and scans for 7 breaking change indicators.

## Semver Classification

| Bump Type     | Meaning                           |
| ------------- | --------------------------------- |
| Major (X.0.0) | Breaking change                   |
| Minor (0.X.0) | New feature (backward compatible) |
| Patch (0.0.X) | Bug fix                           |

## Breaking Change Indicators

| #   | Pattern                                        | Description                                                |
| --- | ---------------------------------------------- | ---------------------------------------------------------- |
| 1   | "breaking change" / "BREAKING"                 | Explicit breaking change declaration                       |
| 2   | "removed" + API term                           | Removal of API surface (endpoint, method, function, field) |
| 3   | "deprecated" + "removed"                       | Previously deprecated item now removed                     |
| 4   | "incompatible" / "not backward compatible"     | Explicit incompatibility statement                         |
| 5   | "migration required" / "migrate"               | Migration needed for upgrade                               |
| 6   | "renamed" + API term                           | API surface renamed                                        |
| 7   | "changed signature" / "new parameter required" | Function signature changes                                 |

## Instructions

1. Recall previous changelog history with `skill_memory_context` using predicate `changelog:history`
2. The skill scans query results for semver version strings and breaking change indicators
3. Breaking changes are asserted with `skill_assert` using predicate `changelog:breaking-change` with proof required
4. Version updates are recorded with predicate `changelog:version-update` without proof
5. Query changelog history to track version progression and breaking change frequency over time
