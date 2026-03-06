/**
 * Mayros Code Tools Plugin
 *
 * File read/write/edit, glob, grep, ls, and shell tools for local code interaction.
 * Provides the core filesystem and shell primitives used by coding agents.
 *
 * Tools: code_read, code_write, code_edit, code_glob, code_grep, code_ls, code_shell
 */

import { codeToolsConfigSchema } from "./config.js";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { registerCodeRead } from "./tools/code-read.js";
import { registerCodeWrite } from "./tools/code-write.js";
import { registerCodeEdit } from "./tools/code-edit.js";
import { registerCodeGlob } from "./tools/code-glob.js";
import { registerCodeGrep } from "./tools/code-grep.js";
import { registerCodeLs } from "./tools/code-ls.js";
import { registerCodeShell } from "./tools/code-shell.js";
import { registerCodeNotebook } from "./tools/code-notebook.js";

// ============================================================================
// Plugin Definition
// ============================================================================

const codeToolsPlugin = {
  id: "code-tools",
  name: "Code Tools",
  description: "File read/write/edit, glob, grep, ls, and shell tools for local code interaction",
  kind: "coding" as const,
  configSchema: codeToolsConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = codeToolsConfigSchema.parse(api.pluginConfig);

    registerCodeRead(api, cfg);
    registerCodeWrite(api, cfg);
    registerCodeEdit(api, cfg);
    registerCodeGlob(api, cfg);
    registerCodeGrep(api, cfg);
    registerCodeLs(api, cfg);
    registerCodeShell(api, cfg);
    registerCodeNotebook(api, cfg);

    api.logger.info(`code-tools: registered 9 tools (workspace: ${cfg.workspaceRoot})`);
  },
};

export default codeToolsPlugin;
