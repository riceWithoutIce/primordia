(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.Primordia = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULTS = {
    width: 96,
    height: 64,
    initialAgents: 36,
    maxAgents: 220,
    initialEnergy: 42,
    resourceGrowth: 0.08,
    resourceCap: 9,
    traceDecay: 0.965,
    pressureDecay: 0.992,
    pressureGrowth: 0.012,
    reproductionShare: 0.46,
    seed: 1337
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mulberry32(seed) {
    var t = seed >>> 0;
    return function random() {
      t += 0x6D2B79F5;
      var x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function mergeConfig(config) {
    var merged = {};
    Object.keys(DEFAULTS).forEach(function (key) {
      merged[key] = DEFAULTS[key];
    });
    Object.keys(config || {}).forEach(function (key) {
      merged[key] = config[key];
    });
    return merged;
  }

  function createGenome(random) {
    return {
      senseRadius: random() < 0.72 ? 1 : 2,
      metabolism: 0.52 + random() * 0.5,
      moveCost: 0.18 + random() * 0.2,
      harvestRate: 1.4 + random() * 1.7,
      traceAffinity: -0.6 + random() * 1.2,
      resourceAffinity: 1.3 + random() * 1.4,
      reproductionThreshold: 78 + random() * 42,
      mutationRate: 0.035 + random() * 0.055
    };
  }

  function mutateGenome(parent, random) {
    var rate = parent.mutationRate;
    var child = {};
    Object.keys(parent).forEach(function (key) {
      var value = parent[key];
      if (key === "senseRadius") {
        if (random() < rate) {
          value += random() < 0.5 ? -1 : 1;
        }
        child[key] = Math.round(clamp(value, 1, 3));
        return;
      }

      if (random() < rate) {
        var swing = 1 + (random() - 0.5) * 0.28;
        value *= swing;
      }
      child[key] = value;
    });

    child.metabolism = clamp(child.metabolism, 0.28, 1.8);
    child.moveCost = clamp(child.moveCost, 0.08, 0.75);
    child.harvestRate = clamp(child.harvestRate, 0.45, 4.2);
    child.traceAffinity = clamp(child.traceAffinity, -1.8, 1.8);
    child.resourceAffinity = clamp(child.resourceAffinity, 0.35, 4.4);
    child.reproductionThreshold = clamp(child.reproductionThreshold, 46, 170);
    child.mutationRate = clamp(child.mutationRate, 0.008, 0.18);
    return child;
  }

  function Simulation(config) {
    this.config = mergeConfig(config);
    this.random = mulberry32(this.config.seed);
    this.width = this.config.width;
    this.height = this.config.height;
    this.size = this.width * this.height;
    this.nextAgentId = 1;
    this.tickCount = 0;
    this.births = 0;
    this.deaths = 0;
    this.resources = new Float32Array(this.size);
    this.traces = new Float32Array(this.size);
    this.pressure = new Float32Array(this.size);
    this.agents = [];
    this.reset();
  }

  Simulation.prototype.reset = function reset(nextConfig) {
    if (nextConfig) {
      this.config = mergeConfig(nextConfig);
      this.random = mulberry32(this.config.seed);
      this.width = this.config.width;
      this.height = this.config.height;
      this.size = this.width * this.height;
      this.resources = new Float32Array(this.size);
      this.traces = new Float32Array(this.size);
      this.pressure = new Float32Array(this.size);
    }

    this.nextAgentId = 1;
    this.tickCount = 0;
    this.births = 0;
    this.deaths = 0;
    this.agents = [];

    for (var i = 0; i < this.size; i += 1) {
      this.resources[i] = this.random() * this.config.resourceCap * 0.65;
      this.traces[i] = 0;
      this.pressure[i] = this.random() * 0.35;
    }

    for (var a = 0; a < this.config.initialAgents; a += 1) {
      this.spawnAgent(
        Math.floor(this.random() * this.width),
        Math.floor(this.random() * this.height),
        createGenome(this.random),
        this.config.initialEnergy * (0.75 + this.random() * 0.6),
        0
      );
    }
  };

  Simulation.prototype.index = function index(x, y) {
    var xx = (x + this.width) % this.width;
    var yy = (y + this.height) % this.height;
    return yy * this.width + xx;
  };

  Simulation.prototype.spawnAgent = function spawnAgent(x, y, genome, energy, generation) {
    var agent = {
      id: this.nextAgentId,
      x: (x + this.width) % this.width,
      y: (y + this.height) % this.height,
      energy: energy,
      age: 0,
      generation: generation || 0,
      genome: genome,
      lastAction: "born"
    };
    this.nextAgentId += 1;
    this.agents.push(agent);
    this.births += 1;
    return agent;
  };

  Simulation.prototype.step = function step(iterations) {
    var count = iterations || 1;
    for (var i = 0; i < count; i += 1) {
      this.tick();
    }
  };

  Simulation.prototype.tick = function tick() {
    this.tickCount += 1;
    this.updateEnvironment();

    var newborns = [];
    for (var i = 0; i < this.agents.length; i += 1) {
      var child = this.liveAgent(this.agents[i]);
      if (child) {
        newborns.push(child);
      }
    }

    for (var n = 0; n < newborns.length; n += 1) {
      this.agents.push(newborns[n]);
      this.births += 1;
    }

    var survivors = [];
    for (var s = 0; s < this.agents.length; s += 1) {
      if (this.agents[s].energy > 0) {
        survivors.push(this.agents[s]);
      } else {
        this.deaths += 1;
      }
    }
    this.agents = survivors;

    if (this.agents.length > this.config.maxAgents) {
      this.agents.sort(function (a, b) {
        return b.energy - a.energy;
      });
      var overflow = this.agents.length - this.config.maxAgents;
      this.agents.length = this.config.maxAgents;
      this.deaths += overflow;
    }
  };

  Simulation.prototype.updateEnvironment = function updateEnvironment() {
    var cap = this.config.resourceCap;
    for (var i = 0; i < this.size; i += 1) {
      if (this.random() < this.config.resourceGrowth) {
        this.resources[i] = clamp(this.resources[i] + this.random() * 0.8, 0, cap);
      }
      this.traces[i] *= this.config.traceDecay;
      this.pressure[i] = clamp(
        this.pressure[i] * this.config.pressureDecay + this.traces[i] * this.config.pressureGrowth,
        0,
        4
      );
    }
  };

  Simulation.prototype.liveAgent = function liveAgent(agent) {
    var genome = agent.genome;
    var here = this.index(agent.x, agent.y);
    var pressureCost = this.pressure[here] * 0.08;

    agent.age += 1;
    agent.energy -= genome.metabolism + pressureCost;
    if (agent.energy <= 0) {
      agent.lastAction = "death";
      return null;
    }

    var move = this.chooseMove(agent);
    agent.x = (agent.x + move.dx + this.width) % this.width;
    agent.y = (agent.y + move.dy + this.height) % this.height;
    agent.energy -= genome.moveCost * (Math.abs(move.dx) + Math.abs(move.dy));

    var idx = this.index(agent.x, agent.y);
    var harvested = Math.min(this.resources[idx], genome.harvestRate);
    this.resources[idx] -= harvested;
    agent.energy += harvested;
    this.traces[idx] = clamp(this.traces[idx] + 0.5 + harvested * 0.09, 0, 12);
    agent.lastAction = harvested > 0.2 ? "harvest" : "search";

    if (agent.energy > genome.reproductionThreshold && this.agents.length < this.config.maxAgents) {
      return this.reproduce(agent);
    }

    return null;
  };

  Simulation.prototype.chooseMove = function chooseMove(agent) {
    var candidates = [
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 }
    ];
    var best = candidates[0];
    var bestScore = -Infinity;
    var genome = agent.genome;

    for (var i = 0; i < candidates.length; i += 1) {
      var move = candidates[i];
      var score = this.scoreArea(agent.x + move.dx, agent.y + move.dy, genome);
      score += this.random() * 0.25;
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    return best;
  };

  Simulation.prototype.scoreArea = function scoreArea(cx, cy, genome) {
    var score = 0;
    var radius = genome.senseRadius;
    for (var y = -radius; y <= radius; y += 1) {
      for (var x = -radius; x <= radius; x += 1) {
        var distance = Math.abs(x) + Math.abs(y) + 1;
        var idx = this.index(cx + x, cy + y);
        score += (this.resources[idx] * genome.resourceAffinity) / distance;
        score += (this.traces[idx] * genome.traceAffinity) / distance;
        score -= this.pressure[idx] * 0.35;
      }
    }
    return score;
  };

  Simulation.prototype.reproduce = function reproduce(parent) {
    var share = this.config.reproductionShare;
    var childEnergy = parent.energy * share;
    parent.energy *= 1 - share;

    var childGenome = mutateGenome(parent.genome, this.random);
    var offsetX = this.random() < 0.5 ? -1 : 1;
    var offsetY = this.random() < 0.5 ? -1 : 1;

    parent.lastAction = "divide";
    return {
      id: this.nextAgentId++,
      x: (parent.x + offsetX + this.width) % this.width,
      y: (parent.y + offsetY + this.height) % this.height,
      energy: childEnergy,
      age: 0,
      generation: parent.generation + 1,
      genome: childGenome,
      lastAction: "born"
    };
  };

  Simulation.prototype.metrics = function metrics() {
    var totalEnergy = 0;
    var maxGeneration = 0;
    for (var a = 0; a < this.agents.length; a += 1) {
      totalEnergy += this.agents[a].energy;
      maxGeneration = Math.max(maxGeneration, this.agents[a].generation);
    }

    var totalResource = 0;
    var totalTrace = 0;
    for (var i = 0; i < this.size; i += 1) {
      totalResource += this.resources[i];
      totalTrace += this.traces[i];
    }

    return {
      tick: this.tickCount,
      agents: this.agents.length,
      births: this.births,
      deaths: this.deaths,
      averageEnergy: this.agents.length ? totalEnergy / this.agents.length : 0,
      maxGeneration: maxGeneration,
      totalResource: totalResource,
      totalTrace: totalTrace
    };
  };

  return {
    Simulation: Simulation,
    createGenome: createGenome,
    mutateGenome: mutateGenome
  };
});

