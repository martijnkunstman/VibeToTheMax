import RAPIER from "https://cdn.skypack.dev/@dimforge/rapier2d-compat";
import { Pane } from "https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js";

await RAPIER.init();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");

let score = 0;

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
    sensorRange: 35,
    steeringStrength: 0.15,
    showSensors: true,
    thrusterSize: 1.2
};

/* ---------------- TWEAKPANE ---------------- */

const pane = new Pane();
pane.addBinding(params, "zoom", { min: 0.1, max: 2 });
pane.addBinding(params, "autoSteer");
pane.addBinding(params, "autoThrust");

/* ---------------- PHYSICS ---------------- */

const world = new RAPIER.World({ x: 0, y: 0 });

const vehicles = [];
const colliders = [];

function createVehicle(x, y) {
    const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y)
            .setLinearDamping(1.2)
            .setAngularDamping(2.5)
    );

    const collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(params.vWidth / 2, params.vHeight / 2),
        body
    );

    vehicles.push({
        body,
        leftThruster: false,
        rightThruster: false,
        targetFood: null,
        bestVirtualTarget: { x: 0, y: 0 }
    });

    colliders.push(collider);
}

// Player
createVehicle(0, 0);

// +10 AI vehicles
for (let i = 0; i < 10; i++) {
    createVehicle(
        (Math.random() - 0.5) * params.worldWidth,
        (Math.random() - 0.5) * params.worldHeight
    );
}

/* ---------------- FOOD ---------------- */

let foodParticles = [];
function spawnFood() {
    while (foodParticles.length < params.foodCount) {
        foodParticles.push({
            x: (Math.random() - 0.5) * params.worldWidth,
            y: (Math.random() - 0.5) * params.worldHeight
        });
    }
}
spawnFood();

/* ---------------- INPUT ---------------- */

const keys = {};
window.addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

/* ---------------- UPDATE ---------------- */

function updateVehicle(v, isPlayer) {
    const vehicle = v.body;
    const p = vehicle.translation();
    const a = vehicle.rotation();

    v.leftThruster = false;
    v.rightThruster = false;

    let minDist = params.sensorRange;
    v.targetFood = null;

    const ww = params.worldWidth;
    const wh = params.worldHeight;

    foodParticles.forEach(f => {
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const vx = f.x + ox * ww;
                const vy = f.y + oy * wh;
                const d = Math.hypot(vx - p.x, vy - p.y);
                if (d < minDist) {
                    minDist = d;
                    v.targetFood = f;
                    v.bestVirtualTarget = { x: vx, y: vy };
                }
            }
        }
    });

    if (params.autoSteer && v.targetFood) {
        const angleToFood = Math.atan2(
            v.bestVirtualTarget.y - p.y,
            v.bestVirtualTarget.x - p.x
        );

        let diff = (angleToFood + Math.PI / 2) - a;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;

        vehicle.applyTorqueImpulse(diff * params.steeringStrength, true);
        if (diff > 0.1) v.leftThruster = true;
        if (diff < -0.1) v.rightThruster = true;

        if (params.autoThrust && Math.abs(diff) < 0.4) {
            vehicle.applyImpulse(
                { x: Math.sin(a) * params.thrustPower, y: -Math.cos(a) * params.thrustPower },
                true
            );
            v.leftThruster = v.rightThruster = true;
        }
    }

    if (isPlayer) {
        const fwd = { x: Math.sin(a) * params.thrustPower, y: -Math.cos(a) * params.thrustPower };
        if (keys["w"]) vehicle.applyImpulse(fwd, true);
        if (keys["a"]) vehicle.applyTorqueImpulse(-0.1, true);
        if (keys["d"]) vehicle.applyTorqueImpulse(0.1, true);
    }

    let { x, y } = p;
    if (x > ww / 2) x = -ww / 2;
    if (x < -ww / 2) x = ww / 2;
    if (y > wh / 2) y = -wh / 2;
    if (y < -wh / 2) y = wh / 2;
    vehicle.setTranslation({ x, y }, true);

    foodParticles = foodParticles.filter(f => {
        if (Math.hypot(f.x - x, f.y - y) < 0.6) {
            if (isPlayer) {
                score += 10;
                hud.innerText = `SCORE: ${score}`;
            }
            return false;
        }
        return true;
    });
}

/* ---------------- DRAW ---------------- */

function drawScene() {
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cam = vehicles[0].body.translation();

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(params.zoom, params.zoom);
    ctx.translate(-cam.x * SCALE, -cam.y * SCALE);

    ctx.fillStyle = "#FFD700";
    foodParticles.forEach(f => {
        ctx.beginPath();
        ctx.arc(f.x * SCALE, f.y * SCALE, 0.15 * SCALE, 0, Math.PI * 2);
        ctx.fill();
    });

    vehicles.forEach((v, i) => {
        const p = v.body.translation();
        const a = v.body.rotation();

        ctx.save();
        ctx.translate(p.x * SCALE, p.y * SCALE);
        ctx.rotate(a);

        ctx.fillStyle = i === 0 ? "#4CAF50" : "#3366ff";
        ctx.fillRect(
            -params.vWidth * SCALE / 2,
            -params.vHeight * SCALE / 2,
            params.vWidth * SCALE,
            params.vHeight * SCALE
        );
        ctx.restore();
    });

    ctx.restore();

    drawMiniMap(cam, ctx, canvas, params, foodParticles, vehicles[0].targetFood);
}

/* ---------------- LOOP ---------------- */

function loop() {
    vehicles.forEach((v, i) => updateVehicle(v, i === 0));
    world.step();
    spawnFood();
    drawScene();
    requestAnimationFrame(loop);
}

loop();
