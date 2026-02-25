import { describe, it, expect, beforeEach } from "vitest";
import { MetricsExporter } from "./metrics-exporter.js";

describe("MetricsExporter", () => {
  let exporter: MetricsExporter;

  beforeEach(() => {
    exporter = new MetricsExporter();
  });

  it("registers and increments a counter", () => {
    exporter.registerCounter("test_counter", "A test counter");
    exporter.incrementCounter("test_counter", { label: "a" });
    exporter.incrementCounter("test_counter", { label: "a" });
    exporter.incrementCounter("test_counter", { label: "b" });

    expect(exporter.getCounter("test_counter", { label: "a" })).toBe(2);
    expect(exporter.getCounter("test_counter", { label: "b" })).toBe(1);
  });

  it("registers and sets a gauge", () => {
    exporter.registerGauge("test_gauge", "A test gauge");
    exporter.setGauge("test_gauge", { scope: "session" }, 0.75);

    expect(exporter.getGauge("test_gauge", { scope: "session" })).toBe(0.75);
  });

  it("gauge can be overwritten", () => {
    exporter.registerGauge("active_skills", "Active skill count");
    exporter.setGauge("active_skills", {}, 3);
    exporter.setGauge("active_skills", {}, 5);

    expect(exporter.getGauge("active_skills")).toBe(5);
  });

  it("incrementing unregistered counter is a no-op", () => {
    exporter.incrementCounter("nonexistent", { x: "y" });
    expect(exporter.getCounter("nonexistent")).toBe(0);
  });

  it("setting unregistered gauge is a no-op", () => {
    exporter.setGauge("nonexistent", {}, 42);
    expect(exporter.getGauge("nonexistent")).toBe(0);
  });

  it("increment with custom amount", () => {
    exporter.registerCounter("tokens", "Token count");
    exporter.incrementCounter("tokens", { dir: "prompt" }, 150);
    exporter.incrementCounter("tokens", { dir: "prompt" }, 50);

    expect(exporter.getCounter("tokens", { dir: "prompt" })).toBe(200);
  });

  it("toPrometheus exports correct format", () => {
    exporter.registerCounter("http_requests_total", "Total HTTP requests");
    exporter.incrementCounter("http_requests_total", { method: "GET" }, 10);
    exporter.incrementCounter("http_requests_total", { method: "POST" }, 3);

    exporter.registerGauge("active_connections", "Active connection count");
    exporter.setGauge("active_connections", {}, 42);

    const output = exporter.toPrometheus();

    expect(output).toContain("# HELP http_requests_total Total HTTP requests");
    expect(output).toContain("# TYPE http_requests_total counter");
    expect(output).toContain('http_requests_total{method="GET"} 10');
    expect(output).toContain('http_requests_total{method="POST"} 3');
    expect(output).toContain("# HELP active_connections Active connection count");
    expect(output).toContain("# TYPE active_connections gauge");
    expect(output).toContain("active_connections 42");
    expect(output.endsWith("\n")).toBe(true);
  });

  it("toPrometheus handles empty exporter", () => {
    const output = exporter.toPrometheus();
    expect(output).toBe("\n");
  });

  it("toPrometheus escapes label values", () => {
    exporter.registerCounter("test", "test");
    exporter.incrementCounter("test", { path: '/api/v1/"quoted"' });

    const output = exporter.toPrometheus();
    expect(output).toContain('path="/api/v1/\\"quoted\\""');
  });

  it("labels with no entries produce no label string", () => {
    exporter.registerGauge("simple", "Simple gauge");
    exporter.setGauge("simple", {}, 1);

    const output = exporter.toPrometheus();
    expect(output).toContain("simple 1");
    expect(output).not.toContain("simple{");
  });

  it("reset clears all values but keeps registrations", () => {
    exporter.registerCounter("c", "counter");
    exporter.registerGauge("g", "gauge");
    exporter.incrementCounter("c", {}, 5);
    exporter.setGauge("g", {}, 10);

    exporter.reset();

    expect(exporter.getCounter("c")).toBe(0);
    expect(exporter.getGauge("g")).toBe(0);

    // Can still increment after reset
    exporter.incrementCounter("c", {}, 1);
    expect(exporter.getCounter("c")).toBe(1);
  });

  it("multiple label dimensions", () => {
    exporter.registerCounter("multi", "Multi-label counter");
    exporter.incrementCounter("multi", { method: "GET", status: "200" }, 5);
    exporter.incrementCounter("multi", { method: "POST", status: "201" }, 3);

    expect(exporter.getCounter("multi", { method: "GET", status: "200" })).toBe(5);
    expect(exporter.getCounter("multi", { method: "POST", status: "201" })).toBe(3);

    const output = exporter.toPrometheus();
    expect(output).toContain('multi{method="GET",status="200"} 5');
    expect(output).toContain('multi{method="POST",status="201"} 3');
  });

  it("duplicate register is idempotent", () => {
    exporter.registerCounter("dup", "first");
    exporter.incrementCounter("dup", {}, 3);

    // Re-register should not reset
    exporter.registerCounter("dup", "second");
    expect(exporter.getCounter("dup")).toBe(3);
  });
});
