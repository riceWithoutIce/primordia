import type { BaseLayer, OverlayState } from "./mapViewTypes";
import { paintMapCell, paintTerrainMapCell } from "./mapViews";
import { CHUNK_DIRTY, consumeChunkProjectionDirty, retireHiddenProjectionDirty } from "../../core/primordia";
import type { ChunkRecord, EnvironmentCell, Simulation } from "../../core/primordia";
import { chunkAffectsProjection, projectionDependencyMask, projectionOverlayKey } from "./renderDependencies";

export interface ProjectionCache {
  width: number;
  height: number;
  baseLayer: BaseLayer;
  overlayKey: string;
  resourceCap: number;
  image: ImageData;
}

export interface ProjectionProfileStats {
  consumedDirtyChunks: number;
  dirtyMaskChunks: number;
  fullRebuild: boolean;
  hiddenDirtyChunks: number;
  moistureDirtyChunks: number;
  projectedCells: number;
  projectedChunks: number;
  pressureDirtyChunks: number;
  resourceDirtyChunks: number;
  retainedDirtyChunks: number;
  retiredDirtyChunks: number;
  selectChunksMs: number;
  paintCellsMs: number;
  totalChunks: number;
  visibleDependencyMask: number;
}

export interface ProjectionProfileSink {
  imageFactory?: (width: number, height: number) => ImageData;
  now: () => number;
  recordProjection: (stats: ProjectionProfileStats) => void;
}

export function createProjection(
  sim: Simulation,
  baseLayer: BaseLayer,
  overlays: OverlayState,
  previous: ProjectionCache | null,
  profile?: ProjectionProfileSink | null
): ProjectionCache {
  const overlayKey = projectionOverlayKey(overlays);
  const canReuse =
    previous &&
    previous.width === sim.width &&
    previous.height === sim.height &&
    previous.baseLayer === baseLayer &&
    previous.overlayKey === overlayKey &&
    previous.resourceCap === sim.config.resourceCap;

  const image = canReuse ? previous.image : profile?.imageFactory?.(sim.width, sim.height) ?? new ImageData(sim.width, sim.height);
  const data = image.data;
  const visibleDependencyMask = projectionDependencyMask(baseLayer, overlays);
  const selectStart = profile?.now() ?? 0;
  const selection = selectProjectionChunks(sim.world.chunks.chunks, Boolean(canReuse), visibleDependencyMask);
  const selectChunksMs = profile ? profile.now() - selectStart : 0;
  const chunks = selection.chunks;
  const terrainFastPath = shouldUseTerrainProjectionFastPath(baseLayer, overlays);
  let projectedCells = 0;
  const dirtyStats = profile ? countProjectionDirtyStats(sim.world.chunks.chunks, visibleDependencyMask) : null;
  let consumedDirtyChunks = 0;
  const paintStart = profile?.now() ?? 0;

  for (const chunk of chunks) {
    if (profile) {
      projectedCells += chunk.width * chunk.height;
    }
    for (let y = chunk.startY; y < chunk.endY; y += 1) {
      for (let x = chunk.startX; x < chunk.endX; x += 1) {
        const index = y * sim.width + x;
        if (terrainFastPath) {
          paintTerrainMapCell(data, index * 4, sim.world.terrain, sim.world.fields, index);
        } else {
          const cell = sim.environmentAt(index);
          paintMapCell(data, index * 4, cell, baseLayer, overlays, sim.config.resourceCap);
        }
      }
    }
    if (consumeChunkProjectionDirty(sim.world.chunks, chunk.id, visibleDependencyMask)) {
      consumedDirtyChunks += 1;
    }
  }
  const retiredDirtyChunks = retireHiddenProjectionDirty(sim.world.chunks, visibleDependencyMask);
  const paintCellsMs = profile ? profile.now() - paintStart : 0;
  const retainedDirtyChunks = profile ? countRetainedProjectionDirtyChunks(sim.world.chunks.chunks) : 0;

  if (profile) {
    profile.recordProjection({
      consumedDirtyChunks,
      dirtyMaskChunks: dirtyStats?.dirtyMaskChunks ?? 0,
      fullRebuild: !canReuse,
      hiddenDirtyChunks: dirtyStats?.hiddenDirtyChunks ?? 0,
      moistureDirtyChunks: dirtyStats?.moistureDirtyChunks ?? 0,
      projectedCells,
      projectedChunks: chunks.length,
      pressureDirtyChunks: dirtyStats?.pressureDirtyChunks ?? 0,
      retainedDirtyChunks,
      retiredDirtyChunks,
      resourceDirtyChunks: dirtyStats?.resourceDirtyChunks ?? 0,
      selectChunksMs,
      paintCellsMs,
      totalChunks: sim.world.chunks.chunks.length,
      visibleDependencyMask
    });
  }

  return {
    width: sim.width,
    height: sim.height,
    baseLayer,
    overlayKey,
    resourceCap: sim.config.resourceCap,
    image
  };
}

export function shouldUseTerrainProjectionFastPath(baseLayer: BaseLayer, overlays: OverlayState): boolean {
  return baseLayer === "terrain" && !overlays.resources && !overlays.pressure && !overlays.lineages;
}

export function selectProjectionChunks(
  chunks: ChunkRecord[],
  canReuse: boolean,
  visibleDependencyMask: number
): {
  chunks: ChunkRecord[];
  reasonVisibleDependency: number;
  reasonProjectionDirty: number;
  reasonDirtyMask: number;
  reasonActiveOrWarm: number;
  reasonAgentCount: number;
} {
  let reasonProjectionDirty = 0;
  let reasonDirtyMask = 0;
  let reasonActiveOrWarm = 0;
  let reasonAgentCount = 0;
  let reasonVisibleDependency = 0;
  const selected: ChunkRecord[] = [];

  for (const chunk of chunks) {
    const byVisibleDependency = chunkAffectsProjection(chunk, visibleDependencyMask, canReuse);
    const byProjectionDirty = chunk.projectionDirty;
    const byDirtyMask = Boolean(chunk.dirtyMask || chunk.projectionDirtyMask);
    const byActivity = chunk.activity !== "sleeping";
    const byAgentCount = chunk.agentCount > 0;

    if (byVisibleDependency) {
      reasonVisibleDependency += 1;
    }
    if (byProjectionDirty) {
      reasonProjectionDirty += 1;
    }
    if (byDirtyMask) {
      reasonDirtyMask += 1;
    }
    if (byActivity) {
      reasonActiveOrWarm += 1;
    }
    if (byAgentCount) {
      reasonAgentCount += 1;
    }

    if (byVisibleDependency) {
      selected.push(chunk);
    }
  }

  return {
    chunks: selected,
    reasonVisibleDependency,
    reasonProjectionDirty,
    reasonDirtyMask,
    reasonActiveOrWarm,
    reasonAgentCount
  };
}

export function worldToScreenCell(
  x: number,
  y: number,
  worldWidth: number,
  worldHeight: number,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  return {
    x: ((x + 0.5) / worldWidth) * canvasWidth,
    y: ((y + 0.5) / worldHeight) * canvasHeight
  };
}

export function screenToWorldCell(
  x: number,
  y: number,
  worldWidth: number,
  worldHeight: number,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(worldWidth - 1, Math.floor((x / canvasWidth) * worldWidth))),
    y: Math.max(0, Math.min(worldHeight - 1, Math.floor((y / canvasHeight) * worldHeight)))
  };
}

export function cellForProjection(cell: EnvironmentCell): EnvironmentCell {
  return cell;
}

function countProjectionDirtyStats(
  chunks: ChunkRecord[],
  visibleDependencyMask: number
): {
  dirtyMaskChunks: number;
  hiddenDirtyChunks: number;
  moistureDirtyChunks: number;
  pressureDirtyChunks: number;
  resourceDirtyChunks: number;
} {
  let dirtyMaskChunks = 0;
  let hiddenDirtyChunks = 0;
  let moistureDirtyChunks = 0;
  let pressureDirtyChunks = 0;
  let resourceDirtyChunks = 0;

  for (const chunk of chunks) {
    const mask = chunk.projectionDirtyMask;
    if (mask & visibleDependencyMask) {
      dirtyMaskChunks += 1;
    }
    if (mask & ~visibleDependencyMask) {
      hiddenDirtyChunks += 1;
    }
    if (mask & CHUNK_DIRTY.moisture) {
      moistureDirtyChunks += 1;
    }
    if (mask & CHUNK_DIRTY.pressure) {
      pressureDirtyChunks += 1;
    }
    if (mask & CHUNK_DIRTY.resource) {
      resourceDirtyChunks += 1;
    }
  }

  return {
    dirtyMaskChunks,
    hiddenDirtyChunks,
    moistureDirtyChunks,
    pressureDirtyChunks,
    resourceDirtyChunks
  };
}

function countRetainedProjectionDirtyChunks(chunks: ChunkRecord[]): number {
  let retained = 0;
  for (const chunk of chunks) {
    if (chunk.projectionDirtyMask) {
      retained += 1;
    }
  }
  return retained;
}
