/**
 * Local Model Setup — Guided local model detection and installation
 *
 * Detects GPU hardware, Docker, Ollama, vLLM, NVIDIA NIM, and
 * offers guided installation of local inference runtimes.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { MamoruGate } from "./egress-gate.js";

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

export type RuntimeInfo = {
  name: "docker" | "ollama" | "vllm" | "nim";
  installed: boolean;
  version?: string;
  endpoint?: string;
  gpuSupport?: boolean;
};

export type InstallGuide = {
  runtime: string;
  platform: string;
  command: string;
  url: string;
  notes: string;
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
   * Validates the endpoint against SSRF rules before making the request.
   */
  async testEndpoint(
    endpoint: string,
    model: string,
  ): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();

    try {
      const url = endpoint.replace(/\/+$/, "") + "/chat/completions";

      // SSRF validation: block requests to private/reserved IPs
      const ssrfGate = new MamoruGate("local-model");
      // Allow localhost for local model runtimes (Ollama, vLLM, etc.)
      ssrfGate.addPreset("cortex");
      ssrfGate.addRule({ host: "127.0.0.1", port: 11434, protocol: "http" });
      ssrfGate.addRule({ host: "127.0.0.1", port: 8000, protocol: "http" });
      ssrfGate.addRule({ host: "127.0.0.1", port: 8080, protocol: "http" });
      ssrfGate.addRule({ host: "localhost", port: 11434, protocol: "http" });
      ssrfGate.addRule({ host: "localhost", port: 8000, protocol: "http" });
      ssrfGate.addRule({ host: "localhost", port: 8080, protocol: "http" });
      const ssrfCheck = await ssrfGate.validateEndpoint(url);
      if (!ssrfCheck.safe) {
        return { ok: false, latencyMs: Date.now() - start, error: `SSRF blocked: ${ssrfCheck.reason}` };
      }
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

  // ── Runtime Detection ─────────────────────────────────────────────

  /**
   * Detect all available local inference runtimes.
   */
  async detectRuntimes(): Promise<RuntimeInfo[]> {
    const runtimes: RuntimeInfo[] = [];

    // Docker
    try {
      const { stdout } = await execFileAsync("docker", ["--version"]);
      const version = stdout.trim().match(/(\d+\.\d+\.\d+)/)?.[1];
      // Check if NVIDIA Container Toolkit is available
      let gpuSupport = false;
      try {
        await execFileAsync("docker", ["run", "--rm", "--gpus", "all", "nvidia/cuda:12.0-base", "nvidia-smi"], { timeout: 10_000 });
        gpuSupport = true;
      } catch { /* no GPU support */ }
      runtimes.push({ name: "docker", installed: true, version, gpuSupport });
    } catch {
      runtimes.push({ name: "docker", installed: false });
    }

    // Ollama
    const ollama = await this.checkOllama();
    runtimes.push({
      name: "ollama",
      installed: ollama.installed,
      version: ollama.version,
      endpoint: ollama.endpoint,
    });

    // vLLM (check if python vllm package or running server)
    try {
      const response = await fetch("http://localhost:8000/v1/models", {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        runtimes.push({ name: "vllm", installed: true, endpoint: "http://localhost:8000/v1" });
      } else {
        runtimes.push({ name: "vllm", installed: false });
      }
    } catch {
      runtimes.push({ name: "vllm", installed: false });
    }

    // NVIDIA NIM (check for running NIM service)
    try {
      const response = await fetch("http://localhost:8000/v1/models", {
        signal: AbortSignal.timeout(3000),
        headers: { "User-Agent": "mayros-detect" },
      });
      if (response.ok) {
        const data = await response.json() as { data?: Array<{ id: string }> };
        const hasNvidia = data.data?.some((m) => m.id.includes("nvidia") || m.id.includes("nemotron"));
        if (hasNvidia) {
          runtimes.push({ name: "nim", installed: true, endpoint: "http://localhost:8000/v1" });
        }
      }
    } catch {
      runtimes.push({ name: "nim", installed: false });
    }

    return runtimes;
  }

  /**
   * Get installation guides for each runtime on the current platform.
   */
  getInstallGuides(): InstallGuide[] {
    const platform = process.platform;
    const guides: InstallGuide[] = [];

    // Ollama — universal
    if (platform === "darwin") {
      guides.push({
        runtime: "ollama",
        platform: "macOS",
        command: "brew install ollama && ollama serve",
        url: "https://ollama.com/download",
        notes: "Apple Silicon optimized. Runs natively, no Docker needed.",
      });
    } else if (platform === "linux") {
      guides.push({
        runtime: "ollama",
        platform: "Linux",
        command: "curl -fsSL https://ollama.com/install.sh | sh",
        url: "https://ollama.com/download",
        notes: "Supports NVIDIA GPU out of the box. AMD via ROCm.",
      });
    } else if (platform === "win32") {
      guides.push({
        runtime: "ollama",
        platform: "Windows",
        command: "winget install Ollama.Ollama",
        url: "https://ollama.com/download",
        notes: "Supports NVIDIA GPU. Download from ollama.com or use winget.",
      });
    }

    // Docker — for NIM, vLLM
    if (platform === "win32") {
      guides.push({
        runtime: "docker",
        platform: "Windows",
        command: "winget install Docker.DockerDesktop",
        url: "https://docs.docker.com/desktop/install/windows-install/",
        notes: "Required for NVIDIA NIM and vLLM. Enable WSL2 backend.",
      });
    } else if (platform === "darwin") {
      guides.push({
        runtime: "docker",
        platform: "macOS",
        command: "brew install --cask docker",
        url: "https://docs.docker.com/desktop/install/mac-install/",
        notes: "Required for NVIDIA NIM. Apple Silicon supported via Rosetta.",
      });
    } else {
      guides.push({
        runtime: "docker",
        platform: "Linux",
        command: "curl -fsSL https://get.docker.com | sh",
        url: "https://docs.docker.com/engine/install/",
        notes: "Required for NVIDIA NIM. Add nvidia-container-toolkit for GPU.",
      });
    }

    // NVIDIA NIM — requires Docker + NVIDIA GPU
    guides.push({
      runtime: "nim",
      platform: "Any (Docker)",
      command: "docker run --gpus all -p 8000:8000 nvcr.io/nim/meta/llama-3.1-8b-instruct:latest",
      url: "https://build.nvidia.com",
      notes: "Requires Docker + NVIDIA GPU + API key from build.nvidia.com.",
    });

    // vLLM — Python
    guides.push({
      runtime: "vllm",
      platform: "Any (Python)",
      command: "pip install vllm && vllm serve meta-llama/Llama-3.3-70B --port 8000",
      url: "https://docs.vllm.ai/en/latest/getting_started/installation.html",
      notes: "Requires Python 3.9+ and NVIDIA GPU with CUDA. High performance.",
    });

    return guides;
  }

  /**
   * Attempt to install Ollama automatically.
   * Returns true if installation succeeded.
   */
  async installOllama(): Promise<{ success: boolean; message: string }> {
    const platform = process.platform;
    try {
      if (platform === "win32") {
        await execFileAsync("winget", ["install", "Ollama.Ollama", "--accept-package-agreements", "--accept-source-agreements"], { timeout: 120_000 });
        return { success: true, message: "Ollama installed via winget. Run 'ollama serve' to start." };
      } else if (platform === "darwin") {
        await execFileAsync("brew", ["install", "ollama"], { timeout: 120_000 });
        return { success: true, message: "Ollama installed via brew. Run 'ollama serve' to start." };
      } else {
        // Linux: use the official install script
        const { execSync } = await import("node:child_process");
        execSync("curl -fsSL https://ollama.com/install.sh | sh", { timeout: 120_000, stdio: "pipe" });
        return { success: true, message: "Ollama installed. It should start automatically." };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Installation failed: ${msg}. Install manually from https://ollama.com` };
    }
  }
}
