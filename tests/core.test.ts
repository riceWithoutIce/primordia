import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  Simulation,
  type EnvironmentCell,
  type EnvironmentMode,
  type SimulationConfigPatch
} from "../src/core/primordia";

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
    expect(sim.config.environmentMode).toBe("flux");
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

  it("keeps closed environments without resource input", () => {
    const sim = new Simulation({
      environmentMode: "closed",
      width: 8,
      height: 8,
      initialAgents: 0,
      resourceGrowth: 1,
      resourceCap: 9,
      seed: 11
    });
    const before = sim.metrics().totalResource;

    sim.step(20);

    expect(sim.metrics().totalResource).toBe(before);
  });

  it("adds bounded resource input in flux environments", () => {
    const baseConfig: SimulationConfigPatch = {
      environmentMode: "flux",
      width: 8,
      height: 8,
      initialAgents: 0,
      resourceGrowth: 1,
      resourceCap: 9,
      seed: 11
    };

    const flux = new Simulation(baseConfig);
    const closed = new Simulation({ ...baseConfig, environmentMode: "closed" satisfies EnvironmentMode });
    const fluxBefore = flux.metrics().totalResource;
    const closedBefore = closed.metrics().totalResource;

    flux.step(1);
    closed.step(1);

    expect(flux.metrics().totalResource).toBeGreaterThan(fluxBefore);
    expect(flux.metrics().totalResource).toBeLessThanOrEqual(flux.size * flux.config.resourceCap);
    expect(closed.metrics().totalResource).toBe(closedBefore);
  });
});
