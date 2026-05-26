export type ViewMode = "resource" | "terrain" | "biome" | "pressure" | "lineage";

export function isViewMode(value: string | undefined): value is ViewMode {
  return value === "resource" || value === "terrain" || value === "biome" || value === "pressure" || value === "lineage";
}
