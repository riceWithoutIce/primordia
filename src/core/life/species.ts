import type { Agent, Genome, TerrainType } from "../types";

const SPECIES_DISTANCE_THRESHOLD = 1.55;
const GENERATION_GATE = 5;

export function speciesForGenome(genome: Genome, biome: TerrainType, lineageId: number, generation: number): number {
  if (generation < GENERATION_GATE) {
    return lineageId;
  }

  const biomeBucket = biomeBucketFor(biome);
  const behaviorBucket =
    Math.floor(genome.explorationBias * 3) +
    Math.floor(genome.pressureAversion * 1.2) +
    Math.floor((genome.terrainAffinity + 1.2) * 0.8) +
    Math.floor(genome.riskTolerance * 2);
  const metabolicBucket =
    Math.floor(genome.harvestRate * 0.7) +
    Math.floor(genome.metabolism * 1.5) +
    Math.floor(genome.reproductionThreshold / 42);
  return lineageId * 100 + biomeBucket * 10 + ((behaviorBucket + metabolicBucket) % 10);
}

export function shouldUpdateSpecies(agent: Agent, biome: TerrainType): boolean {
  return agent.generation >= GENERATION_GATE && speciesDistanceSignal(agent.genome, biome) >= SPECIES_DISTANCE_THRESHOLD;
}

export function speciesDistanceSignal(genome: Genome, biome: TerrainType): number {
  return (
    Math.abs(genome.traceAffinity) * 0.12 +
    genome.pressureAversion * 0.24 +
    genome.explorationBias * 0.36 +
    Math.abs(genome.terrainAffinity) * 0.28 +
    genome.riskTolerance * 0.18 +
    biomeBucketFor(biome) * 0.08
  );
}

function biomeBucketFor(biome: TerrainType): number {
  switch (biome) {
    case "ocean":
      return 0;
    case "coast":
      return 1;
    case "plain":
      return 2;
    case "hill":
      return 3;
    case "mountain":
      return 4;
    case "wetland":
      return 5;
    case "desert":
      return 6;
    case "tundra":
      return 7;
    case "snow":
      return 8;
  }
}
