import { DEFAULTS } from "./defaults";
import type { SimulationConfig, SimulationConfigPatch } from "../types";

export function mergeConfig(config?: SimulationConfigPatch): SimulationConfig {
  return { ...DEFAULTS, ...config };
}
