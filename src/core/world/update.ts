import { clamp } from "../random/rng";
import { maybeSpawnProcess, maybeTriggerEnvironmentalEvent, updateProcesses } from "./processes";
import { worldIndex } from "./world";
import type { EnvironmentEventRecord, EnvironmentProcessRecord, RandomSource, SimulationConfig, WorldState } from "../types";

export interface EnvironmentUpdateResult {
  event: EnvironmentEventRecord | null;
  process: EnvironmentProcessRecord | null;
}

export function updateWorld(
  world: WorldState,
  config: SimulationConfig,
  tick: number,
  random: RandomSource,
  nearestOpenPoint: (x: number, y: number) => { x: number; y: number }
): EnvironmentUpdateResult {
  updateEnvironmentFields(world, config, random);
  updateProcesses(world, config);
  const process = maybeSpawnProcess(world, config, tick);
  const event = maybeTriggerEnvironmentalEvent(world, config, tick, nearestOpenPoint);
  return { event, process };
}

export function updateEnvironmentFields(world: WorldState, config: SimulationConfig, random: RandomSource): void {
  const cap = config.resourceCap;
  for (let i = 0; i < world.size; i += 1) {
    if (config.environmentMode === "flux") {
      const fertility = terrainResourceFertility(world.terrain.fertilityBase[i], world.terrain.terrainType[i], config);
      const terrainFertility = world.terrain.fertilityBase[i];
      const moisture = clamp(world.terrain.moistureBase[i] + world.fields.moistureDelta[i] * 0.35, 0, 1.4);
      const terrainPenalty = world.terrain.terrainType[i] === "ocean" ? 0.25 : 1;
      const recoveryFactor = 1 / (1 + world.fields.pressure[i] * 0.55);
      const growthChance =
        config.resourceGrowth *
        (0.18 + fertility * 0.72 + terrainFertility * 0.62 + moisture * 0.22) *
        recoveryFactor *
        terrainPenalty;
      if (random() < growthChance) {
        const growthAmount = (0.12 + terrainFertility * 0.65 + moisture * 0.22) * recoveryFactor * random() * 0.8;
        world.fields.resource[i] = clamp(world.fields.resource[i] + growthAmount, 0, cap);
      }
    }
    world.fields.trace[i] *= config.traceDecay;
    world.fields.pressure[i] = clamp(
      world.fields.pressure[i] * config.pressureDecay + world.fields.trace[i] * config.pressureGrowth,
      0,
      4
    );
    world.fields.moistureDelta[i] *= 0.985;
    if (world.fields.moistureDelta[i] < 0.0001) {
      world.fields.moistureDelta[i] = 0;
    }
  }
  diffusePressure(world, config);
}

export function diffusePressure(world: WorldState, config: SimulationConfig): void {
  const diffusion = clamp(config.pressureDiffusion, 0, 0.25);
  if (diffusion <= 0) {
    return;
  }

  const nextPressure = world.fields.nextPressure;
  const pressure = world.fields.pressure;
  for (let y = 0; y < world.height; y += 1) {
    for (let x = 0; x < world.width; x += 1) {
      const idx = worldIndex(world, x, y);
      const neighborAverage =
        (pressure[worldIndex(world, x + 1, y)] +
          pressure[worldIndex(world, x - 1, y)] +
          pressure[worldIndex(world, x, y + 1)] +
          pressure[worldIndex(world, x, y - 1)]) /
        4;
      nextPressure[idx] = clamp(pressure[idx] * (1 - diffusion) + neighborAverage * diffusion, 0, 4);
    }
  }
  world.fields.pressure = nextPressure;
  world.fields.nextPressure = pressure;
}

function terrainResourceFertility(fertilityBase: number, terrainType: string, config: SimulationConfig): number {
  if (config.resourceCap <= 0) {
    return 0;
  }
  const terrainFactor = terrainType === "ocean" ? 0.38 : 0.95;
  return clamp((fertilityBase * terrainFactor) / 0.9, 0, 1);
}
