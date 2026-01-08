import RAPIER from "https://cdn.skypack.dev/@dimforge/rapier2d-compat";
import { Pane } from "https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js";

await RAPIER.init();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");

/* ---------------- CONSTANTS ---------------- */

const SCALE = 60;
const AI_COUNT = 10;
const GENERATION_FRAMES = 60 * 20;

/* ---------------- STATE ---------------- */

let score = 0;
let generation = 1;
let frameCount = 0;

/* ---------------- RESIZE ---------------- */

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

/* ---------------- PARAMETERS ---------------- */

const params = {
    thrustPower: 0.25,
    turnPower: 0.08,
    worldWidth: 80,
    worldHeight: 80,
    foodCount: 60,
    zoom: 0.8,
    vWidth: 1,
    vHeight: 1,
    sensorRange: 35
};

/* ---------------- UI ---------------- */

const pane = new Pane();
pane.addBinding(params, "zoom", { min: 0.2, max: 2 });

/* ---------------- PHYSICS ---------------- */

const world = new RAPIER.World({ x: 0, y: 0 });

const vehicles = [];
const colliders = [];

/* ---------------- BRAIN CONFIG ---------------- */

const BRAIN_CONFIG = {
    hiddenLayers: [6, 6],
    activation: "tanh"
};

/* ---------------- VEHICLE CREATION ---------------- */

function createVehicle(x, y, brain = null, isPlayer = false) {
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
        brain,
        isPlayer,
        fitness: 0,
        targetFood: null,
        bestVirtualTarget: { x: 0, y: 0 },
        left: false,
        right: false
    });

    colliders.push(collider);
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

/* ---------------- INPUT ---------------- */

const keys = {};
window.addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

/* ---------------- BRAIN INPUTS ---------------- */

function brainInputs(v) {
    if (!v.targetFood) return [0, 0, 0];

    const p = v.body.translation();
    const a = v.body.rotation();

    const dx = v.bestVirtualTarget.x - p.x;
    const dy = v.bestVirtualTarget.y - p.y;

    let angle = Math.atan2(dy, dx) - (a - Math.PI / 2);
    while (angle < -Math.PI) angle += Math.PI * 2;
    while (angle > Math.PI) angle -= Math.PI * 2;

    const dist = Math.min(Math.hypot(dx, dy) / params.sensorRange, 1);

    return [
        angle / Math.PI,
        1 - dist,
        1
    ];
}

/* ---------------- UPDATE VEHICLE ---------------- */

function updateVehicle(v) {
    const body = v.body;
    const p = body.translation();
    const a = body.rotation();

    v.left = v.right = false;
    v.targetFood = null;

    const ww = params.worldWidth;
    const wh = params.worldHeight;

    let minDist = params.sensorRange;

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

    if (v.isPlayer) {
        const fwd = { x: Math.sin(a) * params.thrustPower, y: -Math.cos(a) * params.thrustPower };
        if (keys["w"]) body.applyImpulse(fwd, true);
        if (keys["a"]) body.applyTorqueImpulse(-params.turnPower, true);
        if (keys["d"]) body.applyTorqueImpulse(params.turnPower, true);
    } else if (v.brain && v.targetFood) {
        const [l, r] = v.brain.run(brainInputs(v));

        if (l > 0.5) {
            body.applyTorqueImpulse(-params.turnPower, true);
            v.left = true;
        }
        if (r > 0.5) {
            body.applyTorqueImpulse(params.turnPower, true);
            v.right = true;
        }
        if (l > 0.3 && r > 0.3) {
            body.applyImpulse(
                { x: Math.sin(a) * params.thrustPower, y: -Math.cos(a) * params.thrustPower },
                true
            );
        }
    }

    let { x, y } = p;
    if (x > ww / 2) x = -ww / 2;
    if (x < -ww / 2) x = ww / 2;
    if (y > wh / 2) y = -wh / 2;
    if (y < -wh / 2) y = wh / 2;
    body.setTranslation({ x, y }, true);

    foodParticles = foodParticles.filter(f => {
        if (Math.hypot(f.x - x, f.y - y) < 0.6) {
            v.fitness++;
            if (v.isPlayer) {
                score += 10;
                hud.innerText = `SCORE: ${score} | GEN: ${generation}`;
            }
            return false;
        }
        return true;
    });
}

/* ---------------- EVOLUTION ---------------- */

function evolve() {
    const ai = vehicles.filter(v => !v.isPlayer);
    ai.sort((a, b) => b.fitness - a.fitness);

    const elites = ai.slice(0, 3);
    const brains = [];

    elites.forEach(e => {
        brains.push(e.brain.toJSON());
        brains.push(e.brain.toJSON());
    });

    vehicles.length = 1;
    colliders.forEach(c => world.removeCollider(c, true));
    colliders.length = 0;

    brains.forEach(json => {
        const nn = new brain.NeuralNetwork(BRAIN_CONFIG);
        nn.fromJSON(json);
        nn.mutate(0.1);
        createVehicle(
            (Math.random() - 0.5) * params.worldWidth,
            (Math.random() - 0.5) * params.worldHeight,
            nn
        );
    });

    frameCount = 0;
    generation++;
}

/* ---------------- DRAW ---------------- */

function draw() {
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

    vehicles.forEach(v => {
        const p = v.body.translation();
        const a = v.body.rotation();
        ctx.save();
        ctx.translate(p.x * SCALE, p.y * SCALE);
        ctx.rotate(a);
        ctx.fillStyle = v.isPlayer ? "#4CAF50" : "#3366ff";
        ctx.fillRect(-0.5 * SCALE, -0.5 * SCALE, SCALE, SCALE);
        ctx.restore();
    });

    ctx.restore();
}

/* ---------------- INIT ---------------- */

createVehicle(0, 0, null, true);

for (let i = 0; i < AI_COUNT; i++) {
    createVehicle(
        (Math.random() - 0.5) * params.worldWidth,
        (Math.random() - 0.5) * params.worldHeight,
        new brain.NeuralNetwork(BRAIN_CONFIG)
    );
}

spawnFood();

/* ---------------- LOOP ---------------- */

function loop() {
    vehicles.forEach(updateVehicle);
    world.step();
    spawnFood();
    draw();

    frameCount++;
    if (frameCount > GENERATION_FRAMES) evolve();

    requestAnimationFrame(loop);
}

loop();
