---
name: code-security
description: Classifies code vulnerabilities by OWASP Top 10 and CWE identifiers
type: semantic
user-invocable: true
semantic:
  skillVersion: 1
  permissions:
    graph: [read, write]
    proofs: [request]
    memory: [recall]
  assertions:
    - predicate: "security:vulnerability"
      requireProof: true
    - predicate: "security:finding"
      requireProof: false
  queries:
    - predicate: "security:history"
      scope: agent
---

# code-security

Classifies code vulnerabilities by OWASP Top 10 categories and CWE identifiers, providing severity ratings for each finding.

## When to Use

Use this skill when:

- Reviewing code snippets stored in the knowledge graph for security vulnerabilities
- Performing automated security audits on code content
- Classifying findings by CWE identifier and severity level before human review

## Vulnerability Coverage

The skill detects 12 vulnerability classes:

| CWE     | Category                           | Severity |
| ------- | ---------------------------------- | -------- |
| CWE-89  | SQL Injection                      | critical |
| CWE-79  | Cross-Site Scripting (XSS)         | high     |
| CWE-78  | Command Injection                  | critical |
| CWE-22  | Path Traversal                     | high     |
| CWE-502 | Insecure Deserialization           | high     |
| CWE-798 | Hardcoded Secrets                  | critical |
| CWE-95  | Code Injection                     | critical |
| CWE-918 | Server-Side Request Forgery (SSRF) | high     |
| CWE-327 | Weak Cryptography                  | medium   |
| CWE-601 | Open Redirect                      | medium   |
| CWE-209 | Information Exposure               | low      |
| CWE-306 | Missing Authentication             | medium   |

## Instructions

1. Store code content in the graph using `skill_assert` or other write tools
2. Query with predicate `security:finding` to trigger the code-security runtime
3. The skill enriches each result with a `findings` array containing CWE IDs and severity levels
4. Use `security:vulnerability` (with proof) to record confirmed vulnerabilities
5. Query `security:history` to review past audit results for the current agent
