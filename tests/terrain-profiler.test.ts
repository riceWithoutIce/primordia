import { describe, expect, it } from "vitest";
import { createTerrainProfilerFromSearch, TerrainProfiler } from "../src/app/terrainProfiler";

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
      dirtyMaskChunks: 2,
      fullRebuild: false,
      moistureDirtyChunks: 1,
      projectedCells: 1024,
      projectedChunks: 1,
      pressureDirtyChunks: 2,
      resourceDirtyChunks: 1,
      selectChunksMs: 0.2,
      paintCellsMs: 1.5,
      totalChunks: 600,
      visibleDependencyMask: 8
    });
    profiler.recordFrame(16, 1);
    profiler.recordPointerMove();

    const sample = profiler.maybeSample(300, scenario);
    expect(sample?.counters.frames).toBe(1);
    expect(sample?.counters.pointerMoves).toBe(1);
    expect(sample?.durations["sim.step"]?.p95).toBe(3);
    expect(sample?.durations["projection.paintCells"]?.p95).toBe(1.5);
    expect(sample?.values["projection.projectedChunks"]?.p95).toBe(1);
    expect(sample?.values["projection.moistureDirtyChunks"]?.p95).toBe(1);

    const report = profiler.report(scenario, 1200);
    expect(report.kind).toBe("primordia.terrain-profile");
    expect(report.complete).toBe(true);
    expect(report.counters.frames).toBe(1);
    expect(report.latestProjection?.totalChunks).toBe(600);
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
    sink?.recordValue("core.dirty.moistureAfterEnvironment", 42);

    const report = profiler.report(createScenario(), 500);
    expect(report.durations["core.tick.updateWorld"]?.p95).toBe(7);
    expect(report.values["core.dirty.moistureAfterEnvironment"]?.p95).toBe(42);
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
