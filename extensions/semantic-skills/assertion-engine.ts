import type { CortexClient, ValueDto } from "./cortex-client.js";
import type { ProofClient } from "./proof-client.js";
import type { SemanticAssertionDecl } from "./skill-manifest.js";

export type AssertionResult = {
  subject: string;
  predicate: string;
  object: unknown;
  tripleHash: string;
  proofHash?: string;
  verified: boolean;
};

export type VerifyAssertionResult = {
  subject: string;
  predicate: string;
  found: boolean;
  verified: boolean;
  proofHash?: string;
};

export class AssertionEngine {
  private assertionCount = 0;

  constructor(
    private client: CortexClient,
    private proofClient: ProofClient,
    private namespace: string,
    private maxAssertions: number,
    private declaredAssertions: SemanticAssertionDecl[],
  ) {}

  async publish(
    subject: string,
    predicate: string,
    object: unknown,
    options?: { requireProof?: boolean; proofType?: string },
  ): Promise<AssertionResult> {
    if (this.assertionCount >= this.maxAssertions) {
      throw new Error(
        `Assertion limit reached (${this.maxAssertions}). Cannot publish more assertions.`,
      );
    }

    // Check if this predicate is declared in the manifest
    const decl = this.declaredAssertions.find((a) => a.predicate === predicate);
    const needsProof = options?.requireProof ?? decl?.requireProof ?? false;

    // Namespace the subject if not already prefixed
    const nsSubject = subject.startsWith(`${this.namespace}:`)
      ? subject
      : `${this.namespace}:${subject}`;
    const nsPredicate = predicate.startsWith(`${this.namespace}:`)
      ? predicate
      : `${this.namespace}:${predicate}`;

    // Create the triple
    const triple = await this.client.createTriple({
      subject: nsSubject,
      predicate: nsPredicate,
      object: object as ValueDto,
    });
    const hash = triple.id ?? "";

    let proofHash: string | undefined;
    let verified = true;

    // Request PoL proof if required
    if (needsProof) {
      const polResult = await this.proofClient.requestPolProof(nsSubject, nsPredicate, object);
      verified = polResult.valid;
      proofHash = polResult.proofHash;
    }

    this.assertionCount++;

    return {
      subject: nsSubject,
      predicate: nsPredicate,
      object,
      tripleHash: hash,
      proofHash,
      verified,
    };
  }

  async verify(
    subject: string,
    predicate: string,
    proofId?: string,
  ): Promise<VerifyAssertionResult> {
    const nsSubject = subject.startsWith(`${this.namespace}:`)
      ? subject
      : `${this.namespace}:${subject}`;
    const nsPredicate = predicate.startsWith(`${this.namespace}:`)
      ? predicate
      : `${this.namespace}:${predicate}`;

    // Find the triple in the graph
    const result = await this.client.patternQuery({
      subject: nsSubject,
      predicate: nsPredicate,
      limit: 1,
    });

    if (result.matches.length === 0) {
      return {
        subject: nsSubject,
        predicate: nsPredicate,
        found: false,
        verified: false,
      };
    }

    // If proofId is given, verify that specific proof
    if (proofId) {
      const verifyResult = await this.proofClient.verifyZkProof(proofId);
      return {
        subject: nsSubject,
        predicate: nsPredicate,
        found: true,
        verified: verifyResult.verified,
        proofHash: proofId,
      };
    }

    // Otherwise do PoL validation
    const triple = result.matches[0];
    const polResult = await this.proofClient.verifyPolProof(nsSubject, nsPredicate, triple.object);

    return {
      subject: nsSubject,
      predicate: nsPredicate,
      found: true,
      verified: polResult.valid,
    };
  }

  get currentCount(): number {
    return this.assertionCount;
  }

  reset(): void {
    this.assertionCount = 0;
  }
}
