import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { lineageColorFor, lineageHue } from "../src/app/lineageColor";
import { BIOME_PALETTE } from "../src/app/render/palettes";
import { TERRAIN_RENDER_CONFIG, terrainColor } from "../src/app/render/mapViews";
import { DEFAULT_BASE_LAYER, DEFAULT_OVERLAYS } from "../src/app/render/mapViewTypes";
import { Simulation } from "../src/core/primordia";

describe("primordia simulation smoke", () => {
  it("runs a deterministic basic simulation", () => {
    const config = {
      width: 32,
      height: 24,
      initialAgents: 12,
      maxAgents: 80,
      seed: 20260523
    };

    const sim = new Simulation(config);
    sim.step(120);
    const metrics = sim.metrics();

    expect(metrics.tick).toBe(120);
    expect(metrics.births).toBeGreaterThanOrEqual(12);
    expect(metrics.agents).toBeGreaterThanOrEqual(1);
    expect(metrics.agents).toBeLessThanOrEqual(80);
    expect(Number.isFinite(metrics.averageEnergy)).toBe(true);

    const replay = new Simulation(config);
    replay.step(120);
    expect(replay.metrics()).toEqual(metrics);
  });

  it("keeps the metrics panel wired to the observable fields", () => {
    const html = readFileSync("index.html", "utf8");
    const metricIds = [
      "m-tick",
      "m-seed",
      "m-agents",
      "m-lineages",
      "m-lineages-total",
      "m-lineages-extinct",
      "m-dominant-lineage",
      "m-dominant-share",
      "m-resource",
      "m-trace",
      "m-pressure",
      "m-events",
      "m-last-event",
      "m-processes",
      "m-last-process",
      "m-species",
      "m-dominant-species",
      "m-organ-attempts",
      "m-organ-accepted",
      "m-organ-refused",
      "m-organ-budget",
      "m-organ-refusal",
      "m-chunks",
      "m-chunk-states",
      "m-updated-chunks",
      "m-regions",
      "m-moisture",
      "m-energy",
      "m-generation",
      "m-births",
      "m-deaths",
      "m-death-starvation",
      "m-death-pressure",
      "m-death-overflow"
    ];

    for (const id of metricIds) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("keeps snapshot controls wired in the page shell", () => {
    const html = readFileSync("index.html", "utf8");
    const snapshotIds = ["snapshot", "copy-snapshot", "download-snapshot", "snapshot-status"];

    for (const id of snapshotIds) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("keeps large-world inspection controls wired in the page shell", () => {
    const html = readFileSync("index.html", "utf8");
    const inspectIds = ["inspect-cell", "inspect-chunk", "inspect-region", "inspect-field"];

    for (const id of inspectIds) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("inspector-panel");
    expect(html.indexOf("inspector-panel")).toBeLessThan(html.indexOf("panel-tools"));
  });

  it("keeps the panel organized into compact observable sections", () => {
    const html = readFileSync("index.html", "utf8");
    const sectionClasses = ["panel-top", "panel-inspector", "panel-tools", "panel-metrics", "metric-list", "metric-row"];

    for (const className of sectionClasses) {
      expect(html).toContain(className);
    }
    expect(html).toContain("<summary>Ecology</summary>");
    expect(html).toContain("<summary>Lineage</summary>");
    expect(html).toContain("<summary>Lifecycle</summary>");
    expect(html).toContain("<summary>Organs</summary>");
  });

  it("keeps base map and overlay controls wired in the page shell", () => {
    const html = readFileSync("index.html", "utf8");
    const controlIds = [
      "base-terrain",
      "base-biome",
      "base-resource",
      "base-pressure",
      "overlay-resources",
      "overlay-agents",
      "overlay-processes",
      "overlay-pressure",
      "overlay-lineages"
    ];

    for (const id of controlIds) {
      expect(html).toContain(`id="${id}"`);
    }

    expect(html).toContain("data-base-layer=\"terrain\"");
    expect(html).toContain("data-overlay=\"resources\" checked");
  });

  it("keeps terrain visualization configurable and covers cold biomes", () => {
    expect(TERRAIN_RENDER_CONFIG.contourInterval).toBeGreaterThan(0);
    expect(DEFAULT_BASE_LAYER).toBe("terrain");
    expect(DEFAULT_OVERLAYS.resources).toBe(false);
    expect(DEFAULT_OVERLAYS.agents).toBe(true);
    expect(DEFAULT_OVERLAYS.processes).toBe(true);
    expect(DEFAULT_OVERLAYS.pressure).toBe(false);
    expect(BIOME_PALETTE.snow).toBeDefined();
    expect(BIOME_PALETTE.tundra).toBeDefined();

    const sim = new Simulation({
      width: 32,
      height: 20,
      initialAgents: 0,
      seed: 20260605
    });
    const color = terrainColor(sim.cellAt(8, 8));

    expect(color).toHaveLength(3);
    for (const channel of color) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });

  it("maps lineage ids to stable visual colors", () => {
    const parent = { lineageId: 7, generation: 0 };
    const descendant = { lineageId: 7, generation: 6 };
    const neighbor = { lineageId: 8, generation: 0 };

    expect(lineageHue(parent.lineageId)).toBe(lineageHue(descendant.lineageId));
    expect(lineageColorFor(parent).hue).toBe(lineageColorFor(descendant).hue);
    expect(lineageColorFor(parent).lightness).toBeGreaterThan(lineageColorFor(descendant).lightness);
    expect(lineageHue(parent.lineageId)).not.toBe(lineageHue(neighbor.lineageId));
  });
});
