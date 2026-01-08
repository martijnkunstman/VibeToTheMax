import RAPIER from "https://cdn.skypack.dev/@dimforge/rapier2d-compat";

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

await RAPIER.init();

// --- Physics world ---
const gravity = { x: 0, y: 9.8 };
const world = new RAPIER.World(gravity);

// --- Ground ---
const groundBody = world.createRigidBody(
  RAPIER.RigidBodyDesc.fixed().setTranslation(400, 480)
);
world.createCollider(
  RAPIER.ColliderDesc.cuboid(400, 10),
  groundBody
);

// --- Store bodies for rendering ---
const boxes = [];

// --- Spawn boxes ---
function spawnBox(x, y) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y)
  );

  const collider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(15, 15)
      .setRestitution(0.4),
    body
  );

  boxes.push({ body, size: 30 });
}

// --- Mouse interaction ---
canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  spawnBox(e.clientX - rect.left, e.clientY - rect.top);
});

// --- Render loop ---
function loop() {
  world.step();

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw ground
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(0, 470, 800, 20);

  // Draw boxes
  ctx.fillStyle = "#eab308";
  for (const box of boxes) {
    const pos = box.body.translation();
    const rot = box.body.rotation();

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(rot);
    ctx.fillRect(-15, -15, box.size, box.size);
    ctx.restore();
  }

  requestAnimationFrame(loop);
}

loop();
