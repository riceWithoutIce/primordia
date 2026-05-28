import { describe, expect, it } from "vitest";
import { DEFAULT_OVERLAYS } from "../src/app/render/mapViewTypes";
import { selectProjectionChunks } from "../src/app/render/projection";
import {
  overlayAffectsProjection,
  projectionDependencyMask,
  projectionOverlayKey
} from "../src/app/render/renderDependencies";
import { CHUNK_DIRTY, clearChunkProjectionDirty, markChunkProjectionDirty, Simulation } from "../src/core/primordia";
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

  it("reprojects pressure dirty chunks when pressure overlay is visible", () => {
    const sim = createCleanProjectionSimulation();
    const target = sim.world.chunks.chunks[3];
    markChunkProjectionDirty(sim.world.chunks, target.id, CHUNK_DIRTY.pressure);
    const dependencyMask = projectionDependencyMask("terrain", { ...DEFAULT_OVERLAYS, pressure: true });

    const selection = selectProjectionChunks(sim.world.chunks.chunks, true, dependencyMask);

    expect(dependencyMask & CHUNK_DIRTY.pressure).toBe(CHUNK_DIRTY.pressure);
    expect(selection.reasonVisibleDependency).toBe(1);
    expect(selection.chunks).toHaveLength(1);
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

  it("still reprojects resource dirty chunks for the default resource overlay", () => {
    const sim = createCleanProjectionSimulation();
    const target = sim.world.chunks.chunks[3];
    markChunkProjectionDirty(sim.world.chunks, target.id, CHUNK_DIRTY.resource);
    const dependencyMask = projectionDependencyMask("terrain", DEFAULT_OVERLAYS);

    const selection = selectProjectionChunks(sim.world.chunks.chunks, true, dependencyMask);

    expect(dependencyMask & CHUNK_DIRTY.resource).toBe(CHUNK_DIRTY.resource);
    expect(selection.reasonVisibleDependency).toBe(1);
    expect(selection.chunks).toHaveLength(1);
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

    expect(projectionOverlayKey(runtimeOverlays)).toBe(projectionOverlayKey(backgroundOnly));
    expect(overlayAffectsProjection("agents")).toBe(false);
    expect(overlayAffectsProjection("processes")).toBe(false);
  });

  it("tracks lineage overlay fertility dependencies", () => {
    const mask = projectionDependencyMask("terrain", {
      resources: false,
      agents: false,
      processes: false,
      pressure: false,
      lineages: true
    });

    expect(mask & CHUNK_DIRTY.moisture).toBe(CHUNK_DIRTY.moisture);
    expect(mask & CHUNK_DIRTY.pressure).toBe(CHUNK_DIRTY.pressure);
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
      chunk.dirtyMask = CHUNK_DIRTY.resource;
    }

    updateEnvironmentFields(sim.world, sim.config, 1, sim.random);

    for (const chunk of sim.world.chunks.chunks) {
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
    target.dirtyMask = CHUNK_DIRTY.resource;

    updateEnvironmentFields(sim.world, sim.config, 1, sim.random);

    expect(target.projectionDirtyMask & CHUNK_DIRTY.moisture).toBe(CHUNK_DIRTY.moisture);
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
    clearChunkProjectionDirty(sim.world.chunks, chunk.id);
  }

  return sim;
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
