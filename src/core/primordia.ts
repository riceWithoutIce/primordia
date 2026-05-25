export type RandomSource = () => number;

export type AgentAction = "born" | "death" | "harvest" | "search" | "divide";

export type DeathReason = "starvation" | "pressure" | "overflow";

export type EnvironmentMode = "closed" | "flux";

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
  traceDecay: number;
  pressureDecay: number;
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

export interface EnvironmentCell {
  resource: number;
  trace: number;
  pressure: number;
}

export interface Agent extends GridPoint {
  id: number;
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

export interface Metrics {
  tick: number;
  agents: number;
  births: number;
  deaths: number;
  averageEnergy: number;
  maxGeneration: number;
  deathReasons: DeathStats;
  totalResource: number;
  totalTrace: number;
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
  traceDecay: 0.965,
  pressureDecay: 0.992,
  pressureGrowth: 0.012,
  reproductionShare: 0.46,
  seed: 1337
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

export function createGenome(random: RandomSource): Genome {
  return {
    senseRadius: random() < 0.72 ? 1 : 2,
    metabolism: 0.52 + random() * 0.5,
    moveCost: 0.18 + random() * 0.2,
    harvestRate: 1.4 + random() * 1.7,
    traceAffinity: -0.6 + random() * 1.2,
    resourceAffinity: 1.3 + random() * 1.4,
    reproductionThreshold: 78 + random() * 42,
    mutationRate: 0.035 + random() * 0.055
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

  child.metabolism = clamp(child.metabolism, 0.28, 1.8);
  child.moveCost = clamp(child.moveCost, 0.08, 0.75);
  child.harvestRate = clamp(child.harvestRate, 0.45, 4.2);
  child.traceAffinity = clamp(child.traceAffinity, -1.8, 1.8);
  child.resourceAffinity = clamp(child.resourceAffinity, 0.35, 4.4);
  child.reproductionThreshold = clamp(child.reproductionThreshold, 46, 170);
  child.mutationRate = clamp(child.mutationRate, 0.008, 0.18);
  return child;
}

export class Simulation {
  config: SimulationConfig;
  random: RandomSource;
  width: number;
  height: number;
  size: number;
  nextAgentId = 1;
  tickCount = 0;
  births = 0;
  deaths = 0;
  deathReasons: DeathStats = createDeathStats();
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
    this.tickCount = 0;
    this.births = 0;
    this.deaths = 0;
    this.deathReasons = createDeathStats();
    this.agents = [];

    for (let i = 0; i < this.size; i += 1) {
      this.resources[i] = this.random() * this.config.resourceCap * 0.65;
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
      trace: this.traces[idx],
      pressure: this.pressure[idx]
    };
  }

  spawnAgent(x: number, y: number, genome: Genome, energy: number, generation = 0): Agent {
    const agent: Agent = {
      id: this.nextAgentId,
      x: (x + this.width) % this.width,
      y: (y + this.height) % this.height,
      energy,
      age: 0,
      generation,
      genome,
      lastAction: "born"
    };
    this.nextAgentId += 1;
    this.agents.push(agent);
    this.births += 1;
    return agent;
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
      if (this.config.environmentMode === "flux" && this.random() < this.config.resourceGrowth) {
        this.resources[i] = clamp(this.resources[i] + this.random() * 0.8, 0, cap);
      }
      this.traces[i] *= this.config.traceDecay;
      this.pressure[i] = clamp(
        this.pressure[i] * this.config.pressureDecay + this.traces[i] * this.config.pressureGrowth,
        0,
        4
      );
    }
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
    agent.x = (agent.x + move.dx + this.width) % this.width;
    agent.y = (agent.y + move.dy + this.height) % this.height;
    agent.energy -= agent.genome.moveCost * (Math.abs(move.dx) + Math.abs(move.dy));
  }

  harvestAgent(agent: Agent): number {
    const idx = this.index(agent.x, agent.y);
    const harvested = Math.min(this.resources[idx], agent.genome.harvestRate);
    this.resources[idx] -= harvested;
    agent.energy += harvested;
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
    const resourceResidue = remainingEnergy * 0.35;
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
        score += (this.resources[idx] * genome.resourceAffinity) / distance;
        score += (this.traces[idx] * genome.traceAffinity) / distance;
        score -= this.pressure[idx] * 0.35;
      }
    }
    return score;
  }

  reproduce(parent: Agent): Agent {
    const share = this.config.reproductionShare;
    const childEnergy = parent.energy * share;
    parent.energy *= 1 - share;

    const childGenome = mutateGenome(parent.genome, this.random);
    const offsetX = this.random() < 0.5 ? -1 : 1;
    const offsetY = this.random() < 0.5 ? -1 : 1;

    parent.lastAction = "divide";
    return {
      id: this.nextAgentId++,
      x: (parent.x + offsetX + this.width) % this.width,
      y: (parent.y + offsetY + this.height) % this.height,
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
    for (const agent of this.agents) {
      totalEnergy += agent.energy;
      maxGeneration = Math.max(maxGeneration, agent.generation);
    }

    let totalResource = 0;
    let totalTrace = 0;
    for (let i = 0; i < this.size; i += 1) {
      totalResource += this.resources[i];
      totalTrace += this.traces[i];
    }

    return {
      tick: this.tickCount,
      agents: this.agents.length,
      births: this.births,
      deaths: this.deaths,
      averageEnergy: this.agents.length ? totalEnergy / this.agents.length : 0,
      maxGeneration,
      deathReasons: { ...this.deathReasons },
      totalResource,
      totalTrace
    };
  }
}
