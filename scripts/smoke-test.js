const Primordia = require("../src/primordia.js");

const sim = new Primordia.Simulation({
  width: 32,
  height: 24,
  initialAgents: 12,
  maxAgents: 80,
  seed: 20260523
});

sim.step(120);
const metrics = sim.metrics();

if (metrics.tick !== 120) {
  throw new Error(`Expected tick 120, got ${metrics.tick}`);
}

if (metrics.births < 12) {
  throw new Error(`Expected initial births to be counted, got ${metrics.births}`);
}

if (metrics.agents < 1 || metrics.agents > 80) {
  throw new Error(`Agent count out of bounds: ${metrics.agents}`);
}

if (!Number.isFinite(metrics.averageEnergy)) {
  throw new Error("Average energy is not finite");
}

console.log("primordia smoke test passed", metrics);
