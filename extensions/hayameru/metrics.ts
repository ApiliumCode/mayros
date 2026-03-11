export type BoostMetrics = {
  totalAttempts: number;
  boostSuccesses: number;
  boostFailures: number;
  estimatedTokensSaved: number;
  avgTransformMs: number;
  byTransform: Record<string, { count: number; avgMs: number; totalMs: number }>;
};

export class HayameruMetrics {
  private data: BoostMetrics = {
    totalAttempts: 0,
    boostSuccesses: 0,
    boostFailures: 0,
    estimatedTokensSaved: 0,
    avgTransformMs: 0,
    byTransform: {},
  };

  private totalTransformMs = 0;

  recordAttempt(): void {
    this.data.totalAttempts++;
  }

  /**
   * Record a successful transform.
   * @param transformKind - the type of transform applied
   * @param durationMs - actual measured wall-clock time for the transform
   * @param fileSizeBytes - size of the file in bytes; used to estimate tokens via Math.ceil(bytes/4)
   */
  recordSuccess(transformKind: string, durationMs: number, fileSizeBytes: number): void {
    this.data.boostSuccesses++;
    this.data.estimatedTokensSaved += Math.ceil(fileSizeBytes / 4);
    this.totalTransformMs += durationMs;
    this.data.avgTransformMs =
      this.data.boostSuccesses > 0 ? this.totalTransformMs / this.data.boostSuccesses : 0;

    const entry = this.data.byTransform[transformKind] ?? { count: 0, avgMs: 0, totalMs: 0 };
    entry.count++;
    entry.totalMs += durationMs;
    entry.avgMs = entry.totalMs / entry.count;
    this.data.byTransform[transformKind] = entry;
  }

  recordFailure(): void {
    this.data.boostFailures++;
  }

  getMetrics(): BoostMetrics {
    return { ...this.data };
  }

  reset(): void {
    this.data = {
      totalAttempts: 0,
      boostSuccesses: 0,
      boostFailures: 0,
      estimatedTokensSaved: 0,
      avgTransformMs: 0,
      byTransform: {},
    };
    this.totalTransformMs = 0;
  }
}
