import RAPIER from "https://cdn.skypack.dev/@dimforge/rapier2d-compat";
import { Pane } from "https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js";

await RAPIER.init();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");

let score = 0;
let targetFood = null;
let bestVirtualTarget = { x: 0, y: 0 };
let leftThrusterActive = false;
let rightThrusterActive = false;
let currentCollider = null;

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

const SCALE = 60;

/* ---------------- PARAMETERS ---------------- */

const params = {
    thrustPower: 0.25,
    turnThrustMult: 0.4,
    worldWidth: 80,
    worldHeight: 80,
    foodCount: 60,
    zoom: 0.8,
    vWidth: 1.0,
    vHeight: 1.0,
    autoSteer: true,
    autoThrust: true,
    sensorRange: 25,
    steeringStrength: 0.15,
    showSensors: true,
    thrusterSize: 1.2,
    //
    sensorCount: 7,
    sensorAngle: Math.PI / 2, // total cone angle
    sensorRangeSensors: 10
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
visualPane.addBinding(params, "thrusterSize", { min: 0.5, max: 4.0 });

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

        let closest = null;
        let minDist = params.sensorRangeSensors;

        foodParticles.forEach(f => {
            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    const fx = f.x + ox * ww;
                    const fy = f.y + oy * wh;

                    const dx = fx - position.x;
                    const dy = fy - position.y;

                    const proj = dx * Math.cos(rayAngle) + dy * Math.sin(rayAngle);
                    if (proj < 0 || proj > params.sensorRangeSensors) return;

                    const perp = Math.abs(
                        -dx * Math.sin(rayAngle) + dy * Math.cos(rayAngle)
                    );

                    if (perp < 0.4 && proj < minDist) {
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
    const p = vehicle.translation();
    const a = vehicle.rotation();
    const power = params.thrustPower;
    const ww = params.worldWidth;
    const wh = params.worldHeight;

    const raySensors = senseFoodRays(p, a - Math.PI / 2);

    leftThrusterActive = false;
    rightThrusterActive = false;

    // 1. TOROIDAL SENSOR LOGIC
    targetFood = null;
    let minDist = params.sensorRange;

    foodParticles.forEach(f => {
        // Check 9 "virtual" wrap-around positions for the shortest path
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const vx = f.x + ox * ww;
                const vy = f.y + oy * wh;
                const d = Math.hypot(vx - p.x, vy - p.y);

                if (d < minDist) {
                    minDist = d;
                    targetFood = f;
                    bestVirtualTarget = { x: vx, y: vy };
                }
            }
        }
    });

    // 2. AI STEERING TO VIRTUAL TARGET
    if (params.autoSteer && targetFood) {
        const angleToFood = Math.atan2(bestVirtualTarget.y - p.y, bestVirtualTarget.x - p.x);
        let diff = (angleToFood + Math.PI / 2) - a;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;

        vehicle.applyTorqueImpulse(diff * params.steeringStrength, true);
        if (diff > 0.1) leftThrusterActive = true;
        if (diff < -0.1) rightThrusterActive = true;

        if (params.autoThrust && Math.abs(diff) < 0.4) {
            const fwd = { x: Math.sin(a) * power, y: -Math.cos(a) * power };
            vehicle.applyImpulse(fwd, true);
            leftThrusterActive = true; rightThrusterActive = true;
        }
    }

    // 3. MANUAL INPUTS
    const fwdVec = { x: Math.sin(a) * power, y: -Math.cos(a) * power };
    if (keys["w"]) { vehicle.applyImpulse(fwdVec, true); leftThrusterActive = true; rightThrusterActive = true; }
    if (keys["a"]) { vehicle.applyTorqueImpulse(-0.1, true); vehicle.applyImpulse({ x: fwdVec.x * params.turnThrustMult, y: fwdVec.y * params.turnThrustMult }, true); rightThrusterActive = true; }
    if (keys["d"]) { vehicle.applyTorqueImpulse(0.1, true); vehicle.applyImpulse({ x: fwdVec.x * params.turnThrustMult, y: fwdVec.y * params.turnThrustMult }, true); leftThrusterActive = true; }

    world.step();

    // 4. WRAPPING & COLLECTION
    let { x, y } = vehicle.translation();
    if (x > ww / 2) x = -ww / 2; else if (x < -ww / 2) x = ww / 2;
    if (y > wh / 2) y = -wh / 2; else if (y < -wh / 2) y = wh / 2;
    vehicle.setTranslation({ x, y }, true);

    foodParticles = foodParticles.filter(f => {
        const collectRad = Math.max(params.vWidth, params.vHeight) / 2 + 0.4;
        if (Math.hypot(f.x - x, f.y - y) < collectRad) {
            score += 10; hud.innerText = `SCORE: ${score}`; return false;
        }
        return true;
    });
    spawnFood();
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

    // World Boundary
    ctx.strokeStyle = "#1a3a1a";
    ctx.strokeRect(-params.worldWidth / 2 * SCALE, -params.worldHeight / 2 * SCALE, params.worldWidth * SCALE, params.worldHeight * SCALE);

    // Sensor Line (Toroidal aware)
    if (params.showSensors && targetFood) {
        ctx.setLineDash([8, 8]); ctx.strokeStyle = "rgba(0, 255, 255, 0.4)";
        ctx.beginPath(); ctx.moveTo(p.x * SCALE, p.y * SCALE); ctx.lineTo(bestVirtualTarget.x * SCALE, bestVirtualTarget.y * SCALE); ctx.stroke(); ctx.setLineDash([]);

        ctx.strokeStyle = "cyan";
        ctx.strokeRect((bestVirtualTarget.x - 0.3) * SCALE, (bestVirtualTarget.y - 0.3) * SCALE, 0.6 * SCALE, 0.6 * SCALE);
    }

    // --- Updated Food Rendering with Wrapping (Ghosts) ---
    const ww = params.worldWidth;
    const wh = params.worldHeight;

    ctx.fillStyle = "#FFD700";
    foodParticles.forEach(f => {
        // 1. Draw the primary food particle
        ctx.beginPath();
        ctx.arc(f.x * SCALE, f.y * SCALE, 0.15 * SCALE, 0, Math.PI * 2);
        ctx.fill();

        // 2. Draw "Ghost" particles if food is near an edge
        // We check 8 neighbor offsets to see if a ghost should appear in the visible bounds
        const drawGhost = (ox, oy) => {
            ctx.globalAlpha = 0.8; // Make ghosts slightly transparent
            //ctx.globalAlpha = 1; // Make ghosts slightly transparent

            ctx.beginPath();
            ctx.arc((f.x + ox * ww) * SCALE, (f.y + oy * wh) * SCALE, 0.15 * SCALE, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1.0;
        };

        // Only draw ghosts if the ship is close enough to the border to see them 
        // or just draw all 8 neighbors for a truly seamless look:
        //if (Math.abs(f.x) > ww / 2 - 5 || Math.abs(f.y) > wh / 2 - 5) {
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                if (ox === 0 && oy === 0) continue; // Skip the primary one we already drew
                drawGhost(ox, oy);
            }
        }
        //}
    });

    // --- Raycast Sensors ---
    if (params.showSensors) {
        const rays = senseFoodRays(p, a - Math.PI / 2);

        rays.forEach(r => {
            const len = r.hit ? r.dist : params.sensorRangeSensors;
            const alpha = 1.0 - len / params.sensorRangeSensors;
            //const alpha = 1;

            ctx.strokeStyle = r.hit
                ? `rgba(0,255,0,${0.8 * alpha})`
                : `rgba(0,255,0,${0.25 * alpha})`;

            //ctx.strokeStyle = `rgba(0, 255, 0, ${alpha})`;

            ctx.beginPath();
            ctx.moveTo(p.x * SCALE, p.y * SCALE);
            ctx.lineTo(
                (p.x + Math.cos(r.angle) * len) * SCALE,
                (p.y + Math.sin(r.angle) * len) * SCALE
            );
            ctx.stroke();
        });
    }


    // Ship
    ctx.save();
    ctx.translate(p.x * SCALE, p.y * SCALE);
    ctx.rotate(a);

    const tx = params.vWidth * 0.35;
    const ty = params.vHeight / 2;
    if (leftThrusterActive) drawFlame(-tx, ty);
    if (rightThrusterActive) drawFlame(tx, ty);

    ctx.fillStyle = "#4CAF50";
    ctx.fillRect(-params.vWidth * SCALE / 2, -params.vHeight * SCALE / 2, params.vWidth * SCALE, params.vHeight * SCALE);
    ctx.fillStyle = "#222";
    ctx.fillRect(-params.vWidth * 0.3 * SCALE, -params.vHeight * 0.4 * SCALE, params.vWidth * 0.6 * SCALE, params.vHeight * 0.3 * SCALE);
    ctx.restore();

    ctx.restore();

    drawMiniMap(p, ctx, canvas, params, foodParticles, targetFood);
}



function loop() {
    update();
    drawScene();
    requestAnimationFrame(loop);
}

spawnFood();
loop();