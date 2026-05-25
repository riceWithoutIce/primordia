import { Simulation, type Agent } from "../core/primordia";
import "./styles.css";

const { canvas, ctx } = getCanvasContext();

let sim = new Simulation();
let running = true;
let lastFrameTime = 0;
let tickAccumulator = 0;

const speed = getElement<HTMLInputElement>("speed");
const speedLabel = getElement<HTMLOutputElement>("speed-label");
const toggle = getElement<HTMLButtonElement>("toggle");
const step = getElement<HTMLButtonElement>("step");
const reset = getElement<HTMLButtonElement>("reset");

const metrics = {
  tick: getElement<HTMLElement>("m-tick"),
  agents: getElement<HTMLElement>("m-agents"),
  lineages: getElement<HTMLElement>("m-lineages"),
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
  render();
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

function render(): void {
  const cellW = canvas.width / sim.width;
  const cellH = canvas.height / sim.height;
  const image = ctx.createImageData(sim.width, sim.height);
  const data = image.data;

  for (let i = 0; i < sim.size; i += 1) {
    const cell = sim.environmentAt(i);
    const r = cell.resource / sim.config.resourceCap;
    const t = Math.min(cell.trace / 9, 1);
    const p = Math.min(cell.pressure / 3, 1);
    const offset = i * 4;

    data[offset] = Math.floor(8 + r * 64 + p * 38);
    data[offset + 1] = Math.floor(12 + r * 154 + t * 58);
    data[offset + 2] = Math.floor(13 + t * 156 + p * 36);
    data[offset + 3] = 255;
  }

  const buffer = document.createElement("canvas");
  buffer.width = sim.width;
  buffer.height = sim.height;
  const bufferCtx = buffer.getContext("2d");
  if (!bufferCtx) {
    throw new Error("Could not create render buffer");
  }
  bufferCtx.putImageData(image, 0, 0);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);

  for (const agent of sim.agents) {
    drawAgent(agent, cellW, cellH);
  }

  updateMetrics();
}

function drawAgent(agent: Agent, cellW: number, cellH: number): void {
  const x = (agent.x + 0.5) * cellW;
  const y = (agent.y + 0.5) * cellH;
  const radius = Math.max(2.2, Math.min(cellW, cellH) * 0.42);
  const hue = 44 + (agent.generation * 11) % 90;

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = `hsl(${hue} 86% 68%)`;
  ctx.fill();

  if (agent.lastAction === "divide") {
    ctx.beginPath();
    ctx.arc(x, y, radius + 2.8, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255, 239, 164, 0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function updateMetrics(): void {
  const m = sim.metrics();
  metrics.tick.textContent = String(m.tick);
  metrics.agents.textContent = String(m.agents);
  metrics.lineages.textContent = String(m.lineageCount);
  metrics.energy.textContent = m.averageEnergy.toFixed(1);
  metrics.generation.textContent = String(m.maxGeneration);
  metrics.births.textContent = String(m.births);
  metrics.deaths.textContent = String(m.deaths);
  metrics.deathStarvation.textContent = String(m.deathReasons.starvation);
  metrics.deathPressure.textContent = String(m.deathReasons.pressure);
  metrics.deathOverflow.textContent = String(m.deathReasons.overflow);
}

function tickRate(): number {
  const index = Math.max(0, Math.min(TICK_RATES.length - 1, Number(speed.value)));
  return TICK_RATES[index];
}

function updateSpeedLabel(): void {
  speedLabel.textContent = `${tickRate()} tick/s`;
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
