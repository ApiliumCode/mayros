/**
 * HTTP Hook Dispatcher
 *
 * Sends POST requests to configured webhook URLs when plugin hooks fire.
 * Supports HMAC-SHA256 signature verification, retry with exponential backoff,
 * and per-target event filtering.
 */

import { createHmac } from "node:crypto";

export type HttpHookTarget = {
  /** Webhook endpoint URL */
  url: string;
  /** Only deliver these hook events (empty = all) */
  events?: string[];
  /** HMAC-SHA256 secret for X-Mayros-Signature header */
  secret?: string;
  /** Max retries on failure (default: 2) */
  retries?: number;
  /** Request timeout in ms (default: 5000) */
  timeoutMs?: number;
  /** Custom headers to include */
  headers?: Record<string, string>;
};

export type HttpHookDispatcherOptions = {
  targets: HttpHookTarget[];
  logger?: {
    debug?: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  /** Override fetch for testing */
  fetchFn?: typeof globalThis.fetch;
};

type DispatchPayload = {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
};

function signPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

async function deliverWithRetry(
  target: HttpHookTarget,
  payload: DispatchPayload,
  fetchFn: typeof globalThis.fetch,
  logger?: HttpHookDispatcherOptions["logger"],
): Promise<boolean> {
  const maxRetries = Math.min(target.retries ?? 2, 5);
  const timeoutMs = Math.min(target.timeoutMs ?? 5000, 30_000);
  const body = JSON.stringify(payload);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Mayros-Webhook/1.0",
    "X-Mayros-Event": payload.event,
    ...target.headers,
  };

  if (target.secret) {
    headers["X-Mayros-Signature"] = `sha256=${signPayload(body, target.secret)}`;
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetchFn(target.url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        logger?.debug?.(`[http-hooks] delivered ${payload.event} to ${target.url}`);
        return true;
      }

      // 4xx errors are not retryable
      if (response.status >= 400 && response.status < 500) {
        logger?.warn(
          `[http-hooks] ${target.url} returned ${response.status} for ${payload.event}, not retrying`,
        );
        return false;
      }

      // 5xx — retry
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise((r) => setTimeout(r, delay));
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (attempt < maxRetries) {
        logger?.debug?.(
          `[http-hooks] attempt ${attempt + 1}/${maxRetries + 1} failed for ${target.url}: ${errMsg}`,
        );
        const delay = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        logger?.error(
          `[http-hooks] all ${maxRetries + 1} attempts failed for ${target.url}: ${errMsg}`,
        );
      }
    }
  }

  return false;
}

export class HttpHookDispatcher {
  private targets: HttpHookTarget[];
  private logger: HttpHookDispatcherOptions["logger"];
  private fetchFn: typeof globalThis.fetch;
  private pending: Promise<void>[] = [];

  constructor(opts: HttpHookDispatcherOptions) {
    this.targets = opts.targets.filter((t) => t.url);
    this.logger = opts.logger;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
  }

  /**
   * Dispatch a hook event to all matching targets.
   * Runs in the background — does not block the caller.
   */
  dispatch(event: string, data: Record<string, unknown>): void {
    if (this.targets.length === 0) return;

    const matching = this.targets.filter(
      (t) => !t.events || t.events.length === 0 || t.events.includes(event),
    );

    if (matching.length === 0) return;

    const payload: DispatchPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    const promise = Promise.all(
      matching.map((target) => deliverWithRetry(target, payload, this.fetchFn, this.logger)),
    ).then(() => {});

    this.pending.push(promise);

    // Clean up resolved promises
    void promise.finally(() => {
      const idx = this.pending.indexOf(promise);
      if (idx >= 0) void this.pending.splice(idx, 1);
    });
  }

  /** Number of configured targets */
  get targetCount(): number {
    return this.targets.length;
  }

  /** Whether any event matches at least one target */
  hasTargetsFor(event: string): boolean {
    return this.targets.some((t) => !t.events || t.events.length === 0 || t.events.includes(event));
  }

  /** Wait for all pending dispatches to complete (useful for graceful shutdown) */
  async drain(): Promise<void> {
    await Promise.all(this.pending);
  }
}

export function createHttpHookDispatcher(opts: HttpHookDispatcherOptions): HttpHookDispatcher {
  return new HttpHookDispatcher(opts);
}
