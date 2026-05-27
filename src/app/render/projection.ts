import type { BaseLayer, OverlayState } from "./mapViewTypes";
import { paintMapCell } from "./mapViews";
import { clearChunkProjectionDirty } from "../../core/primordia";
import type { EnvironmentCell, Simulation } from "../../core/primordia";

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
  const overlayKey = stableOverlayKey(overlays);
  const canReuse =
    previous &&
    previous.width === sim.width &&
    previous.height === sim.height &&
    previous.baseLayer === baseLayer &&
    previous.overlayKey === overlayKey &&
    previous.resourceCap === sim.config.resourceCap;

  const image = canReuse ? previous.image : new ImageData(sim.width, sim.height);
  const data = image.data;
  const chunks = canReuse
    ? sim.world.chunks.chunks.filter(
        (chunk) => chunk.projectionDirty || chunk.activity !== "sleeping" || chunk.dirtyMask || chunk.agentCount > 0
      )
    : sim.world.chunks.chunks;

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

function stableOverlayKey(overlays: OverlayState): string {
  return `${overlays.resources ? 1 : 0}${overlays.agents ? 1 : 0}${overlays.processes ? 1 : 0}${overlays.pressure ? 1 : 0}${
    overlays.lineages ? 1 : 0
  }`;
}
