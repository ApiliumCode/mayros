/**
 * Semantic Skill Loader
 *
 * Dynamically imports skill.ts/skill.js files and manages their lifecycle
 * through the SkillRuntime contract.
 *
 * Supports two loading modes:
 * - **Sandbox** (default): Transpiles TS→JS, runs in QuickJS WASM with only
 *   graphClient + logger exposed. No fs, net, process, require, import.
 * - **Direct**: Uses native `import()` (dev/debug, sandboxEnabled: false).
 */

import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { scanSource } from "../../src/security/skill-scanner.js";
import type { CortexClientLike } from "../shared/cortex-client.js";
import {
  isSkillRuntime,
  type SkillRuntime,
  type SkillActivateContext,
  type SkillDeactivateContext,
  type SkillQueryContext,
  type SkillQueryResult,
  type SkillErrorContext,
} from "./skill-runtime-contract.js";
import { sanitizeEnrichment } from "./enrichment-sanitizer.js";
import { QuickJSSandbox, type LoggerLike } from "./sandbox/quickjs-sandbox.js";
import { transpileSkillToJS } from "./sandbox/ts-transpiler.js";

export type LoadOptions = {
  sandboxEnabled?: boolean;
  memoryLimitBytes?: number;
  maxStackSizeBytes?: number;
  executionTimeoutMs?: number;
  graphClient?: CortexClientLike;
  logger?: LoggerLike;
  namespace?: string;
  agentId?: string;
  maxWritesPerSession?: number;
};

export class SkillLoader {
  private runtimes = new Map<string, SkillRuntime>();
  private sandboxes = new Map<string, QuickJSSandbox>();

  /**
   * Attempt to load a SkillRuntime from a skill directory.
   * Looks for skill.ts or skill.js and dynamically imports it.
   * Returns undefined if no runtime file exists or export is invalid.
   */
  async loadSkillRuntime(
    skillDir: string,
    options?: LoadOptions,
  ): Promise<SkillRuntime | undefined> {
    const candidates = [join(skillDir, "skill.ts"), join(skillDir, "skill.js")];

    let filePath: string | undefined;
    for (const candidate of candidates) {
      try {
        await access(candidate);
        filePath = candidate;
        break;
      } catch {
        // not found, try next
      }
    }

    if (!filePath) return undefined;

    try {
      // C1: Scan source for critical findings before executing any code
      const source = await readFile(filePath, "utf-8");
      const scanResult = scanSource(source, filePath);
      const criticals = scanResult.filter((f) => f.severity === "critical");
      if (criticals.length > 0) {
        return undefined;
      }

      if (options?.sandboxEnabled !== false) {
        return await this.loadSandboxed(filePath, source, options);
      }

      // Direct import() is dangerous — only allow with explicit env opt-in
      if (process.env.MAYROS_UNSAFE_DIRECT_LOAD !== "1") {
        return undefined;
      }
      return await this.loadDirect(filePath);
    } catch {
      return undefined;
    }
  }

  /**
   * Load skill inside QuickJS WASM sandbox.
   */
  private async loadSandboxed(
    filePath: string,
    source: string,
    options?: LoadOptions,
  ): Promise<SkillRuntime | undefined> {
    const jsSource = await transpileSkillToJS(source, filePath);

    const sandbox = new QuickJSSandbox({
      memoryLimitBytes: options?.memoryLimitBytes,
      maxStackSizeBytes: options?.maxStackSizeBytes,
      executionTimeoutMs: options?.executionTimeoutMs,
      namespace: options?.namespace,
      agentId: options?.agentId,
      maxWritesPerSession: options?.maxWritesPerSession,
    });
    await sandbox.init();

    const name = await sandbox.loadSkill(jsSource, filePath);

    // Create a no-op graph client and logger if not provided
    const graphClient = options?.graphClient ?? {
      createTriple: async () => ({}) as { hash?: string },
      listTriples: async () => ({ triples: [], total: 0 }),
      patternQuery: async () => ({ matches: [], total: 0 }),
      deleteTriple: async () => {},
    };
    const logger = options?.logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    const runtime = sandbox.createRuntimeProxy(graphClient, logger);
    this.runtimes.set(name, runtime);
    this.sandboxes.set(name, sandbox);
    return runtime;
  }

  /**
   * Load skill via native `import()` — used when sandbox is disabled.
   */
  private async loadDirect(filePath: string): Promise<SkillRuntime | undefined> {
    const fileUrl = new URL(`file://${filePath}`);

    // Wrap import in timeout to prevent infinite-loop skills from blocking
    const IMPORT_TIMEOUT_MS = 5000;
    const importPromise = import(fileUrl.href);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Skill import timed out")), IMPORT_TIMEOUT_MS),
    );
    const mod = await Promise.race([importPromise, timeoutPromise]);
    const exported = mod.default ?? mod;

    if (isSkillRuntime(exported)) {
      this.runtimes.set(exported.name, exported);
      return exported;
    }

    return undefined;
  }

  /**
   * Activate a loaded skill runtime with the given context.
   */
  async activateSkill(runtime: SkillRuntime, ctx: SkillActivateContext): Promise<void> {
    if (!runtime.onActivate) return;
    try {
      await runtime.onActivate(ctx);
    } catch (err) {
      if (runtime.onError) {
        await runtime.onError({
          namespace: ctx.namespace,
          agentId: ctx.agentId,
          error: err instanceof Error ? err : new Error(String(err)),
          operation: "onActivate",
        });
      }
    }
  }

  /**
   * Deactivate a loaded skill runtime.
   */
  async deactivateSkill(runtime: SkillRuntime, ctx: SkillDeactivateContext): Promise<void> {
    if (!runtime.onDeactivate) return;
    try {
      await runtime.onDeactivate(ctx);
    } catch {
      // Best-effort deactivation
    }
  }

  /**
   * Invoke onQuery on a runtime, returning enriched results if available.
   */
  async invokeQuery(
    runtime: SkillRuntime,
    ctx: SkillQueryContext,
  ): Promise<SkillQueryResult | undefined> {
    if (!runtime.onQuery) return undefined;
    try {
      const result = await runtime.onQuery(ctx);
      if (result?.additionalContext) {
        // P0-1 + P2-9: Sanitize enrichment — strip injection, enforce structured data
        const sanitized = sanitizeEnrichment(result.additionalContext);
        if (!sanitized.safe || !sanitized.sanitized) {
          result.additionalContext = undefined;
        } else {
          result.additionalContext = sanitized.sanitized;
        }
      }
      return result;
    } catch (err) {
      if (runtime.onError) {
        await runtime.onError({
          namespace: ctx.namespace,
          agentId: ctx.agentId,
          error: err instanceof Error ? err : new Error(String(err)),
          operation: "onQuery",
        });
      }
      return undefined;
    }
  }

  /**
   * Deactivate and unload all loaded runtimes. Disposes sandboxes.
   */
  async unloadAll(reason: "session_end" | "reload" | "unload"): Promise<void> {
    for (const [, runtime] of this.runtimes) {
      if (runtime.onDeactivate) {
        try {
          await runtime.onDeactivate({
            namespace: "",
            agentId: "",
            reason,
          });
        } catch {
          // Best-effort
        }
      }
    }
    this.runtimes.clear();

    // Dispose all QuickJS sandboxes
    for (const [, sandbox] of this.sandboxes) {
      sandbox.dispose();
    }
    this.sandboxes.clear();
  }

  /**
   * Get a loaded runtime by skill name.
   */
  getRuntime(name: string): SkillRuntime | undefined {
    return this.runtimes.get(name);
  }

  /**
   * Get all loaded runtimes.
   */
  getAllRuntimes(): Map<string, SkillRuntime> {
    return this.runtimes;
  }

  /**
   * Number of loaded runtimes.
   */
  get size(): number {
    return this.runtimes.size;
  }
}
