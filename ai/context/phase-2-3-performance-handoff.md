# Phase 2.3 Performance Handoff

Date: 2026-05-27

Update 2026-05-28:

- Phase 2.3.18 starts the browser-safe scheduler architecture pass without adding runtime third-party dependencies.
- The app frame loop now treats `requestAnimationFrame` as a fixed work opportunity: at most a small number of logical ticks per frame and a fixed millisecond simulation budget.
- Runtime backlog and mode are browser-layer observability only; they are intentionally kept out of deterministic core metrics and snapshot state.
- Core scheduler stats now expose `TickPlan`, `TickReport`, active/warm/sleeping lane counts, summary refresh counts, and pressure diffusion seed/neighbor/selected/effective/near-zero candidate/skipped chunk counters.
- The #71 pressure diffusion task should use the new counters before changing cadence or near-zero skip semantics.
- Phase 2.3.19 has begun pressure-lane tightening: large-world diffusion now combines direct pressure-touch chunks with a bounded deterministic background chunk slice, and region summary refresh counts follow changed diffusion regions instead of pressure projection dirtiness.
- The latest terrain-only deep profile from `C:/Users/admin/Desktop/profile.txt` supersedes the older projection-feedback profile below. Projection repaint is no longer the dominant 371ms hotspot; the current structural bottleneck is `agent/chunk activity -> field chunk updates -> pressure diffusion -> backlog`.
- Phase 2.3.22 first pass is implemented locally: agent occupancy and agent-only movement dirtiness no longer force immediate full environment field scans. Field updates now key off field dirty bits or warm/sleeping cadence, and scheduler diagnostics separate agent-only, field-dirty, and mixed active chunks.
- Phase 2.3.23 first pass is implemented locally: direct agent field writes now use a separate `fieldWriteMask` path for projection, summary, and pressure-frontier observability instead of putting the chunk into the immediate full-field update lane. This is the first practical trace/resource/pressure sub-lane split.
- Phase 2.3.24 starts the dirty-domain split: chunks now carry `fieldDirtyMask` for environment field-lane work, `fieldWriteMask` for direct agent/organ writes, `summaryDirty` for aggregate refresh, `pressureDiffusionActive` for pressure frontier continuation, and `projectionDirtyMask` for render-cache invalidation only. Terrain projection consumes visible moisture debt and retires hidden resource/pressure render debt without clearing core field-write, summary, or diffusion-frontier state.
- Phase 2.3.25 first pass starts pressure-frontier diffusion: large-world diffusion source selection now prioritizes `pressureDiffusionActive` / pressure field dirty chunks, skips empty background chunks, expands to neighbor chunks only when a boundary pressure gradient exists, and keeps changed/deferred chunks in the frontier only while pressure remains meaningful.
- Phase 2.3.26 starts the direct pressure-write frontier split: agent/organ pressure writes now remain local field writes plus per-chunk pressure-write candidates first; only retained frontiers, high-scoring direct candidates, or deterministic background sources enter global pressure diffusion source selection.

## Current State

Phase 2.3 large-world framework is accepted as a foundation, but Phase 2.3.x is now focused on structural scheduling and profiling rather than narrow rendering patches.

GitHub Project 5 now reflects the active Phase 2.3.x items. The local branch is ahead of origin while today's closeout candidate is being committed:

- `987bde0` - `Optimize terrain moisture dirty invalidation`
- `067ac44` - `Add core simulation profile counters`
- `7095924` - `Add browser-safe scheduler telemetry`

Recent committed Phase 2.3.x work:

- `c8988cf` - `Tighten Phase 2.3 scheduler lanes`
- `341496f` - `Split direct agent field writes`
- closeout candidate - `Split dirty domains for projection and field lanes`

The profiler is off by default. It only runs when the app URL includes `?profile=terrain`; deep core timing is enabled with `profileDetail=deep` or `profile=terrain-deep`.

Use this manual sampling shape:

```text
http://127.0.0.1:<vite-port>/?profile=terrain&profileDetail=deep&profileSeconds=30
```

Copy the finished report from Chrome DevTools with:

```js
copy(document.getElementById("terrain-profile-report").textContent)
```

## Current Baseline Profile

Source: `C:/Users/admin/Desktop/profile.txt`

This is the full 30 second terrain-only deep profile after the Phase 2.3.24 dirty-domain split.

Scenario:

- terrain base layer
- resources, agents, processes, pressure, and lineages overlays all off
- `960 x 640` world
- `600` chunks
- `900` agents by the end of the run
- 30 second profile

Assessment failed:

- `sim.step p50`: `28.5ms` vs target `24ms`
- `sim.step p95`: `47.7ms` vs target `33ms`
- `runtime.backlogTicks p95`: `1.0` vs target `3`
- `render.total p95`: `18.7ms` vs target `8ms`

Main readings:

- `core.tick.updateWorld p50/p95`: about `19.3ms / 38.8ms`
- `core.world.environmentChunks p50/p95`: about `10.9ms / 29.7ms`
- `core.world.diffusePressure p50/p95`: about `8.0ms / 13.5ms`
- `core.diffusion.compute p50/p95`: about `7.0ms / 11.3ms`
- `core.tick.agents p50/p95`: about `4.0ms / 4.7ms`
- `core.tick.refreshAgentChunks p50/p95`: about `5.1ms / 5.7ms`
- `projection.paintCells p95`: about `17.9ms`
- `render.projection.total p95`: about `18.0ms`

Current interpretation:

- Agent behavior itself is not the main hotspot.
- The browser scheduler/backlog pass is working; backlog is stable and no longer the active failure.
- The agent/field, direct-write, and dirty-domain splits cut the old `~49ms` tick cost down to about `28-30ms` p50, but the tick still misses the `24ms` p50 target and has a high p95 tail.
- The current structural smells are now narrower:
  1. warm/sleeping field catch-up still updates around `80k-110k` cells per tick
  2. pressure diffusion still computes around `120k-131k` cells per tick through a bounded scan rather than a true frontier
  3. terrain projection repaints only around `25-30` chunks late in the profile, but those repaints still cost around `19ms` p95
  4. hidden resource/pressure projection debt is now retired correctly: `projection.retainedDirtyChunks p95` is `0`

## Structural Refactor Plan

Highest priority: validate and tune `Phase 2.3.22: Decouple agent activity from field updates`.

Design direction:

- Keep same seed/config/tick deterministic replay stable.
- Keep `Simulation.step()` as the logical tick boundary for now.
- Split lane meaning before optimizing implementation details:
  - `agent lane`: agent decisions, movement, harvest, trace writes, reproduction, death, residue.
  - `field lane`: resource growth, trace decay, pressure decay/growth, moisture decay.
  - `pressure diffusion lane`: source/frontier selection, neighbor expansion, deferred chunks, changed regions.
  - `summary lane`: chunk and region aggregate refresh.
  - `render projection lane`: visible-dependency dirty consumption only; no simulation side effects.
- Agent presence should not automatically imply full environment field cell scans.
- Field dirty, render dirty, summary dirty, and diffusion frontier should not all share one overloaded dirty meaning.
- Pressure diffusion should move toward source/frontier semantics, not broad fixed background scanning as the main mechanism.

Completed first-pass queue:

1. GitHub Project status for #71-#76 now reflects active Phase 2.3.x work.
2. New P0 issue #76 tracks agent-active vs field-update decoupling.
3. The issue and handoff document the current coupling:
   `agentCount -> chunk active -> environmentChunks full scan -> dirty projection/diffusion -> backlog`.
4. The first semantic-preserving split is implemented:
   agent-occupied and agent-only dirty chunks can stay agent-active without forcing immediate field-active scans.
5. Direct field writes are separated from full environment scans through `fieldWriteMask`.
6. Dirty domains are now partially separated through `fieldDirtyMask`, `fieldWriteMask`, `summaryDirty`, `pressureDiffusionActive`, and visible-dependency projection consumption.

End-of-day boundary:

1. Today's closeout is Phase 2.3.24 only: dirty domains are split and projection hidden debt is retired without clearing simulation dirty domains.
2. Do not mix the next pressure-frontier implementation into this commit.
3. The full 30s terrain-only profile is now captured and recorded; it proves the render-debt leak is fixed but exposes the next bottlenecks.

Tomorrow queue:

1. Validate Phase 2.3.25 pressure frontier diffusion in the browser. Target reductions from the previous baseline are `core.diffusion.selectedChunks p95 = 128`, `computedCells p95 = 131072`, and `deferredChunks p95 = 213`.
2. Keep #75 as the acceptance evidence task until terrain-only and pressure-visible deep profiles both pass or have explicit follow-up issues.
3. If pressure-frontier work does not bring `sim.step` under budget, inspect warm/sleeping catch-up cadence next.
4. Track terrain projection fast-path separately: late-run `25-27` visible terrain chunks costing `18-19ms` is suspicious, but it is secondary to core tick pressure.

## Latest Local Node Benchmark

After the dirty-domain split, `npm run bench:core` produced:

- `960x640 initialize`: mean about `3076.92ms`
- `960x640 cold step(16)`: mean about `3588.09ms`
- `960x640 hot step(16)`: mean about `646.12ms`
- `960x640 hot snapshot stride 48`: mean about `3.1980ms`

Validation in this pass:

- `npm run check`: passed, `87` tests.
- `npm run build`: passed.
- `npm run bench:core`: completed with the benchmark above.
- Browser terrain-only deep smoke profile at `http://127.0.0.1:5175/?profile=terrain&profileDetail=deep&profileSeconds=10` completed after Phase 2.3.24:
  - `render.total p95`: about `1.5ms`
  - `projection.paintCells p95`: `0ms` after the initial full rebuild
  - `projection.projectedChunks p95`: `0`
  - `projection.hiddenDirtyChunks p95`: about `218`
  - `projection.retiredDirtyChunks p95`: about `218`
  - `projection.retainedDirtyChunks p95`: `0`
  - `runtime.backlogTicks p95`: about `0.9`
  - `sim.step p50/p95`: about `25.7ms / 43.4ms`
  - `core.diffusion.selectedChunks p95`: `128`
- Full 30s browser terrain-only deep profile from `C:/Users/admin/Desktop/profile.txt` completed after Phase 2.3.24:
  - `sim.step p50/p95`: `28.5ms / 47.7ms`
  - `runtime.backlogTicks p95`: `1.0`
  - `render.total p95`: `18.7ms`
  - `projection.projectedChunks p95`: `25`
  - `projection.hiddenDirtyChunks p95`: `259`
  - `projection.retiredDirtyChunks p95`: `259`
  - `projection.retainedDirtyChunks p95`: `0`
  - `core.world.updatedChunks p95`: `108`
  - `core.world.updatedCells p95`: `110592`
  - `core.diffusion.selectedChunks p95`: `128`
  - `core.diffusion.computedCells p95`: `131072`

Interpretation: the Node hot-step benchmark did not regress after the dirty-domain split. The browser smoke profile confirms hidden resource/pressure render debt is retired instead of retained across terrain-only frames, and render p95 drops sharply versus the previous `~19ms` profile. Simulation tick p95 still fails, with pressure diffusion still selecting the full `128` chunk budget, so the next structural target should be pressure-frontier diffusion rather than more projection invalidation work.

After the Phase 2.3.25 pressure-frontier first pass, `npm run bench:core` produced one fast run before the final background-frontier guard:

- `960x640 initialize`: mean about `3026.67ms`
- `960x640 cold step(16)`: mean about `3513.58ms`
- `960x640 hot step(16)`: mean about `621.30ms`
- `960x640 hot snapshot stride 48`: mean about `3.4045ms`

The later run after the final source-continuation guard was noisier and slower:

- `960x640 initialize`: mean about `4502.12ms`
- `960x640 cold step(16)`: mean about `4530.00ms`
- `960x640 hot step(16)`: mean about `742.18ms`
- `960x640 hot snapshot stride 48`: mean about `3.5598ms`

Interpret the Node benchmark as inconclusive until it is rerun on a quieter machine state. The browser profile is currently the better signal for the pressure-frontier change.

Validation in this pass so far:

- `npm run check`: passed, `88` tests.
- `npm run build`: passed.
- `npm run bench:core`: completed with the benchmark above.
- Browser terrain-only deep profiles were run against the local Vite dev server:
  - best terrain run after frontier-aware neighbor expansion: `sim.step p50/p95 ~27.0ms/31.8ms`, `core.world.diffusePressure p50/p95 ~6.2ms/9.5ms`, `core.diffusion.selectedChunks p95 124`, `computedCells p95 126976`, `runtime.backlogTicks p95 ~1.0`, `render.total p95 ~15.0ms`
  - a stricter background-continuation run showed `frontierChunks p95 ~365`, `deferredChunks p95 ~301`, `selectedChunks p95 124`, and `sim.step p50/p95 ~27.5ms/37.8ms`
  - interpretation: pressure diffusion p95 improved versus the Phase 2.3.24 baseline (`~13.5ms`), but direct pressure writes still create a very wide active frontier, so #71 is improved but not closed
- Pressure-visible profile is still required before closing #71/#75.

After the Phase 2.3.26 direct pressure-write split:

- Agent/organ direct pressure writes no longer set `pressureDiffusionActive` immediately. They update local pressure, summary/projection dirtiness, and per-chunk candidate fields: `pressureWriteCells`, `pressureWriteImpulse`, `pressureWriteMaxDelta`, and `pressureWriteLastTick`.
- Large-world pressure source selection now prioritizes retained explicit frontiers, then deterministic high-scoring direct pressure-write candidates, and only falls back to deterministic background pressure chunks when no frontier/candidate source exists.
- New profile/scheduler counters expose the split: `core.diffusion.directCandidateChunks`, `core.diffusion.directPromotedChunks`, `core.diffusion.directSuppressedChunks`, `core.diffusion.directWriteImpulse`, `core.diffusion.backgroundSourceChunks`, plus matching `core.scheduler.directPressure*` counters.
- `npm run check` passed with `91` tests; `npm run build` passed; `npm run bench:core` passed with initialize `~3375.96ms`, cold `step(16)` `~3845.88ms`, hot `step(16)` `~653.60ms`, hot snapshot stride 48 `~3.5813ms`.
- A 10s browser terrain-only deep smoke profile at `http://127.0.0.1:5176/?profile=terrain&profileDetail=deep&profileSeconds=10` confirmed the new counters are live: `directCandidateChunks p95 ~42`, `directPromotedChunks p95 0`, `directSuppressedChunks p95 ~42`, `directWriteImpulse p95 ~3.24`, `backgroundSourceChunks p95 0`. It also showed `selectedChunks p95 128`, `frontierChunks p95 ~535`, and `retainedFrontierChunks p95 ~535`, so the remaining diffusion breadth has shifted from direct writes to retained-frontier persistence.
- Browser pressure-visible profile is still required before closing #71/#75. If the 30s terrain profile repeats the 10s smoke pattern, the next structural task should narrow or age retained frontiers rather than tune direct-write thresholds.

After the Phase 2.3.27 retained-frontier aging first pass:

- Pressure frontier chunks now carry `pressureFrontierLastActiveTick` and `pressureFrontierStaleTicks` in addition to `pressureDiffusionActive`.
- Explicit pressure dirtiness and meaningful diffusion boundary deltas refresh frontier age; chunks that do not produce meaningful diffusion change become stale and age out instead of remaining permanent source candidates.
- Deferred frontier chunks are no longer kept forever merely because they exceeded the hard chunk budget. They stay queued only while their frontier age is still valid; stale deferred chunks are cleared.
- Direct pressure candidates are now region-aggregated before global promotion, and direct promotion uses a separate small share of the source budget. Direct/background sources diffuse locally first; only retained frontiers expand to neighbors in the same tick.
- New counters expose this lifecycle: `core.diffusion.staleFrontierChunks`, `core.diffusion.agedOutFrontierChunks`, `core.diffusion.directRegionCandidateChunks`, `core.diffusion.directPromotionBudget`, plus matching scheduler fields.
- `npm run check` passed with `93` tests; `npm run build` passed.
- `npm run bench:core` completed with initialize `~3119.57ms`, cold `step(16)` `~3345.92ms`, hot `step(16)` `~429.10ms`, hot snapshot stride 48 `~2.8447ms`.
- A 10s browser terrain-only deep smoke profile at `http://127.0.0.1:5174/?profile=terrain&profileDetail=deep&profileSeconds=10` showed the intended source narrowing: `selectedChunks p95 ~50`, `sourceChunks p95 ~50`, `neighborChunks p95 0`, `directCandidateChunks p95 ~100`, `directRegionCandidateChunks p95 ~27`, `directPromotionBudget p95 16`, `directPromotedChunks p95 16`, `directSuppressedChunks p95 ~84`, `diffusePressure p95 ~9.5ms`, and `sim.step p50/p95 ~10.8ms/28.5ms`.
- That short profile still failed the assessment because cold/initial projection polluted `render.total p95 ~349ms` and `runtime.backlogTicks p95 7`. Browser 30s terrain-only and pressure-visible deep profiles are still required before closing #71/#75.
- A later 30s terrain-only deep profile from `C:/Users/admin/Desktop/profile.txt` failed the assessment, but confirmed the pressure source narrowing is effective rather than regressed: `sim.step p50/p95 23.7ms/44.5ms`, `runtime.backlogTicks p95 ~1.0`, `core.world.diffusePressure p95 ~6.5ms`, `core.diffusion.selectedChunks p95 86`, `core.diffusion.computedCells p95 88064`, `directPromotedChunks p95 16`, and `directSuppressedChunks p95 185`.
- The remaining 30s terrain-only bottleneck is now warm/sleeping field catch-up plus terrain projection paint: `core.world.environmentChunks p95 ~29.2ms`, `core.world.catchUpUpdatedChunks p95 86`, `core.world.catchUpUpdatedCells p95 88064`, `projection.projectedChunks p95 25`, and `projection.paintCells p95 ~18ms`.
- Resources/pressure/lineages overlay cost is a real future visual-layer architecture problem, because those layers are baked into projection `ImageData` while agents/processes are separate canvas overlays. Do not pivot to that yet; keep the current Phase 2.3.x sequence on warm/sleeping catch-up cadence first.

After the Phase 2.3.28 warm/sleeping catch-up cadence first pass:

- Large worlds now use an effective field catch-up cadence wider than the config baseline: default `warmChunkInterval 4` becomes effective `8`, and `sleepingChunkInterval 16` becomes effective `32`. Small worlds keep the configured cadence.
- Catch-up still applies elapsed ecological time deterministically; this pass reduces how many chunks are scanned per tick rather than skipping field evolution.
- Scheduler/profile counters now expose `core.scheduler.effectiveWarmChunkInterval` and `core.scheduler.effectiveSleepingChunkInterval`.
- `npm run check` passed with `95` tests; `npm run build` passed.
- `npm run bench:core` completed with initialize `~3457.92ms`, cold `step(16)` `~3418.64ms`, hot `step(16)` `~372.41ms`, hot snapshot stride 48 `~3.2740ms`.
- A 10s browser terrain-only deep smoke profile at `http://127.0.0.1:5174/?profile=terrain&profileDetail=deep&profileSeconds=10` passed: `sim.step p50/p95 ~13.1ms/28.8ms`, `render.total p95 ~1.3ms`, `runtime.backlogTicks p95 ~0.93`, `core.world.environmentChunks p95 ~15.1ms`, `catchUpUpdatedCells p95 44032`, effective cadence `8/32`.
- A 30s browser terrain-only deep profile still failed only on render p95: `sim.step p50/p95 ~17.2ms/31.1ms`, `runtime.backlogTicks p95 ~1.0`, `render.total p95 ~14.8ms`, `core.world.environmentChunks p95 ~16.4ms`, `core.tick.updateWorld p95 ~21.0ms`, `catchUpUpdatedChunks p95 46`, `catchUpUpdatedCells p95 47104`, `diffusePressure p95 ~5.5ms`, `projection.projectedChunks p95 25`, `projection.paintCells p95 ~14ms`.
- The immediate next structural target is terrain projection paint fast-path. Core tick is now under the 33ms p95 target in the 30s terrain-only profile; acceptance is blocked by render projection cost.

After the Phase 2.3.29 terrain projection paint fast-path:

- Terrain base projection with resources/pressure/lineages projection overlays off now uses a typed-array fast path. It writes terrain pixels directly from `StaticTerrain` and `DynamicFields.moistureDelta` instead of constructing an `EnvironmentCell` for every projected cell.
- Resource, pressure, biome, and projection-baked overlay modes keep the generic `paintMapCell(environmentAt(...))` path for correctness.
- `terrainColor` now delegates to `terrainColorFromValues`, and tests verify the fast path matches the generic terrain color output.
- `npm run check` passed with `97` tests; `npm run build` passed.
- `npm run bench:core` completed but was noisy and worse (`hot step(16) ~574.98ms`); this change is app-render-only, so use browser profile as the relevant signal.
- A 30s browser terrain-only deep profile at `http://127.0.0.1:5174/?profile=terrain&profileDetail=deep&profileSeconds=30` passed: `sim.step p50/p95 ~19.6ms/29.0ms`, `runtime.backlogTicks p95 ~1.0`, `render.total p95 ~2.5ms`, `render.projection.total p95 ~1.7ms`, `projection.paintCells p95 ~1.7ms`, `projection.projectedChunks p95 25`, `projection.projectedCells p95 25600`, effective cadence `8/32`.
- The terrain-only acceptance profile is now green. The next validation gap is pressure-visible/profile overlays, especially resources/pressure/lineages because they still use projection-baked visual layers.

After the Phase 2.3.30 field overlay split:

- Added profile URL controls so browser runs can reproduce display states without manual UI clicking: `profileOverlays=pressure`, `profileOverlays=resources,pressure,lineages`, and optional `profileBase=pressure`.
- The pre-fix 30s overlay-visible profiles confirmed the visual-layer problem was render-side, not pressure diffusion:
  - pressure overlay: `sim.step p50/p95 ~16.7ms/20.2ms`, but `render.total p95 ~166.4ms`, `projection.paintCells p95 ~165.5ms`, `projection.projectedChunks p95 247`, `projection.projectedCells p95 252928`.
  - resources+pressure+lineages overlays: `sim.step p50/p95 ~16.6ms/20.1ms`, but `render.total p95 ~185.7ms`, `projection.paintCells p95 ~184.7ms`, `projection.projectedChunks p95 247`.
- Resources, pressure, and lineages are no longer baked into the base projection `ImageData`. They now render through `src/app/render/fieldOverlays.ts` as a separate transparent field overlay cache.
- Base projection dependency is again only the base layer dependency. Overlay dependency is tracked separately by `overlayDependencyMask`, and field overlay debt can be consumed without forcing base projection work.
- The field overlay layer uses `4 x 4` world-cell sampling for the full-world view. Inspector and simulation state remain exact; this LOD applies only to the visual overlay.
- Terrain base projection now keeps the typed-array fast path even when field overlays are visible.
- New profiler counters expose `fieldOverlay.projectedChunks`, `fieldOverlay.projectedCells`, `fieldOverlay.fullRebuild`, `fieldOverlay.consumedDirtyChunks`, `fieldOverlay.dirtyMaskChunks`, and the `fieldOverlay.paintCells` / `render.fieldOverlay.total` phases.
- `npm run check` passed with `100` tests; `npm run build` passed.
- `npm run bench:core` completed with initialize `~3292.63ms`, cold `step(16)` `~3419.01ms`, hot `step(16)` `~379.53ms`, hot snapshot stride 48 `~3.1503ms`.
- A 30s post-fix pressure-overlay profile reduced render cost to `render.total p95 ~3.0ms`, `render.projection.total p95 ~1.6ms`, `fieldOverlay.paintCells p95 ~0.4ms`, `fieldOverlay.projectedCells p95 15616`, with stable backlog. The sample still failed its generic assessment because `sim.step p95 ~39.1ms` on that run, but render was comfortably under budget.
- A 30s post-fix resources+pressure+lineages profile reduced render cost to `render.total p95 ~4.8ms`, `render.projection.total p95 ~1.5ms`, `fieldOverlay.paintCells p95 ~2.4ms`, `fieldOverlay.projectedCells p95 15744`, with stable backlog. The sample still failed its generic assessment because `sim.step p95 ~41.2ms`; treat that as the next core/browser variance item, not an overlay-render regression.
- Screenshot validation showed the low-resolution field overlay visibly composited over the terrain base map.

After the Phase 2.3.31 core tick tail profiling pass:

- This pass is observability-only. It does not change scheduler cadence, pressure diffusion selection, field update semantics, ecology rules, or render behavior.
- New deep-profile buckets split `core.world.environmentChunks` into active, warm catch-up, sleeping catch-up, and per-chunk summary refresh cost: `core.world.activeEnvironmentUpdate`, `core.world.warmCatchUpUpdate`, `core.world.sleepingCatchUpUpdate`, `core.world.refreshChunkSummaries`, `core.world.activeEnvironmentCells`, `core.world.warmUpdatedCells`, and `core.world.sleepingUpdatedCells`.
- New combined tail counters expose same-tick work stacking: `core.tail.fieldAndDiffusionCells`, `core.tail.catchUpAndDiffusionCells`, and `core.tail.summaryAndDiffusionChunks`.
- Validation: `npm run check` passed with `100` tests, `npm run build` passed, and `npm run bench:core` completed with initialize `~4199.49ms`, cold `step(16)` `~3910.31ms`, hot `step(16)` `~401.11ms`, hot snapshot stride 48 `~3.8951ms`; treat the Node benchmark as noisy but non-regressive in kind.
- A visible 30s terrain-only browser profile passed after the counters landed: `sim.step p50/p95 ~18.2ms/26.8ms`, `runtime.backlogTicks p95 ~1.0`, `render.total p95 ~2.2ms`, and `core.tick.updateWorld p95 ~15.9ms`.
- The new counters show the remaining tail shape when the profile is under budget: `warmUpdatedCells p95 35840`, `sleepingUpdatedCells p95 15360`, `catchUpUpdatedCells p95 47104`, `diffusionComputedCells p95 87040`, `fieldAndDiffusionCells p95 155648`, and `catchUpAndDiffusionCells p95 130048`.
- Interpretation: the prior overlay-visible failures were not caused by overlay rendering. When red samples appear, the next structural target should be same-tick stacking between warm/sleeping catch-up and pressure diffusion, not another render pass. A background/hidden tab profile produced `runtime.backlogTicks p95 6` while `sim.step` was green; do not use hidden-tab profiles as acceptance evidence.

## Historical Profile Superseded By Current Baseline

Scenario:

- terrain base layer
- resources, agents, processes, pressure, and lineages overlays all off
- `960 x 640` world
- `600` chunks
- `900` agents by the end of the run
- 30 second profile

Main readings:

- `frame.total p95`: about `891ms`
- `ticksPerFrame p95`: `8`
- `sim.step p95`: about `530ms`
- `core.tick.total p95`: about `68ms`
- `core.tick.updateWorld p95`: about `57ms`
- `core.world.environmentChunks p95`: about `34ms`
- `core.world.diffusePressure p95`: about `24ms`
- `core.diffusion.compute p95`: about `22ms`
- `projection.paintCells p95`: about `371ms`
- `render.projection.total p95`: about `371ms`
- `render.putImageData p95`: about `0.5ms`
- `render.drawImage p95`: about `0.1ms`
- `metrics.domUpdate p95`: about `0.4ms`
- `projection.projectedChunks p95`: `433 / 600`
- `projection.projectedCells p95`: about `443k / 614k`
- `core.dirty.moistureAfterWorld p95`: `415` chunks
- `core.dirty.pressureAfterWorld p95`: `477` chunks

Interpretation:

- Canvas upload, draw, and metrics DOM updates are not the bottleneck.
- The main problem is a catch-up and projection feedback loop:
  1. a frame slows down
  2. the next frame catches up many ticks
  3. each tick updates many environment chunks
  4. environment update marks broad moisture dirty state
  5. terrain projection depends on moisture
  6. projection repaints hundreds of chunks
  7. the expensive repaint slows the next frame again

## Completed Or Superseded Work

The previous immediate bugfix and moisture dirty precision work have effectively been superseded by commits and later profile evidence:

- `987bde0` optimized terrain moisture dirty invalidation.
- `067ac44` added core simulation profile counters.
- `7095924` added browser-safe scheduler telemetry.
- The current profile shows `projection.paintCells p95` around `18.7ms`, not the older `371ms`, so the next priority is not another moisture-dirty patch.

## Later Work

Pressure diffusion remains a core compute hotspot, but should be treated as a lane/frontier design problem:

- current `core.world.diffusePressure p50`: about `8.0ms`
- current `core.world.diffusePressure p95`: about `13.5ms`
- current `core.diffusion.selectedChunks p95`: `128`
- current `core.diffusion.deferredChunks p95`: `213`
- current `core.diffusion.nearZeroSkippedChunks p95`: `0`

Phase 2.3.25 first pass implements a true pressure frontier:

- keep direct pressure writes and `pressureDiffusionActive` as the seed domain
- expand to neighbors only while meaningful pressure delta exists
- avoid treating the bounded background slice as the main diffusion mechanism
- keep deterministic replay stable for same seed/config/tick
- continue refreshing only changed chunk/region summaries
- keep render projection as a consumer of dirty state, not the owner of simulation debt

New profile counters for this pass:

- `core.diffusion.frontierChunks`
- `core.diffusion.retainedFrontierChunks`
- `core.diffusion.skippedBackgroundChunks`

Phase 2.3.27 adds retained-frontier lifecycle counters:

- `core.diffusion.staleFrontierChunks`
- `core.diffusion.agedOutFrontierChunks`
- `core.diffusion.directRegionCandidateChunks`
- `core.diffusion.directPromotionBudget`
- scheduler summary fields `diffusionStaleFrontierChunks` and `diffusionAgedOutFrontierChunks`

Remaining #71 findings after the first browser profile:

- Frontier source chunks are still broad because direct pressure writes cover hundreds of chunks at 900 agents.
- `selectedChunks p95` dropped only slightly from `128` to about `124`, but `core.world.diffusePressure p95` improved from about `13.5ms` to about `9.5ms` because neighbor expansion is now gradient-aware.
- Do not hide this by simply lowering `pressureDiffusionSourceBudget`; the next structural decision should separate local direct pressure writes from global pressure diffusion sources, or aggregate direct write frontier by region/pressure intensity before source selection.
- Terrain projection remains a separate render-side issue: terrain-only profiles still show `projection.projectedChunks p95 ~25` with `render.total p95 ~15ms`.

Follow-up after Phase 2.3.27:

- Run a pressure-visible deep profile before closing #71/#75.
- If `selectedChunks` rises back toward `128`, inspect whether retained frontiers are being regenerated by pressure field dirty writes or by neighbor boundary gradients.

Follow-up after Phase 2.3.28:

- Run pressure-visible and overlay-visible deep profiles before closing #71/#75/#76.
- Keep resources/pressure/lineages overlay architecture as the next visual-layer design risk after the terrain base projection path is green.
- Do not widen pressure diffusion or tighten catch-up cadence again unless a pressure-visible profile shows visible discontinuity or ecology drift.

## GitHub Project Note

Closeout status checked on 2026-05-28:

- #71 is `In progress`; use it as the canonical tomorrow task for pressure-frontier diffusion.
- #72 is `In progress`; browser-safe scheduler telemetry is implemented but remains part of active Phase 2.3.x tracking.
- #73 is `In progress`; browser catch-up is bounded and backlog is stable in the latest terrain profile.
- #74 is `In progress`; lane stats exist and continue to support the pressure-frontier work.
- #75 remains `Todo`; use it for final scheduler/performance acceptance after terrain-only and pressure-visible evidence.
- #76 is `In progress`; today's dirty-domain split resolves the largest design concern, but leave the item active until the next pressure profile confirms no hidden coupling remains.
