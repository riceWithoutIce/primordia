import { CHUNK_DIRTY } from "../../core/primordia";
import type { ChunkRecord } from "../../core/primordia";
import type { BaseLayer, OverlayLayer, OverlayState } from "./mapViewTypes";

export const STATIC_PROJECTION_DEPENDENCY = 0;

export function projectionDependencyMask(baseLayer: BaseLayer, overlays: OverlayState): number {
  return baseLayerDependencyMask(baseLayer);
}

export function projectionOverlayKey(overlays: OverlayState): string {
  void overlays;
  return "base";
}

export function overlayAffectsProjection(overlay: OverlayLayer): boolean {
  return false;
}

export function overlayDependencyMask(baseLayer: BaseLayer, overlays: OverlayState): number {
  let mask = 0;
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

export function chunkAffectsProjection(chunk: ChunkRecord, dependencyMask: number, canReuse: boolean): boolean {
  if (!canReuse) {
    return true;
  }

  if (dependencyMask === STATIC_PROJECTION_DEPENDENCY) {
    return false;
  }

  return Boolean(chunk.projectionDirtyMask & dependencyMask);
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
