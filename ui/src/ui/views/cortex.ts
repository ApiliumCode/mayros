import { html, nothing } from "lit";
import type {
  CortexStatusResponse,
  CortexBrowseFilter,
  TripleEntry,
} from "../controllers/cortex.ts";

export type CortexBrowserProps = {
  loading: boolean;
  error: string | null;
  status: CortexStatusResponse | null;
  triples: { triples: TripleEntry[]; total: number } | null;
  subjects: { subjects: string[]; total: number } | null;
  predicates: { predicates: string[]; total: number } | null;
  filter: CortexBrowseFilter;
  browseLoading: boolean;
  browseError: string | null;
  onRefresh: () => void;
  onFilterChange: (filter: Partial<CortexBrowseFilter>) => void;
  onSubjectClick: (subject: string) => void;
  onPageChange: (offset: number) => void;
  onReconnect: () => void;
};

function formatObject(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function groupBySubject(triples: TripleEntry[]): Map<string, TripleEntry[]> {
  const groups = new Map<string, TripleEntry[]>();
  for (const triple of triples) {
    const existing = groups.get(triple.subject);
    if (existing) {
      existing.push(triple);
    } else {
      groups.set(triple.subject, [triple]);
    }
  }
  return groups;
}

export function renderCortex(props: CortexBrowserProps) {
  const isOffline = !props.status || props.status.status !== "online";
  const triples = props.triples?.triples ?? [];
  const total = props.triples?.total ?? 0;
  const subjectList = props.subjects?.subjects ?? [];
  const predicateList = props.predicates?.predicates ?? [];
  const grouped = groupBySubject(triples);
  const limit = props.filter.limit;
  const offset = props.filter.offset;
  const pageStart = total > 0 ? offset + 1 : 0;
  const pageEnd = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  if (isOffline) {
    return html`
      <section class="card" style="text-align: center; padding: 32px;">
        <div class="stat-value warn">Cortex Offline</div>
        <div class="muted" style="margin: 12px 0;">
          ${props.status?.endpoint ? `Endpoint: ${props.status.endpoint}` : "Not connected"}
        </div>
        <button class="btn btn--sm" ?disabled=${props.loading} @click=${() => props.onReconnect()}>
          Reconnect
        </button>
      </section>
    `;
  }

  return html`
    <section>
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
        <div style="flex: 1;">
          <div class="muted">
            ${props.status?.triples != null ? `${props.status.triples} triples` : ""}
            ${props.status?.subjects != null ? ` · ${props.status.subjects} subjects` : ""}
            ${props.status?.version ? ` · v${props.status.version}` : ""}
          </div>
        </div>
        <button class="btn btn--sm" ?disabled=${props.browseLoading || props.loading} @click=${() => props.onRefresh()}>
          ${props.browseLoading ? "Loading…" : "Refresh"}
        </button>
      </div>

      ${props.browseError ? html`<div class="pill danger" style="margin-bottom: 12px;">${props.browseError}</div>` : nothing}

      <div style="display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap;">
        <label style="display: flex; align-items: center; gap: 6px;">
          <span class="muted">Subject:</span>
          <select
            style="padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--fg);"
            @change=${(e: Event) => {
              const value = (e.target as HTMLSelectElement).value;
              props.onFilterChange({ subject: value || undefined, offset: 0 });
            }}
          >
            <option value="" ?selected=${!props.filter.subject}>All</option>
            ${subjectList.map(
              (s) => html`<option value=${s} ?selected=${props.filter.subject === s}>${s}</option>`,
            )}
          </select>
        </label>
        <label style="display: flex; align-items: center; gap: 6px;">
          <span class="muted">Predicate:</span>
          <select
            style="padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-secondary); color: var(--fg);"
            @change=${(e: Event) => {
              const value = (e.target as HTMLSelectElement).value;
              props.onFilterChange({ predicate: value || undefined, offset: 0 });
            }}
          >
            <option value="" ?selected=${!props.filter.predicate}>All</option>
            ${predicateList.map(
              (p) =>
                html`<option value=${p} ?selected=${props.filter.predicate === p}>${p}</option>`,
            )}
          </select>
        </label>
      </div>

      ${
        triples.length === 0 && !props.browseLoading
          ? html`
              <div class="card" style="text-align: center; padding: 24px">
                <div class="muted">No triples found.</div>
              </div>
            `
          : nothing
      }

      ${[...grouped.entries()].map(
        ([subject, entries]) => html`
          <div class="card" style="margin-bottom: 12px; padding: 12px 16px;">
            <div
              style="font-weight: 600; margin-bottom: 8px; cursor: pointer; color: var(--accent);"
              @click=${() => props.onSubjectClick(subject)}
              title="Filter by this subject"
            >
              ${subject}
            </div>
            <table style="width: 100%; border-collapse: collapse;">
              <tbody>
                ${entries.map(
                  (entry) => html`
                    <tr style="border-top: 1px solid var(--border);">
                      <td
                        style="padding: 4px 12px 4px 0; white-space: nowrap; color: var(--fg-muted); font-size: 13px; vertical-align: top;"
                      >
                        ${entry.predicate}
                      </td>
                      <td style="padding: 4px 0; word-break: break-word; font-size: 13px;">
                        ${formatObject(entry.object)}
                      </td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          </div>
        `,
      )}

      ${
        total > 0
          ? html`
            <div
              style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px;"
            >
              <span class="muted">Showing ${pageStart}–${pageEnd} of ${total}</span>
              <div style="display: flex; gap: 8px;">
                <button
                  class="btn btn--sm"
                  ?disabled=${!hasPrev || props.browseLoading}
                  @click=${() => props.onPageChange(Math.max(0, offset - limit))}
                >
                  Prev
                </button>
                <button
                  class="btn btn--sm"
                  ?disabled=${!hasNext || props.browseLoading}
                  @click=${() => props.onPageChange(offset + limit)}
                >
                  Next
                </button>
              </div>
            </div>
          `
          : nothing
      }
    </section>
  `;
}
