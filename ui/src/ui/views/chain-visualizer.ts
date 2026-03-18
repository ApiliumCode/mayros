import { html, nothing } from "lit";

// ============================================================================
// Types
// ============================================================================

export type ChainNodeData = {
  agentId: string;
  role: string;
  escalatesTo: string | null;
  children: ChainNodeData[];
};

export type ChainVisualizerProps = {
  chain: ChainNodeData[];
  ventureId: string;
};

// ============================================================================
// Helpers
// ============================================================================

function isActive(node: ChainNodeData): boolean {
  return node.children.length > 0 || node.escalatesTo !== null;
}

function nodeStyle(node: ChainNodeData): string {
  const borderColor = isActive(node)
    ? "var(--color-ok, #25c281)"
    : "var(--border-color, #444)";
  return `
    position: relative;
    background: var(--bg-secondary);
    border: 2px solid ${borderColor};
    border-radius: 8px;
    padding: 10px 14px;
    display: inline-block;
    min-width: 160px;
  `;
}

const TREE_BRANCH_STYLE = `
  position: relative;
  padding-left: 24px;
  margin: 8px 0;
`;

// ============================================================================
// Render functions
// ============================================================================

function renderChainNode(node: ChainNodeData, isRoot: boolean) {
  const wrapperStyle = isRoot
    ? "margin: 8px 0;"
    : TREE_BRANCH_STYLE;

  return html`
    <div style="${wrapperStyle}">
      ${isRoot
        ? nothing
        : html`<div style="
            position: absolute;
            left: 0;
            top: 0;
            bottom: 50%;
            border-left: 2px solid var(--border-color, #444);
            border-bottom: 2px solid var(--border-color, #444);
            width: 16px;
          "></div>`}
      <div style="${nodeStyle(node)}">
        <div style="font-weight: 600; font-size: 0.9em;">
          <code>${node.agentId}</code>
        </div>
        <div class="muted" style="font-size: 0.8em; margin-top: 2px;">
          ${node.role}
        </div>
        ${node.escalatesTo
          ? html`<div style="font-size: 0.75em; margin-top: 4px; color: var(--color-ok, #25c281);">
              Escalates to: <code>${node.escalatesTo}</code>
            </div>`
          : nothing}
      </div>
      ${node.children.length > 0
        ? html`
            <div style="margin-left: 8px;">
              ${node.children.map((child) => renderChainNode(child, false))}
            </div>
          `
        : nothing}
    </div>
  `;
}

function renderEmptyState() {
  return html`
    <div class="muted" style="margin-top: 12px;">
      No escalation chain configured. Agents operate independently.
    </div>
  `;
}

// ============================================================================
// Main render
// ============================================================================

export function renderChainVisualizer(props: ChainVisualizerProps) {
  return html`
    <section class="card">
      <h3>
        Escalation Chain
        ${props.ventureId
          ? html`<span class="muted" style="font-weight: normal; font-size: 0.85em;">
              (${props.ventureId})
            </span>`
          : nothing}
      </h3>
      ${props.chain.length === 0
        ? renderEmptyState()
        : html`
            <div style="margin-top: 12px; overflow-x: auto; padding-bottom: 8px;">
              ${props.chain.map((root) => renderChainNode(root, true))}
            </div>
          `}
    </section>
  `;
}
