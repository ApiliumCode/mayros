/**
 * Canvas Surfaces — A2UI JSONL generators for Kaneru
 *
 * Generates A2UI v0.8 JSONL surfaces that visualize venture data:
 * overview, mission kanban, chain tree, and fuel analytics.
 *
 * These surfaces work on macOS, iOS, Android (native WebView) AND
 * the web portal (embedded A2UI host).
 */

// ============================================================================
// Types
// ============================================================================

export type CanvasSurfaceId =
  | "kaneru-overview"
  | "kaneru-missions"
  | "kaneru-chain"
  | "kaneru-fuel";

type A2UIComponent = {
  id: string;
  component: Record<string, unknown>;
};

type A2UISurfaceUpdate = {
  surfaceUpdate: {
    surfaceId: string;
    components: A2UIComponent[];
  };
};

type A2UIBeginRendering = {
  beginRendering: {
    surfaceId: string;
    root: string;
  };
};

// ============================================================================
// Input Types (from venture dashboard data)
// ============================================================================

export type CanvasVentureData = {
  ventures: Array<{
    id: string;
    name: string;
    status: string;
    prefix: string;
    fuelLimit: number;
    fuelSpent: number;
    agentCount: number;
    missionCount: number;
  }>;
  missions: Array<{
    id: string;
    identifier: string;
    title: string;
    status: string;
    priority: string;
    claimedBy: string | null;
  }>;
  chain: Array<{
    agentId: string;
    role: string;
    escalatesTo: string | null;
    children: Array<{ agentId: string; role: string }>;
  }>;
  stats: {
    totalVentures: number;
    activeMissions: number;
    totalFuelSpent: number;
  };
  fuel?: {
    burnRate: number;
    daysUntilExhausted: number | null;
    byProvider: Array<{ provider: string; model: string; costCents: number; eventCount: number }>;
  };
};

// ============================================================================
// Helpers
// ============================================================================

function text(id: string, value: string, hint: string = "body"): A2UIComponent {
  return { id, component: { Text: { text: { literalString: value }, usageHint: hint } } };
}

function column(id: string, childIds: string[]): A2UIComponent {
  return { id, component: { Column: { children: { explicitList: childIds } } } };
}

function row(id: string, childIds: string[]): A2UIComponent {
  return { id, component: { Row: { children: { explicitList: childIds } } } };
}

function card(id: string, childIds: string[]): A2UIComponent {
  return { id, component: { Card: { children: { explicitList: childIds } } } };
}

function button(id: string, label: string, action: string): A2UIComponent {
  return {
    id,
    component: { Button: { label: { literalString: label }, action: { literalString: action } } },
  };
}

function divider(id: string): A2UIComponent {
  return { id, component: { Divider: {} } };
}

function buildJsonl(surfaceId: string, components: A2UIComponent[], rootId: string): string {
  const update: A2UISurfaceUpdate = { surfaceUpdate: { surfaceId, components } };
  const render: A2UIBeginRendering = { beginRendering: { surfaceId, root: rootId } };
  return JSON.stringify(update) + "\n" + JSON.stringify(render);
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function priorityLabel(priority: string): string {
  const map: Record<string, string> = {
    critical: "CRITICAL",
    high: "HIGH",
    medium: "MED",
    low: "LOW",
  };
  return map[priority] ?? priority.toUpperCase();
}

// ============================================================================
// Surface Generators
// ============================================================================

/** Generate the venture overview surface. */
export function generateOverviewSurface(data: CanvasVentureData): string {
  const components: A2UIComponent[] = [];
  const statIds: string[] = [];
  const ventureCardIds: string[] = [];

  // Stats cards
  components.push(card("s-ventures", ["s-ventures-val", "s-ventures-lbl"]));
  components.push(text("s-ventures-val", String(data.stats.totalVentures), "h1"));
  components.push(text("s-ventures-lbl", "Ventures", "caption"));
  statIds.push("s-ventures");

  components.push(card("s-missions", ["s-missions-val", "s-missions-lbl"]));
  components.push(text("s-missions-val", String(data.stats.activeMissions), "h1"));
  components.push(text("s-missions-lbl", "Active Missions", "caption"));
  statIds.push("s-missions");

  components.push(card("s-fuel", ["s-fuel-val", "s-fuel-lbl"]));
  components.push(text("s-fuel-val", formatCents(data.stats.totalFuelSpent), "h1"));
  components.push(text("s-fuel-lbl", "Fuel Spent", "caption"));
  statIds.push("s-fuel");

  components.push(row("stats-row", statIds));

  // Venture cards
  for (let i = 0; i < data.ventures.length && i < 20; i++) {
    const v = data.ventures[i];
    const vid = `v-${i}`;
    const fuelText =
      v.fuelLimit > 0
        ? `${formatCents(v.fuelSpent)} / ${formatCents(v.fuelLimit)}`
        : formatCents(v.fuelSpent);

    components.push(card(vid, [`${vid}-name`, `${vid}-info`, `${vid}-fuel`]));
    components.push(text(`${vid}-name`, `[${v.prefix}] ${v.name}`, "h3"));
    components.push(
      text(
        `${vid}-info`,
        `${v.status} | ${v.agentCount} agents | ${v.missionCount} missions`,
        "caption",
      ),
    );
    components.push(text(`${vid}-fuel`, `Fuel: ${fuelText}`, "body"));
    ventureCardIds.push(vid);
  }

  if (ventureCardIds.length === 0) {
    components.push(text("no-ventures", "No ventures yet. Create one to get started.", "body"));
    ventureCardIds.push("no-ventures");
  }

  components.push(text("ventures-title", "Ventures", "h2"));
  components.push(column("ventures-list", ventureCardIds));

  // Root
  const rootChildren = ["stats-row", "ventures-title", "ventures-list"];
  components.push(column("root", rootChildren));

  return buildJsonl("kaneru-overview", components, "root");
}

/** Generate the mission kanban surface. */
export function generateMissionsSurface(data: CanvasVentureData): string {
  const components: A2UIComponent[] = [];
  const columnIds: string[] = [];

  const statuses = ["queued", "ready", "active", "review", "complete"];
  const statusLabels: Record<string, string> = {
    queued: "Queued",
    ready: "Ready",
    active: "Active",
    review: "Review",
    complete: "Complete",
  };

  for (const status of statuses) {
    const missions = data.missions.filter((m) => m.status === status);
    const cardIds: string[] = [];

    for (let i = 0; i < missions.length && i < 15; i++) {
      const m = missions[i];
      const mid = `m-${status}-${i}`;
      const claimInfo = m.claimedBy ? `Agent: ${m.claimedBy}` : "Unclaimed";

      // Build card children list upfront, including action button if applicable
      const cardChildren = [`${mid}-id`, `${mid}-title`, `${mid}-meta`];

      if (status === "ready") {
        cardChildren.push(`${mid}-claim`);
      } else if (status === "active") {
        cardChildren.push(`${mid}-complete`);
      }

      components.push(card(mid, cardChildren));
      components.push(
        text(`${mid}-id`, `${m.identifier} [${priorityLabel(m.priority)}]`, "caption"),
      );
      components.push(text(`${mid}-title`, m.title, "body"));
      components.push(text(`${mid}-meta`, claimInfo, "caption"));

      if (status === "ready") {
        components.push(button(`${mid}-claim`, "Claim", `claim:${m.id}`));
      } else if (status === "active") {
        components.push(button(`${mid}-complete`, "Complete", `complete:${m.id}`));
      }

      cardIds.push(mid);
    }

    if (cardIds.length === 0) {
      const emptyId = `empty-${status}`;
      components.push(text(emptyId, "No missions", "caption"));
      cardIds.push(emptyId);
    }

    const colId = `col-${status}`;
    const colHeaderId = `hdr-${status}`;
    components.push(text(colHeaderId, `${statusLabels[status]} (${missions.length})`, "h3"));
    components.push(column(colId, [colHeaderId, ...cardIds]));
    columnIds.push(colId);
  }

  components.push(text("missions-title", "Missions", "h2"));
  components.push(row("kanban", columnIds));
  components.push(column("root", ["missions-title", "kanban"]));

  return buildJsonl("kaneru-missions", components, "root");
}

/** Generate the chain of command surface. */
export function generateChainSurface(data: CanvasVentureData): string {
  const components: A2UIComponent[] = [];
  const nodeIds: string[] = [];

  if (data.chain.length === 0) {
    components.push(text("no-chain", "No agents deployed yet.", "body"));
    nodeIds.push("no-chain");
  } else {
    let idx = 0;
    const renderNode = (
      node: { agentId: string; role: string; children: Array<{ agentId: string; role: string }> },
      depth: number,
    ) => {
      const nid = `chain-${idx++}`;
      const indent = depth > 0 ? "  ".repeat(depth) + "-> " : "";
      components.push(card(nid, [`${nid}-name`, `${nid}-role`]));
      components.push(text(`${nid}-name`, `${indent}${node.agentId}`, "h4"));
      components.push(text(`${nid}-role`, node.role, "caption"));
      nodeIds.push(nid);

      for (const child of node.children ?? []) {
        renderNode(child as typeof node, depth + 1);
      }
    };

    for (const root of data.chain) {
      renderNode(root, 0);
    }
  }

  components.push(text("chain-title", "Chain of Command", "h2"));
  components.push(column("chain-list", nodeIds));
  components.push(column("root", ["chain-title", "chain-list"]));

  return buildJsonl("kaneru-chain", components, "root");
}

/** Generate the fuel analytics surface. */
export function generateFuelSurface(data: CanvasVentureData): string {
  const components: A2UIComponent[] = [];

  // Summary stats
  const summaryIds = ["fuel-total", "fuel-burn", "fuel-exhaust"];

  components.push(card("fuel-total", ["fuel-total-val", "fuel-total-lbl"]));
  components.push(text("fuel-total-val", formatCents(data.stats.totalFuelSpent), "h2"));
  components.push(text("fuel-total-lbl", "Total Spent", "caption"));

  const burnRate = data.fuel?.burnRate ?? 0;
  components.push(card("fuel-burn", ["fuel-burn-val", "fuel-burn-lbl"]));
  components.push(text("fuel-burn-val", `${burnRate} c/hr`, "h2"));
  components.push(text("fuel-burn-lbl", "Burn Rate", "caption"));

  const daysLeft = data.fuel?.daysUntilExhausted;
  components.push(card("fuel-exhaust", ["fuel-exhaust-val", "fuel-exhaust-lbl"]));
  components.push(
    text(
      "fuel-exhaust-val",
      daysLeft !== null && daysLeft !== undefined ? `${daysLeft}d` : "N/A",
      "h2",
    ),
  );
  components.push(text("fuel-exhaust-lbl", "Days Left", "caption"));

  components.push(row("fuel-summary", summaryIds));

  // By provider
  const providerIds: string[] = [];
  const providers = data.fuel?.byProvider ?? [];
  for (let i = 0; i < providers.length && i < 10; i++) {
    const p = providers[i];
    const pid = `prov-${i}`;
    components.push(
      text(
        pid,
        `${p.provider}/${p.model}: ${formatCents(p.costCents)} (${p.eventCount} events)`,
        "body",
      ),
    );
    providerIds.push(pid);
  }

  if (providerIds.length === 0) {
    components.push(text("no-providers", "No fuel events recorded yet.", "caption"));
    providerIds.push("no-providers");
  }

  components.push(text("fuel-title", "Fuel Analytics", "h2"));
  components.push(text("prov-title", "By Provider", "h3"));
  components.push(column("prov-list", providerIds));
  components.push(divider("fuel-div"));
  components.push(button("fuel-refresh", "Refresh", "refresh-fuel"));

  components.push(
    column("root", [
      "fuel-title",
      "fuel-summary",
      "fuel-div",
      "prov-title",
      "prov-list",
      "fuel-refresh",
    ]),
  );

  return buildJsonl("kaneru-fuel", components, "root");
}

/** Generate a specific surface by ID. */
export function generateSurface(surfaceId: CanvasSurfaceId, data: CanvasVentureData): string {
  switch (surfaceId) {
    case "kaneru-overview":
      return generateOverviewSurface(data);
    case "kaneru-missions":
      return generateMissionsSurface(data);
    case "kaneru-chain":
      return generateChainSurface(data);
    case "kaneru-fuel":
      return generateFuelSurface(data);
  }
}

/** Generate ALL surfaces as a single JSONL string. */
export function generateAllSurfaces(data: CanvasVentureData): string {
  return [
    generateOverviewSurface(data),
    generateMissionsSurface(data),
    generateChainSurface(data),
    generateFuelSurface(data),
  ].join("\n");
}
