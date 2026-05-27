import { CHUNK_DIRTY } from "../../core/primordia";
import type { ChunkRecord } from "../../core/primordia";
import type { BaseLayer, OverlayLayer, OverlayState } from "./mapViewTypes";

export const STATIC_PROJECTION_DEPENDENCY = 0;

export function projectionDependencyMask(baseLayer: BaseLayer, overlays: OverlayState): number {
  let mask = baseLayerDependencyMask(baseLayer);

  if (overlays.resources && baseLayer !== "resource") {
    mask |= CHUNK_DIRTY.resource;
  }
  if (overlays.pressure && baseLayer !== "pressure") {
    mask |= CHUNK_DIRTY.pressure;
  }
  if (overlays.lineages) {
    mask |= CHUNK_DIRTY.moisture | CHUNK_DIRTY.pressure;
  }

  return mask;
}

export function projectionOverlayKey(overlays: OverlayState): string {
  return `${overlays.resources ? 1 : 0}${overlays.pressure ? 1 : 0}${overlays.lineages ? 1 : 0}`;
}

export function overlayAffectsProjection(overlay: OverlayLayer): boolean {
  return overlay === "resources" || overlay === "pressure" || overlay === "lineages";
}

export function chunkAffectsProjection(chunk: ChunkRecord, dependencyMask: number, canReuse: boolean): boolean {
  if (!canReuse) {
    return true;
  }

  if (dependencyMask === STATIC_PROJECTION_DEPENDENCY) {
    return false;
  }

  return Boolean((chunk.dirtyMask | chunk.projectionDirtyMask) & dependencyMask);
}

function baseLayerDependencyMask(baseLayer: BaseLayer): number {
  switch (baseLayer) {
    case "terrain":
    case "biome":
      return CHUNK_DIRTY.moisture;
    case "resource":
      return CHUNK_DIRTY.resource | CHUNK_DIRTY.trace | CHUNK_DIRTY.pressure;
    case "pressure":
      return CHUNK_DIRTY.pressure | CHUNK_DIRTY.trace | CHUNK_DIRTY.moisture;
  }
}
