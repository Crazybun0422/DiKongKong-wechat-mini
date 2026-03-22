module.exports = function attachZeldaDog(runtime = {}) {
  const window = runtime.window || runtime || {};
  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  const DOG_LYING = [
    "................................",
    "................................",
    "...............bb...............",
    "............bbbbbbb.............",
    ".........bbbbbbbbbbbbb..........",
    ".......bbbbbbbbbbbbbbbb.........",
    "......bbbwwwwbbbbwwwwbbb........",
    "......bbbwwwwbbbbwwwwbbb........",
    "......bbbbbbbbbbbbbbbbbb........",
    ".......bbbbbbbbbbbbbbbb.........",
    "........bbbbbbbbbbbbbb..........",
    "..........bbbbbbbbbb............",
    ".............bbbb...............",
    "................................",
  ];

  const DOG_BARK = [
    ".................bb.............",
    "..............bbbbbbb...........",
    "...........bbbbbbbbbbbb.........",
    ".........bbbbbbbbbbbbbbbb.......",
    "........bbbwwwwbbbbwwwwbbb......",
    "........bbbwwwwbbbbwwwwbbb......",
    "........bbbbbbbbbbbbbbbbbbb.....",
    "........bbbbbbbbbbbbbbbbbbb.....",
    ".........bbbbbbrrrrbbbbbbb......",
    ".........bbbbbbbbbbbbbbbbb......",
    "...........bb..bb..bb...........",
    "..........bb...bb...bb..........",
    ".........bb....bb....bb.........",
    "................................",
  ];

  function drawPixelSprite(ctx, rows, x, gy, px, colors) {
    const h = rows.length;
    const w = rows[0].length;
    const y0 = gy - h * px;
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x0 = 0; x0 < w; x0++) {
        const k = row[x0];
        if (k === ".") continue;
        const c = colors[k];
        if (!c) continue;
        const sx = x + x0 * px;
        const sy = y0 + y * px;
        ctx.fillStyle = c;
        roundRectPath(ctx, sx, sy, px, px, Math.min(0.6, px * 0.28));
        ctx.fill();
      }
    }
    return { width: w * px, height: h * px };
  }

  function drawBarkMarks(ctx, x, y, px, t) {
    ctx.save();
    ctx.globalAlpha = 0.42 + Math.sin(t * 7.2) * 0.2;
    ctx.strokeStyle = "rgba(255, 215, 168, 0.88)";
    ctx.lineWidth = Math.max(1, px * 0.35);
    for (let i = 0; i < 3; i++) {
      const dx = i * px * 1.9;
      ctx.beginPath();
      ctx.moveTo(x + dx, y - px * (2.0 + i * 0.2));
      ctx.lineTo(x + dx + px * 1.0, y - px * (3.8 + i * 0.25));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawZeldaVillageDog(ctx, opts) {
    const sx = opts.sx || 0;
    const gy = opts.gy || 0;
    const isNight = !!opts.isNight;
    const barking = !!opts.barking;
    const phase = opts.phase || 0;
    const scale = Math.max(0.75, opts.size || 1);
    const px = Math.max(1.05, scale * 1.3);

    const colors = isNight
      ? { b: "#826954", w: "#d6cdbb", r: "#d88c7d" }
      : { b: "#a28267", w: "#f1e6d2", r: "#e97864" };

    const sprite = barking ? DOG_BARK : DOG_LYING;
    const bob = barking ? Math.sin(phase * 10.0) * px * 0.45 : 0;
    const p = drawPixelSprite(ctx, sprite, sx, gy + bob, px, colors);
    if (barking) {
      drawBarkMarks(ctx, sx + p.width * 0.94, gy - p.height * 0.70, px, phase);
    }
    return p;
  }

  window.drawZeldaVillageDog = drawZeldaVillageDog;
  return drawZeldaVillageDog;
};
