import { describe, expect, it } from "vitest";
import {
  createTerrainProfilerFromSearch,
  terrainProfileDisplayConfigFromSearch,
  TerrainProfiler
} from "../src/app/terrainProfiler";

describe("terrain baseline profiler", () => {
  it("stays disabled unless the profile query requests it", () => {
    expect(createTerrainProfilerFromSearch("")).toBeNull();
    expect(createTerrainProfilerFromSearch("?profile=agents")).toBeNull();
    expect(createTerrainProfilerFromSearch("?profile=terrain", { now: 10 })).toBeInstanceOf(TerrainProfiler);
  });

  it("only creates a core sink for deep terrain profiling", () => {
    const base = createTerrainProfilerFromSearch("?profile=terrain", { now: 10 });
    const deep = createTerrainProfilerFromSearch("?profile=terrain&profileDetail=deep", { now: 10 });

    expect(base?.coreSink()).toBeNull();
    expect(deep?.coreSink()).not.toBeNull();
  });

  it("can configure the profiled display layer from the URL", () => {
    const baseline = terrainProfileDisplayConfigFromSearch("?profile=terrain");
    const pressure = terrainProfileDisplayConfigFromSearch("?profile=terrain&profileOverlays=pressure");
    const allProjectionOverlays = terrainProfileDisplayConfigFromSearch(
      "?profile=terrain&profileOverlays=resources,pressure,lineages,unknown"
    );
    const pressureBase = terrainProfileDisplayConfigFromSearch("?profile=terrain&profileBase=pressure&profileOverlays=agents");

    expect(baseline).toEqual({
      baseLayer: "terrain",
      overlays: {
        resources: false,
        agents: false,
        processes: false,
        pressure: false,
        lineages: false
      }
    });
    expect(pressure.overlays.pressure).toBe(true);
    expect(pressure.overlays.resources).toBe(false);
    expect(allProjectionOverlays.overlays).toEqual({
      resources: true,
      agents: false,
      processes: false,
      pressure: true,
      lineages: true
    });
    expect(pressureBase.baseLayer).toBe("pressure");
    expect(pressureBase.overlays.agents).toBe(true);
  });

  it("collects frame, projection, and phase summaries", () => {
    const profiler = new TerrainProfiler({
      now: 0,
      sampleIntervalMs: 250,
      durationSeconds: 1,
      log: null,
      startedAt: "2026-05-27T00:00:00.000Z"
    });
    const scenario = createScenario();

    profiler.recordDuration("sim.step", 3);
    profiler.recordDuration("render.putImageData", 4);
    profiler.recordProjection({
      consumedDirtyChunks: 1,
      dirtyMaskChunks: 2,
      fullRebuild: false,
      hiddenDirtyChunks: 1,
      moistureDirtyChunks: 1,
      projectedCells: 1024,
      projectedChunks: 1,
      pressureDirtyChunks: 2,
      retainedDirtyChunks: 0,
      retiredDirtyChunks: 1,
      resourceDirtyChunks: 1,
      selectChunksMs: 0.2,
      paintCellsMs: 1.5,
      totalChunks: 600,
      visibleDependencyMask: 8
    });
    profiler.recordFieldOverlay({
      consumedDirtyChunks: 2,
      dirtyMaskChunks: 3,
      fullRebuild: false,
      projectedCells: 256,
      projectedChunks: 4,
      visibleDependencyMask: 4,
      paintCellsMs: 0.8
    });
    profiler.recordFrame(16, 1);
    profiler.recordPointerMove();

    const sample = profiler.maybeSample(300, scenario);
    expect(sample?.counters.frames).toBe(1);
    expect(sample?.counters.pointerMoves).toBe(1);
    expect(sample?.durations["sim.step"]?.p95).toBe(3);
    expect(sample?.durations["projection.paintCells"]?.p95).toBe(1.5);
    expect(sample?.values["projection.projectedChunks"]?.p95).toBe(1);
    expect(sample?.values["projection.consumedDirtyChunks"]?.p95).toBe(1);
    expect(sample?.values["projection.hiddenDirtyChunks"]?.p95).toBe(1);
    expect(sample?.values["projection.moistureDirtyChunks"]?.p95).toBe(1);
    expect(sample?.values["projection.retiredDirtyChunks"]?.p95).toBe(1);
    expect(sample?.durations["fieldOverlay.paintCells"]?.p95).toBe(0.8);
    expect(sample?.values["fieldOverlay.projectedChunks"]?.p95).toBe(4);
    expect(sample?.values["fieldOverlay.projectedCells"]?.p95).toBe(256);

    const report = profiler.report(scenario, 1200);
    expect(report.kind).toBe("primordia.terrain-profile");
    expect(report.complete).toBe(true);
    expect(report.counters.frames).toBe(1);
    expect(report.latestProjection?.totalChunks).toBe(600);
    expect(report.assessment.pass).toBe(true);
    expect(report.samples).toHaveLength(1);
  });

  it("records deep core phases and values through the core sink", () => {
    const profiler = new TerrainProfiler({
      detail: "deep",
      now: 0,
      sampleIntervalMs: 250,
      durationSeconds: 1,
      log: null
    });
    const sink = profiler.coreSink();

    sink?.recordDuration("core.tick.updateWorld", 7);
    sink?.recordDuration("core.world.refreshChunkSummaries", 2);
    sink?.recordDuration("core.world.warmCatchUpUpdate", 3);
    sink?.recordValue("core.dirty.moistureAfterEnvironment", 42);
    sink?.recordValue("core.world.warmUpdatedCells", 2048);
    sink?.recordValue("core.diffusion.seedChunks", 3);
    sink?.recordValue("core.diffusion.backgroundSourceChunks", 1);
    sink?.recordValue("core.diffusion.deferredChunks", 1);
    sink?.recordValue("core.diffusion.directCandidateChunks", 5);
    sink?.recordValue("core.diffusion.directRegionCandidateChunks", 4);
    sink?.recordValue("core.diffusion.directPromotionBudget", 2);
    sink?.recordValue("core.diffusion.directPromotedChunks", 2);
    sink?.recordValue("core.diffusion.directSuppressedChunks", 3);
    sink?.recordValue("core.diffusion.directWriteImpulse", 0.75);
    sink?.recordValue("core.diffusion.effectiveChunks", 2);
    sink?.recordValue("core.diffusion.frontierChunks", 2);
    sink?.recordValue("core.diffusion.staleFrontierChunks", 1);
    sink?.recordValue("core.diffusion.agedOutFrontierChunks", 1);
    sink?.recordValue("core.diffusion.nearZeroCandidateChunks", 4);
    sink?.recordValue("core.diffusion.nearZeroSkippedChunks", 0);
    sink?.recordValue("core.diffusion.retainedFrontierChunks", 3);
    sink?.recordValue("core.diffusion.skippedBackgroundChunks", 6);
    sink?.recordValue("core.scheduler.activeEnvironmentChunks", 5);
    sink?.recordValue("core.scheduler.directPressureRegionCandidateChunks", 4);
    sink?.recordValue("core.scheduler.directPressurePromotionBudget", 2);
    sink?.recordValue("core.scheduler.directPressurePromotedChunks", 2);
    sink?.recordValue("core.scheduler.effectiveWarmChunkInterval", 8);
    sink?.recordValue("core.scheduler.effectiveSleepingChunkInterval", 32);
    sink?.recordValue("core.scheduler.estimatedCatchUpUpdatedCells", 4096);
    sink?.recordValue("core.scheduler.effectivePressureDiffusionSourceBudget", 32);
    sink?.recordValue("core.scheduler.effectivePressureDiffusionChunkBudget", 64);
    sink?.recordValue("core.scheduler.pressureDiffusionBudgetStaggered", 1);
    sink?.recordValue("core.tail.catchUpAndDiffusionCells", 4096);
    profiler.recordValue("runtime.backlogTicks", 1.5);
    profiler.recordValue("runtime.mode", 2);

    const report = profiler.report(createScenario(), 500);
    expect(report.durations["core.tick.updateWorld"]?.p95).toBe(7);
    expect(report.durations["core.world.refreshChunkSummaries"]?.p95).toBe(2);
    expect(report.durations["core.world.warmCatchUpUpdate"]?.p95).toBe(3);
    expect(report.values["core.dirty.moistureAfterEnvironment"]?.p95).toBe(42);
    expect(report.values["core.world.warmUpdatedCells"]?.p95).toBe(2048);
    expect(report.values["core.diffusion.seedChunks"]?.p95).toBe(3);
    expect(report.values["core.diffusion.backgroundSourceChunks"]?.p95).toBe(1);
    expect(report.values["core.diffusion.deferredChunks"]?.p95).toBe(1);
    expect(report.values["core.diffusion.directCandidateChunks"]?.p95).toBe(5);
    expect(report.values["core.diffusion.directRegionCandidateChunks"]?.p95).toBe(4);
    expect(report.values["core.diffusion.directPromotionBudget"]?.p95).toBe(2);
    expect(report.values["core.diffusion.directPromotedChunks"]?.p95).toBe(2);
    expect(report.values["core.diffusion.directSuppressedChunks"]?.p95).toBe(3);
    expect(report.values["core.diffusion.directWriteImpulse"]?.p95).toBe(0.75);
    expect(report.values["core.diffusion.effectiveChunks"]?.p95).toBe(2);
    expect(report.values["core.diffusion.frontierChunks"]?.p95).toBe(2);
    expect(report.values["core.diffusion.staleFrontierChunks"]?.p95).toBe(1);
    expect(report.values["core.diffusion.agedOutFrontierChunks"]?.p95).toBe(1);
    expect(report.values["core.diffusion.nearZeroCandidateChunks"]?.p95).toBe(4);
    expect(report.values["core.diffusion.nearZeroSkippedChunks"]?.p95).toBe(0);
    expect(report.values["core.diffusion.retainedFrontierChunks"]?.p95).toBe(3);
    expect(report.values["core.diffusion.skippedBackgroundChunks"]?.p95).toBe(6);
    expect(report.values["core.scheduler.activeEnvironmentChunks"]?.p95).toBe(5);
    expect(report.values["core.scheduler.directPressureRegionCandidateChunks"]?.p95).toBe(4);
    expect(report.values["core.scheduler.directPressurePromotionBudget"]?.p95).toBe(2);
    expect(report.values["core.scheduler.directPressurePromotedChunks"]?.p95).toBe(2);
    expect(report.values["core.scheduler.effectiveWarmChunkInterval"]?.p95).toBe(8);
    expect(report.values["core.scheduler.effectiveSleepingChunkInterval"]?.p95).toBe(32);
    expect(report.values["core.scheduler.estimatedCatchUpUpdatedCells"]?.p95).toBe(4096);
    expect(report.values["core.scheduler.effectivePressureDiffusionSourceBudget"]?.p95).toBe(32);
    expect(report.values["core.scheduler.effectivePressureDiffusionChunkBudget"]?.p95).toBe(64);
    expect(report.values["core.scheduler.pressureDiffusionBudgetStaggered"]?.p95).toBe(1);
    expect(report.values["core.tail.catchUpAndDiffusionCells"]?.p95).toBe(4096);
    expect(report.values["runtime.backlogTicks"]?.p95).toBe(1.5);
    expect(report.values["runtime.mode"]?.p95).toBe(2);
  });
});

function createScenario() {
  return {
    baseLayer: "terrain",
    overlays: {
      resources: false,
      agents: false,
      processes: false,
      pressure: false,
      lineages: false
    },
    tickRate: 16,
    world: {
      width: 960,
      height: 640,
      tick: 0,
      agents: 120,
      chunks: 600
    },
    canvas: {
      width: 960,
      height: 640,
      clientWidth: 960,
      clientHeight: 640,
      devicePixelRatio: 1
    }
  };
}
