import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAYS } from "../src/app/render/mapViewTypes";
import { createFieldOverlay, selectOverlayChunks } from "../src/app/render/fieldOverlays";
import {
  createProjection,
  selectProjectionChunks,
  shouldUseTerrainProjectionFastPath,
  type ProjectionProfileStats
} from "../src/app/render/projection";
import { terrainColor } from "../src/app/render/mapViews";
import {
  overlayAffectsProjection,
  overlayDependencyMask,
  projectionDependencyMask,
  projectionOverlayKey
} from "../src/app/render/renderDependencies";
import {
  CHUNK_DIRTY,
  clearChunkProjectionDirty,
  markChunkProjectionDirty,
  Simulation,
  touchChunk
} from "../src/core/primordia";
import { environmentEventDirtyMask, environmentProcessDirtyMask } from "../src/core/world/update";
import { updateEnvironmentFields } from "../src/core/world/update";
import type { EnvironmentEventRecord, EnvironmentProcessRecord } from "../src/core/primordia";

describe("visibility-aware projection invalidation", () => {
  it("does not reproject pressure-only dirty chunks when pressure is invisible", () => {
    const sim = createCleanProjectionSimulation();
    const target = sim.world.chunks.chunks[3];
    markChunkProjectionDirty(sim.world.chunks, target.id, CHUNK_DIRTY.pressure);
    const dependencyMask = projectionDependencyMask("terrain", { ...DEFAULT_OVERLAYS, pressure: false });

    const selection = selectProjectionChunks(sim.world.chunks.chunks, true, dependencyMask);

    expect(dependencyMask & CHUNK_DIRTY.pressure).toBe(0);
    expect(selection.reasonProjectionDirty).toBe(1);
    expect(selection.reasonVisibleDependency).toBe(0);
    expect(selection.chunks).toHaveLength(0);
  });

  it("keeps pressure overlay debt out of the base projection", () => {
    const sim = createCleanProjectionSimulation();
    const target = sim.world.chunks.chunks[3];
    markChunkProjectionDirty(sim.world.chunks, target.id, CHUNK_DIRTY.pressure);
    const dependencyMask = projectionDependencyMask("terrain", { ...DEFAULT_OVERLAYS, pressure: true });

    const selection = selectProjectionChunks(sim.world.chunks.chunks, true, dependencyMask);

    expect(dependencyMask & CHUNK_DIRTY.pressure).toBe(0);
    expect(selection.reasonVisibleDependency).toBe(0);
    expect(selection.chunks).toHaveLength(0);
  });

  it("reprojects pressure dirty chunks when pressure is the base layer", () => {
    const sim = createCleanProjectionSimulation();
    const target = sim.world.chunks.chunks[3];
    markChunkProjectionDirty(sim.world.chunks, target.id, CHUNK_DIRTY.pressure);
    const dependencyMask = projectionDependencyMask("pressure", { ...DEFAULT_OVERLAYS, pressure: false });

    const selection = selectProjectionChunks(sim.world.chunks.chunks, true, dependencyMask);

    expect(dependencyMask & CHUNK_DIRTY.pressure).toBe(CHUNK_DIRTY.pressure);
    expect(selection.reasonVisibleDependency).toBe(1);
    expect(selection.chunks).toHaveLength(1);
  });

  it("keeps resource overlay debt out of the base projection", () => {
    const sim = createCleanProjectionSimulation();
    const target = sim.world.chunks.chunks[3];
    markChunkProjectionDirty(sim.world.chunks, target.id, CHUNK_DIRTY.resource);
    const dependencyMask = projectionDependencyMask("terrain", { ...DEFAULT_OVERLAYS, resources: true });

    const selection = selectProjectionChunks(sim.world.chunks.chunks, true, dependencyMask);

    expect(dependencyMask & CHUNK_DIRTY.resource).toBe(0);
    expect(selection.reasonVisibleDependency).toBe(0);
    expect(selection.chunks).toHaveLength(0);
  });

  it("describes dependency masks without runtime canvas overlays", () => {
    const mask = projectionDependencyMask("terrain", {
      resources: false,
      agents: true,
      processes: true,
      pressure: false,
      lineages: false
    });

    expect(mask).toBe(CHUNK_DIRTY.moisture);
  });

  it("does not include runtime canvas overlays in the projection overlay key", () => {
    const backgroundOnly = {
      resources: true,
      pressure: false,
      lineages: false,
      agents: false,
      processes: false
    };
    const runtimeOverlays = {
      ...backgroundOnly,
      agents: true,
      processes: true
    };

    expect(projectionOverlayKey(runtimeOverlays)).toBe("base");
    expect(projectionOverlayKey(backgroundOnly)).toBe("base");
    expect(overlayAffectsProjection("resources")).toBe(false);
    expect(overlayAffectsProjection("pressure")).toBe(false);
    expect(overlayAffectsProjection("lineages")).toBe(false);
    expect(overlayAffectsProjection("agents")).toBe(false);
    expect(overlayAffectsProjection("processes")).toBe(false);
  });

  it("tracks field overlay dependencies separately from base projection", () => {
    const projectionMask = projectionDependencyMask("terrain", {
      resources: true,
      agents: false,
      processes: false,
      pressure: true,
      lineages: true
    });
    const overlayMask = overlayDependencyMask("terrain", {
      resources: false,
      agents: false,
      processes: false,
      pressure: false,
      lineages: true
    });

    expect(projectionMask).toBe(CHUNK_DIRTY.moisture);
    expect(overlayMask & CHUNK_DIRTY.moisture).toBe(CHUNK_DIRTY.moisture);
    expect(overlayMask & CHUNK_DIRTY.pressure).toBe(CHUNK_DIRTY.pressure);
  });

  it("uses the terrain fast path for terrain base regardless of field overlays", () => {
    expect(shouldUseTerrainProjectionFastPath("terrain", { ...DEFAULT_OVERLAYS, resources: false, pressure: false })).toBe(true);
    expect(shouldUseTerrainProjectionFastPath("terrain", { ...DEFAULT_OVERLAYS, resources: true, pressure: false })).toBe(true);
    expect(shouldUseTerrainProjectionFastPath("terrain", { ...DEFAULT_OVERLAYS, resources: false, pressure: true })).toBe(true);
    expect(shouldUseTerrainProjectionFastPath("terrain", { ...DEFAULT_OVERLAYS, lineages: true })).toBe(true);
    expect(shouldUseTerrainProjectionFastPath("resource", { ...DEFAULT_OVERLAYS, resources: false, pressure: false })).toBe(false);
  });

  it("selects field overlay chunks without forcing base projection work", () => {
    const sim = createCleanProjectionSimulation();
    const target = sim.world.chunks.chunks[3];
    markChunkProjectionDirty(sim.world.chunks, target.id, CHUNK_DIRTY.pressure);
    const overlayMask = overlayDependencyMask("terrain", { ...DEFAULT_OVERLAYS, pressure: true });
    const projectionMask = projectionDependencyMask("terrain", { ...DEFAULT_OVERLAYS, pressure: true });

    expect(selectOverlayChunks(sim.world.chunks.chunks, true, overlayMask)).toEqual([target]);
    expect(selectProjectionChunks(sim.world.chunks.chunks, true, projectionMask).chunks).toHaveLength(0);
  });

  it("paints field overlays into a separate transparent image and consumes overlay-only debt", () => {
    const sim = createCleanProjectionSimulation();
    const target = sim.world.chunks.chunks[3];
    const index = (target.startY + 2) * sim.width + target.startX + 2;
    sim.pressure[index] = 4;
    markChunkProjectionDirty(sim.world.chunks, target.id, CHUNK_DIRTY.pressure);
    const imageFactory = (width: number, height: number) =>
      ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4)
      }) as ImageData;

    const overlay = createFieldOverlay(sim, "terrain", { ...DEFAULT_OVERLAYS, pressure: true }, null, {
      imageFactory,
      now: () => 0,
      recordFieldOverlay: () => undefined
    });

    expect(overlay).not.toBeNull();
    const overlayIndex = Math.floor((target.startY + 2) / 4) * overlay!.width + Math.floor((target.startX + 2) / 4);
    expect(overlay?.image.data[overlayIndex * 4 + 3]).toBeGreaterThan(0);
    expect(target.projectionDirtyMask & CHUNK_DIRTY.pressure).toBe(0);
  });

  it("matches generic terrain cell color when using the terrain projection fast path", () => {
    const sim = createCleanProjectionSimulation();
    const imageFactory = (width: number, height: number) =>
      ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4)
      }) as ImageData;

    const projection = createProjection(sim, "terrain", { ...DEFAULT_OVERLAYS, resources: false, pressure: false }, null, {
      imageFactory,
      now: () => 0,
      recordProjection: () => undefined
    });
    const index = sim.index(8, 8);
    const offset = index * 4;
    const expected = terrainColor(sim.environmentAt(index));

    expect(Array.from(projection.image.data.slice(offset, offset + 4))).toEqual([...expected, 255]);
  });

  it("marks environment events with field-specific projection masks", () => {
    const bloom = createEvent("bloom");
    const pressure = createEvent("pressure");

    expect(environmentEventDirtyMask(bloom)).toBe(CHUNK_DIRTY.resource | CHUNK_DIRTY.trace);
    expect(environmentEventDirtyMask(pressure)).toBe(CHUNK_DIRTY.pressure | CHUNK_DIRTY.trace);
  });

  it("marks moisture-front processes with the fields they mutate", () => {
    expect(environmentProcessDirtyMask(createMoistureFront())).toBe(
      CHUNK_DIRTY.process | CHUNK_DIRTY.resource | CHUNK_DIRTY.trace | CHUNK_DIRTY.pressure | CHUNK_DIRTY.moisture
    );
  });

  it("does not mark terrain moisture dirty when environment decay has no visual moisture change", () => {
    const sim = createCleanProjectionSimulation();
    for (const chunk of sim.world.chunks.chunks) {
      touchChunk(sim.world.chunks, chunk.id, 1, CHUNK_DIRTY.resource);
    }

    updateEnvironmentFields(sim.world, sim.config, 1, sim.random);

    for (const chunk of sim.world.chunks.chunks) {
      expect(chunk.fieldDirtyMask).toBe(0);
      expect(chunk.projectionDirtyMask & CHUNK_DIRTY.moisture).toBe(0);
      expect(chunk.projectionDirtyMask & CHUNK_DIRTY.resource).toBe(CHUNK_DIRTY.resource);
      expect(chunk.projectionDirtyMask & CHUNK_DIRTY.pressure).toBe(CHUNK_DIRTY.pressure);
    }
  });

  it("marks terrain moisture dirty when environment decay changes the projected terrain tint", () => {
    const sim = createCleanProjectionSimulation();
    const target = sim.world.chunks.chunks[0];
    const idx = target.startY * sim.width + target.startX;
    sim.world.terrain.moistureBase[idx] = 0.2;
    sim.world.fields.moistureDelta[idx] = 1;
    touchChunk(sim.world.chunks, target.id, 1, CHUNK_DIRTY.resource);

    updateEnvironmentFields(sim.world, sim.config, 1, sim.random);

    expect(target.projectionDirtyMask & CHUNK_DIRTY.moisture).toBe(CHUNK_DIRTY.moisture);
  });

  it("consumes visible projection debt and retires hidden render debt without clearing core dirty domains", () => {
    const sim = createCleanProjectionSimulation();
    const visible = sim.world.chunks.chunks[0];
    const hidden = sim.world.chunks.chunks[1];
    const fieldWrite = sim.world.chunks.chunks[2];
    markChunkProjectionDirty(sim.world.chunks, visible.id, CHUNK_DIRTY.moisture);
    markChunkProjectionDirty(sim.world.chunks, hidden.id, CHUNK_DIRTY.resource | CHUNK_DIRTY.pressure);
    fieldWrite.fieldWriteMask = CHUNK_DIRTY.pressure;
    fieldWrite.summaryDirty = true;
    fieldWrite.pressureDiffusionActive = true;
    markChunkProjectionDirty(sim.world.chunks, fieldWrite.id, CHUNK_DIRTY.pressure);
    const imageFactory = (width: number, height: number) =>
      ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4)
      }) as ImageData;
    let latestStats: ProjectionProfileStats | null = null;

    createProjection(sim, "terrain", { ...DEFAULT_OVERLAYS, resources: false, pressure: false }, null, {
      imageFactory,
      now: () => 0,
      recordProjection: (stats) => {
        latestStats = stats;
      }
    });

    const stats = expectProjectionStats(latestStats);
    expect(stats.projectedChunks).toBe(6);
    expect(stats.dirtyMaskChunks).toBe(1);
    expect(stats.hiddenDirtyChunks).toBe(2);
    expect(stats.consumedDirtyChunks).toBe(1);
    expect(stats.retiredDirtyChunks).toBe(2);
    expect(stats.retainedDirtyChunks).toBe(0);
    expect(hidden.projectionDirtyMask & (CHUNK_DIRTY.resource | CHUNK_DIRTY.pressure)).toBe(0);
    expect(fieldWrite.projectionDirtyMask & CHUNK_DIRTY.pressure).toBe(0);
    expect(fieldWrite.fieldWriteMask).toBe(CHUNK_DIRTY.pressure);
    expect(fieldWrite.summaryDirty).toBe(true);
    expect(fieldWrite.pressureDiffusionActive).toBe(true);
  });
});

function createCleanProjectionSimulation(): Simulation {
  const sim = new Simulation({
    width: 96,
    height: 64,
    chunkSize: 32,
    initialAgents: 0,
    pressureDiffusion: 0,
    seed: 20260627
  });

  for (const chunk of sim.world.chunks.chunks) {
    chunk.activity = "sleeping";
    chunk.agentCount = 0;
    chunk.dirtyMask = 0;
    chunk.fieldDirtyMask = 0;
    clearChunkProjectionDirty(sim.world.chunks, chunk.id);
  }

  return sim;
}

function expectProjectionStats(stats: ProjectionProfileStats | null): ProjectionProfileStats {
  expect(stats).not.toBeNull();
  return stats as ProjectionProfileStats;
}

function createEvent(kind: EnvironmentEventRecord["kind"]): EnvironmentEventRecord {
  return {
    tick: 10,
    kind,
    x: 12,
    y: 18,
    radius: 4,
    intensity: 1,
    affectedCells: 0
  };
}

function createMoistureFront(): EnvironmentProcessRecord {
  return {
    id: 1,
    kind: "moisture-front",
    startTick: 10,
    age: 1,
    duration: 20,
    radius: 6,
    intensity: 1,
    x: 12,
    y: 18,
    dx: 1,
    dy: 0,
    affectedCells: 0,
    active: true
  };
}
