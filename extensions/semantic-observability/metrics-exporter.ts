/**
 * Prometheus Metrics Exporter
 *
 * Collects and exports metrics in Prometheus text exposition format.
 * No external dependencies — generates text directly.
 */

export type CounterMetric = {
  type: "counter";
  name: string;
  help: string;
  values: Map<string, number>; // label combo → value
};

export type GaugeMetric = {
  type: "gauge";
  name: string;
  help: string;
  values: Map<string, number>;
};

export type MetricDef = CounterMetric | GaugeMetric;

export class MetricsExporter {
  private counters = new Map<string, CounterMetric>();
  private gauges = new Map<string, GaugeMetric>();

  /**
   * Register a counter metric.
   */
  registerCounter(name: string, help: string): void {
    if (!this.counters.has(name)) {
      this.counters.set(name, { type: "counter", name, help, values: new Map() });
    }
  }

  /**
   * Register a gauge metric.
   */
  registerGauge(name: string, help: string): void {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, { type: "gauge", name, help, values: new Map() });
    }
  }

  /**
   * Increment a counter by the given amount (default 1).
   */
  incrementCounter(name: string, labels: Record<string, string> = {}, amount = 1): void {
    const counter = this.counters.get(name);
    if (!counter) return;

    const key = labelsToKey(labels);
    counter.values.set(key, (counter.values.get(key) ?? 0) + amount);
  }

  /**
   * Set a gauge to a specific value.
   */
  setGauge(name: string, labels: Record<string, string> = {}, value: number): void {
    const gauge = this.gauges.get(name);
    if (!gauge) return;

    const key = labelsToKey(labels);
    gauge.values.set(key, value);
  }

  /**
   * Get the current value of a counter.
   */
  getCounter(name: string, labels: Record<string, string> = {}): number {
    const counter = this.counters.get(name);
    if (!counter) return 0;
    return counter.values.get(labelsToKey(labels)) ?? 0;
  }

  /**
   * Get the current value of a gauge.
   */
  getGauge(name: string, labels: Record<string, string> = {}): number {
    const gauge = this.gauges.get(name);
    if (!gauge) return 0;
    return gauge.values.get(labelsToKey(labels)) ?? 0;
  }

  /**
   * Export all metrics in Prometheus text exposition format.
   */
  toPrometheus(): string {
    const lines: string[] = [];

    for (const counter of this.counters.values()) {
      lines.push(`# HELP ${counter.name} ${counter.help}`);
      lines.push(`# TYPE ${counter.name} counter`);
      for (const [key, value] of counter.values) {
        lines.push(`${counter.name}${key} ${value}`);
      }
    }

    for (const gauge of this.gauges.values()) {
      lines.push(`# HELP ${gauge.name} ${gauge.help}`);
      lines.push(`# TYPE ${gauge.name} gauge`);
      for (const [key, value] of gauge.values) {
        lines.push(`${gauge.name}${key} ${value}`);
      }
    }

    return lines.join("\n") + "\n";
  }

  /**
   * Reset all metric values (keep registrations).
   */
  reset(): void {
    for (const counter of this.counters.values()) {
      counter.values.clear();
    }
    for (const gauge of this.gauges.values()) {
      gauge.values.clear();
    }
  }
}

/**
 * Convert a labels record to Prometheus label format string.
 * e.g. {tool_name: "foo", status: "ok"} → '{tool_name="foo",status="ok"}'
 */
function labelsToKey(labels: Record<string, string>): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) return "";
  const parts = entries.map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return `{${parts.join(",")}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
