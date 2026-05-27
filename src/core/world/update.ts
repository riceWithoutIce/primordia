import { clamp } from "../random/rng";
import {
  CHUNK_DIRTY,
  chunkShouldUpdate,
  countChunkActivities,
  markChunkProjectionDirty,
  neighborChunkIds,
  refreshChunkSummary,
  refreshDirtyRegionSummaries,
  refreshRegionsById,
  touchArea,
  touchChunk,
  updateChunkActivity
} from "./chunks";
import { maybeSpawnProcess, maybeTriggerEnvironmentalEvent, updateProcesses } from "./processes";
import { worldIndex } from "./world";
import type { ChunkRecord } from "../types";
import type { EnvironmentEventRecord, EnvironmentProcessRecord, RandomSource, SimulationConfig, WorldState } from "../types";

export interface EnvironmentUpdateResult {
  event: EnvironmentEventRecord | null;
  process: EnvironmentProcessRecord | null;
}

export function updateWorld(
  world: WorldState,
  config: SimulationConfig,
  tick: number,
  random: RandomSource,
  nearestOpenPoint: (x: number, y: number) => { x: number; y: number }
): EnvironmentUpdateResult {
  updateEnvironmentFields(world, config, tick, random);
  const updatedProcesses = updateProcesses(world, config);
  for (const activeProcess of updatedProcesses) {
    touchArea(
      world.chunks,
      world.width,
      world.height,
      activeProcess.x,
      activeProcess.y,
      activeProcess.radius,
      tick,
      CHUNK_DIRTY.process
    );
  }
  const process = maybeSpawnProcess(world, config, tick);
  const event = maybeTriggerEnvironmentalEvent(world, config, tick, nearestOpenPoint);
  if (process) {
    touchArea(world.chunks, world.width, world.height, process.x, process.y, process.radius, tick, CHUNK_DIRTY.process);
  }
  if (event) {
    touchArea(world.chunks, world.width, world.height, event.x, event.y, event.radius, tick, CHUNK_DIRTY.all);
  }
  refreshDirtyRegionSummaries(world.regions, world.chunks, world.terrain, world.fields, world.width);
  return { event, process };
}

export function updateEnvironmentFields(
  world: WorldState,
  config: SimulationConfig,
  tick: number,
  random: RandomSource
): void {
  const cap = config.resourceCap;
  updateChunkActivity(world.chunks, tick, config.warmChunkInterval, config.sleepingChunkInterval, world.size > 65536);
  let updatedChunks = 0;
  let updatedCells = 0;
  let preciseFieldUpdates = 0;
  let catchUpFieldUpdates = 0;

  for (const chunk of world.chunks.chunks) {
    if (!chunkShouldUpdate(chunk, tick, config.warmChunkInterval, config.sleepingChunkInterval)) {
      continue;
    }

    const elapsed = Math.max(1, tick - chunk.lastUpdatedTick);
    const isCatchUp = chunk.activity !== "active" && elapsed > 1;
    updatedChunks += 1;
    updatedCells += updateEnvironmentChunk(world, config, cap, chunk, elapsed, isCatchUp);
    markChunkProjectionDirty(world.chunks, chunk.id);
    if (isCatchUp) {
      catchUpFieldUpdates += 1;
    } else {
      preciseFieldUpdates += 1;
    }
    chunk.lastUpdatedTick = tick;
    chunk.dirtyMask = 0;
    refreshChunkSummary(world.chunks, chunk, world.terrain, world.fields, world.width);
  }

  const diffusionChunks = diffusePressure(world, config, tick);
  const activityCounts = countChunkActivities(world.chunks);
  world.chunks.schedulerStats = {
    tick,
    totalChunks: world.chunks.chunks.length,
    ...activityCounts,
    updatedChunks,
    updatedCells,
    preciseFieldUpdates,
    catchUpFieldUpdates,
    diffusionChunks
  };
}

function updateEnvironmentChunk(
  world: WorldState,
  config: SimulationConfig,
  cap: number,
  chunk: ChunkRecord,
  elapsed: number,
  isCatchUp: boolean
): number {
  let updatedCells = 0;
  const steps = isCatchUp ? Math.min(elapsed, Math.max(1, Math.floor(config.sleepingChunkInterval))) : 1;
  for (let y = chunk.startY; y < chunk.endY; y += 1) {
    for (let x = chunk.startX; x < chunk.endX; x += 1) {
      const i = y * world.width + x;
      if (config.environmentMode === "flux") {
        const fertility = terrainResourceFertility(world.terrain.fertilityBase[i], world.terrain.terrainType[i], config);
        const terrainFertility = world.terrain.fertilityBase[i];
        const moisture = clamp(world.terrain.moistureBase[i] + world.fields.moistureDelta[i] * 0.35, 0, 1.4);
        const terrainPenalty = world.terrain.terrainType[i] === "ocean" ? 0.25 : 1;
        const recoveryFactor = 1 / (1 + world.fields.pressure[i] * 0.55);
        const growthChance =
          config.resourceGrowth *
          steps *
          (0.18 + fertility * 0.72 + terrainFertility * 0.62 + moisture * 0.22) *
          recoveryFactor *
          terrainPenalty;
        const roll = deterministicFieldRandom(config, world, chunk, i, chunk.lastUpdatedTick + 1, "growth-roll");
        if (roll < Math.min(1, growthChance)) {
          const amountRoll = deterministicFieldRandom(config, world, chunk, i, chunk.lastUpdatedTick + 1, "growth-amount");
          const growthAmount =
            (0.12 + terrainFertility * 0.65 + moisture * 0.22) * recoveryFactor * amountRoll * 0.8 * Math.sqrt(steps);
          world.fields.resource[i] = clamp(world.fields.resource[i] + growthAmount, 0, cap);
        }
      }
      world.fields.trace[i] *= Math.pow(config.traceDecay, steps);
      world.fields.pressure[i] = clamp(
        world.fields.pressure[i] * Math.pow(config.pressureDecay, steps) + world.fields.trace[i] * config.pressureGrowth * steps,
        0,
        4
      );
      world.fields.moistureDelta[i] *= Math.pow(0.985, steps);
      if (world.fields.moistureDelta[i] < 0.0001) {
        world.fields.moistureDelta[i] = 0;
      }
      updatedCells += 1;
    }
  }
  return updatedCells;
}

export function diffusePressure(world: WorldState, config: SimulationConfig, tick = world.chunks.schedulerStats.tick): number {
  const diffusion = clamp(config.pressureDiffusion, 0, 0.25);
  if (diffusion <= 0) {
    return 0;
  }

  const pressure = world.fields.pressure;
  const chunksToDiffuse = new Set<number>();
  for (const chunk of world.chunks.chunks) {
    if (world.size > 65536 && chunk.activity === "sleeping" && !chunk.dirtyMask) {
      continue;
    }
    chunksToDiffuse.add(chunk.id);
    for (const neighborId of neighborChunkIds(world.chunks, chunk)) {
      chunksToDiffuse.add(neighborId);
    }
  }

  for (const chunkId of chunksToDiffuse) {
    const chunk = world.chunks.chunks[chunkId];
    for (let y = chunk.startY; y < chunk.endY; y += 1) {
      for (let x = chunk.startX; x < chunk.endX; x += 1) {
        const idx = worldIndex(world, x, y);
        const neighborAverage =
          (pressureForDiffusionNeighbor(world, chunksToDiffuse, pressure, idx, x + 1, y) +
            pressureForDiffusionNeighbor(world, chunksToDiffuse, pressure, idx, x - 1, y) +
            pressureForDiffusionNeighbor(world, chunksToDiffuse, pressure, idx, x, y + 1) +
            pressureForDiffusionNeighbor(world, chunksToDiffuse, pressure, idx, x, y - 1)) /
          4;
        world.fields.nextPressure[idx] = clamp(pressure[idx] * (1 - diffusion) + neighborAverage * diffusion, 0, 4);
      }
    }
  }
  for (const chunkId of chunksToDiffuse) {
    const chunk = world.chunks.chunks[chunkId];
    let pressureTotal = 0;
    for (let y = chunk.startY; y < chunk.endY; y += 1) {
      for (let x = chunk.startX; x < chunk.endX; x += 1) {
        const idx = y * world.width + x;
        const next = world.fields.nextPressure[idx];
        pressure[idx] = next;
        pressureTotal += next;
      }
    }
    chunk.summary.pressure = pressureTotal;
    markChunkProjectionDirty(world.chunks, chunk.id);
  }
  refreshRegionsById(
    world.regions,
    world.chunks,
    world.terrain,
    world.fields,
    world.width,
    new Set([...chunksToDiffuse].map((chunkId) => world.chunks.chunks[chunkId].regionId))
  );
  return chunksToDiffuse.size;
}

function pressureForDiffusionNeighbor(
  world: WorldState,
  chunksToDiffuse: Set<number>,
  pressure: Float32Array,
  currentIndex: number,
  x: number,
  y: number
): number {
  const neighborIndex = worldIndex(world, x, y);
  const neighborChunkId = world.chunks.cellToChunk[neighborIndex];
  if (!chunksToDiffuse.has(neighborChunkId)) {
    return pressure[currentIndex];
  }
  return pressure[neighborIndex];
}

function deterministicFieldRandom(
  config: SimulationConfig,
  world: WorldState,
  chunk: ChunkRecord,
  index: number,
  tick: number,
  channel: "growth-roll" | "growth-amount"
): number {
  const salt = channel === "growth-roll" ? 0x7c2f9a13 : 0x4b1d2f77;
  const x = index % world.width;
  const y = Math.floor(index / world.width);
  let h = Math.imul(x + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + 0x632be5ab, 0xc2b2ae35);
  h ^= Math.imul(chunk.id + 1, 0x27d4eb2d);
  h ^= Math.imul(tick + 1, 0x165667b1);
  h ^= Math.imul(config.seed + 1, 0x9e3779b1);
  h ^= Math.imul(world.width + world.height, 0xd3a2646c);
  h ^= salt;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967295;
}

function terrainResourceFertility(fertilityBase: number, terrainType: string, config: SimulationConfig): number {
  if (config.resourceCap <= 0) {
    return 0;
  }
  const terrainFactor = terrainType === "ocean" ? 0.38 : 0.95;
  return clamp((fertilityBase * terrainFactor) / 0.9, 0, 1);
}
