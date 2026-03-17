import { html, nothing } from "lit";

// ============================================================================
// Types
// ============================================================================

export type AvailableAgent = {
  agentId: string;
  role: string;
  expertise?: string;
};

export type SquadBuilderProps = {
  availableAgents: AvailableAgent[];
  selectedAgents: string[];
  squadName: string;
  strategy: string;
  onToggleAgent: (agentId: string) => void;
  onNameChange: (name: string) => void;
  onStrategyChange: (strategy: string) => void;
  onCreate: () => void;
  creating: boolean;
};

// ============================================================================
// Constants
// ============================================================================

const STRATEGIES = [
  { value: "additive", label: "Additive" },
  { value: "replace", label: "Replace" },
  { value: "conflict-flag", label: "Conflict Flag" },
  { value: "newest-wins", label: "Newest Wins" },
  { value: "majority-wins", label: "Majority Wins" },
] as const;

// ============================================================================
// Cards
// ============================================================================

function renderAgentCard(
  agent: AvailableAgent,
  selected: boolean,
  onToggle: (agentId: string) => void,
) {
  const borderColor = selected
    ? "var(--color-ok, #25c281)"
    : "var(--border-color, #444)";
  const bgColor = selected
    ? "var(--bg-secondary)"
    : "transparent";

  return html`
    <div
      style="
        background: ${bgColor};
        border: 2px solid ${borderColor};
        border-radius: 8px;
        padding: 12px 14px;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
        user-select: none;
      "
      @click=${() => onToggle(agent.agentId)}
    >
      <div style="display: flex; align-items: center; gap: 8px;">
        <div style="
          width: 18px;
          height: 18px;
          border-radius: 4px;
          border: 2px solid ${selected ? "var(--color-ok, #25c281)" : "var(--border-color, #444)"};
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          color: var(--color-ok, #25c281);
          flex-shrink: 0;
        ">${selected ? "\u2713" : nothing}</div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; font-size: 0.9em;">
            <code>${agent.agentId}</code>
          </div>
          <div class="muted" style="font-size: 0.8em; margin-top: 2px;">
            ${agent.role}
          </div>
        </div>
      </div>
      ${agent.expertise
        ? html`<div class="muted" style="font-size: 0.75em; margin-top: 6px;">
            ${agent.expertise}
          </div>`
        : nothing}
    </div>
  `;
}

function renderAgentGrid(props: SquadBuilderProps) {
  if (props.availableAgents.length === 0) {
    return html`
      <div class="muted" style="margin-top: 12px;">
        No agents available. Create agents first to build a squad.
      </div>
    `;
  }

  return html`
    <div style="
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 10px;
      margin-top: 12px;
    ">
      ${props.availableAgents.map((agent) =>
        renderAgentCard(
          agent,
          props.selectedAgents.includes(agent.agentId),
          props.onToggleAgent,
        ),
      )}
    </div>
  `;
}

function renderConfigSection(props: SquadBuilderProps) {
  return html`
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px;">
      <div>
        <label class="muted" style="display: block; font-size: 0.85em; margin-bottom: 4px;">
          Squad Name
        </label>
        <input
          type="text"
          .value=${props.squadName}
          placeholder="Enter squad name..."
          @input=${(e: Event) => props.onNameChange((e.target as HTMLInputElement).value)}
          style="
            width: 100%;
            padding: 8px 10px;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color, #444);
            border-radius: 6px;
            color: inherit;
            font-size: 0.9em;
            box-sizing: border-box;
          "
        />
      </div>
      <div>
        <label class="muted" style="display: block; font-size: 0.85em; margin-bottom: 4px;">
          Merge Strategy
        </label>
        <select
          .value=${props.strategy}
          @change=${(e: Event) => props.onStrategyChange((e.target as HTMLSelectElement).value)}
          style="
            width: 100%;
            padding: 8px 10px;
            background: var(--bg-secondary);
            border: 1px solid var(--border-color, #444);
            border-radius: 6px;
            color: inherit;
            font-size: 0.9em;
            box-sizing: border-box;
          "
        >
          ${STRATEGIES.map(
            (s) => html`<option value=${s.value} ?selected=${props.strategy === s.value}>${s.label}</option>`,
          )}
        </select>
      </div>
    </div>
  `;
}

function renderFooter(props: SquadBuilderProps) {
  const canCreate =
    props.selectedAgents.length > 0 &&
    props.squadName.trim().length > 0 &&
    !props.creating;

  return html`
    <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-color, #444);">
      <span class="muted" style="font-size: 0.85em;">
        ${props.selectedAgents.length} agent${props.selectedAgents.length !== 1 ? "s" : ""} selected
      </span>
      <button
        class="btn btn--sm"
        ?disabled=${!canCreate}
        @click=${() => props.onCreate()}
      >
        ${props.creating ? "Creating..." : "Create Squad"}
      </button>
    </div>
  `;
}

// ============================================================================
// Main render
// ============================================================================

export function renderSquadBuilder(props: SquadBuilderProps) {
  return html`
    <section class="card">
      <h3>Squad Builder</h3>

      <div style="margin-top: 4px;">
        <span class="muted" style="font-size: 0.85em;">Select agents and configure your new squad.</span>
      </div>

      ${renderAgentGrid(props)}

      ${renderConfigSection(props)}

      ${renderFooter(props)}
    </section>
  `;
}
