/**
 * HealthMonitor — background health prober for the Cortex sidecar.
 *
 * Replaces the sticky `cortexAvailable` pattern with adaptive probing.
 * Probes are more frequent when unhealthy (faster recovery detection)
 * and less frequent when healthy (lower overhead).
 */

export type HealthStatus = "healthy" | "unhealthy" | "unknown";
export type HealthListener = (status: HealthStatus) => void;

export type HealthMonitorOptions = {
  /** Probe interval when healthy (ms). Default: 15_000. */
  intervalMs?: number;
  /** Probe interval when unhealthy (ms). Default: 5_000. */
  unhealthyIntervalMs?: number;
  /** Called on transition to healthy. */
  onHealthy?: () => void;
  /** Called on transition to unhealthy. */
  onUnhealthy?: () => void;
};

export class HealthMonitor {
  private status: HealthStatus = "unknown";
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<HealthListener> = new Set();
  private readonly intervalMs: number;
  private readonly unhealthyIntervalMs: number;
  private readonly onHealthy?: () => void;
  private readonly onUnhealthy?: () => void;

  constructor(
    private readonly client: { isHealthy(): Promise<boolean> },
    options?: HealthMonitorOptions,
  ) {
    this.intervalMs = options?.intervalMs ?? 15_000;
    this.unhealthyIntervalMs = options?.unhealthyIntervalMs ?? 5_000;
    this.onHealthy = options?.onHealthy;
    this.onUnhealthy = options?.onUnhealthy;
  }

  /**
   * Begin probing. First probe is immediate, then adaptive interval.
   */
  start(): void {
    if (this.timer) return;
    // Immediate first probe
    void this.probe();
    this.scheduleNext();
  }

  /**
   * Stop probing. Clears timer, resets status to unknown, removes all subscribers.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.status = "unknown";
    this.listeners.clear();
  }

  getStatus(): HealthStatus {
    return this.status;
  }

  /** Synchronous check of last known status. */
  isHealthy(): boolean {
    return this.status === "healthy";
  }

  /**
   * Subscribe to health status transitions. Returns an unsubscribe function.
   */
  subscribe(listener: HealthListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---------- internals ----------

  private scheduleNext(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    const interval = this.status === "healthy" ? this.intervalMs : this.unhealthyIntervalMs;
    this.timer = setInterval(() => {
      void this.probe();
    }, interval);
    // Allow timer to not block process exit
    if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  private async probe(): Promise<void> {
    const previousStatus = this.status;
    let healthy: boolean;
    try {
      healthy = await this.client.isHealthy();
    } catch {
      healthy = false;
    }

    const newStatus: HealthStatus = healthy ? "healthy" : "unhealthy";
    this.status = newStatus;

    // Detect transitions and reschedule with adaptive interval
    if (previousStatus !== newStatus) {
      // Reschedule with the appropriate interval
      this.scheduleNext();

      if (newStatus === "healthy") {
        this.onHealthy?.();
      } else if (newStatus === "unhealthy") {
        this.onUnhealthy?.();
      }

      for (const listener of this.listeners) {
        try {
          listener(newStatus);
        } catch {
          // Listener errors are swallowed to prevent cascading failures
        }
      }
    }
  }
}
