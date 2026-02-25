import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { emptyPluginConfigSchema } from "mayros/plugin-sdk";
import { createDiagnosticsOtelService } from "./src/service.js";

const plugin = {
  id: "diagnostics-otel",
  name: "Diagnostics OpenTelemetry",
  description: "Export diagnostics events to OpenTelemetry",
  configSchema: emptyPluginConfigSchema(),
  register(api: MayrosPluginApi) {
    api.registerService(createDiagnosticsOtelService());
  },
};

export default plugin;
