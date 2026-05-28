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

## Current State

Phase 2.3 large-world framework is accepted as a foundation, but Phase 2.3.x is now focused on structural scheduling and profiling rather than narrow rendering patches.

Local state is ahead of GitHub Project status:

- `987bde0` - `Optimize terrain moisture dirty invalidation`
- `067ac44` - `Add core simulation profile counters`
- `7095924` - `Add browser-safe scheduler telemetry`

Recent committed Phase 2.3.x work:

- `c8988cf` - `Tighten Phase 2.3 scheduler lanes`
- current local candidate - direct field write lane split; should be committed after verification

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

Scenario:

- terrain base layer
- resources, agents, processes, pressure, and lineages overlays all off
- `960 x 640` world
- `600` chunks
- `900` agents by the end of the run
- 30 second profile

Assessment failed:

- `sim.step p50`: `49.3ms` vs target `24ms`
- `sim.step p95`: `56.9ms` vs target `33ms`
- `runtime.backlogTicks p95`: `7.0` vs target `3`
- `render.total p95`: `19.5ms` vs target `8ms`

Main readings:

- `core.tick.updateWorld p50`: about `39.3ms`
- `core.world.environmentChunks p50`: about `30.8ms`
- `core.world.diffusePressure p50`: about `8.3ms`
- `core.diffusion.compute p50`: about `7.2ms`
- `core.tick.agents p50`: about `4.4ms`
- `core.tick.refreshAgentChunks p50`: about `5.5ms`
- `projection.paintCells p95`: about `18.7ms`
- `render.projection.total p95`: about `18.7ms`

Current interpretation:

- Agent behavior itself is not the main hotspot.
- Terrain projection has improved enough that it is no longer the first structural target, though it still misses the render budget late in the run.
- The dominant design smell is that chunk activity still couples agent presence, field work, summary refresh, pressure diffusion, and projection invalidation too tightly.
- The top suspected chain is:
  1. agent presence or agent field writes make chunks active/dirty
  2. active chunks run full field updates across resource/trace/pressure/moisture
  3. field updates and pressure diffusion keep many chunks participating
  4. one logical tick costs about 50ms
  5. the browser can throttle tick batches, but cannot split a single expensive tick
  6. backlog stabilizes near the cap instead of clearing

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

Next validation queue:

1. Run `npm run check` and `npm run build` after any final local edits.
2. Capture a new terrain-only deep profile and compare `core.world.environmentChunks`, `activeAgentOnlyChunks`, `activeEnvironmentChunks`, `activeMixedDirtyChunks`, `directFieldWriteChunks`, `directTraceWriteChunks`, `updatedChunks`, `sim.step`, and backlog.
3. Then run a pressure-visible deep profile before closing #71/#75.

## Latest Local Node Benchmark

After the direct field write split, `npm run bench:core` produced:

- `960x640 initialize`: mean about `3139.44ms`
- `960x640 cold step(16)`: mean about `3576.43ms`
- `960x640 hot step(16)`: mean about `664.68ms`
- `960x640 hot snapshot stride 48`: mean about `3.2737ms`

Interpretation: the Node hot-step benchmark improved substantially from the previous local `~1012ms` hot `step(16)`. Browser terrain deep profile is still required because backlog and render projection are browser-specific.

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

- current `core.world.diffusePressure p50`: about `8.3ms`
- current `core.world.diffusePressure p95`: about `13.8ms`
- current `core.diffusion.selectedChunks p95`: `128`
- current `core.diffusion.deferredChunks p95`: `211`
- current `core.diffusion.nearZeroSkippedChunks p95`: `0`

Investigate diffusion after the agent/field activity split, because reducing unnecessary field-active chunks may also reduce pressure frontier pressure.

## GitHub Project Note

Project 5 currently shows #71-#75 as Todo, but local code has already advanced #71-#74. Update the Project before further implementation:

- #71: move to In progress; counters exist and pressure-lane tightening has begun.
- #72: move to In progress; browser-safe scheduler telemetry exists locally.
- #73: move to In progress; browser catch-up is bounded locally but still needs final validation.
- #74: move to In progress; lane stats exist, but the agent/field split remains unresolved.
- #75: keep Todo until new terrain-only and pressure-visible profiles are recorded.
- Add new P0 issue: `Phase 2.3.22: Decouple agent activity from field updates`.
