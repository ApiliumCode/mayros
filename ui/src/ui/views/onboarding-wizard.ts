import { html, nothing } from "lit";

// ============================================================================
// Types
// ============================================================================

export type OnboardingStep = "provider" | "apikey" | "ready";

export type OnboardingProvider = "anthropic" | "openai" | "google" | "local";

export type OnboardingState = {
  open: boolean;
  step: OnboardingStep;
  provider: OnboardingProvider | null;
  apiKey: string;
  selectedActivity: string;
  localModel: string;
  ollamaDetected: boolean;
  detectedVramMB: number;
  detectedGpuName: string;
  saving: boolean;
  error: string | null;
  gatewayOk: boolean;
  cortexOk: boolean;
};

export type OnboardingWizardProps = {
  state: OnboardingState;
  onProviderSelect: (provider: OnboardingProvider) => void;
  onApiKeyChange: (key: string) => void;
  onLocalModelChange: (model: string) => void;
  onActivityChange?: (activity: string) => void;
  onNext: () => void;
  onBack: () => void;
  onComplete: () => void;
};

// ============================================================================
// Styles
// ============================================================================

const FULLSCREEN_STYLE = `
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--bg, #12141a); z-index: 2000;
  display: flex; align-items: center; justify-content: center;
  flex-direction: column;
`;

const CONTAINER_STYLE = `
  max-width: 600px; width: 100%; padding: 40px;
  color: var(--card-foreground, #f4f4f5);
`;

const CARD_STYLE = `
  padding: 20px; border-radius: 10px;
  background: var(--card, #181b22);
  border: 2px solid var(--border, #27272a);
  cursor: pointer; transition: border-color 0.15s ease;
  text-align: left;
`;

const CARD_SELECTED_BORDER = `border-color: var(--accent, #ff5c5c);`;

const INPUT_STYLE = `
  width: 100%; padding: 12px 14px;
  background: var(--card, #181b22); border: 1px solid var(--border, #27272a);
  border-radius: 8px; color: var(--card-foreground, #f4f4f5); font-size: 15px;
  box-sizing: border-box; outline: none;
`;

const NEXT_BTN_STYLE = `
  background: var(--accent, #ff5c5c); color: var(--accent-foreground, #fff);
  padding: 12px 32px; border-radius: 8px; border: none;
  cursor: pointer; font-size: 15px; font-weight: 600;
  transition: opacity 0.15s ease;
`;

const BACK_BTN_STYLE = `
  background: none; border: none; color: var(--border-hover, #52525b);
  cursor: pointer; font-size: 14px; padding: 8px 12px;
`;

const LABEL_STYLE = `
  font-size: 13px; color: var(--border-hover, #52525b); margin-bottom: 6px; display: block;
`;

// ============================================================================
// Provider data
// ============================================================================

type ProviderInfo = {
  id: OnboardingProvider;
  name: string;
  subtitle: string;
  description: string;
  keyUrl: string;
  keyLabel: string;
};

const PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    subtitle: "Claude",
    description: "Claude 3.5 Sonnet, Haiku, Opus — strong reasoning and coding",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyLabel: "Anthropic API Key",
  },
  {
    id: "openai",
    name: "OpenAI",
    subtitle: "GPT",
    description: "GPT-4o, o1, o3 — general purpose and multimodal",
    keyUrl: "https://platform.openai.com/api-keys",
    keyLabel: "OpenAI API Key",
  },
  {
    id: "google",
    name: "Google",
    subtitle: "Gemini",
    description: "Gemini 2.0 Flash, Pro — fast and multimodal",
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyLabel: "Google AI API Key",
  },
  {
    id: "local",
    name: "Local Model",
    subtitle: "Ollama",
    description: "Run models locally — Llama 3.3, CodeLlama, Mistral, and more",
    keyUrl: "https://ollama.com/download",
    keyLabel: "",
  },
];

const ACTIVITIES = [
  { value: "all", label: "All Models" },
  { value: "coding", label: "Coding" },
  { value: "chat", label: "Chat / General" },
  { value: "reasoning", label: "Reasoning / Math" },
  { value: "creative", label: "Creative Writing" },
  { value: "analysis", label: "Analysis / Research" },
  { value: "multilingual", label: "Multilingual" },
  { value: "vision", label: "Vision / Multimodal" },
  { value: "agents", label: "Agents / Tool Use" },
];

const FULL_CATALOG = [
  // ── Small models (0-4GB VRAM) — run on almost any machine ──────
  { id: "qwen2.5-coder:1.5b", name: "Qwen 2.5 Coder 1.5B", activity: "coding", provider: "Qwen", vram: 0, params: "1.5B", desc: "Tiny but capable code model, runs on CPU" },
  { id: "deepseek-coder-v2:lite", name: "DeepSeek Coder V2 Lite", activity: "coding", provider: "DeepSeek", vram: 3000, params: "2.5B", desc: "Lightweight MoE coder, great for autocomplete" },
  { id: "phi-3.5:3.8b", name: "Phi 3.5 Mini 3.8B", activity: "chat", provider: "Microsoft", vram: 3000, params: "3.8B", desc: "Microsoft's small powerhouse, strong reasoning" },
  { id: "gemma2:2b", name: "Gemma 2 2B", activity: "chat", provider: "Google", vram: 0, params: "2B", desc: "Google's tiny model, CPU friendly" },
  { id: "tinyllama:1.1b", name: "TinyLlama 1.1B", activity: "chat", provider: "Meta", vram: 0, params: "1.1B", desc: "Ultra-light, instant responses on any hardware" },
  { id: "deepseek-r1:1.5b", name: "DeepSeek R1 1.5B", activity: "reasoning", provider: "DeepSeek", vram: 0, params: "1.5B", desc: "Chain-of-thought reasoning on CPU" },
  { id: "qwen2.5:3b", name: "Qwen 2.5 3B", activity: "multilingual", provider: "Qwen", vram: 0, params: "3B", desc: "Multilingual on CPU, CJK + Latin" },
  { id: "moondream:1.8b", name: "Moondream 1.8B", activity: "vision", provider: "Meta", vram: 2000, params: "1.8B", desc: "Tiny vision model, image understanding on CPU" },
  { id: "smollm2:1.7b", name: "SmolLM2 1.7B", activity: "agents", provider: "Microsoft", vram: 0, params: "1.7B", desc: "Small but capable for simple agent tasks" },
  { id: "qwen2.5:0.5b", name: "Qwen 2.5 0.5B", activity: "chat", provider: "Qwen", vram: 0, params: "0.5B", desc: "Smallest Qwen, ultra-fast, edge devices" },
  { id: "nomic-embed-text", name: "Nomic Embed Text", activity: "analysis", provider: "Nomic", vram: 0, params: "137M", desc: "Text embeddings for RAG and search, CPU only" },
  { id: "all-minilm:l6-v2", name: "MiniLM L6 v2", activity: "analysis", provider: "Microsoft", vram: 0, params: "22M", desc: "Fast sentence embeddings, perfect for search" },

  // ── Coding (5GB+) ─────────────────────────────────────────────────
  { id: "codellama:7b", name: "Code Llama 7B", activity: "coding", provider: "Meta", vram: 5000, params: "7B", desc: "Fast code completion, low VRAM" },
  { id: "codellama:13b", name: "Code Llama 13B", activity: "coding", provider: "Meta", vram: 10000, params: "13B", desc: "Strong code generation" },
  { id: "codellama:34b", name: "Code Llama 34B", activity: "coding", provider: "Meta", vram: 22000, params: "34B", desc: "Best Code Llama for complex tasks" },
  { id: "deepseek-coder-v2:lite", name: "DeepSeek Coder V2 Lite", activity: "coding", provider: "DeepSeek", vram: 12000, params: "16B", desc: "128K context, MoE architecture" },
  { id: "deepseek-coder-v2", name: "DeepSeek Coder V2", activity: "coding", provider: "DeepSeek", vram: 22000, params: "33B", desc: "Top-tier code model" },
  { id: "qwen2.5-coder:7b", name: "Qwen 2.5 Coder 7B", activity: "coding", provider: "Qwen", vram: 5000, params: "7B", desc: "Competitive with larger models" },
  { id: "qwen2.5-coder:14b", name: "Qwen 2.5 Coder 14B", activity: "coding", provider: "Qwen", vram: 10000, params: "14B", desc: "Code + tool-use" },
  { id: "qwen2.5-coder:32b", name: "Qwen 2.5 Coder 32B", activity: "coding", provider: "Qwen", vram: 22000, params: "32B", desc: "Rivals GPT-4 on code" },
  { id: "starcoder2:7b", name: "StarCoder2 7B", activity: "coding", provider: "Microsoft", vram: 5000, params: "7B", desc: "Fast completions" },
  { id: "starcoder2:15b", name: "StarCoder2 15B", activity: "coding", provider: "Microsoft", vram: 11000, params: "15B", desc: "Improved accuracy" },
  // Chat
  { id: "llama3.2:3b", name: "Llama 3.2 3B", activity: "chat", provider: "Meta", vram: 0, params: "3B", desc: "Runs on CPU, fast" },
  { id: "llama3.1:8b", name: "Llama 3.1 8B", activity: "chat", provider: "Meta", vram: 6000, params: "8B", desc: "Excellent general model" },
  { id: "llama3.3:70b", name: "Llama 3.3 70B", activity: "chat", provider: "Meta", vram: 40000, params: "70B", desc: "Near-frontier quality" },
  { id: "mistral:7b", name: "Mistral 7B", activity: "chat", provider: "Mistral", vram: 6000, params: "7B", desc: "Fast and efficient" },
  { id: "mistral-nemo:12b", name: "Mistral Nemo 12B", activity: "chat", provider: "Mistral", vram: 9000, params: "12B", desc: "128K context, multilingual" },
  { id: "mixtral:8x7b", name: "Mixtral 8x7B", activity: "chat", provider: "Mistral", vram: 28000, params: "47B", desc: "MoE, fast for quality" },
  { id: "phi-4:14b", name: "Phi-4 14B", activity: "chat", provider: "Microsoft", vram: 10000, params: "14B", desc: "Strong reasoning" },
  { id: "gemma2:9b", name: "Gemma 2 9B", activity: "chat", provider: "Google", vram: 7000, params: "9B", desc: "Efficient, strong benchmarks" },
  { id: "gemma2:27b", name: "Gemma 2 27B", activity: "chat", provider: "Google", vram: 18000, params: "27B", desc: "Best Gemma" },
  // Reasoning
  { id: "deepseek-r1:7b", name: "DeepSeek R1 7B", activity: "reasoning", provider: "DeepSeek", vram: 5000, params: "7B", desc: "Chain-of-thought at small scale" },
  { id: "deepseek-r1:14b", name: "DeepSeek R1 14B", activity: "reasoning", provider: "DeepSeek", vram: 10000, params: "14B", desc: "Strong reasoning + code" },
  { id: "deepseek-r1:70b", name: "DeepSeek R1 70B", activity: "reasoning", provider: "DeepSeek", vram: 40000, params: "70B", desc: "Rivals o1 on math" },
  { id: "qwen2.5:72b", name: "Qwen 2.5 72B", activity: "reasoning", provider: "Qwen", vram: 42000, params: "72B", desc: "Top-tier reasoning" },
  // Creative
  { id: "yi:34b", name: "Yi 34B", activity: "creative", provider: "01.AI", vram: 22000, params: "34B", desc: "Creative writing, bilingual" },
  // Multilingual
  { id: "qwen2.5:7b", name: "Qwen 2.5 7B", activity: "multilingual", provider: "Qwen", vram: 5000, params: "7B", desc: "Strong CJK languages" },
  { id: "qwen2.5:14b", name: "Qwen 2.5 14B", activity: "multilingual", provider: "Qwen", vram: 10000, params: "14B", desc: "Best mid-size multilingual" },
  { id: "aya:8b", name: "Aya 8B", activity: "multilingual", provider: "Cohere", vram: 6000, params: "8B", desc: "23+ languages" },
  { id: "aya:35b", name: "Aya 35B", activity: "multilingual", provider: "Cohere", vram: 24000, params: "35B", desc: "Best coverage" },
  // Vision
  { id: "llava:7b", name: "LLaVA 7B", activity: "vision", provider: "Meta", vram: 6000, params: "7B", desc: "Visual QA" },
  { id: "llava:13b", name: "LLaVA 13B", activity: "vision", provider: "Meta", vram: 10000, params: "13B", desc: "Better image reasoning" },
  { id: "llama3.2-vision:11b", name: "Llama 3.2 Vision", activity: "vision", provider: "Meta", vram: 8000, params: "11B", desc: "Native multimodal, 128K ctx" },
  // Agents
  { id: "granite3-dense:8b", name: "Granite 3 Dense 8B", activity: "agents", provider: "IBM", vram: 6000, params: "8B", desc: "Strong tool-use" },
  { id: "granite3-moe:3b", name: "Granite 3 MoE 3B", activity: "agents", provider: "IBM", vram: 3000, params: "3B", desc: "Lightweight agents" },
  // Analysis
  { id: "solar:10.7b", name: "Solar 10.7B", activity: "analysis", provider: "Upstage", vram: 8000, params: "10.7B", desc: "Strong summarization" },
  { id: "command-r:35b", name: "Command R 35B", activity: "analysis", provider: "Cohere", vram: 24000, params: "35B", desc: "RAG-optimized, citations" },
  // NVIDIA NIM
  { id: "nvidia/nemotron-mini:4b", name: "Nemotron Mini 4B", activity: "chat", provider: "NVIDIA", vram: 4000, params: "4B", desc: "NIM optimized, low-latency" },
  { id: "nvidia/nemotron-nano:8b", name: "Nemotron Nano 8B", activity: "coding", provider: "NVIDIA", vram: 8000, params: "8B", desc: "TensorRT-LLM, fast" },
];

// ============================================================================
// Step Indicators
// ============================================================================

const STEPS: { key: OnboardingStep; label: string; num: string }[] = [
  { key: "provider", label: "Provider", num: "1" },
  { key: "apikey", label: "Setup", num: "2" },
  { key: "ready", label: "Ready", num: "3" },
];

const STEP_ORDER: OnboardingStep[] = ["provider", "apikey", "ready"];

function stepIndex(step: OnboardingStep): number {
  return STEP_ORDER.indexOf(step);
}

function renderStepIndicators(current: OnboardingStep) {
  return html`
    <div style="display: flex; gap: 32px; justify-content: center; margin-bottom: 40px;">
      ${STEPS.map((s) => {
        const active = s.key === current;
        const completed = stepIndex(s.key) < stepIndex(current);
        const dotColor = active
          ? "var(--accent, #ff5c5c)"
          : completed
            ? "var(--accent, #ff5c5c)"
            : "var(--border, #27272a)";
        return html`
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="
              width: 28px; height: 28px; border-radius: 50%;
              background: ${dotColor};
              display: flex; align-items: center; justify-content: center;
              font-size: 13px; font-weight: 600;
              color: ${active || completed ? "#fff" : "#777"};
            ">${completed ? "\u2713" : s.num}</div>
            <span style="
              font-size: 13px;
              color: ${active ? "#e0e0e0" : completed ? "var(--accent, #ff5c5c)" : "#555"};
              font-weight: ${active ? "600" : "normal"};
            ">${s.label}</span>
          </div>
        `;
      })}
    </div>
  `;
}

// ============================================================================
// Step 1: Welcome + Provider
// ============================================================================

function renderProviderStep(props: OnboardingWizardProps) {
  const s = props.state;
  return html`
    <div>
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="
          font-size: 48px; margin-bottom: 16px;
          color: var(--accent, #ff5c5c);
          font-weight: 700; letter-spacing: 2px;
        ">MAYROS</div>
        <h2 style="margin: 0 0 8px 0; font-size: 22px; color: var(--card-foreground, #f4f4f5); font-weight: 600;">
          Welcome to Mayros
        </h2>
        <p style="margin: 0; font-size: 14px; color: #888;">
          Your autonomous agent gateway. Choose an AI provider to get started.
        </p>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;">
        ${PROVIDERS.map((p) => {
          const selected = s.provider === p.id;
          return html`
            <div
              style="${CARD_STYLE} ${selected ? CARD_SELECTED_BORDER : ""}"
              @click=${() => props.onProviderSelect(p.id)}
              @mouseenter=${(e: Event) => {
                if (!selected) (e.currentTarget as HTMLElement).style.borderColor = "#3f3f46";
              }}
              @mouseleave=${(e: Event) => {
                if (!selected) (e.currentTarget as HTMLElement).style.borderColor = "";
              }}
            >
              <div style="font-size: 15px; font-weight: 600; color: var(--card-foreground, #f4f4f5); margin-bottom: 2px;">
                ${p.name}
              </div>
              <div style="font-size: 12px; color: var(--accent, #ff5c5c); margin-bottom: 8px;">
                ${p.subtitle}
              </div>
              <div style="font-size: 12px; color: #888; line-height: 1.4;">
                ${p.description}
              </div>
            </div>
          `;
        })}
      </div>

      <div style="display: flex; justify-content: flex-end;">
        <button
          style="${NEXT_BTN_STYLE} ${!s.provider ? "opacity: 0.4; cursor: not-allowed;" : ""}"
          ?disabled=${!s.provider}
          @click=${() => props.onNext()}
        >Next</button>
      </div>
    </div>
  `;
}

// ============================================================================
// Step 2: API Key / Local Model Setup
// ============================================================================

function renderApiKeyStep(props: OnboardingWizardProps) {
  const s = props.state;
  const provider = PROVIDERS.find((p) => p.id === s.provider);

  if (s.provider === "local") {
    return renderLocalModelStep(props);
  }

  const canProceed = s.apiKey.trim().length > 8;

  return html`
    <div>
      <h2 style="margin: 0 0 8px 0; font-size: 20px; color: var(--card-foreground, #f4f4f5);">
        Enter your ${provider?.name ?? ""} API Key
      </h2>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #888;">
        Your key stays on your device. It is never sent to Apilium.
      </p>

      <div style="margin-bottom: 20px;">
        <label style="${LABEL_STYLE}">${provider?.keyLabel ?? "API Key"}</label>
        <input
          style="${INPUT_STYLE}"
          type="password"
          placeholder="sk-..."
          .value=${s.apiKey}
          @input=${(e: Event) => props.onApiKeyChange((e.target as HTMLInputElement).value)}
          autocomplete="off"
        />
      </div>

      <p style="font-size: 13px; color: #666; margin-bottom: 24px;">
        Don't have one?
        <a
          href="${provider?.keyUrl ?? "#"}"
          target="_blank"
          rel="noopener noreferrer"
          style="color: var(--accent, #ff5c5c); text-decoration: none;"
        >Get it at ${provider?.name ?? "provider"}</a>
      </p>

      ${s.error
        ? html`<div style="
            padding: 10px 14px; margin-bottom: 16px;
            background: rgba(255, 92, 92, 0.1); border: 1px solid rgba(255, 92, 92, 0.3);
            border-radius: 6px; color: #ff8888; font-size: 13px;
          ">${s.error}</div>`
        : nothing}

      <div style="display: flex; justify-content: space-between; margin-top: 8px;">
        <button style="${BACK_BTN_STYLE}" @click=${() => props.onBack()}>Back</button>
        <button
          style="${NEXT_BTN_STYLE} ${!canProceed ? "opacity: 0.4; cursor: not-allowed;" : ""}"
          ?disabled=${!canProceed || s.saving}
          @click=${() => props.onNext()}
        >${s.saving ? "Saving..." : "Next"}</button>
      </div>
    </div>
  `;
}

function renderLocalModelStep(props: OnboardingWizardProps) {
  const s = props.state;

  return html`
    <div>
      <h2 style="margin: 0 0 8px 0; font-size: 20px; color: var(--card-foreground, #f4f4f5);">
        Local Model Setup
      </h2>
      <p style="margin: 0 0 24px 0; font-size: 14px; color: #888;">
        Mayros will connect to Ollama running on your machine.
      </p>

      <div style="
        padding: 14px 16px; margin-bottom: 20px;
        background: var(--card, #181b22); border: 1px solid var(--border, #27272a);
        border-radius: 8px; display: flex; align-items: center; gap: 12px;
      ">
        <div style="
          width: 10px; height: 10px; border-radius: 50%;
          background: ${s.ollamaDetected ? "#22c55e" : "#ef4444"};
        "></div>
        <span style="font-size: 14px;">
          Ollama: ${s.ollamaDetected ? "Detected" : "Not detected"}
        </span>
      </div>

      ${s.ollamaDetected
        ? html`
            <!-- Activity filter -->
            <div style="margin-bottom: 12px;">
              <label style="${LABEL_STYLE}">What will you use it for?</label>
              <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;">
                ${ACTIVITIES.map(
                  (a) => html`
                    <button
                      style="
                        padding: 5px 12px; border-radius: 16px; font-size: 12px; cursor: pointer;
                        border: 1px solid ${s.selectedActivity === a.value ? "var(--accent, #ff5c5c)" : "var(--border, #27272a)"};
                        background: ${s.selectedActivity === a.value ? "var(--accent, #ff5c5c)" : "transparent"};
                        color: ${s.selectedActivity === a.value ? "white" : "var(--card-foreground, #f4f4f5)"};
                      "
                      @click=${() => props.onActivityChange?.(a.value)}
                    >${a.label}</button>
                  `,
                )}
              </div>
            </div>

            <!-- GPU info -->
            ${s.detectedGpuName ? html`
              <div style="margin-bottom: 12px; padding: 8px 12px; background: rgba(255,92,92,0.08); border-radius: 8px; font-size: 13px; color: #ccc;">
                Your GPU: <strong>${s.detectedGpuName}</strong> (${(s.detectedVramMB / 1000).toFixed(0)}GB VRAM)
                ${s.detectedVramMB === 0 ? " — CPU only, limited models available" : ""}
              </div>
            ` : nothing}

            <!-- Model list filtered by activity + compatibility -->
            <div style="margin-bottom: 20px; max-height: 240px; overflow-y: auto; border: 1px solid var(--border, #27272a); border-radius: 8px;">
              ${FULL_CATALOG
                .filter((m) => s.selectedActivity === "all" || m.activity === s.selectedActivity)
                .sort((a, b) => {
                  // Compatible models first, then by VRAM desc
                  const aOk = a.vram <= s.detectedVramMB ? 1 : 0;
                  const bOk = b.vram <= s.detectedVramMB ? 1 : 0;
                  if (aOk !== bOk) return bOk - aOk;
                  return b.vram - a.vram;
                })
                .map(
                  (m) => {
                    const canRun = m.vram <= s.detectedVramMB;
                    const isSelected = s.localModel === m.id;
                    return html`
                      <div
                        style="
                          padding: 10px 14px; cursor: ${canRun ? "pointer" : "not-allowed"}; display: flex; justify-content: space-between; align-items: center;
                          border-bottom: 1px solid var(--border, #27272a);
                          background: ${isSelected ? "rgba(255,92,92,0.1)" : "transparent"};
                          opacity: ${canRun ? "1" : "0.4"};
                        "
                        @click=${() => canRun && props.onLocalModelChange(m.id)}
                      >
                        <div>
                          <div style="font-size: 14px; font-weight: ${isSelected ? "600" : "400"}; color: var(--card-foreground, #f4f4f5);">
                            ${canRun ? "" : "🔒 "}${m.name}
                            <span style="font-size: 11px; color: #888; margin-left: 6px;">${m.params} | ${m.provider}</span>
                          </div>
                          <div style="font-size: 12px; color: #777; margin-top: 2px;">${m.desc}</div>
                        </div>
                        <div style="font-size: 11px; white-space: nowrap; margin-left: 12px; color: ${canRun ? "#4ade80" : "#ef4444"};">
                          ${m.vram > 0 ? `${(m.vram / 1000).toFixed(0)}GB` : "CPU"}
                          ${canRun ? " ✓" : " ✗"}
                        </div>
                      </div>
                    `;
                  },
                )}
            </div>
          `
        : html`
            <div style="margin-bottom: 20px;">
              <p style="font-size: 13px; color: #888; margin: 0 0 12px 0;">
                Install Ollama to run models locally:
              </p>
              <a
                href="https://ollama.com/download"
                target="_blank"
                rel="noopener noreferrer"
                style="
                  display: inline-block; padding: 10px 20px;
                  background: var(--card, #181b22); border: 1px solid var(--border, #27272a);
                  border-radius: 6px; color: var(--card-foreground, #f4f4f5);
                  text-decoration: none; font-size: 14px;
                "
              >Download Ollama</a>
            </div>
          `}

      ${s.error
        ? html`<div style="
            padding: 10px 14px; margin-bottom: 16px;
            background: rgba(255, 92, 92, 0.1); border: 1px solid rgba(255, 92, 92, 0.3);
            border-radius: 6px; color: #ff8888; font-size: 13px;
          ">${s.error}</div>`
        : nothing}

      <div style="display: flex; justify-content: space-between; margin-top: 8px;">
        <button style="${BACK_BTN_STYLE}" @click=${() => props.onBack()}>Back</button>
        <button
          style="${NEXT_BTN_STYLE} ${!s.ollamaDetected ? "opacity: 0.4; cursor: not-allowed;" : ""}"
          ?disabled=${!s.ollamaDetected || s.saving}
          @click=${() => props.onNext()}
        >${s.saving ? "Saving..." : "Next"}</button>
      </div>
    </div>
  `;
}

// ============================================================================
// Step 3: Ready
// ============================================================================

function renderReadyStep(props: OnboardingWizardProps) {
  const s = props.state;
  const provider = PROVIDERS.find((p) => p.id === s.provider);

  const statusDotStyle = (ok: boolean) => `
    width: 10px; height: 10px; border-radius: 50%;
    background: ${ok ? "#22c55e" : "#ef4444"};
    display: inline-block; margin-right: 10px;
  `;

  const summaryRowStyle = `
    padding: 12px 16px; display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid var(--border, #27272a); font-size: 14px;
  `;

  const modelLabel =
    s.provider === "local"
      ? FULL_CATALOG.find((m) => m.id === s.localModel)?.name ?? s.localModel
      : `${provider?.subtitle ?? ""}`;

  return html`
    <div>
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="
          width: 64px; height: 64px; border-radius: 50%; margin: 0 auto 16px auto;
          background: rgba(255, 92, 92, 0.15);
          display: flex; align-items: center; justify-content: center;
          font-size: 28px; color: var(--accent, #ff5c5c);
        ">\u2713</div>
        <h2 style="margin: 0 0 8px 0; font-size: 22px; color: var(--card-foreground, #f4f4f5); font-weight: 600;">
          Mayros is ready!
        </h2>
        <p style="margin: 0; font-size: 14px; color: #888;">
          Your agent gateway is configured and running.
        </p>
      </div>

      <div style="
        background: var(--card, #181b22); border: 1px solid var(--border, #27272a);
        border-radius: 10px; overflow: hidden; margin-bottom: 24px;
      ">
        <div style="${summaryRowStyle}">
          <span style="color: #888;">Provider</span>
          <span style="font-weight: 500;">${provider?.name ?? "Unknown"}</span>
        </div>
        <div style="${summaryRowStyle}">
          <span style="color: #888;">Model</span>
          <span style="font-weight: 500;">${modelLabel}</span>
        </div>
        <div style="${summaryRowStyle}">
          <span style="color: #888;">Gateway</span>
          <span><span style="${statusDotStyle(s.gatewayOk)}"></span>${s.gatewayOk ? "Running" : "Offline"}</span>
        </div>
        <div style="${summaryRowStyle} border-bottom: none;">
          <span style="color: #888;">Cortex</span>
          <span><span style="${statusDotStyle(s.cortexOk)}"></span>${s.cortexOk ? "Running" : "Offline"}</span>
        </div>
      </div>

      ${s.error
        ? html`<div style="
            padding: 10px 14px; margin-bottom: 16px;
            background: rgba(255, 92, 92, 0.1); border: 1px solid rgba(255, 92, 92, 0.3);
            border-radius: 6px; color: #ff8888; font-size: 13px;
          ">${s.error}</div>`
        : nothing}

      <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
        <button
          style="${NEXT_BTN_STYLE} width: 100%; text-align: center;"
          ?disabled=${s.saving}
          @click=${() => props.onComplete()}
        >${s.saving ? "Setting up..." : "Open Dashboard"}</button>
        <a
          href="#"
          @click=${(e: Event) => {
            e.preventDefault();
            props.onComplete();
          }}
          style="font-size: 13px; color: #666; text-decoration: none;"
        >Connect a channel later (WhatsApp, Telegram...)</a>
      </div>
    </div>
  `;
}

// ============================================================================
// Main Render
// ============================================================================

export function renderOnboardingWizard(props: OnboardingWizardProps) {
  if (!props.state.open) {
    return nothing;
  }

  const renderStep = () => {
    switch (props.state.step) {
      case "provider":
        return renderProviderStep(props);
      case "apikey":
        return renderApiKeyStep(props);
      case "ready":
        return renderReadyStep(props);
    }
  };

  return html`
    <div style="${FULLSCREEN_STYLE}">
      <div style="${CONTAINER_STYLE}">
        ${renderStepIndicators(props.state.step)}
        ${renderStep()}
      </div>
    </div>
  `;
}
