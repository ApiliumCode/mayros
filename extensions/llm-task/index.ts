import type { AnyAgentTool, MayrosPluginApi } from "mayros/plugin-sdk";
import { createLlmTaskTool } from "./src/llm-task-tool.js";

export default function register(api: MayrosPluginApi) {
  api.registerTool(createLlmTaskTool(api) as unknown as AnyAgentTool, { optional: true });
}
