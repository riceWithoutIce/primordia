import type { DeathStats, SimulationConfig } from "../types";

export const DEFAULTS: SimulationConfig = {
  environmentMode: "flux",
  width: 256,
  height: 160,
  initialAgents: 96,
  maxAgents: 720,
  initialEnergy: 42,
  resourceGrowth: 0.052,
  resourceCap: 9,
  eventInterval: 220,
  eventRadius: 8,
  eventIntensity: 1.5,
  processInterval: 360,
  processDuration: 160,
  processRadius: 10,
  processIntensity: 1.1,
  barrierThreshold: 0.86,
  terrainCostScale: 0.7,
  traceDecay: 0.965,
  pressureDecay: 0.992,
  pressureDiffusion: 0.055,
  pressureGrowth: 0.012,
  reproductionShare: 0.46,
  seed: 1337
};

export function createDeathStats(): DeathStats {
  return {
    starvation: 0,
    pressure: 0,
    overflow: 0
  };
}
