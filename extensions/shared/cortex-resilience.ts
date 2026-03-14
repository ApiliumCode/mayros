/**
 * Cortex Resilience — shared circuit breaker, retry, and timeout logic
 * for all CortexClient implementations across MAYROS extensions.
 */

export type ResilienceConfig = {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  circuitThreshold?: number;
  circuitResetMs?: number;
};

export type CircuitState = "closed" | "open" | "half-open";

export type CircuitBreakerOptions = {
  threshold?: number;
  resetMs?: number;
  onOpen?: () => void;
  onClose?: () => void;
  halfOpenSuccessThreshold?: number;
};

export class CircuitBreaker {
  private failures = 0;
  private state: CircuitState = "closed";
  private openedAt = 0;
  private halfOpenSuccesses = 0;
  private readonly threshold: number;
  private readonly resetMs: number;
  private readonly onOpen?: () => void;
  private readonly onClose?: () => void;
  private readonly halfOpenSuccessThreshold: number;

  constructor(opts?: CircuitBreakerOptions) {
    this.threshold = opts?.threshold ?? 5;
    this.resetMs = opts?.resetMs ?? 30_000;
    this.onOpen = opts?.onOpen;
    this.onClose = opts?.onClose;
    this.halfOpenSuccessThreshold = opts?.halfOpenSuccessThreshold ?? 2;
  }

  getState(): CircuitState {
    if (this.state === "open" && Date.now() - this.openedAt >= this.resetMs) {
      this.state = "half-open";
    }
    return this.state;
  }

  getFailures(): number {
    return this.failures;
  }

  recordSuccess(): void {
    if (this.state === "half-open") {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.halfOpenSuccessThreshold) {
        this.failures = 0;
        this.halfOpenSuccesses = 0;
        this.state = "closed";
        this.onClose?.();
      }
      return;
    }
    this.failures = 0;
    this.state = "closed";
  }

  recordFailure(): void {
    this.failures++;
    this.halfOpenSuccesses = 0;
    if (this.failures >= this.threshold) {
      this.state = "open";
      this.openedAt = Date.now();
      this.onOpen?.();
    }
  }

  isCallPermitted(): boolean {
    const s = this.getState();
    return s === "closed" || s === "half-open";
  }

  reset(): void {
    this.failures = 0;
    this.halfOpenSuccesses = 0;
    this.state = "closed";
    this.openedAt = 0;
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 300;
const MAX_RETRY_DELAY_MS = 60_000;

function isRetryable(err: unknown): boolean {
  if (err instanceof Response) {
    return err.status >= 500;
  }
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Add 0-30% random jitter to prevent thundering herd (CSPRNG). */
function jitter(ms: number): number {
  const buf = new Uint8Array(2);
  crypto.getRandomValues(buf);
  const fraction = ((buf[0]! << 8) | buf[1]!) / 65536; // 0..1 with 16-bit resolution
  return ms + ms * fraction * 0.3;
}

export async function resilientFetch(
  url: string,
  init: RequestInit,
  config?: ResilienceConfig,
  breaker?: CircuitBreaker,
): Promise<Response> {
  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = config?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  if (breaker && !breaker.isCallPermitted()) {
    throw new Error("Circuit breaker is open — Cortex calls are temporarily suspended");
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (res.status >= 500) {
        breaker?.recordFailure();
        if (attempt < maxRetries) {
          await delay(jitter(Math.min(retryDelayMs * 2 ** attempt, MAX_RETRY_DELAY_MS)));
          continue;
        }
        return res;
      }

      breaker?.recordSuccess();
      return res;
    } catch (err) {
      lastError = err;
      breaker?.recordFailure();

      if (attempt < maxRetries && isRetryable(err)) {
        await delay(jitter(Math.min(retryDelayMs * 2 ** attempt, MAX_RETRY_DELAY_MS)));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`resilientFetch failed after ${maxRetries + 1} attempts`);
}
