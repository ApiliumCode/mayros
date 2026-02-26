export interface SyncCheckpoint {
  namespace: string;
  agentId: string;
  timestamp: string;
}

export interface SyncConflict {
  subject: string;
  localValue: unknown;
  remoteValue: unknown;
  detectedAt: string;
}
