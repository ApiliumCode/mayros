/**
 * Re-export shim — all Cortex types and the CortexClient class are now
 * provided by the unified `extensions/shared/cortex-client.ts`.
 *
 * This file re-exports the subset used by the semantic-skills extension,
 * including the TripleMatch alias.
 */
export {
  // Error
  CortexError,
  // DTOs
  type ValueDto,
  type TripleMatch,
  type PatternQueryRequest,
  type PatternQueryResponse,
  type CreateTripleRequest,
  type ValidateRequest,
  type ValidateResponse,
  type SubmitProofRequest,
  type ProofResponse,
  type HealthResponse,
  // Client
  CortexClient,
} from "../shared/cortex-client.js";
