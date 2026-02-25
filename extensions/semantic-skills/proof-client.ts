import type { SkillSandboxConfig } from "./config.js";
import type { CortexClient } from "./cortex-client.js";

export type ProofType = "schnorr" | "equality" | "membership" | "range";

export type ProofRequest = {
  proofType: ProofType;
  subject: string;
  predicate: string;
  metadata?: Record<string, string>;
};

export type ProofResult = {
  proofId: string;
  status: "pending" | "verified" | "failed";
  proofType: ProofType;
  subject: string;
  predicate: string;
  createdAt: string;
};

export type VerifyResult = {
  verified: boolean;
  proofId: string;
  details?: unknown;
};

export class ProofClient {
  constructor(
    private client: CortexClient,
    private sandbox: SkillSandboxConfig,
  ) {}

  async requestPolProof(
    subject: string,
    predicate: string,
    object: unknown,
  ): Promise<{
    valid: boolean;
    proofHash?: string;
    messages: Array<{ level: string; message: string }>;
  }> {
    const result = await this.client.validate({
      statements: [{ subject, predicate, object }],
    });
    return {
      valid: result.valid,
      proofHash: result.proof_hash,
      messages: result.messages ?? [],
    };
  }

  async requestZkProof(req: ProofRequest): Promise<ProofResult> {
    if (!this.sandbox.allowZkProofs) {
      throw new Error("ZK proofs are disabled in skill sandbox configuration");
    }

    const response = await Promise.race([
      this.client.submitProof({
        proof_type: req.proofType,
        subject: req.subject,
        predicate: req.predicate,
        proof_data: { type: req.proofType },
        metadata: req.metadata,
      }),
      timeout(this.sandbox.proofTimeoutMs),
    ]);

    if (!response) {
      throw new Error(`ZK proof request timed out after ${this.sandbox.proofTimeoutMs}ms`);
    }

    return {
      proofId: response.id,
      status: response.status as ProofResult["status"],
      proofType: req.proofType,
      subject: response.subject ?? req.subject,
      predicate: response.predicate ?? req.predicate,
      createdAt: response.created_at,
    };
  }

  async verifyZkProof(proofId: string): Promise<VerifyResult> {
    const result = await this.client.verifyProof(proofId);
    return {
      verified: result.valid,
      proofId,
      details: result.details,
    };
  }

  async verifyPolProof(
    subject: string,
    predicate: string,
    object: unknown,
  ): Promise<{ valid: boolean; messages: Array<{ level: string; message: string }> }> {
    const result = await this.client.validate({
      statements: [{ subject, predicate, object }],
    });
    return { valid: result.valid, messages: result.messages ?? [] };
  }
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
}
