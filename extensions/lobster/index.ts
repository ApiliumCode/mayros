import type {
  AnyAgentTool,
  MayrosPluginApi,
  MayrosPluginToolFactory,
} from "../../src/plugins/types.js";
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
