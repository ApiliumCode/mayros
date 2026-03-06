/**
 * Background Task Tracker
 *
 * Tracks background agent tasks via Cortex. Agents with `background: true`
 * in their markdown frontmatter are automatically tracked here.
 *
 * Triple namespace:
 *   Subject:    {ns}:bgtask:{taskId}
 *   Predicates: {ns}:bgtask:{field}
 *     fields: agentId, description, status, startedAt, completedAt, result, error, progress
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";

// ============================================================================
// Types
// ============================================================================

export type BackgroundTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type BackgroundTask = {
  id: string;
  agentId: string;
  description: string;
  status: BackgroundTaskStatus;
  startedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
  progress?: number;
};

export type BackgroundTaskSummary = {
  total: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  pending: number;
  tasks: BackgroundTask[];
};

export type TrackParams = {
  agentId: string;
  description: string;
  status?: BackgroundTaskStatus;
};

export type ListOptions = {
  status?: BackgroundTaskStatus;
  agentId?: string;
  limit?: number;
};

// ============================================================================
// Helpers
// ============================================================================

function taskSubject(ns: string, taskId: string): string {
  return `${ns}:bgtask:${taskId}`;
}

function taskPredicate(ns: string, field: string): string {
  return `${ns}:bgtask:${field}`;
}

const VALID_STATUSES: BackgroundTaskStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
];

export function isValidBackgroundTaskStatus(s: string): s is BackgroundTaskStatus {
  return VALID_STATUSES.includes(s as BackgroundTaskStatus);
}

// ============================================================================
// BackgroundTracker
// ============================================================================

export class BackgroundTracker {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /**
   * Track a new background task. Returns the created task.
   */
  async track(params: TrackParams): Promise<BackgroundTask> {
    const id = randomUUID().slice(0, 12);
    const startedAt = new Date().toISOString();
    const status = params.status ?? "running";

    const subject = taskSubject(this.ns, id);

    await this.client.createTriple({
      subject,
      predicate: taskPredicate(this.ns, "agentId"),
      object: params.agentId,
    });
    await this.client.createTriple({
      subject,
      predicate: taskPredicate(this.ns, "description"),
      object: params.description,
    });
    await this.client.createTriple({
      subject,
      predicate: taskPredicate(this.ns, "status"),
      object: status,
    });
    await this.client.createTriple({
      subject,
      predicate: taskPredicate(this.ns, "startedAt"),
      object: startedAt,
    });

    return {
      id,
      agentId: params.agentId,
      description: params.description,
      status,
      startedAt,
    };
  }

  /**
   * Update a task's status. Optionally set result or error.
   */
  async updateStatus(
    taskId: string,
    status: BackgroundTaskStatus,
    result?: string,
  ): Promise<boolean> {
    const subject = taskSubject(this.ns, taskId);

    const existing = await this.client.listTriples({
      subject,
      predicate: taskPredicate(this.ns, "status"),
    });
    if (existing.triples.length === 0) return false;

    await this.updateField(subject, "status", status);

    if (result) {
      await this.updateField(subject, "result", result);
    }

    if (status === "completed" || status === "failed" || status === "cancelled") {
      await this.updateField(subject, "completedAt", new Date().toISOString());
    }

    return true;
  }

  /**
   * Update task progress (0-100, clamped).
   */
  async updateProgress(taskId: string, progress: number): Promise<boolean> {
    const clamped = Math.max(0, Math.min(100, Math.floor(progress)));
    const subject = taskSubject(this.ns, taskId);

    const existing = await this.client.listTriples({
      subject,
      predicate: taskPredicate(this.ns, "status"),
    });
    if (existing.triples.length === 0) return false;

    await this.updateField(subject, "progress", String(clamped));
    return true;
  }

  /**
   * Cancel a task. Idempotent — double cancel returns true.
   */
  async cancel(taskId: string): Promise<boolean> {
    const subject = taskSubject(this.ns, taskId);

    const existing = await this.client.listTriples({
      subject,
      predicate: taskPredicate(this.ns, "status"),
    });
    if (existing.triples.length === 0) return false;

    await this.updateField(subject, "status", "cancelled");
    await this.updateField(subject, "completedAt", new Date().toISOString());
    return true;
  }

  /**
   * Reconstruct a task from Cortex triples.
   */
  async getTask(taskId: string): Promise<BackgroundTask | null> {
    const subject = taskSubject(this.ns, taskId);

    const result = await this.client.listTriples({ subject, limit: 20 });
    if (result.triples.length === 0) return null;

    return this.reconstructTask(taskId, result.triples);
  }

  /**
   * List tasks with optional filtering.
   */
  async listTasks(opts?: ListOptions): Promise<BackgroundTask[]> {
    const pred = taskPredicate(this.ns, "status");
    const queryOpts: { predicate: string; object?: string; limit: number } = {
      predicate: pred,
      limit: 500,
    };
    if (opts?.status) {
      queryOpts.object = opts.status;
    }

    const result = await this.client.patternQuery(queryOpts);

    const prefix = `${this.ns}:bgtask:`;
    const taskIds: string[] = [];

    for (const match of result.matches) {
      if (!match.subject.startsWith(prefix)) continue;
      taskIds.push(match.subject.slice(prefix.length));
    }

    // Fetch all tasks in parallel, in batches of 10 to avoid overwhelming Cortex
    const BATCH_SIZE = 10;
    const tasks: BackgroundTask[] = [];

    for (let i = 0; i < taskIds.length; i += BATCH_SIZE) {
      const batch = taskIds.slice(i, i + BATCH_SIZE);
      const settled = await Promise.all(batch.map((id) => this.getTask(id)));
      for (const task of settled) {
        if (!task) continue;
        // Apply agent filter
        if (opts?.agentId && task.agentId !== opts.agentId) continue;
        tasks.push(task);
      }
    }

    // Sort by startedAt descending (newest first)
    tasks.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    const limit = opts?.limit ?? tasks.length;
    return tasks.slice(0, limit);
  }

  /**
   * Aggregate summary of all background tasks.
   */
  async summary(): Promise<BackgroundTaskSummary> {
    const tasks = await this.listTasks();

    let running = 0;
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    let pending = 0;

    for (const t of tasks) {
      switch (t.status) {
        case "running":
          running++;
          break;
        case "completed":
          completed++;
          break;
        case "failed":
          failed++;
          break;
        case "cancelled":
          cancelled++;
          break;
        case "pending":
          pending++;
          break;
      }
    }

    return {
      total: tasks.length,
      running,
      completed,
      failed,
      cancelled,
      pending,
      tasks,
    };
  }

  // ---------- Private helpers ----------

  private reconstructTask(
    taskId: string,
    triples: Array<{ predicate: unknown; object: unknown }>,
  ): BackgroundTask {
    let agentId = "";
    let description = "";
    let status: BackgroundTaskStatus = "pending";
    let startedAt = "";
    let completedAt: string | undefined;
    let result: string | undefined;
    let error: string | undefined;
    let progress: number | undefined;

    for (const t of triples) {
      const pred = String(t.predicate);
      const obj = String(t.object);

      if (pred === taskPredicate(this.ns, "agentId")) agentId = obj;
      else if (pred === taskPredicate(this.ns, "description")) description = obj;
      else if (pred === taskPredicate(this.ns, "status") && isValidBackgroundTaskStatus(obj))
        status = obj;
      else if (pred === taskPredicate(this.ns, "startedAt")) startedAt = obj;
      else if (pred === taskPredicate(this.ns, "completedAt")) completedAt = obj;
      else if (pred === taskPredicate(this.ns, "result")) result = obj;
      else if (pred === taskPredicate(this.ns, "error")) error = obj;
      else if (pred === taskPredicate(this.ns, "progress")) {
        const n = Number.parseInt(obj, 10);
        if (!Number.isNaN(n)) progress = n;
      }
    }

    const task: BackgroundTask = { id: taskId, agentId, description, status, startedAt };
    if (completedAt) task.completedAt = completedAt;
    if (result) task.result = result;
    if (error) task.error = error;
    if (progress !== undefined) task.progress = progress;

    return task;
  }

  private async updateField(subject: string, field: string, value: string): Promise<void> {
    const pred = taskPredicate(this.ns, field);

    const existing = await this.client.listTriples({ subject, predicate: pred });
    for (const t of existing.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }

    await this.client.createTriple({ subject, predicate: pred, object: value });
  }
}
