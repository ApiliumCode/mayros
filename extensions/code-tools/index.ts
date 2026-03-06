/**
 * Mayros Code Tools Plugin
 *
 * File read/write/edit, glob, grep, ls, shell, notebook, web search, and web fetch
 * tools for local code interaction. Provides the core filesystem, shell, and web
 * primitives used by coding agents.
 *
 * Tools: code_read, code_read_many, code_write, code_edit, code_glob, code_grep, code_ls,
 *        code_shell, code_notebook, code_multi_edit, code_shell_interactive, code_web_search,
 *        code_web_fetch, git_commit, git_push, git_create_pr
 */

import { codeToolsConfigSchema } from "./config.js";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { registerCodeRead } from "./tools/code-read.js";
import { registerCodeReadMany } from "./tools/code-read-many.js";
import { registerCodeWrite } from "./tools/code-write.js";
import { registerCodeEdit } from "./tools/code-edit.js";
import { registerCodeGlob } from "./tools/code-glob.js";
import { registerCodeGrep } from "./tools/code-grep.js";
import { registerCodeLs } from "./tools/code-ls.js";
import { registerCodeShell } from "./tools/code-shell.js";
import { registerCodeNotebook } from "./tools/code-notebook.js";
import { registerCodeMultiEdit } from "./tools/code-multi-edit.js";
import { registerCodeShellInteractive } from "./tools/code-shell-interactive.js";
import { registerWebSearch } from "./tools/web-search.js";
import { registerWebFetch } from "./tools/web-fetch.js";
import { registerGitCommit, registerGitPush, registerGitCreatePr } from "./tools/git-commit.js";

// ============================================================================
// Plugin Definition
// ============================================================================

const codeToolsPlugin = {
  id: "code-tools",
  name: "Code Tools",
  description:
    "File read/write/edit, glob, grep, ls, shell, git, and web tools for local code interaction",
  kind: "coding" as const,
  configSchema: codeToolsConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = codeToolsConfigSchema.parse(api.pluginConfig);

    registerCodeRead(api, cfg);
    registerCodeReadMany(api, cfg);
    registerCodeWrite(api, cfg);
    registerCodeEdit(api, cfg);
    registerCodeGlob(api, cfg);
    registerCodeGrep(api, cfg);
    registerCodeLs(api, cfg);
    registerCodeShell(api, cfg);
    registerCodeNotebook(api, cfg);
    registerCodeMultiEdit(api, cfg);
    registerCodeShellInteractive(api, cfg);
    registerWebSearch(api, cfg);
    registerWebFetch(api, cfg);
    registerGitCommit(api, cfg);
    registerGitPush(api, cfg);
    registerGitCreatePr(api, cfg);

    api.logger.info(`code-tools: registered 17 tools (workspace: ${cfg.workspaceRoot})`);
  },
};

export default codeToolsPlugin;
