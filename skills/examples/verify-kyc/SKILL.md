---
name: verify-kyc
description: Verify user KYC status using semantic proofs
type: semantic
user-invocable: true
semantic:
  version: 1
  permissions:
    graph: [read, write]
    proofs: [request, verify]
    memory: [recall]
  assertions:
    - predicate: "kyc:verified"
      requireProof: true
    - predicate: "kyc:level"
      requireProof: false
  queries:
    - predicate: "kyc:level"
      scope: agent
    - predicate: "kyc:verified"
      scope: agent
---

# verify-kyc

Verify user KYC (Know Your Customer) status using the semantic graph and PoL proofs.

## When to Use

Use this skill when the user needs to:

- Check their KYC verification status
- Submit a KYC verification request with proof
- Query KYC levels across agents in the namespace

## Instructions

1. Query the agent's current KYC level using `skill_graph_query`
2. If KYC is not verified, use `skill_assert` with `requireProof: true` to submit a verification
3. Use `skill_verify_assertion` to check the proof status
4. Report the results clearly to the user
