/**
 * QuickJS WASM Sandbox for Semantic Skills.
 *
 * Executes skill code inside a QuickJS WASM context where fs, net,
 * process, require, import do NOT exist. Only 7 host functions are
 * exposed: 4 graphClient methods + 3 logger methods.
 */

import { newAsyncContext, shouldInterruptAfterDeadline } from "quickjs-emscripten";
import type { QuickJSAsyncContext, QuickJSAsyncRuntime, QuickJSHandle } from "quickjs-emscripten";
import type { CortexClientLike } from "../../shared/cortex-client.js";
import type {
  SkillRuntime,
  SkillActivateContext,
  SkillDeactivateContext,
  SkillQueryContext,
  SkillQueryResult,
  SkillErrorContext,
} from "../skill-runtime-contract.js";
import { marshalToQuickJS, marshalFromQuickJS } from "./marshal.js";

export type LoggerLike = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type SandboxOptions = {
  memoryLimitBytes?: number; // default: 8MB
  maxStackSizeBytes?: number; // default: 512KB
  executionTimeoutMs?: number; // default: 10_000
  namespace?: string; // required for namespace scoping
  agentId?: string; // required for namespace scoping
  maxWritesPerSession?: number; // default: 50
};

const DEFAULT_MEMORY_LIMIT = 8 * 1024 * 1024; // 8MB
const DEFAULT_MAX_STACK = 512 * 1024; // 512KB
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_WRITES = 50;

/**
 * Wraps skill source code with a preamble that captures the default export.
 * The skill sees `graphClient` and `logger` as globals injected by the host.
 */
function wrapSkillSource(jsSource: string): string {
  // Convert ESM default export to something we can capture.
  // Replace `export default <expr>` with `__skillExport = <expr>`
  // This handles both `export default { ... }` and `export default runtime`
  let wrapped = jsSource;

  // Handle: export default <identifier>;
  wrapped = wrapped.replace(/export\s+default\s+(\w+)\s*;/, "__skillExport = $1;");
  // Handle: export default { ... } (object/expression)
  wrapped = wrapped.replace(/export\s+default\s+/g, "__skillExport = ");

  // Remove any remaining import/export statements (type imports already stripped)
  wrapped = wrapped.replace(/^\s*(?:import|export)\s+.*$/gm, "// [removed import/export]");

  return `var __skillExport = undefined;\n${wrapped}\n__skillExport;`;
}

export class QuickJSSandbox {
  private ctx: QuickJSAsyncContext | null = null;
  private rt: QuickJSAsyncRuntime | null = null;
  private disposed = false;
  private readonly options: Required<SandboxOptions>;
  private writeCount = 0;

  // Handles to skill lifecycle functions inside QuickJS
  private skillName: string | null = null;
  private fnOnActivate: QuickJSHandle | null = null;
  private fnOnDeactivate: QuickJSHandle | null = null;
  private fnOnQuery: QuickJSHandle | null = null;
  private fnOnError: QuickJSHandle | null = null;
  private skillObjHandle: QuickJSHandle | null = null;

  constructor(options?: SandboxOptions) {
    this.options = {
      memoryLimitBytes: options?.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT,
      maxStackSizeBytes: options?.maxStackSizeBytes ?? DEFAULT_MAX_STACK,
      executionTimeoutMs: options?.executionTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      namespace: options?.namespace ?? "",
      agentId: options?.agentId ?? "",
      maxWritesPerSession: options?.maxWritesPerSession ?? DEFAULT_MAX_WRITES,
    };
  }

  async init(): Promise<void> {
    if (this.disposed) throw new Error("Sandbox has been disposed");
    if (this.ctx) throw new Error("Sandbox already initialized");

    this.ctx = await newAsyncContext();
    this.rt = this.ctx.runtime;

    // Configure resource limits
    this.rt.setMemoryLimit(this.options.memoryLimitBytes);
    this.rt.setMaxStackSize(this.options.maxStackSizeBytes);
  }

  /**
   * Load and evaluate skill source code inside the sandbox.
   * Returns the skill name from the exported runtime object.
   */
  async loadSkill(jsSource: string, filename?: string): Promise<string> {
    if (!this.ctx || !this.rt) throw new Error("Sandbox not initialized");
    if (this.disposed) throw new Error("Sandbox has been disposed");

    const wrappedSource = wrapSkillSource(jsSource);

    // Set deadline interrupt
    const deadline = Date.now() + this.options.executionTimeoutMs;
    this.rt.setInterruptHandler(shouldInterruptAfterDeadline(deadline));

    const result = await this.ctx.evalCodeAsync(wrappedSource, filename ?? "skill.js", {
      type: "global",
    });

    this.rt.removeInterruptHandler();

    if (result.error) {
      const errVal = this.ctx.dump(result.error);
      result.error.dispose();
      throw new Error(`Skill evaluation failed: ${JSON.stringify(errVal)}`);
    }

    // result.value is the skill export object
    const skillObj = result.value!;

    // Extract and validate name
    const nameHandle = this.ctx.getProp(skillObj, "name");
    const nameType = this.ctx.typeof(nameHandle);
    if (nameType !== "string") {
      nameHandle.dispose();
      skillObj.dispose();
      throw new Error("Skill must export an object with a `name` string property");
    }
    const name = this.ctx.getString(nameHandle);
    nameHandle.dispose();

    if (!name || name.length === 0) {
      skillObj.dispose();
      throw new Error("Skill name must be a non-empty string");
    }

    // Extract lifecycle function handles (optional)
    this.fnOnActivate = this.extractFn(skillObj, "onActivate");
    this.fnOnDeactivate = this.extractFn(skillObj, "onDeactivate");
    this.fnOnQuery = this.extractFn(skillObj, "onQuery");
    this.fnOnError = this.extractFn(skillObj, "onError");

    this.skillObjHandle = skillObj;
    this.skillName = name;
    return name;
  }

  /**
   * Create a SkillRuntime proxy that bridges calls into the sandbox.
   * The graphClient and logger are injected as host functions.
   */
  createRuntimeProxy(graphClient: CortexClientLike, logger: LoggerLike): SkillRuntime {
    if (!this.ctx || !this.skillName) {
      throw new Error("Sandbox not initialized or no skill loaded");
    }

    this.injectHostFunctions(graphClient, logger);

    const self = this;

    return {
      name: this.skillName,

      onActivate: this.fnOnActivate
        ? async (ctx: SkillActivateContext) => {
            await self.callLifecycleFn("onActivate", self.fnOnActivate!, {
              namespace: ctx.namespace,
              agentId: ctx.agentId,
              sessionId: ctx.sessionId,
            });
          }
        : undefined,

      onDeactivate: this.fnOnDeactivate
        ? async (ctx: SkillDeactivateContext) => {
            await self.callLifecycleFn("onDeactivate", self.fnOnDeactivate!, {
              namespace: ctx.namespace,
              agentId: ctx.agentId,
              reason: ctx.reason,
            });
          }
        : undefined,

      onQuery: this.fnOnQuery
        ? async (ctx: SkillQueryContext): Promise<SkillQueryResult> => {
            const raw = await self.callLifecycleFn("onQuery", self.fnOnQuery!, {
              namespace: ctx.namespace,
              agentId: ctx.agentId,
              predicate: ctx.predicate,
              scope: ctx.scope,
              results: ctx.results,
            });
            if (raw && typeof raw === "object") {
              return raw as SkillQueryResult;
            }
            return { results: ctx.results };
          }
        : undefined,

      onError: this.fnOnError
        ? async (ctx: SkillErrorContext) => {
            await self.callLifecycleFn("onError", self.fnOnError!, {
              namespace: ctx.namespace,
              agentId: ctx.agentId,
              error: { message: ctx.error.message, name: ctx.error.name },
              operation: ctx.operation,
            });
          }
        : undefined,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Remove injected globals (graphClient, logger) to release asyncified fn refs
    if (this.ctx) {
      try {
        this.ctx.setProp(this.ctx.global, "graphClient", this.ctx.undefined);
        this.ctx.setProp(this.ctx.global, "logger", this.ctx.undefined);
        this.ctx.setProp(this.ctx.global, "__callArg", this.ctx.undefined);
        this.ctx.setProp(this.ctx.global, "__callFn", this.ctx.undefined);
        this.ctx.setProp(this.ctx.global, "__skillExport", this.ctx.undefined);
      } catch {
        // Best-effort cleanup
      }
    }

    // Dispose function handles
    if (this.fnOnActivate) {
      this.fnOnActivate.dispose();
      this.fnOnActivate = null;
    }
    if (this.fnOnDeactivate) {
      this.fnOnDeactivate.dispose();
      this.fnOnDeactivate = null;
    }
    if (this.fnOnQuery) {
      this.fnOnQuery.dispose();
      this.fnOnQuery = null;
    }
    if (this.fnOnError) {
      this.fnOnError.dispose();
      this.fnOnError = null;
    }
    if (this.skillObjHandle) {
      this.skillObjHandle.dispose();
      this.skillObjHandle = null;
    }

    // Dispose context and runtime
    if (this.ctx) {
      this.ctx.dispose();
      this.ctx = null;
    }
    if (this.rt) {
      this.rt.dispose();
      this.rt = null;
    }
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private extractFn(obj: QuickJSHandle, name: string): QuickJSHandle | null {
    const ctx = this.ctx!;
    const handle = ctx.getProp(obj, name);
    const t = ctx.typeof(handle);
    if (t === "function") {
      return handle; // caller must manage disposal
    }
    handle.dispose();
    return null;
  }

  /**
   * Call a lifecycle function inside the sandbox with a serialized context.
   * Returns the dumped result.
   */
  private async callLifecycleFn(
    opName: string,
    fnHandle: QuickJSHandle,
    ctxData: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.ctx || !this.rt || this.disposed) return undefined;

    const deadline = Date.now() + this.options.executionTimeoutMs;
    this.rt.setInterruptHandler(shouldInterruptAfterDeadline(deadline));

    // Build a wrapper that calls the function with the serialized context.
    // Using evalCodeAsync ensures asyncified host functions work properly.
    const argHandle = marshalToQuickJS(this.ctx, ctxData);
    this.ctx.setProp(this.ctx.global, "__callArg", argHandle);
    argHandle.dispose();

    // Store the function reference as a global for the call
    this.ctx.setProp(this.ctx.global, "__callFn", fnHandle);

    const result = await this.ctx.evalCodeAsync(
      `(async () => { var r = __callFn(__callArg); if (r && typeof r.then === "function") r = await r; return r; })()`,
      `${opName}-call.js`,
    );

    // Clean up globals
    this.ctx.setProp(this.ctx.global, "__callArg", this.ctx.undefined);
    this.ctx.setProp(this.ctx.global, "__callFn", this.ctx.undefined);

    this.rt.executePendingJobs();
    this.rt.removeInterruptHandler();

    if (result.error) {
      const errVal = this.ctx.dump(result.error);
      result.error.dispose();
      throw new Error(`Skill ${opName} failed: ${JSON.stringify(errVal)}`);
    }

    // evalCodeAsync with async IIFE returns a promise handle
    const promiseHandle = result.value!;
    const resolvePromise = this.ctx.resolvePromise(promiseHandle);
    promiseHandle.dispose();
    this.rt.executePendingJobs();
    const resolved = await resolvePromise;

    if (resolved.error) {
      const errVal = this.ctx.dump(resolved.error);
      resolved.error.dispose();
      throw new Error(`Skill ${opName} promise rejected: ${JSON.stringify(errVal)}`);
    }

    const value = marshalFromQuickJS(this.ctx, resolved.value!);
    resolved.value!.dispose();
    return value;
  }

  /**
   * Enforce namespace prefix on subject/predicate.
   * Skills can only read/write within their own namespace scope.
   */
  private enforceNamespace(field: string, value: string | undefined): string | undefined {
    if (!value) return value;
    const ns = this.options.namespace;
    if (!ns) return value; // no namespace configured — passthrough
    if (value.startsWith(`${ns}:`)) return value;
    return `${ns}:${value}`;
  }

  /**
   * Check and increment write counter. Throws if rate limit exceeded.
   */
  private checkWriteLimit(): void {
    if (this.writeCount >= this.options.maxWritesPerSession) {
      throw new Error(
        `Sandbox write limit exceeded (${this.options.maxWritesPerSession} per session)`,
      );
    }
    this.writeCount++;
  }

  /**
   * Inject graphClient (4 methods) and logger (3 methods) as globals
   * that the sandboxed skill code can call.
   *
   * Security layers applied:
   * - P0-2: Namespace scoping — subject/predicate forced to namespace prefix
   * - P2-7: Rate limiting — max N writes per session
   * - P2-8: Audit logging — every write/delete logged
   */
  private injectHostFunctions(graphClient: CortexClientLike, logger: LoggerLike): void {
    const ctx = this.ctx!;
    const self = this;
    const skillName = this.skillName ?? "unknown";

    // --- graphClient ---
    const gcObj = ctx.newObject();

    const createTripleFn = ctx.newAsyncifiedFunction(
      "createTriple",
      async function (this: QuickJSHandle, reqHandle: QuickJSHandle) {
        self.checkWriteLimit();
        const req = ctx.dump(reqHandle) as Parameters<CortexClientLike["createTriple"]>[0];
        // P0-2: Enforce namespace scoping
        req.subject = self.enforceNamespace("subject", req.subject) ?? req.subject;
        req.predicate = self.enforceNamespace("predicate", req.predicate) ?? req.predicate;
        // P2-8: Audit log
        logger.info(`[sandbox-audit] ${skillName}: createTriple(${req.subject}, ${req.predicate})`);
        const result = await graphClient.createTriple(req);
        return marshalToQuickJS(ctx, result);
      },
    );
    ctx.setProp(gcObj, "createTriple", createTripleFn);
    createTripleFn.dispose();

    const listTriplesFn = ctx.newAsyncifiedFunction(
      "listTriples",
      async function (this: QuickJSHandle, queryHandle: QuickJSHandle) {
        const query = ctx.dump(queryHandle) as Parameters<CortexClientLike["listTriples"]>[0];
        // P0-2: Enforce namespace scoping on reads
        if (query.subject) query.subject = self.enforceNamespace("subject", query.subject);
        if (query.predicate) query.predicate = self.enforceNamespace("predicate", query.predicate);
        const result = await graphClient.listTriples(query);
        return marshalToQuickJS(ctx, result);
      },
    );
    ctx.setProp(gcObj, "listTriples", listTriplesFn);
    listTriplesFn.dispose();

    const patternQueryFn = ctx.newAsyncifiedFunction(
      "patternQuery",
      async function (this: QuickJSHandle, reqHandle: QuickJSHandle) {
        const req = ctx.dump(reqHandle) as Parameters<CortexClientLike["patternQuery"]>[0];
        // P0-2: Enforce namespace scoping on reads
        if (req.subject) req.subject = self.enforceNamespace("subject", req.subject);
        if (req.predicate) req.predicate = self.enforceNamespace("predicate", req.predicate);
        const result = await graphClient.patternQuery(req);
        return marshalToQuickJS(ctx, result);
      },
    );
    ctx.setProp(gcObj, "patternQuery", patternQueryFn);
    patternQueryFn.dispose();

    const deleteTripleFn = ctx.newAsyncifiedFunction(
      "deleteTriple",
      async function (this: QuickJSHandle, idHandle: QuickJSHandle) {
        self.checkWriteLimit();
        const id = ctx.getString(idHandle);
        // P2-8: Audit log
        logger.info(`[sandbox-audit] ${skillName}: deleteTriple(${id})`);
        await graphClient.deleteTriple(id);
        return ctx.undefined;
      },
    );
    ctx.setProp(gcObj, "deleteTriple", deleteTripleFn);
    deleteTripleFn.dispose();

    ctx.setProp(ctx.global, "graphClient", gcObj);
    gcObj.dispose();

    // --- logger ---
    const logObj = ctx.newObject();

    for (const level of ["info", "warn", "error"] as const) {
      const fn = ctx.newFunction(level, function (this: QuickJSHandle, msgHandle: QuickJSHandle) {
        const msg = ctx.dump(msgHandle);
        logger[level](`[skill:${skillName}] ${String(msg)}`);
      });
      ctx.setProp(logObj, level, fn);
      fn.dispose();
    }

    ctx.setProp(ctx.global, "logger", logObj);
    logObj.dispose();
  }
}
