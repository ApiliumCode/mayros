/**
 * Zero-knowledge proof generation and verification for agent capabilities
 * and permissions, using the Cortex proof API.
 *
 * Proof types used:
 *   - Knowledge  — prove agent knows a capability without revealing all caps
 *   - Membership — prove agent has a permission in the set
 */

import type { CortexClient } from "../cortex-client.js";

// ============================================================================
// Types
// ============================================================================

export type CapabilityProof = {
  proofId: string;
  agentId: string;
  capability: string;
  submittedAt: string;
};

export type PermissionProof = {
  proofId: string;
  agentId: string;
  permission: string;
  submittedAt: string;
};

export type ProofVerification = {
  proofId: string;
  valid: boolean;
  verifiedAt: string;
  details: string[];
};

// ============================================================================
// Prover
// ============================================================================

export class IdentityProver {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /**
   * Create a Knowledge proof that an agent has a given capability.
   * The proof commits to the capability hash without revealing all capabilities.
   */
  async proveCapability(agentId: string, capability: string): Promise<CapabilityProof> {
    const result = await this.client.submitProof({
      proof_type: "Knowledge",
      proof_data: {
        statement: `${this.ns}:agent:${agentId} has capability ${capability}`,
        subject: `${this.ns}:agent:${agentId}`,
        predicate: `${this.ns}:identity:capability`,
        object: capability,
      },
      metadata: {
        submitter: agentId,
        tags: ["capability", "identity"],
        extra: { namespace: this.ns },
      },
    });

    return {
      proofId: result.id,
      agentId,
      capability,
      submittedAt: result.created_at,
    };
  }

  /**
   * Create a Membership proof that an agent holds a given permission.
   */
  async provePermission(agentId: string, permission: string): Promise<PermissionProof> {
    const result = await this.client.submitProof({
      proof_type: "Membership",
      proof_data: {
        statement: `${this.ns}:agent:${agentId} has permission ${permission}`,
        subject: `${this.ns}:agent:${agentId}`,
        predicate: `${this.ns}:identity:permission`,
        object: permission,
        set_type: "permissions",
      },
      metadata: {
        submitter: agentId,
        tags: ["permission", "identity"],
        extra: { namespace: this.ns },
      },
    });

    return {
      proofId: result.id,
      agentId,
      permission,
      submittedAt: result.created_at,
    };
  }

  /**
   * Verify a previously submitted proof.
   */
  async verifyProof(proofId: string): Promise<ProofVerification> {
    const result = await this.client.verifyProof(proofId);
    return {
      proofId,
      valid: result.valid,
      verifiedAt: result.details.verified_at,
      details: [],
    };
  }

  /**
   * Check if an agent's capability proof is still valid.
   */
  async verifyCapabilityProof(proofId: string): Promise<ProofVerification> {
    return this.verifyProof(proofId);
  }
}
