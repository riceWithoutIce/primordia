import { clamp } from "../random/rng";
import { measureCoreProfile, type CoreProfileSink } from "../profile";
import {
  CHUNK_DIRTY,
  chunkFieldUpdateCadence,
  chunkFieldUpdateDecision,
  clearChunkFieldWriteMasks,
  clearChunkPressureWriteCandidates,
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
  diffusionBackgroundSourceChunks: number;
  diffusionFrontierChunks: number;
  diffusionNearZeroCandidateChunks: number;
  diffusionNearZeroSkippedChunks: number;
  diffusionNeighborChunks: number;
  diffusionRetainedFrontierChunks: number;
  diffusionSeedChunks: number;
  diffusionSelectedChunks: number;
  diffusionSkippedBackgroundChunks: number;
  diffusionStaleFrontierChunks: number;
  diffusionAgedOutFrontierChunks: number;
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
  agedOutFrontierChunks: number;
  deferredChunks: number;
  effectiveChunks: number;
  frontierChunks: number;
  backgroundSourceChunks: number;
  directRegionCandidateChunks: number;
  directPromotionBudget: number;
  directPromotedChunks: number;
  directSuppressedChunks: number;
  nearZeroCandidateChunks: number;
  nearZeroSkippedChunks: number;
  refreshedRegions: number;
  retainedFrontierChunks: number;
  staleFrontierChunks: number;
  skippedBackgroundChunks: number;
  neighborChunks: number;
  seedChunks: number;
  selectedChunks: number;
}

interface DiffusionOptions {
  deferredChunkIds?: Set<number>;
  frontierChunkIds?: Iterable<number>;
  sourceChunkIds?: Iterable<number>;
  sourceStats?: PressureDiffusionSourceSelectionStats;
}

interface EnvironmentChunkUpdateResult {
  dirtyMask: number;
  updatedCells: number;
}

interface PressureDiffusionSourceSelection {
  chunkIds: Set<number>;
  frontierChunkIds: Set<number>;
  stats: PressureDiffusionSourceSelectionStats;
}

interface PressureDiffusionSourceSelectionStats {
  backgroundSourceChunks: number;
  directCandidateChunks: number;
  directRegionCandidateChunks: number;
  directPromotionBudget: number;
  directPromotedChunks: number;
  directSuppressedChunks: number;
  directWriteImpulse: number;
  frontierChunks: number;
  skippedBackgroundChunks: number;
}

const TERRAIN_MOISTURE_VISUAL_SCALE = 0.22;
const TERRAIN_MOISTURE_VISUAL_STEP = 1 / 255;
const PRESSURE_DIFFUSION_CHUNK_DELTA_THRESHOLD = 0.25;
const PRESSURE_DIFFUSION_FRONTIER_PRESSURE_THRESHOLD = 0.01;
const PRESSURE_DIFFUSION_FRONTIER_DELTA_THRESHOLD = 0.02;
const PRESSURE_DIFFUSION_FRONTIER_STALE_TICK_LIMIT = 2;
const PRESSURE_DIFFUSION_FRONTIER_MAX_IDLE_TICKS = 6;
const PRESSURE_DIRECT_PROMOTION_IMPULSE_THRESHOLD = 0.18;
const PRESSURE_DIRECT_PROMOTION_CELL_THRESHOLD = 4;
const PRESSURE_DIRECT_PROMOTION_MAX_DELTA_THRESHOLD = 0.45;
const PRESSURE_DIRECT_PROMOTION_SOURCE_FRACTION = 0.25;
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
  const largeWorld = world.size > LARGE_WORLD_CELL_LIMIT;
  const fieldCadence = chunkFieldUpdateCadence(config, largeWorld);
  measureCoreProfile(profile, "core.world.updateChunkActivity", () =>
    updateChunkActivity(world.chunks, tick, fieldCadence.warmInterval, fieldCadence.sleepingInterval, largeWorld)
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
  const pressureDiffusionSourceSelection =
    largeWorld ? selectPressureDiffusionSourceChunks(world, config, tick) : undefined;
  const pressureDiffusionDeferredChunks = pressureDiffusionSourceSelection ? new Set<number>() : undefined;

  measureCoreProfile(profile, "core.world.environmentChunks", () => {
    for (const chunk of world.chunks.chunks) {
      const fieldUpdate = chunkFieldUpdateDecision(chunk, tick, fieldCadence.warmInterval, fieldCadence.sleepingInterval);
      if (!fieldUpdate.shouldUpdate) {
        continue;
      }

      const elapsed = Math.max(1, tick - chunk.lastUpdatedTick);
      const isCatchUp = fieldUpdate.lane !== "activeEnvironment" && elapsed > 1;
      const result = updateEnvironmentChunk(world, config, cap, chunk, elapsed, isCatchUp, fieldCadence.sleepingInterval);
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
      chunk.fieldDirtyMask = 0;
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
      frontierChunkIds: pressureDiffusionSourceSelection?.frontierChunkIds,
      sourceChunkIds: pressureDiffusionSourceSelection?.chunkIds,
      sourceStats: pressureDiffusionSourceSelection?.stats
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
    directPressureCandidateChunks: directFieldWriteCounts.directPressureCandidateChunks,
    directPressureRegionCandidateChunks: diffusion.directRegionCandidateChunks,
    directPressurePromotionBudget: diffusion.directPromotionBudget,
    directPressurePromotedChunks: diffusion.directPromotedChunks,
    directPressureSuppressedChunks: diffusion.directSuppressedChunks,
    directPressureWriteImpulse: directFieldWriteCounts.directPressureWriteImpulse,
    effectiveWarmChunkInterval: fieldCadence.warmInterval,
    effectiveSleepingChunkInterval: fieldCadence.sleepingInterval,
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
    diffusionBackgroundSourceChunks: diffusion.backgroundSourceChunks,
    diffusionFrontierChunks: diffusion.frontierChunks,
    diffusionStaleFrontierChunks: diffusion.staleFrontierChunks,
    diffusionAgedOutFrontierChunks: diffusion.agedOutFrontierChunks,
    diffusionRetainedFrontierChunks: diffusion.retainedFrontierChunks,
    diffusionDeferredChunks: diffusion.deferredChunks,
    diffusionNearZeroCandidateChunks: diffusion.nearZeroCandidateChunks,
    diffusionNearZeroSkippedChunks: diffusion.nearZeroSkippedChunks,
    diffusionSkippedBackgroundChunks: diffusion.skippedBackgroundChunks,
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
  profile?.recordValue("core.scheduler.directPressureCandidateChunks", directFieldWriteCounts.directPressureCandidateChunks);
  profile?.recordValue("core.scheduler.directPressureRegionCandidateChunks", diffusion.directRegionCandidateChunks);
  profile?.recordValue("core.scheduler.directPressurePromotionBudget", diffusion.directPromotionBudget);
  profile?.recordValue("core.scheduler.directPressurePromotedChunks", diffusion.directPromotedChunks);
  profile?.recordValue("core.scheduler.directPressureSuppressedChunks", diffusion.directSuppressedChunks);
  profile?.recordValue("core.scheduler.directPressureWriteImpulse", directFieldWriteCounts.directPressureWriteImpulse);
  profile?.recordValue("core.scheduler.effectiveWarmChunkInterval", fieldCadence.warmInterval);
  profile?.recordValue("core.scheduler.effectiveSleepingChunkInterval", fieldCadence.sleepingInterval);
  profile?.recordValue("core.scheduler.warmEnvironmentChunks", warmEnvironmentChunks);
  profile?.recordValue("core.scheduler.warmFieldUpdateChunks", warmFieldUpdateChunks);
  profile?.recordValue("core.scheduler.sleepingCatchupChunks", sleepingCatchupChunks);
  profile?.recordValue("core.scheduler.sleepingFieldUpdateChunks", sleepingFieldUpdateChunks);
  profile?.recordValue("core.scheduler.summaryRefreshChunks", summaryRefreshChunks);
  profile?.recordValue("core.scheduler.summaryRefreshRegions", summaryRefreshRegions);
  const result: EnvironmentFieldUpdateResult = {
    activeEnvironmentChunks,
    catchUpUpdatedCells,
    catchUpFieldUpdates,
    diffusionChunks: diffusion.selectedChunks,
    diffusionBackgroundSourceChunks: diffusion.backgroundSourceChunks,
    diffusionDeferredChunks: diffusion.deferredChunks,
    diffusionEffectiveChunks: diffusion.effectiveChunks,
    diffusionFrontierChunks: diffusion.frontierChunks,
    diffusionNearZeroCandidateChunks: diffusion.nearZeroCandidateChunks,
    diffusionNearZeroSkippedChunks: diffusion.nearZeroSkippedChunks,
    diffusionNeighborChunks: diffusion.neighborChunks,
    diffusionRetainedFrontierChunks: diffusion.retainedFrontierChunks,
    diffusionSeedChunks: diffusion.seedChunks,
    diffusionSelectedChunks: diffusion.selectedChunks,
    diffusionSkippedBackgroundChunks: diffusion.skippedBackgroundChunks,
    diffusionStaleFrontierChunks: diffusion.staleFrontierChunks,
    diffusionAgedOutFrontierChunks: diffusion.agedOutFrontierChunks,
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
  clearChunkPressureWriteCandidates(world.chunks, tick);
  return result;
}

function updateEnvironmentChunk(
  world: WorldState,
  config: SimulationConfig,
  cap: number,
  chunk: ChunkRecord,
  elapsed: number,
  isCatchUp: boolean,
  catchUpStepLimit: number
): EnvironmentChunkUpdateResult {
  let dirtyMask = CHUNK_DIRTY.resource | CHUNK_DIRTY.trace | CHUNK_DIRTY.pressure;
  let updatedCells = 0;
  const steps = isCatchUp ? Math.min(elapsed, catchUpStepLimit) : 1;
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
      backgroundSourceChunks: 0,
      directRegionCandidateChunks: 0,
      directPromotionBudget: 0,
      directPromotedChunks: 0,
      directSuppressedChunks: 0,
      frontierChunks: 0,
      nearZeroCandidateChunks: 0,
      nearZeroSkippedChunks: 0,
      refreshedRegions: 0,
      retainedFrontierChunks: 0,
      staleFrontierChunks: 0,
      agedOutFrontierChunks: 0,
      skippedBackgroundChunks: 0,
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
  const explicitFrontierChunkIds = options.frontierChunkIds ? new Set(options.frontierChunkIds) : null;
  const deferredChunkIds = options.deferredChunkIds;
  const backgroundSourceChunks = options.sourceStats?.backgroundSourceChunks ?? 0;
  const directRegionCandidateChunks = options.sourceStats?.directRegionCandidateChunks ?? 0;
  const directPromotionBudget = options.sourceStats?.directPromotionBudget ?? 0;
  const directPromotedChunks = options.sourceStats?.directPromotedChunks ?? 0;
  const directSuppressedChunks = options.sourceStats?.directSuppressedChunks ?? 0;
  const frontierChunks = options.sourceStats?.frontierChunks ?? 0;
  const skippedBackgroundChunks = options.sourceStats?.skippedBackgroundChunks ?? 0;
  const selectedSourceBudget = explicitSourceChunkIds
    ? pressureDiffusionSourceBudget(config, explicitSourceChunkIds.size)
    : Number.POSITIVE_INFINITY;
  const selectedChunkBudget = explicitSourceChunkIds
    ? pressureDiffusionChunkBudget(config, world.chunks.chunks.length)
    : Number.POSITIVE_INFINITY;
  let skippedSleepingChunks = 0;
  let nearZeroCandidateChunks = 0;
  let nearZeroSkippedChunks = 0;
  let staleFrontierChunks = 0;
  let agedOutFrontierChunks = 0;
  measureCoreProfile(profile, "core.diffusion.selectChunks", () => {
    for (const chunk of world.chunks.chunks) {
      if (explicitSourceChunkIds && !explicitSourceChunkIds.has(chunk.id)) {
        continue;
      }
      if (!explicitSourceChunkIds && world.size > LARGE_WORLD_CELL_LIMIT && chunk.activity === "sleeping" && !chunk.fieldDirtyMask) {
        skippedSleepingChunks += 1;
        continue;
      }
      if (chunk.summary.pressure <= 0.0001 && !chunk.fieldDirtyMask) {
        nearZeroCandidateChunks += 1;
      }
      const isFrontierSource = explicitFrontierChunkIds ? explicitFrontierChunkIds.has(chunk.id) : true;
      const neighborFrontierIds = isFrontierSource
        ? pressureDiffusionNeighborFrontierIds(world, pressure, chunk, chunksToDiffuse)
        : [];
      if (
        sourceChunksToDiffuse.size >= selectedSourceBudget ||
        !canAddDiffusionSource(chunksToDiffuse, chunk.id, neighborFrontierIds, selectedChunkBudget)
      ) {
        if (isFrontierSource && deferredChunkIds && pressureFrontierShouldStayQueued(chunk, tick)) {
          deferredChunkIds.add(chunk.id);
        } else if (isFrontierSource) {
          agedOutFrontierChunks += 1;
          ageOutPressureFrontier(chunk);
        }
        continue;
      }
      chunksToDiffuse.add(chunk.id);
      sourceChunksToDiffuse.add(chunk.id);
      for (const neighborId of neighborFrontierIds) {
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
  const retainedFrontierChunkIds = new Set<number>();
  const changedRegionIds = new Set<number>();
  measureCoreProfile(profile, "core.diffusion.commit", () => {
    for (const chunkId of chunksToDiffuse) {
      const chunk = world.chunks.chunks[chunkId];
      let pressureTotal = 0;
      let chunkChanged = false;
      let chunkDelta = 0;
      let maxCellDelta = 0;
      const wasFrontierSource = explicitFrontierChunkIds ? explicitFrontierChunkIds.has(chunk.id) : chunk.pressureDiffusionActive;
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
          maxCellDelta = Math.max(maxCellDelta, delta);
          pressure[idx] = next;
          pressureTotal += next;
        }
      }
      chunk.summary.pressure = pressureTotal;
      if (chunkChanged && chunkDelta >= PRESSURE_DIFFUSION_CHUNK_DELTA_THRESHOLD) {
        changedChunks += 1;
        changedRegionIds.add(chunk.regionId);
        markChunkProjectionDirty(world.chunks, chunk.id, CHUNK_DIRTY.pressure);
        if (!explicitFrontierChunkIds || explicitFrontierChunkIds.has(chunk.id)) {
          if (maxCellDelta >= PRESSURE_DIFFUSION_FRONTIER_DELTA_THRESHOLD) {
            retainPressureFrontier(chunk, tick, retainedFrontierChunkIds);
          }
          for (const neighborId of neighborChunkIds(world.chunks, chunk)) {
            const neighbor = world.chunks.chunks[neighborId];
            if (neighbor && pressureFrontierGradient(world, pressure, chunk, neighbor)) {
              retainPressureFrontier(neighbor, tick, retainedFrontierChunkIds);
            }
          }
        }
      } else {
        unchangedChunks += 1;
        if (!wasFrontierSource) {
          if (maxCellDelta >= PRESSURE_DIFFUSION_FRONTIER_DELTA_THRESHOLD) {
            retainPressureFrontier(chunk, tick, retainedFrontierChunkIds);
          }
          continue;
        }
        if (pressureFrontierShouldAgeOut(chunk, tick)) {
          agedOutFrontierChunks += 1;
          ageOutPressureFrontier(chunk);
        } else {
          staleFrontierChunks += 1;
          chunk.pressureFrontierStaleTicks += 1;
          if (pressureFrontierShouldStayQueued(chunk, tick)) {
            retainedFrontierChunkIds.add(chunk.id);
          } else {
            agedOutFrontierChunks += 1;
            ageOutPressureFrontier(chunk);
          }
        }
      }
    }
    if (deferredChunkIds) {
      for (const chunkId of deferredChunkIds) {
        const chunk = world.chunks.chunks[chunkId];
        if (!chunk) {
          continue;
        }
        if (pressureFrontierShouldAgeOut(chunk, tick)) {
          agedOutFrontierChunks += 1;
          ageOutPressureFrontier(chunk);
        } else if (pressureFrontierShouldStayQueued(chunk, tick)) {
          retainedFrontierChunkIds.add(chunkId);
        } else {
          agedOutFrontierChunks += 1;
          ageOutPressureFrontier(chunk);
        }
      }
    }
    for (const chunkId of retainedFrontierChunkIds) {
      const chunk = world.chunks.chunks[chunkId];
      if (chunk) {
        chunk.pressureDiffusionActive = true;
      }
    }
  });
  profile?.recordValue("core.diffusion.changedCells", changedCells);
  profile?.recordValue("core.diffusion.unchangedCells", unchangedCells);
  profile?.recordValue("core.diffusion.changedChunks", changedChunks);
  profile?.recordValue("core.diffusion.unchangedChunks", unchangedChunks);
  profile?.recordValue("core.diffusion.effectiveChunks", changedChunks);
  profile?.recordValue("core.diffusion.backgroundSourceChunks", backgroundSourceChunks);
  profile?.recordValue("core.diffusion.directCandidateChunks", options.sourceStats?.directCandidateChunks ?? 0);
  profile?.recordValue("core.diffusion.directRegionCandidateChunks", directRegionCandidateChunks);
  profile?.recordValue("core.diffusion.directPromotionBudget", directPromotionBudget);
  profile?.recordValue("core.diffusion.directPromotedChunks", directPromotedChunks);
  profile?.recordValue("core.diffusion.directSuppressedChunks", directSuppressedChunks);
  profile?.recordValue("core.diffusion.directWriteImpulse", options.sourceStats?.directWriteImpulse ?? 0);
  profile?.recordValue("core.diffusion.frontierChunks", frontierChunks);
  profile?.recordValue("core.diffusion.staleFrontierChunks", staleFrontierChunks);
  profile?.recordValue("core.diffusion.agedOutFrontierChunks", agedOutFrontierChunks);
  profile?.recordValue("core.diffusion.retainedFrontierChunks", retainedFrontierChunkIds.size);
  profile?.recordValue("core.diffusion.skippedBackgroundChunks", skippedBackgroundChunks);
  profile?.recordValue("core.dirty.pressureAfterDiffusion", countProjectionDirtyMask(world, CHUNK_DIRTY.pressure));
  profile?.recordValue("core.dirty.moistureAfterDiffusion", countProjectionDirtyMask(world, CHUNK_DIRTY.moisture));

  measureCoreProfile(profile, "core.diffusion.refreshRegions", () =>
    refreshRegionsById(world.regions, world.chunks, world.terrain, world.fields, world.width, changedRegionIds)
  );
  const result = {
    deferredChunks,
    effectiveChunks: changedChunks,
    agedOutFrontierChunks,
    backgroundSourceChunks,
    directRegionCandidateChunks,
    directPromotionBudget,
    directPromotedChunks,
    directSuppressedChunks,
    frontierChunks,
    nearZeroCandidateChunks,
    nearZeroSkippedChunks,
    refreshedRegions: changedRegionIds.size,
    retainedFrontierChunks: retainedFrontierChunkIds.size,
    staleFrontierChunks,
    skippedBackgroundChunks,
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
    diffusionBackgroundSourceChunks: result.backgroundSourceChunks,
    directPressureRegionCandidateChunks: result.directRegionCandidateChunks,
    directPressurePromotionBudget: result.directPromotionBudget,
    directPressurePromotedChunks: result.directPromotedChunks,
    directPressureSuppressedChunks: result.directSuppressedChunks,
    diffusionSeedChunks: result.seedChunks,
    diffusionNeighborChunks: result.neighborChunks,
    diffusionSelectedChunks: result.selectedChunks,
    diffusionEffectiveChunks: result.effectiveChunks,
    diffusionFrontierChunks: result.frontierChunks,
    diffusionStaleFrontierChunks: result.staleFrontierChunks,
    diffusionAgedOutFrontierChunks: result.agedOutFrontierChunks,
    diffusionRetainedFrontierChunks: result.retainedFrontierChunks,
    diffusionDeferredChunks: result.deferredChunks,
    diffusionNearZeroCandidateChunks: result.nearZeroCandidateChunks,
    diffusionNearZeroSkippedChunks: result.nearZeroSkippedChunks,
    diffusionSkippedBackgroundChunks: result.skippedBackgroundChunks
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
  selectedChunkIds: Set<number>,
  sourceChunkId: number,
  neighborFrontierIds: number[],
  selectedChunkBudget: number
): boolean {
  if (selectedChunkIds.has(sourceChunkId)) {
    return true;
  }
  let additionalChunks = 1;
  for (const neighborId of neighborFrontierIds) {
    if (!selectedChunkIds.has(neighborId)) {
      additionalChunks += 1;
    }
  }
  return selectedChunkIds.size + additionalChunks <= selectedChunkBudget;
}

function pressureDiffusionNeighborFrontierIds(
  world: WorldState,
  pressure: Float32Array,
  chunk: ChunkRecord,
  selectedChunkIds: Set<number>
): number[] {
  const neighborIds: number[] = [];
  for (const neighborId of neighborChunkIds(world.chunks, chunk)) {
    if (selectedChunkIds.has(neighborId)) {
      continue;
    }
    const neighbor = world.chunks.chunks[neighborId];
    if (neighbor && pressureFrontierGradient(world, pressure, chunk, neighbor)) {
      neighborIds.push(neighborId);
    }
  }
  return neighborIds;
}

function retainPressureFrontier(chunk: ChunkRecord, tick: number, retainedFrontierChunkIds: Set<number>): void {
  chunk.pressureFrontierLastActiveTick = tick;
  chunk.pressureFrontierStaleTicks = 0;
  retainedFrontierChunkIds.add(chunk.id);
}

function pressureFrontierShouldStayQueued(chunk: ChunkRecord, tick: number): boolean {
  return (
    chunk.pressureFrontierStaleTicks < PRESSURE_DIFFUSION_FRONTIER_STALE_TICK_LIMIT &&
    tick - chunk.pressureFrontierLastActiveTick <= PRESSURE_DIFFUSION_FRONTIER_MAX_IDLE_TICKS
  );
}

function pressureFrontierShouldAgeOut(chunk: ChunkRecord, tick: number): boolean {
  return !pressureFrontierShouldStayQueued(chunk, tick);
}

function ageOutPressureFrontier(chunk: ChunkRecord): void {
  chunk.pressureDiffusionActive = false;
  chunk.pressureFrontierStaleTicks = 0;
}

function pressureDirectWriteCandidateScore(chunk: ChunkRecord): number {
  const cells = Math.max(1, chunk.width * chunk.height);
  const density = chunk.pressureWriteCells / cells;
  const averagePressure = chunk.summary.pressure / cells;
  if (
    chunk.pressureWriteImpulse < PRESSURE_DIRECT_PROMOTION_IMPULSE_THRESHOLD &&
    chunk.pressureWriteCells < PRESSURE_DIRECT_PROMOTION_CELL_THRESHOLD &&
    chunk.pressureWriteMaxDelta < PRESSURE_DIRECT_PROMOTION_MAX_DELTA_THRESHOLD &&
    averagePressure < PRESSURE_DIFFUSION_FRONTIER_PRESSURE_THRESHOLD
  ) {
    return 0;
  }
  return chunk.pressureWriteImpulse + chunk.pressureWriteMaxDelta * 2 + density * 8 + averagePressure * 0.08;
}

function pressureDirectPromotionBudget(sourceBudget: number, regionCandidates: number): number {
  const directBudget = Math.max(1, Math.floor(sourceBudget * PRESSURE_DIRECT_PROMOTION_SOURCE_FRACTION));
  return Math.min(regionCandidates, directBudget);
}

function selectPressureDiffusionSourceChunks(world: WorldState, config: SimulationConfig, tick: number): PressureDiffusionSourceSelection {
  const sourceChunkIds = new Set<number>();
  const frontierChunkIds = new Set<number>();
  const directCandidatesByRegion = new Map<number, { chunk: ChunkRecord; score: number }>();
  let backgroundSourceChunks = 0;
  let directCandidateChunks = 0;
  let directRegionCandidateChunks = 0;
  let directPromotionBudget = 0;
  let directPromotedChunks = 0;
  let directSuppressedChunks = 0;
  let directWriteImpulse = 0;
  let frontierChunks = 0;
  let skippedBackgroundChunks = 0;
  const interval = PRESSURE_DIFFUSION_BACKGROUND_INTERVAL;
  const sourceBudget = pressureDiffusionSourceBudget(config, world.chunks.chunks.length);

  for (const chunk of world.chunks.chunks) {
    if (chunk.pressureDiffusionActive || chunk.fieldDirtyMask & CHUNK_DIRTY.pressure) {
      sourceChunkIds.add(chunk.id);
      frontierChunkIds.add(chunk.id);
      frontierChunks += 1;
      continue;
    }
    if (chunk.pressureWriteLastTick <= tick && (chunk.pressureWriteImpulse > 0 || chunk.pressureWriteCells > 0)) {
      directCandidateChunks += 1;
      directWriteImpulse += chunk.pressureWriteImpulse;
      const score = pressureDirectWriteCandidateScore(chunk);
      if (score > 0) {
        const existing = directCandidatesByRegion.get(chunk.regionId);
        if (!existing || score > existing.score || (score === existing.score && chunk.id < existing.chunk.id)) {
          directCandidatesByRegion.set(chunk.regionId, { chunk, score });
        }
      }
    }
  }

  const directCandidates = Array.from(directCandidatesByRegion.values());
  directRegionCandidateChunks = directCandidates.length;
  directPromotionBudget = pressureDirectPromotionBudget(sourceBudget, directRegionCandidateChunks);
  directCandidates.sort((a, b) => b.score - a.score || a.chunk.id - b.chunk.id);
  for (const candidate of directCandidates) {
    if (directPromotedChunks >= directPromotionBudget || sourceChunkIds.size >= sourceBudget) {
      continue;
    }
    sourceChunkIds.add(candidate.chunk.id);
    directPromotedChunks += 1;
  }

  directSuppressedChunks = Math.max(0, directCandidateChunks - directPromotedChunks);

  if (sourceChunkIds.size === 0) {
    for (const chunk of world.chunks.chunks) {
      if (chunk.summary.pressure <= PRESSURE_DIFFUSION_FRONTIER_PRESSURE_THRESHOLD) {
        skippedBackgroundChunks += 1;
        continue;
      }
      if (sourceChunkIds.size < sourceBudget && (chunk.id + tick) % interval === 0) {
        sourceChunkIds.add(chunk.id);
        backgroundSourceChunks += 1;
      }
    }
  }

  return {
    chunkIds: sourceChunkIds,
    frontierChunkIds,
    stats: {
      backgroundSourceChunks,
      directCandidateChunks,
      directRegionCandidateChunks,
      directPromotionBudget,
      directPromotedChunks,
      directSuppressedChunks,
      directWriteImpulse,
      frontierChunks,
      skippedBackgroundChunks
    }
  };
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

function pressureFrontierGradient(
  world: WorldState,
  pressure: Float32Array,
  source: ChunkRecord,
  neighbor: ChunkRecord
): boolean {
  const columns = world.chunks.columns;
  const rows = world.chunks.rows;
  const east = (source.x + 1) % columns === neighbor.x;
  const west = (source.x + columns - 1) % columns === neighbor.x;
  const south = (source.y + 1) % rows === neighbor.y;
  const north = (source.y + rows - 1) % rows === neighbor.y;

  if (north || south) {
    const sourceY = south ? source.endY - 1 : source.startY;
    const neighborY = south ? neighbor.startY : neighbor.endY - 1;
    for (let x = source.startX; x < source.endX; x += 1) {
      const sourcePressure = pressure[sourceY * world.width + x];
      const neighborPressure = pressure[neighborY * world.width + x];
      if (pressureBoundaryDeltaIsActive(sourcePressure, neighborPressure)) {
        return true;
      }
    }
    return false;
  }

  if (west || east) {
    const sourceX = east ? source.endX - 1 : source.startX;
    const neighborX = east ? neighbor.startX : neighbor.endX - 1;
    for (let y = source.startY; y < source.endY; y += 1) {
      const sourcePressure = pressure[y * world.width + sourceX];
      const neighborPressure = pressure[y * world.width + neighborX];
      if (pressureBoundaryDeltaIsActive(sourcePressure, neighborPressure)) {
        return true;
      }
    }
  }

  return false;
}

function pressureBoundaryDeltaIsActive(a: number, b: number): boolean {
  return Math.max(a, b) >= PRESSURE_DIFFUSION_FRONTIER_PRESSURE_THRESHOLD && Math.abs(a - b) >= PRESSURE_DIFFUSION_FRONTIER_DELTA_THRESHOLD;
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
