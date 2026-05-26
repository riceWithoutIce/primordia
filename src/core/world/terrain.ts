import { DEFAULTS } from "../config/defaults";
import { fbmNoise2d, valueNoise2d } from "../random/noise";
import { clamp } from "../random/rng";
import type { SimulationConfig, StaticTerrain, TerrainCell, TerrainType } from "../types";

const TERRAIN_TYPES: readonly TerrainType[] = [
  "ocean",
  "coast",
  "plain",
  "hill",
  "mountain",
  "wetland",
  "desert",
  "tundra",
  "snow"
];

export function terrainTypes(): readonly TerrainType[] {
  return TERRAIN_TYPES;
}

export function createTerrain(config: SimulationConfig): StaticTerrain {
  const size = config.width * config.height;
  const elevation = new Float32Array(size);
  const moistureBase = new Float32Array(size);
  const temperatureBase = new Float32Array(size);
  const fertilityBase = new Float32Array(size);
  const movementCost = new Float32Array(size);
  const movementTerrain = new Float32Array(size);
  const barrier = new Uint8Array(size);
  const terrainType: TerrainType[] = new Array<TerrainType>(size);

  for (let y = 0; y < config.height; y += 1) {
    for (let x = 0; x < config.width; x += 1) {
      const index = y * config.width + x;
      const cell = terrainCellAt(x, y, config);
      elevation[index] = cell.elevation;
      moistureBase[index] = cell.moistureBase;
      temperatureBase[index] = cell.temperatureBase;
      fertilityBase[index] = cell.fertilityBase;
      movementCost[index] = cell.movementCost;
      movementTerrain[index] = cell.movementTerrain;
      barrier[index] = cell.barrier ? 1 : 0;
      terrainType[index] = cell.terrainType;
    }
  }

  return {
    elevation,
    moistureBase,
    temperatureBase,
    fertilityBase,
    movementCost,
    movementTerrain,
    barrier,
    terrainType
  };
}

export function terrainCellAt(x: number, y: number, config: SimulationConfig): TerrainCell {
  const elevation = elevationAt(x, y, config);
  const moistureBase = moistureAt(x, y, config, elevation);
  const temperatureBase = temperatureAt(x, y, config, elevation);
  const terrainType = classifyTerrain(elevation, moistureBase, temperatureBase);
  const fertilityBase = fertilityFor(terrainType, elevation, moistureBase, temperatureBase);
  const movementTerrain = movementTerrainValue(terrainType, elevation, moistureBase, config);
  const barrier = barrierFor(terrainType, movementTerrain, config);

  return {
    elevation,
    moistureBase,
    temperatureBase,
    fertilityBase,
    movementCost: 1 + movementTerrain * Math.max(0, config.terrainCostScale),
    movementTerrain,
    terrainType,
    barrier
  };
}

export function elevationAt(x: number, y: number, config: SimulationConfig): number {
  const nx = config.width <= 1 ? 0.5 : x / (config.width - 1);
  const ny = config.height <= 1 ? 0.5 : y / (config.height - 1);
  const cx = nx - 0.5;
  const cy = ny - 0.5;
  const distanceFromCenter = Math.sqrt(cx * cx * 1.15 + cy * cy * 1.85);
  const continentMask = clamp(1 - distanceFromCenter * 1.75, 0, 1);

  const broadScale = Math.max(24, Math.min(config.width, config.height) * 0.5);
  const midScale = Math.max(10, Math.min(config.width, config.height) * 0.18);
  const continent = fbmNoise2d(x, y, config.seed ^ 0x99b5f13, broadScale, 4);
  const mid = fbmNoise2d(x, y, config.seed ^ 0x1d872b41, midScale, 3);

  const ridgeAxis = 0.48 + (valueNoise2d(y, 0, config.seed ^ 0x5f356495, Math.max(12, config.height * 0.22)) - 0.5) * 0.42;
  const ridgeDistance = Math.abs(nx - ridgeAxis);
  const ridge = Math.pow(clamp(1 - ridgeDistance * 5.5, 0, 1), 2.15);
  const ridgeBroken = ridge * (0.55 + valueNoise2d(x, y, config.seed ^ 0xa24baed3, Math.max(8, config.height * 0.08)) * 0.7);

  const shaped = continentMask * 0.68 + continent * 0.38 + mid * 0.18 + ridgeBroken * 0.26 - 0.25;
  return clamp(shaped, 0, 1);
}

export function moistureAt(x: number, y: number, config: SimulationConfig, elevation = elevationAt(x, y, config)): number {
  const nx = config.width <= 1 ? 0.5 : x / (config.width - 1);
  const westWind = 1 - nx;
  const coastMoisture = clamp((0.42 - elevation) * 2.3, 0, 1);
  const rainShadow = Math.max(0, elevation - 0.58) * nx * 1.25;
  const noise = fbmNoise2d(x, y, config.seed ^ 0x6b32a791, Math.max(10, config.height * 0.16), 4);
  return clamp(westWind * 0.28 + coastMoisture * 0.34 + noise * 0.52 - rainShadow, 0, 1);
}

export function temperatureAt(x: number, y: number, config: SimulationConfig, elevation = elevationAt(x, y, config)): number {
  const ny = config.height <= 1 ? 0.5 : y / (config.height - 1);
  const latitudeWarmth = 1 - Math.abs(ny - 0.5) * 1.35;
  const noise = valueNoise2d(x, y, config.seed ^ 0x21f0aaad, Math.max(16, config.height * 0.2));
  return clamp(latitudeWarmth * 0.86 + noise * 0.18 - elevation * 0.38, 0, 1);
}

export function classifyTerrain(elevation: number, moisture: number, temperature: number): TerrainType {
  if (elevation < 0.27) {
    return "ocean";
  }
  if (elevation < 0.34) {
    return "coast";
  }
  if (elevation > 0.8 && temperature < 0.48) {
    return "snow";
  }
  if (elevation > 0.78) {
    return "mountain";
  }
  if (temperature < 0.28 && elevation > 0.45) {
    return moisture > 0.38 ? "tundra" : "snow";
  }
  if (moisture > 0.72 && elevation < 0.5) {
    return "wetland";
  }
  if (moisture < 0.27 && temperature > 0.45) {
    return "desert";
  }
  if (elevation > 0.58) {
    return "hill";
  }
  return "plain";
}

export function fertilityFor(type: TerrainType, elevation: number, moisture: number, temperature: number): number {
  const balance = 1 - Math.abs(moisture - 0.58) * 1.15 - Math.abs(temperature - 0.56) * 0.52;
  const base = clamp(balance - Math.max(0, elevation - 0.72) * 0.9, 0, 1);
  switch (type) {
    case "ocean":
      return clamp(0.08 + moisture * 0.1, 0, 0.22);
    case "coast":
      return clamp(0.42 + base * 0.42, 0.28, 0.82);
    case "plain":
      return clamp(0.38 + base * 0.55, 0.22, 1);
    case "hill":
      return clamp(0.25 + base * 0.42, 0.16, 0.74);
    case "mountain":
      return clamp(0.06 + moisture * 0.18, 0.04, 0.34);
    case "wetland":
      return clamp(0.55 + temperature * 0.28, 0.45, 0.92);
    case "desert":
      return clamp(0.06 + moisture * 0.2, 0.04, 0.28);
    case "tundra":
      return clamp(0.12 + moisture * 0.22, 0.08, 0.38);
    case "snow":
      return clamp(0.03 + moisture * 0.08, 0.02, 0.16);
  }
}

export function movementTerrainValue(
  type: TerrainType,
  elevation: number,
  moisture: number,
  config: SimulationConfig
): number {
  const oldMovement = legacyMovementTerrainAtRaw(elevation, moisture, type);
  const thresholdBias = config.barrierThreshold <= 0.8 ? 0.04 : 0;
  return clamp(oldMovement + thresholdBias, 0, 1);
}

export function barrierFor(type: TerrainType, movementTerrain: number, config: SimulationConfig): boolean {
  const threshold = clamp(config.barrierThreshold, 0, 1.01);
  if (threshold > 1) {
    return false;
  }
  if (type === "ocean") {
    return true;
  }
  return movementTerrain >= threshold;
}

export function biomeCountsFor(terrain: StaticTerrain): Record<TerrainType, number> {
  const counts = emptyBiomeCounts();
  for (const type of terrain.terrainType) {
    counts[type] += 1;
  }
  return counts;
}

export function emptyBiomeCounts(): Record<TerrainType, number> {
  return {
    ocean: 0,
    coast: 0,
    plain: 0,
    hill: 0,
    mountain: 0,
    wetland: 0,
    desert: 0,
    tundra: 0,
    snow: 0
  };
}

export function legacyResourceTerrainAt(x: number, y: number, config: SimulationConfig): number {
  const cell = terrainCellAt(x, y, config);
  return clamp(cell.fertilityBase * config.resourceCap * (cell.terrainType === "ocean" ? 0.38 : 0.95), 0, config.resourceCap);
}

export function resourceTerrainAt(x: number, y: number, config: SimulationConfig = DEFAULTS): number {
  return legacyResourceTerrainAt(x, y, config);
}

export function resourceFertilityAt(x: number, y: number, config: SimulationConfig = DEFAULTS): number {
  if (config.resourceCap <= 0) {
    return 0;
  }
  return clamp(resourceTerrainAt(x, y, config) / Math.max(0.0001, config.resourceCap * 0.9), 0, 1);
}

export function movementTerrainAt(x: number, y: number, config: SimulationConfig = DEFAULTS): number {
  return terrainCellAt(x, y, config).movementTerrain;
}

export function movementCostAt(x: number, y: number, config: SimulationConfig = DEFAULTS): number {
  return terrainCellAt(x, y, config).movementCost;
}

export function isBarrierAt(x: number, y: number, config: SimulationConfig = DEFAULTS): boolean {
  return terrainCellAt(x, y, config).barrier;
}

function legacyMovementTerrainAtRaw(elevation: number, moisture: number, type: TerrainType): number {
  const slopeLike = clamp((elevation - 0.35) * 1.4, 0, 1);
  const wetDrag = type === "wetland" ? 0.45 : 0;
  const oceanDrag = type === "ocean" ? 1 : 0;
  const mountainDrag = type === "mountain" ? 0.8 : type === "hill" ? 0.42 : 0;
  const desertDrag = type === "desert" ? 0.22 : 0;
  const coldDrag = type === "snow" ? 0.72 : type === "tundra" ? 0.3 : 0;
  return clamp(slopeLike * 0.42 + moisture * 0.08 + wetDrag + oceanDrag + mountainDrag + desertDrag + coldDrag, 0, 1);
}
