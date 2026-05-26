import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  GENOME_BOUNDS,
  Simulation,
  constrainGenome,
  mutateGenome,
  type EnvironmentCell,
  type EnvironmentMode,
  type Genome,
  type SimulationConfigPatch
} from "../src/core/primordia";

function testGenome(overrides: Partial<Genome> = {}): Genome {
  return {
    senseRadius: 1,
    metabolism: 0.5,
    moveCost: 0.2,
    harvestRate: 1.2,
    traceAffinity: 0,
    resourceAffinity: 1,
    reproductionThreshold: 90,
    mutationRate: 0.04,
    ...overrides
  };
}

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

  it("lets agents naturally disappear in a closed environment without resources", () => {
    const sim = new Simulation({
      environmentMode: "closed",
      width: 8,
      height: 8,
      initialAgents: 6,
      initialEnergy: 4,
      resourceGrowth: 0,
      resourceCap: 0,
      seed: 23
    });

    sim.step(80);
    const metrics = sim.metrics();

    expect(metrics.agents).toBe(0);
    expect(metrics.deaths).toBeGreaterThanOrEqual(6);
    expect(metrics.deathReasons.starvation).toBeGreaterThanOrEqual(6);
    expect(metrics.births).toBe(6);
  });

  it("changes energy or environment during a surviving agent action", () => {
    const sim = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      resourceCap: 10,
      seed: 31
    });
    const genome = {
      senseRadius: 1,
      metabolism: 0.1,
      moveCost: 0,
      harvestRate: 1,
      traceAffinity: 0,
      resourceAffinity: 1,
      reproductionThreshold: 999,
      mutationRate: 0
    };
    const agent = sim.spawnAgent(0, 0, genome, 10);
    const startIndex = sim.index(agent.x, agent.y);
    sim.resources[startIndex] = 2;
    const beforeEnergy = agent.energy;
    const beforeResource = sim.metrics().totalResource;
    const beforeTrace = sim.metrics().totalTrace;

    sim.tick();

    const after = sim.metrics();
    expect(after.agents).toBe(1);
    expect(agent.energy).not.toBe(beforeEnergy);
    expect(after.totalResource).toBeLessThan(beforeResource);
    expect(after.totalTrace).toBeGreaterThan(beforeTrace);
  });

  it("reports seed and aggregate environmental pressure in metrics", () => {
    const sim = new Simulation({
      width: 4,
      height: 4,
      initialAgents: 0,
      seed: 20260526
    });
    const idx = sim.index(2, 2);
    sim.pressure[idx] = 2.5;

    const metrics = sim.metrics();

    expect(metrics.seed).toBe(20260526);
    expect(metrics.totalPressure).toBeGreaterThanOrEqual(2.5);
    expect(metrics.totalResource).toBeGreaterThanOrEqual(0);
    expect(metrics.totalTrace).toBeGreaterThanOrEqual(0);
  });

  it("assigns independent lineage ids to initial spawned agents", () => {
    const sim = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      seed: 37
    });
    const genome = {
      senseRadius: 1,
      metabolism: 0.1,
      moveCost: 0,
      harvestRate: 0,
      traceAffinity: 0,
      resourceAffinity: 0,
      reproductionThreshold: 999,
      mutationRate: 0
    };
    const first = sim.spawnAgent(0, 0, genome, 10);
    const second = sim.spawnAgent(1, 0, genome, 10);

    expect(first.lineageId).not.toBe(second.lineageId);
    expect(sim.metrics().lineageCount).toBe(2);
    expect(sim.metrics().maxGeneration).toBe(0);
  });

  it("preserves parent lineage through reproduction while increasing generation", () => {
    const sim = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      reproductionShare: 0.5,
      seed: 39
    });
    const genome = {
      senseRadius: 1,
      metabolism: 0.1,
      moveCost: 0,
      harvestRate: 0,
      traceAffinity: 0,
      resourceAffinity: 0,
      reproductionThreshold: 20,
      mutationRate: 0
    };
    const parent = sim.spawnAgent(1, 1, genome, 60);

    sim.tick();
    const child = sim.agents.find((agent) => agent.id !== parent.id);

    expect(child).toBeDefined();
    expect(child?.lineageId).toBe(parent.lineageId);
    expect(child?.generation).toBe(parent.generation + 1);
    expect(sim.metrics().lineageCount).toBe(1);
    expect(sim.metrics().maxGeneration).toBe(1);
  });

  it("constrains spawned genomes to fixed bounds", () => {
    const sim = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      seed: 40
    });
    const agent = sim.spawnAgent(
      0,
      0,
      testGenome({
        senseRadius: 99,
        metabolism: -10,
        moveCost: -10,
        harvestRate: 99,
        traceAffinity: 99,
        resourceAffinity: -10,
        reproductionThreshold: -10,
        mutationRate: 99
      }),
      20
    );

    for (const key of Object.keys(GENOME_BOUNDS) as Array<keyof Genome>) {
      expect(agent.genome[key]).toBeGreaterThanOrEqual(GENOME_BOUNDS[key].min);
      expect(agent.genome[key]).toBeLessThanOrEqual(GENOME_BOUNDS[key].max);
    }
  });

  it("keeps mutations inside genome bounds", () => {
    const child = mutateGenome(
      testGenome({
        senseRadius: 99,
        metabolism: 99,
        moveCost: 99,
        harvestRate: 99,
        traceAffinity: 99,
        resourceAffinity: 99,
        reproductionThreshold: 1,
        mutationRate: 1
      }),
      () => 0
    );

    for (const key of Object.keys(GENOME_BOUNDS) as Array<keyof Genome>) {
      expect(child[key]).toBeGreaterThanOrEqual(GENOME_BOUNDS[key].min);
      expect(child[key]).toBeLessThanOrEqual(GENOME_BOUNDS[key].max);
    }
  });

  it("charges ecological costs for broad sensing, high harvest, and early reproduction", () => {
    const modest = constrainGenome(
      testGenome({
        senseRadius: 1,
        metabolism: GENOME_BOUNDS.metabolism.min,
        moveCost: GENOME_BOUNDS.moveCost.min,
        harvestRate: 1.4,
        resourceAffinity: 1.3,
        reproductionThreshold: 78
      })
    );
    const costly = constrainGenome(
      testGenome({
        senseRadius: 3,
        metabolism: GENOME_BOUNDS.metabolism.min,
        moveCost: GENOME_BOUNDS.moveCost.min,
        harvestRate: GENOME_BOUNDS.harvestRate.max,
        resourceAffinity: GENOME_BOUNDS.resourceAffinity.max,
        reproductionThreshold: GENOME_BOUNDS.reproductionThreshold.min,
        traceAffinity: GENOME_BOUNDS.traceAffinity.max
      })
    );

    expect(costly.metabolism).toBeGreaterThan(modest.metabolism);
    expect(costly.moveCost).toBeGreaterThan(modest.moveCost);
  });

  it("turns aggressive harvesting and early reproduction into environmental cost", () => {
    const highHarvest = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      seed: 44
    });
    const agent = highHarvest.spawnAgent(
      1,
      1,
      testGenome({
        harvestRate: GENOME_BOUNDS.harvestRate.max
      }),
      20
    );
    const idx = highHarvest.index(1, 1);
    highHarvest.resources[idx] = GENOME_BOUNDS.harvestRate.max;
    const pressureBeforeHarvest = highHarvest.pressure[idx];

    highHarvest.harvestAgent(agent);

    expect(highHarvest.pressure[idx]).toBeGreaterThan(pressureBeforeHarvest);

    const early = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      reproductionShare: 0.5,
      seed: 45
    });
    const late = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      reproductionShare: 0.5,
      seed: 45
    });
    const earlyParent = early.spawnAgent(
      1,
      1,
      testGenome({
        reproductionThreshold: GENOME_BOUNDS.reproductionThreshold.min
      }),
      100
    );
    const lateParent = late.spawnAgent(
      1,
      1,
      testGenome({
        reproductionThreshold: GENOME_BOUNDS.reproductionThreshold.max
      }),
      100
    );
    const pressureBeforeReproduction = early.pressure[early.index(1, 1)];
    const earlyChild = early.reproduce(earlyParent);
    const lateChild = late.reproduce(lateParent);

    expect(earlyChild.energy).toBeLessThan(lateChild.energy);
    expect(early.pressure[early.index(1, 1)]).toBeGreaterThan(pressureBeforeReproduction);
  });

  it("records starvation deaths and returns residue to the environment", () => {
    const sim = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      resourceCap: 10,
      seed: 41
    });
    const genome = {
      senseRadius: 1,
      metabolism: 2,
      moveCost: 0,
      harvestRate: 0,
      traceAffinity: 0,
      resourceAffinity: 0,
      reproductionThreshold: 999,
      mutationRate: 0
    };
    sim.spawnAgent(1, 1, genome, 1);
    const before = sim.cellAt(1, 1);

    sim.tick();
    const after = sim.cellAt(1, 1);
    const metrics = sim.metrics();

    expect(metrics.agents).toBe(0);
    expect(metrics.deaths).toBe(1);
    expect(metrics.deathReasons.starvation).toBe(1);
    expect(after.trace).toBeGreaterThan(before.trace);
    expect(after.pressure).toBeGreaterThan(before.pressure);
  });

  it("records pressure deaths separately from starvation", () => {
    const sim = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      seed: 43
    });
    const genome = {
      senseRadius: 1,
      metabolism: 1,
      moveCost: 0,
      harvestRate: 0,
      traceAffinity: 0,
      resourceAffinity: 0,
      reproductionThreshold: 999,
      mutationRate: 0
    };
    sim.spawnAgent(2, 2, genome, 1.2);
    sim.pressure[sim.index(2, 2)] = 4;

    sim.tick();

    expect(sim.metrics().deathReasons.pressure).toBe(1);
    expect(sim.metrics().deathReasons.starvation).toBe(0);
  });

  it("records overflow deaths and recovers their residue", () => {
    const sim = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      maxAgents: 1,
      resourceCap: 10,
      seed: 47
    });
    const genome = {
      senseRadius: 1,
      metabolism: 0.1,
      moveCost: 0,
      harvestRate: 0,
      traceAffinity: 0,
      resourceAffinity: 0,
      reproductionThreshold: 999,
      mutationRate: 0
    };
    sim.spawnAgent(0, 0, genome, 5);
    sim.spawnAgent(1, 0, genome, 10);
    const before = sim.metrics().totalResource;

    sim.tick();
    const metrics = sim.metrics();

    expect(metrics.agents).toBe(1);
    expect(metrics.deaths).toBe(1);
    expect(metrics.deathReasons.overflow).toBe(1);
    expect(metrics.totalResource).toBeGreaterThan(before);
  });
});
