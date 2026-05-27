import type { DeathStats, SimulationConfig } from "../types";

export const DEFAULTS: SimulationConfig = {
  environmentMode: "flux",
  width: 960,
  height: 640,
  initialAgents: 180,
  maxAgents: 900,
  initialEnergy: 42,
  resourceGrowth: 0.018,
  resourceCap: 9,
  eventInterval: 220,
  eventRadius: 18,
  eventIntensity: 1.5,
  processInterval: 360,
  processDuration: 160,
  processRadius: 24,
  processIntensity: 1.1,
  barrierThreshold: 0.86,
  terrainCostScale: 0.7,
  traceDecay: 0.965,
  pressureDecay: 0.992,
  pressureDiffusion: 0.055,
  pressureGrowth: 0.012,
  reproductionShare: 0.46,
  organBudgetPerTick: 18,
  organAuditLimit: 96,
  chunkSize: 32,
  warmChunkInterval: 4,
  sleepingChunkInterval: 16,
  agentDecisionInterval: 4,
  seed: 1337
};

export function createDeathStats(): DeathStats {
  return {
    starvation: 0,
    pressure: 0,
    overflow: 0
  };
}
