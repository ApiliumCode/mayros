export type PlatformCapability =
  | "code-edit"
  | "file-read"
  | "shell-exec"
  | "vision"
  | "long-context";
export type PlatformStatus = "disconnected" | "connecting" | "idle" | "busy" | "error";

export type PlatformTask = {
  id: string;
  prompt: string;
  workDir: string;
  branch?: string;
  timeout?: number;
  constraints?: { filePaths?: string[]; readOnly?: boolean };
};

export type TaskResult = {
  success: boolean;
  output: string;
  filesModified: string[];
  tokensUsed?: number;
  costUsd?: number;
  durationMs: number;
};

export interface IPlatformBridge {
  readonly id: string;
  readonly name: string;
  readonly capabilities: PlatformCapability[];
  connect(config?: Record<string, unknown>): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): PlatformStatus;
  executeTask(task: PlatformTask): Promise<TaskResult>;
  cancelTask(taskId: string): Promise<void>;
}
