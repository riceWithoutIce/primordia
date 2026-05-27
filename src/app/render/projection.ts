import type { BaseLayer, OverlayState } from "./mapViewTypes";
import { paintMapCell } from "./mapViews";
import { clearChunkProjectionDirty } from "../../core/primordia";
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

export function createProjection(
  sim: Simulation,
  baseLayer: BaseLayer,
  overlays: OverlayState,
  previous: ProjectionCache | null
): ProjectionCache {
  const overlayKey = projectionOverlayKey(overlays);
  const canReuse =
    previous &&
    previous.width === sim.width &&
    previous.height === sim.height &&
    previous.baseLayer === baseLayer &&
    previous.overlayKey === overlayKey &&
    previous.resourceCap === sim.config.resourceCap;

  const image = canReuse ? previous.image : new ImageData(sim.width, sim.height);
  const data = image.data;
  const visibleDependencyMask = projectionDependencyMask(baseLayer, overlays);
  const selection = selectProjectionChunks(sim.world.chunks.chunks, Boolean(canReuse), visibleDependencyMask);
  const chunks = selection.chunks;

  for (const chunk of chunks) {
    for (let y = chunk.startY; y < chunk.endY; y += 1) {
      for (let x = chunk.startX; x < chunk.endX; x += 1) {
        const index = y * sim.width + x;
        const cell = sim.environmentAt(index);
        paintMapCell(data, index * 4, cell, baseLayer, overlays, sim.config.resourceCap);
      }
    }
    clearChunkProjectionDirty(sim.world.chunks, chunk.id);
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
