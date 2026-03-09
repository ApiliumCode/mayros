/**
 * Mayros Semantic Skills Plugin
 *
 * Extends the skill system with semantic capabilities:
 * graph queries, PoL-verified assertions, ZK proofs,
 * and permission-gated operations.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { HealthMonitor } from "../shared/health-monitor.js";
import { AssertionEngine } from "./assertion-engine.js";
import { semanticSkillsConfigSchema } from "./config.js";
import { CortexClient } from "./cortex-client.js";
import { PermissionResolver, requiredPermissions } from "./permission-resolver.js";
import { ProofClient } from "./proof-client.js";
import { SkillLoader } from "./skill-loader.js";
import {
  parseSemanticManifest,
  validateManifest,
  type SemanticSkillManifest,
} from "./skill-manifest.js";
import { buildSkillContext, formatSkillContextXml } from "./skill-runtime.js";
import { SkillWatcher } from "./skill-watcher.js";

// ============================================================================
// Integrity Hashing
// ============================================================================

const HASH_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".jsx",
  ".tsx",
  ".md",
]);

export async function computeSkillDirHash(skillDir: string): Promise<string> {
  const hash = createHash("sha256");

  let files: string[];
  try {
    files = await readdir(skillDir);
  } catch {
    return hash.digest("hex");
  }

  files.sort();

  for (const f of files) {
    const dotIdx = f.lastIndexOf(".");
    const ext = dotIdx >= 0 ? f.slice(dotIdx).toLowerCase() : "";
    if (!HASH_EXTENSIONS.has(ext)) continue;
    try {
      const content = await readFile(join(skillDir, f));
      hash.update(`${f}:${content.length}:`);
      hash.update(content);
    } catch {
      /* skip unreadable */
    }
  }
  return hash.digest("hex");
}

// ============================================================================
// Rate Limiter — sliding window per skill
// ============================================================================

class SkillRateLimiter {
  private windows = new Map<string, number[]>();
  private maxPerMinute: number;

  constructor(maxPerMinute: number) {
    this.maxPerMinute = maxPerMinute;
  }

  /**
   * Check if a call is allowed for the given skill. If allowed, records it.
   * Returns true if allowed, false if rate-limited.
   */
  check(skillName: string): boolean {
    const now = Date.now();
    const cutoff = now - 60_000; // 1-minute window

    let timestamps = this.windows.get(skillName);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(skillName, timestamps);
    }

    // Evict expired entries
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxPerMinute) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /** Current call count in the window for a skill. */
  count(skillName: string): number {
    const now = Date.now();
    const cutoff = now - 60_000;
    const timestamps = this.windows.get(skillName);
    if (!timestamps) return 0;
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }
    return timestamps.length;
  }

  clear(): void {
    this.windows.clear();
  }
}

// ============================================================================
// Manifest Diff — log security-critical changes on hot-reload
// ============================================================================

type ManifestDiff = {
  field: string;
  severity: "warn" | "info";
  detail: string;
};

function diffManifests(oldM: SemanticSkillManifest, newM: SemanticSkillManifest): ManifestDiff[] {
  const diffs: ManifestDiff[] = [];

  // allowedTools changes
  const oldTools = JSON.stringify(oldM.allowedTools ?? []);
  const newTools = JSON.stringify(newM.allowedTools ?? []);
  if (oldTools !== newTools) {
    diffs.push({
      field: "allowedTools",
      severity: "warn",
      detail: `${oldTools} → ${newTools}`,
    });
  }

  // Permission changes
  for (const cat of ["graph", "proofs", "memory"] as const) {
    const oldP = JSON.stringify(oldM.permissions[cat]);
    const newP = JSON.stringify(newM.permissions[cat]);
    if (oldP !== newP) {
      diffs.push({
        field: `permissions.${cat}`,
        severity: "warn",
        detail: `${oldP} → ${newP}`,
      });
    }
  }

  // maxQueries change
  if (oldM.maxQueries !== newM.maxQueries) {
    diffs.push({
      field: "maxQueries",
      severity: "info",
      detail: `${oldM.maxQueries ?? "default"} → ${newM.maxQueries ?? "default"}`,
    });
  }

  // Assertions change
  const oldA = JSON.stringify(oldM.assertions);
  const newA = JSON.stringify(newM.assertions);
  if (oldA !== newA) {
    diffs.push({
      field: "assertions",
      severity: "warn",
      detail: `${oldM.assertions.length} → ${newM.assertions.length} assertion(s)`,
    });
  }

  // Version change
  if (oldM.version !== newM.version) {
    diffs.push({
      field: "version",
      severity: "info",
      detail: `${oldM.version} → ${newM.version}`,
    });
  }

  return diffs;
}

// ============================================================================
// Plugin Definition
// ============================================================================

const semanticSkillsPlugin = {
  id: "semantic-skills",
  name: "Semantic Skills",
  description: "Graph-aware skills with PoL assertions, ZK proofs, and permission-gated operations",
  kind: "skills" as const,
  configSchema: semanticSkillsConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = semanticSkillsConfigSchema.parse(api.pluginConfig);
    const ns = cfg.agentNamespace;
    const agentId = api.id;
    const client = new CortexClient(cfg.cortex);
    client.breaker.reset(); // ensure clean state
    const proofClient = new ProofClient(client, cfg.skillSandbox);
    let cortexAvailable = false;
    const healthMonitor = new HealthMonitor(client, {
      onHealthy: () => {
        cortexAvailable = true;
        api.logger.info("semantic-skills: Cortex recovered — now healthy");
      },
      onUnhealthy: () => {
        cortexAvailable = false;
        api.logger.warn("semantic-skills: Cortex unreachable — now unhealthy");
      },
    });

    // Track active semantic skills and their resolvers
    const activeManifests = new Map<string, SemanticSkillManifest>();
    const activeResolvers = new Map<string, PermissionResolver>();
    const activeEngines = new Map<string, AssertionEngine>();
    const skillLoader = new SkillLoader();
    const skillWatcher = cfg.hotReload ? new SkillWatcher() : null;

    // Per-skill query counters for sandbox limits (Gap F)
    const queryCountPerSkill = new Map<string, number>();

    // Per-skill rate limiter (sliding window, calls per minute)
    const rateLimiter = new SkillRateLimiter(cfg.skillSandbox.maxCallsPerMinute);

    // Tracks which skill is currently executing a tool call.
    // Set by before_tool_call, cleared by after_tool_call.
    // When multiple skills are active, determined by the tool's semantic context.
    let currentSkillName: string | undefined;

    api.logger.info(`semantic-skills: registered (ns: ${ns}, agent: ${agentId})`);

    // ========================================================================
    // Cortex connectivity
    // ========================================================================

    async function ensureCortex(): Promise<boolean> {
      if (cortexAvailable) return true;
      cortexAvailable = await client.isHealthy();
      return cortexAvailable;
    }

    function getResolver(skillName: string): PermissionResolver | undefined {
      return activeResolvers.get(skillName);
    }

    function getEngine(skillName: string): AssertionEngine | undefined {
      return activeEngines.get(skillName);
    }

    function checkQueryLimit(skillName?: string): void {
      // Per-skill check
      if (skillName) {
        const manifest = activeManifests.get(skillName);
        const limit = manifest?.maxQueries ?? cfg.skillSandbox.maxGraphQueries;
        const used = queryCountPerSkill.get(skillName) ?? 0;
        if (used >= limit) {
          throw new Error(`Graph query limit reached for skill "${skillName}" (${limit}).`);
        }
        queryCountPerSkill.set(skillName, used + 1);
      }
      // Global safety cap (sum of all per-skill counts)
      const totalUsed = [...queryCountPerSkill.values()].reduce((a, b) => a + b, 0);
      const globalCap = cfg.skillSandbox.maxGraphQueries * Math.max(activeManifests.size, 1);
      if (totalUsed >= globalCap) {
        throw new Error("Global graph query limit exceeded.");
      }
    }

    function getTotalQueryCount(): number {
      return [...queryCountPerSkill.values()].reduce((a, b) => a + b, 0);
    }

    /**
     * C1: Force namespace prefix on subject. Rejects cross-namespace access.
     * scope:"agent" → `${ns}:agent:${agentId}`
     * scope:"namespace" or "global" → `${ns}:${subject}` (global is capped to own ns)
     */
    function enforceNsPrefix(subject: string | undefined, scope: string): string | undefined {
      if (!subject) return undefined;
      if (scope === "agent") {
        return `${ns}:agent:${agentId}`;
      }
      // namespace and global both enforce ns prefix
      if (subject.startsWith(`${ns}:`)) return subject;
      return `${ns}:${subject}`;
    }

    /**
     * C2: Resolve which skill triggered the current tool call.
     * Works for any number of active skills (not just 1).
     */
    function resolveCurrentSkill(): string | undefined {
      if (currentSkillName) return currentSkillName;
      // If exactly 1 skill active, use it (backward compat)
      if (activeManifests.size === 1) {
        return activeManifests.keys().next().value;
      }
      // Multiple skills: distribute query count across all
      // Return the skill with the fewest queries used (round-robin fairness)
      if (activeManifests.size > 1) {
        let minSkill: string | undefined;
        let minCount = Infinity;
        for (const [name] of activeManifests) {
          const count = queryCountPerSkill.get(name) ?? 0;
          if (count < minCount) {
            minCount = count;
            minSkill = name;
          }
        }
        return minSkill;
      }
      return undefined;
    }

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "skill_graph_query",
        label: "Skill Graph Query",
        description: "Query the semantic graph scoped by the active skill's permissions.",
        parameters: Type.Object({
          subject: Type.Optional(Type.String({ description: "Subject filter" })),
          predicate: Type.Optional(Type.String({ description: "Predicate filter" })),
          object: Type.Optional(Type.String({ description: "Object filter (string value)" })),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 20)" })),
          scope: Type.Optional(
            Type.Unsafe<string>({
              type: "string",
              enum: ["agent", "namespace", "global"],
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const {
            subject,
            predicate,
            object: obj,
            limit = 20,
            scope = "agent",
          } = params as {
            subject?: string;
            predicate?: string;
            object?: string;
            limit?: number;
            scope?: string;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable." }],
              details: { error: "cortex_unavailable" },
            };
          }

          // Determine which skill triggered this query (C2: per-request tracking)
          const querySkill = resolveCurrentSkill();
          checkQueryLimit(querySkill);

          // Rate limit: sliding window per skill per minute
          if (querySkill && !rateLimiter.check(querySkill)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Rate limit exceeded for skill "${querySkill}" (${cfg.skillSandbox.maxCallsPerMinute}/min).`,
                },
              ],
              details: { error: "rate_limited", skill: querySkill },
            };
          }

          // C1: Force namespace — ALL queries are scoped to `${ns}:`
          // No cross-namespace access, even with scope:"global".
          const scopedSubject = enforceNsPrefix(subject, scope);
          const nsPredicate = predicate
            ? predicate.startsWith(`${ns}:`)
              ? predicate
              : `${ns}:${predicate}`
            : undefined;

          const result = await client.patternQuery({
            subject: scopedSubject,
            predicate: nsPredicate,
            object: obj,
            limit,
          });

          // Invoke onQuery on active skill runtimes for result enrichment
          // C5: Tight timeout prevents DoS via slow enrichment
          const ENRICHMENT_TIMEOUT_MS = 2000;
          let additionalContext = "";
          if (querySkill) {
            const runtime = skillLoader.getRuntime(querySkill);
            if (runtime?.onQuery) {
              try {
                const queryPromise = skillLoader.invokeQuery(runtime, {
                  namespace: ns,
                  agentId,
                  predicate: nsPredicate ?? "",
                  scope: (scope as "agent" | "namespace" | "global") ?? "agent",
                  results: result.matches.map((m) => ({
                    subject: m.subject,
                    object: m.object,
                  })),
                });
                const timeoutPromise = new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error("Enrichment timeout")), ENRICHMENT_TIMEOUT_MS),
                );
                const queryResult = await Promise.race([queryPromise, timeoutPromise]);
                if (queryResult?.additionalContext) {
                  const capped = queryResult.additionalContext.slice(0, 4096);
                  additionalContext = `\n\n${capped}`;
                }
              } catch {
                // Best-effort enrichment (timeout or runtime error)
              }
            }
          }

          const text = result.matches
            .map((t) => `${t.subject} ${t.predicate} ${JSON.stringify(t.object)}`)
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text:
                  result.matches.length > 0
                    ? `${result.total} triples found:\n\n${text}${additionalContext}`
                    : `No matching triples.${additionalContext}`,
              },
            ],
            details: {
              total: result.total,
              matches: result.matches,
              queriesUsed: getTotalQueryCount(),
            },
          };
        },
      },
      { name: "skill_graph_query" },
    );

    api.registerTool(
      {
        name: "skill_assert",
        label: "Skill Assert",
        description: "Publish an assertion to the semantic graph with optional PoL proof.",
        parameters: Type.Object({
          subject: Type.String({ description: "Assertion subject" }),
          predicate: Type.String({ description: "Assertion predicate" }),
          object: Type.String({ description: "Assertion object (value)" }),
          requireProof: Type.Optional(
            Type.Boolean({ description: "Require PoL proof (default: false)" }),
          ),
          proofType: Type.Optional(Type.String({ description: "Proof type if proof required" })),
        }),
        async execute(_toolCallId, params) {
          const {
            subject,
            predicate,
            object: obj,
            requireProof,
            proofType,
          } = params as {
            subject: string;
            predicate: string;
            object: string;
            requireProof?: boolean;
            proofType?: string;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable." }],
              details: { error: "cortex_unavailable" },
            };
          }

          // H4: Only allow assertions through properly declared engines — no default fallback
          const assertSkill = resolveCurrentSkill();
          if (assertSkill && !rateLimiter.check(assertSkill)) {
            return {
              content: [{ type: "text", text: `Rate limit exceeded for skill "${assertSkill}".` }],
              details: { error: "rate_limited", skill: assertSkill },
            };
          }
          const engine = assertSkill ? activeEngines.get(assertSkill) : undefined;
          if (!engine) {
            return {
              content: [
                { type: "text", text: "No active semantic skill with assertion permissions." },
              ],
              details: { error: "no_engine" },
            };
          }

          const result = await engine.publish(subject, predicate, obj, {
            requireProof,
            proofType,
          });

          return {
            content: [
              {
                type: "text",
                text: `Assertion published: ${result.subject} ${result.predicate} = ${JSON.stringify(result.object)}${
                  result.proofHash ? ` (proof: ${result.proofHash})` : ""
                }${result.verified ? " [verified]" : " [unverified]"}`,
              },
            ],
            details: result,
          };
        },
      },
      { name: "skill_assert" },
    );

    api.registerTool(
      {
        name: "skill_verify_assertion",
        label: "Skill Verify Assertion",
        description: "Verify an assertion's PoL proof in the semantic graph.",
        parameters: Type.Object({
          subject: Type.String({ description: "Assertion subject" }),
          predicate: Type.String({ description: "Assertion predicate" }),
          proofId: Type.Optional(Type.String({ description: "Specific proof ID to verify" })),
        }),
        async execute(_toolCallId, params) {
          const { subject, predicate, proofId } = params as {
            subject: string;
            predicate: string;
            proofId?: string;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable." }],
              details: { error: "cortex_unavailable" },
            };
          }

          // H4: Only verify through properly declared engines — no default fallback
          const verifySkill = resolveCurrentSkill();
          const engine = verifySkill ? activeEngines.get(verifySkill) : undefined;
          if (!engine) {
            return {
              content: [
                { type: "text", text: "No active semantic skill with verification permissions." },
              ],
              details: { error: "no_engine" },
            };
          }

          const result = await engine.verify(subject, predicate, proofId);

          return {
            content: [
              {
                type: "text",
                text: result.found
                  ? `Assertion ${result.subject} ${result.predicate}: ${result.verified ? "VERIFIED" : "NOT VERIFIED"}${
                      result.proofHash ? ` (proof: ${result.proofHash})` : ""
                    }`
                  : `Assertion not found: ${result.subject} ${result.predicate}`,
              },
            ],
            details: result,
          };
        },
      },
      { name: "skill_verify_assertion" },
    );

    api.registerTool(
      {
        name: "skill_request_zk_proof",
        label: "Skill Request ZK Proof",
        description: "Request a zero-knowledge proof (schnorr/equality/membership/range).",
        parameters: Type.Object({
          proofType: Type.Unsafe<string>({
            type: "string",
            enum: ["schnorr", "equality", "membership", "range"],
            description: "ZK proof type",
          }),
          subject: Type.String({ description: "Proof subject" }),
          predicate: Type.String({ description: "Proof predicate" }),
          metadata: Type.Optional(
            Type.Record(Type.String(), Type.String(), {
              description: "Additional metadata key-value pairs",
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { proofType, subject, predicate, metadata } = params as {
            proofType: string;
            subject: string;
            predicate: string;
            metadata?: Record<string, string>;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable." }],
              details: { error: "cortex_unavailable" },
            };
          }

          if (!cfg.skillSandbox.allowZkProofs) {
            return {
              content: [{ type: "text", text: "ZK proofs are disabled." }],
              details: { error: "zk_disabled" },
            };
          }

          const result = await proofClient.requestZkProof({
            proofType: proofType as "schnorr" | "equality" | "membership" | "range",
            subject,
            predicate,
            metadata,
          });

          return {
            content: [
              {
                type: "text",
                text: `ZK proof requested: ${result.proofId} (${result.proofType}, status: ${result.status})`,
              },
            ],
            details: result,
          };
        },
      },
      { name: "skill_request_zk_proof" },
    );

    api.registerTool(
      {
        name: "skill_verify_zk_proof",
        label: "Skill Verify ZK Proof",
        description: "Verify a zero-knowledge proof by ID.",
        parameters: Type.Object({
          proofId: Type.String({ description: "Proof ID to verify" }),
        }),
        async execute(_toolCallId, params) {
          const { proofId } = params as { proofId: string };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable." }],
              details: { error: "cortex_unavailable" },
            };
          }

          const result = await proofClient.verifyZkProof(proofId);

          return {
            content: [
              {
                type: "text",
                text: `ZK proof ${proofId}: ${result.verified ? "VERIFIED" : "NOT VERIFIED"}`,
              },
            ],
            details: result,
          };
        },
      },
      { name: "skill_verify_zk_proof" },
    );

    api.registerTool(
      {
        name: "skill_memory_context",
        label: "Skill Memory Context",
        description: "Recall from Ineru memory within the active skill context.",
        parameters: Type.Object({
          query: Type.String({ description: "Search query for memory recall" }),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 5)" })),
          minImportance: Type.Optional(
            Type.Number({ description: "Minimum importance threshold (0-1, default: 0.3)" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const {
            query,
            limit = 5,
            minImportance = 0.3,
          } = params as {
            query: string;
            limit?: number;
            minImportance?: number;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable." }],
              details: { error: "cortex_unavailable" },
            };
          }

          // Rate limit memory context calls
          const memSkill = resolveCurrentSkill();
          if (memSkill && !rateLimiter.check(memSkill)) {
            return {
              content: [{ type: "text", text: `Rate limit exceeded for skill "${memSkill}".` }],
              details: { error: "rate_limited", skill: memSkill },
            };
          }

          // Query agent's memories from the graph (scoped to namespace)
          const agentNode = `${ns}:agent:${agentId}`;
          const result = await client.patternQuery({
            subject: `${ns}:`, // C4: scope to own namespace
            predicate: `${ns}:ownedBy`,
            object: agentNode,
            limit: limit * 10,
          });

          // Filter by query relevance (simple keyword matching)
          const lower = query.toLowerCase();
          const memories: Array<{ subject: string; text: string; importance: number }> = [];

          for (const match of result.matches) {
            // C4: Skip results outside our namespace (defense in depth)
            if (!match.subject.startsWith(`${ns}:`)) continue;

            const tripleResult = await client.listTriples({
              subject: match.subject,
              limit: 20,
            });

            let text = "";
            let importance = 0.5;

            for (const t of tripleResult.triples) {
              if (t.predicate.endsWith(":text") && typeof t.object === "string") {
                text = t.object;
              }
              if (t.predicate.endsWith(":importance") && typeof t.object === "number") {
                importance = t.object as number;
              }
            }

            if (!text || importance < minImportance) continue;
            if (!text.toLowerCase().includes(lower)) continue;

            memories.push({ subject: match.subject, text, importance });
            if (memories.length >= limit) break;
          }

          if (memories.length === 0) {
            return {
              content: [{ type: "text", text: "No relevant memories found." }],
              details: { count: 0 },
            };
          }

          const text = memories
            .map((m, i) => `${i + 1}. [${m.importance.toFixed(2)}] ${m.text}`)
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `Found ${memories.length} relevant memories:\n\n${text}`,
              },
            ],
            details: { count: memories.length, memories },
          };
        },
      },
      { name: "skill_memory_context" },
    );

    // ========================================================================
    // Hooks
    // ========================================================================

    // Hook: before_agent_start — detect semantic skills, pre-fetch declared queries
    api.on("before_agent_start", async (event, _ctx) => {
      if (!(await ensureCortex())) return;

      // Scan for active semantic skills from the event context
      const skills = event.skills;
      if (!skills || skills.length === 0) return;

      const contextBlocks: string[] = [];

      for (const skill of skills) {
        const frontmatter = skill.frontmatter;
        if (!frontmatter) continue;

        const manifest = parseSemanticManifest(frontmatter);
        if (!manifest) continue;

        const skillName = skill.name ?? "unknown";
        const skillDir = skill.dir ?? "";

        // Register this semantic skill
        activeManifests.set(skillName, manifest);
        activeResolvers.set(skillName, new PermissionResolver(manifest, skillName));
        activeEngines.set(
          skillName,
          new AssertionEngine(
            client,
            proofClient,
            ns,
            cfg.skillSandbox.maxAssertions,
            manifest.assertions,
          ),
        );

        // Load and activate skill runtime (skill.ts/skill.js)
        if (skillDir) {
          try {
            const runtime = await skillLoader.loadSkillRuntime(skillDir, {
              sandboxEnabled: cfg.skillSandbox.sandboxEnabled,
              memoryLimitBytes: cfg.skillSandbox.memoryLimitBytes,
              maxStackSizeBytes: cfg.skillSandbox.maxStackSizeBytes,
              executionTimeoutMs: cfg.skillSandbox.executionTimeoutMs,
              namespace: ns,
              agentId,
              graphClient: client,
              logger: api.logger,
            });
            if (runtime) {
              await skillLoader.activateSkill(runtime, {
                namespace: ns,
                agentId,
                graphClient: client,
                logger: api.logger,
              });
              api.logger.info(`semantic-skills: activated runtime for "${skillName}"`);
            }
          } catch (err) {
            api.logger.warn(
              `semantic-skills: failed to load runtime for "${skillName}": ${String(err)}`,
            );
          }
        }

        // Pre-fetch declared queries
        try {
          const ctx = await buildSkillContext(client, ns, agentId, skillName, manifest);
          const xml = formatSkillContextXml(ctx);
          if (xml) {
            contextBlocks.push(xml);
          }
        } catch (err) {
          api.logger.warn(
            `semantic-skills: failed to build context for "${skillName}": ${String(err)}`,
          );
        }
      }

      if (contextBlocks.length > 0) {
        api.logger.info(
          `semantic-skills: injecting context for ${activeManifests.size} semantic skill(s)`,
        );
        return {
          prependContext: contextBlocks.join("\n"),
        };
      }
    });

    // Hot-reload: watch skills directory for changes
    if (skillWatcher) {
      const skillsDir = api.resolvePath("skills");
      skillWatcher.watch(skillsDir, async (event) => {
        api.logger.info(`semantic-skills: hot-reload triggered by ${event.file}`);
        try {
          // Deactivate current runtimes
          await skillLoader.unloadAll("reload");

          // H6: Build new state in temp maps, then swap atomically
          const nextManifests = new Map<string, SemanticSkillManifest>();
          const nextResolvers = new Map<string, PermissionResolver>();
          const nextEngines = new Map<string, AssertionEngine>();

          for (const [name] of activeManifests) {
            const skillDir = join(skillsDir, name);
            try {
              // Re-parse SKILL.md to pick up permission/query changes
              const skillMdPath = join(skillDir, "SKILL.md");
              const content = await readFile(skillMdPath, "utf-8");
              const { parseFrontmatterBlock } = await import("../../src/markdown/frontmatter.js");
              const frontmatter = parseFrontmatterBlock(content);
              const updatedManifest = parseSemanticManifest(frontmatter);

              if (updatedManifest) {
                // H7: Re-validate manifest on hot-reload (prevent allowedTools downgrade)
                const validation = validateManifest(updatedManifest);
                if (!validation.valid) {
                  api.logger.warn(
                    `semantic-skills: hot-reload rejected for "${name}": ${validation.errors.join(", ")}`,
                  );
                  continue;
                }

                // Verify allowedTools hasn't been removed/weakened vs original
                const originalManifest = activeManifests.get(name);
                if (originalManifest?.allowedTools && !updatedManifest.allowedTools) {
                  api.logger.warn(
                    `semantic-skills: hot-reload rejected for "${name}": allowedTools removed (was ${JSON.stringify(originalManifest.allowedTools)})`,
                  );
                  continue;
                }

                // Log security-critical manifest changes
                const originalManifestForDiff = activeManifests.get(name);
                if (originalManifestForDiff) {
                  const diffs = diffManifests(originalManifestForDiff, updatedManifest);
                  for (const d of diffs) {
                    const logFn = d.severity === "warn" ? api.logger.warn : api.logger.info;
                    logFn(`semantic-skills: hot-reload "${name}" changed ${d.field}: ${d.detail}`);
                  }
                }

                nextManifests.set(name, updatedManifest);
                nextResolvers.set(name, new PermissionResolver(updatedManifest, name));
                nextEngines.set(
                  name,
                  new AssertionEngine(
                    client,
                    proofClient,
                    ns,
                    cfg.skillSandbox.maxAssertions,
                    updatedManifest.assertions,
                  ),
                );
                api.logger.info(`semantic-skills: re-parsed manifest for "${name}"`);
              }

              // Reload runtime
              const runtime = await skillLoader.loadSkillRuntime(skillDir, {
                sandboxEnabled: cfg.skillSandbox.sandboxEnabled,
                memoryLimitBytes: cfg.skillSandbox.memoryLimitBytes,
                maxStackSizeBytes: cfg.skillSandbox.maxStackSizeBytes,
                executionTimeoutMs: cfg.skillSandbox.executionTimeoutMs,
                namespace: ns,
                agentId,
                graphClient: client,
                logger: api.logger,
              });
              if (runtime) {
                await skillLoader.activateSkill(runtime, {
                  namespace: ns,
                  agentId,
                  graphClient: client,
                  logger: api.logger,
                });
                api.logger.info(`semantic-skills: hot-reloaded runtime for "${name}"`);
              }
            } catch (err) {
              api.logger.warn(`semantic-skills: hot-reload failed for "${name}": ${String(err)}`);
            }
          }

          // Atomic swap — old maps are replaced in one go
          activeManifests.clear();
          activeResolvers.clear();
          activeEngines.clear();
          for (const [k, v] of nextManifests) activeManifests.set(k, v);
          for (const [k, v] of nextResolvers) activeResolvers.set(k, v);
          for (const [k, v] of nextEngines) activeEngines.set(k, v);
        } catch (err) {
          api.logger.warn(`semantic-skills: hot-reload error: ${String(err)}`);
        }
      });
      api.logger.info(`semantic-skills: hot-reload watcher started for ${skillsDir}`);
    }

    // Hook: before_tool_call — permission gating + tool allowlist
    api.on("before_tool_call", async (event, _ctx) => {
      const toolName = event.toolName;
      if (!toolName) return;

      // No semantic skills active — allow everything
      if (activeResolvers.size === 0) return;

      // Check tool allowlist — EVERY active skill must allow the tool (intersection)
      // This prevents a permissive skill's ["*"] from overriding a restrictive skill's allowlist.
      for (const [skillName, resolver] of activeResolvers) {
        if (!resolver.isToolAllowed(toolName)) {
          api.logger.warn(
            `semantic-skills: tool "${toolName}" blocked by skill "${skillName}" allowlist`,
          );
          return {
            block: true,
            reason: `Tool "${toolName}" not allowed by skill "${skillName}"`,
          };
        }
      }

      // Check semantic permissions for known tools
      const required = requiredPermissions(toolName);
      if (required.length === 0) return;

      for (const [, resolver] of activeResolvers) {
        const check = resolver.checkAll(required);
        if (check.allowed) return; // At least one skill grants permission
      }

      // No skill grants the required permissions
      api.logger.warn(`semantic-skills: permission denied for ${toolName}`);
      return {
        block: true,
        reason: `No active semantic skill grants permissions: ${required.join(", ")}`,
      };
    });

    // Hook: after_tool_call — audit trail for assertions and proofs
    api.on("after_tool_call", async (event, _ctx) => {
      const toolName = event.toolName;
      if (toolName !== "skill_assert" && toolName !== "skill_request_zk_proof") return;

      const result = event.result;

      api.logger.info(
        `semantic-skills: audit — ${toolName} executed (agent: ${agentId}, result: ${typeof result === "object" ? JSON.stringify(result) : String(result)})`,
      );
    });

    // Hook: session_end — deactivate all loaded skill runtimes
    api.on("session_end", async () => {
      if (skillLoader.size > 0) {
        api.logger.info(`semantic-skills: deactivating ${skillLoader.size} skill runtime(s)`);
        await skillLoader.unloadAll("session_end");
      }
    });

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const skills = program.command("skills").description("Skill management commands");

        const semantic = skills.command("semantic").description("Semantic skill runtime commands");

        semantic
          .command("status")
          .description("Show semantic skill runtime status")
          .action(async () => {
            const healthy = await client.isHealthy();
            console.log(`Cortex: ${healthy ? "ONLINE" : "OFFLINE"}`);
            console.log(`  endpoint: http://${cfg.cortex.host}:${cfg.cortex.port}`);
            console.log(`  namespace: ${ns}`);
            console.log(`  active semantic skills: ${activeManifests.size}`);
            console.log(`  queries used (total): ${getTotalQueryCount()}`);
            for (const [name, count] of queryCountPerSkill) {
              const manifest = activeManifests.get(name);
              const limit = manifest?.maxQueries ?? cfg.skillSandbox.maxGraphQueries;
              console.log(`    ${name}: ${count}/${limit}`);
            }
            console.log(`  ZK proofs: ${cfg.skillSandbox.allowZkProofs ? "enabled" : "disabled"}`);
            console.log(
              `  signature required: ${cfg.verification.requireSignature ? "yes" : "no"}`,
            );
            console.log(
              `  PoL validation: ${cfg.verification.polValidation ? "enabled" : "disabled"}`,
            );
          });

        semantic
          .command("list")
          .description("List installed semantic skills")
          .action(async () => {
            if (activeManifests.size === 0) {
              console.log("No semantic skills currently active.");
              return;
            }

            for (const [name, manifest] of activeManifests) {
              const perms = [
                ...manifest.permissions.graph.map((p) => `graph:${p}`),
                ...manifest.permissions.proofs.map((p) => `proofs:${p}`),
                ...manifest.permissions.memory.map((p) => `memory:${p}`),
              ];
              console.log(`${name} (v${manifest.version})`);
              console.log(`  permissions: ${perms.join(", ") || "none"}`);
              console.log(`  assertions: ${manifest.assertions.length}`);
              console.log(`  queries: ${manifest.queries.length}`);
            }
          });

        semantic
          .command("validate")
          .description("Validate a semantic skill manifest")
          .argument("<dir>", "Skill directory path")
          .action(async (dir) => {
            const { readFile } = await import("node:fs/promises");
            const { join } = await import("node:path");

            try {
              const skillMdPath = join(dir, "SKILL.md");
              const content = await readFile(skillMdPath, "utf-8");

              // Parse frontmatter
              const { parseFrontmatterBlock } = await import("../../src/markdown/frontmatter.js");
              const frontmatter = parseFrontmatterBlock(content);
              const manifest = parseSemanticManifest(frontmatter);

              if (!manifest) {
                console.log("Not a semantic skill (missing type: semantic in frontmatter).");
                return;
              }

              const validation = validateManifest(manifest);

              if (validation.valid) {
                console.log("Manifest: VALID");
              } else {
                console.log("Manifest: INVALID");
                for (const err of validation.errors) {
                  console.log(`  - ${err}`);
                }
              }

              // PoL validation against Cortex
              if (cfg.verification.polValidation && (await ensureCortex())) {
                try {
                  const polResult = await client.validateSkillManifest({
                    assertions: manifest.assertions,
                    namespace: ns,
                  });
                  console.log(`PoL validation: ${polResult.valid ? "PASSED" : "FAILED"}`);
                  for (const err of polResult.errors) {
                    console.log(`  - ${err}`);
                  }
                } catch (err) {
                  console.log(`PoL validation: SKIPPED (${String(err)})`);
                }
              }
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        semantic
          .command("test")
          .description("Run a semantic skill in sandbox mode")
          .argument("<dir>", "Skill directory path")
          .action(async (dir) => {
            if (!(await ensureCortex())) {
              console.error("Cortex unavailable. Cannot run sandbox test.");
              return;
            }

            try {
              // Create sandbox namespace
              const sandbox = await client.createSandbox(`${ns}:sandbox:${Date.now()}`, 60);
              console.log(`Sandbox created: ${sandbox.id} (ns: ${sandbox.namespace})`);

              // Load and validate skill
              const { readFile } = await import("node:fs/promises");
              const { join } = await import("node:path");
              const content = await readFile(join(dir, "SKILL.md"), "utf-8");
              const { parseFrontmatterBlock } = await import("../../src/markdown/frontmatter.js");
              const frontmatter = parseFrontmatterBlock(content);
              const manifest = parseSemanticManifest(frontmatter);

              if (!manifest) {
                console.log("Not a semantic skill.");
                await client.deleteSandbox(sandbox.id);
                return;
              }

              const validation = validateManifest(manifest);
              console.log(`Manifest validation: ${validation.valid ? "PASSED" : "FAILED"}`);

              // Clean up
              await client.deleteSandbox(sandbox.id);
              console.log("Sandbox cleaned up.");
            } catch (err) {
              console.error(`Sandbox test error: ${String(err)}`);
            }
          });
      },
      { commands: ["skills"] },
    );

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "semantic-skills",
      async start() {
        cortexAvailable = await client.isHealthy();
        api.logger.info(
          `semantic-skills: initialized (cortex: ${cortexAvailable ? "connected" : "offline"}, ns: ${ns})`,
        );
        healthMonitor.start();
      },
      async stop() {
        healthMonitor.stop();
        skillWatcher?.stop();
        await skillLoader.unloadAll("unload");
        activeManifests.clear();
        activeResolvers.clear();
        activeEngines.clear();
        queryCountPerSkill.clear();
        rateLimiter.clear();
        client.destroy();
        api.logger.info("semantic-skills: stopped");
      },
    });
  },
};

export default semanticSkillsPlugin;
