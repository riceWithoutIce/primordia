(function () {
  "use strict";

  var canvas = document.getElementById("dish");
  var ctx = canvas.getContext("2d");
  var sim = new Primordia.Simulation();
  var running = true;
  var speed = document.getElementById("speed");
  var toggle = document.getElementById("toggle");
  var step = document.getElementById("step");
  var reset = document.getElementById("reset");

  var metrics = {
    tick: document.getElementById("m-tick"),
    agents: document.getElementById("m-agents"),
    energy: document.getElementById("m-energy"),
    generation: document.getElementById("m-generation"),
    births: document.getElementById("m-births"),
    deaths: document.getElementById("m-deaths")
  };

  toggle.addEventListener("click", function () {
    running = !running;
    toggle.textContent = running ? "暂停" : "继续";
  });

  step.addEventListener("click", function () {
    sim.step(1);
    render();
  });

  reset.addEventListener("click", function () {
    sim.reset({
      seed: Math.floor(Math.random() * 1000000)
    });
    running = true;
    toggle.textContent = "暂停";
    render();
  });

  function render() {
    var cellW = canvas.width / sim.width;
    var cellH = canvas.height / sim.height;
    var image = ctx.createImageData(sim.width, sim.height);
    var data = image.data;

    for (var i = 0; i < sim.size; i += 1) {
      var r = sim.resources[i] / sim.config.resourceCap;
      var t = Math.min(sim.traces[i] / 9, 1);
      var p = Math.min(sim.pressure[i] / 3, 1);
      var offset = i * 4;

      data[offset] = Math.floor(8 + r * 64 + p * 38);
      data[offset + 1] = Math.floor(12 + r * 154 + t * 58);
      data[offset + 2] = Math.floor(13 + t * 156 + p * 36);
      data[offset + 3] = 255;
    }

    var buffer = document.createElement("canvas");
    buffer.width = sim.width;
    buffer.height = sim.height;
    var bufferCtx = buffer.getContext("2d");
    bufferCtx.putImageData(image, 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);

    for (var a = 0; a < sim.agents.length; a += 1) {
      drawAgent(sim.agents[a], cellW, cellH);
    }

    updateMetrics();
  }

  function drawAgent(agent, cellW, cellH) {
    var x = (agent.x + 0.5) * cellW;
    var y = (agent.y + 0.5) * cellH;
    var radius = Math.max(2.2, Math.min(cellW, cellH) * 0.42);
    var hue = 44 + (agent.generation * 11) % 90;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "hsl(" + hue + " 86% 68%)";
    ctx.fill();

    if (agent.lastAction === "divide") {
      ctx.beginPath();
      ctx.arc(x, y, radius + 2.8, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 239, 164, 0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function updateMetrics() {
    var m = sim.metrics();
    metrics.tick.textContent = m.tick;
    metrics.agents.textContent = m.agents;
    metrics.energy.textContent = m.averageEnergy.toFixed(1);
    metrics.generation.textContent = m.maxGeneration;
    metrics.births.textContent = m.births;
    metrics.deaths.textContent = m.deaths;
  }

  function loop() {
    if (running) {
      sim.step(Number(speed.value));
    }
    render();
    requestAnimationFrame(loop);
  }

  render();
  requestAnimationFrame(loop);
})();

