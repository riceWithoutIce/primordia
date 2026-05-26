# Phase 3 Acceptance Review

Date: 2026-05-26

## Scope

Phase 3 asks whether agents can gain richer behavior organs while remaining fully inside the local dish membrane.

Implemented scope:

- safety boundary specification for simulated behavior organs
- typed organ action model with capability ids, intents, local targets, costs, accepted/refused outcomes, refusal reasons, and audit records
- small capability whitelist: `sense-pulse`, `trace-mark`, `resource-probe`, and `micro-repair`
- per-tick organ budget and compact recent audit history
- `Simulation.attemptOrganAction(request)` as the explicit action resolver entry point
- first internal prototype: `trace-mark`, which only writes bounded local `trace` and `pressure`
- organ metrics and snapshot summaries: attempts, accepted, refused, budget spent, budget remaining, dominant refusal reason, and recent audit records
- bounded organ genome traits: `organAffinity` and `organStability`
- ecological tradeoffs for organ-heavy genomes through metabolism, movement floor, action energy cost, local pressure, reproduction drag, and species distance signal
- UI metrics for organ attempts, accepted actions, refusals, budget spent, and dominant refusal reason

Scope notes:

- Phase 3 organs are simulated proteins, not real tools.
- The first prototype does not make agents autonomous tool users. It gives the core a safe, typed, auditable organ action path.
- Whitelisted capabilities that do not yet have a concrete field effect are still resolved, budgeted, and audited, but only `trace-mark` mutates the dish fields today.
- Organ genome traits can shape costs and local effects, but cannot alter the whitelist, budgets, refusal rules, audit schema, host boundary, population cap, or termination controls.

## Safety Review

Accepted for the current local simulation scope.

- No real network, URL fetch, browser automation, external API, LLM API, filesystem access, shell execution, process spawning, token access, credential access, cookie access, or environment-variable access was added.
- All organ actions are local data transformations over simulation-owned state.
- Unsafe or unknown capabilities are rejected as normal simulation outcomes, not exception paths.
- Mutation and genome distance can affect only bounded local traits and ecological costs.
- Snapshot and UI output expose compact internal records only; they cannot include host-sensitive data because organs cannot read host-sensitive data.

## Acceptance Criteria

### Organ actions are local, budgeted, rejectable, and audited

Accepted.

Evidence:

- `src/core/life/organs.ts` defines the action shape, cost shape, whitelist check, refusal helper, and audit projection.
- `Simulation.attemptOrganAction()` resolves requests through whitelist, active-agent, budget, energy, range, target, and terrain checks.
- Accepted and refused outcomes both append audit records and update metrics.
- Tests cover accepted audits, refused audits, budget refusal, range refusal, and local `trace-mark` field effects.

### Organ advantages carry ecological costs

Accepted.

Evidence:

- `organAffinity` and `organStability` are bounded by `GENOME_BOUNDS` and pass through normal mutation/clamping.
- Organ-heavy genomes raise metabolism and movement floors.
- Effective organ action costs add energy and pressure load without changing per-tick organ budget.
- Reproduction efficiency includes organ drag.
- Species/clade distance includes organ traits so long-running lineages can diverge by organ strategy.
- Tests cover bounded organ traits and organ-heavy local effects with higher cost.

### Observability is sufficient for Phase 3

Accepted.

Evidence:

- `Metrics` includes organ attempts, accepted actions, refusals, budget spent, and dominant refusal reason.
- `ExperimentSnapshot` includes an `organs` summary with recent audit records.
- The UI metrics panel shows organ attempts, accepted actions, refusals, budget spent, and dominant refusal reason.
- Smoke tests check that the organ metric nodes stay wired in the page shell.

## Validation

Commands:

```powershell
npm run check
npm run build
```

Latest validation in this acceptance pass:

- `npm run check`: 2 test files passed, 54 tests passed
- `npm run build`: Vite production build completed successfully

Manual validation is not blocking for the current Phase 3 scope because the main changes are core action resolution, metrics, snapshots, and static UI wiring. Browser review is still useful before the next public release to confirm the enlarged metric panel remains comfortable on the target viewport.

## Follow-Up Review Notes

- Future organ strategy work should decide when agents autonomously choose to call organs during normal ticks. Today the resolver is explicit and safe, but not yet part of every agent's behavior loop.
- Future concrete organs such as `resource-probe` and `micro-repair` should stay local, typed, budgeted, rejectable, and audited.
- If Phase 5 or Phase 6 introduces semantic organs or external flux, it must start from a new safety review rather than extending Phase 3 organs into host tools.

## Result

Phase 3 is accepted for the current task definition. The project now has a safe organ boundary, typed organ actions, refusal and audit mechanics, a first internal field-writing prototype, bounded organ genome traits with ecological costs, and UI/snapshot observability for organ behavior.
