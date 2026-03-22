module.exports = function attachRuralHouse(runtime = {}) {
  const window = runtime.window || runtime || {};
  const document = runtime.document || {};
  const performance = runtime.performance || globalThis.performance || { now: () => Date.now() };
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function seeded01(n) {
    const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
  }

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

  // Zelda-like pixel palettes.
  function palette(isNight) {
    if (isNight) {
      return {
        R: "#6f4c42", r: "#5b3f38", // roof
        W: "#a08a6b", w: "#8c785e", // wood/plaster walls
        S: "#9099a6", s: "#727d8b", // stone
        D: "#5a4334",               // door
        L: "#f2d38f",               // lit window
        G: "#4f6f52",               // vine/grass accents
        C: "#6e6154",               // chimney
        B: "#3b2f28",               // beam/frame
      };
    }
    return {
      R: "#b06a54", r: "#8f4f41",
      W: "#d8bf96", w: "#b99f7a",
      S: "#b9c1cb", s: "#939fab",
      D: "#8f6545",
      L: "#cfe9ff",
      G: "#7ea66f",
      C: "#9d846d",
      B: "#6b513d",
    };
  }

  // 5+ Zelda-style house sprites (pixel templates).
  // '.' means transparent pixel.
  const HOUSE_SPRITES = [
    {
      name: "kokiri_hut",
      rows: [
        "...........RRR...........",
        ".........RRRRRRR.........",
        ".......RRRRRRRRRRR.......",
        ".....RRRRRRRRRRRRRRR.....",
        "....RRRRRRrrrrrRRRRRR....",
        "....RRRrrrrrrrrrrrRRR....",
        "...WWWWWWWWWWWWWWWWWWW...",
        "...WWWWBWWWWWWWWWBWWWW...",
        "...WWWWWWWWWWWWWWWWWWW...",
        "...WWWWWWWWLLLLWWWWWWW...",
        "...WWWWWWWWLLLLWWWWWWW...",
        "...WWWWWWWWWWWWWWWWWWW...",
        "...WWWWWDDDDDDDDWWWWWW...",
        "...WWWWWDDDDDDDDWWWWWW...",
        "...WWWWWDDDDDDDDWWWWWW...",
        "...GGGGGGGGGGGGGGGGGGG...",
      ],
    },
    {
      name: "hyrule_cottage",
      rows: [
        "............CC............",
        "............CC............",
        ".........RRRRRRRR.........",
        ".......RRRRRRRRRRRR.......",
        ".....RRRRRRRRRRRRRRRR.....",
        "....RRRRrrrrrrrrrrRRRR....",
        "...RRRrrrrrrrrrrrrrrRRR...",
        "...WWWWWWWWWWWWWWWWWWWW...",
        "...WWWWWBWWWWWWWWBWWWWW...",
        "...WWWWWLLLL..LLLLWWWWW...",
        "...WWWWWLLLL..LLLLWWWWW...",
        "...WWWWWWWWWWWWWWWWWWWW...",
        "...WWWWWWDDDDDDDDWWWWWW...",
        "...WWWWWWDDDDDDDDWWWWWW...",
        "...WWWWWWDDDDDDDDWWWWWW...",
        "...GGGGGGGGGGGGGGGGGGGG...",
      ],
    },
    {
      name: "stone_home",
      rows: [
        "..........RRRRRR..........",
        "........RRRRRRRRRR........",
        "......RRRRRRRRRRRRRR......",
        ".....RRRRRrrrrrrRRRRR.....",
        "....RRRRrrrrrrrrrrRRRR....",
        "....SSSSSSSSSSSSSSSSSS....",
        "....SSSSSSSSSSSSSSSSSS....",
        "....SSSSBSSSSSSSSBSSSS....",
        "....SSSSSSLLLLLLSSSSSS....",
        "....SSSSSSLLLLLLSSSSSS....",
        "....SSSSSSSSSSSSSSSSSS....",
        "....SSSSSSDDDDDDSSSSSS....",
        "....SSSSSSDDDDDDSSSSSS....",
        "....SSSSSSDDDDDDSSSSSS....",
        "....SSSSSSSSSSSSSSSSSS....",
        "....GGGGGGGGGGGGGGGGGG....",
      ],
    },
    {
      name: "lonlon_barn",
      rows: [
        "...........RRRRR...........",
        ".........RRRRRRRRR.........",
        ".......RRRRRRRRRRRRR.......",
        ".....RRRRRRRRRRRRRRRRR.....",
        "....RRRRRrrrrrrrrrRRRRR....",
        "...WWWWWWWWWWWWWWWWWWWWW...",
        "...WWWWWWWWWWWWWWWWWWWWW...",
        "...WWWWBBBBBBBBBBBBBWWWW...",
        "...WWWWWWWWWWWWWWWWWWWWW...",
        "...WWWWWWLLLL..LLLLWWWWW...",
        "...WWWWWWLLLL..LLLLWWWWW...",
        "...WWWWWWWWWWWWWWWWWWWWW...",
        "...WWWWWWWDDDDDDDDWWWWWW...",
        "...WWWWWWWDDDDDDDDWWWWWW...",
        "...WWWWWWWDDDDDDDDWWWWWW...",
        "...GGGGGGGGGGGGGGGGGGGGG...",
      ],
    },
    {
      name: "watch_tower_house",
      rows: [
        "............CC............",
        "............CC............",
        "............CC............",
        "..........RRRRRR..........",
        "........RRRRRRRRRR........",
        ".......RRRRrrrrRRRR.......",
        "......SSSSSSSSSSSSSS......",
        "......SSSSSSSSSSSSSS......",
        "......SSSSBSSSSBSSSS......",
        "......SSSSSSLLLLSSSS......",
        "......SSSSSSLLLLSSSS......",
        "......SSSSSSSSSSSSSS......",
        "......SSSSSDDDDDDSSSS......",
        "......SSSSSDDDDDDSSSS......",
        "......SSSSSDDDDDDSSSS......",
        "......GGGGGGGGGGGGGG......",
      ],
    },
    {
      name: "dual_roof_inn",
      rows: [
        ".....RRRRRR.........RRRRRR.....",
        "...RRRRRRRRRR.....RRRRRRRRRR...",
        "..RRRRrrrrRRRR...RRRRrrrrRRRR..",
        ".WWWWWWWWWWWWWWWWWWWWWWWWWWWWW.",
        ".WWWWWBWWWWWWWWWWWWWWBWWWWWWWW.",
        ".WWWWWWWWWWLLLLLLLLWWWWWWWWWWW.",
        ".WWWWWWWWWWLLLLLLLLWWWWWWWWWWW.",
        ".WWWWWWWWWWWWWWWWWWWWWWWWWWWWW.",
        ".WWWWWWWWDDDDDDDDDDDDWWWWWWWWW.",
        ".WWWWWWWWDDDDDDDDDDDDWWWWWWWWW.",
        ".WWWWWWWWDDDDDDDDDDDDWWWWWWWWW.",
        ".GGGGGGGGGGGGGGGGGGGGGGGGGGGGG.",
      ],
    },
  ];

  function upsampleRows(rows, factor) {
    const out = [];
    for (const row of rows) {
      const expanded = row.split("").map(ch => ch.repeat(factor)).join("");
      for (let i = 0; i < factor; i++) out.push(expanded);
    }
    return out;
  }

  const HOUSE_SPRITES_HI = HOUSE_SPRITES.map(s => ({
    name: s.name,
    rows: upsampleRows(s.rows, 2),
  }));
  const SPRITE_CACHE = new Map();

  function spriteBounds(sprite) {
    const h = sprite.rows.length;
    const w = sprite.rows[0].length;
    let minX = w, maxX = -1, minY = h, maxY = -1;
    for (let y = 0; y < h; y++) {
      const row = sprite.rows[y];
      for (let x = 0; x < w; x++) {
        if (row[x] === ".") continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX || maxY < minY) return { minX: 0, maxX: 0, minY: 0, maxY: 0, w: 1, h: 1 };
    return { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function drawPixelCell(ctx, x, y, px, color) {
    ctx.fillStyle = color;
    if (px >= 1.1) {
      const r = Math.min(0.7, px * 0.22);
      roundRectPath(ctx, x, y, px, px, r);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, px, px);
    }
  }

  function spriteCacheKey(typeId, px, isNight) {
    return `${typeId}|${isNight ? 1 : 0}|${px.toFixed(2)}`;
  }

  function buildSpriteBitmap(sprite, px, colors) {
    const b = spriteBounds(sprite);
    const w = Math.max(1, Math.ceil(b.w * px));
    const h = Math.max(1, Math.ceil(b.h * px));
    const cv = typeof document.createElement === "function"
      ? document.createElement("canvas")
      : null;
    if (!cv) {
      return {
        canvas: null,
        width: 1,
        height: 1,
        chimneyX: null,
        chimneyY: null
      };
    }
    cv.width = w;
    cv.height = h;
    const c2 = cv.getContext("2d");
    if (!c2) {
      return {
        canvas: null,
        width: w,
        height: h,
        chimneyX: null,
        chimneyY: null
      };
    }
    let chimneyCount = 0;
    let chimneyX = 0;
    let chimneyY = 1e9;

    for (let yy = b.minY; yy <= b.maxY; yy++) {
      const row = sprite.rows[yy];
      for (let xx = b.minX; xx <= b.maxX; xx++) {
        const key = row[xx];
        if (key === ".") continue;
        const color = colors[key];
        if (!color) continue;
        const pxX = Math.round((xx - b.minX) * px);
        const pxY = Math.round((yy - b.minY) * px);
        drawPixelCell(c2, pxX, pxY, px, color);
        // Pixel-level highlight/shadow for richer retro detail.
        if (px >= 1.1) {
          c2.fillStyle = "rgba(255,255,255,0.10)";
          c2.fillRect(pxX, pxY, px, Math.max(0.65, px * 0.20));
          c2.fillStyle = "rgba(0,0,0,0.10)";
          c2.fillRect(pxX, pxY + px * 0.78, px, Math.max(0.65, px * 0.20));
        }
        if (key === "C") {
          chimneyCount += 1;
          chimneyX += pxX + px * 0.5;
          chimneyY = Math.min(chimneyY, pxY);
        }
      }
    }

    return {
      canvas: cv,
      width: w,
      height: h,
      chimneyX: chimneyCount > 0 ? (chimneyX / chimneyCount) : null,
      chimneyY: chimneyCount > 0 ? chimneyY : null,
    };
  }

  function drawPixelSprite(ctx, typeId, sprite, x, gy, px, colors, isNight) {
    const key = spriteCacheKey(typeId, px, isNight);
    let bm = SPRITE_CACHE.get(key);
    if (!bm) {
      bm = buildSpriteBitmap(sprite, px, colors);
      SPRITE_CACHE.set(key, bm);
    }
    const baseY = gy - bm.height;
    if (bm.canvas) {
      ctx.drawImage(bm.canvas, Math.round(x), Math.round(baseY));
    }
    return {
      width: bm.width,
      height: bm.height,
      chimneyX: bm.chimneyX != null ? Math.round(x) + bm.chimneyX : null,
      chimneyY: bm.chimneyY != null ? Math.round(baseY) + bm.chimneyY : null,
    };
  }

  function drawSmoke(ctx, x, y, px, isNight, seed) {
    const t = performance.now() * 0.0012;
    for (let i = 0; i < 2; i++) {
      const phase = (t * 0.52 + i * 0.19 + seeded01(seed + i * 37)) % 1;
      const rise = phase * phase;
      const drift = Math.sin((t + i * 0.7) * 2.0 + seed * 0.01) * (px * 0.9 + rise * px * 1.4);
      const cx = x + drift;
      const cy = y - rise * px * (10 + i * 2);
      const s = px * (0.55 + rise * 0.95);
      const alpha = (1 - phase) * (isNight ? 0.36 : 0.30);
      const smokeColor = isNight ? `rgba(214,222,240,${alpha})` : `rgba(214,220,228,${alpha})`;
      ctx.fillStyle = smokeColor;
      ctx.fillRect(cx, cy, s, s);
      ctx.fillRect(cx + s * 0.48, cy - s * 0.25, s * 0.68, s * 0.68);
      ctx.fillRect(cx - s * 0.42, cy + s * 0.16, s * 0.56, s * 0.56);
    }
  }

  function drawFence(ctx, x, gy, span, px, isNight, groundYAtOffset) {
    ctx.strokeStyle = isNight ? "rgba(112,100,90,0.78)" : "rgba(154,131,108,0.82)";
    ctx.lineWidth = Math.max(1, px * 0.32);
    ctx.beginPath();
    const step = Math.max(6, px * 2.2);
    for (let p = 0; p <= span; p += step) {
      const gyi = typeof groundYAtOffset === "function" ? groundYAtOffset(p) : gy;
      ctx.moveTo(x + p, gyi - 1);
      ctx.lineTo(x + p, gyi - px * 1.8);
    }
    const gy0 = typeof groundYAtOffset === "function" ? groundYAtOffset(0) : gy;
    const gy1 = typeof groundYAtOffset === "function" ? groundYAtOffset(span) : gy;
    ctx.moveTo(x, gy0 - px * 1.15);
    ctx.lineTo(x + span, gy1 - px * 1.15);
    ctx.stroke();
  }

  function drawRuralHouseCluster(ctx, opts) {
    const sx = opts.sx || 0;
    const gy = opts.gy || 0;
    const groundYAtOffset = opts.groundYAtOffset;
    const isNight = !!opts.isNight;
    const seed = opts.seed == null ? 1 : opts.seed;
    const colors = palette(isNight);

    // Bigger than before, but still readable in-motion.
    const scale = clamp((opts.size || 1) * 4.2, 2.8, 5.8);
    const pxRaw = clamp(scale * 0.34, 0.95, 2.1);
    const px = Math.round(pxRaw * 4) / 4;

    const count = 1 + Math.floor(seeded01(seed + 11) * 3);
    const gap = px * (2.8 + seeded01(seed + 21) * 2.4);

    let cursorX = sx;
    for (let i = 0; i < count; i++) {
      const t = seeded01(seed * 1.97 + i * 3.11);
      const type = Math.floor(t * HOUSE_SPRITES_HI.length) % HOUSE_SPRITES_HI.length;
      const sprite = HOUSE_SPRITES_HI[type];
      const b = spriteBounds(sprite);

      const widthGuess = b.w * px;
      let gyLocal = gy;
      if (typeof groundYAtOffset === "function") {
        const from = (cursorX - sx) + px * 0.5;
        const to = from + widthGuess - px;
        const step = Math.max(4, px * 6);
        let gMax = -Infinity;
        for (let o = from; o <= to; o += step) gMax = Math.max(gMax, groundYAtOffset(o));
        gMax = Math.max(gMax, groundYAtOffset(to));
        gyLocal = gMax + px * 0.12;
      }

      const drawn = drawPixelSprite(ctx, type, sprite, cursorX, gyLocal, px, colors, isNight);
      if (drawn.chimneyX != null && drawn.chimneyY != null && seeded01(seed + i * 29) > 0.35) {
        drawSmoke(ctx, drawn.chimneyX, drawn.chimneyY - px * 0.55, px, isNight, seed + i * 97);
      }
      cursorX += drawn.width + gap;
    }

    if (seeded01(seed + 41) > 0.28) {
      drawFence(
        ctx,
        sx - px * 1.6,
        gy,
        (cursorX - sx) + px * 2.6,
        px,
        isNight,
        typeof groundYAtOffset === "function"
          ? (offset) => groundYAtOffset(offset - px * 1.6)
          : null
      );
    }
  }

  window.drawRuralHouseCluster = drawRuralHouseCluster;
  return drawRuralHouseCluster;
};


