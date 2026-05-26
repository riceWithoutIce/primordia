import { clamp } from "../random/rng";
import type { Genome, GenomeInput, GenomeRange, RandomSource } from "../types";

export const GENOME_BOUNDS: Record<keyof Genome, GenomeRange> = {
  senseRadius: { min: 1, max: 3 },
  metabolism: { min: 0.28, max: 1.8 },
  moveCost: { min: 0.08, max: 0.75 },
  harvestRate: { min: 0.45, max: 4.2 },
  traceAffinity: { min: -1.8, max: 1.8 },
  resourceAffinity: { min: 0.35, max: 4.4 },
  reproductionThreshold: { min: 46, max: 170 },
  mutationRate: { min: 0.008, max: 0.18 },
  inertia: { min: 0, max: 1 },
  riskTolerance: { min: 0, max: 1 },
  pressureAversion: { min: 0, max: 2.4 },
  terrainAffinity: { min: -1.2, max: 1.6 },
  explorationBias: { min: 0, max: 1 }
};

export function withGenomeDefaults(genome: GenomeInput): Genome {
  return {
    inertia: 0.42,
    riskTolerance: 0.38,
    pressureAversion: 0.95,
    terrainAffinity: 0.25,
    explorationBias: 0.24,
    ...genome
  };
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
    mutationRate: 0.035 + random() * 0.055,
    inertia: 0.18 + random() * 0.58,
    riskTolerance: 0.18 + random() * 0.64,
    pressureAversion: 0.55 + random() * 1.1,
    terrainAffinity: -0.35 + random() * 1.1,
    explorationBias: 0.08 + random() * 0.48
  });
}

export function constrainGenome(genome: GenomeInput): Genome {
  const resolved = withGenomeDefaults(genome);
  const constrained: Genome = {
    senseRadius: Math.round(clamp(resolved.senseRadius, GENOME_BOUNDS.senseRadius.min, GENOME_BOUNDS.senseRadius.max)),
    metabolism: clamp(resolved.metabolism, GENOME_BOUNDS.metabolism.min, GENOME_BOUNDS.metabolism.max),
    moveCost: clamp(resolved.moveCost, GENOME_BOUNDS.moveCost.min, GENOME_BOUNDS.moveCost.max),
    harvestRate: clamp(resolved.harvestRate, GENOME_BOUNDS.harvestRate.min, GENOME_BOUNDS.harvestRate.max),
    traceAffinity: clamp(resolved.traceAffinity, GENOME_BOUNDS.traceAffinity.min, GENOME_BOUNDS.traceAffinity.max),
    resourceAffinity: clamp(
      resolved.resourceAffinity,
      GENOME_BOUNDS.resourceAffinity.min,
      GENOME_BOUNDS.resourceAffinity.max
    ),
    reproductionThreshold: clamp(
      resolved.reproductionThreshold,
      GENOME_BOUNDS.reproductionThreshold.min,
      GENOME_BOUNDS.reproductionThreshold.max
    ),
    mutationRate: clamp(resolved.mutationRate, GENOME_BOUNDS.mutationRate.min, GENOME_BOUNDS.mutationRate.max),
    inertia: clamp(resolved.inertia, GENOME_BOUNDS.inertia.min, GENOME_BOUNDS.inertia.max),
    riskTolerance: clamp(resolved.riskTolerance, GENOME_BOUNDS.riskTolerance.min, GENOME_BOUNDS.riskTolerance.max),
    pressureAversion: clamp(
      resolved.pressureAversion,
      GENOME_BOUNDS.pressureAversion.min,
      GENOME_BOUNDS.pressureAversion.max
    ),
    terrainAffinity: clamp(
      resolved.terrainAffinity,
      GENOME_BOUNDS.terrainAffinity.min,
      GENOME_BOUNDS.terrainAffinity.max
    ),
    explorationBias: clamp(
      resolved.explorationBias,
      GENOME_BOUNDS.explorationBias.min,
      GENOME_BOUNDS.explorationBias.max
    )
  };

  return enforceGenomeTradeoffs(constrained);
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

export function cloneGenome(genome: Genome): Genome {
  return {
    senseRadius: genome.senseRadius,
    metabolism: roundSnapshotValue(genome.metabolism),
    moveCost: roundSnapshotValue(genome.moveCost),
    harvestRate: roundSnapshotValue(genome.harvestRate),
    traceAffinity: roundSnapshotValue(genome.traceAffinity),
    resourceAffinity: roundSnapshotValue(genome.resourceAffinity),
    reproductionThreshold: roundSnapshotValue(genome.reproductionThreshold),
    mutationRate: roundSnapshotValue(genome.mutationRate),
    inertia: roundSnapshotValue(genome.inertia),
    riskTolerance: roundSnapshotValue(genome.riskTolerance),
    pressureAversion: roundSnapshotValue(genome.pressureAversion),
    terrainAffinity: roundSnapshotValue(genome.terrainAffinity),
    explorationBias: roundSnapshotValue(genome.explorationBias)
  };
}

export function roundSnapshotValue(value: number): number {
  return Number(value.toFixed(6));
}

function enforceGenomeTradeoffs(genome: Genome): Genome {
  const senseLoad = Math.max(0, genome.senseRadius - 1);
  const harvestLoad = Math.max(0, genome.harvestRate - 1.4);
  const earlyReproductionLoad = Math.max(0, 78 - genome.reproductionThreshold);
  const resourceFocusLoad = Math.max(0, genome.resourceAffinity - 1.3);
  const traceLoad = Math.abs(genome.traceAffinity);
  const behaviorLoad =
    genome.inertia * 0.025 +
    genome.pressureAversion * 0.025 +
    Math.abs(genome.terrainAffinity) * 0.018 +
    genome.explorationBias * 0.035 +
    genome.riskTolerance * 0.018;

  const metabolismFloor =
    GENOME_BOUNDS.metabolism.min +
    senseLoad * 0.08 +
    harvestLoad * 0.07 +
    earlyReproductionLoad * 0.004 +
    resourceFocusLoad * 0.025 +
    traceLoad * 0.015 +
    behaviorLoad;
  const moveCostFloor =
    GENOME_BOUNDS.moveCost.min +
    senseLoad * 0.035 +
    harvestLoad * 0.018 +
    genome.inertia * 0.015 +
    Math.max(0, genome.terrainAffinity) * 0.018;

  return {
    ...genome,
    metabolism: clamp(Math.max(genome.metabolism, metabolismFloor), GENOME_BOUNDS.metabolism.min, GENOME_BOUNDS.metabolism.max),
    moveCost: clamp(Math.max(genome.moveCost, moveCostFloor), GENOME_BOUNDS.moveCost.min, GENOME_BOUNDS.moveCost.max)
  };
}
