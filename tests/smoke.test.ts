import { describe, expect, it } from "vitest";
import { Simulation } from "../src/core/primordia";

describe("primordia simulation smoke", () => {
  it("runs a deterministic basic simulation", () => {
    const config = {
      width: 32,
      height: 24,
      initialAgents: 12,
      maxAgents: 80,
      seed: 20260523
    };

    const sim = new Simulation(config);
    sim.step(120);
    const metrics = sim.metrics();

    expect(metrics.tick).toBe(120);
    expect(metrics.births).toBeGreaterThanOrEqual(12);
    expect(metrics.agents).toBeGreaterThanOrEqual(1);
    expect(metrics.agents).toBeLessThanOrEqual(80);
    expect(Number.isFinite(metrics.averageEnergy)).toBe(true);

    const replay = new Simulation(config);
    replay.step(120);
    expect(replay.metrics()).toEqual(metrics);
  });
});
