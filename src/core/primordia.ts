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
export {
  CHUNK_DIRTY,
  chunkIdForCell,
  chunkIdForIndex,
  clearChunkProjectionDirty,
  consumeChunkProjectionDirty,
  countChunkActivities,
  createChunkGrid,
  createRegionGraph,
  markChunkProjectionDirty,
  markChunkSummaryDirty,
  retireHiddenProjectionDirty,
  touchArea,
  touchCell,
  touchChunk
} from "./world/chunks";
export { Simulation } from "./sim/simulation";
export type {
  Agent,
  AgentAction,
  AgentIntention,
  ChunkActivity,
  ChunkBounds,
  ChunkGrid,
  ChunkRecord,
  ChunkSchedulerStats,
  ChunkSummary,
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
  RegionGraph,
  RegionSummary,
  SchedulerLane,
  SimulationConfig,
  SimulationConfigPatch,
  SnapshotAgent,
  SnapshotCellSample,
  SnapshotChunkSummary,
  SnapshotEnvironmentSummary,
  SnapshotLineageSummary,
  SnapshotOrganSummary,
  SnapshotRegionSummary,
  SnapshotSchedulerSummary,
  SnapshotSpeciesSummary,
  SnapshotWorldSummary,
  SpeciesFateMetrics,
  StaticTerrain,
  TerrainCell,
  TerrainType,
  TickPlan,
  TickReport,
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
