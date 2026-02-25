/**
 * HTTP client for Titans Memory endpoints on the Cortex REST API.
 *
 * Maps to the /api/v1/memory/* routes that expose the TitansMemory
 * module (STM + LTM with consolidation).
 */

import type { CortexConfig } from "./config.js";

// ============================================================================
// DTOs — mirror titans_memory types via Cortex REST
// ============================================================================

export type MemoryEntryDto = {
  entry_type: string;
  data: unknown;
  tags?: string[];
  importance?: number;
  embedding?: number[];
};

export type MemoryQueryDto = {
  text?: string;
  tags?: string[];
  entry_type?: string;
  min_importance?: number;
  limit?: number;
};

export type MemoryResultDto = {
  id: string;
  entry_type: string;
  data: unknown;
  tags: string[];
  importance: number;
  relevance: number;
  source: "ShortTerm" | "LongTerm";
  created_at: string;
  last_accessed: string;
  access_count: number;
};

export type MemoryStatsDto = {
  stm_count: number;
  stm_capacity: number;
  ltm_entity_count: number;
  ltm_link_count: number;
  total_memory_bytes: number;
};

export type CheckpointDto = {
  id: string;
  label?: string;
  created_at: string;
  stm_count: number;
  ltm_entity_count: number;
};

// ============================================================================
// Client
// ============================================================================

export class TitansClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: CortexConfig) {
    this.baseUrl = `http://${config.host}:${config.port}`;
    this.headers = { "Content-Type": "application/json" };
    if (config.authToken) {
      this.headers["Authorization"] = config.authToken;
    }
  }

  // ---------- helpers ----------

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: this.headers,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new Error(`Titans Memory unreachable at ${url}: ${String(err)}`);
    }

    if (!res.ok) {
      let errorMsg = `Titans ${method} ${path} failed with ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) errorMsg = body.error;
      } catch {
        // non-JSON
      }
      throw new Error(errorMsg);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // ---------- Memory Operations ----------

  async remember(entry: MemoryEntryDto): Promise<{ id: string }> {
    return this.request("POST", "/api/v1/memory/remember", entry);
  }

  async recall(query: MemoryQueryDto): Promise<MemoryResultDto[]> {
    return this.request("POST", "/api/v1/memory/recall", query);
  }

  async consolidate(): Promise<{ consolidated: number }> {
    return this.request("POST", "/api/v1/memory/consolidate");
  }

  async forget(id: string): Promise<void> {
    return this.request("DELETE", `/api/v1/memory/${encodeURIComponent(id)}`);
  }

  async stats(): Promise<MemoryStatsDto> {
    return this.request("GET", "/api/v1/memory/stats");
  }

  // ---------- Checkpoints ----------

  async createCheckpoint(label?: string): Promise<{ checkpointId: string }> {
    return this.request("POST", "/api/v1/memory/checkpoint", label ? { label } : {});
  }

  async listCheckpoints(): Promise<CheckpointDto[]> {
    return this.request("GET", "/api/v1/memory/checkpoints");
  }

  async restoreCheckpoint(id: string): Promise<void> {
    return this.request("POST", `/api/v1/memory/restore/${encodeURIComponent(id)}`);
  }

  // ---------- convenience ----------

  async isAvailable(): Promise<boolean> {
    try {
      await this.stats();
      return true;
    } catch {
      return false;
    }
  }
}
