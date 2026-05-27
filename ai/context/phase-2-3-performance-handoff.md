# Phase 2.3 Performance Handoff

Date: 2026-05-27

## Current State

Phase 2.3 large-world framework is accepted, but the terrain-only browser profile shows a new steady-state performance bottleneck after visibility-aware projection invalidation.

Current uncommitted profiler work is intentional and should be kept:

- `src/app/main.ts`
- `src/app/render/projection.ts`
- `src/app/terrainProfiler.ts`
- `src/core/profile.ts`
- `src/core/sim/simulation.ts`
- `src/core/world/update.ts`
- `tests/terrain-profiler.test.ts`

The profiler is off by default. It only runs when the app URL includes `?profile=terrain`; deep core timing is enabled with `profileDetail=deep` or `profile=terrain-deep`.

Use this manual sampling shape:

```text
http://127.0.0.1:<vite-port>/?profile=terrain&profileDetail=deep&profileSeconds=30
```

Copy the finished report from Chrome DevTools with:

```js
copy(document.getElementById("terrain-profile-report").textContent)
```

## Latest Profile

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

## Immediate Bugfix

Fix profiler dirty stats before trusting a second sample.

In `src/app/render/projection.ts`, `countProjectionDirtyStats(...)` currently runs after `clearChunkProjectionDirty(...)`, so `projection.moistureDirtyChunks` reports `0` even though core dirty counters show hundreds of moisture-dirty chunks.

Move the dirty-stat capture before the repaint loop clears selected chunks.

## Next Optimization

Start with moisture dirty precision.

Current source hotspot:

- `src/core/world/update.ts`
- `updateEnvironmentFields(...)`
- every updated environment chunk is marked with:
  - `CHUNK_DIRTY.resource`
  - `CHUNK_DIRTY.trace`
  - `CHUNK_DIRTY.pressure`
  - `CHUNK_DIRTY.moisture`

Recommended narrow implementation:

- Make `updateEnvironmentChunk(...)` return field dirty information instead of only updated cell count.
- Mark `CHUNK_DIRTY.moisture` only when `moistureDelta` changes enough to affect terrain projection.
- Keep the first threshold conservative to avoid stale terrain colors.
- Preserve simulation behavior and snapshot schema; this is only dirty invalidation precision.
- Run `npm run check` and `npm run build`.
- Ask for another manual 30 second terrain deep profile.

Expected effect:

- lower `core.dirty.moistureAfterWorld`
- lower `projection.projectedChunks`
- lower `projection.paintCells`
- weaker catch-up feedback loop

## Later Work

Pressure diffusion remains a core compute hotspot after projection dirty precision:

- `core.world.diffusePressure p95`: about `24ms`
- `core.diffusion.compute p95`: about `22ms`

Investigate diffusion after the terrain projection repaint pressure is reduced.

## GitHub Project Note

No GitHub Project update is required just to preserve this handoff.

If a Project note is useful later, keep it short:

```text
Terrain profile found broad moisture dirty invalidation as the current projection bottleneck. Next: fix profiler dirty stats, then optimize moisture dirty precision in updateEnvironmentFields.
```
