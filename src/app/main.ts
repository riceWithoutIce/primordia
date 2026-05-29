import {
  Simulation,
  type Agent,
  type EnvironmentEventRecord,
  type EnvironmentProcessRecord,
  type ExperimentSnapshot
} from "../core/primordia";
import { lineageFillStyle } from "./lineageColor";
import {
  DEFAULT_BASE_LAYER,
  DEFAULT_OVERLAYS,
  isBaseLayer,
  isOverlayLayer,
  type BaseLayer,
  type OverlayLayer,
  type OverlayState
} from "./render/mapViewTypes";
import { createProjection, worldToScreenCell, type ProjectionCache } from "./render/projection";
import { overlayAffectsProjection } from "./render/renderDependencies";
import { createFieldOverlay, type FieldOverlayCache } from "./render/fieldOverlays";
import {
  createTerrainProfilerFromSearch,
  terrainProfileDisplayConfigFromSearch,
  type TerrainProfilePhase,
  type TerrainProfileReport,
  type TerrainProfiler,
  type TerrainProfileScenario
} from "./terrainProfiler";
import "./styles.css";

const { canvas, ctx } = getCanvasContext();

let sim = new Simulation();
let running = true;
let lastFrameTime = 0;
let tickAccumulator = 0;
let lastSnapshot: ExperimentSnapshot | null = null;
let lastSnapshotJson = "";
let baseLayer: BaseLayer = DEFAULT_BASE_LAYER;
let overlays: OverlayState = { ...DEFAULT_OVERLAYS };
let renderBuffer: HTMLCanvasElement | null = null;
let renderBufferCtx: CanvasRenderingContext2D | null = null;
let projectionCache: ProjectionCache | null = null;
let fieldOverlayCache: FieldOverlayCache | null = null;
let observedTickRate = 0;
let runtimeMode: RuntimeMode = "realtime";
let lastRuntimeStatsAt = 0;
let runtimeStatsTickCount = 0;
let lastRuntimeTickCapacity = 0;
const terrainProfiler = createTerrainProfilerFromSearch(window.location.search, {
  log: (message) => console.info(message)
});
let lastProfileTickCount = 0;
let terrainProfileLogged = false;
const TERRAIN_PROFILE_REPORT_ID = "terrain-profile-report";

declare global {
  interface Window {
    primordiaTerrainProfile?: () => TerrainProfileReport;
  }
}

const speed = getElement<HTMLInputElement>("speed");
const speedLabel = getElement<HTMLOutputElement>("speed-label");
const toggle = getElement<HTMLButtonElement>("toggle");
const step = getElement<HTMLButtonElement>("step");
const reset = getElement<HTMLButtonElement>("reset");
const snapshot = getElement<HTMLButtonElement>("snapshot");
const copySnapshot = getElement<HTMLButtonElement>("copy-snapshot");
const downloadSnapshot = getElement<HTMLButtonElement>("download-snapshot");
const snapshotStatus = getElement<HTMLOutputElement>("snapshot-status");
const baseLayerButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".base-layer"));
const overlayInputs = Array.from(document.querySelectorAll<HTMLInputElement>("[data-overlay]"));

const inspector = {
  cell: getElement<HTMLElement>("inspect-cell"),
  chunk: getElement<HTMLElement>("inspect-chunk"),
  region: getElement<HTMLElement>("inspect-region"),
  field: getElement<HTMLElement>("inspect-field")
};

const metrics = {
  tick: getElement<HTMLElement>("m-tick"),
  seed: getElement<HTMLElement>("m-seed"),
  agents: getElement<HTMLElement>("m-agents"),
  lineages: getElement<HTMLElement>("m-lineages"),
  lineagesTotal: getElement<HTMLElement>("m-lineages-total"),
  lineagesExtinct: getElement<HTMLElement>("m-lineages-extinct"),
  dominantLineage: getElement<HTMLElement>("m-dominant-lineage"),
  dominantShare: getElement<HTMLElement>("m-dominant-share"),
  totalResource: getElement<HTMLElement>("m-resource"),
  totalTrace: getElement<HTMLElement>("m-trace"),
  totalPressure: getElement<HTMLElement>("m-pressure"),
  events: getElement<HTMLElement>("m-events"),
  lastEvent: getElement<HTMLElement>("m-last-event"),
  processes: getElement<HTMLElement>("m-processes"),
  lastProcess: getElement<HTMLElement>("m-last-process"),
  species: getElement<HTMLElement>("m-species"),
  dominantSpecies: getElement<HTMLElement>("m-dominant-species"),
  organAttempts: getElement<HTMLElement>("m-organ-attempts"),
  organAccepted: getElement<HTMLElement>("m-organ-accepted"),
  organRefused: getElement<HTMLElement>("m-organ-refused"),
  organBudget: getElement<HTMLElement>("m-organ-budget"),
  organRefusal: getElement<HTMLElement>("m-organ-refusal"),
  chunks: getElement<HTMLElement>("m-chunks"),
  chunkStates: getElement<HTMLElement>("m-chunk-states"),
  updatedChunks: getElement<HTMLElement>("m-updated-chunks"),
  runtime: getElement<HTMLElement>("m-runtime"),
  lanes: getElement<HTMLElement>("m-lanes"),
  diffusion: getElement<HTMLElement>("m-diffusion"),
  regions: getElement<HTMLElement>("m-regions"),
  moisture: getElement<HTMLElement>("m-moisture"),
  energy: getElement<HTMLElement>("m-energy"),
  generation: getElement<HTMLElement>("m-generation"),
  births: getElement<HTMLElement>("m-births"),
  deaths: getElement<HTMLElement>("m-deaths"),
  deathStarvation: getElement<HTMLElement>("m-death-starvation"),
  deathPressure: getElement<HTMLElement>("m-death-pressure"),
  deathOverflow: getElement<HTMLElement>("m-death-overflow")
};

const TICK_RATES = [0.2, 0.5, 1, 2, 4, 8, 16, 32, 64] as const;
const FRAME_SIMULATION_BUDGET_MS = 24;
const MAX_TICKS_PER_FRAME = 2;
const MAX_BACKLOG_TICKS = 8;

type RuntimeMode = "realtime" | "catching-up" | "throttled";

speed.addEventListener("input", () => {
  updateSpeedLabel();
});

toggle.addEventListener("click", () => {
  running = !running;
  toggle.textContent = running ? "暂停" : "继续";
});

step.addEventListener("click", () => {
  sim.step(1);
  observedTickRate = 0;
  runtimeMode = "realtime";
  lastRuntimeTickCapacity = 1;
  render();
});

reset.addEventListener("click", () => {
  sim.reset({
    seed: Math.floor(Math.random() * 1000000)
  });
  sim.profileSink = terrainProfiler?.coreSink() ?? null;
  resetRuntimeState();
  lastFrameTime = 0;
  lastProfileTickCount = sim.tickCount;
  running = true;
  toggle.textContent = "暂停";
  clearSnapshot();
  render();
});

snapshot.addEventListener("click", () => {
  captureSnapshot();
});

copySnapshot.addEventListener("click", () => {
  void copySnapshotToClipboard();
});

downloadSnapshot.addEventListener("click", () => {
  downloadSnapshotJson();
});

for (const button of baseLayerButtons) {
  button.addEventListener("click", () => {
    const nextBaseLayer = button.dataset.baseLayer;
    if (isBaseLayer(nextBaseLayer)) {
      baseLayer = nextBaseLayer;
      projectionCache = null;
      fieldOverlayCache = null;
      for (const item of baseLayerButtons) {
        item.classList.toggle("active", item === button);
      }
      render();
    }
  });
}

for (const input of overlayInputs) {
  input.addEventListener("change", () => {
    const overlay = input.dataset.overlay;
    if (isOverlayLayer(overlay)) {
      overlays = {
        ...overlays,
        [overlay]: input.checked
      };
      if (overlayAffectsProjection(overlay)) {
        projectionCache = null;
      }
      fieldOverlayCache = null;
      render();
    }
  });
}

if (terrainProfiler) {
  sim.profileSink = terrainProfiler.coreSink();
  configureTerrainProfileBaseline();
  exposeTerrainProfileReport(terrainProfiler);
  lastProfileTickCount = sim.tickCount;
}

canvas.addEventListener("pointermove", (event) => {
  terrainProfiler?.recordPointerMove();
  updateInspector(event);
});

canvas.addEventListener("pointerdown", (event) => {
  updateInspector(event);
});

canvas.addEventListener("pointerleave", () => {
  // Keep the last inspected cell visible while the pointer moves to the panel.
});

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

function getCanvasContext(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const element = document.getElementById("dish");
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error("Primordia canvas is missing");
  }

  const context = element.getContext("2d");
  if (!context) {
    throw new Error("Primordia canvas context is unavailable");
  }

  return { canvas: element, ctx: context };
}

function configureTerrainProfileBaseline(): void {
  const profileDisplay = terrainProfileDisplayConfigFromSearch(window.location.search);
  baseLayer = profileDisplay.baseLayer;
  overlays = profileDisplay.overlays;
  projectionCache = null;
  fieldOverlayCache = null;

  for (const button of baseLayerButtons) {
    button.classList.toggle("active", button.dataset.baseLayer === baseLayer);
  }
  for (const input of overlayInputs) {
    const overlay = input.dataset.overlay;
    if (isOverlayLayer(overlay)) {
      input.checked = overlays[overlay];
    }
  }

  console.info(`[terrain-profile] enabled: base=${baseLayer}, overlays=${profileOverlayLabel(overlays)}`);
}

function profileOverlayLabel(state: OverlayState): string {
  const enabled = Object.entries(state)
    .filter(([, active]) => active)
    .map(([overlay]) => overlay);
  return enabled.length > 0 ? enabled.join(",") : "off";
}

function exposeTerrainProfileReport(profiler: TerrainProfiler): void {
  window.primordiaTerrainProfile = () => profiler.report(createTerrainProfileScenario());
}

function createTerrainProfileScenario(): TerrainProfileScenario {
  return {
    baseLayer,
    overlays: { ...overlays },
    tickRate: tickRate(),
    world: {
      width: sim.width,
      height: sim.height,
      tick: sim.tickCount,
      agents: sim.agents.length,
      chunks: sim.world.chunks.chunks.length
    },
    canvas: {
      width: canvas.width,
      height: canvas.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      devicePixelRatio: window.devicePixelRatio || 1
    }
  };
}

function render(): void {
  const renderStart = profileNow();
  const cellW = canvas.width / sim.width;
  const cellH = canvas.height / sim.height;
  let activeFieldOverlayBuffer: HTMLCanvasElement | null = null;
  const fieldOverlayStart = profileNow();
  fieldOverlayCache = createFieldOverlay(sim, baseLayer, overlays, fieldOverlayCache, terrainProfiler);
  if (fieldOverlayCache) {
    const overlay = getFieldOverlayBuffer(fieldOverlayCache.width, fieldOverlayCache.height);
    const overlayBuffer = overlay.buffer;
    const overlayBufferCtx = overlay.bufferCtx;
    overlayBufferCtx.clearRect(0, 0, fieldOverlayCache.width, fieldOverlayCache.height);
    overlayBufferCtx.putImageData(fieldOverlayCache.image, 0, 0);
    overlayBufferCtx.imageSmoothingEnabled = false;
    activeFieldOverlayBuffer = overlayBuffer;
  }
  recordProfileDuration("render.fieldOverlay.total", fieldOverlayStart);

  const projectionStart = profileNow();
  projectionCache = createProjection(sim, baseLayer, overlays, projectionCache, terrainProfiler);
  recordProfileDuration("render.projection.total", projectionStart);

  const { buffer, bufferCtx } = getRenderBuffer(sim.width, sim.height);
  const uploadStart = profileNow();
  bufferCtx.putImageData(projectionCache.image, 0, 0);
  recordProfileDuration("render.putImageData", uploadStart);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  const drawImageStart = profileNow();
  ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);
  recordProfileDuration("render.drawImage", drawImageStart);

  if (activeFieldOverlayBuffer) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(activeFieldOverlayBuffer, 0, 0, canvas.width, canvas.height);
  }

  if (overlays.agents) {
    const agentsStart = profileNow();
    for (const agent of sim.agents) {
      drawAgent(agent, cellW, cellH);
    }
    recordProfileDuration("render.overlayAgents", agentsStart);
  }

  const metricsStart = profileNow();
  const m = sim.metrics();
  recordProfileDuration("metrics.compute", metricsStart);
  if (overlays.processes) {
    const processesStart = profileNow();
    drawEventPulse(m.lastEvent, cellW, cellH);
    drawProcessPulse(m.lastProcess, cellW, cellH);
    recordProfileDuration("render.overlayProcesses", processesStart);
  }
  const metricsDomStart = profileNow();
  updateMetrics(m);
  recordProfileDuration("metrics.domUpdate", metricsDomStart);
  recordProfileDuration("render.total", renderStart);
}

function getRenderBuffer(width: number, height: number): { buffer: HTMLCanvasElement; bufferCtx: CanvasRenderingContext2D } {
  if (!renderBuffer || !renderBufferCtx) {
    renderBuffer = document.createElement("canvas");
    renderBufferCtx = renderBuffer.getContext("2d");
    if (!renderBufferCtx) {
      throw new Error("Could not create render buffer");
    }
  }

  if (renderBuffer.width !== width || renderBuffer.height !== height) {
    renderBuffer.width = width;
    renderBuffer.height = height;
  }

  return { buffer: renderBuffer, bufferCtx: renderBufferCtx };
}

let fieldOverlayBuffer: HTMLCanvasElement | null = null;
let fieldOverlayBufferCtx: CanvasRenderingContext2D | null = null;

function getFieldOverlayBuffer(width: number, height: number): { buffer: HTMLCanvasElement; bufferCtx: CanvasRenderingContext2D } {
  if (!fieldOverlayBuffer || !fieldOverlayBufferCtx) {
    fieldOverlayBuffer = document.createElement("canvas");
    fieldOverlayBufferCtx = fieldOverlayBuffer.getContext("2d");
    if (!fieldOverlayBufferCtx) {
      throw new Error("Could not create field overlay buffer");
    }
  }

  if (fieldOverlayBuffer.width !== width || fieldOverlayBuffer.height !== height) {
    fieldOverlayBuffer.width = width;
    fieldOverlayBuffer.height = height;
  }

  return { buffer: fieldOverlayBuffer, bufferCtx: fieldOverlayBufferCtx };
}

function drawAgent(agent: Agent, cellW: number, cellH: number): void {
  const point = worldToScreenCell(agent.x, agent.y, sim.width, sim.height, canvas.width, canvas.height);
  const x = point.x;
  const y = point.y;
  const radius = Math.max(2.2, Math.min(cellW, cellH) * 0.42);

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = lineageFillStyle(agent);
  ctx.fill();

  if (agent.lastAction === "divide") {
    ctx.beginPath();
    ctx.arc(x, y, radius + 2.8, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 239, 164, 0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawEventPulse(event: EnvironmentEventRecord | null, cellW: number, cellH: number): void {
  if (!event) {
    return;
  }

  const age = sim.tickCount - event.tick;
  if (age < 0 || age > 36) {
    return;
  }

  const x = (event.x + 0.5) * cellW;
  const y = (event.y + 0.5) * cellH;
  const radius = Math.max(cellW, cellH) * (event.radius + age * 0.08);
  const alpha = Math.max(0, 1 - age / 36);

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = event.kind === "bloom" ? `rgba(194, 242, 116, ${alpha * 0.65})` : `rgba(236, 106, 94, ${alpha * 0.68})`;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawProcessPulse(process: EnvironmentProcessRecord | null, cellW: number, cellH: number): void {
  if (!process || !process.active) {
    return;
  }

  const x = (process.x + 0.5) * cellW;
  const y = (process.y + 0.5) * cellH;
  const radius = Math.max(cellW, cellH) * process.radius;
  const alpha = Math.max(0.12, 1 - process.age / Math.max(1, process.duration));

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(101, 196, 224, ${alpha * 0.55})`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function updateMetrics(m = sim.metrics()): void {
  metrics.tick.textContent = String(m.tick);
  metrics.seed.textContent = String(m.seed);
  metrics.agents.textContent = String(m.agents);
  metrics.lineages.textContent = String(m.lineageCount);
  metrics.lineagesTotal.textContent = String(m.lineageFate.total);
  metrics.lineagesExtinct.textContent = String(m.lineageFate.extinct);
  metrics.dominantLineage.textContent = m.lineageFate.dominantId === null ? "-" : `#${m.lineageFate.dominantId}`;
  metrics.dominantShare.textContent = formatPercent(m.lineageFate.dominantShare);
  metrics.totalResource.textContent = formatTotal(m.totalResource);
  metrics.totalTrace.textContent = formatTotal(m.totalTrace);
  metrics.totalPressure.textContent = formatTotal(m.totalPressure);
  metrics.events.textContent = String(m.eventCount);
  metrics.lastEvent.textContent = formatEvent(m.lastEvent);
  metrics.processes.textContent = `${m.activeProcesses}/${m.processCount}`;
  metrics.lastProcess.textContent = formatProcess(m.lastProcess);
  metrics.species.textContent = String(m.speciesCount);
  metrics.dominantSpecies.textContent = m.speciesFate.dominantId === null ? "-" : `#${m.speciesFate.dominantId}`;
  metrics.organAttempts.textContent = String(m.organAttempts);
  metrics.organAccepted.textContent = String(m.organAccepted);
  metrics.organRefused.textContent = String(m.organRefused);
  metrics.organBudget.textContent = formatTotal(m.organBudgetSpent);
  metrics.organRefusal.textContent = m.organDominantRefusalReason ?? "-";
  metrics.chunks.textContent = String(m.chunkCount);
  metrics.chunkStates.textContent = `${m.activeChunks}/${m.warmChunks}/${m.sleepingChunks}`;
  metrics.updatedChunks.textContent = `${m.updatedChunks}/${m.updatedCells.toLocaleString("zh-CN")}`;
  const scheduler = sim.world.chunks.schedulerStats;
  metrics.runtime.textContent = `${runtimeMode} / ${observedTickRate.toFixed(1)} tick/s / backlog ${tickAccumulator.toFixed(1)}`;
  metrics.lanes.textContent = `${scheduler.activeEnvironmentChunks}/${scheduler.warmEnvironmentChunks}/${scheduler.sleepingCatchupChunks}`;
  metrics.diffusion.textContent = `${scheduler.diffusionEffectiveChunks}/${scheduler.diffusionSelectedChunks}`;
  metrics.regions.textContent = String(m.regionCount);
  metrics.moisture.textContent = formatTotal(m.totalMoisture);
  metrics.energy.textContent = m.averageEnergy.toFixed(1);
  metrics.generation.textContent = String(m.maxGeneration);
  metrics.births.textContent = String(m.births);
  metrics.deaths.textContent = String(m.deaths);
  metrics.deathStarvation.textContent = String(m.deathReasons.starvation);
  metrics.deathPressure.textContent = String(m.deathReasons.pressure);
  metrics.deathOverflow.textContent = String(m.deathReasons.overflow);
}

function formatTotal(value: number): string {
  return Math.round(value).toLocaleString("zh-CN");
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatEvent(event: EnvironmentEventRecord | null): string {
  if (!event) {
    return "-";
  }

  return `${event.kind} ${event.x},${event.y}`;
}

function formatProcess(process: EnvironmentProcessRecord | null): string {
  if (!process) {
    return "-";
  }

  return `${process.kind} ${process.x},${process.y}`;
}

function updateInspector(event: PointerEvent): void {
  const inspectorStart = profileNow();
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(sim.width - 1, Math.floor(((event.clientX - rect.left) / rect.width) * sim.width)));
  const y = Math.max(0, Math.min(sim.height - 1, Math.floor(((event.clientY - rect.top) / rect.height) * sim.height)));
  const idx = sim.index(x, y);
  const cell = sim.environmentAt(idx);
  const chunkId = sim.world.chunks.cellToChunk[idx];
  const chunk = sim.world.chunks.chunks[chunkId];
  const region = sim.world.regions.regions[chunk.regionId];
  const cells = Math.max(1, chunk.width * chunk.height);

  inspector.cell.textContent = `${x},${y} ${cell.terrainType}`;
  inspector.field.textContent = `res ${cell.resource.toFixed(2)} / trace ${cell.trace.toFixed(2)} / pressure ${cell.pressure.toFixed(2)} / moisture ${cell.moistureDelta.toFixed(2)}`;
  inspector.chunk.textContent = `#${chunk.id} ${chunk.activity} / agents ${chunk.agentCount} / avgRes ${formatTotal(chunk.summary.resource / cells)}`;
  inspector.region.textContent = `#${region.id} ${region.dominantBiome ?? "-"} / ${region.chunkIds.length} chunks`;
  recordProfileDuration("inspector.update", inspectorStart);
}

function tickRate(): number {
  const index = Math.max(0, Math.min(TICK_RATES.length - 1, Number(speed.value)));
  return TICK_RATES[index];
}

function updateSpeedLabel(): void {
  speedLabel.textContent = `${tickRate()} tick/s`;
}

function captureSnapshot(): void {
  lastSnapshot = sim.snapshot();
  lastSnapshotJson = JSON.stringify(lastSnapshot, null, 2);
  copySnapshot.disabled = false;
  downloadSnapshot.disabled = false;
  snapshotStatus.textContent = `已记录 ${lastSnapshot.id}`;
}

function clearSnapshot(): void {
  lastSnapshot = null;
  lastSnapshotJson = "";
  copySnapshot.disabled = true;
  downloadSnapshot.disabled = true;
  snapshotStatus.textContent = "未记录";
}

async function copySnapshotToClipboard(): Promise<void> {
  if (!lastSnapshotJson) {
    return;
  }

  try {
    await navigator.clipboard.writeText(lastSnapshotJson);
    snapshotStatus.textContent = "已复制快照 JSON";
  } catch {
    snapshotStatus.textContent = "复制失败，可使用下载";
  }
}

function downloadSnapshotJson(): void {
  if (!lastSnapshot || !lastSnapshotJson) {
    return;
  }

  const blob = new Blob([lastSnapshotJson], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${lastSnapshot.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
  snapshotStatus.textContent = "已下载快照 JSON";
}

function profileNow(): number {
  return terrainProfiler ? terrainProfiler.now() : 0;
}

function recordProfileDuration(phase: TerrainProfilePhase, startedAt: number): void {
  if (terrainProfiler) {
    terrainProfiler.recordDuration(phase, terrainProfiler.now() - startedAt);
  }
}

function resetRuntimeState(now = 0): void {
  tickAccumulator = 0;
  observedTickRate = 0;
  runtimeMode = "realtime";
  lastRuntimeStatsAt = now;
  runtimeStatsTickCount = 0;
  lastRuntimeTickCapacity = 0;
}

function updateRuntimeStats(now: number, ticks: number): void {
  if (!lastRuntimeStatsAt) {
    lastRuntimeStatsAt = now;
    runtimeStatsTickCount = 0;
    return;
  }

  runtimeStatsTickCount += ticks;
  const elapsedMs = now - lastRuntimeStatsAt;
  if (elapsedMs >= 1000) {
    observedTickRate = runtimeStatsTickCount / (elapsedMs / 1000);
    runtimeStatsTickCount = 0;
    lastRuntimeStatsAt = now;
  }
}

function recordRuntimeProfile(): void {
  if (!terrainProfiler) {
    return;
  }

  terrainProfiler.recordValue("runtime.backlogTicks", tickAccumulator);
  terrainProfiler.recordValue("runtime.mode", runtimeModeCode(runtimeMode));
  terrainProfiler.recordValue("runtime.observedTickRate", observedTickRate);
  terrainProfiler.recordValue("runtime.tickBudgetMs", FRAME_SIMULATION_BUDGET_MS);
  terrainProfiler.recordValue("runtime.tickCapacity", lastRuntimeTickCapacity);
}

function runtimeModeCode(mode: RuntimeMode): number {
  switch (mode) {
    case "realtime":
      return 0;
    case "catching-up":
      return 1;
    case "throttled":
      return 2;
  }
}

function maybeFlushTerrainProfile(now: number): void {
  if (!terrainProfiler) {
    return;
  }

  const scenario = createTerrainProfileScenario();
  terrainProfiler.maybeSample(now, scenario);
  if (!terrainProfileLogged && terrainProfiler.isComplete(now)) {
    terrainProfileLogged = true;
    const report = terrainProfiler.report(scenario, now);
    publishTerrainProfileReport(report);
    console.info("[terrain-profile] complete", report);
  }
}

function publishTerrainProfileReport(report: TerrainProfileReport): void {
  let element = document.getElementById(TERRAIN_PROFILE_REPORT_ID);
  if (!element) {
    element = document.createElement("script");
    element.id = TERRAIN_PROFILE_REPORT_ID;
    element.setAttribute("type", "application/json");
    document.body.append(element);
  }
  element.textContent = JSON.stringify(report);
}

function advanceSimulation(now: number): void {
  const advanceStart = profileNow();
  if (running) {
    if (!lastFrameTime) {
      lastFrameTime = now;
      runtimeMode = "realtime";
      lastRuntimeTickCapacity = 0;
      return;
    }

    const elapsedSeconds = Math.min((now - lastFrameTime) / 1000, 0.5);
    const accruedTicks = tickAccumulator + elapsedSeconds * tickRate();
    const backlogCapped = accruedTicks > MAX_BACKLOG_TICKS;
    tickAccumulator = Math.min(MAX_BACKLOG_TICKS, accruedTicks);
    const requestedTicks = Math.floor(tickAccumulator);
    const tickCapacity = Math.min(requestedTicks, MAX_TICKS_PER_FRAME);
    const budgetStart = performance.now();
    let consumedTicks = 0;

    while (consumedTicks < tickCapacity) {
      if (consumedTicks > 0 && performance.now() - budgetStart >= FRAME_SIMULATION_BUDGET_MS) {
        break;
      }

      const stepStart = profileNow();
      sim.step(1);
      recordProfileDuration("sim.step", stepStart);
      consumedTicks += 1;

      if (performance.now() - budgetStart >= FRAME_SIMULATION_BUDGET_MS) {
        break;
      }
    }

    tickAccumulator = Math.max(0, tickAccumulator - consumedTicks);
    lastRuntimeTickCapacity = tickCapacity;

    if (backlogCapped || requestedTicks > MAX_TICKS_PER_FRAME) {
      runtimeMode = "throttled";
    } else if (tickAccumulator >= 1 || consumedTicks < requestedTicks) {
      runtimeMode = "catching-up";
    } else {
      runtimeMode = "realtime";
    }
  } else {
    tickAccumulator = 0;
    runtimeMode = "realtime";
    lastRuntimeTickCapacity = 0;
  }
  recordProfileDuration("advanceSimulation", advanceStart);
}

function loop(now: number): void {
  const frameStart = profileNow();
  terrainProfiler?.recordFrameInterval(now);
  advanceSimulation(now);
  lastFrameTime = now;
  const ticks = Math.max(0, sim.tickCount - (lastProfileTickCount ?? sim.tickCount));
  lastProfileTickCount = sim.tickCount;
  updateRuntimeStats(now, ticks);
  recordRuntimeProfile();
  render();
  terrainProfiler?.recordFrame(profileNow() - frameStart, ticks);
  maybeFlushTerrainProfile(now);
  requestAnimationFrame(loop);
}

render();
updateSpeedLabel();
requestAnimationFrame(loop);
