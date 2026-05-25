import { describe, expect, it } from "vitest";
import { DEFAULTS, Simulation, type EnvironmentCell, type SimulationConfigPatch } from "../src/core/primordia";

describe("typed simulation core", () => {
  it("constructs from a typed config patch without browser globals", () => {
    expect(globalThis.document).toBeUndefined();

    const config: SimulationConfigPatch = {
      width: 12,
      height: 8,
      initialAgents: 0,
      seed: 42
    };
    const sim = new Simulation(config);

    expect(sim.width).toBe(12);
    expect(sim.height).toBe(8);
    expect(sim.size).toBe(96);
    expect(sim.config.initialEnergy).toBe(DEFAULTS.initialEnergy);
    expect(sim.agents).toHaveLength(0);
  });

  it("exposes environment cells as typed wrapped-coordinate snapshots", () => {
    const sim = new Simulation({
      width: 4,
      height: 3,
      initialAgents: 0,
      seed: 7
    });

    const origin: EnvironmentCell = sim.cellAt(0, 0);
    const wrapped: EnvironmentCell = sim.cellAt(4, 3);

    expect(wrapped).toEqual(origin);

    origin.resource = 999;
    expect(sim.cellAt(0, 0).resource).not.toBe(999);
    expect(sim.environmentAt(sim.size).resource).toBe(sim.cellAt(0, 0).resource);
  });
});
