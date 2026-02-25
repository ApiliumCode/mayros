/**
 * Manages the AIngle Cortex sidecar process lifecycle.
 *
 * - Spawn `aingle-cortex` if autoStart is true and binaryPath is set
 * - Poll /health with exponential backoff (max 10 s)
 * - Skip spawn when Cortex is already reachable on the configured port
 * - Graceful shutdown via SIGTERM
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { locateCortexBinary, getCortexBinaryVersion } from "../shared/cortex-binary-locator.js";
import { REQUIRED_CORTEX_VERSION } from "../shared/cortex-version.js";
import type { CortexConfig } from "./config.js";
import { CortexClient } from "./cortex-client.js";

export type SidecarStatus = "stopped" | "starting" | "running" | "failed";

export class CortexSidecar {
  private process: ChildProcess | null = null;
  private _status: SidecarStatus = "stopped";
  private readonly client: CortexClient;
  private signalHandlers = new Map<string, () => void>();
  private restartAttempted = false;

  constructor(private readonly config: CortexConfig) {
    this.client = new CortexClient(config);
  }

  get status(): SidecarStatus {
    return this._status;
  }

  /**
   * Ensure Cortex is reachable, spawning the process if needed.
   * Returns `true` when healthy, `false` on failure.
   */
  async start(): Promise<boolean> {
    // Already running externally?
    if (await this.client.isHealthy()) {
      this._status = "running";
      return true;
    }

    if (!this.config.autoStart) {
      this._status = "stopped";
      return false;
    }

    // Auto-detect binary if not explicitly configured
    let binaryPath = this.config.binaryPath;
    if (!binaryPath) {
      binaryPath = await locateCortexBinary();
    }

    if (!binaryPath || !existsSync(binaryPath)) {
      this._status = "failed";
      return false;
    }

    // Warn (but don't block) if the installed binary is older than required
    const installedVersion = getCortexBinaryVersion(binaryPath);
    if (installedVersion && REQUIRED_CORTEX_VERSION) {
      const [iMaj, iMin, iPat] = installedVersion.split(".").map(Number);
      const [rMaj, rMin, rPat] = REQUIRED_CORTEX_VERSION.split(".").map(Number);
      if (
        iMaj < rMaj ||
        (iMaj === rMaj && iMin < rMin) ||
        (iMaj === rMaj && iMin === rMin && iPat < rPat)
      ) {
        console.warn(
          `[cortex] binary outdated (${installedVersion} < ${REQUIRED_CORTEX_VERSION}). Run: mayros update`,
        );
      }
    } else if (!installedVersion) {
      console.warn(`[cortex] could not determine binary version. Run: mayros update`);
    }

    // Strict version enforcement: block outdated binary when enabled
    if (this.config.strictVersionCheck && installedVersion && REQUIRED_CORTEX_VERSION) {
      const [iMaj, iMin, iPat] = installedVersion.split(".").map(Number);
      const [rMaj, rMin, rPat] = REQUIRED_CORTEX_VERSION.split(".").map(Number);
      const isOutdated =
        iMaj < rMaj ||
        (iMaj === rMaj && iMin < rMin) ||
        (iMaj === rMaj && iMin === rMin && iPat < rPat);
      if (isOutdated) {
        console.error(
          `[cortex] strict version check failed: ${installedVersion} < ${REQUIRED_CORTEX_VERSION}. Update required.`,
        );
        this._status = "failed";
        return false;
      }
    }

    return this.spawn(binaryPath);
  }

  async stop(): Promise<void> {
    // Remove process signal handlers to prevent double-stop
    this.removeSignalHandlers();

    if (!this.process) {
      this._status = "stopped";
      return;
    }

    const proc = this.process;
    this.process = null;

    // Give it a chance to shut down gracefully
    proc.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 5000);

      proc.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this._status = "stopped";
  }

  private removeSignalHandlers(): void {
    for (const [signal, handler] of this.signalHandlers) {
      process.removeListener(signal, handler);
    }
    this.signalHandlers.clear();
  }

  // ---------- internals ----------

  private async spawn(binaryPath: string): Promise<boolean> {
    this._status = "starting";

    const args = ["--host", this.config.host, "--port", String(this.config.port)];

    try {
      this.process = spawn(binaryPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });
    } catch {
      this._status = "failed";
      return false;
    }

    // Drain stdout/stderr to prevent child process blocking on full pipe buffers
    this.process.stdout?.resume();
    this.process.stderr?.resume();

    // Handle unexpected exit with one auto-restart attempt
    this.process.once("exit", (code) => {
      if (this._status === "running" || this._status === "starting") {
        this._status = code === 0 ? "stopped" : "failed";
      }
      this.process = null;
      this.removeSignalHandlers();

      // Auto-restart on unexpected crash (one attempt only)
      if (this._status === "failed" && !this.restartAttempted) {
        this.restartAttempted = true;
        console.warn("[cortex] sidecar crashed unexpectedly, attempting restart...");
        void this.spawn(binaryPath).then((ok) => {
          if (ok) {
            console.info("[cortex] sidecar restarted successfully");
          } else {
            console.error("[cortex] sidecar restart failed");
          }
        });
      }
    });

    // Handle spawn errors
    this.process.once("error", () => {
      this._status = "failed";
      this.process = null;
    });

    // Wait for health with exponential backoff
    const healthy = await this.waitForHealthy();
    if (healthy) {
      this._status = "running";
      this.restartAttempted = false; // reset for future crashes

      // Register process signal handlers for graceful sidecar shutdown
      const cleanup = () => {
        void this.stop();
      };
      for (const signal of ["SIGTERM", "SIGINT", "beforeExit"] as const) {
        process.once(signal, cleanup);
        this.signalHandlers.set(signal, cleanup);
      }
    } else {
      this._status = "failed";
      await this.stop();
    }
    return healthy;
  }

  private async waitForHealthy(): Promise<boolean> {
    const maxWaitMs = 10_000;
    const start = Date.now();
    let delay = 100;

    while (Date.now() - start < maxWaitMs) {
      if (await this.client.isHealthy()) {
        return true;
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 2000);
    }

    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
