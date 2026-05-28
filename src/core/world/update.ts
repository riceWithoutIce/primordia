import { clamp } from "../random/rng";
import { measureCoreProfile, type CoreProfileSink } from "../profile";
import {
  CHUNK_DIRTY,
  chunkFieldUpdateDecision,
  clearChunkFieldWriteMasks,
  countChunkActivities,
  markChunkProjectionDirty,
  neighborChunkIds,
  refreshChunkSummary,
  refreshDirtyRegionSummaries,
  refreshRegionsById,
  touchArea,
  touchChunk,
  updateChunkActivity
} from "./chunks";
import { maybeSpawnProcess, maybeTriggerEnvironmentalEvent, updateProcesses } from "./processes";
import { worldIndex } from "./world";
import type { ChunkGrid, ChunkRecord } from "../types";
import type {
  EnvironmentEventRecord,
  EnvironmentProcessRecord,
  RandomSource,
  SchedulerLane,
  SimulationConfig,
  TickPlan,
  TickReport,
  WorldState
} from "../types";

export interface EnvironmentUpdateResult {
  event: EnvironmentEventRecord | null;
  process: EnvironmentProcessRecord | null;
  tickReport: TickReport;
}

interface EnvironmentFieldUpdateResult {
  activeEnvironmentChunks: number;
  catchUpUpdatedCells: number;
  catchUpFieldUpdates: number;
  diffusionChunks: number;
  diffusionDeferredChunks: number;
  diffusionEffectiveChunks: number;
  diffusionNearZeroCandidateChunks: number;
  diffusionNearZeroSkippedChunks: number;
  diffusionNeighborChunks: number;
  diffusionSeedChunks: number;
  diffusionSelectedChunks: number;
  preciseFieldUpdates: number;
  preciseUpdatedCells: number;
  summaryRefreshChunks: number;
  summaryRefreshRegions: number;
  tickReport: TickReport;
  updatedCells: number;
  updatedChunks: number;
  warmEnvironmentChunks: number;
  sleepingCatchupChunks: number;
}

interface DiffusionResult {
  deferredChunks: number;
  effectiveChunks: number;
  nearZeroCandidateChunks: number;
  nearZeroSkippedChunks: number;
  refreshedRegions: number;
  neighborChunks: number;
  seedChunks: number;
  selectedChunks: number;
}

interface DiffusionOptions {
  deferredChunkIds?: Set<number>;
  sourceChunkIds?: Iterable<number>;
}

interface EnvironmentChunkUpdateResult {
  dirtyMask: number;
  updatedCells: number;
}

const TERRAIN_MOISTURE_VISUAL_SCALE = 0.22;
const TERRAIN_MOISTURE_VISUAL_STEP = 1 / 255;
const PRESSURE_DIFFUSION_CHUNK_DELTA_THRESHOLD = 0.25;
const LARGE_WORLD_CELL_LIMIT = 65536;
const PRESSURE_DIFFUSION_BACKGROUND_INTERVAL = 12;
const MIN_PRESSURE_DIFFUSION_CHUNK_BUDGET = 8;
const MIN_PRESSURE_DIFFUSION_SOURCE_BUDGET = 4;

export function updateWorld(
  world: WorldState,
  config: SimulationConfig,
  tick: number,
  random: RandomSource,
  nearestOpenPoint: (x: number, y: number) => { x: number; y: number },
  profile?: CoreProfileSink | null
): EnvironmentUpdateResult {
  const fields = updateEnvironmentFields(world, config, tick, random, profile);
  const updatedProcesses = measureCoreProfile(profile, "core.world.updateProcesses", () => updateProcesses(world, config));
  measureCoreProfile(profile, "core.world.touchProcesses", () => {
    for (const activeProcess of updatedProcesses) {
      touchArea(
        world.chunks,
        world.width,
        world.height,
        activeProcess.x,
        activeProcess.y,
        activeProcess.radius,
        tick,
        environmentProcessDirtyMask(activeProcess)
      );
    }
    profile?.recordValue("core.dirty.processTouchChunks", countProjectionDirtyMask(world, CHUNK_DIRTY.process));
  });
  const process = measureCoreProfile(profile, "core.world.spawnProcess", () => maybeSpawnProcess(world, config, tick));
  const event = measureCoreProfile(profile, "core.world.triggerEvent", () =>
    maybeTriggerEnvironmentalEvent(world, config, tick, nearestOpenPoint)
  );
  measureCoreProfile(profile, "core.world.touchEvent", () => {
    if (process) {
      touchArea(world.chunks, world.width, world.height, process.x, process.y, process.radius, tick, CHUNK_DIRTY.process);
    }
    if (event) {
      touchArea(world.chunks, world.width, world.height, event.x, event.y, event.radius, tick, environmentEventDirtyMask(event));
    }
  });
  measureCoreProfile(profile, "core.world.refreshRegions", () =>
    refreshDirtyRegionSummaries(world.regions, world.chunks, world.terrain, world.fields, world.width)
  );
  profile?.recordValue("core.dirty.moistureAfterWorld", countProjectionDirtyMask(world, CHUNK_DIRTY.moisture));
  profile?.recordValue("core.dirty.pressureAfterWorld", countProjectionDirtyMask(world, CHUNK_DIRTY.pressure));
  return { event, process, tickReport: fields.tickReport };
}

export function updateEnvironmentFields(
  world: WorldState,
  config: SimulationConfig,
  tick: number,
  random: RandomSource,
  profile?: CoreProfileSink | null
): EnvironmentFieldUpdateResult {
  const cap = config.resourceCap;
  const lanes: SchedulerLane[] = [
    "agent",
    "activeEnvironment",
    "warmEnvironment",
    "sleepingCatchup",
    "pressureDiffusion",
    "summary"
  ];
  const tickPlan: TickPlan = {
    tick,
    lanes,
    pressureDiffusion: config.pressureDiffusion > 0
  };
  measureCoreProfile(profile, "core.world.updateChunkActivity", () =>
    updateChunkActivity(world.chunks, tick, config.warmChunkInterval, config.sleepingChunkInterval, world.size > 65536)
  );
  const preUpdateActivityCounts = countChunkActivities(world.chunks);
  const directFieldWriteCounts = preUpdateActivityCounts;
  clearChunkFieldWriteMasks(world.chunks);
  let updatedChunks = 0;
  let updatedCells = 0;
  let preciseFieldUpdates = 0;
  let preciseUpdatedCells = 0;
  let catchUpFieldUpdates = 0;
  let catchUpUpdatedCells = 0;
  let activeEnvironmentChunks = 0;
  let warmEnvironmentChunks = 0;
  let sleepingCatchupChunks = 0;
  let warmFieldUpdateChunks = 0;
  let sleepingFieldUpdateChunks = 0;
  let summaryRefreshChunks = 0;
  let summaryRefreshRegions = 0;
  const pressureDiffusionSourceChunks =
    world.size > LARGE_WORLD_CELL_LIMIT ? selectPressureDiffusionSourceChunks(world, tick) : undefined;
  const pressureDiffusionDeferredChunks = pressureDiffusionSourceChunks ? new Set<number>() : undefined;

  measureCoreProfile(profile, "core.world.environmentChunks", () => {
    for (const chunk of world.chunks.chunks) {
      const fieldUpdate = chunkFieldUpdateDecision(chunk, tick, config.warmChunkInterval, config.sleepingChunkInterval);
      if (!fieldUpdate.shouldUpdate) {
        continue;
      }

      const elapsed = Math.max(1, tick - chunk.lastUpdatedTick);
      const isCatchUp = fieldUpdate.lane !== "activeEnvironment" && elapsed > 1;
      const result = updateEnvironmentChunk(world, config, cap, chunk, elapsed, isCatchUp);
      updatedChunks += 1;
      updatedCells += result.updatedCells;
      markChunkProjectionDirty(world.chunks, chunk.id, result.dirtyMask);
      if (fieldUpdate.lane === "warmEnvironment") {
        warmEnvironmentChunks += 1;
        warmFieldUpdateChunks += 1;
        catchUpFieldUpdates += 1;
        catchUpUpdatedCells += result.updatedCells;
      } else if (fieldUpdate.lane === "sleepingCatchup") {
        sleepingCatchupChunks += 1;
        sleepingFieldUpdateChunks += 1;
        catchUpFieldUpdates += 1;
        catchUpUpdatedCells += result.updatedCells;
      } else {
        preciseFieldUpdates += 1;
        preciseUpdatedCells += result.updatedCells;
        activeEnvironmentChunks += 1;
      }
      chunk.lastUpdatedTick = tick;
      chunk.dirtyMask = 0;
      refreshChunkSummary(world.chunks, chunk, world.terrain, world.fields, world.width);
      summaryRefreshChunks += 1;
    }
  });
  profile?.recordValue("core.world.updatedChunks", updatedChunks);
  profile?.recordValue("core.world.updatedCells", updatedCells);
  profile?.recordValue("core.world.preciseUpdatedChunks", preciseFieldUpdates);
  profile?.recordValue("core.world.preciseUpdatedCells", preciseUpdatedCells);
  profile?.recordValue("core.world.catchUpUpdatedChunks", catchUpFieldUpdates);
  profile?.recordValue("core.world.catchUpUpdatedCells", catchUpUpdatedCells);
  profile?.recordValue("core.dirty.moistureAfterEnvironment", countProjectionDirtyMask(world, CHUNK_DIRTY.moisture));

  const diffusion = measureCoreProfile(profile, "core.world.diffusePressure", () =>
    diffusePressure(world, config, tick, profile, {
      deferredChunkIds: pressureDiffusionDeferredChunks,
      sourceChunkIds: pressureDiffusionSourceChunks
    })
  );
  const activityCounts = countChunkActivities(world.chunks);
  summaryRefreshRegions = diffusion.refreshedRegions;
  const tickReport: TickReport = {
    tick,
    plan: tickPlan,
    lanes: {
      agent: 0,
      activeEnvironment: activeEnvironmentChunks,
      warmEnvironment: warmEnvironmentChunks,
      sleepingCatchup: sleepingCatchupChunks,
      pressureDiffusion: diffusion.selectedChunks,
      summary: summaryRefreshChunks + summaryRefreshRegions
    }
  };
  world.chunks.schedulerStats = {
    tick,
    totalChunks: world.chunks.chunks.length,
    ...activityCounts,
    activeAgentOnlyChunks: preUpdateActivityCounts.activeAgentOnlyChunks,
    activeFieldDirtyChunks: preUpdateActivityCounts.activeFieldDirtyChunks,
    activeMixedDirtyChunks: preUpdateActivityCounts.activeMixedDirtyChunks,
    directFieldWriteChunks: directFieldWriteCounts.directFieldWriteChunks,
    directResourceWriteChunks: directFieldWriteCounts.directResourceWriteChunks,
    directTraceWriteChunks: directFieldWriteCounts.directTraceWriteChunks,
    directPressureWriteChunks: directFieldWriteCounts.directPressureWriteChunks,
    directMixedFieldWriteChunks: directFieldWriteCounts.directMixedFieldWriteChunks,
    updatedChunks,
    updatedCells,
    preciseFieldUpdates,
    catchUpFieldUpdates,
    warmFieldUpdateChunks,
    sleepingFieldUpdateChunks,
    activeEnvironmentChunks,
    warmEnvironmentChunks,
    sleepingCatchupChunks,
    summaryRefreshChunks,
    summaryRefreshRegions,
    diffusionChunks: diffusion.selectedChunks,
    diffusionSeedChunks: diffusion.seedChunks,
    diffusionNeighborChunks: diffusion.neighborChunks,
    diffusionSelectedChunks: diffusion.selectedChunks,
    diffusionEffectiveChunks: diffusion.effectiveChunks,
    diffusionDeferredChunks: diffusion.deferredChunks,
    diffusionNearZeroCandidateChunks: diffusion.nearZeroCandidateChunks,
    diffusionNearZeroSkippedChunks: diffusion.nearZeroSkippedChunks,
    lastTickPlan: tickPlan,
    lastTickReport: tickReport
  };
  profile?.recordValue("core.scheduler.activeEnvironmentChunks", activeEnvironmentChunks);
  profile?.recordValue("core.scheduler.activeAgentOnlyChunks", preUpdateActivityCounts.activeAgentOnlyChunks);
  profile?.recordValue("core.scheduler.activeFieldDirtyChunks", preUpdateActivityCounts.activeFieldDirtyChunks);
  profile?.recordValue("core.scheduler.activeMixedDirtyChunks", preUpdateActivityCounts.activeMixedDirtyChunks);
  profile?.recordValue("core.scheduler.directFieldWriteChunks", directFieldWriteCounts.directFieldWriteChunks);
  profile?.recordValue("core.scheduler.directResourceWriteChunks", directFieldWriteCounts.directResourceWriteChunks);
  profile?.recordValue("core.scheduler.directTraceWriteChunks", directFieldWriteCounts.directTraceWriteChunks);
  profile?.recordValue("core.scheduler.directPressureWriteChunks", directFieldWriteCounts.directPressureWriteChunks);
  profile?.recordValue("core.scheduler.directMixedFieldWriteChunks", directFieldWriteCounts.directMixedFieldWriteChunks);
  profile?.recordValue("core.scheduler.warmEnvironmentChunks", warmEnvironmentChunks);
  profile?.recordValue("core.scheduler.warmFieldUpdateChunks", warmFieldUpdateChunks);
  profile?.recordValue("core.scheduler.sleepingCatchupChunks", sleepingCatchupChunks);
  profile?.recordValue("core.scheduler.sleepingFieldUpdateChunks", sleepingFieldUpdateChunks);
  profile?.recordValue("core.scheduler.summaryRefreshChunks", summaryRefreshChunks);
  profile?.recordValue("core.scheduler.summaryRefreshRegions", summaryRefreshRegions);
  return {
    activeEnvironmentChunks,
    catchUpUpdatedCells,
    catchUpFieldUpdates,
    diffusionChunks: diffusion.selectedChunks,
    diffusionDeferredChunks: diffusion.deferredChunks,
    diffusionEffectiveChunks: diffusion.effectiveChunks,
    diffusionNearZeroCandidateChunks: diffusion.nearZeroCandidateChunks,
    diffusionNearZeroSkippedChunks: diffusion.nearZeroSkippedChunks,
    diffusionNeighborChunks: diffusion.neighborChunks,
    diffusionSeedChunks: diffusion.seedChunks,
    diffusionSelectedChunks: diffusion.selectedChunks,
    preciseFieldUpdates,
    preciseUpdatedCells,
    summaryRefreshChunks,
    summaryRefreshRegions,
    tickReport,
    updatedCells,
    updatedChunks,
    warmEnvironmentChunks,
    sleepingCatchupChunks
  };
}

function updateEnvironmentChunk(
  world: WorldState,
  config: SimulationConfig,
  cap: number,
  chunk: ChunkRecord,
  elapsed: number,
  isCatchUp: boolean
): EnvironmentChunkUpdateResult {
  let dirtyMask = CHUNK_DIRTY.resource | CHUNK_DIRTY.trace | CHUNK_DIRTY.pressure;
  let updatedCells = 0;
  const steps = isCatchUp ? Math.min(elapsed, Math.max(1, Math.floor(config.sleepingChunkInterval))) : 1;
  for (let y = chunk.startY; y < chunk.endY; y += 1) {
    for (let x = chunk.startX; x < chunk.endX; x += 1) {
      const i = y * world.width + x;
      if (config.environmentMode === "flux") {
        const fertility = terrainResourceFertility(world.terrain.fertilityBase[i], world.terrain.terrainType[i], config);
        const terrainFertility = world.terrain.fertilityBase[i];
        const moisture = clamp(world.terrain.moistureBase[i] + world.fields.moistureDelta[i] * 0.35, 0, 1.4);
        const terrainPenalty = world.terrain.terrainType[i] === "ocean" ? 0.25 : 1;
        const recoveryFactor = 1 / (1 + world.fields.pressure[i] * 0.55);
        const growthChance =
          config.resourceGrowth *
          steps *
          (0.18 + fertility * 0.72 + terrainFertility * 0.62 + moisture * 0.22) *
          recoveryFactor *
          terrainPenalty;
        const roll = deterministicFieldRandom(config, world, chunk, i, chunk.lastUpdatedTick + 1, "growth-roll");
        if (roll < Math.min(1, growthChance)) {
          const amountRoll = deterministicFieldRandom(config, world, chunk, i, chunk.lastUpdatedTick + 1, "growth-amount");
          const growthAmount =
            (0.12 + terrainFertility * 0.65 + moisture * 0.22) * recoveryFactor * amountRoll * 0.8 * Math.sqrt(steps);
          world.fields.resource[i] = clamp(world.fields.resource[i] + growthAmount, 0, cap);
        }
      }
      world.fields.trace[i] *= Math.pow(config.traceDecay, steps);
      world.fields.pressure[i] = clamp(
        world.fields.pressure[i] * Math.pow(config.pressureDecay, steps) + world.fields.trace[i] * config.pressureGrowth * steps,
        0,
        4
      );
      const moistureBefore = world.fields.moistureDelta[i];
      world.fields.moistureDelta[i] *= Math.pow(0.985, steps);
      if (world.fields.moistureDelta[i] < 0.0001) {
        world.fields.moistureDelta[i] = 0;
      }
      if (terrainMoistureVisuallyChanged(world.terrain.moistureBase[i], moistureBefore, world.fields.moistureDelta[i])) {
        dirtyMask |= CHUNK_DIRTY.moisture;
      }
      updatedCells += 1;
    }
  }
  return { dirtyMask, updatedCells };
}

export function diffusePressure(
  world: WorldState,
  config: SimulationConfig,
  tick = world.chunks.schedulerStats.tick,
  profile?: CoreProfileSink | null,
  options: DiffusionOptions = {}
): DiffusionResult {
  const diffusion = clamp(config.pressureDiffusion, 0, 0.25);
  if (diffusion <= 0) {
    const result = {
      deferredChunks: 0,
      effectiveChunks: 0,
      nearZeroCandidateChunks: 0,
      nearZeroSkippedChunks: 0,
      refreshedRegions: 0,
      neighborChunks: 0,
      seedChunks: 0,
      selectedChunks: 0
    };
    writeDiffusionSchedulerStats(world, tick, result);
    return result;
  }

  const pressure = world.fields.pressure;
  const chunksToDiffuse = new Set<number>();
  const sourceChunksToDiffuse = new Set<number>();
  const explicitSourceChunkIds = options.sourceChunkIds ? new Set(options.sourceChunkIds) : null;
  const deferredChunkIds = options.deferredChunkIds;
  const selectedSourceBudget = explicitSourceChunkIds
    ? pressureDiffusionSourceBudget(config, explicitSourceChunkIds.size)
    : Number.POSITIVE_INFINITY;
  const selectedChunkBudget = explicitSourceChunkIds
    ? pressureDiffusionChunkBudget(config, world.chunks.chunks.length)
    : Number.POSITIVE_INFINITY;
  let skippedSleepingChunks = 0;
  let nearZeroCandidateChunks = 0;
  let nearZeroSkippedChunks = 0;
  measureCoreProfile(profile, "core.diffusion.selectChunks", () => {
    for (const chunk of world.chunks.chunks) {
      if (explicitSourceChunkIds && !explicitSourceChunkIds.has(chunk.id)) {
        continue;
      }
      if (!explicitSourceChunkIds && world.size > LARGE_WORLD_CELL_LIMIT && chunk.activity === "sleeping" && !chunk.dirtyMask) {
        skippedSleepingChunks += 1;
        continue;
      }
      if (chunk.summary.pressure <= 0.0001 && !chunk.dirtyMask) {
        nearZeroCandidateChunks += 1;
      }
      if (
        sourceChunksToDiffuse.size >= selectedSourceBudget ||
        !canAddDiffusionSource(world.chunks, chunksToDiffuse, chunk.id, selectedChunkBudget)
      ) {
        chunk.pressureDiffusionActive = true;
        deferredChunkIds?.add(chunk.id);
        continue;
      }
      chunksToDiffuse.add(chunk.id);
      sourceChunksToDiffuse.add(chunk.id);
      for (const neighborId of neighborChunkIds(world.chunks, chunk)) {
        if (chunksToDiffuse.size < selectedChunkBudget) {
          chunksToDiffuse.add(neighborId);
        }
      }
    }
  });
  const deferredChunks = deferredChunkIds?.size ?? 0;
  const neighborExpansionChunks = Math.max(0, chunksToDiffuse.size - sourceChunksToDiffuse.size);
  const computedCells = countChunkCells(world.chunks.chunks, chunksToDiffuse);
  profile?.recordValue("core.diffusion.sourceChunks", sourceChunksToDiffuse.size);
  profile?.recordValue("core.diffusion.seedChunks", sourceChunksToDiffuse.size);
  profile?.recordValue("core.diffusion.selectedChunks", chunksToDiffuse.size);
  profile?.recordValue("core.diffusion.deferredChunks", deferredChunks);
  profile?.recordValue("core.diffusion.neighborExpansionChunks", neighborExpansionChunks);
  profile?.recordValue("core.diffusion.neighborChunks", neighborExpansionChunks);
  profile?.recordValue("core.diffusion.skippedSleepingChunks", skippedSleepingChunks);
  profile?.recordValue("core.diffusion.nearZeroCandidateChunks", nearZeroCandidateChunks);
  profile?.recordValue("core.diffusion.nearZeroSkippedChunks", nearZeroSkippedChunks);
  profile?.recordValue("core.diffusion.computedCells", computedCells);

  measureCoreProfile(profile, "core.diffusion.compute", () => {
    for (const chunkId of chunksToDiffuse) {
      const chunk = world.chunks.chunks[chunkId];
      for (let y = chunk.startY; y < chunk.endY; y += 1) {
        for (let x = chunk.startX; x < chunk.endX; x += 1) {
          const idx = worldIndex(world, x, y);
          const neighborAverage =
            (pressureForDiffusionNeighbor(world, chunksToDiffuse, pressure, idx, x + 1, y) +
              pressureForDiffusionNeighbor(world, chunksToDiffuse, pressure, idx, x - 1, y) +
              pressureForDiffusionNeighbor(world, chunksToDiffuse, pressure, idx, x, y + 1) +
              pressureForDiffusionNeighbor(world, chunksToDiffuse, pressure, idx, x, y - 1)) /
            4;
          world.fields.nextPressure[idx] = clamp(pressure[idx] * (1 - diffusion) + neighborAverage * diffusion, 0, 4);
        }
      }
    }
  });

  let changedCells = 0;
  let unchangedCells = 0;
  let changedChunks = 0;
  let unchangedChunks = 0;
  const changedRegionIds = new Set<number>();
  measureCoreProfile(profile, "core.diffusion.commit", () => {
    for (const chunkId of chunksToDiffuse) {
      const chunk = world.chunks.chunks[chunkId];
      let pressureTotal = 0;
      let chunkChanged = false;
      let chunkDelta = 0;
      chunk.pressureDiffusionActive = false;
      for (let y = chunk.startY; y < chunk.endY; y += 1) {
        for (let x = chunk.startX; x < chunk.endX; x += 1) {
          const idx = y * world.width + x;
          const next = world.fields.nextPressure[idx];
          const delta = Math.abs(next - pressure[idx]);
          if (delta > 0) {
            changedCells += 1;
            chunkChanged = true;
          } else {
            unchangedCells += 1;
          }
          chunkDelta += delta;
          pressure[idx] = next;
          pressureTotal += next;
        }
      }
      chunk.summary.pressure = pressureTotal;
      if (chunkChanged && chunkDelta >= PRESSURE_DIFFUSION_CHUNK_DELTA_THRESHOLD) {
        changedChunks += 1;
        changedRegionIds.add(chunk.regionId);
        markChunkProjectionDirty(world.chunks, chunk.id, CHUNK_DIRTY.pressure);
      } else {
        unchangedChunks += 1;
      }
    }
    if (deferredChunkIds) {
      for (const chunkId of deferredChunkIds) {
        const chunk = world.chunks.chunks[chunkId];
        if (chunk) {
          chunk.pressureDiffusionActive = true;
        }
      }
    }
  });
  profile?.recordValue("core.diffusion.changedCells", changedCells);
  profile?.recordValue("core.diffusion.unchangedCells", unchangedCells);
  profile?.recordValue("core.diffusion.changedChunks", changedChunks);
  profile?.recordValue("core.diffusion.unchangedChunks", unchangedChunks);
  profile?.recordValue("core.diffusion.effectiveChunks", changedChunks);
  profile?.recordValue("core.dirty.pressureAfterDiffusion", countProjectionDirtyMask(world, CHUNK_DIRTY.pressure));
  profile?.recordValue("core.dirty.moistureAfterDiffusion", countProjectionDirtyMask(world, CHUNK_DIRTY.moisture));

  measureCoreProfile(profile, "core.diffusion.refreshRegions", () =>
    refreshRegionsById(world.regions, world.chunks, world.terrain, world.fields, world.width, changedRegionIds)
  );
  const result = {
    deferredChunks,
    effectiveChunks: changedChunks,
    nearZeroCandidateChunks,
    nearZeroSkippedChunks,
    refreshedRegions: changedRegionIds.size,
    neighborChunks: neighborExpansionChunks,
    seedChunks: sourceChunksToDiffuse.size,
    selectedChunks: chunksToDiffuse.size
  };
  writeDiffusionSchedulerStats(world, tick, result);
  return result;
}

function writeDiffusionSchedulerStats(world: WorldState, tick: number, result: DiffusionResult): void {
  world.chunks.schedulerStats = {
    ...world.chunks.schedulerStats,
    tick,
    diffusionChunks: result.selectedChunks,
    diffusionSeedChunks: result.seedChunks,
    diffusionNeighborChunks: result.neighborChunks,
    diffusionSelectedChunks: result.selectedChunks,
    diffusionEffectiveChunks: result.effectiveChunks,
    diffusionDeferredChunks: result.deferredChunks,
    diffusionNearZeroCandidateChunks: result.nearZeroCandidateChunks,
    diffusionNearZeroSkippedChunks: result.nearZeroSkippedChunks
  };
}

function pressureDiffusionSourceBudget(config: SimulationConfig, availableSources: number): number {
  const configured = Number.isFinite(config.pressureDiffusionSourceBudget)
    ? Math.floor(config.pressureDiffusionSourceBudget)
    : MIN_PRESSURE_DIFFUSION_SOURCE_BUDGET;
  return Math.min(availableSources, Math.max(MIN_PRESSURE_DIFFUSION_SOURCE_BUDGET, configured));
}

function pressureDiffusionChunkBudget(config: SimulationConfig, totalChunks: number): number {
  const configured = Number.isFinite(config.pressureDiffusionChunkBudget)
    ? Math.floor(config.pressureDiffusionChunkBudget)
    : MIN_PRESSURE_DIFFUSION_CHUNK_BUDGET;
  return Math.min(totalChunks, Math.max(MIN_PRESSURE_DIFFUSION_CHUNK_BUDGET, configured));
}

function canAddDiffusionSource(
  grid: ChunkGrid,
  selectedChunkIds: Set<number>,
  sourceChunkId: number,
  selectedChunkBudget: number
): boolean {
  if (selectedChunkIds.has(sourceChunkId)) {
    return true;
  }
  let additionalChunks = 1;
  const sourceChunk = grid.chunks[sourceChunkId];
  if (!sourceChunk) {
    return false;
  }
  for (const neighborId of neighborChunkIds(grid, sourceChunk)) {
    if (!selectedChunkIds.has(neighborId)) {
      additionalChunks += 1;
    }
  }
  return selectedChunkIds.size + additionalChunks <= selectedChunkBudget;
}

function selectPressureDiffusionSourceChunks(world: WorldState, tick: number): Set<number> {
  const sourceChunkIds = new Set<number>();
  const interval = PRESSURE_DIFFUSION_BACKGROUND_INTERVAL;

  for (const chunk of world.chunks.chunks) {
    if (chunk.pressureDiffusionActive || chunk.dirtyMask & CHUNK_DIRTY.pressure) {
      sourceChunkIds.add(chunk.id);
    }
  }

  if (sourceChunkIds.size > 0) {
    return sourceChunkIds;
  }

  for (const chunk of world.chunks.chunks) {
    if ((chunk.id + tick) % interval === 0) {
      sourceChunkIds.add(chunk.id);
    }
  }

  return sourceChunkIds;
}

function countProjectionDirtyMask(world: WorldState, mask: number): number {
  let count = 0;
  for (const chunk of world.chunks.chunks) {
    if (chunk.projectionDirtyMask & mask) {
      count += 1;
    }
  }
  return count;
}

function countChunkCells(chunks: ChunkRecord[], chunkIds: Set<number>): number {
  let cells = 0;
  for (const chunkId of chunkIds) {
    const chunk = chunks[chunkId];
    if (chunk) {
      cells += chunk.width * chunk.height;
    }
  }
  return cells;
}

function terrainMoistureVisuallyChanged(moistureBase: number, beforeDelta: number, afterDelta: number): boolean {
  if (beforeDelta === afterDelta) {
    return false;
  }

  const beforeBucket = terrainMoistureVisualBucket(moistureBase, beforeDelta);
  const afterBucket = terrainMoistureVisualBucket(moistureBase, afterDelta);
  return beforeBucket !== afterBucket;
}

function terrainMoistureVisualBucket(moistureBase: number, moistureDelta: number): number {
  const amount = Math.min(1, moistureBase + moistureDelta * TERRAIN_MOISTURE_VISUAL_SCALE);
  return Math.floor(amount / TERRAIN_MOISTURE_VISUAL_STEP);
}

function pressureForDiffusionNeighbor(
  world: WorldState,
  chunksToDiffuse: Set<number>,
  pressure: Float32Array,
  currentIndex: number,
  x: number,
  y: number
): number {
  const neighborIndex = worldIndex(world, x, y);
  const neighborChunkId = world.chunks.cellToChunk[neighborIndex];
  if (!chunksToDiffuse.has(neighborChunkId)) {
    return pressure[currentIndex];
  }
  return pressure[neighborIndex];
}

function deterministicFieldRandom(
  config: SimulationConfig,
  world: WorldState,
  chunk: ChunkRecord,
  index: number,
  tick: number,
  channel: "growth-roll" | "growth-amount"
): number {
  const salt = channel === "growth-roll" ? 0x7c2f9a13 : 0x4b1d2f77;
  const x = index % world.width;
  const y = Math.floor(index / world.width);
  let h = Math.imul(x + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + 0x632be5ab, 0xc2b2ae35);
  h ^= Math.imul(chunk.id + 1, 0x27d4eb2d);
  h ^= Math.imul(tick + 1, 0x165667b1);
  h ^= Math.imul(config.seed + 1, 0x9e3779b1);
  h ^= Math.imul(world.width + world.height, 0xd3a2646c);
  h ^= salt;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967295;
}

function terrainResourceFertility(fertilityBase: number, terrainType: string, config: SimulationConfig): number {
  if (config.resourceCap <= 0) {
    return 0;
  }
  const terrainFactor = terrainType === "ocean" ? 0.38 : 0.95;
  return clamp((fertilityBase * terrainFactor) / 0.9, 0, 1);
}

export function environmentProcessDirtyMask(process: EnvironmentProcessRecord): number {
  switch (process.kind) {
    case "moisture-front":
      return CHUNK_DIRTY.process | CHUNK_DIRTY.resource | CHUNK_DIRTY.trace | CHUNK_DIRTY.pressure | CHUNK_DIRTY.moisture;
  }
}

export function environmentEventDirtyMask(event: EnvironmentEventRecord): number {
  switch (event.kind) {
    case "bloom":
      return CHUNK_DIRTY.resource | CHUNK_DIRTY.trace;
    case "pressure":
      return CHUNK_DIRTY.pressure | CHUNK_DIRTY.trace;
  }
}
