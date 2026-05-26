import { hash2d } from "../random/rng";
import { clamp } from "../random/rng";
import { worldIndex } from "./world";
import type {
  EnvironmentEventRecord,
  EnvironmentProcessRecord,
  SimulationConfig,
  TerrainType,
  WorldState
} from "../types";

export function maybeSpawnProcess(world: WorldState, config: SimulationConfig, tick: number): EnvironmentProcessRecord | null {
  if (config.environmentMode !== "flux") {
    return null;
  }

  const interval = Math.floor(config.processInterval);
  if (interval <= 0 || tick % interval !== 0) {
    return null;
  }

  return spawnMoistureFront(world, config, tick);
}

export function spawnMoistureFront(world: WorldState, config: SimulationConfig, tick: number): EnvironmentProcessRecord | null {
  const radius = Math.max(1, Math.round(config.processRadius));
  const duration = Math.max(1, Math.round(config.processDuration));
  const intensity = Math.max(0, config.processIntensity);
  if (intensity <= 0) {
    return null;
  }

  const yRoll = hash2d(tick, 71, config.seed ^ 0xe12c942f);
  const directionRoll = hash2d(tick, 97, config.seed ^ 0x7f4a7c15);
  const fromWest = directionRoll < 0.68;
  const process: EnvironmentProcessRecord = {
    id: world.nextProcessId,
    kind: "moisture-front",
    startTick: tick,
    age: 0,
    duration,
    radius,
    intensity,
    x: fromWest ? 0 : world.width - 1,
    y: Math.floor(yRoll * world.height) % world.height,
    dx: fromWest ? 1 : -1,
    dy: hash2d(tick, 113, config.seed ^ 0xc2b2ae35) < 0.5 ? 0 : 1,
    affectedCells: 0,
    active: true
  };

  world.nextProcessId += 1;
  world.processes.push(process);
  return process;
}

export function updateProcesses(world: WorldState, config: SimulationConfig): void {
  if (world.processes.length === 0) {
    return;
  }

  const active: EnvironmentProcessRecord[] = [];
  for (const process of world.processes) {
    process.age += 1;
    process.x = (process.x + process.dx + world.width) % world.width;
    if (process.age % 3 === 0) {
      process.y = (process.y + process.dy + world.height) % world.height;
    }
    process.affectedCells = applyMoistureFront(world, config, process);
    process.active = process.age < process.duration;
    if (process.active) {
      active.push(process);
    } else {
      world.processHistory.push({ ...process, active: false });
    }
  }
  world.processes = active;
}

export function applyMoistureFront(
  world: WorldState,
  config: SimulationConfig,
  process: EnvironmentProcessRecord
): number {
  let affectedCells = 0;
  const life = 1 - process.age / Math.max(1, process.duration);
  const radius = Math.max(1, Math.round(process.radius * (0.7 + life * 0.45)));

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const distance = Math.abs(dx) + Math.abs(dy);
      if (distance > radius) {
        continue;
      }
      const x = process.x + dx;
      const y = process.y + dy;
      const idx = worldIndex(world, x, y);
      const type = world.terrain.terrainType[idx];
      if (type === "mountain" && distance > radius * 0.45) {
        continue;
      }

      const terrainBoost = processTerrainBoost(type);
      const falloff = 1 - distance / (radius + 1);
      const effect = process.intensity * falloff * life * terrainBoost;
      world.fields.moistureDelta[idx] = clamp(world.fields.moistureDelta[idx] + effect * 0.08, 0, 3);
      world.fields.trace[idx] = clamp(world.fields.trace[idx] + effect * 0.025, 0, 12);
      world.fields.pressure[idx] = clamp(world.fields.pressure[idx] + effect * 0.018, 0, 4);
      if (config.environmentMode === "flux" && type !== "ocean") {
        world.fields.resource[idx] = clamp(world.fields.resource[idx] + effect * 0.05, 0, config.resourceCap);
      }
      affectedCells += 1;
    }
  }

  return affectedCells;
}

export function maybeTriggerEnvironmentalEvent(
  world: WorldState,
  config: SimulationConfig,
  tick: number,
  nearestOpenPoint: (x: number, y: number) => { x: number; y: number }
): EnvironmentEventRecord | null {
  if (config.environmentMode !== "flux") {
    return null;
  }

  const interval = Math.floor(config.eventInterval);
  if (interval <= 0 || tick % interval !== 0) {
    return null;
  }

  return triggerEnvironmentalEvent(world, config, tick, nearestOpenPoint);
}

export function triggerEnvironmentalEvent(
  world: WorldState,
  config: SimulationConfig,
  tick: number,
  nearestOpenPoint: (x: number, y: number) => { x: number; y: number }
): EnvironmentEventRecord | null {
  const radius = Math.max(0, Math.round(config.eventRadius));
  const intensity = Math.max(0, config.eventIntensity);
  if (radius <= 0 || intensity <= 0 || world.size <= 0) {
    return null;
  }

  const xRoll = hash2d(tick, 17, config.seed ^ 0x51ed270f);
  const yRoll = hash2d(tick, 29, config.seed ^ 0x9e3779b9);
  const kindRoll = hash2d(tick, 43, config.seed ^ 0x85ebca6b);
  const originX = Math.floor(xRoll * world.width) % world.width;
  const originY = Math.floor(yRoll * world.height) % world.height;
  const center = nearestOpenPoint(originX, originY);
  const kind = kindRoll < 0.58 ? "bloom" : "pressure";
  let affectedCells = 0;

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const distance = Math.abs(dx) + Math.abs(dy);
      if (distance > radius) {
        continue;
      }

      const x = center.x + dx;
      const y = center.y + dy;
      const idx = worldIndex(world, x, y);
      if (world.terrain.barrier[idx]) {
        continue;
      }

      const falloff = 1 - distance / (radius + 1);
      const fertility = world.terrain.fertilityBase[idx];
      if (kind === "bloom") {
        const moistureBoost = 1 + world.fields.moistureDelta[idx] * 0.12;
        const amount = intensity * falloff * (0.55 + fertility * 0.75) * moistureBoost;
        world.fields.resource[idx] = clamp(world.fields.resource[idx] + amount, 0, config.resourceCap);
        world.fields.trace[idx] = clamp(world.fields.trace[idx] + falloff * 0.12, 0, 12);
      } else {
        world.fields.pressure[idx] = clamp(world.fields.pressure[idx] + intensity * falloff * 0.55, 0, 4);
        world.fields.trace[idx] = clamp(world.fields.trace[idx] + falloff * 0.28, 0, 12);
      }
      affectedCells += 1;
    }
  }

  return {
    tick,
    kind,
    x: center.x,
    y: center.y,
    radius,
    intensity,
    affectedCells
  };
}

function processTerrainBoost(type: TerrainType): number {
  switch (type) {
    case "ocean":
      return 1.3;
    case "coast":
      return 1.18;
    case "wetland":
      return 1.08;
    case "plain":
      return 0.92;
    case "hill":
      return 0.78;
    case "mountain":
      return 0.55;
    case "desert":
      return 0.68;
    case "tundra":
      return 0.64;
    case "snow":
      return 0.46;
  }
}
