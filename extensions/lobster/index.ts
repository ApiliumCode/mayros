import type { AnyAgentTool, MayrosPluginApi, MayrosPluginToolFactory } from "mayros/plugin-sdk";
import { createLobsterTool } from "./src/lobster-tool.js";

export default function register(api: MayrosPluginApi) {
  api.registerTool(
    ((ctx) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createLobsterTool(api) as AnyAgentTool;
    }) as MayrosPluginToolFactory,
    { optional: true },
  );
}
