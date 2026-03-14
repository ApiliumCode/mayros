import { describe, it, expect } from "vitest";
import { generateSchnorrProof } from "./zk-schnorr.js";

describe("ZK Schnorr E2E against Cortex", () => {
  it("submit and verify a Knowledge proof", async () => {
    const statement = "mayros:agent:auditor has capability security-review";
    const subject = "mayros:agent:auditor";
    const predicate = "mayros:identity:capability";
    const obj = "security-review";

    const proof = generateSchnorrProof(statement, subject, predicate, obj);

    expect(proof.commitment).toHaveLength(32);
    expect(proof.challenge).toHaveLength(32);
    expect(proof.response).toHaveLength(32);

    const body = {
      proof_type: "knowledge",
      proof_data: {
        type: "Knowledge",
        statement,
        subject,
        predicate,
        object: obj,
        commitment: proof.commitment,
        challenge: proof.challenge,
        response: proof.response,
      },
      metadata: { submitter: "auditor", tags: ["capability"], extra: { namespace: "mayros" } },
    };

    const submitRes = await fetch("http://localhost:19090/api/v1/proofs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const submit = (await submitRes.json()) as Record<string, unknown>;
    console.log("SUBMIT:", JSON.stringify(submit));
    expect(submit.proof_id).toBeTruthy();

    const vRes = await fetch(`http://localhost:19090/api/v1/proofs/${submit.proof_id}/verify`);
    const verify = (await vRes.json()) as Record<string, unknown>;
    console.log("VERIFY:", JSON.stringify(verify));

    expect(verify.proof_id).toBe(submit.proof_id);
    expect(verify.verified_at).toBeTruthy();
    expect(verify.valid).toBe(true);
  });
});
