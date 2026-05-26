# Phase 2 Acceptance Review

Date: 2026-05-26

## Scope

Phase 2 asks whether multiple minimal life loops can form an observable ecology. This review accepts the decomposed Phase 2 task set from `#20` through `#28` and closes `#29`.

Implemented scope:

- deterministic resource terrain and fertility-biased flux
- local depletion, pressure-sensitive recovery, pressure diffusion, and residue feedback
- lineage colors, lineage fate metrics, death reasons, and dominant-lineage observability
- movement cost terrain, barriers, and barrier-aware spawning/reproduction
- deterministic bloom/pressure environmental events
- experiment snapshot JSON with config, tick, metrics, lineage summaries, agents, genomes, and sampled environment state

Scope notes:

- Resource remains a single resource channel with terrain/fertility structure. Distinct typed resources are deferred.
- Pollution is represented by trace and pressure load rather than a separate pollutant field.
- Ancestry is lineage-level plus generation-level; explicit parent/child genealogy is deferred.

## Success Criteria

### Different lineages show different fates

Accepted.

Evidence:

- Initial agents receive independent `lineageId` values, descendants inherit parent lineage, and live/extinct/dominant lineage metrics are exposed.
- Agents are colored by lineage and generation, making divergence visible in the dish.
- Tests cover lineage inheritance, fate metrics, and stable lineage color mapping.

### Local competition, migration, boom, collapse, and recovery are observable

Accepted.

Evidence:

- Resource terrain creates stable rich/poor regions.
- Fertility-biased flux and pressure-sensitive recovery make depleted high-pressure areas recover differently from calm areas.
- Pressure diffusion spreads ecological load beyond a single cell.
- Movement cost and barriers shape migration paths and can trap or redirect local populations.
- Environmental bloom/pressure events create deterministic local pulses.
- User observations during Phase 2 confirmed visible terrain/noise regions, different lineages, pressure spreading, non-single-point pressure behavior, and working snapshot export.

### Experiment records can be saved, replayed, and compared

Accepted.

Evidence:

- `Simulation.snapshot()` emits a deterministic schema containing config, tick, metrics, lineage summaries, agent/genome state, and sampled environment summaries.
- The page can record, copy, and download snapshot JSON without backend storage or external permissions.
- Deterministic replay tests verify same seed/config/tick behavior.
- User manually validated snapshot record/export behavior.

## Safety Review

Accepted.

- No real LLM API was added.
- No agent-side filesystem, shell, credential, token, or network access was added.
- GitHub Pages remains a static `dist/` deployment.
- Environmental events are internal simulation state changes only.
- Snapshot export is user-initiated browser JSON generation and does not persist externally.

## Validation

Commands:

```powershell
npm run check
npm run build
```

Latest verified public page:

<https://ricewithoutice.github.io/primordia/>

## Result

Phase 2 is accepted for the current task definition. The project is ready to move to Phase 3: behavior organs and tool boundaries, with a fresh safety review before introducing any simulated tool system.
