import type {
  IPlatformBridge,
  PlatformCapability,
  PlatformStatus,
  PlatformTask,
  TaskResult,
} from "../platform-bridge.js";

export class ClaudeBridge implements IPlatformBridge {
  readonly id = "claude";
  readonly name = "Claude Code (Native)";
  readonly capabilities: PlatformCapability[] = [
    "code-edit",
    "file-read",
    "shell-exec",
    "vision",
    "long-context",
  ];
  private status: PlatformStatus = "idle";
  private activeTasks = new Map<string, AbortController>();

  async connect(): Promise<void> {
    this.status = "idle";
  }

  async disconnect(): Promise<void> {
    for (const [, ctrl] of this.activeTasks) ctrl.abort();
    this.activeTasks.clear();
    this.status = "disconnected";
  }

  getStatus(): PlatformStatus {
    return this.status;
  }

  async executeTask(task: PlatformTask): Promise<TaskResult> {
    const controller = new AbortController();
    this.activeTasks.set(task.id, controller);
    this.status = "busy";

    try {
      return {
        success: false,
        output: "Claude native bridge: not yet implemented. Use direct agent execution instead.",
        filesModified: [],
        durationMs: 0,
      };
    } finally {
      this.activeTasks.delete(task.id);
      this.status = "idle";
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    const ctrl = this.activeTasks.get(taskId);
    if (ctrl) {
      ctrl.abort();
      this.activeTasks.delete(taskId);
    }
  }
}
