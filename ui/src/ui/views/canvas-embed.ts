/**
 * Canvas Embed — renders A2UI JSONL as native Lit HTML in the web portal.
 *
 * Parses surfaceUpdate / beginRendering messages and renders simplified
 * HTML equivalents of the A2UI component tree using inline dark-theme styles.
 */

import { html, nothing, type TemplateResult } from "lit";

// ============================================================================
// Types
// ============================================================================

export type CanvasEmbedProps = {
  loading: boolean;
  error: string | null;
  jsonl: string | null;
  activeSurface: string;
  onSurfaceChange: (surface: string) => void;
  onRefresh: () => void;
};

type ParsedComponent = {
  id: string;
  component: Record<string, unknown>;
};

type ParsedSurface = {
  surfaceId: string;
  components: Map<string, ParsedComponent>;
  root: string;
};

// ============================================================================
// JSONL Parser
// ============================================================================

function parseJsonl(jsonl: string): ParsedSurface[] {
  const lines = jsonl.split(/\r?\n/).filter((l) => l.trim());
  const surfaces = new Map<string, ParsedSurface>();

  for (const line of lines) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (obj.surfaceUpdate) {
      const update = obj.surfaceUpdate as {
        surfaceId: string;
        components: Array<{ id: string; component: Record<string, unknown> }>;
      };
      const existing = surfaces.get(update.surfaceId);
      const components = existing?.components ?? new Map<string, ParsedComponent>();
      for (const c of update.components) {
        components.set(c.id, c);
      }
      surfaces.set(update.surfaceId, {
        surfaceId: update.surfaceId,
        components,
        root: existing?.root ?? "",
      });
    }

    if (obj.beginRendering) {
      const render = obj.beginRendering as { surfaceId: string; root: string };
      const existing = surfaces.get(render.surfaceId);
      if (existing) {
        existing.root = render.root;
      }
    }
  }

  return Array.from(surfaces.values());
}

// ============================================================================
// Component Renderer
// ============================================================================

function renderComponent(
  comp: ParsedComponent,
  components: Map<string, ParsedComponent>,
  depth: number,
): TemplateResult | typeof nothing {
  if (depth > 10) return nothing;

  const c = comp.component;
  const type = Object.keys(c)[0];
  if (!type) return nothing;

  const data = c[type] as Record<string, unknown>;

  switch (type) {
    case "Column": {
      const childIds = resolveChildren(data);
      return html`
        <div style="display:flex;flex-direction:column;gap:8px;width:100%">
          ${childIds.map((id) => renderById(id, components, depth + 1))}
        </div>
      `;
    }
    case "Row": {
      const childIds = resolveChildren(data);
      return html`
        <div style="display:flex;flex-direction:row;gap:12px;flex-wrap:wrap;align-items:flex-start">
          ${childIds.map((id) => renderById(id, components, depth + 1))}
        </div>
      `;
    }
    case "Card": {
      const childIds = resolveChildren(data);
      return html`
        <div style="background:var(--card,#1e1e2e);border:1px solid var(--border,#313244);border-radius:8px;padding:12px 16px;flex:1;min-width:140px">
          ${childIds.map((id) => renderById(id, components, depth + 1))}
        </div>
      `;
    }
    case "Text": {
      const text = resolveLiteral(data.text as Record<string, unknown> | undefined);
      const hint = (data.usageHint as string) ?? "body";
      return renderTextByHint(text, hint);
    }
    case "Button": {
      const label = resolveLiteral(data.label as Record<string, unknown> | undefined);
      return html`
        <button style="background:var(--accent,#89b4fa);color:var(--bg,#1e1e2e);border:none;border-radius:6px;padding:6px 16px;cursor:pointer;font-size:0.85rem;font-weight:600;margin-top:4px">${label}</button>
      `;
    }
    case "Divider":
      return html`
        <hr style="border: none; border-top: 1px solid var(--border, #313244); margin: 8px 0" />
      `;
    default:
      return nothing;
  }
}

function renderById(
  id: string,
  components: Map<string, ParsedComponent>,
  depth: number,
): TemplateResult | typeof nothing {
  const comp = components.get(id);
  if (!comp) return nothing;
  return renderComponent(comp, components, depth);
}

function resolveChildren(data: Record<string, unknown>): string[] {
  const children = data.children as Record<string, unknown> | undefined;
  if (!children) return [];
  if (children.explicitList) return children.explicitList as string[];
  return [];
}

function resolveLiteral(field: Record<string, unknown> | undefined): string {
  if (!field) return "";
  if (typeof field.literalString === "string") return field.literalString;
  return String(field);
}

function renderTextByHint(text: string, hint: string): TemplateResult {
  switch (hint) {
    case "h1":
      return html`<h1 style="margin:0;font-size:1.8rem;font-weight:700;color:var(--text,#cdd6f4)">${text}</h1>`;
    case "h2":
      return html`<h2 style="margin:0;font-size:1.25rem;font-weight:600;color:var(--text,#cdd6f4)">${text}</h2>`;
    case "h3":
      return html`<h3 style="margin:0;font-size:1rem;font-weight:600;color:var(--text,#cdd6f4)">${text}</h3>`;
    case "h4":
      return html`<h4 style="margin:0;font-size:0.95rem;font-weight:600;color:var(--text,#cdd6f4)">${text}</h4>`;
    case "h5":
      return html`<h5 style="margin:0;font-size:0.85rem;font-weight:600;color:var(--text,#cdd6f4)">${text}</h5>`;
    case "caption":
      return html`<span style="font-size:0.8rem;color:var(--text-secondary,#a6adc8)">${text}</span>`;
    default:
      return html`<p style="margin:0;font-size:0.9rem;color:var(--text,#cdd6f4)">${text}</p>`;
  }
}

// ============================================================================
// Tab bar
// ============================================================================

const SURFACE_TABS: Array<{ id: string; label: string }> = [
  { id: "all", label: "Overview" },
  { id: "kaneru-missions", label: "Missions" },
  { id: "kaneru-chain", label: "Chain" },
  { id: "kaneru-fuel", label: "Fuel" },
];

// ============================================================================
// Main render function
// ============================================================================

export function renderCanvasEmbed(props: CanvasEmbedProps) {
  const { loading, error, jsonl, activeSurface, onSurfaceChange, onRefresh } = props;

  const tabBar = html`
    <div style="display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap">
      ${SURFACE_TABS.map(
        (tab) => html`
          <button
            style="padding:6px 14px;border-radius:6px;border:1px solid var(--border,#313244);font-size:0.85rem;cursor:pointer;transition:all 0.15s;${
              activeSurface === tab.id
                ? "background:var(--accent,#89b4fa);color:var(--bg,#1e1e2e);font-weight:600;border-color:var(--accent,#89b4fa)"
                : "background:var(--card,#1e1e2e);color:var(--text,#cdd6f4)"
            }"
            @click=${() => onSurfaceChange(tab.id)}
          >
            ${tab.label}
          </button>
        `,
      )}
      <button
        style="margin-left:auto;padding:6px 14px;border-radius:6px;border:1px solid var(--border,#313244);background:var(--card,#1e1e2e);color:var(--text,#cdd6f4);font-size:0.85rem;cursor:pointer"
        @click=${onRefresh}
      >
        Refresh
      </button>
    </div>
  `;

  if (loading) {
    return html`
      <section class="tab-content" style="padding:20px">
        ${tabBar}
        <p style="color:var(--text-secondary,#a6adc8)">Loading canvas...</p>
      </section>
    `;
  }

  if (error) {
    return html`
      <section class="tab-content" style="padding:20px">
        ${tabBar}
        <div style="color:var(--error,#f38ba8);padding:12px;border:1px solid var(--error,#f38ba8);border-radius:8px;background:rgba(243,139,168,0.1)">
          ${error}
        </div>
      </section>
    `;
  }

  if (!jsonl) {
    return html`
      <section class="tab-content" style="padding:20px">
        ${tabBar}
        <p style="color:var(--text-secondary,#a6adc8)">No canvas data. Click Refresh to load.</p>
      </section>
    `;
  }

  // Parse and render surfaces
  const surfaces = parseJsonl(jsonl);

  // Filter surfaces based on active tab
  const visibleSurfaces =
    activeSurface === "all" ? surfaces : surfaces.filter((s) => s.surfaceId === activeSurface);

  const renderedSurfaces = visibleSurfaces.map((surface) => {
    if (!surface.root || !surface.components.has(surface.root)) {
      return nothing;
    }
    return html`
      <div style="margin-bottom:20px">
        ${renderById(surface.root, surface.components, 0)}
      </div>
    `;
  });

  return html`
    <section class="tab-content" style="padding:20px">
      ${tabBar}
      ${
        renderedSurfaces.length > 0
          ? renderedSurfaces
          : html`
              <p style="color: var(--text-secondary, #a6adc8)">No surfaces found for this view.</p>
            `
      }
    </section>
  `;
}
