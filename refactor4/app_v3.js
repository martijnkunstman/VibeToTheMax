import RAPIER from "https://cdn.skypack.dev/@dimforge/rapier2d-compat";
import { Pane } from "https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js";
import { SimpleNeuralNetwork } from "./simpleNeuralNet.js";

await RAPIER.init();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");

const nnCanvas = document.getElementById("nnCanvas");
const nnCtx = nnCanvas.getContext("2d");

function resizeNN() {
    nnCanvas.width = 360;
    nnCanvas.height = 240;
}
resizeNN();

const miniCanvas = document.getElementById("minimap");
const miniCtx = miniCanvas.getContext("2d");
function resizeMini() {
    miniCanvas.width = 150;
    miniCanvas.height = 150;
}
resizeMini();

let score = 0;
let targetFood = null;
let bestVirtualTarget = { x: 0, y: 0 };
let leftThrusterActive = false;
let rightThrusterActive = false;
let currentCollider = null;
let foodParticles = [];

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

const SCALE = 60;
document.body.style.overflow = "hidden"; // Force no scrollbars

/* ---------------- PARAMETERS ---------------- */

const FOOD_RADIUS = 0.6; // try 0.5–1.2

const params = {
    thrustPower: 0.25,
    turnThrustMult: 0.4,
    worldWidth: 160,
    worldHeight: 160,
    foodCount: 100, // Increased for larger world
    zoom: 0.6,
    vWidth: 1.0,
    vHeight: 1.0,
    autoSteer: true,
    autoThrust: true,
    sensorRange: 25,
    steeringStrength: 0.15,
    showSensors: true,
    thrusterSize: 1.2,
    // GA Params
    populationSize: 50,
    mutationRate: 0.1,
    generationTime: 30, // seconds
    //
    sensorCount: 7,
    sensorAngle: Math.PI / 2, // total cone angle
    sensorRangeSensors: 10,
    //
    useBrain: true, // Always use brain now
    hiddenLayers: 6,
    brainMutateRate: 0.1,
    showBrain: true
};

/* ---------------- TWEAKPANE ---------------- */

const pane = new Pane();
const worldPane = pane.addFolder({ title: "World" });
worldPane.addBinding(params, "worldWidth", { min: 20, max: 200 });
worldPane.addBinding(params, "worldHeight", { min: 20, max: 200 });
worldPane.addBinding(params, "zoom", { min: 0.1, max: 2.0 });

const shipSizePane = pane.addFolder({ title: "Vehicle Size" });
shipSizePane.addBinding(params, "vWidth", { min: 0.2, max: 4.0, label: "Width" }).on('change', updateCollider);
shipSizePane.addBinding(params, "vHeight", { min: 0.2, max: 4.0, label: "Height" }).on('change', updateCollider);

const aiPane = pane.addFolder({ title: "AI Pilot (Toroidal)" });
aiPane.addBinding(params, "autoSteer");
aiPane.addBinding(params, "autoThrust");
aiPane.addBinding(params, "sensorRange", { min: 5, max: 100 });
aiPane.addBinding(params, "steeringStrength", { min: 0.01, max: 0.5 });

aiPane.addBinding(params, "sensorCount", { min: 1, max: 21, step: 1 });
aiPane.addBinding(params, "sensorAngle", { min: 0.1, max: Math.PI });
aiPane.addBinding(params, "sensorRangeSensors", { min: 5, max: 120 });

const visualPane = pane.addFolder({ title: "Visuals" });
visualPane.addBinding(params, "showSensors");
visualPane.addBinding(params, "showBrain");
visualPane.addBinding(params, "thrusterSize", { min: 0.5, max: 4.0 });

const gaPane = pane.addFolder({ title: "Genetic Algorithm" });
gaPane.addBinding(params, "populationSize", { min: 10, max: 100, step: 10 }).on('change', startGeneration);
gaPane.addBinding(params, "generationTime", { min: 5, max: 60 });
gaPane.addBinding(params, "mutationRate", { min: 0.01, max: 1.0 });
gaPane.addButton({ title: "Force Next Gen" }).on('click', nextGeneration);

const brainPane = pane.addFolder({ title: "Neural Network" });
brainPane.addBinding(params, "useBrain");
brainPane.addBinding(params, "brainMutateRate", { min: 0.01, max: 1.0 });
brainPane.addButton({ title: "Randomize Brain" }).on('click', resetBrain); // These will operate on bestVehicle's brain
brainPane.addButton({ title: "Reset to Seeker" }).on('click', resetSeeker); // These will operate on bestVehicle's brain
brainPane.addButton({ title: "Mutate Brain" }).on('click', mutateBrain);
brainPane.addButton({ title: "Clear Save" }).on('click', clearSave);

/* ---------------- PHYSICS & POPULATION ---------------- */

const world = new RAPIER.World({ x: 0, y: 0 });

let population = [];
let generation = 1;
let genStartTime = Date.now();
let bestVehicle = null;

// Collision Filtering:
// Group 1: Walls
// Group 2: Vehicles
// Vehicles should collide with Walls (Group 1) but NOT with other Vehicles (Group 2)
// This requires setting collision groups properly.
// RAPIER uses interaction groups: member | filter
// We'll keep it simple: everything collides for now to avoid complexity, 
// or maybe disable vehicle-vehicle collision if user requested "train multiple".
// Usually training is cleaner without inter-vehicle collisions.

function createVehicle(brain = null) {
    const rigidBody = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(0, 0)
            .setLinearDamping(1.5)
            .setAngularDamping(2.5)
    );

    // Spread out spawns
    rigidBody.setTranslation({
        x: (Math.random() - 0.5) * (params.worldWidth - 10),
        y: (Math.random() - 0.5) * (params.worldHeight - 10)
    }, true);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(params.vWidth / 2, params.vHeight / 2)
        .setCollisionGroups(0x00020001); // Member Group 2, Filter Group 1 (Walls) - example logic varies by library
    // Actually simplest Rapier JS way:
    // By default everything hits everything. 
    // We can just ignore it for now or implement collision groups if needed.

    const collider = world.createCollider(colliderDesc, rigidBody);

    // 9 inputs, 12, 8, 2 outputs
    const newBrain = brain ? brain.clone() : new SimpleNeuralNetwork([params.sensorCount + 3, 12, 8, 2]);
    if (!brain) newBrain.setBraitenbergWeights(); // Start smart if fresh

    return {
        rigidBody: rigidBody,
        collider: collider,
        brain: newBrain,
        score: 0,
        fitness: 0,
        isDead: false,
        traveled: 0,
        x: 0, y: 0, // Last pos
        sensors: [] // Store sensor data for vis
    };
}

function startGeneration() {
    // Clear old
    population.forEach(p => {
        world.removeCollider(p.collider, false);
        world.removeRigidBody(p.rigidBody);
    });
    population = [];

    spawnFood(); // Reset food

    for (let i = 0; i < params.populationSize; i++) {
        population.push(createVehicle());
    }

    genStartTime = Date.now();
    generation = 1; // Reset if manually called, mostly
    hud.innerText = `GEN: ${generation}`;
    bestVehicle = null; // Reset best vehicle for new generation
}

function nextGeneration() {
    // 1. Calculate Fitness
    // Fitness = Score (Food eaten)
    // Maybe add time alive logic later

    let maxFit = 0;

    // 2. Selection Pool
    // Sort by fitness
    population.sort((a, b) => b.score - a.score);

    const eliteCount = 2;
    const newPopBrains = [];

    // Keep Elites
    for (let i = 0; i < eliteCount; i++) {
        if (population[i]) newPopBrains.push(population[i].brain.clone());
    }

    // Fill rest with children
    while (newPopBrains.length < params.populationSize) {
        // Simple Tournament Selection or Top %
        // Select from top 10% or 10 individuals, whichever is smaller
        const selectionPoolSize = Math.min(Math.ceil(params.populationSize * 0.1), 10);
        const parentA = population[Math.floor(Math.random() * selectionPoolSize)].brain;
        const parentB = population[Math.floor(Math.random() * selectionPoolSize)].brain;

        let child = SimpleNeuralNetwork.crossover(parentA, parentB);
        child.mutate(params.mutationRate);
        newPopBrains.push(child);
    }

    // Cleanup Physics
    population.forEach(p => {
        world.removeCollider(p.collider, false);
        world.removeRigidBody(p.rigidBody);
    });
    population = [];

    // Create Next Gen
    newPopBrains.forEach(b => {
        population.push(createVehicle(b));
    });

    // Reset World State
    genStartTime = Date.now();
    generation++;
    saveState(); // Auto-save on next gen
    spawnFood();
    bestVehicle = null; // Reset best vehicle for new generation
}

function updateCollider() {
    // Update all
    // Simplified: Just restart gen if size changes
    startGeneration();
}

// Initial Start
if (!loadState()) {
    startGeneration();
}

/* ---------------- PERSISTENCE ---------------- */

function saveState() {
    if (!bestVehicle || !bestVehicle.brain) return;
    const data = {
        generation: generation,
        brain: bestVehicle.brain.serialize()
    };
    localStorage.setItem("vibeToTheMax_save", JSON.stringify(data));
    console.log("State Saved: Gen " + generation);
}

function loadState() {
    const json = localStorage.getItem("vibeToTheMax_save");
    if (!json) return false;

    try {
        const data = JSON.parse(json);
        console.log("Loading State: Gen " + data.generation);

        // Restore Gen
        generation = data.generation || 1;

        // Deserialize Brain
        const loadedBrain = SimpleNeuralNetwork.deserialize(data.brain);
        if (!loadedBrain) return false;

        // Start Generation with this brain as the "seed" for the population
        startGenerationWithBrain(loadedBrain);
        return true;

    } catch (e) {
        console.error("Failed to load save", e);
        return false;
    }
}

function clearSave() {
    localStorage.removeItem("vibeToTheMax_save");
    console.log("Save Cleared");
    location.reload();
}

function startGenerationWithBrain(seedBrain) {
    // Clear old
    population.forEach(p => {
        world.removeCollider(p.collider, false);
        world.removeRigidBody(p.rigidBody);
    });
    population = [];

    spawnFood();

    // Create population based on the seed brain
    // Strategy: 1 Elite (exact copy), rest mutated children
    population.push(createVehicle(seedBrain)); // The exact saved brain

    // Fill rest with mutated versions of the seed
    for (let i = 1; i < params.populationSize; i++) {
        const brain = seedBrain.clone();
        brain.mutate(params.mutationRate);
        population.push(createVehicle(brain));
    }

    genStartTime = Date.now();
    hud.innerText = `GEN: ${generation}`;
    bestVehicle = null;
}

/* ---------------- NEURAL NETWORK (for bestVehicle) ---------------- */

// These functions now operate on the `bestVehicle`'s brain for visualization/debugging
function resetBrain() {
    if (bestVehicle) {
        bestVehicle.brain = new SimpleNeuralNetwork([params.sensorCount + 3, 12, 8, 2]);
    }
}

function resetSeeker() {
    if (bestVehicle) {
        bestVehicle.brain = new SimpleNeuralNetwork([params.sensorCount + 3, 12, 8, 2]);
        bestVehicle.brain.setBraitenbergWeights();
    }
}

function mutateBrain() {
    if (bestVehicle) {
        bestVehicle.brain.mutate(params.brainMutateRate);
    }
}

// let foodParticles = []; // Moved to top
function spawnFood() {
    foodParticles = []; // Clear existing food
    while (foodParticles.length < params.foodCount) {
        spawnOneFood();
    }
}

function spawnOneFood() {
    foodParticles.push({
        x: (Math.random() - 0.5) * params.worldWidth,
        y: (Math.random() - 0.5) * params.worldHeight
    });
}

/* ---------------- LOGIC ---------------- */

const keys = {};
window.addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

function senseFoodRays(position, angle) {
    const hits = [];
    const halfCone = params.sensorAngle / 2;
    const count = params.sensorCount;
    const ww = params.worldWidth;
    const wh = params.worldHeight;

    for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const rayAngle = angle - halfCone + t * params.sensorAngle;

        // 🔥 MATCH SHIP FORWARD DIRECTION
        const dir = {
            x: Math.sin(rayAngle),
            y: -Math.cos(rayAngle)
        };

        let closest = null;
        let minDist = params.sensorRangeSensors;

        foodParticles.forEach(f => {
            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    const fx = f.x + ox * ww;
                    const fy = f.y + oy * wh;

                    const dx = fx - position.x;
                    const dy = fy - position.y;

                    // projection along ray
                    const proj = dx * dir.x + dy * dir.y;
                    if (proj < 0 || proj > params.sensorRangeSensors) continue;

                    // perpendicular distance
                    const perp = Math.abs(
                        dx * -dir.y + dy * dir.x
                    );

                    if (perp < FOOD_RADIUS && proj < minDist) {
                        minDist = proj;
                        closest = { x: fx, y: fy };
                    }
                }
            }
        });

        hits.push({
            angle: rayAngle,
            hit: closest,
            dist: minDist
        });
    }

    return hits;
}


function update() {
    // Check Generation Timer
    const elapsed = (Date.now() - genStartTime) / 1000;
    if (elapsed > params.generationTime) {
        nextGeneration();
        return;
    }

    const ww = params.worldWidth;
    const wh = params.worldHeight;
    const power = params.thrustPower;

    // Find Best
    let maxScore = -1;

    population.forEach(bot => {
        if (bot.isDead) return;

        const vehicle = bot.rigidBody;
        const p = vehicle.translation();
        const a = vehicle.rotation();

        bot.x = p.x; bot.y = p.y; // Update pos

        const raySensors = senseFoodRays(p, a);
        bot.sensors = raySensors; // Store for render

        // Normalize Inputs
        const inputs = raySensors.map(r => {
            return r.hit ? (1.0 - r.dist / params.sensorRangeSensors) : 0.0;
        });

        const vel = vehicle.linvel();
        const ang = vehicle.angvel();
        inputs.push(Math.tanh(vel.x / 5.0));
        inputs.push(Math.tanh(vel.y / 5.0));
        inputs.push(Math.tanh(ang / 2.0));

        const outputs = bot.brain.feedForward(inputs);

        // Control: [Steering (-1 to 1), Throttle (0 to 1)]
        const steering = outputs[0]; // -1 Left, 1 Right
        const throttle = (outputs[1] + 1) / 2; // Map -1..1 to 0..1

        bot.throttle = throttle; // Store for visual

        // Differential style mixing for visuals
        bot.lStr = Math.max(0, throttle + steering);
        bot.rStr = Math.max(0, throttle - steering);

        // Apply Forces
        if (throttle > 0.1) {
            const fwd = { x: Math.sin(a) * power * throttle, y: -Math.cos(a) * power * throttle };
            vehicle.applyImpulse(fwd, true);
        }
        vehicle.applyTorqueImpulse(steering * params.steeringStrength, true);

        // Wrapping
        let { x, y } = vehicle.translation();
        if (x > ww / 2) x = -ww / 2; else if (x < -ww / 2) x = ww / 2;
        if (y > wh / 2) y = -wh / 2; else if (y < -wh / 2) y = wh / 2;
        vehicle.setTranslation({ x, y }, true);

        // Eating
        for (let i = foodParticles.length - 1; i >= 0; i--) {
            const f = foodParticles[i];
            const collectRad = Math.max(params.vWidth, params.vHeight) / 2 + FOOD_RADIUS;
            // Simple dist check (no wrap logic for eating locally yet to save perf)
            if (Math.hypot(f.x - x, f.y - y) < collectRad) {
                bot.score += 10;
                foodParticles.splice(i, 1);
                spawnOneFood();
            }
        }

        if (bot.score > maxScore) {
            maxScore = bot.score;
            bestVehicle = bot;
        }
    });

    world.step();

    hud.innerText = `GEN: ${generation} | Time: ${(params.generationTime - elapsed).toFixed(1)}s | Best Score: ${maxScore}`;
}

/* ---------------- RENDERING ---------------- */

function drawFlame(xOffset, yOffset, magnitude) {
    if (magnitude < 0.1) return;
    ctx.save();
    ctx.translate(xOffset * SCALE, yOffset * SCALE);
    const flicker = 0.8 + Math.random() * 0.4;
    const flameLen = params.thrusterSize * magnitude * SCALE * flicker;

    const grad = ctx.createLinearGradient(0, 0, 0, flameLen);
    grad.addColorStop(0, "white"); grad.addColorStop(0.2, "#ffaa00"); grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(-0.12 * SCALE, 0); ctx.quadraticCurveTo(0, flameLen, 0.12 * SCALE, 0); ctx.fill();
    ctx.restore();
}

function drawScene() {
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(params.zoom, params.zoom);

    // Follow Best Vehicle or Center
    const camX = bestVehicle ? bestVehicle.x : 0;
    const camY = bestVehicle ? bestVehicle.y : 0;
    ctx.translate(-camX * SCALE, -camY * SCALE);

    // World Boundary
    ctx.strokeStyle = "#1a3a1a";
    ctx.strokeRect(-params.worldWidth / 2 * SCALE, -params.worldHeight / 2 * SCALE, params.worldWidth * SCALE, params.worldHeight * SCALE);

    // Filtered Food Drawing (Optimized)
    // --- Updated Food Rendering with Wrapping (Ghosts) ---
    const ww = params.worldWidth;
    const wh = params.worldHeight;

    ctx.fillStyle = "#FFD700";
    foodParticles.forEach(f => {
        // Draw Simple, ghosts are expensive fo 50 agents
        ctx.beginPath();
        ctx.arc(f.x * SCALE, f.y * SCALE, FOOD_RADIUS * SCALE, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw Population
    population.forEach(bot => {
        const p = { x: bot.x, y: bot.y };
        const a = bot.rigidBody.rotation();

        ctx.save();
        ctx.translate(p.x * SCALE, p.y * SCALE);
        ctx.rotate(a);

        // Draw Flames (Left and Right)
        // Position at bottom (rear) edge, parallel (pointing down +y)
        const yOff = params.vHeight / 2;
        const xOff = params.vWidth / 4;

        // Left Thruster (-x)
        drawFlame(-xOff, yOff, bot.lStr || 0);

        // Right Thruster (+x)
        drawFlame(xOff, yOff, bot.rStr || 0);

        // Highlight Best
        const isBest = (bot === bestVehicle);

        ctx.fillStyle = isBest ? "#00FF00" : "rgba(100, 100, 100, 0.5)";
        if (isBest) ctx.shadowBlur = 10; ctx.shadowColor = "#00FF00";

        ctx.fillRect(-params.vWidth * SCALE / 2, -params.vHeight * SCALE / 2, params.vWidth * SCALE, params.vHeight * SCALE);
        ctx.shadowBlur = 0;

        ctx.restore();

        // Draw Lifespan Bar (Global Time)
        const elapsed = (Date.now() - genStartTime) / 1000;
        const lifePct = Math.max(0, 1.0 - (elapsed / params.generationTime));

        ctx.save();
        ctx.translate(p.x * SCALE, p.y * SCALE);
        // Do not rotate with ship, keep bar horizontal? No, rotate with ship looks better attached
        ctx.rotate(a);

        const barW = params.vWidth * SCALE;
        const barH = 4;
        const yPos = (params.vHeight * SCALE / 2) + 8; // Below ship

        // Background
        ctx.fillStyle = "red";
        ctx.fillRect(-barW / 2, yPos, barW, barH);

        // Foreground
        ctx.fillStyle = `hsl(${120 * lifePct}, 100%, 50%)`; // Green to Red
        ctx.fillRect(-barW / 2, yPos, barW * lifePct, barH);

        ctx.restore();

        // Draw Sensors for Best Only
        if (isBest && params.showSensors && bot.sensors) {
            bot.sensors.forEach(r => {
                const len = r.hit ? r.dist : params.sensorRangeSensors;
                ctx.strokeStyle = r.hit ? "rgba(0,255,0,0.5)" : "rgba(255,255,255,0.1)";
                ctx.beginPath();
                ctx.moveTo(p.x * SCALE, p.y * SCALE);
                ctx.lineTo((p.x + Math.sin(r.angle) * len) * SCALE, (p.y - Math.cos(r.angle) * len) * SCALE);
                ctx.stroke();
            });
        }
    });

    ctx.restore();

    // Draw Brain on its own canvas
    if (params.showBrain && bestVehicle) {
        drawBrain(nnCtx, bestVehicle.brain);
    } else {
        nnCtx.clearRect(0, 0, nnCanvas.width, nnCanvas.height);
    }

    // Draw Minimap (on separate canvas)
    drawMiniMap(miniCtx, miniCanvas, params, foodParticles, population, bestVehicle);
}

function drawMiniMap(ctx, canvas, params, foodParticles, population, bestVehicle) {
    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const mapSize = canvas.width;

    // Background
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.strokeStyle = "red";
    ctx.lineWidth = 4;
    ctx.fillRect(0, 0, mapSize, mapSize);
    ctx.strokeRect(0, 0, mapSize, mapSize);

    // Scale factor
    const scaleX = mapSize / params.worldWidth;
    const scaleY = mapSize / params.worldHeight;
    const centerX = mapSize / 2;
    const centerY = mapSize / 2;

    // Draw Food
    ctx.fillStyle = "#FFD700";
    foodParticles.forEach(f => {
        const mx = centerX + f.x * scaleX;
        const my = centerY + f.y * scaleY;
        ctx.fillRect(mx - 1, my - 1, 2, 2);
    });

    // Draw Population
    population.forEach(bot => {
        if (bot.isDead) return;
        const p = bot.rigidBody.translation();
        const mx = centerX + p.x * scaleX;
        const my = centerY + p.y * scaleY;

        if (bot === bestVehicle) {
            ctx.fillStyle = "#00FF00";
            ctx.beginPath();
            ctx.arc(mx, my, 4, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.fillStyle = "rgba(200, 200, 200, 0.5)";
            ctx.fillRect(mx - 1, my - 1, 2, 2);
        }
    });
}

function drawBrain(ctx, brain) {
    if (!brain || !brain.levels) return;

    // Clear the specific brain canvas
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const x = 20;
    const y = 20;
    const drawW = w - 40;
    const drawH = h - 40;

    const levelCount = brain.levels.length;

    const totalLayers = levelCount + 1; // Input + N levels of outputs
    const layerStride = drawW / (totalLayers - 1);
    const nodeRadius = 4;

    function getX(layerIndex) { return x + layerIndex * layerStride; }
    function getY(nodeIndex, totalNodes) { return y + (nodeIndex + 0.5) * (drawH / totalNodes); }

    // DRAW WEIGHTS
    for (let l = 0; l < levelCount; l++) {
        const level = brain.levels[l];
        const inputX = getX(l);
        const outputX = getX(l + 1);

        for (let i = 0; i < level.inputs.length; i++) {
            for (let j = 0; j < level.outputs.length; j++) {
                const val = level.weights[i * level.outputs.length + j];
                if (Math.abs(val) < 0.1) continue; // Optimization: Don't draw weak links

                ctx.strokeStyle = val > 0 ? "rgba(0,255,0," + Math.abs(val) + ")" : "rgba(255,0,0," + Math.abs(val) + ")";
                ctx.lineWidth = Math.abs(val); // thinner lines
                ctx.beginPath();
                ctx.moveTo(inputX, getY(i, level.inputs.length));
                ctx.lineTo(outputX, getY(j, level.outputs.length));
                ctx.stroke();
            }
        }
    }

    // DRAW NODES
    // Draw Input Layer
    const firstLevel = brain.levels[0];
    for (let i = 0; i < firstLevel.inputs.length; i++) {
        const val = firstLevel.inputs[i];
        const c = Math.floor((val * 0.5 + 0.5) * 255); // Inputs can be negative now (tanh)
        ctx.fillStyle = `rgb(${c}, ${c}, ${c})`;
        ctx.strokeStyle = "white";
        ctx.beginPath();
        ctx.arc(getX(0), getY(i, firstLevel.inputs.length), nodeRadius, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
    }

    // Draw Output Layers for each Level
    for (let l = 0; l < levelCount; l++) {
        const level = brain.levels[l];
        for (let i = 0; i < level.outputs.length; i++) {
            const val = level.outputs[i];
            const c = Math.floor((val + 1) / 2 * 255);
            ctx.fillStyle = `rgb(${c}, ${c}, ${c})`;
            ctx.strokeStyle = "white";
            ctx.beginPath();
            ctx.arc(getX(l + 1), getY(i, level.outputs.length), nodeRadius, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();

            // Labels for final layer
            if (l === levelCount - 1) {
                ctx.fillStyle = "white";
                ctx.font = "10px monospace";
                ctx.fillText(i === 0 ? "L" : "R", getX(l + 1) + 10, getY(i, level.outputs.length) + 3);
            }
        }
    }
}

function loop() {
    update();
    drawScene();
    requestAnimationFrame(loop);
}

spawnFood();
loop();