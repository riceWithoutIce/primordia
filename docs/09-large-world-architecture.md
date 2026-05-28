# Phase 2.3 Large-World Architecture

Date: 2026-05-27

## Scope

Phase 2.3 asks whether the local dish can scale from the Phase 2.2 world model into a larger, still observable simulation framework without changing the project boundary.

Target scope for issues `#54` through `#69`:

- support a logical world of `960 x 640` simulation cells
- partition the world into `32 x 32` chunks, for `30 x 20 = 600` chunks
- preserve an approximate simulation rate of `16 tick/s` on the default local browser target
- keep cell-level ecology for resource, trace, pressure, terrain, agents, species, and organ effects
- add chunk dirty/activity tracking so quiet world areas do not pay full update cost every tick
- introduce deterministic lazy update for sleeping chunks
- schedule chunk work with stable, seed-independent ordering and bounded per-frame cost
- exchange pressure diffusion across chunk boundaries without whole-world temporary passes
- summarize chunks into region and habitat graphs for large-world observation and migration structure
- move agent decisions toward intention records and multi-rate loops
- render the large world through projection and level-of-detail layers instead of per-cell full redraws
- extend experiment export to snapshot schema v3
- benchmark simulation, snapshot, and render paths before deciding whether Canvas 2D is enough

Scope notes:

- This document is an architecture and acceptance target, not an implementation acceptance review.
- The world remains a local, deterministic, two-dimensional information environment.
- The large world should increase habitat scale and ecological history, not introduce real external resources or host capabilities.
- Phase 2.3 should preserve Phase 2.2 and Phase 3 safety boundaries while changing internal storage, scheduling, rendering, and snapshot structure.

## Safety Review

Accepted target boundary for design.

- No real network, URL fetch, browser automation, external API, LLM API, filesystem access, shell execution, process spawning, token access, credential access, cookie access, or environment-variable access may be added.
- Agents remain data records inside a local simulation. They cannot inspect the host, discover capabilities, request permissions, spawn work, or persist outside the user-controlled page state.
- Chunks, regions, intentions, projections, and snapshots are simulation-owned data structures only.
- Lazy update must not hide unbounded background execution. Paused simulation, reset, tab close, and page unload must terminate all simulation work.
- Snapshot export remains user-initiated browser JSON generation. It must not upload, synchronize, beacon, or write to external storage.
- Performance work must not use hidden resource acquisition, remote workers, external compute, or uncontrolled persistence. Web workers may be considered only as local browser execution with explicit lifecycle and no network channel.

## World Target

The Phase 2.3 target world is `960 x 640` cells:

- total cells: `614,400`
- chunk size: `32 x 32`
- total chunks: `600`
- chunk grid: `30` columns by `20` rows

Cell coordinates remain integer simulation coordinates:

```text
cellX: 0..959
cellY: 0..639
chunkX = floor(cellX / 32)
chunkY = floor(cellY / 32)
localX = cellX % 32
localY = cellY % 32
localIndex = localY * 32 + localX
chunkIndex = chunkY * 30 + chunkX
```

The target implementation should avoid per-cell object allocation on the hot path. Dynamic cell fields should be stored in typed arrays, either as whole-world arrays or chunk-local arrays with stable addressing:

- `resource`
- `trace`
- `pressure`
- dynamic process marks needed for the current phase

Static terrain fields should be deterministic and cached:

- elevation
- moisture
- temperature
- fertility
- movement cost
- barrier
- biome

The architecture may generate terrain lazily by chunk, but the generated values must match the same seed/config regardless of camera position, frame rate, chunk wake order, or snapshot timing.

## Chunk Model

Each chunk owns a `32 x 32` cell window plus compact metadata:

- chunk coordinate and index
- typed field slices or offsets
- live agent ids currently inside the chunk
- active environmental process ids intersecting the chunk
- dirty flags for simulation and rendering
- activity score
- sleep state and last fully updated tick
- boundary buffers for pressure diffusion exchange
- summary values for region and habitat graph updates

Dirty flags should be explicit rather than inferred by full scans:

- `resourceDirty`: resource changed enough to affect render or summary output
- `traceDirty`: trace changed enough to affect render or summary output
- `pressureDirty`: pressure changed enough to affect diffusion, render, or summary output
- `agentDirty`: agent occupancy, movement, birth, death, or lineage display changed
- `processDirty`: environmental process membership or pulse changed
- `summaryDirty`: chunk aggregate must be recomputed
- `renderDirty`: projected pixels or overlay cache must be refreshed

Activity is a bounded scalar, updated from local simulation events:

- live agents in the chunk
- recent births or deaths
- pressure above threshold
- resource depletion or recovery above threshold
- environmental process activity
- boundary exchange with active neighbors
- camera focus or inspection can request render work, but must not change simulation state

Chunk states:

- `active`: updated every simulation tick
- `cooling`: updated at a reduced cadence while activity decays
- `sleeping`: skipped on ordinary ticks and advanced lazily when observed or affected

A chunk may sleep only if it has no live agents, no active process pulse, low pressure gradient, low recent field delta, and no pending boundary exchange. Sleep is an optimization of deterministic field evolution, not a different ecology rule.

## Deterministic Lazy Update

Lazy update must produce the same logical result for the same seed, config, and target tick whether a chunk is updated every tick or caught up later.

Requirements:

- Each chunk stores `lastUpdatedTick`.
- Sleeping chunks store enough summary state to advance closed-form decay and recovery over `deltaTicks`.
- Catch-up must run before any read that depends on current cell values, including agent sense, boundary exchange, snapshot export, region summary, or inspected render.
- Catch-up order must be deterministic. If several sleeping chunks wake during one target tick, process them by `chunkIndex` ascending.
- Random values used by lazy update must be derived from stable coordinates, seed, and tick ranges, not from mutable global RNG order.
- Agent actions cannot be lazily approximated. Any chunk containing live agents is active or at least scheduled for its agent loop.
- Environmental processes with discrete lifecycle events must store their next deterministic event tick. A sleeping chunk crossed by a process wakes at the event tick or receives an exact catch-up application.

Acceptable lazy approximations:

- exponential or repeated linear decay for trace
- bounded resource recovery toward terrain fertility carrying capacity
- pressure decay when no active boundary gradient exists
- process-free summary aging

Not acceptable:

- skipping births, deaths, movement, harvest, reproduction, organ action audits, or pressure-boundary exchange for live-agent chunks
- allowing camera position or render cadence to change simulation outcomes
- letting a sleeping chunk remain stale in snapshot v3

## Chunk Scheduler

The simulation should separate logical ticks from browser frames.

Target loop:

```text
frame:
  accumulate elapsed time
  while accumulated time allows and tick budget remains:
    run one logical simulation tick
  project dirty world state for render
  draw current projection
```

At the target `16 tick/s`, one logical tick has about `62.5ms` of wall-clock time, but the browser must still remain responsive. The scheduler should budget work in deterministic phases:

1. wake chunks required for the current tick
2. apply lazy catch-up in stable chunk order
3. update global deterministic environment events
4. update active/cooling chunk fields
5. exchange pressure boundaries
6. resolve agent intentions and actions
7. apply births, deaths, residues, and population caps
8. update summaries, region graph deltas, metrics, and dirty render marks

Chunk ordering must be stable:

- default order: ascending `chunkIndex`
- optional fairness rotation may shift the start index by tick, but the effective order must be derivable from `tick` and config, not from frame timing
- no scheduler result may depend on `requestAnimationFrame` cadence

If a frame cannot finish all projected work:

- simulation ticks should fall behind visibly rather than silently changing rules
- UI should expose observed `tick/s`, active chunk count, sleeping chunk count, and scheduler backlog
- render LOD may degrade before simulation determinism is compromised

### Phase 2.3.18 Browser-Safe Scheduler Pass

Date: 2026-05-28

The first post-acceptance scheduler pass keeps the browser and TypeScript/Vite platform, and does not add new runtime dependencies. It separates browser frame pacing from logical simulation semantics:

- `requestAnimationFrame` now provides a per-frame work opportunity, not an instruction to synchronously catch up every missed tick.
- The app consumes at most a fixed number of logical ticks per frame and also respects a fixed millisecond simulation budget.
- When a local machine cannot sustain the requested rate, the dish slows down and exposes backlog instead of blocking the main thread with long catch-up frames.
- Runtime observability lives in `src/app` and stays out of deterministic core metrics and snapshots.
- Core scheduler reporting is DOM-free and records `TickPlan`, `TickReport`, lane chunk counts, and pressure diffusion counters.
- Pressure diffusion counters for issue `#71` are included as scheduler-adjacent observability: seed chunks, neighbor chunks, selected chunks, effective chunks, near-zero candidate chunks, and actual near-zero skipped chunks.

The current implementation is intentionally conservative. It adds budgeted browser consumption and scheduler instrumentation first; it does not yet change pressure diffusion cadence or skip near-zero chunks, because those would alter ecology timing and need a profile-backed acceptance decision.

## Pressure Diffusion Boundary Exchange

Phase 2.2 pressure diffusion was a whole-world process. Phase 2.3 should make diffusion chunk-aware.

Per chunk:

- diffuse interior cells using chunk-local buffers
- keep one-cell boundary strips for north, south, west, and east exchange
- compute outgoing pressure deltas to neighbors
- receive incoming deltas from neighbors in a deterministic exchange pass
- mark neighbor chunks active or cooling if boundary deltas exceed threshold

Boundary rules:

- exchange is applied after all chunks produce outgoing deltas for the same tick
- neighbor pairs are resolved once per tick in stable pair order
- world outer edges remain closed unless a future explicit boundary mode says otherwise
- barrier and terrain movement cost may affect agent movement, but pressure exchange should use its own documented permeability rule
- sleeping chunks with non-zero incoming exchange wake or catch up before applying the exchange

Acceptance target:

- pressure spreading across chunk edges must visually and numerically match the same rule used inside a chunk within a small tolerance
- a high-pressure pulse near a chunk border must affect the neighboring chunk even if that neighbor was sleeping
- no full `960 x 640` temporary allocation should be required for every diffusion pass

## Region And Habitat Graph

The large world needs an intermediate scale between individual cells and the full map.

Regions are deterministic aggregates over chunks:

- current accepted region size: `4 x 4` chunks, producing `8 x 5 = 40` regions for the default `30 x 20` chunk grid
- each region summarizes terrain, resource, pressure, live population, dominant biome mix, barrier ratio, and corridor hints
- region ids are stable by coordinate

Habitats are the next graph layer derived from contiguous or near-contiguous region traits:

- rich plains and wetlands
- barrier-fragmented mountain corridors
- depleted or high-pressure basins
- coast/ocean edge zones if those remain ecologically relevant
- process-affected temporary habitat patches

Habitat graph edges should be weighted by:

- movement cost between neighboring regions
- barrier density
- resource gradient
- pressure gradient
- recent migration flow

The graph is observational and planning support, not a global pathfinding oracle for every agent. It may inform migration pressure, region-level metrics, and future species summaries, but local agents should still act through local sense and intention rules.

Acceptance target:

- region summaries update without scanning all cells every tick
- region neighbor and corridor hints are deterministic and inspectable
- snapshot v3 can include compact region summaries without exporting every cell by default
- full habitat node extraction remains a follow-up layer over the accepted region graph foundation

## Agent Intention And Multi-Rate Loop

At `960 x 640`, per-agent decisions should be separated from immediate mutation of world fields.

Each active agent tick should produce an intention record:

- agent id
- source cell and chunk
- intended action
- target cell or local target
- expected cost
- local sense summary
- optional organ request summary
- deterministic tie-break key

The resolver then applies intentions in stable order:

1. metabolism and death checks
2. local sense or cached sense refresh
3. intention generation
4. conflict resolution for contested cells/resources
5. movement, harvest, trace, pressure, organ action, reproduction, and residue effects
6. metrics and audit projection

Multi-rate loops:

- cell field decay/recovery: per active chunk tick, lazy for sleeping chunks
- pressure diffusion: configurable cadence, default every tick for active chunks until benchmark says otherwise
- agent intention: every tick for live agents
- expensive sense refresh: may run every `N` ticks if the agent is stationary and local dirty version did not change
- region summaries: every `4` to `16` ticks or on dirty threshold
- habitat graph: slower cadence, for example every `32` to `128` ticks, with dirty-region triggers
- render projection: tied to frames and dirty flags, not simulation mutation
- snapshot export: user-initiated, with full deterministic catch-up before serialization

Any reduced-rate path must be visible in config and tests. It cannot be silently coupled to hardware speed.

## Projection And Render LOD

The UI should stop treating the full world as a cell-by-cell canvas redraw every frame.

Projection layers:

- base terrain projection
- dynamic field projection for resource, trace, and pressure
- agent projection
- process projection
- region/habitat overlay projection
- selection/inspection overlay

LOD levels:

- cell LOD: exact cells for zoomed-in inspection
- block LOD: aggregate `2 x 2`, `4 x 4`, or `8 x 8` cells for normal full-world view
- chunk LOD: one or several pixels per chunk for far overview and activity maps
- region LOD: habitat and species summaries for world-level observation

Render rules:

- static terrain projection may be cached until seed/config/world size changes
- dynamic field projection updates only dirty chunks
- agent projection updates chunks with agent dirty flags
- pressure/resource overlays can use lower LOD outside the viewport or when frame budget is tight
- inspection tools must be able to request exact cell values after lazy catch-up
- render LOD must not change simulation state or scheduler decisions

Canvas 2D evaluation:

- Canvas 2D remains acceptable if it can draw the default `960 x 640` world with overlays at the target viewport while preserving approximate `16 tick/s` simulation and responsive controls.
- The benchmark should separately measure simulation tick cost, projection update cost, draw cost, and snapshot export cost.
- If Canvas 2D fails primarily on full redraw cost, first attempt dirty chunk projection and LOD caches.
- If Canvas 2D still fails after projection caching, consider a WebGL renderer as a UI implementation detail. The simulation core must remain DOM-free and renderer-independent.

## Snapshot Schema V3

Snapshot v3 should preserve reproducibility while avoiding unbounded default exports.

Required top-level fields:

- `schemaVersion: 3`
- `createdAt`
- `seed`
- `tick`
- `config`
- `world`
- `scheduler`
- `metrics`
- `agents`
- `species`
- `chunks`
- `regions`
- `habitats`
- `processes`
- `organs`
- `sampledCells`

World summary:

- width, height, chunk size, chunk columns, chunk rows
- terrain generation config hash or explicit terrain config
- global field totals and ranges

Scheduler summary:

- active chunk count
- cooling chunk count
- sleeping chunk count
- pending wake count
- average chunk update cost if measured
- observed tick/s if measured in the UI

Chunk summary:

- chunk coordinate and index
- state
- last updated tick
- resource, trace, and pressure totals
- live agent count
- dominant biome
- dirty/activity summary

Region and habitat summary:

- region id, chunk bounds, dominant biome mix, population, pressure, resource, species diversity
- habitat id, type, region ids, edge summaries, stability score

Cell data:

- default snapshot exports sampled cells and inspected cells, not every cell
- optional full-cell export may exist only as an explicit user action with size warning
- full export must still contain simulation-owned state only

Compatibility:

- v3 readers may accept v2 snapshots for comparison summaries
- v3 writers should not mutate old schema fields silently
- deterministic replay tests should assert that snapshot v3 for the same seed/config/tick is stable except for explicitly time-stamped export metadata

## Benchmark And Acceptance

Benchmark targets should be recorded before implementation acceptance:

- machine and browser/runtime
- seed and config
- initial agent count and max agent cap
- world size and chunk size
- target tick count
- active/cooling/sleeping chunk counts over time
- average and p95 simulation tick time
- average and p95 projection update time
- average and p95 canvas draw time
- snapshot v3 export time and JSON size
- memory usage where practical

Minimum acceptance targets:

- default world is `960 x 640`
- chunk grid is `30 x 20` with `32 x 32` chunks
- deterministic replay remains stable for same seed/config/tick
- paused, reset, single-step, and speed controls remain responsive
- approximate `16 tick/s` is reachable on the agreed local benchmark target with default configuration
- chunk dirty/activity counts are visible in metrics or debug output
- sleeping chunks wake deterministically when touched by agents or processes, and boundary pressure updates their summaries without forcing global wake-up
- pressure diffusion crosses chunk boundaries
- region summaries and corridor hints are inspectable
- agent intention records are testable without browser DOM
- snapshot v3 exports world, chunk, scheduler, region, agent, species, process, and organ summaries
- render projection shows full-world overview and cell/chunk/region inspection without changing simulation state
- Canvas 2D is accepted, conditionally accepted with LOD constraints, or rejected with benchmark evidence

Validation commands remain:

```powershell
npm run check
npm run build
```

Additional benchmark scripts may be added during implementation, but acceptance should report their exact commands and measured results.

## Follow-Up Review Notes

- The first implementation should prefer correctness, determinism, and observability over aggressive sleep heuristics.
- The scheduler should expose its own behavior early; otherwise performance wins can hide ecological bugs.
- Large snapshots can become the next bottleneck even if the tick loop is fast. Snapshot v3 should be designed as a summary-first format from the beginning.
- If WebGL becomes necessary, keep it behind the projection/render boundary. It should not leak renderer assumptions into `src/core`.
- Future Phase 5 or Phase 6 work must not treat the larger world as permission to add external inputs. Any semantic or external flux work requires a new safety review.

## Result Target

Phase 2.3 succeeds when primordia can run a `960 x 640` local world as a chunked, lazy, inspectable ecology: large enough to show region-scale habitats and migration pressure, structured enough to remain deterministic and replayable, and bounded enough to keep every life process inside the local sandbox membrane.
