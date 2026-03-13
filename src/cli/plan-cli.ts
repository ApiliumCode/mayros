/**
 * `mayros plan` — Semantic plan mode CLI.
 *
 * Orchestrates a structured planning workflow with four phases:
 *   1. explore  — Discover codebase structure, generate discovery triples
 *   2. assert   — Define verifiable assertions about the planned changes
 *   3. approve  — Present the decision graph for user review
 *   4. execute  — Run the approved plan with full audit trail
 *
 * Plan state is persisted in AIngle Cortex as RDF triples so it survives
 * across CLI invocations and is fully auditable.
 *
 * Subcommands:
 *   start <task>    — Create a new plan with a task description
 *   explore <id>    — Add discovery entries to a plan
 *   assert <id>     — Add assertions to a plan
 *   show [id]       — Show the current plan graph
 *   approve <id>    — Mark a plan as approved
 *   execute <id>    — Begin executing an approved plan
 *   list            — List all plans
 *   status [id]     — Show plan status
 */

import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import { CortexClient } from "../../extensions/shared/cortex-client.js";
import { resolveCortexClient, resolveNamespace } from "./shared/cortex-resolution.js";

// ============================================================================
// Types
// ============================================================================

type PlanPhase = "explore" | "assert" | "approve" | "execute" | "done";

type PlanEntry = {
  id: string;
  task: string;
  phase: PlanPhase;
  createdAt: string;
  updatedAt: string;
  discoveries: DiscoveryEntry[];
  assertions: AssertionEntry[];
};

type DiscoveryEntry = {
  id: string;
  kind: "file" | "function" | "dependency" | "test" | "pattern" | "note";
  subject: string;
  detail: string;
  addedAt: string;
};

type AssertionEntry = {
  id: string;
  statement: string;
  verified: boolean;
  proofHash?: string;
  addedAt: string;
};

// ============================================================================
// Plan store (Cortex-backed)
// ============================================================================

class PlanStore {
  constructor(
    private client: CortexClient,
    private ns: string,
  ) {}

  private planSubject(planId: string): string {
    return `${this.ns}:plan:${planId}`;
  }

  async createPlan(task: string): Promise<PlanEntry> {
    const id = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const subject = this.planSubject(id);

    await Promise.all([
      this.client.createTriple({ subject, predicate: `${this.ns}:plan:task`, object: task }),
      this.client.createTriple({ subject, predicate: `${this.ns}:plan:phase`, object: "explore" }),
      this.client.createTriple({ subject, predicate: `${this.ns}:plan:createdAt`, object: now }),
      this.client.createTriple({ subject, predicate: `${this.ns}:plan:updatedAt`, object: now }),
    ]);

    return {
      id,
      task,
      phase: "explore",
      createdAt: now,
      updatedAt: now,
      discoveries: [],
      assertions: [],
    };
  }

  async getPlan(planId: string): Promise<PlanEntry | null> {
    const subject = this.planSubject(planId);

    const result = await this.client.listTriples({ subject, limit: 200 });
    if (result.triples.length === 0) {
      return null;
    }

    let task = "";
    let phase: PlanPhase = "explore";
    let createdAt = "";
    let updatedAt = "";
    const discoveries: DiscoveryEntry[] = [];
    const assertions: AssertionEntry[] = [];

    for (const triple of result.triples) {
      const pred = triple.predicate;
      const value = String(
        typeof triple.object === "object" && "node" in triple.object
          ? triple.object.node
          : triple.object,
      );

      if (pred === `${this.ns}:plan:task`) {
        task = value;
      } else if (pred === `${this.ns}:plan:phase`) {
        phase = value as PlanPhase;
      } else if (pred === `${this.ns}:plan:createdAt`) {
        createdAt = value;
      } else if (pred === `${this.ns}:plan:updatedAt`) {
        updatedAt = value;
      } else if (pred.startsWith(`${this.ns}:plan:discovery:`)) {
        try {
          discoveries.push(JSON.parse(value) as DiscoveryEntry);
        } catch {
          // Skip malformed entries
        }
      } else if (pred.startsWith(`${this.ns}:plan:assertion:`)) {
        try {
          assertions.push(JSON.parse(value) as AssertionEntry);
        } catch {
          // Skip malformed entries
        }
      }
    }

    if (!task) {
      return null;
    }

    return { id: planId, task, phase, createdAt, updatedAt, discoveries, assertions };
  }

  async updatePhase(planId: string, phase: PlanPhase): Promise<void> {
    const subject = this.planSubject(planId);
    const now = new Date().toISOString();

    // Find and delete old phase triple, then create new one
    const result = await this.client.listTriples({
      subject,
      predicate: `${this.ns}:plan:phase`,
      limit: 10,
    });
    for (const triple of result.triples) {
      if (triple.id) {
        await this.client.deleteTriple(triple.id);
      }
    }

    // Delete old updatedAt
    const updated = await this.client.listTriples({
      subject,
      predicate: `${this.ns}:plan:updatedAt`,
      limit: 10,
    });
    for (const triple of updated.triples) {
      if (triple.id) {
        await this.client.deleteTriple(triple.id);
      }
    }

    await this.client.createTriple({ subject, predicate: `${this.ns}:plan:phase`, object: phase });
    await this.client.createTriple({
      subject,
      predicate: `${this.ns}:plan:updatedAt`,
      object: now,
    });
  }

  async addDiscovery(
    planId: string,
    kind: DiscoveryEntry["kind"],
    entrySubject: string,
    detail: string,
  ): Promise<DiscoveryEntry> {
    const subject = this.planSubject(planId);
    const entry: DiscoveryEntry = {
      id: randomUUID().slice(0, 8),
      kind,
      subject: entrySubject,
      detail,
      addedAt: new Date().toISOString(),
    };

    await this.client.createTriple({
      subject,
      predicate: `${this.ns}:plan:discovery:${entry.id}`,
      object: JSON.stringify(entry),
    });

    return entry;
  }

  async addAssertion(planId: string, statement: string): Promise<AssertionEntry> {
    const subject = this.planSubject(planId);
    const entry: AssertionEntry = {
      id: randomUUID().slice(0, 8),
      statement,
      verified: false,
      addedAt: new Date().toISOString(),
    };

    await this.client.createTriple({
      subject,
      predicate: `${this.ns}:plan:assertion:${entry.id}`,
      object: JSON.stringify(entry),
    });

    return entry;
  }

  async verifyAssertion(planId: string, assertionId: string): Promise<boolean> {
    const plan = await this.getPlan(planId);
    if (!plan) return false;

    const assertion = plan.assertions.find((a) => a.id === assertionId);
    if (!assertion) return false;

    // Attempt validation via Cortex Proof of Logic
    try {
      const result = await this.client.validate({
        statements: [
          {
            subject: this.planSubject(planId),
            predicate: `${this.ns}:plan:assertion:verified`,
            object: assertion.statement,
          },
        ],
      });

      const verified = result.valid;
      const proofHash = result.proof_hash;

      // Update the assertion triple
      const subject = this.planSubject(planId);
      const triples = await this.client.listTriples({
        subject,
        predicate: `${this.ns}:plan:assertion:${assertionId}`,
        limit: 1,
      });
      for (const triple of triples.triples) {
        if (triple.id) {
          await this.client.deleteTriple(triple.id);
        }
      }

      const updated: AssertionEntry = {
        ...assertion,
        verified,
        proofHash: proofHash ?? undefined,
      };
      await this.client.createTriple({
        subject,
        predicate: `${this.ns}:plan:assertion:${assertionId}`,
        object: JSON.stringify(updated),
      });

      return verified;
    } catch {
      return false;
    }
  }

  async listPlans(): Promise<
    Array<{ id: string; task: string; phase: string; updatedAt: string }>
  > {
    const result = await this.client.listSubjects({
      predicate: `${this.ns}:plan:task`,
      limit: 50,
    });

    const plans: Array<{ id: string; task: string; phase: string; updatedAt: string }> = [];
    for (const subject of result.subjects) {
      const prefix = `${this.ns}:plan:`;
      if (!subject.startsWith(prefix)) continue;
      const id = subject.slice(prefix.length);

      const triples = await this.client.listTriples({ subject, limit: 10 });
      let task = "";
      let phase = "explore";
      let updatedAt = "";

      for (const triple of triples.triples) {
        const value = String(
          typeof triple.object === "object" && "node" in triple.object
            ? triple.object.node
            : triple.object,
        );
        if (triple.predicate === `${this.ns}:plan:task`) task = value;
        else if (triple.predicate === `${this.ns}:plan:phase`) phase = value;
        else if (triple.predicate === `${this.ns}:plan:updatedAt`) updatedAt = value;
      }

      if (task) {
        plans.push({ id, task, phase, updatedAt });
      }
    }

    return plans.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

// ============================================================================
// Formatters
// ============================================================================

function formatPlan(plan: PlanEntry): string {
  const lines: string[] = [
    `Plan: ${plan.id}`,
    `Task: ${plan.task}`,
    `Phase: ${plan.phase.toUpperCase()}`,
    `Created: ${plan.createdAt}`,
    `Updated: ${plan.updatedAt}`,
  ];

  if (plan.discoveries.length > 0) {
    lines.push("", `Discoveries (${plan.discoveries.length}):`);
    for (const d of plan.discoveries) {
      lines.push(`  [${d.kind}] ${d.subject} — ${d.detail}  (${d.id})`);
    }
  }

  if (plan.assertions.length > 0) {
    lines.push("", `Assertions (${plan.assertions.length}):`);
    for (const a of plan.assertions) {
      const status = a.verified
        ? a.proofHash
          ? `VERIFIED (${a.proofHash.slice(0, 8)})`
          : "VERIFIED"
        : "PENDING";
      lines.push(`  [${status}] ${a.statement}  (${a.id})`);
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Registration
// ============================================================================

export function registerPlanCli(program: Command) {
  const plan = program
    .command("plan")
    .description(
      "Semantic plan mode — explore, assert, approve, execute with Cortex-backed decision graph",
    )
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 8080 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)");

  function getStore(parentOpts: {
    cortexHost?: string;
    cortexPort?: string;
    cortexToken?: string;
  }) {
    const client = resolveCortexClient(
      {
        host: parentOpts.cortexHost,
        port: parentOpts.cortexPort,
        token: parentOpts.cortexToken,
      },
      { pluginName: "semantic-observability" },
    );
    const ns = resolveNamespace("semantic-observability");
    return { store: new PlanStore(client, ns), client };
  }

  // ------------------------------------------------------------------
  // mayros plan start <task>
  // ------------------------------------------------------------------
  plan
    .command("start")
    .description("Create a new plan with a task description")
    .argument("<task>", "Task description for the plan")
    .action(async (task: string) => {
      const { store, client } = getStore(plan.opts());
      try {
        const entry = await store.createPlan(task);
        console.log(`Plan created: ${entry.id}`);
        console.log(`Task: ${entry.task}`);
        console.log(`Phase: EXPLORE`);
        console.log("");
        console.log("Next steps:");
        console.log(
          `  mayros plan explore ${entry.id} --kind file --subject "src/main.ts" --detail "Entry point"`,
        );
        console.log(
          `  mayros plan assert ${entry.id} --statement "Changes do not break existing tests"`,
        );
        console.log(`  mayros plan approve ${entry.id}`);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros plan explore <id>
  // ------------------------------------------------------------------
  plan
    .command("explore")
    .description("Add a discovery entry to a plan")
    .argument("<planId>", "Plan ID")
    .requiredOption(
      "--kind <kind>",
      "Discovery kind: file, function, dependency, test, pattern, note",
    )
    .requiredOption("--subject <subject>", "What was discovered (e.g. file path, function name)")
    .requiredOption("--detail <detail>", "Description of the discovery")
    .action(async (planId: string, opts: { kind: string; subject: string; detail: string }) => {
      const { store, client } = getStore(plan.opts());
      try {
        const entry = await store.getPlan(planId);
        if (!entry) {
          console.error(`Plan not found: ${planId}`);
          process.exitCode = 1;
          return;
        }
        if (entry.phase !== "explore") {
          console.error(`Plan ${planId} is in phase ${entry.phase}, not explore`);
          process.exitCode = 1;
          return;
        }

        const kind = opts.kind as DiscoveryEntry["kind"];
        const validKinds = ["file", "function", "dependency", "test", "pattern", "note"];
        if (!validKinds.includes(kind)) {
          console.error(`Invalid kind: ${kind}. Must be one of: ${validKinds.join(", ")}`);
          process.exitCode = 1;
          return;
        }

        const discovery = await store.addDiscovery(planId, kind, opts.subject, opts.detail);
        console.log(`Discovery added: [${discovery.kind}] ${discovery.subject}`);
        console.log(`  Detail: ${discovery.detail}`);
        console.log(`  ID: ${discovery.id}`);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros plan assert <id>
  // ------------------------------------------------------------------
  plan
    .command("assert")
    .description("Add a verifiable assertion to a plan")
    .argument("<planId>", "Plan ID")
    .requiredOption("--statement <statement>", "Assertion statement")
    .option("--verify", "Immediately verify the assertion via Cortex PoL", false)
    .action(async (planId: string, opts: { statement: string; verify?: boolean }) => {
      const { store, client } = getStore(plan.opts());
      try {
        const entry = await store.getPlan(planId);
        if (!entry) {
          console.error(`Plan not found: ${planId}`);
          process.exitCode = 1;
          return;
        }
        if (entry.phase !== "explore" && entry.phase !== "assert") {
          console.error(
            `Plan ${planId} is in phase ${entry.phase}. Assertions require explore or assert phase.`,
          );
          process.exitCode = 1;
          return;
        }

        // Transition to assert phase if still in explore
        if (entry.phase === "explore") {
          await store.updatePhase(planId, "assert");
        }

        const assertion = await store.addAssertion(planId, opts.statement);
        console.log(`Assertion added: ${assertion.statement}`);
        console.log(`  ID: ${assertion.id}`);

        if (opts.verify) {
          const verified = await store.verifyAssertion(planId, assertion.id);
          console.log(`  Verified: ${verified ? "YES" : "NO"}`);
        } else {
          console.log("  Status: PENDING (use --verify to validate via Cortex)");
        }
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros plan show [id]
  // ------------------------------------------------------------------
  plan
    .command("show")
    .description("Show plan details and decision graph")
    .argument("[planId]", "Plan ID (omit to show the most recent plan)")
    .option("--format <fmt>", "Output format: terminal, json", "terminal")
    .action(async (planId: string | undefined, opts: { format?: string }) => {
      const { store, client } = getStore(plan.opts());
      try {
        let targetId = planId;
        if (!targetId) {
          const plans = await store.listPlans();
          if (plans.length === 0) {
            console.log("No plans found. Create one with: mayros plan start <task>");
            return;
          }
          targetId = plans[0].id;
        }

        const entry = await store.getPlan(targetId);
        if (!entry) {
          console.error(`Plan not found: ${targetId}`);
          process.exitCode = 1;
          return;
        }

        if (opts.format === "json") {
          console.log(JSON.stringify(entry, null, 2));
        } else {
          console.log(formatPlan(entry));
        }
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros plan approve <id>
  // ------------------------------------------------------------------
  plan
    .command("approve")
    .description("Approve a plan for execution")
    .argument("<planId>", "Plan ID")
    .action(async (planId: string) => {
      const { store, client } = getStore(plan.opts());
      try {
        const entry = await store.getPlan(planId);
        if (!entry) {
          console.error(`Plan not found: ${planId}`);
          process.exitCode = 1;
          return;
        }
        if (entry.phase === "done") {
          console.error(`Plan ${planId} is already completed.`);
          process.exitCode = 1;
          return;
        }
        if (entry.phase === "execute") {
          console.error(`Plan ${planId} is already in execution.`);
          process.exitCode = 1;
          return;
        }

        // Show summary before approving
        console.log(formatPlan(entry));
        console.log("");

        const unverified = entry.assertions.filter((a) => !a.verified);
        if (unverified.length > 0) {
          console.log(`Warning: ${unverified.length} assertion(s) are not verified.`);
        }

        await store.updatePhase(planId, "approve");
        console.log(`Plan ${planId} APPROVED. Execute with: mayros plan execute ${planId}`);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros plan execute <id>
  // ------------------------------------------------------------------
  plan
    .command("execute")
    .description("Begin executing an approved plan")
    .argument("<planId>", "Plan ID")
    .action(async (planId: string) => {
      const { store, client } = getStore(plan.opts());
      try {
        const entry = await store.getPlan(planId);
        if (!entry) {
          console.error(`Plan not found: ${planId}`);
          process.exitCode = 1;
          return;
        }
        if (entry.phase !== "approve") {
          console.error(
            `Plan ${planId} is in phase ${entry.phase}. Only approved plans can be executed.`,
          );
          process.exitCode = 1;
          return;
        }

        await store.updatePhase(planId, "execute");
        console.log(`Plan ${planId} is now in EXECUTE phase.`);
        console.log(`Task: ${entry.task}`);
        console.log(`Discoveries: ${entry.discoveries.length}`);
        console.log(`Assertions: ${entry.assertions.length}`);
        console.log("");
        console.log("The plan is now active. Agent actions in this session will be");
        console.log("tracked against this plan in the Cortex audit trail.");
        console.log("");
        console.log(`When done, mark complete: mayros plan done ${planId}`);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros plan done <id>
  // ------------------------------------------------------------------
  plan
    .command("done")
    .description("Mark a plan as completed")
    .argument("<planId>", "Plan ID")
    .action(async (planId: string) => {
      const { store, client } = getStore(plan.opts());
      try {
        const entry = await store.getPlan(planId);
        if (!entry) {
          console.error(`Plan not found: ${planId}`);
          process.exitCode = 1;
          return;
        }

        await store.updatePhase(planId, "done");
        console.log(`Plan ${planId} marked as DONE.`);
        console.log(`Task: ${entry.task}`);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros plan list
  // ------------------------------------------------------------------
  plan
    .command("list")
    .description("List all plans")
    .option("--format <fmt>", "Output format: terminal, json", "terminal")
    .action(async (opts: { format?: string }) => {
      const { store, client } = getStore(plan.opts());
      try {
        const plans = await store.listPlans();

        if (plans.length === 0) {
          console.log("No plans found.");
          return;
        }

        if (opts.format === "json") {
          console.log(JSON.stringify(plans, null, 2));
        } else {
          const header = "ID        Phase      Updated                    Task";
          const sep = "--------  ---------  -------------------------  ----";
          console.log(header);
          console.log(sep);
          for (const p of plans) {
            const ts = p.updatedAt.replace("T", " ").replace(/\.\d+Z$/, "Z");
            console.log(
              `${p.id.padEnd(10)}${p.phase.padEnd(11)}${ts.padEnd(27)}${p.task.slice(0, 60)}`,
            );
          }
        }
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros plan status [id]
  // ------------------------------------------------------------------
  plan
    .command("status")
    .description("Show plan status")
    .argument("[planId]", "Plan ID (omit for most recent)")
    .action(async (planId: string | undefined) => {
      const { store, client } = getStore(plan.opts());
      try {
        let targetId = planId;
        if (!targetId) {
          const plans = await store.listPlans();
          if (plans.length === 0) {
            console.log("No plans found.");
            return;
          }
          targetId = plans[0].id;
        }

        const entry = await store.getPlan(targetId);
        if (!entry) {
          console.error(`Plan not found: ${targetId}`);
          process.exitCode = 1;
          return;
        }

        const totalAssertions = entry.assertions.length;
        const verified = entry.assertions.filter((a) => a.verified).length;

        console.log(`Plan: ${entry.id}`);
        console.log(`Task: ${entry.task}`);
        console.log(`Phase: ${entry.phase.toUpperCase()}`);
        console.log(`Discoveries: ${entry.discoveries.length}`);
        console.log(`Assertions: ${verified}/${totalAssertions} verified`);

        // Phase progress indicator
        const phases: PlanPhase[] = ["explore", "assert", "approve", "execute", "done"];
        const currentIdx = phases.indexOf(entry.phase);
        const progress = phases.map((p, i) =>
          i <= currentIdx ? `[${p.toUpperCase()}]` : ` ${p} `,
        );
        console.log("");
        console.log(`Progress: ${progress.join(" -> ")}`);
      } finally {
        client.destroy();
      }
    });
}
