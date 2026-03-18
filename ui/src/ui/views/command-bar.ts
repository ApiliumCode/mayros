import { html, nothing } from "lit";

// ============================================================================
// Types
// ============================================================================

export type CommandBarState = {
  open: boolean;
  query: string;
  recording: boolean;
  processing: boolean;
  result: string | null;
  error: string | null;
  ventureContext: {
    name: string;
    prefix: string;
    missionCount: number;
    activeMissions: number;
    fuelSpent: number;
  } | null;
  activeMissions: Array<{
    identifier: string;
    title: string;
    priority: string;
  }>;
};

export type CommandBarProps = {
  state: CommandBarState;
  onQueryChange: (query: string) => void;
  onSubmit: (query: string) => void;
  onClose: () => void;
  onToggleMic: () => void;
  onQuickAction: (action: string) => void;
};

// ============================================================================
// Quick Actions
// ============================================================================

const QUICK_ACTIONS = [
  { id: "create-mission", label: "Create mission", icon: "+" },
  { id: "check-fuel", label: "Check fuel", icon: "$" },
  { id: "route-task", label: "Route task", icon: ">" },
  { id: "list-agents", label: "List agents", icon: "@" },
  { id: "squad-status", label: "Squad status", icon: "#" },
  { id: "decisions", label: "Recent decisions", icon: "?" },
];

// ============================================================================
// Styles
// ============================================================================

const BACKDROP_STYLE = `
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.5); z-index: 2000;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 15vh;
`;

const MODAL_STYLE = `
  max-width: 600px; width: 90%;
  background: var(--card, #181b22);
  border: 1px solid var(--border, #27272a);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  overflow: hidden;
`;

const INPUT_ROW_STYLE = `
  display: flex; align-items: center;
  position: relative;
`;

const INPUT_STYLE = `
  flex: 1; padding: 16px 20px;
  font-size: 18px; border: none;
  background: transparent;
  color: var(--card-foreground, #f4f4f5);
  outline: none; font-family: inherit;
`;

const MIC_BUTTON_STYLE = `
  width: 36px; height: 36px;
  border-radius: 50%; border: none;
  background: var(--border, #27272a);
  color: var(--card-foreground, #f4f4f5);
  cursor: pointer; font-size: 16px;
  display: flex; align-items: center; justify-content: center;
  margin-right: 12px; transition: background 0.2s;
`;

const MIC_RECORDING_STYLE = `
  width: 36px; height: 36px;
  border-radius: 50%; border: none;
  background: var(--accent, #ff5c5c);
  color: #fff;
  cursor: pointer; font-size: 16px;
  display: flex; align-items: center; justify-content: center;
  margin-right: 12px;
  animation: commandBarPulse 1.2s ease-in-out infinite;
`;

const DIVIDER_STYLE = `
  height: 1px;
  background: var(--border, #27272a);
  margin: 0;
`;

const CONTEXT_STRIP_STYLE = `
  padding: 12px 20px;
  font-size: 13px;
  color: #777;
`;

const QUICK_ACTIONS_GRID_STYLE = `
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
`;

const QUICK_ACTION_STYLE = `
  padding: 10px 20px;
  cursor: pointer;
  font-size: 13px;
  color: var(--card-foreground, #f4f4f5);
  display: flex; align-items: center; gap: 10px;
  transition: background 0.15s;
`;

const QUICK_ACTION_ICON_STYLE = `
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  background: var(--border, #27272a);
  border-radius: 6px;
  font-size: 14px; font-weight: 600;
  color: var(--card-foreground, #f4f4f5);
  flex-shrink: 0;
`;

const MISSIONS_LIST_STYLE = `
  padding: 8px 20px 12px;
`;

const MISSION_ITEM_STYLE = `
  padding: 6px 0;
  font-size: 13px;
  color: #aaa;
  display: flex; align-items: center; gap: 8px;
`;

const RESULT_CARD_STYLE = `
  padding: 16px 20px;
  font-size: 14px;
  color: var(--card-foreground, #f4f4f5);
  white-space: pre-wrap;
  font-family: monospace;
  line-height: 1.5;
`;

const ERROR_CARD_STYLE = `
  padding: 16px 20px;
  font-size: 14px;
  color: var(--accent, #ff5c5c);
  white-space: pre-wrap;
`;

const PROCESSING_STYLE = `
  padding: 16px 20px;
  font-size: 14px;
  color: #777;
  display: flex; align-items: center; gap: 8px;
`;

const FOOTER_STYLE = `
  padding: 10px 20px;
  font-size: 11px;
  color: #555;
  border-top: 1px solid var(--border, #27272a);
  text-align: center;
`;

const PULSE_KEYFRAMES = `
  @keyframes commandBarPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(1.05); }
  }
`;

// ============================================================================
// Helpers
// ============================================================================

function priorityBadge(priority: string) {
  const colors: Record<string, string> = {
    critical: "#ff5c5c",
    high: "#ff9b3c",
    medium: "#f5c842",
    low: "#888",
  };
  const color = colors[priority.toLowerCase()] ?? "#888";
  return html`<span style="
    font-size: 11px; padding: 1px 6px;
    border-radius: 4px; font-weight: 600;
    background: ${color}22; color: ${color};
  ">${priority}</span>`;
}

function filterQuickActions(query: string) {
  if (!query.trim()) return QUICK_ACTIONS;
  const lower = query.toLowerCase();
  return QUICK_ACTIONS.filter(
    (a) =>
      a.label.toLowerCase().includes(lower) ||
      a.id.toLowerCase().includes(lower),
  );
}

// ============================================================================
// Render
// ============================================================================

export function renderCommandBar(props: CommandBarProps) {
  const { state, onQueryChange, onSubmit, onClose, onToggleMic, onQuickAction } = props;

  if (!state.open) return nothing;

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && state.query.trim()) {
      e.preventDefault();
      onSubmit(state.query.trim());
    }
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLInputElement;
    onQueryChange(target.value);
  };

  const filteredActions = filterQuickActions(state.query);
  const showVoice = typeof window !== "undefined" &&
    (Boolean((window as unknown as Record<string, unknown>).SpeechRecognition) ||
     Boolean((window as unknown as Record<string, unknown>).webkitSpeechRecognition));

  return html`
    <style>${PULSE_KEYFRAMES}</style>
    <div
      style=${BACKDROP_STYLE}
      @click=${handleBackdropClick}
      @keydown=${handleKeyDown}
    >
      <div style=${MODAL_STYLE} @click=${(e: Event) => e.stopPropagation()}>
        <!-- Search Input -->
        <div style=${INPUT_ROW_STYLE}>
          <input
            type="text"
            placeholder="Ask Kaneru..."
            .value=${state.query}
            @input=${handleInput}
            @keydown=${handleKeyDown}
            style=${INPUT_STYLE}
            autofocus
          />
          ${showVoice ? html`
            <button
              style=${state.recording ? MIC_RECORDING_STYLE : MIC_BUTTON_STYLE}
              @click=${onToggleMic}
              title=${state.recording ? "Stop recording" : "Voice input"}
            >${state.recording ? "\u23F9" : "\uD83C\uDFA4"}</button>
          ` : nothing}
        </div>

        <div style=${DIVIDER_STYLE}></div>

        <!-- Content area -->
        ${state.processing
          ? html`<div style=${PROCESSING_STYLE}>
              <span style="animation: commandBarPulse 1s ease-in-out infinite;">&#9679;</span>
              Processing...
            </div>`
          : nothing
        }

        ${state.error
          ? html`<div style=${ERROR_CARD_STYLE}>${state.error}</div>`
          : nothing
        }

        ${state.result
          ? html`<div style=${RESULT_CARD_STYLE}>${state.result}</div>`
          : nothing
        }

        ${!state.processing && !state.result && !state.error
          ? html`
            <!-- Context strip -->
            ${state.ventureContext
              ? html`<div style=${CONTEXT_STRIP_STYLE}>
                  ${state.ventureContext.name}
                  <span style="opacity: 0.5; margin: 0 6px;">/</span>
                  ${state.ventureContext.activeMissions} active mission${state.ventureContext.activeMissions !== 1 ? "s" : ""}
                  <span style="opacity: 0.5; margin: 0 6px;">&middot;</span>
                  $${(state.ventureContext.fuelSpent / 100).toFixed(2)} spent
                </div>
                <div style=${DIVIDER_STYLE}></div>`
              : nothing
            }

            <!-- Quick actions -->
            ${filteredActions.length > 0
              ? html`
                <div style=${QUICK_ACTIONS_GRID_STYLE}>
                  ${filteredActions.map(
                    (action) => html`
                      <div
                        style=${QUICK_ACTION_STYLE}
                        class="command-bar-action"
                        @click=${() => onQuickAction(action.id)}
                        @mouseenter=${(e: MouseEvent) => {
                          (e.currentTarget as HTMLElement).style.background = "var(--bg-hover, #262a35)";
                        }}
                        @mouseleave=${(e: MouseEvent) => {
                          (e.currentTarget as HTMLElement).style.background = "transparent";
                        }}
                      >
                        <span style=${QUICK_ACTION_ICON_STYLE}>${action.icon}</span>
                        ${action.label}
                      </div>
                    `,
                  )}
                </div>`
              : nothing
            }

            <!-- Active missions -->
            ${state.activeMissions.length > 0
              ? html`
                <div style=${DIVIDER_STYLE}></div>
                <div style=${MISSIONS_LIST_STYLE}>
                  <div style="font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">
                    Active Missions
                  </div>
                  ${state.activeMissions.slice(0, 5).map(
                    (m) => html`
                      <div style=${MISSION_ITEM_STYLE}>
                        <code style="font-size: 12px; color: var(--accent, #ff5c5c);">${m.identifier}</code>
                        <span style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${m.title}</span>
                        ${priorityBadge(m.priority)}
                      </div>
                    `,
                  )}
                </div>`
              : nothing
            }
          `
          : nothing
        }

        <!-- Footer -->
        <div style=${FOOTER_STYLE}>
          ESC to close &middot; Ctrl+K to toggle &middot; Tab to navigate
        </div>
      </div>
    </div>
  `;
}
