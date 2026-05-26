import { DEFAULTS } from "../config/defaults";
import { hash2d } from "../random/rng";
import { barrierFor, createTerrain, resourceFertilityAt, resourceTerrainAt, terrainCellAt } from "./terrain";
import type { EnvironmentCell, SimulationConfig, TerrainCell, WorldState } from "../types";

export function createWorld(config: SimulationConfig): WorldState {
  const terrain = createTerrain(config);
  const resource = new Float32Array(config.width * config.height);
  const trace = new Float32Array(config.width * config.height);
  const pressure = new Float32Array(config.width * config.height);
  const nextPressure = new Float32Array(config.width * config.height);
  const moistureDelta = new Float32Array(config.width * config.height);

  for (let i = 0; i < resource.length; i += 1) {
    const x = i % config.width;
    const y = Math.floor(i / config.width);
    resource[i] = resourceTerrainAt(x, y, config);
    trace[i] = 0;
    pressure[i] = hash2d(x, y, config.seed ^ 0x3a11f00d) * 0.28;
    moistureDelta[i] = 0;
  }

  return {
    width: config.width,
    height: config.height,
    size: config.width * config.height,
    terrain,
    fields: {
      resource,
      trace,
      pressure,
      nextPressure,
      moistureDelta
    },
    processes: [],
    processHistory: [],
    nextProcessId: 1
  };
}

export function worldIndex(world: WorldState, x: number, y: number): number {
  const xx = (x + world.width) % world.width;
  const yy = (y + world.height) % world.height;
  return yy * world.width + xx;
}

export function terrainAt(world: WorldState, x: number, y: number): TerrainCell {
  const idx = worldIndex(world, x, y);
  return {
    elevation: world.terrain.elevation[idx],
    moistureBase: world.terrain.moistureBase[idx],
    temperatureBase: world.terrain.temperatureBase[idx],
    fertilityBase: world.terrain.fertilityBase[idx],
    movementCost: world.terrain.movementCost[idx],
    movementTerrain: world.terrain.movementTerrain[idx],
    terrainType: world.terrain.terrainType[idx],
    barrier: Boolean(world.terrain.barrier[idx])
  };
}

export function environmentAt(world: WorldState, index: number, config: SimulationConfig = DEFAULTS): EnvironmentCell {
  const idx = ((index % world.size) + world.size) % world.size;
  const x = idx % world.width;
  const y = Math.floor(idx / world.width);
  const moisture = world.terrain.moistureBase[idx] + world.fields.moistureDelta[idx] * 0.35;
  const pressureLoad = world.fields.pressure[idx] / 4;
  const fertility = Math.max(
    0,
    Math.min(1, resourceFertilityAt(x, y, config) * (0.72 + moisture * 0.38) * (1 - pressureLoad * 0.18))
  );

  return {
    resource: world.fields.resource[idx],
    fertility,
    movementCost: world.terrain.movementCost[idx],
    movementTerrain: world.terrain.movementTerrain[idx],
    barrier: barrierFor(world.terrain.terrainType[idx], world.terrain.movementTerrain[idx], config),
    trace: world.fields.trace[idx],
    pressure: world.fields.pressure[idx],
    moistureDelta: world.fields.moistureDelta[idx],
    elevation: world.terrain.elevation[idx],
    moistureBase: world.terrain.moistureBase[idx],
    temperatureBase: world.terrain.temperatureBase[idx],
    fertilityBase: world.terrain.fertilityBase[idx],
    terrainType: world.terrain.terrainType[idx]
  };
}

export function terrainCellAtWrapped(x: number, y: number, config: SimulationConfig): TerrainCell {
  return terrainCellAt((x + config.width) % config.width, (y + config.height) % config.height, config);
}
