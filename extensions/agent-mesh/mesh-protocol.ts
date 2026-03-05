/**
 * Mesh Protocol Types
 *
 * Message types and data structures for inter-agent exchange
 * within the MAYROS agent coordination mesh.
 */

export type MeshMessageType =
  | "knowledge-share"
  | "delegation-context"
  | "merge-request"
  | "conflict-alert"
  | "task"
  | "finding"
  | "question"
  | "status-update";

export type MeshMessage = {
  type: MeshMessageType;
  fromAgent: string;
  toAgent: string;
  namespace: string;
  payload: Record<string, unknown>;
  timestamp: number;
};

export type DelegationContext = {
  task: string;
  parentAgentId: string;
  relevantTriples: Triple[];
  relatedMemories: string[];
  namespace: string;
  timestamp: number;
};

export type Triple = {
  subject: string;
  predicate: string;
  object: string;
};

export type MergeStrategy =
  | "additive"
  | "replace"
  | "conflict-flag"
  | "newest-wins"
  | "majority-wins";

export type ConflictResolution = {
  subject: string;
  predicate: string;
  resolvedValue: string;
  strategy: string;
  discardedValues: string[];
};

export type MergeReport = {
  added: number;
  skipped: number;
  conflicts: number;
  details: string[];
};

export type FusionReport = MergeReport & {
  strategy: MergeStrategy;
  sourceNs: string;
  targetNs: string;
  resolutions?: ConflictResolution[];
};

export type Conflict = {
  subject: string;
  predicate: string;
  values: string[];
  namespaces: string[];
};

export type SynthesisResult = {
  totalTriples: number;
  namespaces: string[];
  summary: string;
  keyFacts: string[];
};

export type NamespaceInfo = {
  namespace: string;
  owner: string;
  accessLevel: AccessLevel;
  tripleCount: number;
};

export type AccessLevel = "none" | "read" | "write" | "admin";

export type Grant = {
  id: string;
  agent: string;
  namespace: string;
  level: AccessLevel;
  grantedBy: string;
  grantedAt: number;
};

/**
 * Validates that a value is a recognized MeshMessageType.
 */
export function isValidMessageType(type: string): type is MeshMessageType {
  return [
    "knowledge-share",
    "delegation-context",
    "merge-request",
    "conflict-alert",
    "task",
    "finding",
    "question",
    "status-update",
  ].includes(type);
}

/**
 * Validates that a value is a recognized AccessLevel.
 */
export function isValidAccessLevel(level: string): level is AccessLevel {
  return ["none", "read", "write", "admin"].includes(level);
}

/**
 * Creates a well-formed MeshMessage.
 */
export function createMeshMessage(
  type: MeshMessageType,
  fromAgent: string,
  toAgent: string,
  namespace: string,
  payload: Record<string, unknown>,
): MeshMessage {
  return {
    type,
    fromAgent,
    toAgent,
    namespace,
    payload,
    timestamp: Date.now(),
  };
}

/**
 * Access level hierarchy for permission checks.
 * Higher number = more permissive.
 */
const ACCESS_LEVEL_RANK: Record<AccessLevel, number> = {
  none: 0,
  read: 1,
  write: 2,
  admin: 3,
};

/**
 * Checks if the granted level satisfies the required level.
 */
export function accessLevelSatisfies(granted: AccessLevel, required: AccessLevel): boolean {
  return ACCESS_LEVEL_RANK[granted] >= ACCESS_LEVEL_RANK[required];
}
