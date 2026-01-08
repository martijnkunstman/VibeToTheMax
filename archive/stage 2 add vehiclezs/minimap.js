function drawMiniMap(vPos, ctx, canvas, params, foodParticles, targetFood) {
    const mapSize = 180; const pad = 20;
    ctx.save();
    ctx.translate(canvas.width - mapSize - pad, pad);
    ctx.fillStyle = "rgba(0, 40, 0, 0.8)"; ctx.fillRect(0, 0, mapSize, mapSize);
    ctx.strokeStyle = "#00ffcc"; ctx.strokeRect(0, 0, mapSize, mapSize);

    const sx = mapSize / params.worldWidth; const sy = mapSize / params.worldHeight;
    const ox = params.worldWidth / 2; const oy = params.worldHeight / 2;

    // Food & Target on map
    foodParticles.forEach(f => {
        ctx.fillStyle = (f === targetFood) ? "cyan" : "#FFD700";
        ctx.fillRect((f.x + ox) * sx - 1, (f.y + oy) * sy - 1, 2, 2);
    });

    // Player
    ctx.fillStyle = "white";
    ctx.beginPath(); ctx.arc((vPos.x + ox) * sx, (vPos.y + oy) * sy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}