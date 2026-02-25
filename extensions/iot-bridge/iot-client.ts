/**
 * IoT Bridge — REST client for a single aingle_minimal node.
 * One CircuitBreaker per instance so a failing node doesn't affect others.
 */

import {
  CircuitBreaker,
  resilientFetch,
  type ResilienceConfig,
} from "../shared/cortex-resilience.js";
import type {
  ApiResponse,
  CreateEntryResponse,
  GetEntryResponse,
  NodeInfoResponse,
  ObservationPayload,
  PeerResponse,
  StatsResponse,
} from "./types.js";

export class IoTNodeClient {
  readonly host: string;
  readonly port: number;
  readonly breaker: CircuitBreaker;
  private readonly resilience: ResilienceConfig;
  private readonly baseUrl: string;

  constructor(host: string, port: number, resilience?: ResilienceConfig) {
    this.host = host;
    this.port = port;
    this.resilience = resilience ?? {};
    this.breaker = new CircuitBreaker({
      threshold: resilience?.circuitThreshold,
      resetMs: resilience?.circuitResetMs,
    });
    this.baseUrl = `http://${host}:${port}`;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async get<T>(path: string): Promise<ApiResponse<T>> {
    const res = await resilientFetch(
      `${this.baseUrl}${path}`,
      { method: "GET" },
      this.resilience,
      this.breaker,
    );
    return (await res.json()) as ApiResponse<T>;
  }

  private async post<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
    const res = await resilientFetch(
      `${this.baseUrl}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      this.resilience,
      this.breaker,
    );
    return (await res.json()) as ApiResponse<T>;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async isHealthy(): Promise<boolean> {
    try {
      const res = await resilientFetch(
        `${this.baseUrl}/health`,
        { method: "GET" },
        { ...this.resilience, maxRetries: 0 },
        this.breaker,
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async getInfo(): Promise<NodeInfoResponse> {
    const resp = await this.get<NodeInfoResponse>("/api/v1/info");
    if (!resp.success || !resp.data) {
      throw new Error(resp.error ?? "Failed to get node info");
    }
    return resp.data;
  }

  async getStats(): Promise<StatsResponse> {
    const resp = await this.get<StatsResponse>("/api/v1/stats");
    if (!resp.success || !resp.data) {
      throw new Error(resp.error ?? "Failed to get node stats");
    }
    return resp.data;
  }

  async getPeers(): Promise<PeerResponse[]> {
    const resp = await this.get<PeerResponse[]>("/api/v1/peers");
    if (!resp.success || !resp.data) {
      throw new Error(resp.error ?? "Failed to get peers");
    }
    return resp.data;
  }

  async createEntry(data: unknown): Promise<CreateEntryResponse> {
    const resp = await this.post<CreateEntryResponse>("/api/v1/entries", { data });
    if (!resp.success || !resp.data) {
      throw new Error(resp.error ?? "Failed to create entry");
    }
    return resp.data;
  }

  async getEntry(hash: string): Promise<GetEntryResponse | null> {
    try {
      const res = await resilientFetch(
        `${this.baseUrl}/api/v1/entries/${encodeURIComponent(hash)}`,
        { method: "GET" },
        this.resilience,
        this.breaker,
      );
      if (res.status === 404) return null;
      const resp = (await res.json()) as ApiResponse<GetEntryResponse>;
      if (!resp.success || !resp.data) return null;
      return resp.data;
    } catch {
      return null;
    }
  }

  async sendObservation(payload: ObservationPayload): Promise<CreateEntryResponse> {
    return this.createEntry(payload);
  }
}
