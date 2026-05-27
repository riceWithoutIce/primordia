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

const REGION_SIZE_IN_CHUNKS = 4;

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
        summaryDirty: true,
        projectionDirty: true,
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
    updatedChunks: 0,
    updatedCells: 0,
    preciseFieldUpdates: 0,
    catchUpFieldUpdates: 0,
    diffusionChunks: 0
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
  chunk.lastTouchedTick = Math.max(chunk.lastTouchedTick, tick);
  chunk.activity = "active";
  chunk.dirtyMask |= dirtyMask;
  chunk.summaryDirty = true;
  chunk.projectionDirty = true;
}

export function markChunkSummaryDirty(grid: ChunkGrid, chunkId: number): void {
  const chunk = grid.chunks[chunkId];
  if (!chunk) {
    return;
  }
  chunk.summaryDirty = true;
  chunk.projectionDirty = true;
}

export function markChunkProjectionDirty(grid: ChunkGrid, chunkId: number): void {
  const chunk = grid.chunks[chunkId];
  if (chunk) {
    chunk.projectionDirty = true;
  }
}

export function touchCell(grid: ChunkGrid, index: number, tick: number, dirtyMask: number = CHUNK_DIRTY.summary): void {
  touchChunk(grid, chunkIdForIndex(grid, index), tick, dirtyMask);
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
    if (allowInitialSleep && chunk.lastTouchedTick === 0 && chunk.agentCount === 0 && chunk.dirtyMask === 0) {
      chunk.activity = "sleeping";
      continue;
    }
    const age = tick - chunk.lastTouchedTick;
    if (chunk.agentCount > 0 || chunk.dirtyMask || age <= warmTicks) {
      chunk.activity = "active";
    } else if (age <= sleepTicks) {
      chunk.activity = "warm";
    } else {
      chunk.activity = "sleeping";
    }
  }
}

export function chunkShouldUpdate(chunk: ChunkRecord, tick: number, warmInterval: number, sleepingInterval: number): boolean {
  if (chunk.activity === "active" || chunk.dirtyMask) {
    return true;
  }

  const elapsed = tick - chunk.lastUpdatedTick;
  if (chunk.activity === "warm") {
    const interval = Math.max(1, Math.floor(warmInterval));
    return elapsed >= interval && scheduledChunkPhase(chunk, tick, interval);
  }
  const interval = Math.max(1, Math.floor(sleepingInterval));
  return elapsed >= interval && scheduledChunkPhase(chunk, tick, interval);
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
  touchChunk(grid, chunk.id, tick, CHUNK_DIRTY.agents);
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
    chunk.projectionDirty = false;
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
  "activeChunks" | "warmChunks" | "sleepingChunks" | "dirtyChunks"
> {
  let activeChunks = 0;
  let warmChunks = 0;
  let sleepingChunks = 0;
  let dirtyChunks = 0;

  for (const chunk of grid.chunks) {
    if (chunk.activity === "active") {
      activeChunks += 1;
    } else if (chunk.activity === "warm") {
      warmChunks += 1;
    } else {
      sleepingChunks += 1;
    }
    if (chunk.dirtyMask) {
      dirtyChunks += 1;
    }
  }

  return { activeChunks, warmChunks, sleepingChunks, dirtyChunks };
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
