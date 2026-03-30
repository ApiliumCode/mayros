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

// ── Activity-segmented model types ──────────────────────────────────────

export type ModelActivity =
  | "coding" // code generation, debugging, refactoring
  | "chat" // general conversation, Q&A
  | "reasoning" // complex logic, math, planning
  | "creative" // writing, storytelling, content
  | "analysis" // data analysis, research, summarization
  | "multilingual" // translation, cross-language tasks
  | "vision" // image understanding (multimodal)
  | "agents"; // autonomous agent tasks, tool use

export type ModelTier = "small" | "medium" | "large" | "xlarge";

export type CatalogModel = {
  id: string; // ollama/nim model ID
  name: string; // human-readable name
  provider:
    | "meta"
    | "nvidia"
    | "mistral"
    | "google"
    | "deepseek"
    | "qwen"
    | "microsoft"
    | "cohere"
    | "ibm"
    | "01ai"
    | "upstage";
  activities: ModelActivity[]; // what it's good at
  tier: ModelTier;
  parameters: string; // "3B", "8B", "70B", etc.
  vramRequired: number; // MB
  contextLength: number; // tokens
  quantization: string; // "Q4_K_M", "Q8_0", "FP16"
  runtime: "ollama" | "vllm" | "nim";
  strengths: string; // 1-line description
};

export type ActivityDescription = {
  activity: ModelActivity;
  label: string;
  description: string;
};

// ── Activity descriptions ────────────────────────────────────────────────

const ACTIVITY_DESCRIPTIONS: ActivityDescription[] = [
  {
    activity: "coding",
    label: "Coding",
    description: "Code generation, debugging, refactoring, and completion",
  },
  {
    activity: "chat",
    label: "Chat",
    description: "General conversation, Q&A, and instruction following",
  },
  {
    activity: "reasoning",
    label: "Reasoning",
    description: "Complex logic, math, planning, and chain-of-thought",
  },
  {
    activity: "creative",
    label: "Creative",
    description: "Writing, storytelling, content generation, and brainstorming",
  },
  {
    activity: "analysis",
    label: "Analysis",
    description: "Data analysis, research, summarization, and extraction",
  },
  {
    activity: "multilingual",
    label: "Multilingual",
    description: "Translation, cross-language tasks, and polyglot support",
  },
  {
    activity: "vision",
    label: "Vision",
    description: "Image understanding, visual QA, and multimodal reasoning",
  },
  {
    activity: "agents",
    label: "Agents",
    description: "Autonomous agent tasks, tool use, and function calling",
  },
];

// ── Model catalog (activity-segmented) ──────────────────────────────────

const CATALOG: CatalogModel[] = [
  // ── Tiny models (0-4GB VRAM) — run on any machine ─────────────────
  {
    id: "qwen2.5-coder:1.5b",
    name: "Qwen 2.5 Coder 1.5B",
    provider: "qwen",
    activities: ["coding"],
    tier: "small",
    parameters: "1.5B",
    vramRequired: 0,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Tiny but capable code model, runs on CPU",
  },
  {
    id: "qwen2.5:0.5b",
    name: "Qwen 2.5 0.5B",
    provider: "qwen",
    activities: ["chat"],
    tier: "small",
    parameters: "0.5B",
    vramRequired: 0,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Smallest Qwen, ultra-fast, edge devices",
  },
  {
    id: "tinyllama:1.1b",
    name: "TinyLlama 1.1B",
    provider: "meta",
    activities: ["chat"],
    tier: "small",
    parameters: "1.1B",
    vramRequired: 0,
    contextLength: 2048,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Ultra-light, instant responses on any hardware",
  },
  {
    id: "gemma2:2b",
    name: "Gemma 2 2B",
    provider: "google",
    activities: ["chat"],
    tier: "small",
    parameters: "2B",
    vramRequired: 0,
    contextLength: 8192,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Google's tiny model, CPU friendly",
  },
  {
    id: "phi-3.5:3.8b",
    name: "Phi 3.5 Mini 3.8B",
    provider: "microsoft",
    activities: ["chat", "reasoning"],
    tier: "small",
    parameters: "3.8B",
    vramRequired: 3000,
    contextLength: 128000,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Microsoft's small powerhouse, 128K context",
  },
  {
    id: "deepseek-r1:1.5b",
    name: "DeepSeek R1 1.5B",
    provider: "deepseek",
    activities: ["reasoning"],
    tier: "small",
    parameters: "1.5B",
    vramRequired: 0,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Chain-of-thought reasoning on CPU",
  },
  {
    id: "qwen2.5:3b",
    name: "Qwen 2.5 3B",
    provider: "qwen",
    activities: ["multilingual", "chat"],
    tier: "small",
    parameters: "3B",
    vramRequired: 0,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Multilingual on CPU, CJK + Latin languages",
  },
  {
    id: "moondream:1.8b",
    name: "Moondream 1.8B",
    provider: "meta",
    activities: ["vision"],
    tier: "small",
    parameters: "1.8B",
    vramRequired: 2000,
    contextLength: 2048,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Tiny vision model, image understanding",
  },
  {
    id: "smollm2:1.7b",
    name: "SmolLM2 1.7B",
    provider: "microsoft",
    activities: ["agents", "chat"],
    tier: "small",
    parameters: "1.7B",
    vramRequired: 0,
    contextLength: 8192,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Small but capable for simple agent tasks",
  },

  // ── Coding models (5GB+) ─────────────────────────────────────────
  {
    id: "codellama:7b",
    name: "Code Llama 7B",
    provider: "meta",
    activities: ["coding"],
    tier: "small",
    parameters: "7B",
    vramRequired: 5000,
    contextLength: 16384,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Fast code completion and infilling, low VRAM",
  },
  {
    id: "codellama:13b",
    name: "Code Llama 13B",
    provider: "meta",
    activities: ["coding"],
    tier: "medium",
    parameters: "13B",
    vramRequired: 10000,
    contextLength: 16384,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Strong code generation with better accuracy than 7B",
  },
  {
    id: "codellama:34b",
    name: "Code Llama 34B",
    provider: "meta",
    activities: ["coding", "reasoning"],
    tier: "large",
    parameters: "34B",
    vramRequired: 22000,
    contextLength: 16384,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Best Code Llama for complex code tasks",
  },
  {
    id: "deepseek-coder-v2:lite",
    name: "DeepSeek Coder V2 Lite",
    provider: "deepseek",
    activities: ["coding", "reasoning"],
    tier: "medium",
    parameters: "16B",
    vramRequired: 12000,
    contextLength: 128000,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "MoE architecture, 128K context, strong on benchmarks",
  },
  {
    id: "deepseek-coder-v2",
    name: "DeepSeek Coder V2",
    provider: "deepseek",
    activities: ["coding", "reasoning", "analysis"],
    tier: "large",
    parameters: "236B",
    vramRequired: 22000,
    contextLength: 128000,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Top-tier code model with extended context window",
  },
  {
    id: "qwen2.5-coder:7b",
    name: "Qwen 2.5 Coder 7B",
    provider: "qwen",
    activities: ["coding"],
    tier: "small",
    parameters: "7B",
    vramRequired: 5000,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Competitive with larger models on code tasks",
  },
  {
    id: "qwen2.5-coder:14b",
    name: "Qwen 2.5 Coder 14B",
    provider: "qwen",
    activities: ["coding", "agents"],
    tier: "medium",
    parameters: "14B",
    vramRequired: 10000,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Strong code + tool-use capabilities",
  },
  {
    id: "qwen2.5-coder:32b",
    name: "Qwen 2.5 Coder 32B",
    provider: "qwen",
    activities: ["coding", "reasoning", "agents"],
    tier: "large",
    parameters: "32B",
    vramRequired: 22000,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Best Qwen coder, rivals GPT-4 on code benchmarks",
  },
  {
    id: "starcoder2:7b",
    name: "StarCoder2 7B",
    provider: "microsoft",
    activities: ["coding"],
    tier: "small",
    parameters: "7B",
    vramRequired: 5000,
    contextLength: 16384,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Trained on The Stack v2, fast completions",
  },
  {
    id: "starcoder2:15b",
    name: "StarCoder2 15B",
    provider: "microsoft",
    activities: ["coding"],
    tier: "medium",
    parameters: "15B",
    vramRequired: 11000,
    contextLength: 16384,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Larger StarCoder2 with improved accuracy",
  },

  // ── Chat / General models ─────────────────────────────────────────
  {
    id: "llama3.2:3b",
    name: "Llama 3.2 3B",
    provider: "meta",
    activities: ["chat"],
    tier: "small",
    parameters: "3B",
    vramRequired: 0,
    contextLength: 8192,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Lightweight, runs on CPU, fast responses",
  },
  {
    id: "llama3.1:8b",
    name: "Llama 3.1 8B",
    provider: "meta",
    activities: ["chat", "creative", "agents"],
    tier: "small",
    parameters: "8B",
    vramRequired: 6000,
    contextLength: 128000,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Excellent general model with function calling",
  },
  {
    id: "llama3.3:70b",
    name: "Llama 3.3 70B",
    provider: "meta",
    activities: ["chat", "reasoning", "analysis", "agents"],
    tier: "xlarge",
    parameters: "70B",
    vramRequired: 40000,
    contextLength: 128000,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Flagship Llama, near-frontier quality across all tasks",
  },
  {
    id: "mistral:7b",
    name: "Mistral 7B",
    provider: "mistral",
    activities: ["chat", "creative"],
    tier: "small",
    parameters: "7B",
    vramRequired: 6000,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Fast, efficient, strong for its size",
  },
  {
    id: "mistral-nemo:12b",
    name: "Mistral Nemo 12B",
    provider: "mistral",
    activities: ["chat", "agents", "multilingual"],
    tier: "medium",
    parameters: "12B",
    vramRequired: 9000,
    contextLength: 128000,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "128K context, function calling, multilingual",
  },
  {
    id: "mixtral:8x7b",
    name: "Mixtral 8x7B",
    provider: "mistral",
    activities: ["chat", "reasoning", "coding"],
    tier: "large",
    parameters: "47B",
    vramRequired: 28000,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "MoE with 8 experts, fast inference for its quality",
  },
  {
    id: "phi-4:14b",
    name: "Phi-4 14B",
    provider: "microsoft",
    activities: ["chat", "reasoning", "coding"],
    tier: "medium",
    parameters: "14B",
    vramRequired: 10000,
    contextLength: 16384,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Strong reasoning for its size, efficient architecture",
  },
  {
    id: "gemma2:9b",
    name: "Gemma 2 9B",
    provider: "google",
    activities: ["chat", "creative"],
    tier: "small",
    parameters: "9B",
    vramRequired: 7000,
    contextLength: 8192,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Google's efficient model, strong on benchmarks",
  },
  {
    id: "gemma2:27b",
    name: "Gemma 2 27B",
    provider: "google",
    activities: ["chat", "reasoning", "analysis"],
    tier: "large",
    parameters: "27B",
    vramRequired: 18000,
    contextLength: 8192,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Best Gemma, competitive with much larger models",
  },

  // ── Reasoning models ──────────────────────────────────────────────
  {
    id: "deepseek-r1:7b",
    name: "DeepSeek R1 7B",
    provider: "deepseek",
    activities: ["reasoning", "analysis"],
    tier: "small",
    parameters: "7B",
    vramRequired: 5000,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Chain-of-thought reasoning at small scale",
  },
  {
    id: "deepseek-r1:14b",
    name: "DeepSeek R1 14B",
    provider: "deepseek",
    activities: ["reasoning", "analysis", "coding"],
    tier: "medium",
    parameters: "14B",
    vramRequired: 10000,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Strong reasoning with code understanding",
  },
  {
    id: "deepseek-r1:70b",
    name: "DeepSeek R1 70B",
    provider: "deepseek",
    activities: ["reasoning", "analysis", "coding"],
    tier: "xlarge",
    parameters: "70B",
    vramRequired: 40000,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Frontier-level reasoning, rivals o1 on math benchmarks",
  },
  {
    id: "qwen2.5:72b",
    name: "Qwen 2.5 72B",
    provider: "qwen",
    activities: ["reasoning", "analysis", "multilingual"],
    tier: "xlarge",
    parameters: "72B",
    vramRequired: 42000,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Top-tier reasoning and multilingual capabilities",
  },

  // ── Creative / Writing models ─────────────────────────────────────
  {
    id: "yi:34b",
    name: "Yi 34B",
    provider: "01ai",
    activities: ["creative", "chat", "multilingual"],
    tier: "large",
    parameters: "34B",
    vramRequired: 22000,
    contextLength: 4096,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Strong creative writing and bilingual (EN/ZH)",
  },

  // ── Multilingual models ───────────────────────────────────────────
  {
    id: "qwen2.5:7b",
    name: "Qwen 2.5 7B",
    provider: "qwen",
    activities: ["multilingual", "chat"],
    tier: "small",
    parameters: "7B",
    vramRequired: 5000,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Strong multilingual support including CJK languages",
  },
  {
    id: "qwen2.5:14b",
    name: "Qwen 2.5 14B",
    provider: "qwen",
    activities: ["multilingual", "chat", "agents", "analysis"],
    tier: "medium",
    parameters: "14B",
    vramRequired: 10000,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Best mid-size multilingual model with tool use",
  },
  {
    id: "qwen2.5:32b",
    name: "Qwen 2.5 32B",
    provider: "qwen",
    activities: ["multilingual", "analysis", "reasoning"],
    tier: "large",
    parameters: "32B",
    vramRequired: 22000,
    contextLength: 32768,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Strong analysis and multilingual reasoning",
  },
  {
    id: "aya:8b",
    name: "Aya 8B",
    provider: "cohere",
    activities: ["multilingual", "chat"],
    tier: "small",
    parameters: "8B",
    vramRequired: 6000,
    contextLength: 8192,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Covers 23+ languages including underrepresented ones",
  },
  {
    id: "aya:35b",
    name: "Aya 35B",
    provider: "cohere",
    activities: ["multilingual", "chat", "analysis"],
    tier: "large",
    parameters: "35B",
    vramRequired: 24000,
    contextLength: 8192,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Best multilingual coverage with strong quality",
  },

  // ── Vision (multimodal) models ────────────────────────────────────
  {
    id: "llava:7b",
    name: "LLaVA 7B",
    provider: "meta",
    activities: ["vision", "chat"],
    tier: "small",
    parameters: "7B",
    vramRequired: 6000,
    contextLength: 4096,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Fast visual QA with image understanding",
  },
  {
    id: "llava:13b",
    name: "LLaVA 13B",
    provider: "meta",
    activities: ["vision", "chat"],
    tier: "medium",
    parameters: "13B",
    vramRequired: 10000,
    contextLength: 4096,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Better image reasoning than 7B variant",
  },
  {
    id: "llama3.2-vision:11b",
    name: "Llama 3.2 Vision 11B",
    provider: "meta",
    activities: ["vision", "chat", "analysis"],
    tier: "medium",
    parameters: "11B",
    vramRequired: 8000,
    contextLength: 128000,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Native multimodal with 128K context",
  },

  // ── Agent-focused models ───────────────────────────────────────────
  {
    id: "granite3-dense:8b",
    name: "Granite 3 Dense 8B",
    provider: "ibm",
    activities: ["agents", "coding", "chat"],
    tier: "small",
    parameters: "8B",
    vramRequired: 6000,
    contextLength: 8192,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Enterprise-grade with strong tool-use support",
  },
  {
    id: "granite3-moe:3b",
    name: "Granite 3 MoE 3B",
    provider: "ibm",
    activities: ["agents", "chat"],
    tier: "small",
    parameters: "3B",
    vramRequired: 3000,
    contextLength: 8192,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Lightweight MoE architecture for agent workloads",
  },

  // ── Analysis-focused additions ────────────────────────────────────
  {
    id: "solar:10.7b",
    name: "Solar 10.7B",
    provider: "upstage",
    activities: ["analysis", "chat", "creative"],
    tier: "medium",
    parameters: "10.7B",
    vramRequired: 8000,
    contextLength: 4096,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "Depth-upscaled architecture, strong summarization",
  },
  {
    id: "command-r:35b",
    name: "Command R 35B",
    provider: "cohere",
    activities: ["analysis", "agents", "multilingual"],
    tier: "large",
    parameters: "35B",
    vramRequired: 24000,
    contextLength: 128000,
    quantization: "Q4_K_M",
    runtime: "ollama",
    strengths: "RAG-optimized with grounded generation and citations",
  },

  // ── NVIDIA NIM models ─────────────────────────────────────────────
  {
    id: "nvidia/nemotron-mini:4b",
    name: "Nemotron Mini 4B",
    provider: "nvidia",
    activities: ["chat", "agents"],
    tier: "small",
    parameters: "4B",
    vramRequired: 4000,
    contextLength: 8192,
    quantization: "FP16",
    runtime: "nim",
    strengths: "Optimized for NIM runtime, low-latency inference",
  },
  {
    id: "nvidia/nemotron-nano:8b",
    name: "Nemotron Nano 8B",
    provider: "nvidia",
    activities: ["chat", "coding", "agents"],
    tier: "small",
    parameters: "8B",
    vramRequired: 8000,
    contextLength: 8192,
    quantization: "FP16",
    runtime: "nim",
    strengths: "TensorRT-LLM optimized, fast for coding tasks",
  },
  {
    id: "nvidia/nemotron-super:49b",
    name: "Nemotron Super 49B",
    provider: "nvidia",
    activities: ["chat", "reasoning", "coding", "agents"],
    tier: "xlarge",
    parameters: "49B",
    vramRequired: 48000,
    contextLength: 32768,
    quantization: "FP16",
    runtime: "nim",
    strengths: "High-quality with NIM optimizations, strong reasoning",
  },
  {
    id: "nvidia/nemotron-ultra:253b",
    name: "Nemotron Ultra 253B",
    provider: "nvidia",
    activities: ["chat", "reasoning", "coding", "analysis", "agents"],
    tier: "xlarge",
    parameters: "253B",
    vramRequired: 320000,
    contextLength: 32768,
    quantization: "FP16",
    runtime: "nim",
    strengths: "Frontier-class performance, requires multi-GPU",
  },
];

// Legacy flat catalog — derived from CATALOG for backward compatibility
const MODEL_CATALOG: ModelSuggestion[] = CATALOG.map((m) => ({
  model: m.id,
  runtime: m.runtime,
  reason: m.strengths,
  vramRequired: m.vramRequired,
}));

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

    // AMD: rocm-smi (Linux) or WMIC/PowerShell (Windows)
    try {
      const { stdout } = await execFileAsync("rocm-smi", ["--showmeminfo", "vram"]);
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

    // Windows: detect any GPU via PowerShell (NVIDIA, AMD, Intel)
    if (process.platform === "win32") {
      try {
        const { stdout } = await execFileAsync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM | ConvertTo-Json",
          ],
          { timeout: 5000 },
        );
        const gpus = JSON.parse(stdout.trim());
        const gpuList = Array.isArray(gpus) ? gpus : [gpus];
        // Pick the GPU with most VRAM (skip integrated if discrete exists)
        let bestGpu = { Name: "Unknown GPU", AdapterRAM: 0 };
        for (const g of gpuList) {
          if ((g.AdapterRAM ?? 0) > (bestGpu.AdapterRAM ?? 0)) {
            bestGpu = g;
          }
        }
        const vramMB = Math.round((bestGpu.AdapterRAM ?? 0) / (1024 * 1024));
        if (vramMB > 0) {
          const name = String(bestGpu.Name ?? "GPU");
          const vendor = name.toLowerCase().includes("nvidia")
            ? ("nvidia" as const)
            : name.toLowerCase().includes("amd") || name.toLowerCase().includes("radeon")
              ? ("amd" as const)
              : ("none" as const);
          return { vendor, name, vramMB };
        }
      } catch {
        // PowerShell not available
      }
    }

    // Linux: detect via lspci + system RAM for CPU inference
    if (process.platform === "linux") {
      try {
        const { stdout } = await execFileAsync("cat", ["/proc/meminfo"]);
        const match = stdout.match(/MemTotal:\s+(\d+)\s+kB/);
        if (match) {
          const memMB = Math.round(parseInt(match[1]!, 10) / 1024);
          // Detect Raspberry Pi
          try {
            const { stdout: cpuInfo } = await execFileAsync("cat", ["/proc/cpuinfo"]);
            if (cpuInfo.includes("Raspberry Pi") || cpuInfo.includes("BCM2")) {
              return {
                vendor: "none",
                name: `Raspberry Pi (${Math.round(memMB / 1024)}GB RAM)`,
                vramMB: Math.min(Math.round(memMB * 0.4), 2048), // Pi can use ~40% RAM for models
              };
            }
          } catch {
            /* not Pi */
          }

          // Generic Linux without GPU — use RAM for CPU inference
          return {
            vendor: "none",
            name: `CPU only (${Math.round(memMB / 1024)}GB RAM)`,
            vramMB: Math.round(memMB * 0.5),
          };
        }
      } catch {
        /* /proc/meminfo not available */
      }
    }

    // macOS: detect Apple Silicon vs Intel
    if (process.platform === "darwin") {
      // Check if Apple Silicon (arm64) or Intel (x64)
      const isAppleSilicon = process.arch === "arm64";

      if (isAppleSilicon) {
        // Apple Silicon: unified memory shared between CPU and GPU
        try {
          const { stdout } = await execFileAsync("sysctl", ["-n", "hw.memsize"]);
          const memBytes = parseInt(stdout.trim(), 10);
          const memMB = Math.round(memBytes / (1024 * 1024));
          // ~75% of unified memory available for model loading
          return {
            vendor: "apple",
            name: `Apple Silicon (${memMB >= 32768 ? "M-series Pro/Max" : memMB >= 16384 ? "M-series" : "M-series Base"})`,
            vramMB: Math.round(memMB * 0.75),
          };
        } catch {
          return { vendor: "apple", name: "Apple Silicon", vramMB: 8000 };
        }
      } else {
        // Intel Mac: check for discrete AMD GPU via system_profiler
        try {
          const { stdout } = await execFileAsync("system_profiler", ["SPDisplaysDataType"]);
          const vramMatch = stdout.match(/VRAM.*?:\s*(\d+)\s*(MB|GB)/i);
          if (vramMatch) {
            const vram = parseInt(vramMatch[1]!, 10);
            const vramMB = vramMatch[2]!.toUpperCase() === "GB" ? vram * 1024 : vram;
            const nameMatch = stdout.match(/Chipset Model:\s*(.+)/);
            const gpuName = nameMatch?.[1]?.trim() ?? "Intel Mac GPU";
            return { vendor: "amd", name: gpuName, vramMB };
          }
        } catch {
          // system_profiler not available
        }

        // Intel Mac without discrete GPU: CPU-only, use system RAM as rough guide
        try {
          const { stdout } = await execFileAsync("sysctl", ["-n", "hw.memsize"]);
          const memBytes = parseInt(stdout.trim(), 10);
          const memMB = Math.round(memBytes / (1024 * 1024));
          return {
            vendor: "none",
            name: `Intel Mac (${Math.round(memMB / 1024)}GB RAM, no dedicated GPU)`,
            vramMB: Math.min(memMB * 0.5, 8000), // CPU inference uses ~50% RAM max
          };
        } catch {
          return { vendor: "none", name: "Intel Mac", vramMB: 4096 };
        }
      }
    }

    // Linux/Windows without detected GPU
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
  async installModel(model: string, onProgress?: (pct: number) => void): Promise<boolean> {
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
        return {
          ok: false,
          latencyMs: Date.now() - start,
          error: `SSRF blocked: ${ssrfCheck.reason}`,
        };
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
      runtime: (["ollama", "vllm", "nim"].includes(runtime)
        ? runtime
        : "custom") as LocalModelConfig["runtime"],
      endpoint: endpoints[runtime] ?? endpoints.custom!,
      model,
      gpuInfo: null,
    };
  }

  /**
   * Suggest models for a specific activity, filtered by GPU capabilities.
   * Results are sorted by VRAM descending (best models first within hardware limits).
   */
  suggestByActivity(activity: ModelActivity, gpu: GPUInfo): CatalogModel[] {
    return CATALOG.filter(
      (m) => m.activities.includes(activity) && m.vramRequired <= gpu.vramMB,
    ).sort((a, b) => b.vramRequired - a.vramRequired);
  }

  /**
   * Return all available activities with human-readable descriptions.
   */
  listActivities(): ActivityDescription[] {
    return [...ACTIVITY_DESCRIPTIONS];
  }

  /**
   * Get the full activity-segmented model catalog.
   */
  getFullCatalog(): CatalogModel[] {
    return [...CATALOG];
  }

  /**
   * Get the legacy flat model catalog (backward compatible).
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
        await execFileAsync(
          "docker",
          ["run", "--rm", "--gpus", "all", "nvidia/cuda:12.0-base", "nvidia-smi"],
          { timeout: 10_000 },
        );
        gpuSupport = true;
      } catch {
        /* no GPU support */
      }
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
        const data = (await response.json()) as { data?: Array<{ id: string }> };
        const hasNvidia = data.data?.some(
          (m) => m.id.includes("nvidia") || m.id.includes("nemotron"),
        );
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
        await execFileAsync(
          "winget",
          ["install", "Ollama.Ollama", "--accept-package-agreements", "--accept-source-agreements"],
          { timeout: 120_000 },
        );
        return {
          success: true,
          message: "Ollama installed via winget. Run 'ollama serve' to start.",
        };
      } else if (platform === "darwin") {
        await execFileAsync("brew", ["install", "ollama"], { timeout: 120_000 });
        return {
          success: true,
          message: "Ollama installed via brew. Run 'ollama serve' to start.",
        };
      } else {
        // Linux: use the official install script
        const { execSync } = await import("node:child_process");
        execSync("curl -fsSL https://ollama.com/install.sh | sh", {
          timeout: 120_000,
          stdio: "pipe",
        });
        return { success: true, message: "Ollama installed. It should start automatically." };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Installation failed: ${msg}. Install manually from https://ollama.com`,
      };
    }
  }
}
