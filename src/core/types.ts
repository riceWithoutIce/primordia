export type RandomSource = () => number;

export type AgentAction = "born" | "death" | "harvest" | "search" | "divide";

export type DeathReason = "starvation" | "pressure" | "overflow";

export type EnvironmentMode = "closed" | "flux";

export type EnvironmentEventKind = "bloom" | "pressure";

export type TerrainType = "ocean" | "coast" | "plain" | "hill" | "mountain" | "wetland" | "desert";

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
  pressureGrowth: number;
  reproductionShare: number;
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
}

export type GenomeInput = Omit<
  Genome,
  "inertia" | "riskTolerance" | "pressureAversion" | "terrainAffinity" | "explorationBias"
> &
  Partial<Pick<Genome, "inertia" | "riskTolerance" | "pressureAversion" | "terrainAffinity" | "explorationBias">>;

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
  moistureDelta: Float32Array;
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
  fields: DynamicFields;
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
}

export interface SnapshotAgent extends GridPoint {
  id: number;
  lineageId: number;
  speciesId: number;
  energy: number;
  age: number;
  generation: number;
  lastAction: AgentAction;
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

export interface ExperimentSnapshot {
  kind: "primordia.experiment-snapshot";
  schemaVersion: 2;
  id: string;
  tick: number;
  config: SimulationConfig;
  metrics: Metrics;
  world: SnapshotWorldSummary;
  lineages: SnapshotLineageSummary[];
  species: SnapshotSpeciesSummary[];
  environment: SnapshotEnvironmentSummary;
  agents: SnapshotAgent[];
}

export interface ExperimentSnapshotOptions {
  environmentSampleStride?: number;
}
