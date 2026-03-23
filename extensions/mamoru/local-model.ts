/**
 * Local Model Setup — Guided local model detection and installation
 *
 * Detects GPU hardware, suggests appropriate models, and manages
 * local inference runtimes (Ollama, vLLM).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────────────────

export type GPUInfo = {
  vendor: "nvidia" | "amd" | "apple" | "none";
  name: string;
  vramMB: number;
};

export type LocalModelConfig = {
  runtime: "ollama" | "vllm" | "nim" | "custom";
  endpoint: string;
  model: string;
  gpuInfo: GPUInfo | null;
};

export type ModelSuggestion = {
  model: string;
  runtime: string;
  reason: string;
  vramRequired: number;
};

// ── Model catalog ────────────────────────────────────────────────────────

const MODEL_CATALOG: ModelSuggestion[] = [
  { model: "llama3.2:3b", runtime: "ollama", reason: "Lightweight, runs on CPU", vramRequired: 0 },
  { model: "llama3.3:8b", runtime: "ollama", reason: "Good balance of quality and speed", vramRequired: 6000 },
  { model: "llama3.3:70b", runtime: "ollama", reason: "High quality, needs GPU", vramRequired: 40000 },
  { model: "codellama:13b", runtime: "ollama", reason: "Optimized for code generation", vramRequired: 10000 },
  { model: "deepseek-coder-v2:16b", runtime: "ollama", reason: "Strong coding model", vramRequired: 12000 },
  { model: "mistral:7b", runtime: "ollama", reason: "Fast, efficient for general tasks", vramRequired: 6000 },
  { model: "qwen2.5:14b", runtime: "ollama", reason: "Multilingual, good for diverse tasks", vramRequired: 10000 },
];

// ── Implementation ───────────────────────────────────────────────────────

export class LocalModelSetup {
  /**
   * Detect the GPU available on the current system.
   */
  async detectGPU(): Promise<GPUInfo> {
    // NVIDIA: nvidia-smi
    try {
      const { stdout } = await execFileAsync("nvidia-smi", [
        "--query-gpu=name,memory.total",
        "--format=csv,noheader,nounits",
      ]);
      const line = stdout.trim().split("\n")[0];
      if (line) {
        const [name, vramStr] = line.split(",").map((s) => s.trim());
        const vramMB = parseInt(vramStr ?? "0", 10);
        return { vendor: "nvidia", name: name ?? "NVIDIA GPU", vramMB };
      }
    } catch {
      // nvidia-smi not available
    }

    // AMD: rocm-smi
    try {
      const { stdout } = await execFileAsync("rocm-smi", [
        "--showmeminfo",
        "vram",
      ]);
      const match = stdout.match(/Total\s+:\s+(\d+)/);
      if (match) {
        const vramBytes = parseInt(match[1]!, 10);
        return {
          vendor: "amd",
          name: "AMD GPU",
          vramMB: Math.round(vramBytes / (1024 * 1024)),
        };
      }
    } catch {
      // rocm-smi not available
    }

    // Apple Silicon: check platform + system memory as unified memory
    if (process.platform === "darwin") {
      try {
        const { stdout } = await execFileAsync("sysctl", ["-n", "hw.memsize"]);
        const memBytes = parseInt(stdout.trim(), 10);
        const memMB = Math.round(memBytes / (1024 * 1024));
        // Apple Silicon shares system memory as GPU VRAM
        // Allocate ~75% for model loading as a rough estimate
        return {
          vendor: "apple",
          name: "Apple Silicon",
          vramMB: Math.round(memMB * 0.75),
        };
      } catch {
        return { vendor: "apple", name: "Apple Silicon", vramMB: 8000 };
      }
    }

    return { vendor: "none", name: "No GPU detected", vramMB: 0 };
  }

  /**
   * Suggest models that can run on the detected hardware.
   */
  suggestModels(gpu: GPUInfo): ModelSuggestion[] {
    return MODEL_CATALOG.filter((m) => m.vramRequired <= gpu.vramMB);
  }

  /**
   * Check if Ollama is installed and reachable.
   */
  async checkOllama(): Promise<{
    installed: boolean;
    version?: string;
    endpoint?: string;
  }> {
    try {
      const { stdout } = await execFileAsync("ollama", ["--version"]);
      const version = stdout.trim().replace(/^ollama\s+version\s+/i, "");
      return {
        installed: true,
        version,
        endpoint: "http://localhost:11434/v1",
      };
    } catch {
      return { installed: false };
    }
  }

  /**
   * Install/pull a model via Ollama.
   */
  async installModel(
    model: string,
    onProgress?: (pct: number) => void,
  ): Promise<boolean> {
    try {
      const child = execFileAsync("ollama", ["pull", model]);

      // Ollama pull streams progress to stdout
      if (onProgress && child.child.stdout) {
        let lastPct = 0;
        child.child.stdout.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          const match = text.match(/(\d+)%/);
          if (match) {
            const pct = parseInt(match[1]!, 10);
            if (pct > lastPct) {
              lastPct = pct;
              onProgress(pct);
            }
          }
        });
      }

      await child;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Test a local inference endpoint for connectivity and latency.
   */
  async testEndpoint(
    endpoint: string,
    model: string,
  ): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();

    try {
      const url = endpoint.replace(/\/+$/, "") + "/chat/completions";
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        return { ok: false, latencyMs, error: `HTTP ${response.status}: ${text}` };
      }

      return { ok: true, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, latencyMs, error: message };
    }
  }

  /**
   * Build a LocalModelConfig for a given runtime and model.
   */
  getConfig(runtime: string, model: string): LocalModelConfig {
    const endpoints: Record<string, string> = {
      ollama: "http://localhost:11434/v1",
      vllm: "http://localhost:8000/v1",
      nim: "http://localhost:8000/v1",
      custom: "http://localhost:8080/v1",
    };

    return {
      runtime: (["ollama", "vllm", "nim"].includes(runtime) ? runtime : "custom") as LocalModelConfig["runtime"],
      endpoint: endpoints[runtime] ?? endpoints.custom!,
      model,
      gpuInfo: null,
    };
  }

  /**
   * Get the full model catalog.
   */
  getCatalog(): ModelSuggestion[] {
    return [...MODEL_CATALOG];
  }
}
