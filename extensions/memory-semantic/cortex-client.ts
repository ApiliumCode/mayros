/**
 * Re-export shim — all Cortex types and the CortexClient class are now
 * provided by the unified `extensions/shared/cortex-client.ts`.
 */
export {
  // DTOs
  type ValueDto,
  type TripleDto,
  type CreateTripleRequest,
  type ListTriplesQuery,
  type ListTriplesResponse,
  type PatternQueryRequest,
  type PatternQueryResponse,
  type ListSubjectsQuery,
  type ListSubjectsResponse,
  type ValidateRequest,
  type ValidationMessage,
  type TripleValidationResult,
  type ValidateResponse,
  type VerifyProofRequest,
  type VerifyProofResponse,
  type SubmitProofRequest,
  type ProofResponse,
  type ProofStatsResponse,
  type GraphStatsDto,
  type ServerStatsDto,
  type StatsResponse,
  type HealthResponse,
  // Error
  CortexError,
  // Client
  CortexClient,
} from "../shared/cortex-client.js";
