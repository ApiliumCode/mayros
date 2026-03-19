/**
 * Canvas Gateway — loads venture data and generates A2UI JSONL surfaces.
 *
 * Called by the `kaneru.canvas` gateway method. Aggregates venture, mission,
 * chain, and fuel data into a single CanvasVentureData structure, then
 * delegates to canvas-surfaces.ts for JSONL generation.
 */

import type { CortexClient } from "../shared/cortex-client.js";
import type { CanvasVentureData } from "./canvas-surfaces.js";
import { VentureManager } from "./venture.js";
import { MissionManager } from "./mission.js";
import { ChainManager } from "./chain.js";
import { FuelController } from "./fuel.js";
import { CostAnalyticsService } from "./cost-analytics.js";

/**
 * Load all venture-related data from Cortex and assemble a CanvasVentureData
 * object suitable for passing to the surface generators.
 */
export async function loadCanvasData(client: CortexClient, ns: string): Promise<CanvasVentureData> {
  const vm = new VentureManager(client, ns);
  const mm = new MissionManager(client, ns, vm);
  const cm = new ChainManager(client, ns);
  const fc = new FuelController(client, ns);
  const ca = new CostAnalyticsService(client, ns);

  const ventures = await vm.list();
  const venturesSummary: CanvasVentureData["ventures"] = [];
  const allMissions: CanvasVentureData["missions"] = [];
  const allChainNodes: CanvasVentureData["chain"] = [];
  let totalFuelSpent = 0;
  let activeMissions = 0;

  for (const v of ventures.slice(0, 20)) {
    const missions = await mm.list(v.id, { limit: 50 });
    const fuel = await fc.summary(v.id, v.fuelLimit);
    let chainNodes: CanvasVentureData["chain"] = [];
    try {
      chainNodes = await cm.getChain(v.id);
    } catch {
      // skip ventures with no chain
    }

    totalFuelSpent += fuel.totalCents;
    activeMissions += missions.filter((m) => m.status === "active").length;

    venturesSummary.push({
      id: v.id,
      name: v.name,
      status: v.status,
      prefix: v.prefix,
      fuelLimit: v.fuelLimit,
      fuelSpent: fuel.totalCents,
      agentCount: chainNodes.length,
      missionCount: missions.length,
    });

    for (const m of missions) {
      allMissions.push({
        id: m.id,
        identifier: m.identifier,
        title: m.title,
        status: m.status,
        priority: m.priority,
        claimedBy: m.claimedBy,
      });
    }
    allChainNodes.push(...chainNodes);
  }

  // Fuel analytics for first venture (if any)
  let fuelData: CanvasVentureData["fuel"] = undefined;
  if (ventures.length > 0) {
    try {
      const analytics = await ca.analyze(ventures[0].id, {
        fuelLimit: ventures[0].fuelLimit,
      });
      fuelData = {
        burnRate: analytics.forecast.burnRateCentsPerHour,
        daysUntilExhausted: analytics.forecast.daysUntilExhausted,
        byProvider: analytics.byProvider,
      };
    } catch {
      // Non-fatal: analytics may not be available yet
    }
  }

  return {
    ventures: venturesSummary,
    missions: allMissions.slice(0, 100),
    chain: allChainNodes,
    stats: {
      totalVentures: ventures.length,
      activeMissions,
      totalFuelSpent,
    },
    fuel: fuelData,
  };
}
