import { createDeathStats } from "../config/defaults";
import { mergeConfig } from "../config/schema";
import { createGenome, cloneGenome, constrainGenome, mutateGenome, roundSnapshotValue } from "../life/genome";
import {
  auditOrganOutcome,
  createOrganCost,
  isOrganCapabilityId,
  refuseOrganAction,
  type OrganActionCost,
  type OrganActionOutcome,
  type OrganActionRequest,
  type OrganAuditRecord,
  type OrganRefusalReason
} from "../life/organs";
import { shouldUpdateSpecies, speciesForGenome } from "../life/species";
import { measureCoreProfile, type CoreProfileSink } from "../profile";
import { clamp, mulberry32 } from "../random/rng";
import {
  CHUNK_DIRTY,
  chunkIdForIndex,
  recordAgentChunk,
  refreshDirtyRegionSummaries,
  resetChunkAgentCounts,
  touchCell,
  touchCellFieldWrite
} from "../world/chunks";
import {
  barrierFor,
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
  AgentIntention,
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
  TickReport,
  SnapshotChunkSummary,
  SnapshotEnvironmentSummary,
  SnapshotLineageSummary,
  SnapshotOrganSummary,
  SnapshotRegionSummary,
  SnapshotSchedulerSummary,
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
  organBudgetRemaining = 0;
  organAttempts = 0;
  organAccepted = 0;
  organRefused = 0;
  organBudgetSpent = 0;
  organRefusalReasons = new Map<OrganRefusalReason, number>();
  organAudit: OrganAuditRecord[] = [];
  agents: Agent[] = [];
  profileSink: CoreProfileSink | null = null;

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
    this.world.fields.nextPressure = new Float32Array(value.length);
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
    this.organBudgetRemaining = this.config.organBudgetPerTick;
    this.organAttempts = 0;
    this.organAccepted = 0;
    this.organRefused = 0;
    this.organBudgetSpent = 0;
    this.organRefusalReasons = new Map<OrganRefusalReason, number>();
    this.organAudit = [];
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
    this.refreshAgentChunkCounts();
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
      intention: "forage",
      nextDecisionTick: this.tickCount,
      lastAction: "born",
      lastMove: { dx: 0, dy: 0 },
      stuckTicks: 0,
      lastBiome: biome
    };
    this.nextAgentId += 1;
    this.agents.push(agent);
    this.births += 1;
    recordAgentChunk(this.world.chunks, this.width, this.height, agent.x, agent.y, this.tickCount);
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
    measureCoreProfile(this.profileSink, "core.tick.total", () => {
      this.tickCount += 1;
      this.organBudgetRemaining = this.config.organBudgetPerTick;
      const update = measureCoreProfile(this.profileSink, "core.tick.updateWorld", () =>
        updateWorld(this.world, this.config, this.tickCount, this.random, (x, y) => this.nearestOpenPoint(x, y), this.profileSink)
      );
      if (update.event) {
        this.eventCount += 1;
        this.lastEvent = update.event;
      }

      const newborns: Agent[] = [];
      let processedAgents = 0;
      measureCoreProfile(this.profileSink, "core.tick.agents", () => {
        for (const agent of this.agents) {
          processedAgents += 1;
          const child = this.liveAgent(agent);
          if (child) {
            newborns.push(child);
          }
        }
      });

      measureCoreProfile(this.profileSink, "core.tick.births", () => {
        for (const newborn of newborns) {
          this.agents.push(newborn);
          this.births += 1;
          this.knownSpecies.add(newborn.speciesId);
        }
      });

      const survivors: Agent[] = [];
      measureCoreProfile(this.profileSink, "core.tick.survivors", () => {
        for (const agent of this.agents) {
          if (agent.energy > 0) {
            survivors.push(agent);
          } else {
            this.handleAgentDeath(agent, agent.deathReason ?? "starvation");
          }
        }
        this.agents = survivors;
      });

      measureCoreProfile(this.profileSink, "core.tick.overflow", () => {
        if (this.agents.length > this.config.maxAgents) {
          this.agents.sort((a, b) => b.energy - a.energy);
          const removed = this.agents.splice(this.config.maxAgents);
          for (const agent of removed) {
            this.markDeath(agent, "overflow");
            this.handleAgentDeath(agent, "overflow");
          }
        }
      });

      measureCoreProfile(this.profileSink, "core.tick.refreshAgentChunks", () => {
        this.refreshAgentChunkCounts();
      });
      this.recordAgentLane(update.tickReport, processedAgents);
    });
  }

  private recordAgentLane(tickReport: TickReport, processedAgents: number): void {
    tickReport.lanes.agent = processedAgents;
    const latestReport = this.world.chunks.schedulerStats.lastTickReport;
    if (latestReport && latestReport.tick === tickReport.tick) {
      latestReport.lanes.agent = processedAgents;
    }
  }

  attemptOrganAction(request: OrganActionRequest): OrganActionOutcome {
    const outcome = this.resolveOrganAction(request);
    this.recordOrganOutcome(outcome);
    return outcome;
  }

  private resolveOrganAction(request: OrganActionRequest): OrganActionOutcome {
    if (!isOrganCapabilityId(request.capabilityId)) {
      return refuseOrganAction("unknown-capability", request);
    }

    const agent = this.agents.find((candidate) => candidate.id === request.agentId);
    if (!agent || agent.energy <= 0) {
      return refuseOrganAction("inactive-agent", request);
    }

    if (request.cost.organBudget > this.organBudgetRemaining) {
      return refuseOrganAction("insufficient-budget", request);
    }

    if (request.cost.energy > agent.energy) {
      return refuseOrganAction("insufficient-budget", request);
    }

    const effectiveCost = effectiveOrganActionCost(agent.genome, request.cost);
    if (effectiveCost.energy > agent.energy) {
      return refuseOrganAction("insufficient-budget", request);
    }

    const targetCheck = this.validateOrganTarget(agent, request);
    if (targetCheck) {
      return refuseOrganAction(targetCheck, request);
    }

    return {
      accepted: true,
      capabilityId: request.capabilityId,
      agentId: request.agentId,
      intent: request.intent,
      target: request.target,
      cost: effectiveCost
    };
  }

  private validateOrganTarget(agent: Agent, request: OrganActionRequest): OrganRefusalReason | null {
    const { target } = request;
    if (target.kind === "agent") {
      return this.agents.some((candidate) => candidate.id === target.agentId) ? null : "invalid-target";
    }

    const radius = Math.max(0, Math.floor(target.radius));
    if (radius !== target.radius || radius > agent.genome.senseRadius + 1) {
      return "out-of-range";
    }

    const dx = Math.abs(target.point.x - agent.x);
    const dy = Math.abs(target.point.y - agent.y);
    const wrappedDx = Math.min(dx, this.width - dx);
    const wrappedDy = Math.min(dy, this.height - dy);
    if (wrappedDx + wrappedDy > agent.genome.senseRadius + radius + 1) {
      return "out-of-range";
    }

    if (this.isBarrier(target.point.x, target.point.y)) {
      return "blocked-terrain";
    }

    return null;
  }

  private recordOrganOutcome(outcome: OrganActionOutcome): void {
    this.organAttempts += 1;
    if (outcome.accepted) {
      const agent = this.agents.find((candidate) => candidate.id === outcome.agentId);
      if (agent) {
        agent.energy -= outcome.cost.energy;
        this.applyOrganEffect(outcome, agent);
      }
      this.organAccepted += 1;
      this.organBudgetRemaining -= outcome.cost.organBudget;
      this.organBudgetSpent += outcome.cost.organBudget;
    } else {
      this.organRefused += 1;
      this.organRefusalReasons.set(outcome.refusalReason, (this.organRefusalReasons.get(outcome.refusalReason) ?? 0) + 1);
    }

    this.organAudit.push(auditOrganOutcome(this.tickCount, outcome));
    const limit = Math.max(0, Math.floor(this.config.organAuditLimit));
    if (this.organAudit.length > limit) {
      this.organAudit.splice(0, this.organAudit.length - limit);
    }
  }


  private applyOrganEffect(outcome: Extract<OrganActionOutcome, { accepted: true }>, agent: Agent): void {
    if (outcome.capabilityId !== "trace-mark" || outcome.intent !== "mark-trace" || outcome.target.kind !== "cell") {
      return;
    }

    const idx = this.index(outcome.target.point.x, outcome.target.point.y);
    const radius = Math.max(0, Math.floor(outcome.target.radius));
    const traceAmount = clamp((0.35 + outcome.cost.trace + radius * 0.12) * organTracePotency(agent.genome), 0, 2.8);
    const pressureAmount = clamp(0.05 + outcome.cost.pressure + radius * 0.03, 0, 0.4);
    this.traces[idx] = clamp(this.traces[idx] + traceAmount, 0, 12);
    this.pressure[idx] = clamp(this.pressure[idx] + pressureAmount, 0, 4);
    touchCellFieldWrite(this.world.chunks, idx, this.tickCount, CHUNK_DIRTY.trace | CHUNK_DIRTY.pressure);
  }

  updateEnvironment(): void {
    updateEnvironmentFields(this.world, this.config, this.tickCount, this.random);
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

    const alive = this.spendMetabolism(agent);
    if (!alive) {
      return null;
    }

    const before = { x: agent.x, y: agent.y };
    this.updateAgentIntention(agent);
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
    const from = this.index(agent.x, agent.y);
    const targetX = (agent.x + move.dx + this.width) % this.width;
    const targetY = (agent.y + move.dy + this.height) % this.height;
    if (this.isBarrier(targetX, targetY)) {
      agent.stuckTicks += 1;
      touchCell(this.world.chunks, from, this.tickCount, CHUNK_DIRTY.agents);
      return;
    }

    agent.x = targetX;
    agent.y = targetY;
    agent.lastMove = move;
    const distance = Math.abs(move.dx) + Math.abs(move.dy);
    const terrainCost = this.world.terrain.movementCost[this.index(targetX, targetY)];
    agent.energy -= agent.genome.moveCost * distance * terrainCost;
    touchCell(this.world.chunks, from, this.tickCount, CHUNK_DIRTY.agents);
    touchCell(this.world.chunks, this.index(targetX, targetY), this.tickCount, CHUNK_DIRTY.agents);
  }

  harvestAgent(agent: Agent): number {
    const idx = this.index(agent.x, agent.y);
    const terrain = this.world.terrain.terrainType[idx];
    const terrainFactor = terrain === "ocean" ? 0.36 : terrain === "desert" ? 0.72 : terrain === "mountain" ? 0.62 : 1;
    const harvested = Math.min(this.resources[idx], agent.genome.harvestRate * terrainFactor);
    this.resources[idx] -= harvested;
    agent.energy += harvested;
    const pressureDelta = harvestPressure(agent.genome, harvested);
    if (pressureDelta > 0) {
      this.pressure[idx] = clamp(this.pressure[idx] + pressureDelta, 0, 4);
    }
    touchCellFieldWrite(
      this.world.chunks,
      idx,
      this.tickCount,
      pressureDelta > 0 ? CHUNK_DIRTY.resource | CHUNK_DIRTY.pressure : CHUNK_DIRTY.resource
    );
    return harvested;
  }

  leaveTrace(agent: Agent, harvested: number): void {
    const idx = this.index(agent.x, agent.y);
    this.traces[idx] = clamp(this.traces[idx] + 0.5 + harvested * 0.09, 0, 12);
    touchCellFieldWrite(this.world.chunks, idx, this.tickCount, CHUNK_DIRTY.trace);
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
    touchCellFieldWrite(this.world.chunks, idx, this.tickCount, CHUNK_DIRTY.resource | CHUNK_DIRTY.trace | CHUNK_DIRTY.pressure);
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
        this.scoreArea(targetX, targetY, agent.genome, agent.intention) +
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

  scoreArea(cx: number, cy: number, genome: Genome, intention: AgentIntention = "forage"): number {
    let score = 0;
    const radius = genome.senseRadius;
    const resourceWeight = intention === "forage" ? 1.35 : intention === "escape-pressure" ? 0.82 : 1;
    const traceWeight = intention === "follow-trace" ? 1.55 : 1;
    const pressureWeight = intention === "escape-pressure" ? 1.55 : intention === "migrate" ? 0.86 : 1;
    const terrainWeight = intention === "migrate" || intention === "explore-edge" ? 0.68 : 1;
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
        score += (this.resources[idx] * genome.resourceAffinity * resourceWeight) / distance;
        score += (this.traces[idx] * genome.traceAffinity * traceWeight) / distance;
        score -= pressurePenalty * pressureWeight;
        score -= movement * terrainWeight * (0.42 - genome.terrainAffinity * 0.16);
        score += this.world.fields.moistureDelta[idx] * 0.12;
      }
    }
    const centerIdx = this.index(cx, cy);
    const chunk = this.world.chunks.chunks[chunkIdForIndex(this.world.chunks, centerIdx)];
    const chunkCells = Math.max(1, chunk.width * chunk.height);
    const region = this.world.regions.regions[chunk.regionId];
    score += (chunk.summary.resource / chunkCells) * genome.resourceAffinity * 0.08;
    score -= (chunk.summary.pressure / chunkCells) * (0.05 + genome.pressureAversion * 0.04);
    if (region) {
      score += region.averageFertility * (intention === "migrate" ? 0.28 : 0.12);
      score -= region.barrierRatio * (intention === "migrate" ? 0.5 : 0.22);
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
    touchCellFieldWrite(this.world.chunks, idx, this.tickCount, CHUNK_DIRTY.trace | CHUNK_DIRTY.pressure);
    touchCell(this.world.chunks, idx, this.tickCount, CHUNK_DIRTY.agents);

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
      intention: "forage",
      nextDecisionTick: this.tickCount + Math.max(1, Math.floor(this.config.agentDecisionInterval)),
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
      schemaVersion: 3,
      id: `seed-${this.config.seed}-tick-${this.tickCount}-agents-${this.agents.length}-events-${this.eventCount}-processes-${metrics.processCount}`,
      tick: this.tickCount,
      config: { ...this.config },
      metrics,
      world: this.snapshotWorld(metrics),
      scheduler: this.snapshotScheduler(),
      chunks: this.snapshotChunks(options),
      regions: this.snapshotRegions(),
      lineages: this.snapshotLineages(),
      species: this.snapshotSpecies(),
      organs: this.snapshotOrgans(),
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
        intention: agent.intention,
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
    let resourceHotspots = 0;
    let pressureHotspots = 0;

    for (const chunk of this.world.chunks.chunks) {
      const cells = Math.max(1, chunk.width * chunk.height);
      if (this.config.resourceCap > 0 && chunk.summary.resource / cells >= this.config.resourceCap * 0.75) {
        resourceHotspots += cells;
      }
      if (chunk.summary.pressure / cells >= 2) {
        pressureHotspots += cells;
      }
    }

    for (let y = 0; y < this.height; y += sampleStride) {
      for (let x = 0; x < this.width; x += sampleStride) {
        const idx = this.index(x, y);
        const cell = this.environmentAt(idx);
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

    const totals = this.environmentTotalsFromChunks();
    return {
      sampleStride,
      sampledCells: samples.length,
      barrierCells: totals.barrierCells,
      resourceHotspots,
      pressureHotspots,
      averageResource: roundSnapshotValue(totals.totalResource / this.size),
      averageTrace: roundSnapshotValue(totals.totalTrace / this.size),
      averagePressure: roundSnapshotValue(totals.totalPressure / this.size),
      averageMoistureDelta: roundSnapshotValue(totals.totalMoisture / this.size),
      averageFertility: roundSnapshotValue(totals.totalFertility / this.size),
      averageMovementCost: roundSnapshotValue(totals.totalMovementCost / this.size),
      samples
    };
  }

  snapshotScheduler(): SnapshotSchedulerSummary {
    return {
      ...this.world.chunks.schedulerStats,
      chunkSize: this.world.chunks.chunkSize,
      columns: this.world.chunks.columns,
      rows: this.world.chunks.rows
    };
  }

  snapshotChunks(options: ExperimentSnapshotOptions = {}): SnapshotChunkSummary[] {
    return this.world.chunks.chunks
      .filter((chunk) => options.includeAllChunks || chunk.activity !== "sleeping" || chunk.dirtyMask || chunk.agentCount > 0)
      .map((chunk) => {
        const cells = Math.max(1, chunk.width * chunk.height);
        const summary = chunk.summary;
        return {
          id: chunk.id,
          regionId: chunk.regionId,
          x: chunk.x,
          y: chunk.y,
          activity: chunk.activity,
          dirtyMask: chunk.dirtyMask,
          agentCount: chunk.agentCount,
          averageResource: roundSnapshotValue(summary.resource / cells),
          averageTrace: roundSnapshotValue(summary.trace / cells),
          averagePressure: roundSnapshotValue(summary.pressure / cells),
          averageMoistureDelta: roundSnapshotValue(summary.moistureDelta / cells),
          averageFertility: roundSnapshotValue(summary.averageFertility),
          averageMovementCost: roundSnapshotValue(summary.averageMovementCost),
          barrierRatio: roundSnapshotValue(summary.barrierRatio),
          dominantBiome: summary.dominantBiome
        };
      });
  }

  snapshotRegions(): SnapshotRegionSummary[] {
    return this.world.regions.regions.map((region) => {
      const cells = Math.max(1, region.chunkIds.reduce((total, chunkId) => {
        const chunk = this.world.chunks.chunks[chunkId];
        return total + chunk.width * chunk.height;
      }, 0));
      return {
        id: region.id,
        x: region.x,
        y: region.y,
        chunks: region.chunkIds.length,
        neighbors: [...region.neighborIds],
        corridorHints: [...region.corridorHints],
        dominantBiome: region.dominantBiome,
        averageFertility: roundSnapshotValue(region.averageFertility),
        averageMovementCost: roundSnapshotValue(region.averageMovementCost),
        barrierRatio: roundSnapshotValue(region.barrierRatio),
        averageResource: roundSnapshotValue(region.resource / cells),
        averagePressure: roundSnapshotValue(region.pressure / cells),
        averageTrace: roundSnapshotValue(region.trace / cells),
        agentCount: region.agentCount
      };
    });
  }

  snapshotWorld(metrics = this.metrics()): SnapshotWorldSummary {
    const totals = this.terrainTotals();
    return {
      width: this.width,
      height: this.height,
      biomeCounts: metrics.biomeCounts,
      averageElevation: roundSnapshotValue(totals.elevation / this.size),
      averageMoistureBase: roundSnapshotValue(totals.moisture / this.size),
      averageTemperatureBase: roundSnapshotValue(totals.temperature / this.size),
      averageFertilityBase: roundSnapshotValue(totals.fertility / this.size),
      activeProcesses: this.world.processes.length,
      processCount: this.world.processHistory.length + this.world.processes.length,
      lastProcess: this.latestProcess()
    };
  }

  snapshotOrgans(): SnapshotOrganSummary {
    return {
      attempts: this.organAttempts,
      accepted: this.organAccepted,
      refused: this.organRefused,
      budgetSpent: roundSnapshotValue(this.organBudgetSpent),
      budgetRemaining: roundSnapshotValue(this.organBudgetRemaining),
      dominantRefusalReason: dominantRefusalReason(this.organRefusalReasons),
      recentAudit: this.organAudit.map((record) => ({ ...record }))
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

    const totals = this.environmentTotalsFromChunks();

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
      totalResource: totals.totalResource,
      totalTrace: totals.totalTrace,
      totalPressure: totals.totalPressure,
      totalMoisture: totals.totalMoisture,
      eventCount: this.eventCount,
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null,
      activeProcesses: this.world.processes.length,
      processCount,
      lastProcess: this.latestProcess(),
      biomeCounts: this.world.terrainTotals.biomeCounts,
      organAttempts: this.organAttempts,
      organAccepted: this.organAccepted,
      organRefused: this.organRefused,
      organBudgetSpent: this.organBudgetSpent,
      organDominantRefusalReason: dominantRefusalReason(this.organRefusalReasons),
      chunkCount: this.world.chunks.chunks.length,
      activeChunks: this.world.chunks.schedulerStats.activeChunks,
      warmChunks: this.world.chunks.schedulerStats.warmChunks,
      sleepingChunks: this.world.chunks.schedulerStats.sleepingChunks,
      dirtyChunks: this.world.chunks.schedulerStats.dirtyChunks,
      updatedChunks: this.world.chunks.schedulerStats.updatedChunks,
      updatedCells: this.world.chunks.schedulerStats.updatedCells,
      regionCount: this.world.regions.regions.length
    };
  }

  private updateAgentIntention(agent: Agent): void {
    if (this.tickCount < agent.nextDecisionTick) {
      return;
    }

    const idx = this.index(agent.x, agent.y);
    const pressure = this.pressure[idx];
    const resource = this.resources[idx];
    const trace = this.traces[idx];
    if (pressure > 1.35 + agent.genome.riskTolerance * 0.35) {
      agent.intention = "escape-pressure";
    } else if (agent.stuckTicks > 2) {
      agent.intention = "explore-edge";
    } else if (trace * Math.max(0, agent.genome.traceAffinity) > resource * 0.55) {
      agent.intention = "follow-trace";
    } else if (agent.energy > agent.genome.reproductionThreshold * 0.82) {
      agent.intention = "migrate";
    } else {
      agent.intention = "forage";
    }
    agent.nextDecisionTick = this.tickCount + Math.max(1, Math.floor(this.config.agentDecisionInterval));
  }

  private refreshAgentChunkCounts(): void {
    resetChunkAgentCounts(this.world.chunks);
    for (const agent of this.agents) {
      if (agent.energy > 0) {
        recordAgentChunk(this.world.chunks, this.width, this.height, agent.x, agent.y, this.tickCount);
      }
    }
    refreshDirtyRegionSummaries(this.world.regions, this.world.chunks, this.world.terrain, this.world.fields, this.width);
  }

  private environmentTotalsFromChunks(): {
    totalResource: number;
    totalTrace: number;
    totalPressure: number;
    totalMoisture: number;
    totalFertility: number;
    totalMovementCost: number;
    barrierCells: number;
  } {
    if (this.size <= 65536) {
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
      return {
        totalResource,
        totalTrace,
        totalPressure,
        totalMoisture,
        totalFertility: this.world.terrainTotals.fertility,
        totalMovementCost: this.world.terrainTotals.movementCost,
        barrierCells: this.world.terrainTotals.barrierCells
      };
    }

    let totalResource = 0;
    let totalTrace = 0;
    let totalPressure = 0;
    let totalMoisture = 0;
    for (const chunk of this.world.chunks.chunks) {
      totalResource += chunk.summary.resource;
      totalTrace += chunk.summary.trace;
      totalPressure += chunk.summary.pressure;
      totalMoisture += chunk.summary.moistureDelta;
    }
    return {
      totalResource,
      totalTrace,
      totalPressure,
      totalMoisture,
      totalFertility: this.world.terrainTotals.fertility,
      totalMovementCost: this.world.terrainTotals.movementCost,
      barrierCells: this.world.terrainTotals.barrierCells
    };
  }

  private terrainTotals(): WorldState["terrainTotals"] {
    return this.world.terrainTotals;
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
  const organDrag = genome.organAffinity * 0.03 + genome.organStability * 0.014;
  return clamp(0.72 + thresholdPosition * 0.22 - behaviorDrag - organDrag, 0.66, 0.94);
}

export function effectiveOrganActionCost(genome: Genome, cost: OrganActionCost): OrganActionCost {
  const affinityLoad = genome.organAffinity * (1 - genome.organStability * 0.45);
  return createOrganCost({
    energy: cost.energy + cost.energy * affinityLoad * 0.18 + cost.organBudget * affinityLoad * 0.05,
    organBudget: cost.organBudget,
    pressure: cost.pressure + cost.organBudget * genome.organAffinity * (0.04 - genome.organStability * 0.02),
    trace: cost.trace
  });
}

export function organTracePotency(genome: Genome): number {
  return 1 + genome.organAffinity * (0.55 + genome.organStability * 0.22);
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

function dominantRefusalReason(map: Map<OrganRefusalReason, number>): OrganRefusalReason | null {
  let reason: OrganRefusalReason | null = null;
  let count = 0;
  for (const [candidateReason, candidateCount] of map) {
    if (candidateCount > count) {
      reason = candidateReason;
      count = candidateCount;
    }
  }
  return reason;
}

export {
  isBarrierAt,
  movementCostAt,
  resourceFertilityAt,
  resourceTerrainAt
};
