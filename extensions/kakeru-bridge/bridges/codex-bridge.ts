import { spawn } from "node:child_process";
import type {
  IPlatformBridge,
  PlatformCapability,
  PlatformStatus,
  PlatformTask,
  TaskResult,
} from "../platform-bridge.js";

export type CodexBridgeConfig = {
  binaryPath: string;
  apiKeyEnv: string;
  defaultTimeout: number;
};

export class CodexBridge implements IPlatformBridge {
  readonly id = "codex";
  readonly name = "OpenAI Codex CLI";
  readonly capabilities: PlatformCapability[] = ["code-edit", "file-read", "shell-exec"];
  private status: PlatformStatus = "disconnected";
  private config: CodexBridgeConfig;
  private activeProcesses = new Map<string, { kill: () => void }>();

  constructor(config: CodexBridgeConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.status = "connecting";

    // Verify binary exists
    try {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(this.config.binaryPath, ["--version"], {
          stdio: "pipe",
          timeout: 5000,
        });
        proc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`codex --version exited with code ${code}`));
        });
        proc.on("error", reject);
      });
    } catch (err) {
      this.status = "error";
      throw new Error(`Codex binary not found at ${this.config.binaryPath}: ${String(err)}`);
    }

    // Verify API key
    if (!process.env[this.config.apiKeyEnv]) {
      this.status = "error";
      throw new Error(`Environment variable ${this.config.apiKeyEnv} not set`);
    }

    this.status = "idle";
  }

  async disconnect(): Promise<void> {
    for (const [, proc] of this.activeProcesses) proc.kill();
    this.activeProcesses.clear();
    this.status = "disconnected";
  }

  getStatus(): PlatformStatus {
    return this.status;
  }

  async executeTask(task: PlatformTask): Promise<TaskResult> {
    if (this.status !== "idle") {
      throw new Error(`Codex bridge not ready (status: ${this.status})`);
    }

    const start = Date.now();
    const timeout = task.timeout ?? this.config.defaultTimeout;
    this.status = "busy";

    try {
      const output = await new Promise<string>((resolve, reject) => {
        const args = ["--quiet", "--approval-mode", "full-auto", "--prompt", task.prompt];

        const proc = spawn(this.config.binaryPath, args, {
          cwd: task.workDir,
          stdio: ["ignore", "pipe", "pipe"],
          timeout,
          env: { ...process.env },
        });

        this.activeProcesses.set(task.id, {
          kill: () => proc.kill("SIGTERM"),
        });

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        proc.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on("close", (code) => {
          this.activeProcesses.delete(task.id);
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(new Error(`Codex exited with code ${code}: ${stderr.slice(0, 500)}`));
          }
        });

        proc.on("error", (err) => {
          this.activeProcesses.delete(task.id);
          reject(err);
        });
      });

      // Parse modified files from output (regex heuristic — fallback)
      const filesModified: string[] = [];
      const filePatterns = output.match(/(?:wrote|modified|created|updated)\s+(\S+)/gi);
      if (filePatterns) {
        for (const match of filePatterns) {
          const file = match.replace(/^(?:wrote|modified|created|updated)\s+/i, "").trim();
          if (file && !filesModified.includes(file)) filesModified.push(file);
        }
      }

      // Primary: use git diff for accurate file detection
      try {
        const gitOutput = await new Promise<string>((resolve, reject) => {
          const git = spawn("git", ["diff", "--name-only"], {
            cwd: task.workDir,
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 5000,
          });
          let out = "";
          git.stdout?.on("data", (d: Buffer) => {
            out += d.toString();
          });
          git.on("close", (code) => {
            if (code === 0) resolve(out);
            else reject(new Error(`git diff exited ${code}`));
          });
          git.on("error", reject);
        });
        filesModified.push(
          ...gitOutput
            .split("\n")
            .map((f) => f.trim())
            .filter(Boolean)
            .filter((f) => !filesModified.includes(f)),
        );
      } catch {
        // git diff failed — fall through to regex fallback only
      }

      return {
        success: true,
        output,
        filesModified,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        success: false,
        output: String(err),
        filesModified: [],
        durationMs: Date.now() - start,
      };
    } finally {
      this.status = "idle";
    }
  }

  async cancelTask(taskId: string): Promise<void> {
    const proc = this.activeProcesses.get(taskId);
    if (proc) {
      proc.kill();
      this.activeProcesses.delete(taskId);
    }
  }
}
