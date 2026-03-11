import { randomUUID } from "node:crypto";
import type { IPlatformBridge, PlatformTask, TaskResult } from "./platform-bridge.js";

export type WorkflowTask = {
  platformId: string;
  task: PlatformTask;
};

export class PlatformCoordinator {
  private bridges = new Map<string, IPlatformBridge>();
  private fileLocks = new Map<string, string>(); // path -> platformId

  registerBridge(bridge: IPlatformBridge): void {
    this.bridges.set(bridge.id, bridge);
  }

  unregisterBridge(id: string): void {
    this.bridges.delete(id);
  }

  getBridge(id: string): IPlatformBridge | undefined {
    return this.bridges.get(id);
  }

  listBridges(): Array<{ id: string; name: string; status: string; capabilities: string[] }> {
    return [...this.bridges.values()].map((b) => ({
      id: b.id,
      name: b.name,
      status: b.getStatus(),
      capabilities: [...b.capabilities],
    }));
  }

  acquireLock(filePath: string, platformId: string): boolean {
    const existing = this.fileLocks.get(filePath);
    if (existing && existing !== platformId) return false;
    this.fileLocks.set(filePath, platformId);
    return true;
  }

  releaseLock(filePath: string, platformId: string): void {
    if (this.fileLocks.get(filePath) === platformId) {
      this.fileLocks.delete(filePath);
    }
  }

  releaseAllLocks(platformId: string): void {
    const toDelete: string[] = [];
    for (const [path, owner] of this.fileLocks) {
      if (owner === platformId) toDelete.push(path);
    }
    for (const p of toDelete) this.fileLocks.delete(p);
  }

  async executeWorkflow(
    tasks: WorkflowTask[],
    branchPrefix: string,
  ): Promise<Map<string, TaskResult>> {
    const results = new Map<string, TaskResult>();

    // Execute tasks in parallel across platforms
    const promises = tasks.map(async ({ platformId, task }) => {
      const bridge = this.bridges.get(platformId);
      if (!bridge) {
        results.set(task.id, {
          success: false,
          output: `Platform ${platformId} not registered`,
          filesModified: [],
          durationMs: 0,
        });
        return;
      }

      if (bridge.getStatus() === "disconnected") {
        try {
          await bridge.connect({});
        } catch (err) {
          results.set(task.id, {
            success: false,
            output: `Failed to connect ${platformId}: ${String(err)}`,
            filesModified: [],
            durationMs: 0,
          });
          return;
        }
      }

      // Assign branch if needed
      const taskWithBranch = {
        ...task,
        branch: task.branch ?? `${branchPrefix}/${platformId}/${task.id}`,
      };

      // Acquire file locks if constraints specify paths
      if (task.constraints?.filePaths) {
        for (const fp of task.constraints.filePaths) {
          if (!this.acquireLock(fp, platformId)) {
            results.set(task.id, {
              success: false,
              output: `File lock conflict for ${fp}`,
              filesModified: [],
              durationMs: 0,
            });
            return;
          }
        }
      }

      try {
        const result = await bridge.executeTask(taskWithBranch);
        results.set(task.id, result);
      } catch (err) {
        results.set(task.id, {
          success: false,
          output: String(err),
          filesModified: [],
          durationMs: 0,
        });
      } finally {
        // Release file locks
        if (task.constraints?.filePaths) {
          for (const fp of task.constraints.filePaths) {
            this.releaseLock(fp, platformId);
          }
        }
      }
    });

    await Promise.all(promises);
    return results;
  }
}
