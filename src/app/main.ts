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
import { paintMapCell } from "./render/mapViews";
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

speed.addEventListener("input", () => {
  updateSpeedLabel();
});

toggle.addEventListener("click", () => {
  running = !running;
  toggle.textContent = running ? "暂停" : "继续";
});

step.addEventListener("click", () => {
  sim.step(1);
  render();
});

reset.addEventListener("click", () => {
  sim.reset({
    seed: Math.floor(Math.random() * 1000000)
  });
  tickAccumulator = 0;
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
      render();
    }
  });
}

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

function render(): void {
  const cellW = canvas.width / sim.width;
  const cellH = canvas.height / sim.height;
  const image = ctx.createImageData(sim.width, sim.height);
  const data = image.data;

  for (let i = 0; i < sim.size; i += 1) {
    const cell = sim.environmentAt(i);
    const offset = i * 4;
    paintMapCell(data, offset, cell, baseLayer, overlays, sim.config.resourceCap);
  }

  const { buffer, bufferCtx } = getRenderBuffer(sim.width, sim.height);
  bufferCtx.putImageData(image, 0, 0);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);

  if (overlays.agents) {
    for (const agent of sim.agents) {
      drawAgent(agent, cellW, cellH);
    }
  }

  const m = sim.metrics();
  if (overlays.processes) {
    drawEventPulse(m.lastEvent, cellW, cellH);
    drawProcessPulse(m.lastProcess, cellW, cellH);
  }
  updateMetrics(m);
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

function drawAgent(agent: Agent, cellW: number, cellH: number): void {
  const x = (agent.x + 0.5) * cellW;
  const y = (agent.y + 0.5) * cellH;
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

function advanceSimulation(now: number): void {
  if (running) {
    if (!lastFrameTime) {
      lastFrameTime = now;
      return;
    }

    const elapsedSeconds = Math.min((now - lastFrameTime) / 1000, 0.5);
    tickAccumulator += elapsedSeconds * tickRate();
    const ticks = Math.floor(tickAccumulator);

    if (ticks > 0) {
      sim.step(ticks);
      tickAccumulator -= ticks;
    }
  } else {
    tickAccumulator = 0;
  }
}

function loop(now: number): void {
  advanceSimulation(now);
  lastFrameTime = now;
  render();
  requestAnimationFrame(loop);
}

render();
updateSpeedLabel();
requestAnimationFrame(loop);
