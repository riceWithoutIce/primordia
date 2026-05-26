import { createDeathStats } from "../config/defaults";
import { mergeConfig } from "../config/schema";
import { createGenome, cloneGenome, constrainGenome, mutateGenome, roundSnapshotValue } from "../life/genome";
import { shouldUpdateSpecies, speciesForGenome } from "../life/species";
import { clamp, mulberry32 } from "../random/rng";
import {
  barrierFor,
  biomeCountsFor,
  emptyBiomeCounts,
  isBarrierAt,
  movementCostAt,
  resourceFertilityAt,
  resourceTerrainAt
} from "../world/terrain";
import { updateWorld, diffusePressure, updateEnvironmentFields } from "../world/update";
import { createWorld, environmentAt, worldIndex } from "../world/world";
import type {
  Agent,
  DeathReason,
  DeathStats,
  EnvironmentCell,
  EnvironmentEventRecord,
  ExperimentSnapshot,
  ExperimentSnapshotOptions,
  Genome,
  GenomeInput,
  GridPoint,
  Metrics,
  MoveVector,
  RandomSource,
  SimulationConfig,
  SimulationConfigPatch,
  SnapshotEnvironmentSummary,
  SnapshotLineageSummary,
  SnapshotSpeciesSummary,
  SnapshotWorldSummary,
  TerrainType,
  WorldState
} from "../types";

export const MOVE_CANDIDATES: readonly MoveVector[] = [
  { dx: 0, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 }
];

export class Simulation {
  config: SimulationConfig;
  random: RandomSource;
  width: number;
  height: number;
  size: number;
  world: WorldState;
  nextAgentId = 1;
  nextLineageId = 1;
  tickCount = 0;
  births = 0;
  deaths = 0;
  deathReasons: DeathStats = createDeathStats();
  eventCount = 0;
  lastEvent: EnvironmentEventRecord | null = null;
  knownLineages = new Set<number>();
  knownSpecies = new Set<number>();
  agents: Agent[] = [];

  constructor(config?: SimulationConfigPatch) {
    this.config = mergeConfig(config);
    this.random = mulberry32(this.config.seed);
    this.width = this.config.width;
    this.height = this.config.height;
    this.size = this.width * this.height;
    this.world = createWorld(this.config);
    this.reset();
  }

  get resources(): Float32Array {
    return this.world.fields.resource;
  }

  set resources(value: Float32Array) {
    this.world.fields.resource = value;
  }

  get traces(): Float32Array {
    return this.world.fields.trace;
  }

  set traces(value: Float32Array) {
    this.world.fields.trace = value;
  }

  get pressure(): Float32Array {
    return this.world.fields.pressure;
  }

  set pressure(value: Float32Array) {
    this.world.fields.pressure = value;
  }

  get moistureDelta(): Float32Array {
    return this.world.fields.moistureDelta;
  }

  reset(nextConfig?: SimulationConfigPatch): void {
    if (nextConfig) {
      this.config = mergeConfig(nextConfig);
    }

    this.random = mulberry32(this.config.seed);
    this.width = this.config.width;
    this.height = this.config.height;
    this.size = this.width * this.height;
    this.world = createWorld(this.config);
    this.nextAgentId = 1;
    this.nextLineageId = 1;
    this.tickCount = 0;
    this.births = 0;
    this.deaths = 0;
    this.deathReasons = createDeathStats();
    this.eventCount = 0;
    this.lastEvent = null;
    this.knownLineages = new Set<number>();
    this.knownSpecies = new Set<number>();
    this.agents = [];

    for (let a = 0; a < this.config.initialAgents; a += 1) {
      this.spawnAgent(
        Math.floor(this.random() * this.width),
        Math.floor(this.random() * this.height),
        createGenome(this.random),
        this.config.initialEnergy * (0.75 + this.random() * 0.6),
        0
      );
    }
  }

  index(x: number, y: number): number {
    return worldIndex(this.world, x, y);
  }

  cellAt(x: number, y: number): EnvironmentCell {
    return this.environmentAt(this.index(x, y));
  }

  environmentAt(index: number): EnvironmentCell {
    return environmentAt(this.world, index, this.config);
  }

  spawnAgent(x: number, y: number, genome: GenomeInput, energy: number, generation = 0, lineageId?: number): Agent {
    const resolvedLineageId = lineageId ?? this.nextLineageId++;
    this.nextLineageId = Math.max(this.nextLineageId, resolvedLineageId + 1);
    this.knownLineages.add(resolvedLineageId);
    const spawnPoint = this.nearestOpenPoint(x, y);
    const boundedGenome = constrainGenome(genome);
    const biome = this.cellAt(spawnPoint.x, spawnPoint.y).terrainType;
    const speciesId = speciesForGenome(boundedGenome, biome, resolvedLineageId, generation);
    this.knownSpecies.add(speciesId);

    const agent: Agent = {
      id: this.nextAgentId,
      lineageId: resolvedLineageId,
      speciesId,
      x: spawnPoint.x,
      y: spawnPoint.y,
      energy,
      age: 0,
      generation,
      genome: boundedGenome,
      lastAction: "born",
      lastMove: { dx: 0, dy: 0 },
      stuckTicks: 0,
      lastBiome: biome
    };
    this.nextAgentId += 1;
    this.agents.push(agent);
    this.births += 1;
    return agent;
  }

  nearestOpenPoint(x: number, y: number): GridPoint {
    const originX = (x + this.width) % this.width;
    const originY = (y + this.height) % this.height;
    if (!this.isBarrier(originX, originY)) {
      return { x: originX, y: originY };
    }

    const maxRadius = Math.max(this.width, this.height);
    for (let radius = 1; radius <= maxRadius; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) {
            continue;
          }
          const candidateX = (originX + dx + this.width) % this.width;
          const candidateY = (originY + dy + this.height) % this.height;
          if (!this.isBarrier(candidateX, candidateY)) {
            return { x: candidateX, y: candidateY };
          }
        }
      }
    }

    return { x: originX, y: originY };
  }

  isBarrier(x: number, y: number): boolean {
    const idx = this.index(x, y);
    return barrierFor(this.world.terrain.terrainType[idx], this.world.terrain.movementTerrain[idx], this.config);
  }

  step(iterations = 1): void {
    const count = iterations || 1;
    for (let i = 0; i < count; i += 1) {
      this.tick();
    }
  }

  tick(): void {
    this.tickCount += 1;
    const update = updateWorld(this.world, this.config, this.tickCount, this.random, (x, y) => this.nearestOpenPoint(x, y));
    if (update.event) {
      this.eventCount += 1;
      this.lastEvent = update.event;
    }

    const newborns: Agent[] = [];
    for (const agent of this.agents) {
      const child = this.liveAgent(agent);
      if (child) {
        newborns.push(child);
      }
    }

    for (const newborn of newborns) {
      this.agents.push(newborn);
      this.births += 1;
      this.knownSpecies.add(newborn.speciesId);
    }

    const survivors: Agent[] = [];
    for (const agent of this.agents) {
      if (agent.energy > 0) {
        survivors.push(agent);
      } else {
        this.handleAgentDeath(agent, agent.deathReason ?? "starvation");
      }
    }
    this.agents = survivors;

    if (this.agents.length > this.config.maxAgents) {
      this.agents.sort((a, b) => b.energy - a.energy);
      const removed = this.agents.splice(this.config.maxAgents);
      for (const agent of removed) {
        this.markDeath(agent, "overflow");
        this.handleAgentDeath(agent, "overflow");
      }
    }
  }

  updateEnvironment(): void {
    updateEnvironmentFields(this.world, this.config, this.random);
  }

  maybeTriggerEnvironmentalEvent(): void {
    const event = this.triggerEnvironmentalEvent();
    if (event) {
      this.eventCount += 1;
      this.lastEvent = event;
    }
  }

  triggerEnvironmentalEvent(): EnvironmentEventRecord | null {
    const tickBefore = this.tickCount;
    const result = updateWorld(this.world, { ...this.config, processInterval: 0 }, tickBefore, this.random, (x, y) =>
      this.nearestOpenPoint(x, y)
    );
    return result.event;
  }

  diffusePressure(): void {
    diffusePressure(this.world, this.config);
  }

  liveAgent(agent: Agent): Agent | null {
    agent.age += 1;

    if (!this.spendMetabolism(agent)) {
      return null;
    }

    const before = { x: agent.x, y: agent.y };
    const move = this.chooseMove(agent);
    this.moveAgent(agent, move);
    if (agent.x === before.x && agent.y === before.y && (move.dx !== 0 || move.dy !== 0)) {
      agent.stuckTicks += 1;
    } else if (move.dx !== 0 || move.dy !== 0) {
      agent.stuckTicks = 0;
    }

    const harvested = this.harvestAgent(agent);
    this.leaveTrace(agent, harvested);
    agent.lastAction = harvested > 0.2 ? "harvest" : "search";
    agent.lastBiome = this.cellAt(agent.x, agent.y).terrainType;
    if (shouldUpdateSpecies(agent, agent.lastBiome)) {
      agent.speciesId = speciesForGenome(agent.genome, agent.lastBiome, agent.lineageId, agent.generation);
      this.knownSpecies.add(agent.speciesId);
    }

    return this.tryReproduce(agent);
  }

  spendMetabolism(agent: Agent): boolean {
    const here = this.index(agent.x, agent.y);
    const energyBefore = agent.energy;
    const metabolismCost = agent.genome.metabolism;
    const pressureSensitivity = 0.045 + agent.genome.pressureAversion * 0.036 - agent.genome.riskTolerance * 0.025;
    const pressureCost = this.pressure[here] * Math.max(0.015, pressureSensitivity);
    const terrainCost = Math.max(0, this.world.terrain.movementCost[here] - 1) * 0.02 * (1 + Math.abs(agent.genome.terrainAffinity));

    agent.energy -= metabolismCost + pressureCost + terrainCost;
    if (agent.energy > 0) {
      return true;
    }

    const wouldSurviveWithoutPressure = energyBefore - metabolismCost - terrainCost > 0;
    this.markDeath(agent, wouldSurviveWithoutPressure && pressureCost > 0 ? "pressure" : "starvation");
    return false;
  }

  moveAgent(agent: Agent, move: MoveVector): void {
    const targetX = (agent.x + move.dx + this.width) % this.width;
    const targetY = (agent.y + move.dy + this.height) % this.height;
    if (this.isBarrier(targetX, targetY)) {
      agent.stuckTicks += 1;
      return;
    }

    agent.x = targetX;
    agent.y = targetY;
    agent.lastMove = move;
    const distance = Math.abs(move.dx) + Math.abs(move.dy);
    const terrainCost = this.world.terrain.movementCost[this.index(targetX, targetY)];
    agent.energy -= agent.genome.moveCost * distance * terrainCost;
  }

  harvestAgent(agent: Agent): number {
    const idx = this.index(agent.x, agent.y);
    const terrain = this.world.terrain.terrainType[idx];
    const terrainFactor = terrain === "ocean" ? 0.36 : terrain === "desert" ? 0.72 : terrain === "mountain" ? 0.62 : 1;
    const harvested = Math.min(this.resources[idx], agent.genome.harvestRate * terrainFactor);
    this.resources[idx] -= harvested;
    agent.energy += harvested;
    this.pressure[idx] = clamp(this.pressure[idx] + harvestPressure(agent.genome, harvested), 0, 4);
    return harvested;
  }

  leaveTrace(agent: Agent, harvested: number): void {
    const idx = this.index(agent.x, agent.y);
    this.traces[idx] = clamp(this.traces[idx] + 0.5 + harvested * 0.09, 0, 12);
    if (agent.energy <= 0) {
      this.markDeath(agent, "starvation");
    }
  }

  tryReproduce(agent: Agent): Agent | null {
    if (agent.energy > agent.genome.reproductionThreshold && this.agents.length < this.config.maxAgents) {
      return this.reproduce(agent);
    }

    return null;
  }

  markDeath(agent: Agent, reason: DeathReason): void {
    agent.lastAction = "death";
    agent.deathReason = reason;
  }

  handleAgentDeath(agent: Agent, reason: DeathReason): void {
    this.deaths += 1;
    this.deathReasons[reason] += 1;
    this.recoverResidue(agent, reason);
  }

  recoverResidue(agent: Agent, reason: DeathReason): void {
    const idx = this.index(agent.x, agent.y);
    const remainingEnergy = Math.max(0, agent.energy);
    const pressureLoad = clamp(this.pressure[idx] / 4, 0, 1);
    const fertility = this.world.terrain.fertilityBase[idx];
    const resourceResidue = remainingEnergy * 0.35 * (1 - pressureLoad * 0.45) * (0.55 + fertility * 0.65);
    const traceResidue = 1 + Math.min(agent.age * 0.02, 1.5);
    const pressureResidue = reason === "pressure" ? 0.8 : reason === "overflow" ? 0.45 : 0.25;

    this.resources[idx] = clamp(this.resources[idx] + resourceResidue, 0, this.config.resourceCap);
    this.traces[idx] = clamp(this.traces[idx] + traceResidue, 0, 12);
    this.pressure[idx] = clamp(this.pressure[idx] + pressureResidue, 0, 4);
  }

  chooseMove(agent: Agent): MoveVector {
    let best = MOVE_CANDIDATES[0];
    let bestScore = -Infinity;

    for (const move of MOVE_CANDIDATES) {
      const targetX = agent.x + move.dx;
      const targetY = agent.y + move.dy;
      if (this.isBarrier(targetX, targetY)) {
        continue;
      }
      const score =
        this.scoreArea(targetX, targetY, agent.genome) +
        this.inertiaScore(agent, move) +
        this.stuckRecoveryScore(agent, move) +
        this.random() * (0.12 + agent.genome.explorationBias * 0.55);
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    return best;
  }

  scoreArea(cx: number, cy: number, genome: Genome): number {
    let score = 0;
    const radius = genome.senseRadius;
    for (let y = -radius; y <= radius; y += 1) {
      for (let x = -radius; x <= radius; x += 1) {
        const distance = Math.abs(x) + Math.abs(y) + 1;
        const idx = this.index(cx + x, cy + y);
        if (this.isBarrier(cx + x, cy + y)) {
          score -= 12 / distance;
          continue;
        }
        const movement = this.world.terrain.movementCost[idx] - 1;
        const pressurePenalty = this.pressure[idx] * (0.18 + genome.pressureAversion * 0.22 - genome.riskTolerance * 0.1);
        score += (this.resources[idx] * genome.resourceAffinity) / distance;
        score += (this.traces[idx] * genome.traceAffinity) / distance;
        score -= pressurePenalty;
        score -= movement * (0.42 - genome.terrainAffinity * 0.16);
        score += this.world.fields.moistureDelta[idx] * 0.12;
      }
    }
    return score;
  }

  reproduce(parent: Agent): Agent {
    const share = this.config.reproductionShare;
    const allocatedEnergy = parent.energy * share;
    const childEnergy = allocatedEnergy * reproductionEfficiency(parent.genome);
    const reproductionWaste = allocatedEnergy - childEnergy;
    parent.energy *= 1 - share;

    const childGenome = mutateGenome(parent.genome, this.random);
    const offsetX = this.random() < 0.5 ? -1 : 1;
    const offsetY = this.random() < 0.5 ? -1 : 1;
    const idx = this.index(parent.x, parent.y);
    const point = this.nearestOpenPoint(parent.x + offsetX, parent.y + offsetY);
    const biome = this.cellAt(point.x, point.y).terrainType;
    const speciesId = speciesForGenome(childGenome, biome, parent.lineageId, parent.generation + 1);

    this.traces[idx] = clamp(this.traces[idx] + reproductionWaste * 0.02, 0, 12);
    this.pressure[idx] = clamp(this.pressure[idx] + reproductionWaste * 0.006, 0, 4);

    parent.lastAction = "divide";
    this.knownSpecies.add(speciesId);
    return {
      id: this.nextAgentId++,
      ...point,
      lineageId: parent.lineageId,
      speciesId,
      energy: childEnergy,
      age: 0,
      generation: parent.generation + 1,
      genome: childGenome,
      lastAction: "born",
      lastMove: { dx: 0, dy: 0 },
      stuckTicks: 0,
      lastBiome: biome
    };
  }

  snapshot(options: ExperimentSnapshotOptions = {}): ExperimentSnapshot {
    const metrics = this.metrics();
    return {
      kind: "primordia.experiment-snapshot",
      schemaVersion: 2,
      id: `seed-${this.config.seed}-tick-${this.tickCount}-agents-${this.agents.length}-events-${this.eventCount}-processes-${metrics.processCount}`,
      tick: this.tickCount,
      config: { ...this.config },
      metrics,
      world: this.snapshotWorld(metrics),
      lineages: this.snapshotLineages(),
      species: this.snapshotSpecies(),
      environment: this.snapshotEnvironment(options),
      agents: this.agents.map((agent) => ({
        id: agent.id,
        lineageId: agent.lineageId,
        speciesId: agent.speciesId,
        x: agent.x,
        y: agent.y,
        energy: roundSnapshotValue(agent.energy),
        age: agent.age,
        generation: agent.generation,
        lastAction: agent.lastAction,
        lastBiome: agent.lastBiome,
        genome: cloneGenome(agent.genome)
      }))
    };
  }

  snapshotLineages(): SnapshotLineageSummary[] {
    const lineages = new Map<
      number,
      {
        agents: number;
        totalEnergy: number;
        totalAge: number;
        maxGeneration: number;
      }
    >();

    for (const lineageId of this.knownLineages) {
      lineages.set(lineageId, {
        agents: 0,
        totalEnergy: 0,
        totalAge: 0,
        maxGeneration: 0
      });
    }

    for (const agent of this.agents) {
      const summary =
        lineages.get(agent.lineageId) ??
        {
          agents: 0,
          totalEnergy: 0,
          totalAge: 0,
          maxGeneration: 0
        };
      summary.agents += 1;
      summary.totalEnergy += agent.energy;
      summary.totalAge += agent.age;
      summary.maxGeneration = Math.max(summary.maxGeneration, agent.generation);
      lineages.set(agent.lineageId, summary);
    }

    return Array.from(lineages, ([lineageId, summary]) => ({
      lineageId,
      agents: summary.agents,
      maxGeneration: summary.maxGeneration,
      averageEnergy: summary.agents ? roundSnapshotValue(summary.totalEnergy / summary.agents) : 0,
      averageAge: summary.agents ? roundSnapshotValue(summary.totalAge / summary.agents) : 0
    })).sort((a, b) => a.lineageId - b.lineageId);
  }

  snapshotSpecies(): SnapshotSpeciesSummary[] {
    const species = new Map<
      number,
      {
        agents: number;
        totalEnergy: number;
        totalGeneration: number;
        biomeCounts: Record<TerrainType, number>;
      }
    >();

    for (const speciesId of this.knownSpecies) {
      species.set(speciesId, {
        agents: 0,
        totalEnergy: 0,
        totalGeneration: 0,
        biomeCounts: emptyBiomeCounts()
      });
    }

    for (const agent of this.agents) {
      const summary =
        species.get(agent.speciesId) ??
        {
          agents: 0,
          totalEnergy: 0,
          totalGeneration: 0,
          biomeCounts: emptyBiomeCounts()
        };
      summary.agents += 1;
      summary.totalEnergy += agent.energy;
      summary.totalGeneration += agent.generation;
      summary.biomeCounts[agent.lastBiome] += 1;
      species.set(agent.speciesId, summary);
    }

    return Array.from(species, ([speciesId, summary]) => ({
      speciesId,
      agents: summary.agents,
      dominantBiome: dominantBiome(summary.biomeCounts),
      averageEnergy: summary.agents ? roundSnapshotValue(summary.totalEnergy / summary.agents) : 0,
      averageGeneration: summary.agents ? roundSnapshotValue(summary.totalGeneration / summary.agents) : 0
    })).sort((a, b) => a.speciesId - b.speciesId);
  }

  snapshotEnvironment(options: ExperimentSnapshotOptions): SnapshotEnvironmentSummary {
    const requestedStride = options.environmentSampleStride ?? 12;
    const sampleStride = Math.max(1, Math.floor(requestedStride));
    const samples = [];
    let barrierCells = 0;
    let resourceHotspots = 0;
    let pressureHotspots = 0;
    let totalResource = 0;
    let totalTrace = 0;
    let totalPressure = 0;
    let totalMoistureDelta = 0;
    let totalFertility = 0;
    let totalMovementCost = 0;

    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const idx = this.index(x, y);
        const cell = this.environmentAt(idx);

        totalResource += cell.resource;
        totalTrace += cell.trace;
        totalPressure += cell.pressure;
        totalMoistureDelta += cell.moistureDelta;
        totalFertility += cell.fertility;
        totalMovementCost += cell.movementCost;
        if (cell.barrier) {
          barrierCells += 1;
        }
        if (this.config.resourceCap > 0 && cell.resource >= this.config.resourceCap * 0.75) {
          resourceHotspots += 1;
        }
        if (cell.pressure >= 2) {
          pressureHotspots += 1;
        }
        if (x % sampleStride === 0 && y % sampleStride === 0) {
          samples.push({
            x,
            y,
            resource: roundSnapshotValue(cell.resource),
            fertility: roundSnapshotValue(cell.fertility),
            movementCost: roundSnapshotValue(cell.movementCost),
            barrier: cell.barrier,
            trace: roundSnapshotValue(cell.trace),
            pressure: roundSnapshotValue(cell.pressure),
            moistureDelta: roundSnapshotValue(cell.moistureDelta),
            elevation: roundSnapshotValue(cell.elevation),
            moistureBase: roundSnapshotValue(cell.moistureBase),
            temperatureBase: roundSnapshotValue(cell.temperatureBase),
            terrainType: cell.terrainType
          });
        }
      }
    }

    return {
      sampleStride,
      sampledCells: samples.length,
      barrierCells,
      resourceHotspots,
      pressureHotspots,
      averageResource: roundSnapshotValue(totalResource / this.size),
      averageTrace: roundSnapshotValue(totalTrace / this.size),
      averagePressure: roundSnapshotValue(totalPressure / this.size),
      averageMoistureDelta: roundSnapshotValue(totalMoistureDelta / this.size),
      averageFertility: roundSnapshotValue(totalFertility / this.size),
      averageMovementCost: roundSnapshotValue(totalMovementCost / this.size),
      samples
    };
  }

  snapshotWorld(metrics = this.metrics()): SnapshotWorldSummary {
    let totalElevation = 0;
    let totalMoisture = 0;
    let totalTemperature = 0;
    let totalFertility = 0;
    for (let i = 0; i < this.size; i += 1) {
      totalElevation += this.world.terrain.elevation[i];
      totalMoisture += this.world.terrain.moistureBase[i];
      totalTemperature += this.world.terrain.temperatureBase[i];
      totalFertility += this.world.terrain.fertilityBase[i];
    }
    return {
      width: this.width,
      height: this.height,
      biomeCounts: metrics.biomeCounts,
      averageElevation: roundSnapshotValue(totalElevation / this.size),
      averageMoistureBase: roundSnapshotValue(totalMoisture / this.size),
      averageTemperatureBase: roundSnapshotValue(totalTemperature / this.size),
      averageFertilityBase: roundSnapshotValue(totalFertility / this.size),
      activeProcesses: this.world.processes.length,
      processCount: this.world.processHistory.length + this.world.processes.length,
      lastProcess: this.latestProcess()
    };
  }

  metrics(): Metrics {
    let totalEnergy = 0;
    let maxGeneration = 0;
    const lineageAgents = new Map<number, number>();
    const speciesAgents = new Map<number, number>();
    for (const agent of this.agents) {
      totalEnergy += agent.energy;
      maxGeneration = Math.max(maxGeneration, agent.generation);
      lineageAgents.set(agent.lineageId, (lineageAgents.get(agent.lineageId) ?? 0) + 1);
      speciesAgents.set(agent.speciesId, (speciesAgents.get(agent.speciesId) ?? 0) + 1);
    }
    const livingLineages = lineageAgents.size;
    const livingSpecies = speciesAgents.size;
    const lineageDominant = dominantIdAndCount(lineageAgents);
    const speciesDominant = dominantIdAndCount(speciesAgents);
    const totalLineages = this.knownLineages.size;
    const totalSpecies = this.knownSpecies.size;

    let totalResource = 0;
    let totalTrace = 0;
    let totalPressure = 0;
    let totalMoisture = 0;
    for (let i = 0; i < this.size; i += 1) {
      totalResource += this.resources[i];
      totalTrace += this.traces[i];
      totalPressure += this.pressure[i];
      totalMoisture += this.world.fields.moistureDelta[i];
    }

    const processCount = this.world.processHistory.length + this.world.processes.length;
    return {
      tick: this.tickCount,
      seed: this.config.seed,
      agents: this.agents.length,
      births: this.births,
      deaths: this.deaths,
      averageEnergy: this.agents.length ? totalEnergy / this.agents.length : 0,
      maxGeneration,
      lineageCount: livingLineages,
      lineageFate: {
        total: totalLineages,
        living: livingLineages,
        extinct: Math.max(0, totalLineages - livingLineages),
        dominantId: lineageDominant.id,
        dominantAgents: lineageDominant.count,
        dominantShare: this.agents.length ? lineageDominant.count / this.agents.length : 0
      },
      speciesCount: livingSpecies,
      speciesFate: {
        total: totalSpecies,
        living: livingSpecies,
        dominantId: speciesDominant.id,
        dominantAgents: speciesDominant.count,
        dominantShare: this.agents.length ? speciesDominant.count / this.agents.length : 0
      },
      deathReasons: { ...this.deathReasons },
      totalResource,
      totalTrace,
      totalPressure,
      totalMoisture,
      eventCount: this.eventCount,
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null,
      activeProcesses: this.world.processes.length,
      processCount,
      lastProcess: this.latestProcess(),
      biomeCounts: biomeCountsFor(this.world.terrain)
    };
  }

  private latestProcess() {
    const active = this.world.processes[this.world.processes.length - 1];
    if (active) {
      return { ...active };
    }
    const historical = this.world.processHistory[this.world.processHistory.length - 1];
    return historical ? { ...historical } : null;
  }

  private inertiaScore(agent: Agent, move: MoveVector): number {
    if (move.dx === 0 && move.dy === 0) {
      return agent.stuckTicks > 1 ? -0.9 : 0;
    }
    if (agent.lastMove.dx === move.dx && agent.lastMove.dy === move.dy) {
      return agent.genome.inertia * 0.8;
    }
    if (agent.lastMove.dx === -move.dx && agent.lastMove.dy === -move.dy) {
      return -agent.genome.inertia * 0.35;
    }
    return 0;
  }

  private stuckRecoveryScore(agent: Agent, move: MoveVector): number {
    if (agent.stuckTicks <= 1) {
      return 0;
    }
    if (move.dx === 0 && move.dy === 0) {
      return -agent.stuckTicks * 0.55;
    }
    const target = this.index(agent.x + move.dx, agent.y + move.dy);
    const pressureRelief = Math.max(0, this.pressure[this.index(agent.x, agent.y)] - this.pressure[target]);
    return agent.stuckTicks * 0.22 + pressureRelief * 0.18;
  }
}

export function harvestPressure(genome: Genome, harvested: number): number {
  const harvestLoad = Math.max(0, genome.harvestRate - 1.4);
  return harvested * (0.01 + harvestLoad * 0.008);
}

export function reproductionEfficiency(genome: Genome): number {
  const thresholdPosition = (genome.reproductionThreshold - 46) / (170 - 46);
  const behaviorDrag = genome.explorationBias * 0.025 + genome.riskTolerance * 0.02;
  return clamp(0.72 + thresholdPosition * 0.22 - behaviorDrag, 0.68, 0.94);
}

export function dominantBiome(counts: Record<TerrainType, number>): TerrainType | null {
  let best: TerrainType | null = null;
  let count = 0;
  for (const [biome, value] of Object.entries(counts) as Array<[TerrainType, number]>) {
    if (value > count) {
      best = biome;
      count = value;
    }
  }
  return best;
}

function dominantIdAndCount(map: Map<number, number>): { id: number | null; count: number } {
  let id: number | null = null;
  let count = 0;
  for (const [candidateId, candidateCount] of map) {
    if (candidateCount > count) {
      id = candidateId;
      count = candidateCount;
    }
  }
  return { id, count };
}

export {
  isBarrierAt,
  movementCostAt,
  resourceFertilityAt,
  resourceTerrainAt
};
