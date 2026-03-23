import { describe, it, expect, vi, beforeEach } from "vitest";
import { LocalModelSetup } from "./local-model.js";

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
});
