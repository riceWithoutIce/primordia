import type { TerrainType } from "../../core/primordia";

export type Rgb = readonly [number, number, number];

export const BIOME_PALETTE: Record<TerrainType, Rgb> = {
  ocean: [28, 83, 130],
  coast: [126, 171, 151],
  plain: [78, 151, 86],
  hill: [117, 139, 78],
  mountain: [132, 131, 122],
  wetland: [44, 125, 108],
  desert: [194, 165, 85],
  tundra: [139, 160, 139],
  snow: [226, 232, 225]
};

export const TERRAIN_PALETTE = {
  oceanDeep: [16, 49, 83] as Rgb,
  oceanShallow: [41, 95, 132] as Rgb,
  lowland: [64, 116, 77] as Rgb,
  highland: [134, 130, 106] as Rgb,
  snow: [224, 230, 222] as Rgb,
  contour: [18, 25, 22] as Rgb,
  coastLine: [226, 213, 142] as Rgb
};

export function mixRgb(a: Rgb, b: Rgb, t: number): [number, number, number] {
  const u = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * u),
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u)
  ];
}

export function shadeRgb(color: Rgb, amount: number): [number, number, number] {
  const factor = 1 + amount;
  return [
    Math.max(0, Math.min(255, Math.round(color[0] * factor))),
    Math.max(0, Math.min(255, Math.round(color[1] * factor))),
    Math.max(0, Math.min(255, Math.round(color[2] * factor)))
  ];
}
