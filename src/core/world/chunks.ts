import type {
  ChunkActivity,
  ChunkGrid,
  ChunkRecord,
  ChunkSchedulerStats,
  ChunkSummary,
  DynamicFields,
  RegionGraph,
  RegionSummary,
  SimulationConfig,
  StaticTerrain,
  TerrainType
} from "../types";

export const CHUNK_DIRTY = {
  resource: 1,
  trace: 2,
  pressure: 4,
  moisture: 8,
  agents: 16,
  process: 32,
  summary: 64,
  all: 127
} as const;

export const FIELD_DIRTY_MASK =
  CHUNK_DIRTY.resource | CHUNK_DIRTY.trace | CHUNK_DIRTY.pressure | CHUNK_DIRTY.moisture | CHUNK_DIRTY.process;

const LARGE_WORLD_FIELD_CATCHUP_INTERVAL_SCALE = 2;
const REGION_SIZE_IN_CHUNKS = 4;

export type ChunkFieldUpdateLane = "activeEnvironment" | "warmEnvironment" | "sleepingCatchup";

export interface ChunkFieldUpdateDecision {
  shouldUpdate: boolean;
  lane: ChunkFieldUpdateLane;
}

export interface ChunkFieldUpdateCadence {
  warmInterval: number;
  sleepingInterval: number;
}

export function createChunkGrid(config: SimulationConfig, terrain: StaticTerrain, fields: DynamicFields): ChunkGrid {
  const chunkSize = Math.max(4, Math.floor(config.chunkSize));
  const columns = Math.ceil(config.width / chunkSize);
  const rows = Math.ceil(config.height / chunkSize);
  const chunks: ChunkRecord[] = [];
  const cellToChunk = new Uint32Array(config.width * config.height);

  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < columns; cx += 1) {
      const id = cy * columns + cx;
      const startX = cx * chunkSize;
      const startY = cy * chunkSize;
      const endX = Math.min(config.width, startX + chunkSize);
      const endY = Math.min(config.height, startY + chunkSize);
      const chunk: ChunkRecord = {
        id,
        x: cx,
        y: cy,
        startX,
        startY,
        endX,
        endY,
        width: endX - startX,
        height: endY - startY,
        regionId: 0,
        lastUpdatedTick: 0,
        lastTouchedTick: 0,
        activity: "sleeping",
        dirtyMask: 0,
        fieldDirtyMask: 0,
        fieldWriteMask: 0,
        projectionDirtyMask: CHUNK_DIRTY.all,
        summaryDirty: true,
        projectionDirty: true,
        pressureDiffusionActive: false,
        pressureFrontierLastActiveTick: 0,
        pressureFrontierStaleTicks: 0,
        pressureWriteCells: 0,
        pressureWriteImpulse: 0,
        pressureWriteLastTick: 0,
        pressureWriteMaxDelta: 0,
        agentCount: 0,
        summary: emptyChunkSummary(id)
      };
      chunks.push(chunk);

      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          cellToChunk[y * config.width + x] = id;
        }
      }
    }
  }

  const grid: ChunkGrid = {
    chunkSize,
    columns,
    rows,
    chunks,
    cellToChunk,
    schedulerStats: createSchedulerStats(chunks.length)
  };

  for (const chunk of grid.chunks) {
    refreshChunkSummary(grid, chunk, terrain, fields, config.width);
  }
  grid.schedulerStats = {
    ...grid.schedulerStats,
    activeChunks: 0,
    warmChunks: 0,
    sleepingChunks: grid.chunks.length,
    dirtyChunks: 0
  };

  return grid;
}

export function createRegionGraph(
  grid: ChunkGrid,
  terrain: StaticTerrain,
  fields: DynamicFields,
  width: number
): RegionGraph {
  const columns = Math.ceil(grid.columns / REGION_SIZE_IN_CHUNKS);
  const rows = Math.ceil(grid.rows / REGION_SIZE_IN_CHUNKS);
  const chunkToRegion = new Uint32Array(grid.chunks.length);
  const regions: RegionSummary[] = [];

  for (let ry = 0; ry < rows; ry += 1) {
    for (let rx = 0; rx < columns; rx += 1) {
      const id = ry * columns + rx;
      regions.push({
        id,
        x: rx,
        y: ry,
        chunkIds: [],
        neighborIds: [],
        corridorHints: [],
        dominantBiome: null,
        averageFertility: 0,
        averageMovementCost: 0,
        barrierRatio: 0,
        resource: 0,
        pressure: 0,
        trace: 0,
        agentCount: 0
      });
    }
  }

  for (const chunk of grid.chunks) {
    const regionX = Math.floor(chunk.x / REGION_SIZE_IN_CHUNKS);
    const regionY = Math.floor(chunk.y / REGION_SIZE_IN_CHUNKS);
    const regionId = regionY * columns + regionX;
    chunk.regionId = regionId;
    chunk.summary.regionId = regionId;
    chunkToRegion[chunk.id] = regionId;
    regions[regionId].chunkIds.push(chunk.id);
  }

  for (const region of regions) {
    region.neighborIds = regionNeighbors(region.x, region.y, columns, rows);
    refreshRegionSummary(region, grid, terrain, fields, width);
  }

  return {
    regionSizeInChunks: REGION_SIZE_IN_CHUNKS,
    columns,
    rows,
    chunkToRegion,
    regions
  };
}

export function createSchedulerStats(totalChunks: number): ChunkSchedulerStats {
  return {
    tick: 0,
    totalChunks,
    activeChunks: totalChunks,
    warmChunks: 0,
    sleepingChunks: 0,
    dirtyChunks: totalChunks,
    activeAgentOnlyChunks: 0,
    activeFieldDirtyChunks: 0,
    activeMixedDirtyChunks: 0,
    directFieldWriteChunks: 0,
    directResourceWriteChunks: 0,
    directTraceWriteChunks: 0,
    directPressureWriteChunks: 0,
    directMixedFieldWriteChunks: 0,
    directPressureCandidateChunks: 0,
    directPressureRegionCandidateChunks: 0,
    directPressurePromotionBudget: 0,
    directPressurePromotedChunks: 0,
    directPressureSuppressedChunks: 0,
    directPressureWriteImpulse: 0,
    effectiveWarmChunkInterval: 0,
    effectiveSleepingChunkInterval: 0,
    diffusionBackgroundSourceChunks: 0,
    warmFieldUpdateChunks: 0,
    sleepingFieldUpdateChunks: 0,
    updatedChunks: 0,
    updatedCells: 0,
    preciseFieldUpdates: 0,
    catchUpFieldUpdates: 0,
    activeEnvironmentChunks: 0,
    warmEnvironmentChunks: 0,
    sleepingCatchupChunks: 0,
    summaryRefreshChunks: 0,
    summaryRefreshRegions: 0,
    diffusionChunks: 0,
    diffusionSeedChunks: 0,
    diffusionNeighborChunks: 0,
    diffusionSelectedChunks: 0,
    diffusionEffectiveChunks: 0,
    diffusionFrontierChunks: 0,
    diffusionStaleFrontierChunks: 0,
    diffusionAgedOutFrontierChunks: 0,
    diffusionRetainedFrontierChunks: 0,
    diffusionDeferredChunks: 0,
    diffusionNearZeroCandidateChunks: 0,
    diffusionNearZeroSkippedChunks: 0,
    diffusionSkippedBackgroundChunks: 0,
    lastTickPlan: null,
    lastTickReport: null
  };
}

export function chunkIdForCell(grid: ChunkGrid, width: number, height: number, x: number, y: number): number {
  const xx = ((x % width) + width) % width;
  const yy = ((y % height) + height) % height;
  return grid.cellToChunk[yy * width + xx];
}

export function chunkIdForIndex(grid: ChunkGrid, index: number): number {
  return grid.cellToChunk[index];
}

export function touchChunk(grid: ChunkGrid, chunkId: number, tick: number, dirtyMask: number = CHUNK_DIRTY.summary): void {
  const chunk = grid.chunks[chunkId];
  if (!chunk) {
    return;
  }
  const fieldMask = dirtyMask & FIELD_DIRTY_MASK;
  chunk.lastTouchedTick = Math.max(chunk.lastTouchedTick, tick);
  chunk.activity = "active";
  chunk.dirtyMask |= dirtyMask;
  chunk.fieldDirtyMask |= fieldMask;
  chunk.projectionDirtyMask |= dirtyMask;
  if (fieldMask & CHUNK_DIRTY.pressure) {
    chunk.pressureDiffusionActive = true;
    chunk.pressureFrontierLastActiveTick = tick;
    chunk.pressureFrontierStaleTicks = 0;
  }
  chunk.summaryDirty = true;
  chunk.projectionDirty = true;
}

export function touchChunkFieldWrite(grid: ChunkGrid, chunkId: number, tick: number, fieldMask: number): void {
  const chunk = grid.chunks[chunkId];
  if (!chunk) {
    return;
  }
  const mask = fieldMask & FIELD_DIRTY_MASK;
  chunk.lastTouchedTick = Math.max(chunk.lastTouchedTick, tick);
  chunk.activity = "active";
  chunk.fieldWriteMask |= mask;
  chunk.projectionDirtyMask |= mask;
  chunk.summaryDirty = true;
  chunk.projectionDirty = true;
}

export function recordChunkPressureWriteCandidate(
  grid: ChunkGrid,
  chunkId: number,
  tick: number,
  pressureDelta = 0
): void {
  const chunk = grid.chunks[chunkId];
  if (!chunk) {
    return;
  }
  const delta = Math.max(0, pressureDelta);
  if (chunk.pressureWriteLastTick !== tick) {
    chunk.pressureWriteCells = 0;
    chunk.pressureWriteImpulse = 0;
    chunk.pressureWriteMaxDelta = 0;
    chunk.pressureWriteLastTick = tick;
  }
  chunk.pressureWriteCells += 1;
  chunk.pressureWriteImpulse += delta;
  chunk.pressureWriteMaxDelta = Math.max(chunk.pressureWriteMaxDelta, delta);
}

export function markChunkSummaryDirty(grid: ChunkGrid, chunkId: number): void {
  const chunk = grid.chunks[chunkId];
  if (!chunk) {
    return;
  }
  chunk.summaryDirty = true;
  chunk.projectionDirtyMask |= CHUNK_DIRTY.summary;
  chunk.projectionDirty = true;
}

export function markChunkProjectionDirty(grid: ChunkGrid, chunkId: number, dirtyMask: number = CHUNK_DIRTY.all): void {
  const chunk = grid.chunks[chunkId];
  if (chunk) {
    chunk.projectionDirtyMask |= dirtyMask;
    chunk.projectionDirty = true;
  }
}

export function touchCell(grid: ChunkGrid, index: number, tick: number, dirtyMask: number = CHUNK_DIRTY.summary): void {
  touchChunk(grid, chunkIdForIndex(grid, index), tick, dirtyMask);
}

export function touchCellFieldWrite(grid: ChunkGrid, index: number, tick: number, fieldMask: number): void {
  touchChunkFieldWrite(grid, chunkIdForIndex(grid, index), tick, fieldMask);
}

export function touchCellPressureFieldWrite(
  grid: ChunkGrid,
  index: number,
  tick: number,
  fieldMask: number,
  pressureDelta: number
): void {
  const chunkId = chunkIdForIndex(grid, index);
  touchChunkFieldWrite(grid, chunkId, tick, fieldMask);
  if (fieldMask & CHUNK_DIRTY.pressure) {
    recordChunkPressureWriteCandidate(grid, chunkId, tick, pressureDelta);
  }
}

export function touchArea(
  grid: ChunkGrid,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
  tick: number,
  dirtyMask: number = CHUNK_DIRTY.summary
): void {
  const chunkRadius = Math.ceil(Math.max(0, radius) / grid.chunkSize) + 1;
  const centerChunk = grid.chunks[chunkIdForCell(grid, width, height, x, y)];
  for (let dy = -chunkRadius; dy <= chunkRadius; dy += 1) {
    for (let dx = -chunkRadius; dx <= chunkRadius; dx += 1) {
      const cx = (centerChunk.x + dx + grid.columns) % grid.columns;
      const cy = (centerChunk.y + dy + grid.rows) % grid.rows;
      touchChunk(grid, cy * grid.columns + cx, tick, dirtyMask);
    }
  }
}

export function updateChunkActivity(
  grid: ChunkGrid,
  tick: number,
  warmInterval: number,
  sleepingInterval: number,
  allowInitialSleep = false
): void {
  const warmTicks = Math.max(1, Math.floor(warmInterval)) * 3;
  const sleepTicks = Math.max(warmTicks + 1, Math.floor(sleepingInterval) * 4);

  for (const chunk of grid.chunks) {
    if (allowInitialSleep && chunk.lastTouchedTick === 0 && chunk.agentCount === 0 && chunk.dirtyMask === 0 && chunk.fieldDirtyMask === 0) {
      chunk.activity = "sleeping";
      continue;
    }
    const age = tick - chunk.lastTouchedTick;
    if (chunk.agentCount > 0 || chunk.dirtyMask || chunk.fieldDirtyMask || age <= warmTicks) {
      chunk.activity = "active";
    } else if (age <= sleepTicks) {
      chunk.activity = "warm";
    } else {
      chunk.activity = "sleeping";
    }
  }
}

export function chunkShouldUpdate(chunk: ChunkRecord, tick: number, warmInterval: number, sleepingInterval: number): boolean {
  return chunkFieldUpdateDecision(chunk, tick, warmInterval, sleepingInterval).shouldUpdate;
}

export function chunkFieldUpdateCadence(config: SimulationConfig, largeWorld: boolean): ChunkFieldUpdateCadence {
  const scale = largeWorld ? LARGE_WORLD_FIELD_CATCHUP_INTERVAL_SCALE : 1;
  return {
    warmInterval: Math.max(1, Math.floor(config.warmChunkInterval) * scale),
    sleepingInterval: Math.max(1, Math.floor(config.sleepingChunkInterval) * scale)
  };
}

export function chunkFieldUpdateDecision(
  chunk: ChunkRecord,
  tick: number,
  warmInterval: number,
  sleepingInterval: number
): ChunkFieldUpdateDecision {
  const hasFieldDirty = Boolean(chunk.fieldDirtyMask & FIELD_DIRTY_MASK);
  if (hasFieldDirty) {
    return {
      shouldUpdate: true,
      lane: "activeEnvironment"
    };
  }

  const lane: ChunkFieldUpdateLane = chunk.activity === "sleeping" && chunk.agentCount === 0 ? "sleepingCatchup" : "warmEnvironment";
  const elapsed = tick - chunk.lastUpdatedTick;
  const interval = Math.max(1, Math.floor(lane === "warmEnvironment" ? warmInterval : sleepingInterval));

  return {
    shouldUpdate: elapsed >= interval && scheduledChunkPhase(chunk, tick, interval),
    lane
  };
}

export function resetChunkAgentCounts(grid: ChunkGrid): number[] {
  const changedChunkIds: number[] = [];
  for (const chunk of grid.chunks) {
    if (chunk.agentCount > 0 || chunk.summary.agentCount > 0) {
      chunk.summaryDirty = true;
      changedChunkIds.push(chunk.id);
    }
    chunk.agentCount = 0;
    chunk.summary.agentCount = 0;
  }
  return changedChunkIds;
}

export function recordAgentChunk(grid: ChunkGrid, width: number, height: number, x: number, y: number, tick: number): void {
  const chunk = grid.chunks[chunkIdForCell(grid, width, height, x, y)];
  if (chunk.agentCount === 0) {
    chunk.summaryDirty = true;
  }
  chunk.agentCount += 1;
  chunk.summary.agentCount = chunk.agentCount;
  chunk.lastTouchedTick = Math.max(chunk.lastTouchedTick, tick);
  chunk.activity = "active";
  chunk.projectionDirtyMask |= CHUNK_DIRTY.agents;
  chunk.projectionDirty = true;
}

export function refreshChunkSummary(
  grid: ChunkGrid,
  chunk: ChunkRecord,
  terrain: StaticTerrain,
  fields: DynamicFields,
  width: number
): ChunkSummary {
  let resource = 0;
  let trace = 0;
  let pressure = 0;
  let moistureDelta = 0;
  let fertility = 0;
  let movementCost = 0;
  let barriers = 0;
  const biomeCounts = new Map<TerrainType, number>();
  const cells = Math.max(1, chunk.width * chunk.height);

  for (let y = chunk.startY; y < chunk.endY; y += 1) {
    for (let x = chunk.startX; x < chunk.endX; x += 1) {
      const idx = y * width + x;
      resource += fields.resource[idx];
      trace += fields.trace[idx];
      pressure += fields.pressure[idx];
      moistureDelta += fields.moistureDelta[idx];
      fertility += terrain.fertilityBase[idx];
      movementCost += terrain.movementCost[idx];
      barriers += terrain.barrier[idx];
      const biome = terrain.terrainType[idx];
      biomeCounts.set(biome, (biomeCounts.get(biome) ?? 0) + 1);
    }
  }

  chunk.summary = {
    id: chunk.id,
    regionId: chunk.regionId,
    activity: chunk.activity,
    dirtyMask: chunk.dirtyMask,
    agentCount: chunk.agentCount,
    fieldDirtyMask: chunk.fieldDirtyMask,
    resource,
    trace,
    pressure,
    moistureDelta,
    averageFertility: fertility / cells,
    averageMovementCost: movementCost / cells,
    barrierRatio: barriers / cells,
    dominantBiome: dominantBiome(biomeCounts)
  };
  chunk.summaryDirty = false;
  return chunk.summary;
}

export function clearChunkProjectionDirty(grid: ChunkGrid, chunkId: number): void {
  const chunk = grid.chunks[chunkId];
  if (chunk) {
    chunk.projectionDirtyMask = 0;
    chunk.projectionDirty = false;
  }
}

export function consumeChunkProjectionDirty(grid: ChunkGrid, chunkId: number, visibleDependencyMask: number): number {
  const chunk = grid.chunks[chunkId];
  if (!chunk) {
    return 0;
  }
  const consumedMask = chunk.projectionDirtyMask & visibleDependencyMask;
  chunk.projectionDirtyMask &= ~visibleDependencyMask;
  chunk.projectionDirty = chunk.projectionDirtyMask !== 0;
  return consumedMask;
}

export function retireHiddenProjectionDirty(grid: ChunkGrid, visibleDependencyMask: number): number {
  let retiredChunks = 0;
  const hiddenMask = CHUNK_DIRTY.all & ~visibleDependencyMask;

  for (const chunk of grid.chunks) {
    const retiredMask = chunk.projectionDirtyMask & hiddenMask;
    if (!retiredMask) {
      continue;
    }
    chunk.projectionDirtyMask &= ~hiddenMask;
    chunk.projectionDirty = chunk.projectionDirtyMask !== 0;
    retiredChunks += 1;
  }

  return retiredChunks;
}

export function clearChunkFieldWriteMasks(grid: ChunkGrid): void {
  for (const chunk of grid.chunks) {
    chunk.fieldWriteMask = 0;
  }
}

export function clearChunkPressureWriteCandidates(grid: ChunkGrid, tick: number): void {
  for (const chunk of grid.chunks) {
    if (chunk.pressureWriteLastTick > tick) {
      continue;
    }
    chunk.pressureWriteCells = 0;
    chunk.pressureWriteImpulse = 0;
    chunk.pressureWriteMaxDelta = 0;
    chunk.pressureWriteLastTick = 0;
  }
}

export function refreshRegionSummary(
  region: RegionSummary,
  grid: ChunkGrid,
  terrain: StaticTerrain,
  fields: DynamicFields,
  width: number
): void {
  let chunks = 0;
  let resource = 0;
  let trace = 0;
  let pressure = 0;
  let fertility = 0;
  let movementCost = 0;
  let barrierRatio = 0;
  let agents = 0;
  const biomeCounts = new Map<TerrainType, number>();

  for (const chunkId of region.chunkIds) {
    const chunk = grid.chunks[chunkId];
    const summary = chunk.summaryDirty ? refreshChunkSummary(grid, chunk, terrain, fields, width) : chunk.summary;
    chunks += 1;
    resource += summary.resource;
    trace += summary.trace;
    pressure += summary.pressure;
    fertility += summary.averageFertility;
    movementCost += summary.averageMovementCost;
    barrierRatio += summary.barrierRatio;
    agents += summary.agentCount;
    if (summary.dominantBiome) {
      biomeCounts.set(summary.dominantBiome, (biomeCounts.get(summary.dominantBiome) ?? 0) + 1);
    }
  }

  region.resource = resource;
  region.trace = trace;
  region.pressure = pressure;
  region.averageFertility = chunks ? fertility / chunks : 0;
  region.averageMovementCost = chunks ? movementCost / chunks : 0;
  region.barrierRatio = chunks ? barrierRatio / chunks : 0;
  region.agentCount = agents;
  region.dominantBiome = dominantBiome(biomeCounts);
  region.corridorHints = corridorHints(region, grid);
}

export function refreshAllChunkSummaries(grid: ChunkGrid, terrain: StaticTerrain, fields: DynamicFields, width: number): void {
  for (const chunk of grid.chunks) {
    refreshChunkSummary(grid, chunk, terrain, fields, width);
  }
}

export function refreshDirtyChunkSummaries(
  grid: ChunkGrid,
  terrain: StaticTerrain,
  fields: DynamicFields,
  width: number
): number[] {
  const affectedRegions = new Set<number>();
  for (const chunk of grid.chunks) {
    if (!chunk.summaryDirty) {
      continue;
    }
    refreshChunkSummary(grid, chunk, terrain, fields, width);
    affectedRegions.add(chunk.regionId);
  }
  return [...affectedRegions].sort((a, b) => a - b);
}

export function refreshRegionsById(
  regions: RegionGraph,
  grid: ChunkGrid,
  terrain: StaticTerrain,
  fields: DynamicFields,
  width: number,
  regionIds: Iterable<number>
): void {
  for (const regionId of regionIds) {
    const region = regions.regions[regionId];
    if (region) {
      refreshRegionSummary(region, grid, terrain, fields, width);
    }
  }
}

export function refreshDirtyRegionSummaries(
  regions: RegionGraph,
  grid: ChunkGrid,
  terrain: StaticTerrain,
  fields: DynamicFields,
  width: number
): void {
  refreshRegionsById(regions, grid, terrain, fields, width, refreshDirtyChunkSummaries(grid, terrain, fields, width));
}

export function refreshAllRegionSummaries(
  regions: RegionGraph,
  grid: ChunkGrid,
  terrain: StaticTerrain,
  fields: DynamicFields,
  width: number
): void {
  for (const region of regions.regions) {
    refreshRegionSummary(region, grid, terrain, fields, width);
  }
}

export function countChunkActivities(grid: ChunkGrid): Pick<
  ChunkSchedulerStats,
  | "activeAgentOnlyChunks"
  | "activeChunks"
  | "activeFieldDirtyChunks"
  | "activeMixedDirtyChunks"
  | "directFieldWriteChunks"
  | "directMixedFieldWriteChunks"
  | "directPressureWriteChunks"
  | "directResourceWriteChunks"
  | "directTraceWriteChunks"
  | "directPressureCandidateChunks"
  | "directPressureWriteImpulse"
  | "dirtyChunks"
  | "sleepingChunks"
  | "warmChunks"
> {
  let activeChunks = 0;
  let warmChunks = 0;
  let sleepingChunks = 0;
  let dirtyChunks = 0;
  let activeAgentOnlyChunks = 0;
  let activeFieldDirtyChunks = 0;
  let activeMixedDirtyChunks = 0;
  let directFieldWriteChunks = 0;
  let directResourceWriteChunks = 0;
  let directTraceWriteChunks = 0;
  let directPressureWriteChunks = 0;
  let directMixedFieldWriteChunks = 0;
  let directPressureCandidateChunks = 0;
  let directPressureWriteImpulse = 0;

  for (const chunk of grid.chunks) {
    const fieldWriteMask = chunk.fieldWriteMask & FIELD_DIRTY_MASK;
    if (fieldWriteMask) {
      directFieldWriteChunks += 1;
      if (fieldWriteMask & CHUNK_DIRTY.resource) {
        directResourceWriteChunks += 1;
      }
      if (fieldWriteMask & CHUNK_DIRTY.trace) {
        directTraceWriteChunks += 1;
      }
      if (fieldWriteMask & CHUNK_DIRTY.pressure) {
        directPressureWriteChunks += 1;
      }
      if ((fieldWriteMask & (fieldWriteMask - 1)) !== 0) {
        directMixedFieldWriteChunks += 1;
      }
    }
    if (chunk.pressureWriteCells > 0 || chunk.pressureWriteImpulse > 0 || chunk.pressureWriteMaxDelta > 0) {
      directPressureCandidateChunks += 1;
      directPressureWriteImpulse += chunk.pressureWriteImpulse;
    }
    if (chunk.activity === "active") {
      activeChunks += 1;
      const hasAgents = chunk.agentCount > 0 || Boolean(chunk.dirtyMask & CHUNK_DIRTY.agents);
      const hasFieldDirty = Boolean(chunk.fieldDirtyMask & FIELD_DIRTY_MASK);
      if (hasAgents && hasFieldDirty) {
        activeMixedDirtyChunks += 1;
      } else if (hasAgents) {
        activeAgentOnlyChunks += 1;
      } else if (hasFieldDirty) {
        activeFieldDirtyChunks += 1;
      }
    } else if (chunk.activity === "warm") {
      warmChunks += 1;
    } else {
      sleepingChunks += 1;
    }
    if (chunk.dirtyMask || chunk.fieldDirtyMask) {
      dirtyChunks += 1;
    }
  }

  return {
    activeAgentOnlyChunks,
    activeChunks,
    activeFieldDirtyChunks,
    activeMixedDirtyChunks,
    directFieldWriteChunks,
    directMixedFieldWriteChunks,
    directPressureWriteChunks,
    directResourceWriteChunks,
    directPressureCandidateChunks,
    directPressureWriteImpulse,
    directTraceWriteChunks,
    dirtyChunks,
    sleepingChunks,
    warmChunks
  };
}

export function neighborChunkIds(grid: ChunkGrid, chunk: ChunkRecord): number[] {
  return [
    ((chunk.y + grid.rows - 1) % grid.rows) * grid.columns + chunk.x,
    ((chunk.y + 1) % grid.rows) * grid.columns + chunk.x,
    chunk.y * grid.columns + ((chunk.x + grid.columns - 1) % grid.columns),
    chunk.y * grid.columns + ((chunk.x + 1) % grid.columns)
  ];
}

function emptyChunkSummary(id: number): ChunkSummary {
  return {
    id,
    regionId: 0,
    activity: "active",
    dirtyMask: CHUNK_DIRTY.all,
    fieldDirtyMask: CHUNK_DIRTY.all,
    agentCount: 0,
    resource: 0,
    trace: 0,
    pressure: 0,
    moistureDelta: 0,
    averageFertility: 0,
    averageMovementCost: 0,
    barrierRatio: 0,
    dominantBiome: null
  };
}

function scheduledChunkPhase(chunk: ChunkRecord, tick: number, interval: number): boolean {
  return (tick + chunk.id) % interval === 0;
}

function regionNeighbors(x: number, y: number, columns: number, rows: number): number[] {
  return [
    ((y + rows - 1) % rows) * columns + x,
    ((y + 1) % rows) * columns + x,
    y * columns + ((x + columns - 1) % columns),
    y * columns + ((x + 1) % columns)
  ];
}

function corridorHints(region: RegionSummary, grid: ChunkGrid): number[] {
  return region.neighborIds
    .map((neighborId) => grid.chunks.find((chunk) => chunk.regionId === neighborId))
    .filter((chunk): chunk is ChunkRecord => Boolean(chunk))
    .sort((a, b) => b.summary.averageFertility - a.summary.averageFertility)
    .slice(0, 2)
    .map((chunk) => chunk.regionId);
}

function dominantBiome(counts: Map<TerrainType, number>): TerrainType | null {
  let best: TerrainType | null = null;
  let bestCount = 0;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}
