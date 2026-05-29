import type { DynamicFields, EnvironmentCell, SimulationConfig, StaticTerrain, TerrainType } from "../../core/primordia";
import type { BaseLayer, OverlayState } from "./mapViewTypes";
import { BIOME_PALETTE, TERRAIN_PALETTE, mixRgb, shadeRgb, type Rgb } from "./palettes";

export interface TerrainRenderConfig {
  contourInterval: number;
  contourWidth: number;
  contourStrength: number;
  coastElevation: number;
  coastLineWidth: number;
  moistureTintStrength: number;
  snowLine: number;
  resourceOverlayStrength: number;
  pressureOverlayStrength: number;
  lineageOverlayStrength: number;
}

export const TERRAIN_RENDER_CONFIG: TerrainRenderConfig = {
  contourInterval: 0.075,
  contourWidth: 0.008,
  contourStrength: 0.46,
  coastElevation: 0.27,
  coastLineWidth: 0.012,
  moistureTintStrength: 0.16,
  snowLine: 0.78,
  resourceOverlayStrength: 0.42,
  pressureOverlayStrength: 0.38,
  lineageOverlayStrength: 0.18
};

export function paintMapCell(
  data: Uint8ClampedArray,
  offset: number,
  cell: EnvironmentCell,
  baseLayer: BaseLayer,
  overlays: OverlayState,
  resourceCap: number
): void {
  const color = colorForCell(cell, baseLayer, overlays, resourceCap);
  data[offset] = color[0];
  data[offset + 1] = color[1];
  data[offset + 2] = color[2];
  data[offset + 3] = 255;
}

export function paintTerrainMapCell(
  data: Uint8ClampedArray,
  offset: number,
  terrain: StaticTerrain,
  fields: DynamicFields,
  index: number
): void {
  const color = terrainColorFromValues(
    terrain.elevation[index],
    terrain.moistureBase[index],
    fields.moistureDelta[index],
    terrain.terrainType[index]
  );
  data[offset] = color[0];
  data[offset + 1] = color[1];
  data[offset + 2] = color[2];
  data[offset + 3] = 255;
}

export function colorForCell(
  cell: EnvironmentCell,
  baseLayer: BaseLayer,
  overlays: OverlayState,
  resourceCap: number
): [number, number, number] {
  let color: [number, number, number];
  switch (baseLayer) {
    case "terrain":
      color = terrainColor(cell);
      break;
    case "biome":
      color = biomeColor(cell);
      break;
    case "pressure":
      color = pressureColor(cell);
      break;
    case "resource":
      color = resourceColor(cell, resourceCap);
      break;
  }

  if (overlays.resources && baseLayer !== "resource") {
    color = applyResourceOverlay(color, cell, resourceCap);
  }
  if (overlays.pressure && baseLayer !== "pressure") {
    color = applyPressureOverlay(color, cell);
  }
  if (overlays.lineages) {
    color = applyLineageOverlay(color, cell);
  }

  return color;
}

export function terrainColor(cell: EnvironmentCell, config = TERRAIN_RENDER_CONFIG): [number, number, number] {
  return terrainColorFromValues(cell.elevation, cell.moistureBase, cell.moistureDelta, cell.terrainType, config);
}

export function terrainColorFromValues(
  elevation: number,
  moistureBase: number,
  moistureDelta: number,
  terrainType: TerrainType,
  config = TERRAIN_RENDER_CONFIG
): [number, number, number] {
  const moisture = Math.min(1, moistureBase + moistureDelta * 0.22);
  let color: Rgb;

  if (terrainType === "ocean") {
    color = mixRgb(TERRAIN_PALETTE.oceanDeep, TERRAIN_PALETTE.oceanShallow, Math.max(0, elevation / config.coastElevation));
  } else {
    const upland = mixRgb(TERRAIN_PALETTE.lowland, TERRAIN_PALETTE.highland, Math.max(0, (elevation - 0.28) / 0.5));
    color = elevation >= config.snowLine || terrainType === "snow" ? mixRgb(upland, TERRAIN_PALETTE.snow, 0.74) : upland;
    color = mixRgb(color, [42, 116, 121], moisture * config.moistureTintStrength);
  }

  const coastDistance = Math.abs(elevation - config.coastElevation);
  if (coastDistance < config.coastLineWidth) {
    color = mixRgb(color, TERRAIN_PALETTE.coastLine, 0.58);
  }

  if (isContour(elevation, config)) {
    color = mixRgb(color, TERRAIN_PALETTE.contour, config.contourStrength);
  }

  return [...color] as [number, number, number];
}

export function biomeColor(cell: EnvironmentCell): [number, number, number] {
  const base = BIOME_PALETTE[cell.terrainType];
  const elevationShade = cell.terrainType === "ocean" ? cell.elevation * 0.18 : (cell.elevation - 0.5) * 0.18;
  const moistureShade = Math.min(cell.moistureDelta, 1.2) * 0.05;
  return shadeRgb(base, elevationShade + moistureShade);
}

export function pressureColor(cell: EnvironmentCell): [number, number, number] {
  const p = Math.min(cell.pressure / 4, 1);
  const t = Math.min(cell.trace / 10, 1);
  const moisture = Math.min(cell.moistureDelta / 2, 1);
  return [Math.floor(18 + p * 188 + t * 28), Math.floor(18 + moisture * 92), Math.floor(24 + t * 104 + moisture * 80)];
}

export function lineageBackgroundColor(cell: EnvironmentCell): [number, number, number] {
  const fertility = Math.min(cell.fertility, 1);
  return [Math.floor(12 + fertility * 34), Math.floor(16 + fertility * 48), Math.floor(18 + fertility * 38)];
}

export function applyResourceOverlay(color: Rgb, cell: EnvironmentCell, resourceCap: number): [number, number, number] {
  const amount = resourceCap > 0 ? Math.min(cell.resource / resourceCap, 1) : 0;
  return applyResourceOverlayAmount(color, amount);
}

export function applyResourceOverlayAmount(color: Rgb, amount: number): [number, number, number] {
  if (amount <= 0.02) {
    return [...color] as [number, number, number];
  }

  return mixRgb(color, [126, 225, 118], amount * TERRAIN_RENDER_CONFIG.resourceOverlayStrength);
}

export function applyPressureOverlay(color: Rgb, cell: EnvironmentCell): [number, number, number] {
  const amount = Math.min(cell.pressure / 4, 1);
  return applyPressureOverlayAmount(color, amount);
}

export function applyPressureOverlayAmount(color: Rgb, amount: number): [number, number, number] {
  if (amount <= 0.02) {
    return [...color] as [number, number, number];
  }

  return mixRgb(color, [224, 76, 84], amount * TERRAIN_RENDER_CONFIG.pressureOverlayStrength);
}

export function applyLineageOverlay(color: Rgb, cell: EnvironmentCell): [number, number, number] {
  const fertility = Math.min(cell.fertility, 1);
  return applyLineageOverlayAmount(color, fertility);
}

export function applyLineageOverlayAmount(color: Rgb, fertility: number): [number, number, number] {
  return mixRgb(color, [236, 212, 104], fertility * TERRAIN_RENDER_CONFIG.lineageOverlayStrength);
}

export function resourceColor(cell: EnvironmentCell, resourceCap: number): [number, number, number] {
  const r = resourceCap > 0 ? cell.resource / resourceCap : 0;
  const t = Math.min(cell.trace / 9, 1);
  const p = Math.min(cell.pressure / 3, 1);
  const m = Math.min(Math.max(cell.movementCost - 1, 0), 1);
  const color: [number, number, number] = [
    Math.floor(8 + r * 64 + p * 38 - m * 16),
    Math.floor(12 + r * 154 + t * 58 - m * 12),
    Math.floor(13 + t * 156 + p * 36 + m * 40)
  ];

  if (cell.barrier) {
    return [5, 7, 8];
  }

  return color;
}

export function fertilityFromValues(
  terrain: StaticTerrain,
  fields: DynamicFields,
  config: SimulationConfig,
  index: number
): number {
  const moisture = terrain.moistureBase[index] + fields.moistureDelta[index] * 0.35;
  const pressureLoad = fields.pressure[index] / 4;
  const baseResourceFertility = config.resourceCap <= 0
    ? 0
    : Math.min(1, (terrain.fertilityBase[index] * (terrain.terrainType[index] === "ocean" ? 0.38 : 0.95)) / 0.9);
  return Math.max(0, Math.min(1, baseResourceFertility * (0.72 + moisture * 0.38) * (1 - pressureLoad * 0.18)));
}

function isContour(elevation: number, config: TerrainRenderConfig): boolean {
  if (elevation <= config.coastElevation) {
    return false;
  }

  const level = elevation / config.contourInterval;
  const distance = Math.abs(level - Math.round(level)) * config.contourInterval;
  return distance < config.contourWidth;
}
