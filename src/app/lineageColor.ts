import type { Agent } from "../core/primordia";

export interface LineageColor {
  hue: number;
  saturation: number;
  lightness: number;
}

const GOLDEN_ANGLE = 137.508;

export function lineageHue(lineageId: number): number {
  return Math.round((lineageId * GOLDEN_ANGLE + 26) % 360);
}

export function lineageColorFor(agent: Pick<Agent, "lineageId" | "generation">): LineageColor {
  return {
    hue: lineageHue(agent.lineageId),
    saturation: 84,
    lightness: Math.max(58, 72 - Math.min(agent.generation, 10) * 1.3)
  };
}

export function lineageFillStyle(agent: Pick<Agent, "lineageId" | "generation">): string {
  const color = lineageColorFor(agent);
  return `hsl(${color.hue} ${color.saturation}% ${color.lightness}%)`;
}
