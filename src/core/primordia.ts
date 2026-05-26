export type RandomSource = () => number;

export type AgentAction = "born" | "death" | "harvest" | "search" | "divide";

export type DeathReason = "starvation" | "pressure" | "overflow";

export type EnvironmentMode = "closed" | "flux";

export type EnvironmentEventKind = "bloom" | "pressure";

export interface GridPoint {
  x: number;
  y: number;
}

export interface MoveVector {
  dx: number;
  dy: number;
}

export interface SimulationConfig {
  environmentMode: EnvironmentMode;
  width: number;
  height: number;
  initialAgents: number;
  maxAgents: number;
  initialEnergy: number;
  resourceGrowth: number;
  resourceCap: number;
  eventInterval: number;
  eventRadius: number;
  eventIntensity: number;
  barrierThreshold: number;
  terrainCostScale: number;
  traceDecay: number;
  pressureDecay: number;
  pressureDiffusion: number;
  pressureGrowth: number;
  reproductionShare: number;
  seed: number;
}

export type SimulationConfigPatch = Partial<SimulationConfig>;

export interface Genome {
  senseRadius: number;
  metabolism: number;
  moveCost: number;
  harvestRate: number;
  traceAffinity: number;
  resourceAffinity: number;
  reproductionThreshold: number;
  mutationRate: number;
}

export interface GenomeRange {
  min: number;
  max: number;
}

export interface EnvironmentCell {
  resource: number;
  fertility: number;
  movementCost: number;
  barrier: boolean;
  trace: number;
  pressure: number;
}

export interface EnvironmentEventRecord extends GridPoint {
  tick: number;
  kind: EnvironmentEventKind;
  radius: number;
  intensity: number;
  affectedCells: number;
}

export interface Agent extends GridPoint {
  id: number;
  lineageId: number;
  energy: number;
  age: number;
  generation: number;
  genome: Genome;
  lastAction: AgentAction;
  deathReason?: DeathReason;
}

export interface DeathStats {
  starvation: number;
  pressure: number;
  overflow: number;
}

export interface LineageFateMetrics {
  total: number;
  living: number;
  extinct: number;
  dominantId: number | null;
  dominantAgents: number;
  dominantShare: number;
}

export interface Metrics {
  tick: number;
  seed: number;
  agents: number;
  births: number;
  deaths: number;
  averageEnergy: number;
  maxGeneration: number;
  lineageCount: number;
  lineageFate: LineageFateMetrics;
  deathReasons: DeathStats;
  totalResource: number;
  totalTrace: number;
  totalPressure: number;
  eventCount: number;
  lastEvent: EnvironmentEventRecord | null;
}

export const DEFAULTS: SimulationConfig = {
  environmentMode: "flux",
  width: 96,
  height: 64,
  initialAgents: 36,
  maxAgents: 220,
  initialEnergy: 42,
  resourceGrowth: 0.08,
  resourceCap: 9,
  eventInterval: 160,
  eventRadius: 5,
  eventIntensity: 1.6,
  barrierThreshold: 0.78,
  terrainCostScale: 0.55,
  traceDecay: 0.965,
  pressureDecay: 0.992,
  pressureDiffusion: 0.06,
  pressureGrowth: 0.012,
  reproductionShare: 0.46,
  seed: 1337
};

export const GENOME_BOUNDS: Record<keyof Genome, GenomeRange> = {
  senseRadius: { min: 1, max: 3 },
  metabolism: { min: 0.28, max: 1.8 },
  moveCost: { min: 0.08, max: 0.75 },
  harvestRate: { min: 0.45, max: 4.2 },
  traceAffinity: { min: -1.8, max: 1.8 },
  resourceAffinity: { min: 0.35, max: 4.4 },
  reproductionThreshold: { min: 46, max: 170 },
  mutationRate: { min: 0.008, max: 0.18 }
};

const MOVE_CANDIDATES: readonly MoveVector[] = [
  { dx: 0, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 }
];

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mulberry32(seed: number): RandomSource {
  let t = seed >>> 0;
  return function random(): number {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function mergeConfig(config?: SimulationConfigPatch): SimulationConfig {
  return { ...DEFAULTS, ...config };
}

function createDeathStats(): DeathStats {
  return {
    starvation: 0,
    pressure: 0,
    overflow: 0
  };
}

function hash2d(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ Math.imul(y, 0x27d4eb2d) ^ seed, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function valueNoise2d(x: number, y: number, seed: number, scale: number): number {
  const nx = x / scale;
  const ny = y / scale;
  const x0 = Math.floor(nx);
  const y0 = Math.floor(ny);
  const tx = smoothstep(nx - x0);
  const ty = smoothstep(ny - y0);

  const a = hash2d(x0, y0, seed);
  const b = hash2d(x0 + 1, y0, seed);
  const c = hash2d(x0, y0 + 1, seed);
  const d = hash2d(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

export function resourceTerrainAt(x: number, y: number, config: SimulationConfig): number {
  const broadScale = Math.max(8, Math.min(config.width, config.height) * 0.38);
  const midScale = Math.max(5, Math.min(config.width, config.height) * 0.16);
  const fineScale = Math.max(3, Math.min(config.width, config.height) * 0.07);
  const broad = valueNoise2d(x, y, config.seed ^ 0x9e3779b9, broadScale);
  const mid = valueNoise2d(x, y, config.seed ^ 0x7f4a7c15, midScale);
  const fine = valueNoise2d(x, y, config.seed ^ 0x94d049bb, fineScale);
  const shaped = Math.pow(broad * 0.6 + mid * 0.3 + fine * 0.1, 1.35);

  return clamp(shaped * config.resourceCap * 0.9, 0, config.resourceCap);
}

export function resourceFertilityAt(x: number, y: number, config: SimulationConfig): number {
  if (config.resourceCap <= 0) {
    return 0;
  }

  return clamp(resourceTerrainAt(x, y, config) / (config.resourceCap * 0.9), 0, 1);
}

export function movementTerrainAt(x: number, y: number, config: SimulationConfig): number {
  const broadScale = Math.max(7, Math.min(config.width, config.height) * 0.22);
  const fineScale = Math.max(3, Math.min(config.width, config.height) * 0.08);
  const broad = valueNoise2d(x, y, config.seed ^ 0x165667b1, broadScale);
  const fine = valueNoise2d(x, y, config.seed ^ 0xd3a2646c, fineScale);
  return clamp(broad * 0.72 + fine * 0.28, 0, 1);
}

export function movementCostAt(x: number, y: number, config: SimulationConfig): number {
  return 1 + movementTerrainAt(x, y, config) * Math.max(0, config.terrainCostScale);
}

export function isBarrierAt(x: number, y: number, config: SimulationConfig): boolean {
  const threshold = clamp(config.barrierThreshold, 0, 1.01);
  return threshold <= 1 && movementTerrainAt(x, y, config) >= threshold;
}

export function createGenome(random: RandomSource): Genome {
  return constrainGenome({
    senseRadius: random() < 0.72 ? 1 : 2,
    metabolism: 0.52 + random() * 0.5,
    moveCost: 0.18 + random() * 0.2,
    harvestRate: 1.4 + random() * 1.7,
    traceAffinity: -0.6 + random() * 1.2,
    resourceAffinity: 1.3 + random() * 1.4,
    reproductionThreshold: 78 + random() * 42,
    mutationRate: 0.035 + random() * 0.055
  });
}

export function constrainGenome(genome: Genome): Genome {
  const constrained: Genome = {
    senseRadius: Math.round(clamp(genome.senseRadius, GENOME_BOUNDS.senseRadius.min, GENOME_BOUNDS.senseRadius.max)),
    metabolism: clamp(genome.metabolism, GENOME_BOUNDS.metabolism.min, GENOME_BOUNDS.metabolism.max),
    moveCost: clamp(genome.moveCost, GENOME_BOUNDS.moveCost.min, GENOME_BOUNDS.moveCost.max),
    harvestRate: clamp(genome.harvestRate, GENOME_BOUNDS.harvestRate.min, GENOME_BOUNDS.harvestRate.max),
    traceAffinity: clamp(genome.traceAffinity, GENOME_BOUNDS.traceAffinity.min, GENOME_BOUNDS.traceAffinity.max),
    resourceAffinity: clamp(
      genome.resourceAffinity,
      GENOME_BOUNDS.resourceAffinity.min,
      GENOME_BOUNDS.resourceAffinity.max
    ),
    reproductionThreshold: clamp(
      genome.reproductionThreshold,
      GENOME_BOUNDS.reproductionThreshold.min,
      GENOME_BOUNDS.reproductionThreshold.max
    ),
    mutationRate: clamp(genome.mutationRate, GENOME_BOUNDS.mutationRate.min, GENOME_BOUNDS.mutationRate.max)
  };

  return enforceGenomeTradeoffs(constrained);
}

function enforceGenomeTradeoffs(genome: Genome): Genome {
  const senseLoad = Math.max(0, genome.senseRadius - 1);
  const harvestLoad = Math.max(0, genome.harvestRate - 1.4);
  const earlyReproductionLoad = Math.max(0, 78 - genome.reproductionThreshold);
  const resourceFocusLoad = Math.max(0, genome.resourceAffinity - 1.3);
  const traceLoad = Math.abs(genome.traceAffinity);

  const metabolismFloor =
    GENOME_BOUNDS.metabolism.min +
    senseLoad * 0.08 +
    harvestLoad * 0.07 +
    earlyReproductionLoad * 0.004 +
    resourceFocusLoad * 0.025 +
    traceLoad * 0.015;
  const moveCostFloor = GENOME_BOUNDS.moveCost.min + senseLoad * 0.035 + harvestLoad * 0.018;

  return {
    ...genome,
    metabolism: clamp(Math.max(genome.metabolism, metabolismFloor), GENOME_BOUNDS.metabolism.min, GENOME_BOUNDS.metabolism.max),
    moveCost: clamp(Math.max(genome.moveCost, moveCostFloor), GENOME_BOUNDS.moveCost.min, GENOME_BOUNDS.moveCost.max)
  };
}

export function mutateGenome(parent: Genome, random: RandomSource): Genome {
  const rate = parent.mutationRate;
  const child = { ...parent };

  for (const key of Object.keys(parent) as Array<keyof Genome>) {
    let value = parent[key];
    if (key === "senseRadius") {
      if (random() < rate) {
        value += random() < 0.5 ? -1 : 1;
      }
      child[key] = Math.round(clamp(value, 1, 3));
      continue;
    }

    if (random() < rate) {
      const swing = 1 + (random() - 0.5) * 0.28;
      value *= swing;
    }
    child[key] = value;
  }

  return constrainGenome(child);
}

function harvestPressure(genome: Genome, harvested: number): number {
  const harvestLoad = Math.max(0, genome.harvestRate - 1.4);
  return harvested * (0.01 + harvestLoad * 0.008);
}

function reproductionEfficiency(genome: Genome): number {
  const bounds = GENOME_BOUNDS.reproductionThreshold;
  const thresholdPosition = (genome.reproductionThreshold - bounds.min) / (bounds.max - bounds.min);
  return clamp(0.72 + thresholdPosition * 0.22, 0.72, 0.94);
}

export class Simulation {
  config: SimulationConfig;
  random: RandomSource;
  width: number;
  height: number;
  size: number;
  nextAgentId = 1;
  nextLineageId = 1;
  tickCount = 0;
  births = 0;
  deaths = 0;
  deathReasons: DeathStats = createDeathStats();
  eventCount = 0;
  lastEvent: EnvironmentEventRecord | null = null;
  knownLineages = new Set<number>();
  resources: Float32Array;
  traces: Float32Array;
  pressure: Float32Array;
  agents: Agent[] = [];

  constructor(config?: SimulationConfigPatch) {
    this.config = mergeConfig(config);
    this.random = mulberry32(this.config.seed);
    this.width = this.config.width;
    this.height = this.config.height;
    this.size = this.width * this.height;
    this.resources = new Float32Array(this.size);
    this.traces = new Float32Array(this.size);
    this.pressure = new Float32Array(this.size);
    this.reset();
  }

  reset(nextConfig?: SimulationConfigPatch): void {
    if (nextConfig) {
      this.config = mergeConfig(nextConfig);
      this.random = mulberry32(this.config.seed);
      this.width = this.config.width;
      this.height = this.config.height;
      this.size = this.width * this.height;
      this.resources = new Float32Array(this.size);
      this.traces = new Float32Array(this.size);
      this.pressure = new Float32Array(this.size);
    }

    this.nextAgentId = 1;
    this.nextLineageId = 1;
    this.tickCount = 0;
    this.births = 0;
    this.deaths = 0;
    this.deathReasons = createDeathStats();
    this.eventCount = 0;
    this.lastEvent = null;
    this.knownLineages = new Set<number>();
    this.agents = [];

    for (let i = 0; i < this.size; i += 1) {
      const x = i % this.width;
      const y = Math.floor(i / this.width);
      this.resources[i] = resourceTerrainAt(x, y, this.config);
      this.traces[i] = 0;
      this.pressure[i] = this.random() * 0.35;
    }

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
    const xx = (x + this.width) % this.width;
    const yy = (y + this.height) % this.height;
    return yy * this.width + xx;
  }

  cellAt(x: number, y: number): EnvironmentCell {
    return this.environmentAt(this.index(x, y));
  }

  environmentAt(index: number): EnvironmentCell {
    const idx = ((index % this.size) + this.size) % this.size;
    return {
      resource: this.resources[idx],
      fertility: resourceFertilityAt(idx % this.width, Math.floor(idx / this.width), this.config),
      movementCost: movementCostAt(idx % this.width, Math.floor(idx / this.width), this.config),
      barrier: isBarrierAt(idx % this.width, Math.floor(idx / this.width), this.config),
      trace: this.traces[idx],
      pressure: this.pressure[idx]
    };
  }

  spawnAgent(x: number, y: number, genome: Genome, energy: number, generation = 0, lineageId?: number): Agent {
    const resolvedLineageId = lineageId ?? this.nextLineageId++;
    this.nextLineageId = Math.max(this.nextLineageId, resolvedLineageId + 1);
    this.knownLineages.add(resolvedLineageId);
    const spawnPoint = this.nearestOpenPoint(x, y);

    const boundedGenome = constrainGenome(genome);
    const agent: Agent = {
      id: this.nextAgentId,
      lineageId: resolvedLineageId,
      x: spawnPoint.x,
      y: spawnPoint.y,
      energy,
      age: 0,
      generation,
      genome: boundedGenome,
      lastAction: "born"
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
    return isBarrierAt(x, y, this.config);
  }

  step(iterations = 1): void {
    const count = iterations || 1;
    for (let i = 0; i < count; i += 1) {
      this.tick();
    }
  }

  tick(): void {
    this.tickCount += 1;
    this.updateEnvironment();
    this.maybeTriggerEnvironmentalEvent();

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
    const cap = this.config.resourceCap;
    for (let i = 0; i < this.size; i += 1) {
      if (this.config.environmentMode === "flux") {
        const x = i % this.width;
        const y = Math.floor(i / this.width);
        const fertility = resourceFertilityAt(x, y, this.config);
        const recoveryFactor = 1 / (1 + this.pressure[i] * 0.55);
        const growthChance = this.config.resourceGrowth * (0.25 + fertility * 1.15) * recoveryFactor;
        if (this.random() < growthChance) {
          const growthAmount = (0.15 + fertility * 0.85) * recoveryFactor * this.random() * 0.8;
          this.resources[i] = clamp(this.resources[i] + growthAmount, 0, cap);
        }
      }
      this.traces[i] *= this.config.traceDecay;
      this.pressure[i] = clamp(
        this.pressure[i] * this.config.pressureDecay + this.traces[i] * this.config.pressureGrowth,
        0,
        4
      );
    }
    this.diffusePressure();
  }

  maybeTriggerEnvironmentalEvent(): void {
    if (this.config.environmentMode !== "flux") {
      return;
    }

    const interval = Math.floor(this.config.eventInterval);
    if (interval <= 0 || this.tickCount % interval !== 0) {
      return;
    }

    const event = this.triggerEnvironmentalEvent();
    if (event) {
      this.eventCount += 1;
      this.lastEvent = event;
    }
  }

  triggerEnvironmentalEvent(): EnvironmentEventRecord | null {
    const radius = Math.max(0, Math.round(this.config.eventRadius));
    const intensity = Math.max(0, this.config.eventIntensity);
    if (radius <= 0 || intensity <= 0 || this.size <= 0) {
      return null;
    }

    const xRoll = hash2d(this.tickCount, 17, this.config.seed ^ 0x51ed270f);
    const yRoll = hash2d(this.tickCount, 29, this.config.seed ^ 0x9e3779b9);
    const kindRoll = hash2d(this.tickCount, 43, this.config.seed ^ 0x85ebca6b);
    const originX = Math.floor(xRoll * this.width) % this.width;
    const originY = Math.floor(yRoll * this.height) % this.height;
    const center = this.nearestOpenPoint(originX, originY);
    const kind: EnvironmentEventKind = kindRoll < 0.58 ? "bloom" : "pressure";
    let affectedCells = 0;

    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const distance = Math.abs(dx) + Math.abs(dy);
        if (distance > radius) {
          continue;
        }

        const x = center.x + dx;
        const y = center.y + dy;
        if (this.isBarrier(x, y)) {
          continue;
        }

        const idx = this.index(x, y);
        const falloff = 1 - distance / (radius + 1);
        if (kind === "bloom") {
          const fertility = resourceFertilityAt(x, y, this.config);
          const amount = intensity * falloff * (0.55 + fertility * 0.75);
          this.resources[idx] = clamp(this.resources[idx] + amount, 0, this.config.resourceCap);
          this.traces[idx] = clamp(this.traces[idx] + falloff * 0.12, 0, 12);
        } else {
          this.pressure[idx] = clamp(this.pressure[idx] + intensity * falloff * 0.55, 0, 4);
          this.traces[idx] = clamp(this.traces[idx] + falloff * 0.28, 0, 12);
        }
        affectedCells += 1;
      }
    }

    return {
      tick: this.tickCount,
      kind,
      x: center.x,
      y: center.y,
      radius,
      intensity,
      affectedCells
    };
  }

  diffusePressure(): void {
    const diffusion = clamp(this.config.pressureDiffusion, 0, 0.25);
    if (diffusion <= 0) {
      return;
    }

    const nextPressure = new Float32Array(this.size);
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const idx = this.index(x, y);
        const neighborAverage =
          (this.pressure[this.index(x + 1, y)] +
            this.pressure[this.index(x - 1, y)] +
            this.pressure[this.index(x, y + 1)] +
            this.pressure[this.index(x, y - 1)]) /
          4;
        nextPressure[idx] = clamp(this.pressure[idx] * (1 - diffusion) + neighborAverage * diffusion, 0, 4);
      }
    }
    this.pressure = nextPressure;
  }

  liveAgent(agent: Agent): Agent | null {
    agent.age += 1;

    if (!this.spendMetabolism(agent)) {
      return null;
    }

    const move = this.chooseMove(agent);
    this.moveAgent(agent, move);

    const harvested = this.harvestAgent(agent);
    this.leaveTrace(agent, harvested);
    agent.lastAction = harvested > 0.2 ? "harvest" : "search";

    return this.tryReproduce(agent);
  }

  spendMetabolism(agent: Agent): boolean {
    const here = this.index(agent.x, agent.y);
    const energyBefore = agent.energy;
    const metabolismCost = agent.genome.metabolism;
    const pressureCost = this.pressure[here] * 0.08;

    agent.energy -= metabolismCost + pressureCost;
    if (agent.energy > 0) {
      return true;
    }

    const wouldSurviveWithoutPressure = energyBefore - metabolismCost > 0;
    this.markDeath(agent, wouldSurviveWithoutPressure && pressureCost > 0 ? "pressure" : "starvation");
    return false;
  }

  moveAgent(agent: Agent, move: MoveVector): void {
    const targetX = (agent.x + move.dx + this.width) % this.width;
    const targetY = (agent.y + move.dy + this.height) % this.height;
    if (this.isBarrier(targetX, targetY)) {
      return;
    }

    agent.x = targetX;
    agent.y = targetY;
    const distance = Math.abs(move.dx) + Math.abs(move.dy);
    agent.energy -= agent.genome.moveCost * distance * movementCostAt(targetX, targetY, this.config);
  }

  harvestAgent(agent: Agent): number {
    const idx = this.index(agent.x, agent.y);
    const harvested = Math.min(this.resources[idx], agent.genome.harvestRate);
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
    const resourceResidue = remainingEnergy * 0.35 * (1 - pressureLoad * 0.45);
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
      const score = this.scoreArea(agent.x + move.dx, agent.y + move.dy, agent.genome) + this.random() * 0.25;
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
        score += (this.resources[idx] * genome.resourceAffinity) / distance;
        score += (this.traces[idx] * genome.traceAffinity) / distance;
        score -= this.pressure[idx] * 0.35;
        score -= (movementCostAt(cx + x, cy + y, this.config) - 1) * 0.55;
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

    this.traces[idx] = clamp(this.traces[idx] + reproductionWaste * 0.02, 0, 12);
    this.pressure[idx] = clamp(this.pressure[idx] + reproductionWaste * 0.006, 0, 4);

    parent.lastAction = "divide";
    return {
      id: this.nextAgentId++,
      ...this.nearestOpenPoint(parent.x + offsetX, parent.y + offsetY),
      lineageId: parent.lineageId,
      energy: childEnergy,
      age: 0,
      generation: parent.generation + 1,
      genome: childGenome,
      lastAction: "born"
    };
  }

  metrics(): Metrics {
    let totalEnergy = 0;
    let maxGeneration = 0;
    const lineageAgents = new Map<number, number>();
    for (const agent of this.agents) {
      totalEnergy += agent.energy;
      maxGeneration = Math.max(maxGeneration, agent.generation);
      lineageAgents.set(agent.lineageId, (lineageAgents.get(agent.lineageId) ?? 0) + 1);
    }
    const livingLineages = lineageAgents.size;
    let dominantId: number | null = null;
    let dominantAgents = 0;
    for (const [lineageId, count] of lineageAgents) {
      if (count > dominantAgents) {
        dominantId = lineageId;
        dominantAgents = count;
      }
    }
    const totalLineages = this.knownLineages.size;

    let totalResource = 0;
    let totalTrace = 0;
    let totalPressure = 0;
    for (let i = 0; i < this.size; i += 1) {
      totalResource += this.resources[i];
      totalTrace += this.traces[i];
      totalPressure += this.pressure[i];
    }

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
        dominantId,
        dominantAgents,
        dominantShare: this.agents.length ? dominantAgents / this.agents.length : 0
      },
      deathReasons: { ...this.deathReasons },
      totalResource,
      totalTrace,
      totalPressure,
      eventCount: this.eventCount,
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null
    };
  }
}
