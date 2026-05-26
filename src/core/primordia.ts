export { DEFAULTS } from "./config/defaults";
export { mergeConfig } from "./config/schema";
export { clamp, hash2d, mulberry32 } from "./random/rng";
export { fbmNoise2d, valueNoise2d } from "./random/noise";
export { GENOME_BOUNDS, cloneGenome, constrainGenome, createGenome, mutateGenome } from "./life/genome";
export {
  ORGAN_CAPABILITIES,
  auditOrganOutcome,
  createOrganCost,
  isOrganCapabilityId,
  refuseOrganAction
} from "./life/organs";
export {
  classifyTerrain,
  elevationAt,
  isBarrierAt,
  moistureAt,
  movementCostAt,
  movementTerrainAt,
  resourceFertilityAt,
  resourceTerrainAt,
  terrainCellAt,
  temperatureAt
} from "./world/terrain";
export { createWorld, environmentAt, terrainAt, worldIndex } from "./world/world";
export { Simulation } from "./sim/simulation";
export type {
  Agent,
  AgentAction,
  DeathReason,
  DeathStats,
  DynamicFields,
  EnvironmentCell,
  EnvironmentEventKind,
  EnvironmentEventRecord,
  EnvironmentMode,
  EnvironmentProcessKind,
  EnvironmentProcessRecord,
  ExperimentSnapshot,
  ExperimentSnapshotOptions,
  Genome,
  GenomeInput,
  GenomeRange,
  GridPoint,
  LineageFateMetrics,
  Metrics,
  MoveVector,
  RandomSource,
  SimulationConfig,
  SimulationConfigPatch,
  SnapshotAgent,
  SnapshotCellSample,
  SnapshotEnvironmentSummary,
  SnapshotLineageSummary,
  SnapshotOrganSummary,
  SnapshotSpeciesSummary,
  SnapshotWorldSummary,
  SpeciesFateMetrics,
  StaticTerrain,
  TerrainCell,
  TerrainType,
  WorldState
} from "./types";
export type {
  OrganActionAccepted,
  OrganActionCost,
  OrganActionIntent,
  OrganActionOutcome,
  OrganActionRefused,
  OrganActionRequest,
  OrganAuditRecord,
  OrganCapabilityId,
  OrganRefusalReason,
  OrganTarget
} from "./life/organs";
