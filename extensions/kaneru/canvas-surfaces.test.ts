import { describe, expect, it } from "vitest";
import {
  generateOverviewSurface,
  generateMissionsSurface,
  generateChainSurface,
  generateFuelSurface,
  generateSurface,
  generateAllSurfaces,
  type CanvasVentureData,
} from "./canvas-surfaces.js";

// ============================================================================
// Helpers
// ============================================================================

/** A2UI v0.8 action keys that each JSONL line must contain exactly one of. */
const A2UI_ACTION_KEYS = [
  "surfaceUpdate",
  "beginRendering",
  "createSurface",
  "appendOutput",
  "replaceOutput",
  "updateComponent",
  "deleteComponent",
];

function validateJsonl(jsonl: string) {
  const lines = jsonl.split(/\r?\n/).filter((l) => l.trim());
  expect(lines.length).toBeGreaterThan(0);

  let hasSurfaceUpdate = false;
  let hasBeginRendering = false;

  for (const line of lines) {
    const obj = JSON.parse(line) as Record<string, unknown>;
    expect(typeof obj).toBe("object");
    expect(Array.isArray(obj)).toBe(false);

    const actionKeys = A2UI_ACTION_KEYS.filter((key) => key in obj);
    expect(actionKeys).toHaveLength(1);

    if (actionKeys[0] === "surfaceUpdate") hasSurfaceUpdate = true;
    if (actionKeys[0] === "beginRendering") hasBeginRendering = true;
  }

  return { hasSurfaceUpdate, hasBeginRendering, lineCount: lines.length };
}

function getSurfaceUpdate(jsonl: string) {
  const lines = jsonl.split(/\r?\n/).filter((l) => l.trim());
  for (const line of lines) {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (obj.surfaceUpdate) {
      return obj.surfaceUpdate as {
        surfaceId: string;
        components: Array<{ id: string; component: Record<string, unknown> }>;
      };
    }
  }
  return null;
}

function getBeginRendering(jsonl: string) {
  const lines = jsonl.split(/\r?\n/).filter((l) => l.trim());
  for (const line of lines) {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (obj.beginRendering) {
      return obj.beginRendering as { surfaceId: string; root: string };
    }
  }
  return null;
}

// ============================================================================
// Test Data
// ============================================================================

const EMPTY_DATA: CanvasVentureData = {
  ventures: [],
  missions: [],
  chain: [],
  stats: { totalVentures: 0, activeMissions: 0, totalFuelSpent: 0 },
};

const POPULATED_DATA: CanvasVentureData = {
  ventures: [
    {
      id: "v1",
      name: "Alpha",
      status: "active",
      prefix: "ALP",
      fuelLimit: 10000,
      fuelSpent: 3500,
      agentCount: 2,
      missionCount: 5,
    },
    {
      id: "v2",
      name: "Beta",
      status: "paused",
      prefix: "BET",
      fuelLimit: 0,
      fuelSpent: 1200,
      agentCount: 1,
      missionCount: 3,
    },
  ],
  missions: [
    { id: "m1", identifier: "ALP-1", title: "Setup infra", status: "active", priority: "high", claimedBy: "agent-1" },
    { id: "m2", identifier: "ALP-2", title: "Write tests", status: "ready", priority: "medium", claimedBy: null },
    { id: "m3", identifier: "ALP-3", title: "Deploy", status: "queued", priority: "low", claimedBy: null },
    { id: "m4", identifier: "BET-1", title: "Research", status: "complete", priority: "medium", claimedBy: "agent-2" },
    { id: "m5", identifier: "ALP-4", title: "Review PR", status: "review", priority: "critical", claimedBy: "agent-1" },
  ],
  chain: [
    {
      agentId: "agent-1",
      role: "lead",
      escalatesTo: null,
      children: [{ agentId: "agent-2", role: "worker", escalatesTo: "agent-1", children: [] }],
    },
  ],
  stats: { totalVentures: 2, activeMissions: 1, totalFuelSpent: 4700 },
  fuel: {
    burnRate: 15,
    daysUntilExhausted: 42,
    byProvider: [
      { provider: "openai", model: "gpt-4", costCents: 3000, eventCount: 120 },
      { provider: "anthropic", model: "claude-3", costCents: 1700, eventCount: 80 },
    ],
  },
};

// ============================================================================
// Tests
// ============================================================================

describe("canvas-surfaces", () => {
  // --------------------------------------------------------------------------
  // Overview surface
  // --------------------------------------------------------------------------
  describe("generateOverviewSurface", () => {
    it("returns valid JSONL with empty data", () => {
      const jsonl = generateOverviewSurface(EMPTY_DATA);
      const result = validateJsonl(jsonl);
      expect(result.hasSurfaceUpdate).toBe(true);
      expect(result.hasBeginRendering).toBe(true);
    });

    it("has a root component in beginRendering", () => {
      const jsonl = generateOverviewSurface(EMPTY_DATA);
      const render = getBeginRendering(jsonl);
      expect(render).not.toBeNull();
      expect(render!.surfaceId).toBe("kaneru-overview");
      expect(render!.root).toBe("root");
    });

    it("includes venture cards for populated data", () => {
      const jsonl = generateOverviewSurface(POPULATED_DATA);
      const update = getSurfaceUpdate(jsonl);
      expect(update).not.toBeNull();
      // Should have cards for both ventures
      const ventureCards = update!.components.filter((c) => c.id.startsWith("v-"));
      expect(ventureCards.length).toBeGreaterThanOrEqual(2);
    });

    it("shows empty message when no ventures", () => {
      const jsonl = generateOverviewSurface(EMPTY_DATA);
      const update = getSurfaceUpdate(jsonl);
      const emptyText = update!.components.find((c) => c.id === "no-ventures");
      expect(emptyText).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Missions surface
  // --------------------------------------------------------------------------
  describe("generateMissionsSurface", () => {
    it("returns valid JSONL with empty data", () => {
      const jsonl = generateMissionsSurface(EMPTY_DATA);
      const result = validateJsonl(jsonl);
      expect(result.hasSurfaceUpdate).toBe(true);
      expect(result.hasBeginRendering).toBe(true);
    });

    it("creates columns for each mission status", () => {
      const jsonl = generateMissionsSurface(POPULATED_DATA);
      const update = getSurfaceUpdate(jsonl);
      expect(update).not.toBeNull();
      // Expect columns for queued, ready, active, review, complete
      const columnIds = ["col-queued", "col-ready", "col-active", "col-review", "col-complete"];
      for (const colId of columnIds) {
        const col = update!.components.find((c) => c.id === colId);
        expect(col).toBeDefined();
      }
    });

    it("adds claim buttons for ready missions", () => {
      const jsonl = generateMissionsSurface(POPULATED_DATA);
      const update = getSurfaceUpdate(jsonl);
      const claimButtons = update!.components.filter(
        (c) => c.id.includes("-claim") && c.component.Button,
      );
      expect(claimButtons.length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------------------------------
  // Chain surface
  // --------------------------------------------------------------------------
  describe("generateChainSurface", () => {
    it("returns valid JSONL with empty data", () => {
      const jsonl = generateChainSurface(EMPTY_DATA);
      const result = validateJsonl(jsonl);
      expect(result.hasSurfaceUpdate).toBe(true);
      expect(result.hasBeginRendering).toBe(true);
    });

    it("shows empty message when no chain nodes", () => {
      const jsonl = generateChainSurface(EMPTY_DATA);
      const update = getSurfaceUpdate(jsonl);
      const empty = update!.components.find((c) => c.id === "no-chain");
      expect(empty).toBeDefined();
    });

    it("renders chain nodes for populated data", () => {
      const jsonl = generateChainSurface(POPULATED_DATA);
      const update = getSurfaceUpdate(jsonl);
      const chainCards = update!.components.filter((c) => c.id.startsWith("chain-") && c.component.Card);
      // Should have at least 2 nodes (agent-1 + agent-2)
      expect(chainCards.length).toBeGreaterThanOrEqual(2);
    });
  });

  // --------------------------------------------------------------------------
  // Fuel surface
  // --------------------------------------------------------------------------
  describe("generateFuelSurface", () => {
    it("returns valid JSONL with empty data", () => {
      const jsonl = generateFuelSurface(EMPTY_DATA);
      const result = validateJsonl(jsonl);
      expect(result.hasSurfaceUpdate).toBe(true);
      expect(result.hasBeginRendering).toBe(true);
    });

    it("shows provider breakdown for populated data", () => {
      const jsonl = generateFuelSurface(POPULATED_DATA);
      const update = getSurfaceUpdate(jsonl);
      const providers = update!.components.filter((c) => c.id.startsWith("prov-") && !c.id.includes("title") && !c.id.includes("list"));
      expect(providers.length).toBe(2);
    });

    it("includes a refresh button", () => {
      const jsonl = generateFuelSurface(POPULATED_DATA);
      const update = getSurfaceUpdate(jsonl);
      const btn = update!.components.find((c) => c.id === "fuel-refresh");
      expect(btn).toBeDefined();
      expect(btn!.component.Button).toBeDefined();
    });

    it("shows N/A for days left when no fuel data", () => {
      const jsonl = generateFuelSurface(EMPTY_DATA);
      const update = getSurfaceUpdate(jsonl);
      const exhaustComp = update!.components.find((c) => c.id === "fuel-exhaust-val");
      expect(exhaustComp).toBeDefined();
      const text = (exhaustComp!.component.Text as Record<string, unknown>).text as Record<string, unknown>;
      expect(text.literalString).toBe("N/A");
    });
  });

  // --------------------------------------------------------------------------
  // generateSurface dispatcher
  // --------------------------------------------------------------------------
  describe("generateSurface", () => {
    it("dispatches to correct generator by surfaceId", () => {
      const overview = generateSurface("kaneru-overview", EMPTY_DATA);
      expect(getBeginRendering(overview)!.surfaceId).toBe("kaneru-overview");

      const missions = generateSurface("kaneru-missions", EMPTY_DATA);
      expect(getBeginRendering(missions)!.surfaceId).toBe("kaneru-missions");

      const chain = generateSurface("kaneru-chain", EMPTY_DATA);
      expect(getBeginRendering(chain)!.surfaceId).toBe("kaneru-chain");

      const fuel = generateSurface("kaneru-fuel", EMPTY_DATA);
      expect(getBeginRendering(fuel)!.surfaceId).toBe("kaneru-fuel");
    });
  });

  // --------------------------------------------------------------------------
  // generateAllSurfaces
  // --------------------------------------------------------------------------
  describe("generateAllSurfaces", () => {
    it("returns valid JSONL containing all 4 surfaces", () => {
      const jsonl = generateAllSurfaces(POPULATED_DATA);
      const lines = jsonl.split(/\r?\n/).filter((l) => l.trim());

      // Should be parseable
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }

      // Should contain all 4 surface IDs
      const surfaceIds = new Set<string>();
      for (const line of lines) {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.beginRendering) {
          surfaceIds.add((obj.beginRendering as { surfaceId: string }).surfaceId);
        }
      }
      expect(surfaceIds.has("kaneru-overview")).toBe(true);
      expect(surfaceIds.has("kaneru-missions")).toBe(true);
      expect(surfaceIds.has("kaneru-chain")).toBe(true);
      expect(surfaceIds.has("kaneru-fuel")).toBe(true);
    });

    it("each surface has exactly one surfaceUpdate and one beginRendering", () => {
      const jsonl = generateAllSurfaces(EMPTY_DATA);
      const lines = jsonl.split(/\r?\n/).filter((l) => l.trim());

      let surfaceUpdateCount = 0;
      let beginRenderingCount = 0;

      for (const line of lines) {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.surfaceUpdate) surfaceUpdateCount++;
        if (obj.beginRendering) beginRenderingCount++;
      }

      expect(surfaceUpdateCount).toBe(4);
      expect(beginRenderingCount).toBe(4);
    });
  });
});
