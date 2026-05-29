import type { BaseLayer, OverlayState } from "./mapViewTypes";
import { TERRAIN_RENDER_CONFIG, fertilityFromValues } from "./mapViews";
import type { ChunkRecord, Simulation } from "../../core/primordia";
import {
  chunkAffectsProjection,
  overlayDependencyMask,
  projectionDependencyMask,
  projectionOverlayKey
} from "./renderDependencies";

export interface FieldOverlayCache {
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  baseLayer: BaseLayer;
  overlayKey: string;
  resourceCap: number;
  image: ImageData;
}

export interface FieldOverlayProfileStats {
  consumedDirtyChunks: number;
  dirtyMaskChunks: number;
  fullRebuild: boolean;
  projectedCells: number;
  projectedChunks: number;
  visibleDependencyMask: number;
  paintCellsMs: number;
}

export interface FieldOverlayProfileSink {
  imageFactory?: (width: number, height: number) => ImageData;
  now: () => number;
  recordFieldOverlay: (stats: FieldOverlayProfileStats) => void;
}

const TRANSPARENT_PIXEL = [0, 0, 0, 0] as const;
const FIELD_OVERLAY_CELL_SIZE = 4;

export function createFieldOverlay(
  sim: Simulation,
  baseLayer: BaseLayer,
  overlays: OverlayState,
  previous: FieldOverlayCache | null,
  profile?: FieldOverlayProfileSink | null
): FieldOverlayCache | null {
  const visibleDependencyMask = overlayDependencyMask(baseLayer, overlays);
  if (visibleDependencyMask === 0) {
    return null;
  }

  const overlayKey = projectionOverlayKey(overlays);
  const baseDependencyMask = projectionDependencyMask(baseLayer, overlays);
  const overlayWidth = Math.ceil(sim.width / FIELD_OVERLAY_CELL_SIZE);
  const overlayHeight = Math.ceil(sim.height / FIELD_OVERLAY_CELL_SIZE);
  const canReuse =
    previous &&
    previous.width === overlayWidth &&
    previous.height === overlayHeight &&
    previous.sourceWidth === sim.width &&
    previous.sourceHeight === sim.height &&
    previous.baseLayer === baseLayer &&
    previous.overlayKey === overlayKey &&
    previous.resourceCap === sim.config.resourceCap;
  const image = canReuse ? previous.image : profile?.imageFactory?.(overlayWidth, overlayHeight) ?? new ImageData(overlayWidth, overlayHeight);
  const data = image.data;
  const chunks = selectOverlayChunks(sim.world.chunks.chunks, Boolean(canReuse), visibleDependencyMask);
  const dirtyMaskChunks = profile ? countVisibleOverlayDirtyChunks(sim.world.chunks.chunks, visibleDependencyMask) : 0;
  let projectedCells = 0;
  let consumedDirtyChunks = 0;
  const paintStart = profile?.now() ?? 0;

  for (const chunk of chunks) {
    if (profile) {
      projectedCells += overlayCellsForChunk(chunk);
    }
    paintOverlayChunk(data, overlayWidth, sim, chunk, baseLayer, overlays);
    if (consumeOverlayDirty(chunk, visibleDependencyMask & ~baseDependencyMask)) {
      consumedDirtyChunks += 1;
    }
  }

  if (profile) {
    profile.recordFieldOverlay({
      consumedDirtyChunks,
      dirtyMaskChunks,
      fullRebuild: !canReuse,
      projectedCells,
      projectedChunks: chunks.length,
      visibleDependencyMask,
      paintCellsMs: profile.now() - paintStart
    });
  }

  return {
    width: overlayWidth,
    height: overlayHeight,
    sourceWidth: sim.width,
    sourceHeight: sim.height,
    baseLayer,
    overlayKey,
    resourceCap: sim.config.resourceCap,
    image
  };
}

export function selectOverlayChunks(
  chunks: ChunkRecord[],
  canReuse: boolean,
  visibleDependencyMask: number
): ChunkRecord[] {
  if (visibleDependencyMask === 0) {
    return [];
  }
  return chunks.filter((chunk) => chunkAffectsProjection(chunk, visibleDependencyMask, canReuse));
}

function paintOverlayChunk(
  data: Uint8ClampedArray,
  overlayWidth: number,
  sim: Simulation,
  chunk: ChunkRecord,
  baseLayer: BaseLayer,
  overlays: OverlayState
): void {
  const terrain = sim.world.terrain;
  const fields = sim.world.fields;
  const resourceCap = sim.config.resourceCap;
  const startOverlayX = Math.floor(chunk.startX / FIELD_OVERLAY_CELL_SIZE);
  const startOverlayY = Math.floor(chunk.startY / FIELD_OVERLAY_CELL_SIZE);
  const endOverlayX = Math.ceil(chunk.endX / FIELD_OVERLAY_CELL_SIZE);
  const endOverlayY = Math.ceil(chunk.endY / FIELD_OVERLAY_CELL_SIZE);
  const sampleOffset = Math.floor(FIELD_OVERLAY_CELL_SIZE / 2);

  for (let oy = startOverlayY; oy < endOverlayY; oy += 1) {
    const y = Math.min(sim.height - 1, oy * FIELD_OVERLAY_CELL_SIZE + sampleOffset);
    for (let ox = startOverlayX; ox < endOverlayX; ox += 1) {
      const x = Math.min(sim.width - 1, ox * FIELD_OVERLAY_CELL_SIZE + sampleOffset);
      const index = y * sim.width + x;
      const offset = (oy * overlayWidth + ox) * 4;
      data[offset] = TRANSPARENT_PIXEL[0];
      data[offset + 1] = TRANSPARENT_PIXEL[1];
      data[offset + 2] = TRANSPARENT_PIXEL[2];
      data[offset + 3] = TRANSPARENT_PIXEL[3];

      if (overlays.resources && baseLayer !== "resource") {
        const amount = resourceCap > 0 ? Math.min(fields.resource[index] / resourceCap, 1) : 0;
        if (amount > 0.02) {
          blendOverlayPixel(data, offset, [126, 225, 118], amount * TERRAIN_RENDER_CONFIG.resourceOverlayStrength);
        }
      }
      if (overlays.pressure && baseLayer !== "pressure") {
        const amount = Math.min(fields.pressure[index] / 4, 1);
        if (amount > 0.02) {
          blendOverlayPixel(data, offset, [224, 76, 84], amount * TERRAIN_RENDER_CONFIG.pressureOverlayStrength);
        }
      }
      if (overlays.lineages) {
        const fertility = fertilityFromValues(terrain, fields, sim.config, index);
        blendOverlayPixel(data, offset, [236, 212, 104], fertility * TERRAIN_RENDER_CONFIG.lineageOverlayStrength);
      }
    }
  }
}

function blendOverlayPixel(data: Uint8ClampedArray, offset: number, color: [number, number, number], amount: number): void {
  const sourceAlpha = Math.max(0, Math.min(1, amount));
  if (sourceAlpha <= 0) {
    return;
  }

  const targetAlpha = data[offset + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) {
    return;
  }

  data[offset] = Math.round((color[0] * sourceAlpha + data[offset] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  data[offset + 1] = Math.round((color[1] * sourceAlpha + data[offset + 1] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  data[offset + 2] = Math.round((color[2] * sourceAlpha + data[offset + 2] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  data[offset + 3] = Math.round(outAlpha * 255);
}

function countVisibleOverlayDirtyChunks(chunks: ChunkRecord[], visibleDependencyMask: number): number {
  let count = 0;
  for (const chunk of chunks) {
    if (chunk.projectionDirtyMask & visibleDependencyMask) {
      count += 1;
    }
  }
  return count;
}

function overlayCellsForChunk(chunk: ChunkRecord): number {
  const width = Math.ceil(chunk.endX / FIELD_OVERLAY_CELL_SIZE) - Math.floor(chunk.startX / FIELD_OVERLAY_CELL_SIZE);
  const height = Math.ceil(chunk.endY / FIELD_OVERLAY_CELL_SIZE) - Math.floor(chunk.startY / FIELD_OVERLAY_CELL_SIZE);
  return Math.max(0, width * height);
}

function consumeOverlayDirty(chunk: ChunkRecord, visibleDependencyMask: number): number {
  const consumedMask = chunk.projectionDirtyMask & visibleDependencyMask;
  chunk.projectionDirtyMask &= ~consumedMask;
  chunk.projectionDirty = chunk.projectionDirtyMask !== 0;
  return consumedMask;
}
