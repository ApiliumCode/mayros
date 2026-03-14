import type { SkillSandboxConfig } from "./config.js";
import type { CortexClient } from "./cortex-client.js";
import { generateSchnorrProof, generateMembershipProof } from "../shared/zk-schnorr.js";

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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.sandbox.proofTimeoutMs);

    try {
      const statement = `${req.subject} ${req.predicate}`;
      const objectStr = req.predicate;

      const proofFields =
        req.proofType === "membership"
          ? generateMembershipProof(statement, req.subject, req.predicate, objectStr, "permissions")
          : generateSchnorrProof(statement, req.subject, req.predicate, objectStr);

      // Both schnorr and membership use Knowledge proof type on Cortex
      // (Cortex Membership requires Merkle trees not available in JS)
      const cortexProofType = req.proofType === "membership" ? "knowledge" : req.proofType;

      const proofData: Record<string, unknown> = {
        type: "Knowledge",
        statement,
        subject: req.subject,
        predicate: req.predicate,
        object: objectStr,
        commitment: proofFields.commitment,
        challenge: proofFields.challenge,
        response: proofFields.response,
      };
      if (req.proofType === "membership") {
        proofData.set_type = "permissions";
      }

      const response = await this.client.submitProof({
        proof_type: cortexProofType,
        subject: req.subject,
        predicate: req.predicate,
        proof_data: proofData,
        metadata: req.metadata,
      });

      const status = response.status as string;
      const validStatuses = new Set<string>(["pending", "verified", "failed"]);

      return {
        proofId: response.id,
        status: validStatuses.has(status) ? (status as ProofResult["status"]) : "pending",
        proofType: req.proofType,
        subject: response.subject ?? req.subject,
        predicate: response.predicate ?? req.predicate,
        createdAt: response.created_at,
      };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`ZK proof request timed out after ${this.sandbox.proofTimeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
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
