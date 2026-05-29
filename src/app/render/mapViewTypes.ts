export type BaseLayer = "terrain" | "biome" | "resource" | "pressure";

export type OverlayLayer = "resources" | "agents" | "processes" | "pressure" | "lineages";

export type OverlayState = Record<OverlayLayer, boolean>;

export const DEFAULT_BASE_LAYER: BaseLayer = "terrain";

export const DEFAULT_OVERLAYS: OverlayState = {
  resources: false,
  agents: true,
  processes: true,
  pressure: false,
  lineages: false
};

export function isBaseLayer(value: string | undefined): value is BaseLayer {
  return value === "terrain" || value === "biome" || value === "resource" || value === "pressure";
}

export function isOverlayLayer(value: string | undefined): value is OverlayLayer {
  return value === "resources" || value === "agents" || value === "processes" || value === "pressure" || value === "lineages";
}
