import { html, nothing } from "lit";

// ============================================================================
// Types
// ============================================================================

export type MissionDetailProps = {
  mission: {
    id: string;
    identifier: string;
    title: string;
    status: string;
    priority: string;
    claimedBy: string | null;
    description?: string;
    ventureId?: string;
  };
  comments: Array<{
    id: string;
    author: string;
    content: string;
    createdAt: string;
  }>;
  onClose: () => void;
  onAddComment?: (content: string) => void;
};

// ============================================================================
// Helpers
// ============================================================================

function statusClass(status: string): string {
  switch (status.toLowerCase()) {
    case "active":
    case "running":
    case "complete":
      return "ok";
    case "queued":
    case "ready":
    case "idle":
    case "paused":
      return "warn";
    default:
      return "";
  }
}

function priorityColor(priority: string): string {
  switch (priority.toLowerCase()) {
    case "critical":
      return "#e74c3c";
    case "high":
      return "var(--color-warn, #e2a03f)";
    case "medium":
      return "var(--color-ok, #25c281)";
    case "low":
      return "var(--border-color, #666)";
    default:
      return "var(--border-color, #666)";
  }
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return ts;
  }
}

// ============================================================================
// Sections
// ============================================================================

function renderHeader(props: MissionDetailProps) {
  return html`
    <div style="display: flex; align-items: flex-start; gap: 12px;">
      <div style="flex: 1; min-width: 0;">
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <code style="font-size: 0.9em;">${props.mission.identifier}</code>
          <span style="
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.75em;
            font-weight: 600;
            background: ${priorityColor(props.mission.priority)}22;
            color: ${priorityColor(props.mission.priority)};
            border: 1px solid ${priorityColor(props.mission.priority)}44;
          ">${props.mission.priority}</span>
          <span class="stat-value ${statusClass(props.mission.status)}" style="font-size: 0.8em;">
            ${props.mission.status}
          </span>
        </div>
        <h3 style="margin: 8px 0 0 0;">${props.mission.title}</h3>
      </div>
      <button
        style="
          background: none;
          border: 1px solid var(--border-color, #444);
          border-radius: 6px;
          color: inherit;
          cursor: pointer;
          padding: 4px 10px;
          font-size: 1em;
          line-height: 1;
          flex-shrink: 0;
        "
        @click=${() => props.onClose()}
        title="Close"
      >&times;</button>
    </div>
  `;
}

function renderDetails(props: MissionDetailProps) {
  return html`
    <div style="display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin-top: 16px; font-size: 0.9em;">
      <div class="muted">Claimed by</div>
      <div>
        ${props.mission.claimedBy
          ? html`<code>${props.mission.claimedBy}</code>`
          : html`<span class="muted">Unclaimed</span>`}
      </div>
      ${props.mission.ventureId
        ? html`
            <div class="muted">Venture</div>
            <div><code>${props.mission.ventureId}</code></div>
          `
        : nothing}
    </div>
    ${props.mission.description
      ? html`
          <div style="margin-top: 16px;">
            <div class="muted" style="font-size: 0.85em; margin-bottom: 4px;">Description</div>
            <div style="
              background: var(--bg-secondary);
              border-radius: 6px;
              padding: 12px;
              font-size: 0.9em;
              line-height: 1.5;
              white-space: pre-wrap;
            ">${props.mission.description}</div>
          </div>
        `
      : nothing}
  `;
}

function renderComments(props: MissionDetailProps) {
  return html`
    <div style="margin-top: 20px; border-top: 1px solid var(--border-color, #444); padding-top: 16px;">
      <div class="muted" style="font-size: 0.85em; margin-bottom: 8px;">
        Comments (${props.comments.length})
      </div>
      ${props.comments.length === 0
        ? html`<div class="muted" style="font-size: 0.85em; padding: 8px 0;">No comments yet.</div>`
        : props.comments.map(
            (c) => html`
              <div style="
                background: var(--bg-secondary);
                border-radius: 6px;
                padding: 10px 12px;
                margin-bottom: 8px;
              ">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                  <code style="font-size: 0.85em; font-weight: 600;">${c.author}</code>
                  <span class="muted" style="font-size: 0.75em;">${formatTimestamp(c.createdAt)}</span>
                </div>
                <div style="font-size: 0.9em; line-height: 1.4; white-space: pre-wrap;">${c.content}</div>
              </div>
            `,
          )}
    </div>
  `;
}

function renderCommentInput(props: MissionDetailProps) {
  if (!props.onAddComment) {
    return nothing;
  }

  const onAddComment = props.onAddComment;
  let inputValue = "";

  const handleSubmit = () => {
    const trimmed = inputValue.trim();
    if (trimmed.length > 0) {
      onAddComment(trimmed);
    }
  };

  return html`
    <div style="display: flex; gap: 8px; margin-top: 12px;">
      <input
        type="text"
        placeholder="Add a comment..."
        @input=${(e: Event) => { inputValue = (e.target as HTMLInputElement).value; }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter") {
            handleSubmit();
            (e.target as HTMLInputElement).value = "";
            inputValue = "";
          }
        }}
        style="
          flex: 1;
          padding: 8px 10px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color, #444);
          border-radius: 6px;
          color: inherit;
          font-size: 0.9em;
        "
      />
      <button class="btn btn--sm" @click=${() => handleSubmit()}>
        Send
      </button>
    </div>
  `;
}

// ============================================================================
// Main render
// ============================================================================

export function renderMissionDetail(props: MissionDetailProps) {
  return html`
    <section class="card">
      ${renderHeader(props)}
      ${renderDetails(props)}
      ${renderComments(props)}
      ${renderCommentInput(props)}
    </section>
  `;
}
