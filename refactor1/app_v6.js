import RAPIER from "https://cdn.skypack.dev/@dimforge/rapier2d-compat";
import { Pane } from "https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js";

await RAPIER.init();

// Modified brainState to use Left/Right activations
let brainState = {
    sensors: [],
    leftOut: 0,
    rightOut: 0
};

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");

let score = 0;
let targetFood = null;
let bestVirtualTarget = { x: 0, y: 0 };
let currentCollider = null;

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

const SCALE = 60;
const FOOD_RADIUS = 0.6;

const params = {
    thrustPower: 0.25,
    worldWidth: 80,
    worldHeight: 80,
    foodCount: 60,
    zoom: 0.8,
    vWidth: 1.0,
    vHeight: 1.0,
    autoPilot: true,
    sensorRange: 25,
    steeringStrength: 0.15,
    showSensors: true,
    thrusterSize: 1.2,
    sensorCount: 7,
    sensorAngle: Math.PI / 2, 
    sensorRangeSensors: 10
};

/* ---------------- TWEAKPANE ---------------- */
const pane = new Pane();
const worldPane = pane.addFolder({ title: "World" });
worldPane.addBinding(params, "zoom", { min: 0.1, max: 2.0 });

const aiPane = pane.addFolder({ title: "Differential AI" });
aiPane.addBinding(params, "autoPilot", { label: "Auto Pilot" });
aiPane.addBinding(params, "steeringStrength", { min: 0.01, max: 0.5 });

const visualPane = pane.addFolder({ title: "Visuals" });
visualPane.addBinding(params, "showSensors");

/* ---------------- PHYSICS ---------------- */
const world = new RAPIER.World({ x: 0, y: 0 });
const vehicle = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 0)
        .setLinearDamping(1.2)
        .setAngularDamping(2.5)
);

function updateCollider() {
    if (currentCollider) world.removeCollider(currentCollider, true);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(params.vWidth / 2, params.vHeight / 2);
    currentCollider = world.createCollider(colliderDesc, vehicle);
}
updateCollider();

let foodParticles = [];
function spawnFood() {
    while (foodParticles.length < params.foodCount) {
        foodParticles.push({
            x: (Math.random() - 0.5) * params.worldWidth,
            y: (Math.random() - 0.5) * params.worldHeight
        });
    }
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
        const dir = { x: Math.sin(rayAngle), y: -Math.cos(rayAngle) };

        let closest = null;
        let minDist = params.sensorRangeSensors;

        foodParticles.forEach(f => {
            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    const fx = f.x + ox * ww;
                    const fy = f.y + oy * wh;
                    const dx = fx - position.x;
                    const dy = fy - position.y;
                    const proj = dx * dir.x + dy * dir.y;
                    if (proj < 0 || proj > params.sensorRangeSensors) continue;
                    const perp = Math.abs(dx * -dir.y + dy * dir.x);
                    if (perp < FOOD_RADIUS && proj < minDist) {
                        minDist = proj;
                        closest = { x: fx, y: fy };
                    }
                }
            }
        });
        hits.push({ angle: rayAngle, hit: closest, dist: minDist });
    }
    return hits;
}

function update() {
    const p = vehicle.translation();
    const a = vehicle.rotation();
    const power = params.thrustPower;
    const ww = params.worldWidth;
    const wh = params.worldHeight;

    const raySensors = senseFoodRays(p, a);
    brainState.sensors = raySensors.map(r => 1.0 - Math.min(r.dist, params.sensorRangeSensors) / params.sensorRangeSensors);

    // 1. Target Finder
    targetFood = null;
    let minDist = params.sensorRange;
    foodParticles.forEach(f => {
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const vx = f.x + ox * ww;
                const vy = f.y + oy * wh;
                const d = Math.hypot(vx - p.x, vy - p.y);
                if (d < minDist) { minDist = d; targetFood = f; bestVirtualTarget = { x: vx, y: vy }; }
            }
        }
    });

    // 2. Differential Logic
    let leftOut = 0;
    let rightOut = 0;

    if (params.autoPilot && targetFood) {
        const angleToFood = Math.atan2(bestVirtualTarget.y - p.y, bestVirtualTarget.x - p.x);
        let diff = (angleToFood + Math.PI / 2) - a;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;

        // Differential mapping
        if (diff > 0.1) leftOut = 1;      // Turn Right (fire left)
        if (diff < -0.1) rightOut = 1;    // Turn Left (fire right)
        if (Math.abs(diff) < 0.5) {       // Forward
            leftOut = 1; 
            rightOut = 1; 
        }
    }

    // Manual Overrides
    if (keys["w"]) { leftOut = 1; rightOut = 1; }
    if (keys["a"]) { rightOut = 1; leftOut = 0; }
    if (keys["d"]) { leftOut = 1; rightOut = 0; }

    brainState.leftOut = leftOut;
    brainState.rightOut = rightOut;

    // Apply Physics based on Differential Thrust
    const fwdVec = { x: Math.sin(a) * power, y: -Math.cos(a) * power };
    if (leftOut && rightOut) {
        vehicle.applyImpulse(fwdVec, true);
    } else if (leftOut) {
        vehicle.applyTorqueImpulse(params.steeringStrength, true);
        vehicle.applyImpulse({ x: fwdVec.x * 0.5, y: fwdVec.y * 0.5 }, true);
    } else if (rightOut) {
        vehicle.applyTorqueImpulse(-params.steeringStrength, true);
        vehicle.applyImpulse({ x: fwdVec.x * 0.5, y: fwdVec.y * 0.5 }, true);
    }

    world.step();

    // Wrapping
    let { x, y } = vehicle.translation();
    if (x > ww / 2) x = -ww / 2; else if (x < -ww / 2) x = ww / 2;
    if (y > wh / 2) y = -wh / 2; else if (y < -wh / 2) y = wh / 2;
    vehicle.setTranslation({ x, y }, true);

    // Collection
    foodParticles = foodParticles.filter(f => {
        if (Math.hypot(f.x - x, f.y - y) < 1.2) { score += 10; hud.innerText = `SCORE: ${score}`; return false; }
        return true;
    });
    spawnFood();

    // Render Brain
    let nncanvas = document.getElementById("nnCanvas");
    if (nncanvas) drawBrainOverlay(nncanvas.getContext("2d"), nncanvas, brainState);
}

/* ---------------- RENDERING ---------------- */
function drawFlame(xOffset, yOffset) {
    ctx.save();
    ctx.translate(xOffset * SCALE, yOffset * SCALE);
    const flicker = 0.8 + Math.random() * 0.4;
    const grad = ctx.createLinearGradient(0, 0, 0, params.thrusterSize * SCALE * flicker);
    grad.addColorStop(0, "white"); grad.addColorStop(0.2, "#ffaa00"); grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(-0.12 * SCALE, 0); ctx.quadraticCurveTo(0, params.thrusterSize * SCALE * flicker, 0.12 * SCALE, 0); ctx.fill();
    ctx.restore();
}

function drawScene() {
    const p = vehicle.translation();
    const a = vehicle.rotation();

    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(params.zoom, params.zoom);
    ctx.translate(-p.x * SCALE, -p.y * SCALE);

    // Food
    ctx.fillStyle = "#FFD700";
    foodParticles.forEach(f => {
        ctx.beginPath(); ctx.arc(f.x * SCALE, f.y * SCALE, FOOD_RADIUS * SCALE, 0, Math.PI * 2); ctx.fill();
    });

    // Ship
    ctx.save();
    ctx.translate(p.x * SCALE, p.y * SCALE);
    ctx.rotate(a);
    if (brainState.leftOut) drawFlame(-params.vWidth * 0.4, params.vHeight / 2);
    if (brainState.rightOut) drawFlame(params.vWidth * 0.4, params.vHeight / 2);
    ctx.fillStyle = "#4CAF50";
    ctx.fillRect(-params.vWidth * SCALE / 2, -params.vHeight * SCALE / 2, params.vWidth * SCALE, params.vHeight * SCALE);
    ctx.restore();

    ctx.restore();
}

/* ================= BRAIN VISUALIZATION (DIFFERENTIAL) ================= */
/* ================= BRAIN VISUALIZATION (OPTIMIZED FOR 360x240) ================= */
/* ================= BRAIN VISUALIZATION (FULL DEPTH) ================= */
function drawBrainOverlay(ctx, canvas, brain) {
    const w = 360;
    const h = 240;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    // Layer X positions
    const layerX = [w * 0.15, w * 0.5, w * 0.75];
    
    const inputs = brain.sensors;
    const hiddenCount = 6;
    const outputs = [brain.leftOut, brain.rightOut];
    const outputLabels = ["LEFT", "RIGHT"];

    // Helper: Dynamic vertical spacing
    const getY = (i, count, space) => (h / 2) - ((count - 1) * space / 2) + (i * space);

    // 1. Calculate Simulated Hidden Activations 
    // This makes the middle layer "react" to the sensors visually
    const hiddenActivations = [];
    for (let i = 0; i < hiddenCount; i++) {
        // Simple average of a subset of sensors to simulate a "thought" process
        const sample = inputs[i % inputs.length] || 0;
        hiddenActivations.push(sample * 0.8 + (Math.random() * 0.2)); 
    }

    // 2. Draw Connections (Synapses)
    ctx.lineWidth = 1;
    
    // Input to Hidden
    inputs.forEach((v, i) => {
        const y1 = getY(i, inputs.length, 22);
        hiddenActivations.forEach((hv, j) => {
            const y2 = getY(j, hiddenCount, 32);
            ctx.strokeStyle = `rgba(0, 255, 120, ${0.02 + (v * hv) * 0.3})`;
            ctx.beginPath();
            ctx.moveTo(layerX[0], y1);
            ctx.lineTo(layerX[1], y2);
            ctx.stroke();
        });
    });

    // Hidden to Output
    hiddenActivations.forEach((hv, i) => {
        const y1 = getY(i, hiddenCount, 32);
        outputs.forEach((v, j) => {
            const y2 = getY(j, outputs.length, 80);
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.02 + (hv * v) * 0.5})`;
            ctx.beginPath();
            ctx.moveTo(layerX[1], y1);
            ctx.lineTo(layerX[2], y2);
            ctx.stroke();
        });
    });

    // 3. Helper to draw a stylized node
    const drawNode = (x, y, activation, colorRGB, size = 6) => {
        const alpha = 0.2 + activation * 0.8;
        ctx.shadowBlur = activation * 8;
        ctx.shadowColor = `rgba(${colorRGB}, ${alpha})`;
        
        ctx.fillStyle = `rgba(${colorRGB}, ${alpha})`;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + activation * 0.7})`;
        ctx.lineWidth = 1.5;
        
        ctx.beginPath();
        ctx.arc(x, y, size + activation * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0; // reset for next node
    };

    // 4. Draw Input Nodes (Green)
    inputs.forEach((v, i) => {
        drawNode(layerX[0], getY(i, inputs.length, 22), v, "0, 255, 120", 4);
    });

    // 5. Draw Hidden Nodes (Blue-ish / Cyan)
    hiddenActivations.forEach((hv, i) => {
        drawNode(layerX[1], getY(i, hiddenCount, 32), hv, "0, 190, 255", 6);
    });

    // 6. Draw Output Nodes (Orange)
    outputs.forEach((v, i) => {
        const y = getY(i, outputs.length, 80);
        drawNode(layerX[2], y, v, "255, 165, 0", 10);
        
        // Label
        ctx.fillStyle = v > 0 ? "white" : "#666";
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "left";
        ctx.fillText(outputLabels[i], layerX[2] + 18, y + 4);
    });

    ctx.restore();
}
function loop() {
    update();
    drawScene();
    requestAnimationFrame(loop);
}

spawnFood();
loop();