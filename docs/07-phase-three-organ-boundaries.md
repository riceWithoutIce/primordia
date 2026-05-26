# Phase 3 Behavior Organ Boundaries

Date: 2026-05-26

## Core Question

Can a low-level digital lifeform gain richer behavior organs while still staying inside the dish membrane?

Phase 3 treats organs as simulated proteins: local, typed, budgeted actions that transform the dish state. They are not host tools, operating-system capabilities, browser permissions, network clients, file readers, shells, credential readers, or external automation.

## Non-Negotiable Boundary

An organ action may only read and write simulation-owned data:

- `WorldState` terrain and dynamic fields
- agent state and bounded genome traits
- metrics, snapshots, and audit records
- deterministic local config

An organ action must never access:

- real network or URLs
- filesystem reads or writes
- shell, process, command execution, or OS APIs
- environment variables
- tokens, keys, credentials, cookies, login state, or identity material
- browser permissions outside the existing canvas UI
- external services, APIs, databases, queues, or background jobs

If a proposed organ needs any of those capabilities, it belongs outside Phase 3. Future Phase 6 external flux can only project curated external signals into internal fields; it still must not give agents direct external access.

## Immutable Layers

The following layers are part of the membrane and cannot be changed by genome, mutation, lineage, species, organ action, or process:

- capability whitelist
- host I/O boundary
- per-action and per-tick budgets
- refusal rules
- audit record schema
- simulation termination and reset controls
- death, population cap, and energy-budget rules
- parameter bounds and clamps
- snapshot safety filtering

Organs can be selected or weighted by evolvable traits, but they cannot rewrite what is allowed.

## Allowed Organ Shape

Each organ action should be represented as data before it has effects:

- `capabilityId`: stable id from a small whitelist
- `agentId`: actor inside the dish
- `target`: local cell, local agent, local field, or local radius
- `cost`: energy, pressure, trace, resource, or organ budget
- `intent`: typed local action intent
- `outcome`: accepted or refused
- `refusalReason`: present when refused
- `audit`: compact deterministic record

The action resolver decides whether an intent is accepted. Refused actions are first-class outcomes and must be observable.

## Refusal Reasons

Initial refusal reasons:

- `unknown-capability`
- `unsafe-request`
- `missing-capability`
- `insufficient-budget`
- `invalid-target`
- `out-of-range`
- `blocked-terrain`
- `rate-limited`
- `inactive-agent`

Refusal is not an exception path. It is normal simulation behavior and should be counted in metrics and snapshots.

## First Prototype Guidance

The first organ should be deliberately modest. Good candidates:

- local sense pulse: temporarily reads a bounded neighborhood summary
- trace mark: writes a bounded trace pattern with pressure cost
- resource probe: estimates local resource/fertility without harvesting
- micro-repair field: reduces local pressure or trace at a clear energy/resource cost

Avoid anything that sounds like real tool use. Do not implement file search, web search, command execution, browser automation, API calls, model calls, package installation, deployment, or repository mutation as agent organs.

## Budgets And Tradeoffs

Organs need at least two costs:

- direct budget: per-action or per-tick organ budget
- ecological cost: energy, pressure, trace, resource depletion, fertility impact, reproduction drag, or movement cost

An organ should not be a free advantage. If an organ improves survival, it should also create selection pressure elsewhere.

## Observability

Phase 3 should expose:

- organ attempts
- accepted actions
- refusals
- dominant refusal reason
- budget spent
- recent audit summary
- organ-related genome or behavior traits, if added

Snapshots may include summaries and recent compact records. They must not include host-sensitive data because organ actions cannot access host-sensitive data in the first place.

## Acceptance Criteria

Phase 3 implementation can be accepted only if:

- every organ action is local to the simulation
- every action is budgeted, rejectable, and audited
- deterministic replay remains stable for same seed, config, and tick count
- no real network, filesystem, shell, token, credential, browser permission, or external service access is added
- genome mutation cannot alter whitelist, budgets, refusals, audit, termination, population cap, or host boundary
- UI and snapshot output let a human explain what organs attempted and why actions were accepted or refused

## Dependencies

Suggested order:

1. Phase 3.1 safety spec
2. Phase 3.2 organ action domain model
3. Phase 3.3 budgets, refusals, and audit records
4. Phase 3.4 first simulated internal organ prototype
5. Phase 3.5 organ genome traits and ecological tradeoffs
6. Phase 3.6 observability and snapshot support
7. Phase 3.7 acceptance review
