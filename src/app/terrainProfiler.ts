import type { ProjectionProfileStats } from "./render/projection";
import type { FieldOverlayProfileStats } from "./render/fieldOverlays";
import {
  isBaseLayer,
  isOverlayLayer,
  type BaseLayer,
  type OverlayState
} from "./render/mapViewTypes";
import type { CoreProfileSink } from "../core/profile";

export type TerrainProfilePhase =
  | "advanceSimulation"
  | "core.diffusion.commit"
  | "core.diffusion.compute"
  | "core.diffusion.refreshRegions"
  | "core.diffusion.selectChunks"
  | "core.tick.agents"
  | "core.tick.births"
  | "core.tick.overflow"
  | "core.tick.refreshAgentChunks"
  | "core.tick.survivors"
  | "core.tick.total"
  | "core.tick.updateWorld"
  | "core.world.diffusePressure"
  | "core.world.activeEnvironmentUpdate"
  | "core.world.environmentChunks"
  | "core.world.refreshChunkSummaries"
  | "core.world.sleepingCatchUpUpdate"
  | "core.world.warmCatchUpUpdate"
  | "core.world.refreshRegions"
  | "core.world.spawnProcess"
  | "core.world.touchEvent"
  | "core.world.touchProcesses"
  | "core.world.triggerEvent"
  | "core.world.updateChunkActivity"
  | "core.world.updateProcesses"
  | "frame.interval"
  | "frame.total"
  | "fieldOverlay.paintCells"
  | "inspector.update"
  | "metrics.compute"
  | "metrics.domUpdate"
  | "projection.paintCells"
  | "projection.selectChunks"
  | "render.fieldOverlay.total"
  | "render.drawImage"
  | "render.overlayAgents"
  | "render.overlayProcesses"
  | "render.projection.total"
  | "render.putImageData"
  | "render.total"
  | "sim.step";

export type TerrainProfileValue =
  | "projection.consumedDirtyChunks"
  | "core.diffusion.backgroundSourceChunks"
  | "core.diffusion.changedCells"
  | "core.diffusion.changedChunks"
  | "core.diffusion.computedCells"
  | "core.diffusion.deferredChunks"
  | "core.diffusion.directCandidateChunks"
  | "core.diffusion.directRegionCandidateChunks"
  | "core.diffusion.directPromotionBudget"
  | "core.diffusion.directPromotedChunks"
  | "core.diffusion.directSuppressedChunks"
  | "core.diffusion.directWriteImpulse"
  | "core.diffusion.effectiveChunks"
  | "core.diffusion.frontierChunks"
  | "core.diffusion.staleFrontierChunks"
  | "core.diffusion.agedOutFrontierChunks"
  | "core.diffusion.nearZeroCandidateChunks"
  | "core.diffusion.nearZeroSkippedChunks"
  | "core.diffusion.neighborChunks"
  | "core.diffusion.neighborExpansionChunks"
  | "core.diffusion.retainedFrontierChunks"
  | "core.diffusion.seedChunks"
  | "core.diffusion.sourceChunks"
  | "core.diffusion.selectedChunks"
  | "core.diffusion.skippedBackgroundChunks"
  | "core.diffusion.skippedSleepingChunks"
  | "core.diffusion.unchangedCells"
  | "core.diffusion.unchangedChunks"
  | "core.dirty.moistureAfterDiffusion"
  | "core.dirty.moistureAfterEnvironment"
  | "core.dirty.moistureAfterWorld"
  | "core.dirty.pressureAfterDiffusion"
  | "core.dirty.pressureAfterWorld"
  | "core.dirty.processTouchChunks"
  | "core.world.catchUpUpdatedCells"
  | "core.world.catchUpUpdatedChunks"
  | "core.world.activeEnvironmentCells"
  | "core.world.sleepingUpdatedCells"
  | "core.world.preciseUpdatedCells"
  | "core.world.preciseUpdatedChunks"
  | "core.world.updatedCells"
  | "core.world.updatedChunks"
  | "core.world.warmUpdatedCells"
  | "core.scheduler.activeAgentOnlyChunks"
  | "core.scheduler.activeEnvironmentChunks"
  | "core.scheduler.activeFieldDirtyChunks"
  | "core.scheduler.activeMixedDirtyChunks"
  | "core.scheduler.directFieldWriteChunks"
  | "core.scheduler.directMixedFieldWriteChunks"
  | "core.scheduler.directPressureCandidateChunks"
  | "core.scheduler.directPressureRegionCandidateChunks"
  | "core.scheduler.directPressurePromotionBudget"
  | "core.scheduler.directPressurePromotedChunks"
  | "core.scheduler.directPressureSuppressedChunks"
  | "core.scheduler.directPressureWriteChunks"
  | "core.scheduler.directPressureWriteImpulse"
  | "core.scheduler.directResourceWriteChunks"
  | "core.scheduler.directTraceWriteChunks"
  | "core.scheduler.effectiveSleepingChunkInterval"
  | "core.scheduler.effectiveWarmChunkInterval"
  | "core.scheduler.sleepingCatchupChunks"
  | "core.scheduler.sleepingFieldUpdateChunks"
  | "core.scheduler.summaryRefreshChunks"
  | "core.scheduler.summaryRefreshRegions"
  | "core.scheduler.warmEnvironmentChunks"
  | "core.scheduler.warmFieldUpdateChunks"
  | "projection.dirtyMaskChunks"
  | "projection.fullRebuild"
  | "projection.hiddenDirtyChunks"
  | "projection.moistureDirtyChunks"
  | "projection.pressureDirtyChunks"
  | "projection.projectedCells"
  | "projection.projectedChunks"
  | "projection.retainedDirtyChunks"
  | "projection.retiredDirtyChunks"
  | "projection.resourceDirtyChunks"
  | "fieldOverlay.consumedDirtyChunks"
  | "fieldOverlay.dirtyMaskChunks"
  | "fieldOverlay.fullRebuild"
  | "fieldOverlay.projectedCells"
  | "fieldOverlay.projectedChunks"
  | "core.tail.catchUpAndDiffusionCells"
  | "core.tail.fieldAndDiffusionCells"
  | "core.tail.summaryAndDiffusionChunks"
  | "runtime.backlogTicks"
  | "runtime.mode"
  | "runtime.observedTickRate"
  | "runtime.tickBudgetMs"
  | "runtime.tickCapacity"
  | "ticksPerFrame";

export interface TerrainProfileScenario {
  baseLayer: string;
  overlays: Record<string, boolean>;
  tickRate: number;
  world: {
    width: number;
    height: number;
    tick: number;
    agents: number;
    chunks: number;
  };
  canvas: {
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
    devicePixelRatio: number;
  };
}

export interface ProfileStats {
  count: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
}

export interface TerrainProfileSample {
  index: number;
  elapsedMs: number;
  durationMs: number;
  counters: ProfileCounters;
  durations: Partial<Record<TerrainProfilePhase, ProfileStats>>;
  values: Partial<Record<TerrainProfileValue, ProfileStats>>;
  latestProjection: ProjectionProfileStats | null;
  scenario: TerrainProfileScenario;
}

export interface TerrainProfileReport {
  kind: "primordia.terrain-profile";
  schemaVersion: 1;
  assessment: TerrainProfileAssessment;
  startedAt: string;
  elapsedMs: number;
  targetDurationMs: number;
  complete: boolean;
  counters: ProfileCounters;
  durations: Partial<Record<TerrainProfilePhase, ProfileStats>>;
  values: Partial<Record<TerrainProfileValue, ProfileStats>>;
  latestProjection: ProjectionProfileStats | null;
  scenario: TerrainProfileScenario;
  samples: TerrainProfileSample[];
}

export interface TerrainProfileAssessment {
  pass: boolean;
  checks: {
    backlogStable: boolean;
    renderWithinBudget: boolean;
    simP50WithinBudget: boolean;
    simP95WithinBudget: boolean;
  };
  limits: {
    backlogP95Max: number;
    renderP95Ms: number;
    simP50Ms: number;
    simP95Ms: number;
  };
  summary: string[];
}

export interface TerrainProfilerOptions {
  detail?: "base" | "deep";
  durationSeconds?: number;
  log?: ((message: string) => void) | null;
  now?: number;
  sampleIntervalMs?: number;
  startedAt?: string;
}

export interface TerrainProfileDisplayConfig {
  baseLayer: BaseLayer;
  overlays: OverlayState;
}

interface ProfileCounters {
  frames: number;
  longFrames33: number;
  longFrames50: number;
  pointerMoves: number;
  ticks: number;
}

interface ProfileBucket {
  counters: ProfileCounters;
  durations: Partial<Record<TerrainProfilePhase, number[]>>;
  values: Partial<Record<TerrainProfileValue, number[]>>;
  startedAtMs: number;
}

const DEFAULT_DURATION_SECONDS = 60;
const DEFAULT_SAMPLE_INTERVAL_MS = 1000;
const TERRAIN_BASELINE_LIMITS = {
  backlogP95Max: 3,
  renderP95Ms: 8,
  simP50Ms: 24,
  simP95Ms: 33
} as const;

export class TerrainProfiler {
  readonly startedAt: string;
  readonly startMs: number;
  readonly targetDurationMs: number;
  readonly detail: "base" | "deep";

  private readonly sampleIntervalMs: number;
  private readonly log: ((message: string) => void) | null;
  private lastFrameNow: number | null = null;
  private lastSampleAtMs: number;
  private current: ProfileBucket;
  private total: ProfileBucket;
  private samples: TerrainProfileSample[] = [];
  private latestProjection: ProjectionProfileStats | null = null;

  constructor(options: TerrainProfilerOptions = {}) {
    this.startMs = options.now ?? performance.now();
    this.startedAt = options.startedAt ?? new Date().toISOString();
    this.detail = options.detail ?? "base";
    this.targetDurationMs = Math.max(1, options.durationSeconds ?? DEFAULT_DURATION_SECONDS) * 1000;
    this.sampleIntervalMs = Math.max(250, options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS);
    this.log = options.log ?? null;
    this.lastSampleAtMs = this.startMs;
    this.current = createBucket(this.startMs);
    this.total = createBucket(this.startMs);
  }

  recordFrameInterval(frameNow: number): void {
    if (this.lastFrameNow !== null) {
      this.recordDuration("frame.interval", frameNow - this.lastFrameNow);
    }
    this.lastFrameNow = frameNow;
  }

  recordFrame(totalMs: number, ticks: number): void {
    this.recordDuration("frame.total", totalMs);
    this.recordValue("ticksPerFrame", ticks);
    this.addCounter("frames", 1);
    this.addCounter("ticks", ticks);
    if (totalMs > 33) {
      this.addCounter("longFrames33", 1);
    }
    if (totalMs > 50) {
      this.addCounter("longFrames50", 1);
    }
  }

  recordDuration(phase: TerrainProfilePhase, durationMs: number): void {
    appendValue(this.current.durations, phase, durationMs);
    appendValue(this.total.durations, phase, durationMs);
  }

  now(): number {
    return performance.now();
  }

  recordPointerMove(): void {
    this.addCounter("pointerMoves", 1);
  }

  recordProjection(stats: ProjectionProfileStats): void {
    this.latestProjection = { ...stats };
    this.recordDuration("projection.selectChunks", stats.selectChunksMs);
    this.recordDuration("projection.paintCells", stats.paintCellsMs);
    this.recordValue("projection.projectedChunks", stats.projectedChunks);
    this.recordValue("projection.projectedCells", stats.projectedCells);
    this.recordValue("projection.fullRebuild", stats.fullRebuild ? 1 : 0);
    this.recordValue("projection.consumedDirtyChunks", stats.consumedDirtyChunks);
    this.recordValue("projection.dirtyMaskChunks", stats.dirtyMaskChunks);
    this.recordValue("projection.hiddenDirtyChunks", stats.hiddenDirtyChunks);
    this.recordValue("projection.moistureDirtyChunks", stats.moistureDirtyChunks);
    this.recordValue("projection.pressureDirtyChunks", stats.pressureDirtyChunks);
    this.recordValue("projection.retainedDirtyChunks", stats.retainedDirtyChunks);
    this.recordValue("projection.retiredDirtyChunks", stats.retiredDirtyChunks);
    this.recordValue("projection.resourceDirtyChunks", stats.resourceDirtyChunks);
  }

  recordFieldOverlay(stats: FieldOverlayProfileStats): void {
    this.recordDuration("fieldOverlay.paintCells", stats.paintCellsMs);
    this.recordValue("fieldOverlay.projectedChunks", stats.projectedChunks);
    this.recordValue("fieldOverlay.projectedCells", stats.projectedCells);
    this.recordValue("fieldOverlay.fullRebuild", stats.fullRebuild ? 1 : 0);
    this.recordValue("fieldOverlay.consumedDirtyChunks", stats.consumedDirtyChunks);
    this.recordValue("fieldOverlay.dirtyMaskChunks", stats.dirtyMaskChunks);
  }

  coreSink(): CoreProfileSink | null {
    if (this.detail !== "deep") {
      return null;
    }

    return {
      enabled: true,
      now: () => this.now(),
      recordDuration: (phase, durationMs) => {
        this.recordDuration(phase as TerrainProfilePhase, durationMs);
      },
      recordValue: (name, value) => {
        this.recordValue(name as TerrainProfileValue, value);
      }
    };
  }

  maybeSample(nowMs: number, scenario: TerrainProfileScenario): TerrainProfileSample | null {
    if (nowMs - this.lastSampleAtMs < this.sampleIntervalMs) {
      return null;
    }

    const sample = this.createSample(nowMs, scenario);
    this.samples.push(sample);
    this.current = createBucket(nowMs);
    this.lastSampleAtMs = nowMs;

    if (this.log) {
      this.log(formatTerrainProfileSample(sample));
    }

    return sample;
  }

  isComplete(nowMs = performance.now()): boolean {
    return nowMs - this.startMs >= this.targetDurationMs;
  }

  report(scenario: TerrainProfileScenario, nowMs = performance.now()): TerrainProfileReport {
    const durations = summarizeRecord(this.total.durations);
    const values = summarizeRecord(this.total.values);
    return {
      kind: "primordia.terrain-profile",
      schemaVersion: 1,
      assessment: assessTerrainProfile(durations, values),
      startedAt: this.startedAt,
      elapsedMs: nowMs - this.startMs,
      targetDurationMs: this.targetDurationMs,
      complete: this.isComplete(nowMs),
      counters: { ...this.total.counters },
      durations,
      values,
      latestProjection: this.latestProjection ? { ...this.latestProjection } : null,
      scenario,
      samples: [...this.samples]
    };
  }

  recordValue(name: TerrainProfileValue, value: number): void {
    appendValue(this.current.values, name, value);
    appendValue(this.total.values, name, value);
  }

  private addCounter(name: keyof ProfileCounters, value: number): void {
    this.current.counters[name] += value;
    this.total.counters[name] += value;
  }

  private createSample(nowMs: number, scenario: TerrainProfileScenario): TerrainProfileSample {
    return {
      index: this.samples.length,
      elapsedMs: nowMs - this.startMs,
      durationMs: nowMs - this.current.startedAtMs,
      counters: { ...this.current.counters },
      durations: summarizeRecord(this.current.durations),
      values: summarizeRecord(this.current.values),
      latestProjection: this.latestProjection ? { ...this.latestProjection } : null,
      scenario
    };
  }
}

function assessTerrainProfile(
  durations: Partial<Record<TerrainProfilePhase, ProfileStats>>,
  values: Partial<Record<TerrainProfileValue, ProfileStats>>
): TerrainProfileAssessment {
  const simStep = durations["sim.step"];
  const render = durations["render.total"];
  const backlog = values["runtime.backlogTicks"];
  const checks = {
    backlogStable: (backlog?.p95 ?? 0) <= TERRAIN_BASELINE_LIMITS.backlogP95Max,
    renderWithinBudget: (render?.p95 ?? 0) <= TERRAIN_BASELINE_LIMITS.renderP95Ms,
    simP50WithinBudget: (simStep?.p50 ?? Number.POSITIVE_INFINITY) <= TERRAIN_BASELINE_LIMITS.simP50Ms,
    simP95WithinBudget: (simStep?.p95 ?? Number.POSITIVE_INFINITY) <= TERRAIN_BASELINE_LIMITS.simP95Ms
  };
  const summary = [
    `sim.step p50 ${formatStat(simStep?.p50)} <= ${TERRAIN_BASELINE_LIMITS.simP50Ms}`,
    `sim.step p95 ${formatStat(simStep?.p95)} <= ${TERRAIN_BASELINE_LIMITS.simP95Ms}`,
    `runtime.backlogTicks p95 ${formatStat(backlog?.p95)} <= ${TERRAIN_BASELINE_LIMITS.backlogP95Max}`,
    `render.total p95 ${formatStat(render?.p95)} <= ${TERRAIN_BASELINE_LIMITS.renderP95Ms}`
  ];
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    limits: { ...TERRAIN_BASELINE_LIMITS },
    summary
  };
}

export function createTerrainProfilerFromSearch(
  search: string,
  options: Omit<TerrainProfilerOptions, "durationSeconds"> = {}
): TerrainProfiler | null {
  const params = new URLSearchParams(search);
  const profile = params.get("profile");
  if (profile !== "terrain" && profile !== "1") {
    return null;
  }

  const requestedDuration = Number(params.get("profileSeconds"));
  const durationSeconds = Number.isFinite(requestedDuration) && requestedDuration > 0 ? requestedDuration : undefined;
  const detail = params.get("profileDetail") === "deep" || params.get("profile") === "terrain-deep" ? "deep" : "base";
  return new TerrainProfiler({
    ...options,
    detail,
    durationSeconds
  });
}

export function terrainProfileDisplayConfigFromSearch(search: string): TerrainProfileDisplayConfig {
  const params = new URLSearchParams(search);
  const profileBase = params.get("profileBase");
  const baseLayer = profileBase && isBaseLayer(profileBase) ? profileBase : "terrain";
  const overlays: OverlayState = {
    resources: false,
    agents: false,
    processes: false,
    pressure: false,
    lineages: false
  };

  const requestedOverlays = params.get("profileOverlays") ?? "";
  for (const value of requestedOverlays.split(",")) {
    const overlay = value.trim();
    if (isOverlayLayer(overlay)) {
      overlays[overlay] = true;
    }
  }

  return {
    baseLayer,
    overlays
  };
}

export function formatTerrainProfileSample(sample: TerrainProfileSample): string {
  const frame = sample.durations["frame.total"];
  const sim = sample.durations["sim.step"];
  const projection = sample.durations["render.projection.total"];
  const upload = sample.durations["render.putImageData"];
  const metrics = sample.durations["metrics.domUpdate"];
  const projectedChunks = sample.values["projection.projectedChunks"];
  return [
    `[terrain-profile] ${Math.round(sample.elapsedMs / 1000)}s`,
    `frames ${sample.counters.frames}`,
    `frame p95 ${formatStat(frame?.p95)} max ${formatStat(frame?.max)}`,
    `sim p95 ${formatStat(sim?.p95)}`,
    `projection p95 ${formatStat(projection?.p95)}`,
    `upload p95 ${formatStat(upload?.p95)}`,
    `dom p95 ${formatStat(metrics?.p95)}`,
    `chunks p95 ${formatStat(projectedChunks?.p95, 0)}`
  ].join(" | ");
}

function createBucket(startedAtMs: number): ProfileBucket {
  return {
    counters: {
      frames: 0,
      longFrames33: 0,
      longFrames50: 0,
      pointerMoves: 0,
      ticks: 0
    },
    durations: {},
    values: {},
    startedAtMs
  };
}

function appendValue<K extends string>(record: Partial<Record<K, number[]>>, key: K, value: number): void {
  const bucket = record[key] ?? [];
  bucket.push(value);
  record[key] = bucket;
}

function summarizeRecord<K extends string>(record: Partial<Record<K, number[]>>): Partial<Record<K, ProfileStats>> {
  const result: Partial<Record<K, ProfileStats>> = {};
  for (const [key, values] of Object.entries(record) as Array<[K, number[]]>) {
    result[key] = summarize(values);
  }
  return result;
}

function summarize(values: number[]): ProfileStats {
  if (values.length === 0) {
    return { count: 0, avg: 0, p50: 0, p95: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  let total = 0;
  for (const value of values) {
    total += value;
  }

  return {
    count: values.length,
    avg: total / values.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1]
  };
}

function percentile(sorted: number[], percentileValue: number): number {
  if (sorted.length === 1) {
    return sorted[0];
  }
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index];
}

function formatStat(value: number | undefined, digits = 1): string {
  if (value === undefined) {
    return "-";
  }
  return value.toFixed(digits);
}
