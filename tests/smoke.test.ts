import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { lineageColorFor, lineageHue } from "../src/app/lineageColor";
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
