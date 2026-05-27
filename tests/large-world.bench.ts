import { bench, describe } from "vitest";
import { Simulation } from "../src/core/primordia";

describe("large-world core benchmark", () => {
  let hotSim: Simulation;

  bench(
    "960x640 initialize",
    () => {
      new Simulation({
        seed: 20260527
      });
    },
    {
      iterations: 5,
      warmupIterations: 1
    }
  );

  bench(
    "960x640 cold step(16)",
    () => {
      const sim = new Simulation({
        seed: 20260527
      });
      sim.step(16);
    },
    {
      iterations: 5,
      warmupIterations: 1
    }
  );

  bench(
    "960x640 hot step(16)",
    () => {
      hotSim.step(16);
    },
    {
      iterations: 5,
      warmupIterations: 1,
      setup() {
        hotSim = new Simulation({
          seed: 20260527
        });
        hotSim.step(64);
      }
    }
  );

  bench(
    "960x640 hot snapshot stride 48",
    () => {
      hotSim.snapshot({
        environmentSampleStride: 48
      });
    },
    {
      iterations: 5,
      warmupIterations: 1,
      setup() {
        hotSim = new Simulation({
          seed: 20260527
        });
        hotSim.step(64);
      }
    }
  );
});
