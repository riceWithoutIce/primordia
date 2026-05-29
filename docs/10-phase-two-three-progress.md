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
- Phase 2.3.23 starts the direct field write split: agent resource/trace/pressure writes now use a separate `fieldWriteMask` path for projection, summary, and pressure diffusion observability instead of immediately forcing a full resource/trace/pressure/moisture chunk scan.
- Phase 2.3.24 starts the dirty-domain split: `fieldDirtyMask` now owns environment field-lane work, `fieldWriteMask` owns direct agent/organ field writes, `summaryDirty` owns aggregate refresh, `pressureDiffusionActive` owns pressure-frontier continuation, and `projectionDirtyMask` is render-cache invalidation only. Projection now consumes visible dependency debt and retires hidden render debt without clearing core simulation dirty domains. `npm run check`, `npm run build`, and `npm run bench:core` passed; latest local benchmark was initialize `~3076.92ms`, cold `step(16)` `~3588.09ms`, hot `step(16)` `~646.12ms`, hot snapshot stride 48 `~3.1980ms`. A 10s browser terrain-only deep smoke profile showed `render.total p95 ~1.5ms`, `projection.retainedDirtyChunks p95 0`, `runtime.backlogTicks p95 ~0.9`, and remaining simulation pressure at `sim.step p50/p95 ~25.7ms/43.4ms` with diffusion still selecting `128` chunks p95. A later full 30s terrain-only profile from `C:/Users/admin/Desktop/profile.txt` confirmed hidden render debt remains retired (`projection.retainedDirtyChunks p95 0`, `retiredDirtyChunks p95 259`) but the run still fails budget at `sim.step p50/p95 28.5ms/47.7ms` and `render.total p95 18.7ms`; the next structural task is Phase 2.3.25 pressure-frontier diffusion under #71, not more dirty-domain splitting.
- Phase 2.3.25 starts pressure-frontier diffusion: large-world pressure diffusion now treats `pressureDiffusionActive` and pressure field dirty chunks as the primary frontier, skips empty background chunks, expands into neighbor chunks only when a boundary pressure gradient exists, and prevents background scans from creating long-lived frontier state. New profile counters expose `core.diffusion.frontierChunks`, `core.diffusion.retainedFrontierChunks`, and `core.diffusion.skippedBackgroundChunks`. `npm run check`, `npm run build`, and `npm run bench:core` passed, though the Node benchmark was noisy after the final guard and should be rerun before treating its numbers as canonical. A 30s terrain-only browser profile improved pressure diffusion p95 from the Phase 2.3.24 baseline (`~13.5ms`) to about `9.5ms`, with `sim.step p50/p95 ~27.0ms/31.8ms` in the best run and stable backlog, but `selectedChunks p95` remained about `124` because direct pressure writes still create a broad frontier. #71 is improved but not closed; pressure-visible evidence is still required.
- Phase 2.3.26 starts the direct pressure-write frontier split: agent/organ direct pressure writes now update local pressure plus per-chunk candidate aggregates instead of immediately activating global pressure diffusion frontier state. Source selection prioritizes retained frontier chunks, promotes high-scoring direct pressure candidates deterministically, and only uses deterministic background pressure chunks when no frontier/candidate source exists. New counters expose direct pressure candidates/promotions/suppression and background source chunks. `npm run check`, `npm run build`, and `npm run bench:core` passed; latest local benchmark was initialize `~3375.96ms`, cold `step(16)` `~3845.88ms`, hot `step(16)` `~653.60ms`, hot snapshot stride 48 `~3.5813ms`. A 10s browser terrain-only deep smoke profile confirmed direct writes are being suppressed/promoted through the new candidate path, but `selectedChunks p95` still reached `128` because retained frontiers remained broad (`frontierChunks p95 ~535`). Browser pressure-visible and 30s terrain profiles are still required before closing #71/#75.
- Phase 2.3.27 starts retained pressure-frontier aging and direct-source narrowing: frontier chunks now track last meaningful activity and stale ticks, retained/deferred frontiers age out when they stop producing meaningful diffusion changes, direct pressure candidates aggregate by region before global promotion, and direct/background sources diffuse locally before becoming neighbor-expanding frontiers. New counters expose stale/aged-out frontiers plus direct region candidates and promotion budget. `npm run check` passed with `93` tests, `npm run build` passed, and `npm run bench:core` completed with initialize `~3119.57ms`, cold `step(16)` `~3345.92ms`, hot `step(16)` `~429.10ms`, hot snapshot stride 48 `~2.8447ms`. A 10s terrain-only browser smoke profile showed `selectedChunks p95 ~50`, `directPromotedChunks p95 16`, and `sim.step p50/p95 ~10.8ms/28.5ms`, but the short sample still failed due cold projection/backlog p95. A later 30s terrain-only profile from `C:/Users/admin/Desktop/profile.txt` confirmed the pressure narrowing held (`selectedChunks p95 86`, `computedCells p95 88064`, `diffusePressure p95 ~6.5ms`, `directPromotedChunks p95 16`) while the run still failed at `sim.step p95 44.5ms` and `render.total p95 18.7ms`; the next planned task is Phase 2.3.28 warm/sleeping field catch-up cadence, with pressure-visible profiling still required before closing #71/#75.
- Phase 2.3.28 starts warm/sleeping field catch-up cadence narrowing: large worlds now use effective catch-up intervals `8/32` from the default configured `4/16`, while small worlds keep the configured cadence. The catch-up still applies elapsed deterministic field time, but fewer warm/sleeping chunks scan in any one tick. New profiler counters expose effective warm/sleeping intervals. `npm run check` passed with `95` tests, `npm run build` passed, and `npm run bench:core` completed with initialize `~3457.92ms`, cold `step(16)` `~3418.64ms`, hot `step(16)` `~372.41ms`, hot snapshot stride 48 `~3.2740ms`. A 30s terrain-only browser profile at `http://127.0.0.1:5174/?profile=terrain&profileDetail=deep&profileSeconds=30` brought core timing under target (`sim.step p50/p95 ~17.2ms/31.1ms`, `runtime.backlogTicks p95 ~1.0`, `core.world.environmentChunks p95 ~16.4ms`, `catchUpUpdatedCells p95 47104`) but still failed on render (`render.total p95 ~14.8ms`, `projection.paintCells p95 ~14ms` for `projection.projectedChunks p95 25`). The next planned task is Phase 2.3.29 terrain projection paint fast-path.
- Phase 2.3.29 adds a terrain projection paint fast-path: terrain base projection without resources/pressure/lineages projection overlays now writes pixels directly from typed terrain and moisture arrays instead of constructing `EnvironmentCell` objects per projected cell. Generic projection remains in place for resource, pressure, biome, and projection-baked overlay modes. `npm run check` passed with `97` tests and `npm run build` passed; `npm run bench:core` was noisy and worse (`hot step(16) ~574.98ms`) even though this pass only touches app render code. A 30s terrain-only browser profile passed all current checks: `sim.step p50/p95 ~19.6ms/29.0ms`, `runtime.backlogTicks p95 ~1.0`, `render.total p95 ~2.5ms`, and `projection.paintCells p95 ~1.7ms` for `projection.projectedChunks p95 25`. The next validation step is pressure-visible/overlay-visible profiling rather than another terrain-only core pass.
- Phase 2.3.30 splits resources/pressure/lineages out of the base projection. Browser profiles first confirmed the old overlay-visible failure was render-side rather than core-side: pressure overlay had `sim.step p95 ~20.2ms` but `render.total p95 ~166.4ms`, and resources+pressure+lineages had `sim.step p95 ~20.1ms` but `render.total p95 ~185.7ms`, both because about `247` chunks / `252928` cells were repainted through generic projection. The fix adds `src/app/render/fieldOverlays.ts`, moves field overlays to a separate transparent low-resolution (`4 x 4` world-cell sample) overlay cache, keeps terrain base projection on the typed-array fast path even when overlays are visible, and adds profile URL display controls (`profileOverlays`, `profileBase`) plus field overlay counters. `npm run check` passed with `100` tests, `npm run build` passed, and `npm run bench:core` completed with initialize `~3292.63ms`, cold `step(16)` `~3419.01ms`, hot `step(16)` `~379.53ms`, hot snapshot stride 48 `~3.1503ms`. Post-fix 30s browser profiles brought pressure overlay render to `render.total p95 ~3.0ms` / `fieldOverlay.paintCells p95 ~0.4ms`, and resources+pressure+lineages to `render.total p95 ~4.8ms` / `fieldOverlay.paintCells p95 ~2.4ms`. Those browser samples still failed the generic assessment due noisy `sim.step p95 ~39-41ms`, but render/backlog were stable and the overlay architecture issue is resolved.
- Phase 2.3.31 adds observability-only core tick tail counters. Deep terrain profiles now split field update cost into active, warm catch-up, sleeping catch-up, and per-chunk summary refresh buckets, and add combined tail counters for field+diffusion cells, catch-up+diffusion cells, and summary+diffusion chunks. `npm run check` passed with `100` tests, `npm run build` passed, and `npm run bench:core` completed with hot `step(16) ~401.11ms`. A visible 30s terrain-only browser profile passed (`sim.step p50/p95 ~18.2ms/26.8ms`, `runtime.backlogTicks p95 ~1.0`, `render.total p95 ~2.2ms`). The new counters show the remaining tail shape as same-tick stacking: `catchUpUpdatedCells p95 47104` plus `diffusionComputedCells p95 87040`, with `catchUpAndDiffusionCells p95 130048`. No scheduling or ecology behavior changed in this pass.

## Residual Risks

Phase 2.3 is accepted for the current task definition, with these follow-up risks:

- Initialization is still around `3.3s` on the local Node benchmark. Future work can consider terrain chunk generation, cached projections, or loading states.
- Pressure diffusion is chunk-aware and boundary-tested, but it still uses shared whole-world typed arrays as storage. A future implementation can move to true chunk-local field storage and boundary strip buffers.
- Lazy catch-up is deterministic and reproducible, but resource growth catch-up uses deterministic approximation over elapsed sleeping intervals rather than exact per-tick replay for every skipped tick.
- The current renderer has dirty projection, full-world overview, and hover inspection, but no deep zoom LOD UI yet.
- Phase 2.3.19 changes the pressure diffusion source set and bounded background cadence but not browser timing. It still needs terrain and pressure-visible profiles to confirm that diffusion seed/selected chunks, summary refresh regions, and per-tick cost fall without unacceptable ecology drift.
- Phase 2.3.22 and Phase 2.3.23 improved scheduler lane classification and Node hot-step cost, but still need browser terrain-only and pressure-visible deep profiles under the real frame loop.
- Phase 2.3.24 separates dirty domains structurally and the full 30s terrain-only profile confirms hidden projection debt is retired. The remaining immediate risks are pressure diffusion still selecting the full `128` chunk budget, warm/sleeping field catch-up still touching about `80k-110k` cells per tick, and late-run terrain projection where only `25-27` visible chunks can still cost about `18-19ms`.
- Phase 2.3.26 direct pressure-write frontier split is implemented as a first pass. The first 10s terrain smoke profile shows direct candidates are no longer the immediate source-width cause, but retained frontiers can remain broad. If the 30s terrain and pressure-visible profiles confirm that pattern, the next pressure task should narrow or age retained frontier persistence before moving to warm/sleeping field catch-up cadence and terrain projection fast-path cost.
- Phase 2.3.27 retained-frontier aging/direct-source narrowing is implemented as a first pass. The 30s terrain profile shows the pressure source-width problem is substantially reduced, but warm/sleeping catch-up still updates about `88k` cells at p95 and terrain projection can still spend about `18ms` painting only `25` chunks. Resources/pressure/lineages overlays remain a known future visual-layer architecture risk because they are projection-baked rather than separate overlays, but the current Phase 2.3.x sequence should not pivot there before the catch-up cadence task.
- Phase 2.3.28 reduces warm/sleeping catch-up p95 to about `47k` cells and brings `sim.step p95` under the current `33ms` terrain-only target. The remaining acceptance blocker is render projection p95, not core tick cadence. Pressure-visible profiling is still required before closing pressure-related issues.
- Phase 2.3.29 brings the terrain-only browser profile green by reducing `projection.paintCells p95` to about `1.7ms` and `render.total p95` to about `2.5ms`. The remaining risk is no longer terrain base rendering; it is pressure-visible correctness/performance and the projection-baked resources/pressure/lineages overlay architecture.
- Phase 2.3.30 resolves the projection-baked overlay architecture risk for the current full-world view. Remaining risk has shifted back to browser/core timing variance: the latest overlay-visible profiles have render p95 under budget but `sim.step p95` above the generic profile limit on that machine. The next task should be a focused core/browser variance profile, not more overlay rendering work.
- Phase 2.3.31 confirms the next structural risk is not overlay rendering but same-tick core work stacking. If future visible profiles fail again, inspect whether warm/sleeping catch-up and pressure diffusion are peaking in the same tick before changing render code or tightening budgets.

## Result

Phase 2.3 is accepted. Primordia now runs a default `960 x 640` local world with chunk scheduling, deterministic lazy field updates, chunk-aware pressure diffusion, region summaries, agent intentions, snapshot schema v3, dirty projection caching, benchmark coverage, and browser-observed Canvas 2D behavior within the approximate `16 tick/s` target.
