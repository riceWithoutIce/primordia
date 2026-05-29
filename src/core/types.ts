import type { OrganAuditRecord, OrganRefusalReason } from "./life/organs";

export type RandomSource = () => number;

export type AgentAction = "born" | "death" | "harvest" | "search" | "divide";

export type AgentIntention = "forage" | "escape-pressure" | "migrate" | "follow-trace" | "explore-edge";

export type DeathReason = "starvation" | "pressure" | "overflow";

export type EnvironmentMode = "closed" | "flux";

export type EnvironmentEventKind = "bloom" | "pressure";

export type TerrainType =
  | "ocean"
  | "coast"
  | "plain"
  | "hill"
  | "mountain"
  | "wetland"
  | "desert"
  | "tundra"
  | "snow";

export type EnvironmentProcessKind = "moisture-front";

export interface GridPoint {
  x: number;
  y: number;
}

export interface MoveVector {
  dx: number;
  dy: number;
}

export interface SimulationConfig {
  environmentMode: EnvironmentMode;
  width: number;
  height: number;
  initialAgents: number;
  maxAgents: number;
  initialEnergy: number;
  resourceGrowth: number;
  resourceCap: number;
  eventInterval: number;
  eventRadius: number;
  eventIntensity: number;
  processInterval: number;
  processDuration: number;
  processRadius: number;
  processIntensity: number;
  barrierThreshold: number;
  terrainCostScale: number;
  traceDecay: number;
  pressureDecay: number;
  pressureDiffusion: number;
  pressureDiffusionChunkBudget: number;
  pressureDiffusionSourceBudget: number;
  pressureGrowth: number;
  reproductionShare: number;
  organBudgetPerTick: number;
  organAuditLimit: number;
  chunkSize: number;
  warmChunkInterval: number;
  sleepingChunkInterval: number;
  agentDecisionInterval: number;
  seed: number;
}

export type SimulationConfigPatch = Partial<SimulationConfig>;

export interface Genome {
  senseRadius: number;
  metabolism: number;
  moveCost: number;
  harvestRate: number;
  traceAffinity: number;
  resourceAffinity: number;
  reproductionThreshold: number;
  mutationRate: number;
  inertia: number;
  riskTolerance: number;
  pressureAversion: number;
  terrainAffinity: number;
  explorationBias: number;
  organAffinity: number;
  organStability: number;
}

export type GenomeInput = Omit<
  Genome,
  | "inertia"
  | "riskTolerance"
  | "pressureAversion"
  | "terrainAffinity"
  | "explorationBias"
  | "organAffinity"
  | "organStability"
> &
  Partial<
    Pick<
      Genome,
      "inertia" | "riskTolerance" | "pressureAversion" | "terrainAffinity" | "explorationBias" | "organAffinity" | "organStability"
    >
  >;

export interface GenomeRange {
  min: number;
  max: number;
}

export interface TerrainCell {
  elevation: number;
  moistureBase: number;
  temperatureBase: number;
  fertilityBase: number;
  movementCost: number;
  movementTerrain: number;
  terrainType: TerrainType;
  barrier: boolean;
}

export interface EnvironmentCell extends TerrainCell {
  resource: number;
  trace: number;
  pressure: number;
  moistureDelta: number;
  fertility: number;
}

export interface StaticTerrain {
  elevation: Float32Array;
  moistureBase: Float32Array;
  temperatureBase: Float32Array;
  fertilityBase: Float32Array;
  movementCost: Float32Array;
  movementTerrain: Float32Array;
  barrier: Uint8Array;
  terrainType: TerrainType[];
}

export interface DynamicFields {
  resource: Float32Array;
  trace: Float32Array;
  pressure: Float32Array;
  nextPressure: Float32Array;
  moistureDelta: Float32Array;
}

export type ChunkActivity = "active" | "warm" | "sleeping";

export type SchedulerLane =
  | "agent"
  | "activeEnvironment"
  | "warmEnvironment"
  | "sleepingCatchup"
  | "pressureDiffusion"
  | "summary";

export interface TickPlan {
  tick: number;
  lanes: SchedulerLane[];
  pressureDiffusion: boolean;
}

export interface TickReport {
  tick: number;
  plan: TickPlan;
  lanes: Record<SchedulerLane, number>;
}

export interface ChunkBounds {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  height: number;
}

export interface ChunkSummary {
  id: number;
  regionId: number;
  activity: ChunkActivity;
  dirtyMask: number;
  fieldDirtyMask: number;
  agentCount: number;
  resource: number;
  trace: number;
  pressure: number;
  moistureDelta: number;
  averageFertility: number;
  averageMovementCost: number;
  barrierRatio: number;
  dominantBiome: TerrainType | null;
}

export interface ChunkRecord extends ChunkBounds {
  regionId: number;
  lastUpdatedTick: number;
  lastTouchedTick: number;
  activity: ChunkActivity;
  dirtyMask: number;
  fieldDirtyMask: number;
  fieldWriteMask: number;
  projectionDirtyMask: number;
  summaryDirty: boolean;
  projectionDirty: boolean;
  pressureDiffusionActive: boolean;
  agentCount: number;
  summary: ChunkSummary;
}

export interface ChunkSchedulerStats {
  tick: number;
  totalChunks: number;
  activeChunks: number;
  warmChunks: number;
  sleepingChunks: number;
  dirtyChunks: number;
  activeAgentOnlyChunks: number;
  activeFieldDirtyChunks: number;
  activeMixedDirtyChunks: number;
  directFieldWriteChunks: number;
  directResourceWriteChunks: number;
  directTraceWriteChunks: number;
  directPressureWriteChunks: number;
  directMixedFieldWriteChunks: number;
  warmFieldUpdateChunks: number;
  sleepingFieldUpdateChunks: number;
  updatedChunks: number;
  updatedCells: number;
  preciseFieldUpdates: number;
  catchUpFieldUpdates: number;
  activeEnvironmentChunks: number;
  warmEnvironmentChunks: number;
  sleepingCatchupChunks: number;
  summaryRefreshChunks: number;
  summaryRefreshRegions: number;
  diffusionChunks: number;
  diffusionSeedChunks: number;
  diffusionNeighborChunks: number;
  diffusionSelectedChunks: number;
  diffusionEffectiveChunks: number;
  diffusionFrontierChunks: number;
  diffusionRetainedFrontierChunks: number;
  diffusionDeferredChunks: number;
  diffusionNearZeroCandidateChunks: number;
  diffusionNearZeroSkippedChunks: number;
  diffusionSkippedBackgroundChunks: number;
  lastTickPlan: TickPlan | null;
  lastTickReport: TickReport | null;
}

export interface ChunkGrid {
  chunkSize: number;
  columns: number;
  rows: number;
  chunks: ChunkRecord[];
  cellToChunk: Uint32Array;
  schedulerStats: ChunkSchedulerStats;
}

export interface RegionSummary {
  id: number;
  x: number;
  y: number;
  chunkIds: number[];
  neighborIds: number[];
  corridorHints: number[];
  dominantBiome: TerrainType | null;
  averageFertility: number;
  averageMovementCost: number;
  barrierRatio: number;
  resource: number;
  pressure: number;
  trace: number;
  agentCount: number;
}

export interface RegionGraph {
  regionSizeInChunks: number;
  columns: number;
  rows: number;
  chunkToRegion: Uint32Array;
  regions: RegionSummary[];
}

export interface EnvironmentEventRecord extends GridPoint {
  tick: number;
  kind: EnvironmentEventKind;
  radius: number;
  intensity: number;
  affectedCells: number;
}

export interface EnvironmentProcessRecord extends GridPoint {
  id: number;
  kind: EnvironmentProcessKind;
  startTick: number;
  age: number;
  duration: number;
  radius: number;
  intensity: number;
  dx: number;
  dy: number;
  affectedCells: number;
  active: boolean;
}

export interface WorldState {
  width: number;
  height: number;
  size: number;
  terrain: StaticTerrain;
  terrainTotals: {
    elevation: number;
    moisture: number;
    temperature: number;
    fertility: number;
    movementCost: number;
    barrierCells: number;
    biomeCounts: Record<TerrainType, number>;
  };
  fields: DynamicFields;
  chunks: ChunkGrid;
  regions: RegionGraph;
  processes: EnvironmentProcessRecord[];
  processHistory: EnvironmentProcessRecord[];
  nextProcessId: number;
}

export interface Agent extends GridPoint {
  id: number;
  lineageId: number;
  speciesId: number;
  energy: number;
  age: number;
  generation: number;
  genome: Genome;
  intention: AgentIntention;
  nextDecisionTick: number;
  lastAction: AgentAction;
  lastMove: MoveVector;
  stuckTicks: number;
  lastBiome: TerrainType;
  deathReason?: DeathReason;
}

export interface DeathStats {
  starvation: number;
  pressure: number;
  overflow: number;
}

export interface LineageFateMetrics {
  total: number;
  living: number;
  extinct: number;
  dominantId: number | null;
  dominantAgents: number;
  dominantShare: number;
}

export interface SpeciesFateMetrics {
  total: number;
  living: number;
  dominantId: number | null;
  dominantAgents: number;
  dominantShare: number;
}

export interface Metrics {
  tick: number;
  seed: number;
  agents: number;
  births: number;
  deaths: number;
  averageEnergy: number;
  maxGeneration: number;
  lineageCount: number;
  lineageFate: LineageFateMetrics;
  speciesCount: number;
  speciesFate: SpeciesFateMetrics;
  deathReasons: DeathStats;
  totalResource: number;
  totalTrace: number;
  totalPressure: number;
  totalMoisture: number;
  eventCount: number;
  lastEvent: EnvironmentEventRecord | null;
  activeProcesses: number;
  processCount: number;
  lastProcess: EnvironmentProcessRecord | null;
  biomeCounts: Record<TerrainType, number>;
  organAttempts: number;
  organAccepted: number;
  organRefused: number;
  organBudgetSpent: number;
  organDominantRefusalReason: OrganRefusalReason | null;
  chunkCount: number;
  activeChunks: number;
  warmChunks: number;
  sleepingChunks: number;
  dirtyChunks: number;
  updatedChunks: number;
  updatedCells: number;
  regionCount: number;
}

export interface SnapshotAgent extends GridPoint {
  id: number;
  lineageId: number;
  speciesId: number;
  energy: number;
  age: number;
  generation: number;
  lastAction: AgentAction;
  intention: AgentIntention;
  lastBiome: TerrainType;
  genome: Genome;
}

export interface SnapshotLineageSummary {
  lineageId: number;
  agents: number;
  maxGeneration: number;
  averageEnergy: number;
  averageAge: number;
}

export interface SnapshotSpeciesSummary {
  speciesId: number;
  agents: number;
  dominantBiome: TerrainType | null;
  averageEnergy: number;
  averageGeneration: number;
}

export interface SnapshotCellSample extends GridPoint {
  resource: number;
  fertility: number;
  movementCost: number;
  barrier: boolean;
  trace: number;
  pressure: number;
  moistureDelta: number;
  elevation: number;
  moistureBase: number;
  temperatureBase: number;
  terrainType: TerrainType;
}

export interface SnapshotEnvironmentSummary {
  sampleStride: number;
  sampledCells: number;
  barrierCells: number;
  resourceHotspots: number;
  pressureHotspots: number;
  averageResource: number;
  averageTrace: number;
  averagePressure: number;
  averageMoistureDelta: number;
  averageFertility: number;
  averageMovementCost: number;
  samples: SnapshotCellSample[];
}

export interface SnapshotWorldSummary {
  width: number;
  height: number;
  biomeCounts: Record<TerrainType, number>;
  averageElevation: number;
  averageMoistureBase: number;
  averageTemperatureBase: number;
  averageFertilityBase: number;
  activeProcesses: number;
  processCount: number;
  lastProcess: EnvironmentProcessRecord | null;
}

export interface SnapshotChunkSummary {
  id: number;
  regionId: number;
  x: number;
  y: number;
  activity: ChunkActivity;
  dirtyMask: number;
  fieldDirtyMask: number;
  fieldWriteMask: number;
  agentCount: number;
  averageResource: number;
  averageTrace: number;
  averagePressure: number;
  averageMoistureDelta: number;
  averageFertility: number;
  averageMovementCost: number;
  barrierRatio: number;
  dominantBiome: TerrainType | null;
}

export interface SnapshotRegionSummary {
  id: number;
  x: number;
  y: number;
  chunks: number;
  neighbors: number[];
  corridorHints: number[];
  dominantBiome: TerrainType | null;
  averageFertility: number;
  averageMovementCost: number;
  barrierRatio: number;
  averageResource: number;
  averagePressure: number;
  averageTrace: number;
  agentCount: number;
}

export interface SnapshotSchedulerSummary extends ChunkSchedulerStats {
  chunkSize: number;
  columns: number;
  rows: number;
}

export interface SnapshotOrganSummary {
  attempts: number;
  accepted: number;
  refused: number;
  budgetSpent: number;
  budgetRemaining: number;
  dominantRefusalReason: OrganRefusalReason | null;
  recentAudit: OrganAuditRecord[];
}

export interface ExperimentSnapshot {
  kind: "primordia.experiment-snapshot";
  schemaVersion: 3;
  id: string;
  tick: number;
  config: SimulationConfig;
  metrics: Metrics;
  world: SnapshotWorldSummary;
  scheduler: SnapshotSchedulerSummary;
  chunks: SnapshotChunkSummary[];
  regions: SnapshotRegionSummary[];
  lineages: SnapshotLineageSummary[];
  species: SnapshotSpeciesSummary[];
  organs: SnapshotOrganSummary;
  environment: SnapshotEnvironmentSummary;
  agents: SnapshotAgent[];
}

export interface ExperimentSnapshotOptions {
  environmentSampleStride?: number;
  includeAllChunks?: boolean;
}
