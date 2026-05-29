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

Remaining #71 findings after the first browser profile:

- Frontier source chunks are still broad because direct pressure writes cover hundreds of chunks at 900 agents.
- `selectedChunks p95` dropped only slightly from `128` to about `124`, but `core.world.diffusePressure p95` improved from about `13.5ms` to about `9.5ms` because neighbor expansion is now gradient-aware.
- Do not hide this by simply lowering `pressureDiffusionSourceBudget`; the next structural decision should separate local direct pressure writes from global pressure diffusion sources, or aggregate direct write frontier by region/pressure intensity before source selection.
- Terrain projection remains a separate render-side issue: terrain-only profiles still show `projection.projectedChunks p95 ~25` with `render.total p95 ~15ms`.

## GitHub Project Note

Closeout status checked on 2026-05-28:

- #71 is `In progress`; use it as the canonical tomorrow task for pressure-frontier diffusion.
- #72 is `In progress`; browser-safe scheduler telemetry is implemented but remains part of active Phase 2.3.x tracking.
- #73 is `In progress`; browser catch-up is bounded and backlog is stable in the latest terrain profile.
- #74 is `In progress`; lane stats exist and continue to support the pressure-frontier work.
- #75 remains `Todo`; use it for final scheduler/performance acceptance after terrain-only and pressure-visible evidence.
- #76 is `In progress`; today's dirty-domain split resolves the largest design concern, but leave the item active until the next pressure profile confirms no hidden coupling remains.
