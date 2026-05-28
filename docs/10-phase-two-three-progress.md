# Phase 2.3 Acceptance Review

Date: 2026-05-27

## Scope

This is the acceptance review for `Phase 2.3: Large-world simulation framework`.

Implemented in this pass:

- `docs/09-large-world-architecture.md` documents the target architecture for `960 x 640` cells.
- Default simulation dimensions are now `960 x 640`, partitioned into `32 x 32` chunks.
- `WorldState` now owns `ChunkGrid`, `RegionGraph`, scheduler stats, and cached terrain totals.
- Dynamic field updates are routed through chunk scheduling with active, warm, and sleeping chunk states.
- Sleeping and warm chunks use deterministic phase staggering so quiet chunks do not all catch up on the same tick.
- Lazy resource growth randomness is derived from seed, coordinate, chunk id, tick, and channel rather than mutable global RNG order.
- Pressure diffusion crosses chunk boundaries and updates sleeping neighbor pressure summaries without waking quiet neighbors.
- Chunk summaries and region summaries are available for metrics, snapshot, and future rendering work.
- Dirty chunk summaries and affected region summaries refresh incrementally instead of forcing all chunks to rescan every tick.
- Agent records now include an intention and lower-rate decision tick.
- Movement scoring can use local cell data plus chunk and region summaries without global best-resource planning.
- Snapshot export is schema v3 with scheduler, chunk, and region summaries.
- The app rendering path has a projection cache that updates active/dirty chunks instead of rebuilding every cell from scratch every frame.
- UI metrics expose chunk count, active/warm/sleeping chunk counts, updated chunks/cells, and region count.
- The UI exposes a lightweight hover inspector for cell, chunk, region, and field values.
- A core benchmark entrypoint exists as `npm run bench:core`.

## Current Benchmark

Command:

```powershell
npm run bench:core
```

Environment:

- Windows local Node through Vitest bench
- default `960 x 640`
- chunk size `32`
- seed `20260527`

Observed benchmark:

- `960x640 initialize`: mean about `3158.69ms`
- `960x640 cold step(16)`: mean about `3898.64ms`
- `960x640 hot step(16)`: mean about `1107.12ms`
- `960x640 hot snapshot stride 48`: mean about `3.3803ms`

Interpretation:

- Hot steady-state simulation remains close to the approximate `16 tick/s` target in Node bench. `1107.12ms / 16` is about `69.2ms` per tick in this run, and the browser smoke observation remains above the target.
- Cold start remains a visible fixed cost because terrain and initial summaries are generated for all `614,400` cells up front.
- Snapshot v3 summary export is no longer a bottleneck in the hot benchmark shape.
- The benchmark now separates initialize, cold step, hot step, and hot snapshot so future regressions are easier to diagnose.

## Browser Observation

The production build was served locally at `http://127.0.0.1:4173/primordia/` under the same `/primordia/` base path used by GitHub Pages.

Observed through the in-app browser:

- Page title: `未形 / primordia`
- Canvas attributes: `960 x 640`
- Metrics reported `600` chunks and `40` regions.
- Hover inspection reports current cell coordinates, terrain type, chunk activity, region id, and field values.
- A 3 second browser run advanced from tick `1007` to tick `1065`, about `19.3 tick/s`.
- Browser console error log was empty during the smoke check.

Canvas 2D remains acceptable for this phase with the current projection cache and dirty chunk path. WebGL is not required for Phase 2.3, but remains a future option if later overlays, zoom inspection, or denser visual layers outgrow Canvas 2D.

## Validation

Commands:

```powershell
npm run check
npm run build
npm run bench:core
```

Results:

- `npm run check`: passed, `63` tests.
- `npm run build`: passed.
- `npm run bench:core`: completed and recorded the baseline above.
- Browser smoke: passed against the production build served locally.

Post-review fixes:

- Chunk-limited pressure diffusion now treats the edge outside the selected diffusion set as a closed boundary, avoiding one-way pressure drift at the active/sleeping frontier.
- Lazy field catch-up now marks the updated chunk projection dirty so the Canvas projection cache can repaint sleeping chunks when their fields change.
- Reset-time agent chunk and region summaries are refreshed before immediate metrics or snapshot reads.
- Phase 2.3.18 adds the first browser-safe scheduler architecture pass: the browser frame loop no longer performs unbounded synchronous catch-up, runtime backlog is visible in the Scheduler UI, core ticks report deterministic scheduler lanes, and pressure diffusion now reports seed/neighbor/selected/effective/near-zero candidate chunk counters for the `#71` follow-up.
- Phase 2.3.19 starts pressure-lane tightening: large-world pressure diffusion now combines direct pressure-touch chunks with a bounded deterministic background chunk slice, and summary region refresh counts follow actually changed diffusion regions rather than broad pressure projection dirtiness.
- Phase 2.3.22 starts the agent/field lane split: agent occupancy and agent-only dirty chunks remain visible to agent/projection diagnostics, but they no longer force immediate full environment field scans unless resource, trace, pressure, moisture, or process dirty bits are present.

## Residual Risks

Phase 2.3 is accepted for the current task definition, with these follow-up risks:

- Initialization is still around `3.3s` on the local Node benchmark. Future work can consider terrain chunk generation, cached projections, or loading states.
- Pressure diffusion is chunk-aware and boundary-tested, but it still uses shared whole-world typed arrays as storage. A future implementation can move to true chunk-local field storage and boundary strip buffers.
- Lazy catch-up is deterministic and reproducible, but resource growth catch-up uses deterministic approximation over elapsed sleeping intervals rather than exact per-tick replay for every skipped tick.
- The current renderer has dirty projection, full-world overview, and hover inspection, but no deep zoom LOD UI yet.
- Phase 2.3.19 changes the pressure diffusion source set and bounded background cadence but not browser timing. It still needs terrain and pressure-visible profiles to confirm that diffusion seed/selected chunks, summary refresh regions, and per-tick cost fall without unacceptable ecology drift.
- Phase 2.3.22 changes scheduler lane classification and should be validated with a terrain-only deep profile before accepting the new default cadence.

## Result

Phase 2.3 is accepted. Primordia now runs a default `960 x 640` local world with chunk scheduling, deterministic lazy field updates, chunk-aware pressure diffusion, region summaries, agent intentions, snapshot schema v3, dirty projection caching, benchmark coverage, and browser-observed Canvas 2D behavior within the approximate `16 tick/s` target.
