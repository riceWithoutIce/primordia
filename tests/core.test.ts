import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  GENOME_BOUNDS,
  Simulation,
  constrainGenome,
  mutateGenome,
  isBarrierAt,
  movementCostAt,
  movementTerrainAt,
  resourceFertilityAt,
  resourceTerrainAt,
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
    inertia: 0.4,
    riskTolerance: 0.35,
    pressureAversion: 0.9,
    terrainAffinity: 0.2,
    explorationBias: 0.22,
    ...overrides
  };
}

function simulationSnapshot(sim: Simulation): {
  metrics: ReturnType<Simulation["metrics"]>;
  cells: EnvironmentCell[];
  agents: Array<Pick<ReturnType<Simulation["spawnAgent"]>, "x" | "y" | "energy" | "generation" | "lineageId" | "lastAction">>;
} {
  const sampleIndexes = [0, Math.floor(sim.size / 3), Math.floor(sim.size / 2), sim.size - 1];
  return {
    metrics: sim.metrics(),
    cells: sampleIndexes.map((index) => sim.environmentAt(index)),
    agents: sim.agents.map((agent) => ({
      x: agent.x,
      y: agent.y,
      energy: Number(agent.energy.toFixed(6)),
      generation: agent.generation,
      lineageId: agent.lineageId,
      lastAction: agent.lastAction
    }))
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

  it("uses a large world as the Phase 2.2 default", () => {
    const sim = new Simulation({ initialAgents: 0 });

    expect(DEFAULTS.width).toBe(256);
    expect(DEFAULTS.height).toBe(160);
    expect(sim.width).toBe(256);
    expect(sim.height).toBe(160);
    expect(sim.size).toBe(40960);
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
    origin.fertility = 999;
    origin.movementCost = 999;
    origin.barrier = !origin.barrier;
    expect(sim.cellAt(0, 0).resource).not.toBe(999);
    expect(sim.cellAt(0, 0).fertility).not.toBe(999);
    expect(sim.cellAt(0, 0).movementCost).not.toBe(999);
    expect(sim.cellAt(0, 0).barrier).not.toBe(origin.barrier);
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

  it("initializes resources from deterministic terrain instead of independent snow", () => {
    const config: SimulationConfigPatch = {
      width: 32,
      height: 24,
      initialAgents: 0,
      resourceCap: 9,
      seed: 20260529
    };
    const first = new Simulation(config);
    const replay = new Simulation(config);
    const other = new Simulation({ ...config, seed: 20260530 });

    expect(Array.from(replay.resources)).toEqual(Array.from(first.resources));
    expect(Array.from(other.resources)).not.toEqual(Array.from(first.resources));

    const maxResource = Math.max(...Array.from(first.resources));
    const minResource = Math.min(...Array.from(first.resources));
    expect(maxResource).toBeGreaterThan(minResource + first.config.resourceCap * 0.25);
    expect(first.cellAt(5, 7).resource).toBeCloseTo(resourceTerrainAt(5, 7, first.config));
  });

  it("generates deterministic biome layers with multiple ecological niches", () => {
    const sim = new Simulation({
      width: 96,
      height: 60,
      initialAgents: 0,
      seed: 20260601
    });
    const biomeCounts = sim.metrics().biomeCounts;
    const occupiedBiomes = Object.values(biomeCounts).filter((count) => count > 0).length;

    expect(occupiedBiomes).toBeGreaterThanOrEqual(5);
    expect(biomeCounts.ocean).toBeGreaterThan(0);
    expect(biomeCounts.mountain + biomeCounts.hill).toBeGreaterThan(0);
    expect(biomeCounts.snow + biomeCounts.tundra).toBeGreaterThanOrEqual(0);
    expect(sim.cellAt(0, 0).elevation).toBeGreaterThanOrEqual(0);
    expect(sim.cellAt(0, 0).elevation).toBeLessThanOrEqual(1);
  });

  it("exposes deterministic fertility derived from resource terrain", () => {
    const sim = new Simulation({
      width: 32,
      height: 24,
      initialAgents: 0,
      resourceCap: 9,
      seed: 20260529
    });
    const fertile = sim.cellAt(5, 7).fertility;

    expect(fertile).toBeCloseTo(resourceFertilityAt(5, 7, sim.config));
    expect(fertile).toBeGreaterThanOrEqual(0);
    expect(fertile).toBeLessThanOrEqual(1);
  });

  it("uses fertility to bias flux resource growth toward richer terrain", () => {
    const sim = new Simulation({
      environmentMode: "flux",
      width: 40,
      height: 28,
      initialAgents: 0,
      resourceGrowth: 0.5,
      resourceCap: 9,
      seed: 20260532
    });
    const cells = Array.from({ length: sim.size }, (_, index) => {
      const x = index % sim.width;
      const y = Math.floor(index / sim.width);
      return { index, fertility: resourceFertilityAt(x, y, sim.config) };
    }).sort((a, b) => a.fertility - b.fertility);
    const low = cells.slice(0, 120);
    const high = cells.slice(-120);

    sim.resources.fill(0);
    sim.step(24);

    const lowAverage = low.reduce((total, cell) => total + sim.resources[cell.index], 0) / low.length;
    const highAverage = high.reduce((total, cell) => total + sim.resources[cell.index], 0) / high.length;

    expect(highAverage).toBeGreaterThan(lowAverage * 1.5);
  });

  it("slows resource recovery in high-pressure cells", () => {
    const calm = new Simulation({
      environmentMode: "flux",
      width: 8,
      height: 8,
      initialAgents: 0,
      resourceGrowth: 1,
      resourceCap: 9,
      seed: 20260533
    });
    const stressed = new Simulation({
      environmentMode: "flux",
      width: 8,
      height: 8,
      initialAgents: 0,
      resourceGrowth: 1,
      resourceCap: 9,
      seed: 20260533
    });
    calm.resources.fill(0);
    stressed.resources.fill(0);
    stressed.pressure.fill(4);

    calm.step(8);
    stressed.step(8);

    expect(calm.metrics().totalResource).toBeGreaterThan(stressed.metrics().totalResource * 1.8);
  });

  it("triggers deterministic environmental events on the configured interval", () => {
    const config: SimulationConfigPatch = {
      environmentMode: "flux",
      width: 16,
      height: 12,
      initialAgents: 0,
      resourceGrowth: 0,
      eventInterval: 3,
      eventRadius: 3,
      eventIntensity: 1.4,
      seed: 20260540
    };
    const first = new Simulation(config);
    const replay = new Simulation(config);

    first.step(6);
    replay.step(6);

    expect(first.metrics().eventCount).toBe(2);
    expect(replay.metrics().lastEvent).toEqual(first.metrics().lastEvent);
    expect(Array.from(replay.resources)).toEqual(Array.from(first.resources));
    expect(Array.from(replay.pressure)).toEqual(Array.from(first.pressure));
  });

  it("runs deterministic stateful environmental processes", () => {
    const config: SimulationConfigPatch = {
      environmentMode: "flux",
      width: 48,
      height: 32,
      initialAgents: 0,
      resourceGrowth: 0,
      processInterval: 4,
      processDuration: 6,
      processRadius: 4,
      processIntensity: 1.3,
      eventInterval: 0,
      seed: 20260602
    };
    const first = new Simulation(config);
    const replay = new Simulation(config);

    first.step(8);
    replay.step(8);

    expect(first.metrics().processCount).toBeGreaterThan(0);
    expect(first.metrics().activeProcesses).toBeGreaterThan(0);
    expect(first.metrics().totalMoisture).toBeGreaterThan(0);
    expect(replay.metrics().lastProcess).toEqual(first.metrics().lastProcess);
    expect(Array.from(replay.moistureDelta)).toEqual(Array.from(first.moistureDelta));
  });

  it("expires environmental processes after their lifecycle", () => {
    const sim = new Simulation({
      environmentMode: "flux",
      width: 32,
      height: 20,
      initialAgents: 0,
      resourceGrowth: 0,
      processInterval: 2,
      processDuration: 3,
      processRadius: 3,
      eventInterval: 0,
      seed: 20260603
    });

    sim.step(12);

    expect(sim.metrics().processCount).toBeGreaterThan(sim.metrics().activeProcesses);
    expect(sim.world.processHistory.length).toBeGreaterThan(0);
  });

  it("lets bloom events add bounded resource without consuming random simulation state", () => {
    const eventful = new Simulation({
      environmentMode: "flux",
      width: 12,
      height: 10,
      initialAgents: 0,
      resourceGrowth: 0,
      resourceCap: 9,
      eventInterval: 1,
      eventRadius: 3,
      eventIntensity: 2,
      seed: 1
    });
    const quiet = new Simulation({
      ...eventful.config,
      eventInterval: 0
    });
    eventful.resources.fill(0);
    quiet.resources.fill(0);
    eventful.pressure.fill(0);
    quiet.pressure.fill(0);

    eventful.tick();
    quiet.tick();
    const event = eventful.metrics().lastEvent;

    expect(event?.kind).toBe("bloom");
    expect(eventful.metrics().eventCount).toBe(1);
    expect(eventful.metrics().totalResource).toBeGreaterThan(quiet.metrics().totalResource);
    expect(Math.max(...Array.from(eventful.resources))).toBeLessThanOrEqual(eventful.config.resourceCap);
  });

  it("lets pressure events disturb local pressure fields", () => {
    const sim = new Simulation({
      environmentMode: "flux",
      width: 12,
      height: 10,
      initialAgents: 0,
      resourceGrowth: 0,
      eventInterval: 1,
      eventRadius: 3,
      eventIntensity: 2,
      seed: 3
    });
    sim.pressure.fill(0);
    const before = sim.metrics().totalPressure;

    sim.tick();
    const metrics = sim.metrics();

    expect(metrics.lastEvent?.kind).toBe("pressure");
    expect(metrics.totalPressure).toBeGreaterThan(before);
    expect(metrics.totalTrace).toBeGreaterThan(0);
  });

  it("can disable environmental events", () => {
    const sim = new Simulation({
      environmentMode: "flux",
      width: 12,
      height: 10,
      initialAgents: 0,
      resourceGrowth: 0,
      eventInterval: 0,
      seed: 20260541
    });

    sim.step(12);

    expect(sim.metrics().eventCount).toBe(0);
    expect(sim.metrics().lastEvent).toBeNull();
  });

  it("makes neighboring terrain cells more similar than distant cells", () => {
    const sim = new Simulation({
      width: 48,
      height: 32,
      initialAgents: 0,
      seed: 20260530
    });
    let neighborDelta = 0;
    let farDelta = 0;
    let samples = 0;

    for (let y = 0; y < sim.height; y += 4) {
      for (let x = 0; x < sim.width; x += 4) {
        neighborDelta += Math.abs(sim.cellAt(x, y).resource - sim.cellAt(x + 1, y).resource);
        farDelta += Math.abs(sim.cellAt(x, y).resource - sim.cellAt(x + 13, y + 9).resource);
        samples += 1;
      }
    }

    expect(neighborDelta / samples).toBeLessThan(farDelta / samples);
  });

  it("exposes deterministic movement terrain and barriers", () => {
    const sim = new Simulation({
      width: 48,
      height: 32,
      initialAgents: 0,
      barrierThreshold: 0.72,
      terrainCostScale: 0.8,
      seed: 20260538
    });
    const replay = new Simulation({
      width: 48,
      height: 32,
      initialAgents: 0,
      barrierThreshold: 0.72,
      terrainCostScale: 0.8,
      seed: 20260538
    });
    const other = new Simulation({
      width: 48,
      height: 32,
      initialAgents: 0,
      barrierThreshold: 0.72,
      terrainCostScale: 0.8,
      seed: 20260539
    });
    const movement = movementTerrainAt(6, 9, sim.config);
    const cost = movementCostAt(6, 9, sim.config);
    const barriers = Array.from({ length: sim.size }, (_, index) =>
      isBarrierAt(index % sim.width, Math.floor(index / sim.width), sim.config)
    );
    const otherBarriers = Array.from({ length: other.size }, (_, index) =>
      isBarrierAt(index % other.width, Math.floor(index / other.width), other.config)
    );

    expect(movement).toBeCloseTo(movementTerrainAt(6, 9, replay.config));
    expect(cost).toBeGreaterThanOrEqual(1);
    expect(cost).toBeCloseTo(1 + movement * sim.config.terrainCostScale);
    expect(barriers.some(Boolean)).toBe(true);
    expect(barriers).not.toEqual(otherBarriers);
    expect(sim.cellAt(6, 9).movementCost).toBeCloseTo(cost);
    expect(sim.cellAt(6, 9).barrier).toBe(isBarrierAt(6, 9, sim.config));
  });

  it("keeps agents out of barrier cells and relocates barrier spawns", () => {
    const sim = new Simulation({
      environmentMode: "closed",
      width: 24,
      height: 18,
      initialAgents: 0,
      barrierThreshold: 0.65,
      seed: 20260540
    });
    const barrierIndex = Array.from({ length: sim.size }, (_, index) => index).find((index) =>
      sim.isBarrier(index % sim.width, Math.floor(index / sim.width))
    );
    expect(barrierIndex).toBeDefined();
    const barrierX = barrierIndex! % sim.width;
    const barrierY = Math.floor(barrierIndex! / sim.width);
    const agent = sim.spawnAgent(barrierX, barrierY, testGenome({ moveCost: 0.2 }), 10);

    expect(sim.isBarrier(barrierX, barrierY)).toBe(true);
    expect(sim.isBarrier(agent.x, agent.y)).toBe(false);

    const open = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      barrierThreshold: 1.01,
      seed: 20260541
    });
    const walker = open.spawnAgent(0, 0, testGenome({ moveCost: 0.2 }), 10);
    open.config.barrierThreshold = 0;
    const before = { x: walker.x, y: walker.y, energy: walker.energy };
    open.moveAgent(walker, { dx: 1, dy: 0 });

    expect(walker.x).toBe(before.x);
    expect(walker.y).toBe(before.y);
    expect(walker.energy).toBe(before.energy);
  });

  it("charges extra movement energy on high-cost terrain", () => {
    const cheap = new Simulation({
      environmentMode: "closed",
      width: 8,
      height: 8,
      initialAgents: 0,
      barrierThreshold: 1.01,
      terrainCostScale: 0,
      seed: 20260542
    });
    const costly = new Simulation({
      environmentMode: "closed",
      width: 8,
      height: 8,
      initialAgents: 0,
      barrierThreshold: 1.01,
      terrainCostScale: 1,
      seed: 20260542
    });
    const genome = testGenome({ moveCost: GENOME_BOUNDS.moveCost.max });
    const cheapAgent = cheap.spawnAgent(0, 0, genome, 20);
    const costlyAgent = costly.spawnAgent(0, 0, genome, 20);

    cheap.moveAgent(cheapAgent, { dx: 1, dy: 0 });
    costly.moveAgent(costlyAgent, { dx: 1, dy: 0 });

    expect(cheapAgent.energy).toBeCloseTo(20 - GENOME_BOUNDS.moveCost.max);
    expect(costlyAgent.energy).toBeLessThan(cheapAgent.energy);
    expect(20 - costlyAgent.energy).toBeCloseTo(GENOME_BOUNDS.moveCost.max * movementCostAt(1, 0, costly.config));
  });

  it("draws agents toward richer terrain over time", () => {
    const sim = new Simulation({
      width: 48,
      height: 32,
      initialAgents: 24,
      maxAgents: 80,
      barrierThreshold: 1.01,
      terrainCostScale: 0,
      pressureDiffusion: 0,
      seed: 20260531
    });
    let terrainTotal = 0;
    for (let y = 0; y < sim.height; y += 1) {
      for (let x = 0; x < sim.width; x += 1) {
        terrainTotal += resourceTerrainAt(x, y, sim.config);
      }
    }
    const averageTerrain = terrainTotal / sim.size;

    sim.step(80);
    const agentTerrain =
      sim.agents.reduce((total, agent) => total + resourceTerrainAt(agent.x, agent.y, sim.config), 0) / sim.agents.length;

    expect(sim.agents.length).toBeGreaterThan(0);
    expect(agentTerrain).toBeGreaterThan(averageTerrain);
  });

  it("keeps full simulation snapshots deterministic for identical seeds and ticks", () => {
    const config: SimulationConfigPatch = {
      environmentMode: "flux",
      width: 16,
      height: 12,
      initialAgents: 8,
      maxAgents: 40,
      seed: 20260527
    };
    const first = new Simulation(config);
    const replay = new Simulation(config);

    first.step(96);
    replay.step(96);

    expect(simulationSnapshot(replay)).toEqual(simulationSnapshot(first));
  });

  it("records deterministic experiment snapshots for comparison", () => {
    const config: SimulationConfigPatch = {
      environmentMode: "flux",
      width: 16,
      height: 12,
      initialAgents: 8,
      maxAgents: 40,
      eventInterval: 8,
      seed: 20260543
    };
    const first = new Simulation(config);
    const replay = new Simulation(config);

    first.step(24);
    replay.step(24);
    const snapshot = first.snapshot({ environmentSampleStride: 4 });

    expect(snapshot).toEqual(replay.snapshot({ environmentSampleStride: 4 }));
    expect(snapshot.kind).toBe("primordia.experiment-snapshot");
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.id).toContain("seed-20260543-tick-24");
    expect(snapshot.config).toEqual(first.config);
    expect(snapshot.metrics).toEqual(first.metrics());
    expect(snapshot.world.width).toBe(first.width);
    expect(snapshot.world.biomeCounts).toEqual(first.metrics().biomeCounts);
    expect(snapshot.agents).toHaveLength(first.agents.length);
    expect(snapshot.lineages).toHaveLength(first.metrics().lineageFate.total);
    expect(snapshot.species).toHaveLength(first.metrics().speciesFate.total);
    expect(snapshot.environment.sampleStride).toBe(4);
    expect(snapshot.environment.samples.length).toBe(snapshot.environment.sampledCells);
    expect(snapshot.environment.samples[0]).toMatchObject({
      x: 0,
      y: 0
    });
    expect(snapshot.environment.averageResource).toBeGreaterThanOrEqual(0);
    expect(snapshot.environment.barrierCells).toBeGreaterThanOrEqual(0);
    expect(snapshot.environment.samples[0].terrainType).toBeDefined();
  });

  it("lets snapshot sampling density be configured without mutating the simulation", () => {
    const sim = new Simulation({
      environmentMode: "flux",
      width: 12,
      height: 8,
      initialAgents: 4,
      seed: 20260544
    });
    sim.step(10);
    const before = simulationSnapshot(sim);

    const sparse = sim.snapshot({ environmentSampleStride: 6 });
    const dense = sim.snapshot({ environmentSampleStride: 3 });

    expect(dense.environment.sampledCells).toBeGreaterThan(sparse.environment.sampledCells);
    expect(simulationSnapshot(sim)).toEqual(before);
  });

  it("lets finite flux runs stay bounded while producing lifecycle events", () => {
    const sim = new Simulation({
      environmentMode: "flux",
      width: 18,
      height: 12,
      initialAgents: 10,
      maxAgents: 36,
      initialEnergy: 28,
      resourceGrowth: 0.045,
      seed: 20260528
    });

    sim.step(220);
    const metrics = sim.metrics();

    expect(metrics.tick).toBe(220);
    expect(metrics.agents).toBeGreaterThanOrEqual(0);
    expect(metrics.agents).toBeLessThanOrEqual(sim.config.maxAgents);
    expect(metrics.births).toBeGreaterThanOrEqual(sim.config.initialAgents);
    expect(metrics.deaths).toBeGreaterThan(0);
    expect(metrics.totalResource).toBeGreaterThanOrEqual(0);
    expect(metrics.totalResource).toBeLessThanOrEqual(sim.size * sim.config.resourceCap);
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

  it("diffuses ecological pressure into neighboring cells without changing resources", () => {
    const sim = new Simulation({
      environmentMode: "closed",
      width: 5,
      height: 5,
      initialAgents: 0,
      pressureDecay: 1,
      pressureDiffusion: 0.2,
      pressureGrowth: 0,
      seed: 20260536
    });
    sim.pressure.fill(0);
    sim.resources.fill(0);
    const center = sim.index(2, 2);
    const east = sim.index(3, 2);
    sim.pressure[center] = 4;

    sim.updateEnvironment();

    expect(sim.pressure[center]).toBeLessThan(4);
    expect(sim.pressure[east]).toBeGreaterThan(0);
    expect(sim.metrics().totalPressure).toBeCloseTo(4, 5);
    expect(sim.metrics().totalResource).toBe(0);
  });

  it("can disable pressure diffusion for isolated pressure tests", () => {
    const sim = new Simulation({
      environmentMode: "closed",
      width: 5,
      height: 5,
      initialAgents: 0,
      pressureDecay: 1,
      pressureDiffusion: 0,
      pressureGrowth: 0,
      seed: 20260537
    });
    sim.pressure.fill(0);
    sim.pressure[sim.index(2, 2)] = 4;

    sim.updateEnvironment();

    expect(sim.pressure[sim.index(2, 2)]).toBe(4);
    expect(sim.pressure[sim.index(3, 2)]).toBe(0);
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

  it("tracks lineage fate across living, extinct, and dominant lineages", () => {
    const sim = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      resourceCap: 0,
      seed: 20260535
    });
    const fragile = testGenome({ metabolism: 1, moveCost: 0, harvestRate: 0, reproductionThreshold: 999 });
    const durable = testGenome({ metabolism: 0.3, moveCost: 0, harvestRate: 0, reproductionThreshold: 999 });

    sim.spawnAgent(0, 0, fragile, 0.2, 0, 101);
    sim.spawnAgent(1, 0, durable, 8, 0, 202);
    sim.spawnAgent(2, 0, durable, 8, 0, 202);
    sim.step(1);

    const fate = sim.metrics().lineageFate;
    expect(fate.total).toBe(2);
    expect(fate.living).toBe(1);
    expect(fate.extinct).toBe(1);
    expect(fate.dominantId).toBe(202);
    expect(fate.dominantAgents).toBe(2);
    expect(fate.dominantShare).toBe(1);
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

  it("adds bounded behavior genome traits for Phase 2.2", () => {
    const child = constrainGenome(
      testGenome({
        inertia: 99,
        riskTolerance: -10,
        pressureAversion: 99,
        terrainAffinity: -99,
        explorationBias: 99
      })
    );

    expect(child.inertia).toBeLessThanOrEqual(GENOME_BOUNDS.inertia.max);
    expect(child.riskTolerance).toBeGreaterThanOrEqual(GENOME_BOUNDS.riskTolerance.min);
    expect(child.pressureAversion).toBeLessThanOrEqual(GENOME_BOUNDS.pressureAversion.max);
    expect(child.terrainAffinity).toBeGreaterThanOrEqual(GENOME_BOUNDS.terrainAffinity.min);
    expect(child.explorationBias).toBeLessThanOrEqual(GENOME_BOUNDS.explorationBias.max);
  });

  it("tracks emergent species identifiers separately from lineages", () => {
    const sim = new Simulation({
      environmentMode: "flux",
      width: 24,
      height: 18,
      initialAgents: 0,
      seed: 20260604
    });
    const agent = sim.spawnAgent(
      5,
      5,
      testGenome({
        pressureAversion: GENOME_BOUNDS.pressureAversion.max,
        terrainAffinity: GENOME_BOUNDS.terrainAffinity.max,
        explorationBias: GENOME_BOUNDS.explorationBias.max
      }),
      80,
      6,
      7
    );

    expect(agent.speciesId).not.toBe(agent.lineageId);
    expect(sim.metrics().speciesFate.total).toBe(1);
    expect(sim.snapshot().species[0].speciesId).toBe(agent.speciesId);
  });

  it("recovers less death residue as resource in high-pressure cells", () => {
    const calm = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      resourceCap: 10,
      seed: 20260534
    });
    const stressed = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      resourceCap: 10,
      seed: 20260534
    });
    const genome = testGenome();
    calm.resources.fill(0);
    stressed.resources.fill(0);
    calm.pressure[calm.index(1, 1)] = 0;
    stressed.pressure[stressed.index(1, 1)] = 4;
    const calmAgent = calm.spawnAgent(1, 1, genome, 8);
    const stressedAgent = stressed.spawnAgent(1, 1, genome, 8);
    calm.recoverResidue(calmAgent, "starvation");
    stressed.recoverResidue(stressedAgent, "starvation");

    expect(calm.cellAt(1, 1).resource).toBeGreaterThan(stressed.cellAt(1, 1).resource);
  });

  it("records starvation deaths and returns residue to the environment", () => {
    const sim = new Simulation({
      environmentMode: "closed",
      width: 4,
      height: 4,
      initialAgents: 0,
      barrierThreshold: 1.01,
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
