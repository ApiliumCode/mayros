/**
 * Session Teleport — export/import sessions between devices.
 *
 * Exports a complete session as a portable JSON bundle including:
 * - Session metadata (SessionEntry)
 * - Transcript JSONL content (base64-encoded)
 * - Cortex triples from the session namespace
 * - Optional project memory triples
 *
 * Import restores the bundle into the local environment.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import type {
  CortexClient,
  TripleDto,
  CreateTripleRequest,
} from "../../extensions/shared/cortex-client.js";

// ============================================================================
// Types
// ============================================================================

export const TELEPORT_VERSION = 1 as const;

export type TeleportBundle = {
  version: typeof TELEPORT_VERSION;
  exportedAt: string;
  sourceDeviceId: string;
  sessionKey: string;
  transcript: string;
  sessionStore: Record<string, unknown>;
  cortexTriples: TripleDto[];
  projectMemory?: TripleDto[];
};

export type ExportOptions = {
  sessionKey: string;
  transcriptPath: string;
  storePath: string;
  cortexClient?: CortexClient;
  namespace?: string;
  includeProjectMemory?: boolean;
  deviceId?: string;
};

export type ImportOptions = {
  bundle: TeleportBundle;
  targetTranscriptDir: string;
  targetStorePath: string;
  cortexClient?: CortexClient;
  namespace?: string;
  remapSessionKey?: string;
};

export type ExportResult = {
  bundle: TeleportBundle;
  transcriptSize: number;
  tripleCount: number;
};

export type ImportResult = {
  sessionKey: string;
  transcriptPath: string;
  triplesImported: number;
  remapped: boolean;
};

// ============================================================================
// Device ID
// ============================================================================

function getDeviceId(): string {
  const hostname = process.env.HOSTNAME ?? process.env.COMPUTERNAME ?? "unknown";
  return `${hostname}-${randomUUID().slice(0, 8)}`;
}

// ============================================================================
// Export
// ============================================================================

/**
 * Export a session as a portable TeleportBundle.
 */
export async function exportSession(opts: ExportOptions): Promise<ExportResult> {
  const {
    sessionKey,
    transcriptPath,
    storePath,
    cortexClient,
    namespace,
    includeProjectMemory = false,
    deviceId,
  } = opts;

  // 1. Read transcript
  let transcriptContent = "";
  let transcriptSize = 0;
  if (existsSync(transcriptPath)) {
    const raw = readFileSync(transcriptPath, "utf-8");
    const rawBuf = Buffer.from(raw);
    transcriptContent = rawBuf.toString("base64");
    transcriptSize = rawBuf.length;
  }

  // 2. Read session store entry
  let sessionStore: Record<string, unknown> = {};
  if (existsSync(storePath)) {
    try {
      const storeData = JSON.parse(readFileSync(storePath, "utf-8")) as Record<string, unknown>;
      if (storeData[sessionKey]) {
        sessionStore = storeData[sessionKey] as Record<string, unknown>;
      }
    } catch {
      // Store unreadable
    }
  }

  // 3. Extract Cortex triples for session namespace
  let cortexTriples: TripleDto[] = [];
  let projectMemory: TripleDto[] | undefined;
  let tripleCount = 0;

  if (cortexClient && namespace) {
    try {
      const healthy = await cortexClient.isHealthy();
      if (healthy) {
        // Session triples
        const sessionResult = await cortexClient.listTriples({
          subject: `${namespace}:session:`,
          limit: 10000,
        });
        cortexTriples = sessionResult.triples;

        // Project memory triples
        if (includeProjectMemory) {
          const projectResult = await cortexClient.listTriples({
            subject: `${namespace}:project:`,
            limit: 10000,
          });
          projectMemory = projectResult.triples;
        }

        tripleCount = cortexTriples.length + (projectMemory?.length ?? 0);
      }
    } catch {
      // Cortex unavailable — export without triples
    }
  }

  const bundle: TeleportBundle = {
    version: TELEPORT_VERSION,
    exportedAt: new Date().toISOString(),
    sourceDeviceId: deviceId ?? getDeviceId(),
    sessionKey,
    transcript: transcriptContent,
    sessionStore,
    cortexTriples,
    projectMemory,
  };

  return { bundle, transcriptSize, tripleCount };
}

/**
 * Validate a TeleportBundle structure.
 */
export function validateBundle(data: unknown): data is TeleportBundle {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;

  if (obj.version !== TELEPORT_VERSION) return false;
  if (typeof obj.exportedAt !== "string") return false;
  if (typeof obj.sourceDeviceId !== "string") return false;
  if (typeof obj.sessionKey !== "string") return false;
  if (typeof obj.transcript !== "string") return false;
  if (!obj.sessionStore || typeof obj.sessionStore !== "object" || Array.isArray(obj.sessionStore))
    return false;
  if (!Array.isArray(obj.cortexTriples)) return false;

  return true;
}

// ============================================================================
// Import
// ============================================================================

/**
 * Import a TeleportBundle into the local environment.
 */
export async function importSession(opts: ImportOptions): Promise<ImportResult> {
  const { bundle, targetTranscriptDir, targetStorePath, cortexClient, namespace, remapSessionKey } =
    opts;

  const sessionKey = remapSessionKey ?? bundle.sessionKey;
  const remapped = !!remapSessionKey && remapSessionKey !== bundle.sessionKey;

  // 1. Write transcript
  const transcriptDir = resolve(targetTranscriptDir);
  mkdirSync(transcriptDir, { recursive: true });

  // Always use the (possibly remapped) sessionKey for the transcript filename
  const transcriptPath = resolve(transcriptDir, `${sessionKey}.jsonl`);

  if (bundle.transcript) {
    const decoded = Buffer.from(bundle.transcript, "base64").toString("utf-8");
    writeFileSync(transcriptPath, decoded, "utf-8");
  }

  // 2. Update session store
  if (existsSync(targetStorePath)) {
    try {
      const store = JSON.parse(readFileSync(targetStorePath, "utf-8")) as Record<string, unknown>;
      const entry = { ...bundle.sessionStore, updatedAt: Date.now() };
      if (remapped) {
        (entry as Record<string, unknown>).sessionId = sessionKey;
      }
      store[sessionKey] = entry;
      writeFileSync(targetStorePath, JSON.stringify(store, null, 2), "utf-8");
    } catch {
      // If store doesn't parse, create a new one
      const store = { [sessionKey]: { ...bundle.sessionStore, updatedAt: Date.now() } };
      writeFileSync(targetStorePath, JSON.stringify(store, null, 2), "utf-8");
    }
  } else {
    mkdirSync(dirname(targetStorePath), { recursive: true });
    const store = { [sessionKey]: { ...bundle.sessionStore, updatedAt: Date.now() } };
    writeFileSync(targetStorePath, JSON.stringify(store, null, 2), "utf-8");
  }

  // 3. Import Cortex triples
  let triplesImported = 0;

  if (cortexClient && namespace) {
    try {
      const healthy = await cortexClient.isHealthy();
      if (healthy) {
        // Import session triples
        for (const triple of bundle.cortexTriples) {
          const req: CreateTripleRequest = {
            subject: remapped
              ? triple.subject.replaceAll(bundle.sessionKey, sessionKey)
              : triple.subject,
            predicate: triple.predicate,
            object: triple.object,
          };
          await cortexClient.createTriple(req);
          triplesImported++;
        }

        // Import project memory triples
        if (bundle.projectMemory) {
          for (const triple of bundle.projectMemory) {
            await cortexClient.createTriple({
              subject: triple.subject,
              predicate: triple.predicate,
              object: triple.object,
            });
            triplesImported++;
          }
        }
      }
    } catch {
      // Cortex unavailable — import without triples
    }
  }

  return {
    sessionKey,
    transcriptPath,
    triplesImported,
    remapped,
  };
}
