module.exports = function attachTerrainSystem(runtime = {}) {
  const window = runtime.window || runtime || {};
  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function smoothstep(t) {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function hashSeed(seed) {
    let h = 2166136261 >>> 0;
    const s = String(seed);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function rand() {
      t += 0x6D2B79F5;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function wrap(x, span) {
    return ((x % span) + span) % span;
  }

  function sampleCatmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (
      (2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    );
  }

  function createCommercialTerrain(options = {}) {
    const worldSpan = options.worldSpan || 36000;
    const seed = options.seed || Math.random() * 1000000;
    const rand = mulberry32(hashSeed(seed));
    const TERRAIN_HEIGHT_SCALE = 0.22;
    const FEATURE_SIZE_SCALE = 0.5;

    const biomeKinds = ["plains", "mountains", "ocean"];
    const biomeLens = {
      plains: [5600, 9800],
      mountains: [4200, 7800],
      ocean: [5200, 9000],
    };
    const biomeSegments = [];

    let wx = 0;
    let idx = Math.floor(rand() * biomeKinds.length);
    while (wx < worldSpan) {
      const biome = biomeKinds[idx % biomeKinds.length];
      const [a, b] = biomeLens[biome];
      const len = Math.floor(a + rand() * (b - a));
      const end = Math.min(worldSpan, wx + len);
      biomeSegments.push({ biome, start: wx, end });
      wx = end;
      idx += 1 + Math.floor(rand() * 2);
    }

    function biomeAt(worldX) {
      const x = wrap(worldX, worldSpan);
      for (let i = 0; i < biomeSegments.length; i++) {
        const s = biomeSegments[i];
        if (x >= s.start && x < s.end) return s.biome;
      }
      return biomeSegments[0].biome;
    }

    const sampleStep = 220;
    const samples = [];
    const sampleCount = Math.ceil(worldSpan / sampleStep) + 4;
    let prevHeight = 40;
    for (let i = 0; i < sampleCount; i++) {
      const x = i * sampleStep;
      const biome = biomeAt(x);
      let target = 0;
      if (biome === "plains") {
        target = 26 + rand() * 44;
      } else if (biome === "mountains") {
        target = 84 + rand() * 170;
      } else {
        target = 2 + rand() * 18;
      }
      // Keep adjacent heights coherent to avoid jagged profile.
      const mix = biome === "mountains" ? 0.78 : 0.58;
      const h = lerp(prevHeight, target, mix);
      samples.push(h);
      prevHeight = h;
    }

    function heightAt(worldX) {
      const x = wrap(worldX, worldSpan);
      const f = x / sampleStep;
      const i = Math.floor(f);
      const t = f - i;
      const s0 = samples[(i - 1 + samples.length) % samples.length];
      const s1 = samples[(i + samples.length) % samples.length];
      const s2 = samples[(i + 1) % samples.length];
      const s3 = samples[(i + 2) % samples.length];
      const base = sampleCatmullRom(s0, s1, s2, s3, smoothstep(t));

      // Add micro variation per biome while keeping commercial-grade readability.
      const biome = biomeAt(x);
      let ripple = 0;
      if (biome === "plains") {
        ripple = Math.sin(x * 0.006 + 1.7) * 4 + Math.sin(x * 0.013 + 0.2) * 2;
      } else if (biome === "mountains") {
        ripple = Math.sin(x * 0.007 + 2.1) * 12 + Math.sin(x * 0.019 + 0.9) * 7;
      } else {
        ripple = Math.sin(x * 0.010 + 0.4) * 1.8;
      }
      return clamp((base + ripple) * TERRAIN_HEIGHT_SCALE, 0, 300);
    }

    const features = [];
    let dogIdSeq = 1;
    for (const seg of biomeSegments) {
      const len = seg.end - seg.start;
      if (seg.biome === "plains") {
        const ruralHouses = Math.max(2, Math.floor(len / 1800));
        const villages = Math.max(1, Math.floor(len / 2200));
        const cities = Math.max(0, Math.floor(len / 5400));
        for (let i = 0; i < ruralHouses; i++) {
          features.push({
            kind: "ruralHouse",
            wx: seg.start + 260 + rand() * Math.max(140, len - 520),
            size: (0.8 + rand() * 0.55) * FEATURE_SIZE_SCALE,
            seed: rand() * 100000,
          });
        }
        for (let i = 0; i < villages; i++) {
          const vwx = seg.start + 240 + rand() * Math.max(120, len - 480);
          features.push({
            kind: "village",
            wx: vwx,
            size: (0.8 + rand() * 0.5) * FEATURE_SIZE_SCALE,
          });
          if (rand() < 0.72) {
            features.push({
              kind: "villageDog",
              id: dogIdSeq++,
              wx: vwx + (rand() - 0.5) * 180,
              size: (0.78 + rand() * 0.55) * FEATURE_SIZE_SCALE,
              seed: rand() * 100000,
            });
          }
        }
        for (let i = 0; i < cities; i++) {
          features.push({
            kind: "city",
            wx: seg.start + 360 + rand() * Math.max(120, len - 720),
            size: (0.9 + rand() * 0.7) * FEATURE_SIZE_SCALE,
          });
        }
      } else if (seg.biome === "mountains") {
        const hamlets = Math.max(1, Math.floor(len / 3200));
        for (let i = 0; i < hamlets; i++) {
          features.push({
            kind: "mountainVillage",
            wx: seg.start + 220 + rand() * Math.max(80, len - 440),
            size: (0.7 + rand() * 0.35) * FEATURE_SIZE_SCALE,
          });
        }
      } else {
        const buoys = Math.max(1, Math.floor(len / 3800));
        for (let i = 0; i < buoys; i++) {
          features.push({
            kind: "buoy",
            wx: seg.start + 140 + rand() * Math.max(60, len - 280),
            size: (0.7 + rand() * 0.4) * FEATURE_SIZE_SCALE,
          });
        }
      }
    }

    const dogs = features.filter(f => f.kind === "villageDog");

    function drawFeature(ctx, feature, sx, gy, isNight, wx, groundBaseY, activeDogIds, phase) {
      const housePainter = window.drawRuralHouseCluster;
      const dogPainter = window.drawZeldaVillageDog;
      if (feature.kind === "villageDog" && typeof dogPainter === "function") {
        const slope = Math.abs(heightAt(wx + 18) - heightAt(wx - 18));
        if (slope <= 16) {
          dogPainter(ctx, {
            sx,
            gy: gy + 1,
            size: feature.size,
            isNight,
            barking: !!(activeDogIds && activeDogIds[feature.id]),
            phase: phase || 0,
            seed: feature.seed == null ? wx : feature.seed,
          });
        }
        return;
      }
      if ((feature.kind === "ruralHouse" || feature.kind === "village" || feature.kind === "mountainVillage") && typeof housePainter === "function") {
        // Keep houses on relatively flat terrain to avoid floating/tilted placement.
        const slope = Math.abs(heightAt(wx + 24) - heightAt(wx - 24));
        if (slope <= 18) {
          housePainter(ctx, {
            sx,
            gy,
            size: feature.size,
            isNight,
            seed: feature.seed == null ? wx : feature.seed,
            groundYAtOffset: (offset) => {
              const wxx = wx + offset;
              return groundBaseY - heightAt(wxx);
            },
          });
        }
        return;
      }

      if (feature.kind === "city") {
        const count = 5 + Math.floor(feature.size * 4);
        const w = 6 + feature.size * 2;
        for (let i = 0; i < count; i++) {
          const tw = w + i % 3;
          const th = 26 + (i % 4) * 8 + feature.size * 10;
          const x = sx + i * (tw + 1);
          const y = gy - th;
          ctx.fillStyle = isNight ? "rgba(58,70,92,0.92)" : "rgba(74,88,108,0.9)";
          ctx.fillRect(x, y, tw, th);
          if (isNight) {
            ctx.fillStyle = "rgba(255,235,160,0.65)";
            for (let r = 0; r < 2; r++) {
              ctx.fillRect(x + 1, y + 3 + r * 8, 1.5, 2.5);
            }
          }
        }
        return;
      }

      if (feature.kind === "village" || feature.kind === "mountainVillage") {
        const count = feature.kind === "village" ? 4 : 3;
        const houseW = (feature.kind === "village" ? 9 : 7) * feature.size;
        const houseH = (feature.kind === "village" ? 7 : 6) * feature.size;
        for (let i = 0; i < count; i++) {
          const x = sx + i * (houseW + 3);
          const y = gy - houseH;
          ctx.fillStyle = isNight ? "rgba(78,70,62,0.9)" : "rgba(144,123,103,0.88)";
          ctx.fillRect(x, y, houseW, houseH);
          ctx.fillStyle = isNight ? "rgba(96,86,78,0.95)" : "rgba(173,144,120,0.95)";
          ctx.beginPath();
          ctx.moveTo(x - 1, y);
          ctx.lineTo(x + houseW * 0.5, y - houseH * 0.7);
          ctx.lineTo(x + houseW + 1, y);
          ctx.closePath();
          ctx.fill();
        }
        return;
      }

      if (feature.kind === "buoy") {
        const h = 14 * feature.size;
        ctx.strokeStyle = isNight ? "rgba(180,220,245,0.8)" : "rgba(92,132,164,0.85)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(sx, gy - 2);
        ctx.lineTo(sx, gy - h);
        ctx.stroke();
        ctx.fillStyle = isNight ? "rgba(255,120,120,0.8)" : "rgba(230,96,96,0.86)";
        ctx.fillRect(sx - 2, gy - h - 4, 4, 4);
      }
    }

    function draw(opts) {
      const ctx = opts.ctx;
      const baseWorldX = opts.baseWorldX;
      const screenW = opts.screenW;
      const screenH = opts.screenH;
      const groundBaseY = opts.groundBaseY;
      const isNight = !!opts.isNight;
      const activeDogIds = opts.activeDogIds || null;
      const phase = opts.phase || 0;

      const step = 6;
      for (let sx = 0; sx <= screenW + step; sx += step) {
        const wx = baseWorldX + sx;
        const h = heightAt(wx);
        const gy = groundBaseY - h;
        const biome = biomeAt(wx);
        if (biome === "ocean") {
          ctx.fillStyle = isNight ? "rgba(22,56,86,0.82)" : "rgba(60,140,182,0.82)";
          ctx.fillRect(sx, gy, step + 1, screenH - gy + 240);
          const w1 = Math.sin(wx * 0.040 + phase * 3.0) * 1.8;
          const w2 = Math.sin(wx * 0.022 + phase * 2.2 + 1.1) * 1.2;
          const crestY = gy + w1 + w2;
          ctx.fillStyle = isNight ? "rgba(138,205,240,0.40)" : "rgba(225,248,255,0.52)";
          ctx.fillRect(sx, crestY - 1.4, step + 1, 2.1);
          ctx.fillStyle = isNight ? "rgba(98,168,212,0.20)" : "rgba(182,228,246,0.26)";
          ctx.fillRect(sx, crestY + 2.0, step + 1, 1.6);
        } else if (biome === "mountains") {
          ctx.fillStyle = isNight ? "rgba(49,62,72,0.9)" : "rgba(94,112,94,0.9)";
          ctx.fillRect(sx, gy, step + 1, screenH - gy + 240);
        } else {
          ctx.fillStyle = isNight ? "rgba(58,78,64,0.9)" : "rgba(108,152,98,0.9)";
          ctx.fillRect(sx, gy, step + 1, screenH - gy + 240);
        }
      }

      ctx.save();
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = isNight ? "rgba(240,248,255,0.62)" : "rgba(255,255,255,0.74)";
      ctx.beginPath();
      for (let sx = 0; sx <= screenW; sx += 8) {
        const wx = baseWorldX + sx;
        const gy = groundBaseY - heightAt(wx);
        if (sx === 0) ctx.moveTo(sx, gy);
        else ctx.lineTo(sx, gy);
      }
      ctx.stroke();
      ctx.restore();

      const wrapBase = Math.floor(baseWorldX / worldSpan) * worldSpan;
      for (const f of features) {
        for (let rep = -1; rep <= 1; rep++) {
          const wx = f.wx + wrapBase + rep * worldSpan;
          const sx = wx - baseWorldX;
          if (sx < -180 || sx > screenW + 180) continue;
          const gy = groundBaseY - heightAt(wx);
          drawFeature(ctx, f, sx, gy, isNight, wx, groundBaseY, activeDogIds, phase);
        }
      }
    }

    function getDogsNear(worldX, range = 220) {
      const out = [];
      if (!dogs.length) return out;
      const center = wrap(worldX, worldSpan);
      for (const d of dogs) {
        let bestDx = Infinity;
        let bestWx = d.wx;
        for (let rep = -1; rep <= 1; rep++) {
          const wx = d.wx + rep * worldSpan;
          const dx = wx - center;
          if (Math.abs(dx) < Math.abs(bestDx)) {
            bestDx = dx;
            bestWx = wx;
          }
        }
        if (Math.abs(bestDx) <= range) out.push({ id: d.id, wx: bestWx, dx: bestDx, size: d.size });
      }
      return out;
    }

    return {
      worldSpan,
      biomeAt,
      heightAt,
      draw,
      getDogsNear,
    };
  }

  window.createCommercialTerrain = createCommercialTerrain;
  return createCommercialTerrain;
};
