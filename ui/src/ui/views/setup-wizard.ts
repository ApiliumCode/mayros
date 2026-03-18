import { html, nothing } from "lit";

// ============================================================================
// Types
// ============================================================================

export type SetupWizardStep = "venture" | "agent" | "mission" | "launch";

export type SetupWizardState = {
  open: boolean;
  step: SetupWizardStep;
  // Venture
  ventureName: string;
  ventureDirective: string;
  venturePrefix: string;
  ventureFuelLimit: string;
  // Agent
  agentName: string;
  agentRole: string;
  // Mission
  missionTitle: string;
  missionDescription: string;
  missionPriority: string;
  // Status
  creating: boolean;
  error: string | null;
  result: { ventureId: string; agentId: string; missionId: string } | null;
};

export type SetupWizardProps = {
  state: SetupWizardState;
  onFieldChange: (field: string, value: string) => void;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  onCreate: () => void;
};

// ============================================================================
// Styles
// ============================================================================

const OVERLAY_STYLE = `
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.7); z-index: 1000;
  display: flex; align-items: center; justify-content: center;
`;

const CARD_STYLE = `
  max-width: 520px; width: 100%; padding: 32px;
  background: var(--card, #181b22); border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  border: 1px solid var(--border, #27272a);
  position: relative; color: var(--card-foreground, #f4f4f5);
`;

const INPUT_STYLE = `
  width: 100%; padding: 10px 12px;
  background: var(--bg, #12141a); border: 1px solid var(--border, #27272a);
  border-radius: 6px; color: var(--card-foreground, #f4f4f5); font-size: 14px;
  box-sizing: border-box;
`;

const TEXTAREA_STYLE = `
  width: 100%; padding: 10px 12px;
  background: var(--bg, #12141a); border: 1px solid var(--border, #27272a);
  border-radius: 6px; color: var(--card-foreground, #f4f4f5); font-size: 14px;
  box-sizing: border-box;
  min-height: 80px; resize: vertical; font-family: inherit;
`;

const LABEL_STYLE = `
  font-size: 13px; color: var(--border-hover, #52525b); margin-bottom: 4px; display: block;
`;

const FIELD_STYLE = `margin-bottom: 16px;`;

const NEXT_BTN_STYLE = `
  background: var(--accent, #ff5c5c); color: var(--accent-foreground, #fff);
  padding: 8px 20px; border-radius: 6px; border: none;
  cursor: pointer; font-size: 14px; font-weight: 500;
`;

const BACK_BTN_STYLE = `
  background: none; border: none; color: var(--border-hover, #52525b);
  cursor: pointer; font-size: 14px; padding: 8px 12px;
`;

const CLOSE_BTN_STYLE = `
  position: absolute; top: 12px; right: 16px;
  background: none; border: none; color: var(--border-hover, #52525b);
  cursor: pointer; font-size: 18px; line-height: 1;
`;

// ============================================================================
// Step Indicators
// ============================================================================

const STEPS: { key: SetupWizardStep; label: string; num: string }[] = [
  { key: "venture", label: "Venture", num: "1" },
  { key: "agent", label: "Agent", num: "2" },
  { key: "mission", label: "Mission", num: "3" },
  { key: "launch", label: "Launch", num: "4" },
];

const STEP_ORDER: SetupWizardStep[] = ["venture", "agent", "mission", "launch"];

function stepIndex(step: SetupWizardStep): number {
  return STEP_ORDER.indexOf(step);
}

function renderStepIndicators(current: SetupWizardStep) {
  return html`
    <div style="display: flex; gap: 24px; justify-content: center; margin-bottom: 32px;">
      ${STEPS.map((s) => {
        const active = s.key === current;
        const completed = stepIndex(s.key) < stepIndex(current);
        const indicatorStyle = `
          padding-bottom: 8px;
          border-bottom: 2px solid ${active ? "var(--accent, #ff5c5c)" : "transparent"};
          font-weight: ${active ? "bold" : "normal"};
          color: ${active ? "#e0e0e0" : completed ? "var(--accent, #ff5c5c)" : "#777"};
          font-size: 13px;
        `;
        return html`
          <span style="${indicatorStyle}">
            ${s.num}. ${s.label}
          </span>
        `;
      })}
    </div>
  `;
}

// ============================================================================
// Step: Venture
// ============================================================================

function renderVentureStep(props: SetupWizardProps) {
  const s = props.state;
  return html`
    <div>
      <h2 style="margin: 0 0 4px 0; font-size: 20px; color: var(--card-foreground, #f4f4f5);">Name your venture</h2>
      <p class="muted" style="margin: 0 0 24px 0; font-size: 14px;">
        This is the organization your agents will work for.
      </p>

      <div style="${FIELD_STYLE}">
        <label style="${LABEL_STYLE}">Venture name</label>
        <input
          style="${INPUT_STYLE}"
          type="text"
          placeholder="e.g. Acme Security"
          .value=${s.ventureName}
          @input=${(e: Event) => props.onFieldChange("ventureName", (e.target as HTMLInputElement).value)}
        />
      </div>

      <div style="${FIELD_STYLE}">
        <label style="${LABEL_STYLE}">Directive</label>
        <textarea
          style="${TEXTAREA_STYLE}"
          placeholder="What should this venture focus on?"
          .value=${s.ventureDirective}
          @input=${(e: Event) => props.onFieldChange("ventureDirective", (e.target as HTMLTextAreaElement).value)}
        ></textarea>
      </div>

      <div style="display: flex; gap: 12px;">
        <div style="${FIELD_STYLE} flex: 1;">
          <label style="${LABEL_STYLE}">Prefix (max 10 chars)</label>
          <input
            style="${INPUT_STYLE}"
            type="text"
            maxlength="10"
            placeholder="e.g. ACME"
            .value=${s.venturePrefix}
            @input=${(e: Event) => props.onFieldChange("venturePrefix", (e.target as HTMLInputElement).value)}
          />
        </div>
        <div style="${FIELD_STYLE} flex: 1;">
          <label style="${LABEL_STYLE}">Fuel limit (cents, optional)</label>
          <input
            style="${INPUT_STYLE}"
            type="number"
            placeholder="e.g. 5000"
            .value=${s.ventureFuelLimit}
            @input=${(e: Event) => props.onFieldChange("ventureFuelLimit", (e.target as HTMLInputElement).value)}
          />
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
        <button
          style="${NEXT_BTN_STYLE}"
          ?disabled=${!s.ventureName.trim()}
          @click=${() => props.onNext()}
        >Next</button>
      </div>
    </div>
  `;
}

// ============================================================================
// Step: Agent
// ============================================================================

function renderAgentStep(props: SetupWizardProps) {
  const s = props.state;
  return html`
    <div>
      <h2 style="margin: 0 0 4px 0; font-size: 20px; color: var(--card-foreground, #f4f4f5);">Create your first agent</h2>
      <p class="muted" style="margin: 0 0 24px 0; font-size: 14px;">
        Choose a name and role for your agent.
      </p>

      <div style="${FIELD_STYLE}">
        <label style="${LABEL_STYLE}">Agent name</label>
        <input
          style="${INPUT_STYLE}"
          type="text"
          placeholder="e.g. sentinel"
          .value=${s.agentName}
          @input=${(e: Event) => props.onFieldChange("agentName", (e.target as HTMLInputElement).value)}
        />
      </div>

      <div style="${FIELD_STYLE}">
        <label style="${LABEL_STYLE}">Role</label>
        <input
          style="${INPUT_STYLE}"
          type="text"
          placeholder="e.g. Security Auditor, DevOps Engineer"
          .value=${s.agentRole}
          @input=${(e: Event) => props.onFieldChange("agentRole", (e.target as HTMLInputElement).value)}
        />
      </div>

      <p class="muted" style="font-size: 13px; margin-top: 8px;">
        Your agent will be deployed to the venture and ready to receive missions.
      </p>

      <div style="display: flex; justify-content: space-between; margin-top: 16px;">
        <button style="${BACK_BTN_STYLE}" @click=${() => props.onBack()}>Back</button>
        <button
          style="${NEXT_BTN_STYLE}"
          ?disabled=${!s.agentName.trim()}
          @click=${() => props.onNext()}
        >Next</button>
      </div>
    </div>
  `;
}

// ============================================================================
// Step: Mission
// ============================================================================

function renderMissionStep(props: SetupWizardProps) {
  const s = props.state;
  return html`
    <div>
      <h2 style="margin: 0 0 4px 0; font-size: 20px; color: var(--card-foreground, #f4f4f5);">Give it something to do</h2>
      <p class="muted" style="margin: 0 0 24px 0; font-size: 14px;">
        Give your agent a small task to start with.
      </p>

      <div style="${FIELD_STYLE}">
        <label style="${LABEL_STYLE}">Mission title</label>
        <input
          style="${INPUT_STYLE}"
          type="text"
          placeholder="e.g. Run initial security scan"
          .value=${s.missionTitle}
          @input=${(e: Event) => props.onFieldChange("missionTitle", (e.target as HTMLInputElement).value)}
        />
      </div>

      <div style="${FIELD_STYLE}">
        <label style="${LABEL_STYLE}">Description (optional)</label>
        <textarea
          style="${TEXTAREA_STYLE}"
          placeholder="Additional details about the mission..."
          .value=${s.missionDescription}
          @input=${(e: Event) => props.onFieldChange("missionDescription", (e.target as HTMLTextAreaElement).value)}
        ></textarea>
      </div>

      <div style="${FIELD_STYLE}">
        <label style="${LABEL_STYLE}">Priority</label>
        <select
          style="${INPUT_STYLE}"
          .value=${s.missionPriority}
          @change=${(e: Event) => props.onFieldChange("missionPriority", (e.target as HTMLSelectElement).value)}
        >
          <option value="low">Low</option>
          <option value="medium" selected>Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      <div style="display: flex; justify-content: space-between; margin-top: 8px;">
        <button style="${BACK_BTN_STYLE}" @click=${() => props.onBack()}>Back</button>
        <button
          style="${NEXT_BTN_STYLE}"
          ?disabled=${!s.missionTitle.trim()}
          @click=${() => props.onNext()}
        >Next</button>
      </div>
    </div>
  `;
}

// ============================================================================
// Step: Launch
// ============================================================================

function renderLaunchStep(props: SetupWizardProps) {
  const s = props.state;

  const checkStyle = `
    color: var(--accent, #ff5c5c); font-weight: bold; margin-right: 8px;
  `;

  const summaryItemStyle = `
    padding: 10px 0; border-bottom: 1px solid var(--border, #27272a); font-size: 14px;
  `;

  // Success state
  if (s.result) {
    return html`
      <div>
        <h2 style="margin: 0 0 4px 0; font-size: 20px; color: var(--card-foreground, #f4f4f5);">Launched</h2>
        <p class="muted" style="margin: 0 0 24px 0; font-size: 14px;">
          Your venture, agent, and mission have been created.
        </p>

        <div class="card" style="padding: 16px; margin-bottom: 16px;">
          <div style="${summaryItemStyle}">
            <span style="${checkStyle}">OK</span>
            Venture ID: <code>${s.result.ventureId}</code>
          </div>
          <div style="${summaryItemStyle}">
            <span style="${checkStyle}">OK</span>
            Agent: <code>${s.result.agentId}</code>
          </div>
          <div style="padding: 10px 0; font-size: 14px;">
            <span style="${checkStyle}">OK</span>
            Mission: <code>${s.result.missionId}</code>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end;">
          <button style="${NEXT_BTN_STYLE}" @click=${() => props.onClose()}>Done</button>
        </div>
      </div>
    `;
  }

  // Error state
  if (s.error) {
    return html`
      <div>
        <h2 style="margin: 0 0 4px 0; font-size: 20px; color: var(--card-foreground, #f4f4f5);">Launch failed</h2>
        <div class="card" style="padding: 16px; margin: 16px 0;">
          <div class="stat-value warn" style="font-size: 14px; word-break: break-word;">${s.error}</div>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <button style="${BACK_BTN_STYLE}" @click=${() => props.onBack()}>Back</button>
          <button style="${NEXT_BTN_STYLE}" ?disabled=${s.creating} @click=${() => props.onCreate()}>
            ${s.creating ? "Creating..." : "Retry"}
          </button>
        </div>
      </div>
    `;
  }

  // Default — ready to launch
  return html`
    <div>
      <h2 style="margin: 0 0 4px 0; font-size: 20px; color: var(--card-foreground, #f4f4f5);">Ready to launch</h2>
      <p class="muted" style="margin: 0 0 24px 0; font-size: 14px;">
        Everything is set up. Launching will create the venture, deploy the agent, and create the first mission.
      </p>

      <div class="card" style="padding: 16px; margin-bottom: 16px;">
        <div style="${summaryItemStyle}">
          <span style="${checkStyle}">+</span>
          Venture: <strong>${s.ventureName}</strong>
          ${s.venturePrefix ? html` [<code>${s.venturePrefix}</code>]` : nothing}
        </div>
        <div style="${summaryItemStyle}">
          <span style="${checkStyle}">+</span>
          Agent: <strong>${s.agentName}</strong>
          ${s.agentRole ? html` [${s.agentRole}]` : nothing}
        </div>
        <div style="padding: 10px 0; font-size: 14px;">
          <span style="${checkStyle}">+</span>
          Mission: <strong>${s.missionTitle}</strong>
          [${s.missionPriority || "medium"}]
        </div>
      </div>

      <div style="display: flex; justify-content: space-between;">
        <button style="${BACK_BTN_STYLE}" @click=${() => props.onBack()}>Back</button>
        <button
          style="${NEXT_BTN_STYLE}"
          ?disabled=${s.creating}
          @click=${() => props.onCreate()}
        >${s.creating ? "Creating..." : "Create & Launch"}</button>
      </div>
    </div>
  `;
}

// ============================================================================
// Main render
// ============================================================================

export function renderSetupWizard(props: SetupWizardProps) {
  if (!props.state.open) {
    return nothing;
  }

  const renderStep = () => {
    switch (props.state.step) {
      case "venture":
        return renderVentureStep(props);
      case "agent":
        return renderAgentStep(props);
      case "mission":
        return renderMissionStep(props);
      case "launch":
        return renderLaunchStep(props);
    }
  };

  return html`
    <div
      style="${OVERLAY_STYLE}"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) {
          props.onClose();
        }
      }}
    >
      <div style="${CARD_STYLE}">
        <button style="${CLOSE_BTN_STYLE}" @click=${() => props.onClose()}>x</button>
        ${renderStepIndicators(props.state.step)}
        ${renderStep()}
      </div>
    </div>
  `;
}
