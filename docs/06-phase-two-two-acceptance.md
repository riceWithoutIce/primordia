# Phase 2.2 Acceptance Review

Date: 2026-05-26

## Scope

Phase 2.2 asks whether the Phase 2 ecology can become a more world-like local sandbox before Phase 3 introduces behavior organs and tool boundaries.

Implemented scope:

- core refactor from a single simulation file into config, random, world, life, and sim modules
- first-class `WorldState` with static terrain and dynamic fields
- default world size raised to `256 x 160`
- deterministic terrain layers with elevation, moisture, temperature, fertility, movement cost, barrier, and biome type
- biome/resource coupling for ocean, coast, plain, hill, mountain, wetland, and desert
- stateful moisture-front environmental processes with lifecycle and terrain coupling
- behavior genome traits for inertia, risk tolerance, pressure aversion, terrain affinity, and exploration bias
- local movement improvements for inertia and stuck recovery without global pathfinding
- species/clade identifiers and species fate metrics
- snapshot schema v2 with world, process, terrain, and species summaries
- UI view modes for resource, terrain, biome, pressure, and lineage/species observation

Scope notes:

- `resource` remains an internal abstract metabolic resource, not a real-world resource.
- The terrain generator is a lightweight deterministic pipeline, not a full physical geology simulator.
- The species identifier is an observable clade label, not a strict biological species model.
- Environmental processes remain internal simulation processes and do not read external weather or network data.

## Safety Review

Accepted for local simulation scope.

- No real LLM API was added.
- No agent-side filesystem, shell, credential, token, or network access was added.
- No external input channel was added.
- All world, process, and species changes are deterministic local data transformations.

## Validation

Commands:

```powershell
npm run check
npm run build
```

Large-world performance baseline for issue #43:

- Environment: Windows local Node `v24.14.1`, default `256 x 160`, seed `20260526`, `96` initial agents, `720` max agents.
- Before #43 optimization, the core long-run benchmark measured `step(1000)` after warmup at about `21192ms` once the run reached around `201` agents.
- #43 replaced per-cell terrain noise recomputation during resource recovery with cached terrain fertility and reused the pressure diffusion buffer instead of allocating a new `Float32Array` every diffusion pass.
- After #43 optimization, the same benchmark measured `step(1000)` after warmup at about `2117ms`, with matching tick, agent, and process counts.
- Snapshot and render-loop timings remain secondary risks for very dense export or future high-frequency overlays, but the default simulation tick path is now comfortably below the earlier large-world risk level.

Manual validation still recommended:

- base map and overlay controls switch visibly
- default `256 x 160` run remains responsive in the browser
- moisture-front process rings and process metrics are observable after enough ticks
- snapshot JSON exports with `schemaVersion: 2`

Phase 2.2.14 acceptance check:

- Project issues `#31` through `#43`, plus `#45` and `#46`, are implemented and marked Done in Project 5.
- Remaining manual validation is observational rather than blocking for the current local simulation scope.
- Phase 3 should begin with a fresh safety design pass before adding any simulated tool or organ system.

## Follow-Up Review Notes

- Phase 2.2.16 introduced the first base-layer plus overlay-layer map controls. The current default view is `terrain` with agent and process overlays enabled; resource, pressure, and lineage overlays are optional. Future review should focus on whether new layers such as species, rivers, wind, migration, and death heatmaps belong as optional overlays, not as additional top-level mode buttons.

## Result

Phase 2.2 is accepted for the current task definition. The project now has a larger world model, explicit terrain/biome foundations, continuous environment processes, behavior differentiation, species/clade observability, base-layer plus overlay map controls, and a core architecture better suited for Phase 3.
