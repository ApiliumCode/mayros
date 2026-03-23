import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalModelSetup } from "./local-model.js";
import type { ModelActivity, CatalogModel } from "./local-model.js";

describe("LocalModelSetup", () => {
  let setup: LocalModelSetup;

  beforeEach(() => {
    setup = new LocalModelSetup();
  });

  // 1
  it("detectGPU returns GPU info or none", async () => {
    const gpu = await setup.detectGPU();
    expect(gpu).toHaveProperty("vendor");
    expect(gpu).toHaveProperty("name");
    expect(gpu).toHaveProperty("vramMB");
    expect(["nvidia", "amd", "apple", "none"]).toContain(gpu.vendor);
    expect(typeof gpu.vramMB).toBe("number");
  });

  // 2
  it("suggestModels filters by VRAM — CPU only", () => {
    const cpuModels = setup.suggestModels({ vendor: "none", name: "No GPU", vramMB: 0 });
    expect(cpuModels.length).toBeGreaterThan(0);
    for (const m of cpuModels) {
      expect(m.vramRequired).toBe(0);
    }
  });

  // 3
  it("suggestModels includes more models with more VRAM", () => {
    const cpuModels = setup.suggestModels({ vendor: "none", name: "No GPU", vramMB: 0 });
    const gpuModels = setup.suggestModels({ vendor: "nvidia", name: "RTX 4090", vramMB: 24000 });
    expect(gpuModels.length).toBeGreaterThan(cpuModels.length);
  });

  // 4
  it("checkOllama returns installed status", async () => {
    const result = await setup.checkOllama();
    expect(result).toHaveProperty("installed");
    expect(typeof result.installed).toBe("boolean");
    if (result.installed) {
      expect(result.version).toBeTruthy();
      expect(result.endpoint).toBeTruthy();
    }
  });

  // 5
  it("getConfig returns valid config for ollama", () => {
    const config = setup.getConfig("ollama", "llama3.3:8b");
    expect(config.runtime).toBe("ollama");
    expect(config.endpoint).toBe("http://localhost:11434/v1");
    expect(config.model).toBe("llama3.3:8b");
    expect(config.gpuInfo).toBeNull();
  });

  // 6
  it("getConfig returns valid config for vllm", () => {
    const config = setup.getConfig("vllm", "meta-llama/Llama-3.3-70B");
    expect(config.runtime).toBe("vllm");
    expect(config.endpoint).toBe("http://localhost:8000/v1");
    expect(config.model).toBe("meta-llama/Llama-3.3-70B");
  });

  // 7
  it("getFullCatalog returns 40+ models with all required fields", () => {
    const catalog = setup.getFullCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(40);
    for (const m of catalog) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.provider).toBeTruthy();
      expect(m.activities.length).toBeGreaterThan(0);
      expect(["small", "medium", "large", "xlarge"]).toContain(m.tier);
      expect(m.parameters).toBeTruthy();
      expect(typeof m.vramRequired).toBe("number");
      expect(typeof m.contextLength).toBe("number");
      expect(m.quantization).toBeTruthy();
      expect(["ollama", "vllm", "nim"]).toContain(m.runtime);
      expect(m.strengths).toBeTruthy();
    }
  });

  // 8
  it("getFullCatalog includes models from all expected providers", () => {
    const catalog = setup.getFullCatalog();
    const providers = new Set(catalog.map((m) => m.provider));
    expect(providers.has("meta")).toBe(true);
    expect(providers.has("nvidia")).toBe(true);
    expect(providers.has("mistral")).toBe(true);
    expect(providers.has("deepseek")).toBe(true);
    expect(providers.has("qwen")).toBe(true);
    expect(providers.has("microsoft")).toBe(true);
    expect(providers.has("google")).toBe(true);
  });

  // 9
  it("suggestByActivity returns only matching models within VRAM", () => {
    const gpu = { vendor: "nvidia" as const, name: "RTX 4090", vramMB: 24000 };
    const codingModels = setup.suggestByActivity("coding", gpu);
    expect(codingModels.length).toBeGreaterThan(0);
    for (const m of codingModels) {
      expect(m.activities).toContain("coding");
      expect(m.vramRequired).toBeLessThanOrEqual(24000);
    }
  });

  // 10
  it("suggestByActivity returns results sorted by VRAM descending", () => {
    const gpu = { vendor: "nvidia" as const, name: "RTX 4090", vramMB: 24000 };
    const models = setup.suggestByActivity("chat", gpu);
    for (let i = 1; i < models.length; i++) {
      expect(models[i]!.vramRequired).toBeLessThanOrEqual(models[i - 1]!.vramRequired);
    }
  });

  // 11
  it("suggestByActivity filters by GPU VRAM limit", () => {
    const smallGpu = { vendor: "nvidia" as const, name: "GTX 1060", vramMB: 6000 };
    const bigGpu = { vendor: "nvidia" as const, name: "A100", vramMB: 80000 };
    const smallResults = setup.suggestByActivity("reasoning", smallGpu);
    const bigResults = setup.suggestByActivity("reasoning", bigGpu);
    expect(bigResults.length).toBeGreaterThanOrEqual(smallResults.length);
  });

  // 12
  it("suggestByActivity returns only CPU-capable models for no-GPU", () => {
    const noGpu = { vendor: "none" as const, name: "No GPU", vramMB: 0 };
    const codingModels = setup.suggestByActivity("coding", noGpu);
    // Only tiny CPU models should be returned
    for (const m of codingModels) {
      expect(m.vramRequired).toBe(0);
    }
  });

  // 13
  it("listActivities returns all 8 activities with descriptions", () => {
    const activities = setup.listActivities();
    expect(activities.length).toBe(8);
    const names = activities.map((a) => a.activity);
    expect(names).toContain("coding");
    expect(names).toContain("chat");
    expect(names).toContain("reasoning");
    expect(names).toContain("creative");
    expect(names).toContain("analysis");
    expect(names).toContain("multilingual");
    expect(names).toContain("vision");
    expect(names).toContain("agents");
    for (const a of activities) {
      expect(a.label).toBeTruthy();
      expect(a.description).toBeTruthy();
    }
  });

  // 14
  it("getCatalog returns legacy format with backward compatibility", () => {
    const legacy = setup.getCatalog();
    expect(legacy.length).toBeGreaterThan(0);
    for (const m of legacy) {
      expect(m).toHaveProperty("model");
      expect(m).toHaveProperty("runtime");
      expect(m).toHaveProperty("reason");
      expect(m).toHaveProperty("vramRequired");
    }
  });

  // 15
  it("catalog covers all 8 activities", () => {
    const catalog = setup.getFullCatalog();
    const coveredActivities = new Set<ModelActivity>();
    for (const m of catalog) {
      for (const a of m.activities) {
        coveredActivities.add(a);
      }
    }
    const allActivities: ModelActivity[] = ["coding", "chat", "reasoning", "creative", "analysis", "multilingual", "vision", "agents"];
    for (const a of allActivities) {
      expect(coveredActivities.has(a)).toBe(true);
    }
  });

  // 16
  it("NVIDIA NIM models use nim runtime", () => {
    const catalog = setup.getFullCatalog();
    const nvidiaModels = catalog.filter((m) => m.provider === "nvidia");
    expect(nvidiaModels.length).toBeGreaterThanOrEqual(4);
    for (const m of nvidiaModels) {
      expect(m.runtime).toBe("nim");
      expect(m.id).toMatch(/^nvidia\//);
    }
  });
});
