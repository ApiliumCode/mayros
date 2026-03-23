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
  localModel: string;
  ollamaDetected: boolean;
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

const LOCAL_MODELS = [
  { value: "llama3.3", label: "Llama 3.3 (8B)" },
  { value: "llama3.3:70b", label: "Llama 3.3 (70B)" },
  { value: "codellama", label: "CodeLlama (7B)" },
  { value: "codellama:34b", label: "CodeLlama (34B)" },
  { value: "mistral", label: "Mistral (7B)" },
  { value: "mixtral", label: "Mixtral (8x7B)" },
  { value: "deepseek-coder-v2", label: "DeepSeek Coder V2" },
  { value: "qwen2.5-coder", label: "Qwen 2.5 Coder" },
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
            <div style="margin-bottom: 20px;">
              <label style="${LABEL_STYLE}">Choose a model</label>
              <select
                style="${INPUT_STYLE}"
                .value=${s.localModel}
                @change=${(e: Event) => props.onLocalModelChange((e.target as HTMLSelectElement).value)}
              >
                ${LOCAL_MODELS.map(
                  (m) => html`<option value=${m.value}>${m.label}</option>`,
                )}
              </select>
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
      ? LOCAL_MODELS.find((m) => m.value === s.localModel)?.label ?? s.localModel
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
