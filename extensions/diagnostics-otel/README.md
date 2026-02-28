# @apilium/mayros-diagnostics-otel

Mayros diagnostics OpenTelemetry exporter -- exports traces, metrics, and logs to any OTLP-compatible backend.

## Installation

```bash
mayros plugin install @apilium/mayros-diagnostics-otel
```

## Configuration

Add to your `mayros.toml`:

```toml
[diagnostics]
enabled = true

[diagnostics.otel]
enabled = true
endpoint = "http://localhost:4318"   # OTLP HTTP endpoint
serviceName = "mayros"               # service.name resource attribute
protocol = "http/protobuf"           # only http/protobuf is supported
sampleRate = 1.0                     # trace sampling ratio (0.0 - 1.0)
traces = true                        # enable trace export
metrics = true                       # enable metric export
logs = false                         # enable log export (opt-in)
flushIntervalMs = 5000               # export interval for metrics and logs
# headers = { Authorization = "Bearer ..." }
```

## Environment Variables

- `OTEL_EXPORTER_OTLP_ENDPOINT` -- fallback OTLP endpoint when `diagnostics.otel.endpoint` is not set
- `OTEL_EXPORTER_OTLP_PROTOCOL` -- fallback protocol (default `http/protobuf`)
- `OTEL_SERVICE_NAME` -- fallback service name (default `mayros`)

## Exported Telemetry

**Metrics:**

- `mayros.tokens` -- token usage by type (input, output, cache_read, cache_write, total)
- `mayros.cost.usd` -- estimated model cost
- `mayros.run.duration_ms` -- agent run duration
- `mayros.context.tokens` -- context window size and usage
- `mayros.webhook.received` / `mayros.webhook.error` / `mayros.webhook.duration_ms`
- `mayros.message.queued` / `mayros.message.processed` / `mayros.message.duration_ms`
- `mayros.queue.depth` / `mayros.queue.wait_ms` / `mayros.queue.lane.*`
- `mayros.session.state` / `mayros.session.stuck` / `mayros.session.stuck_age_ms`
- `mayros.run.attempt`

**Traces:** spans for model usage, webhook processing, message processing, and stuck sessions.

**Logs:** structured log records forwarded from the Mayros logger (when `logs = true`).

## License

MIT -- Apilium Technologies
