module.exports = function createLowAltitudeGame(runtime = {}) {
  const window = runtime.window || {};
  const document = runtime.document || {};
  const performance = runtime.performance || globalThis.performance || { now: () => Date.now() };
  const requestAnimationFrame = runtime.requestAnimationFrame || globalThis.requestAnimationFrame;
  const cancelAnimationFrame = runtime.cancelAnimationFrame || globalThis.cancelAnimationFrame;
  const Audio = runtime.Audio || globalThis.Audio;
  const Image = runtime.Image || globalThis.Image;
  const ASSET_BASE = `${runtime.assetsBase || ""}`.trim().replace(/\/+$/g, "");
  const assetPath = (relative = "") => {
    const normalized = `${relative || ""}`.replace(/^\/+/, "");
    if (!normalized) return ASSET_BASE;
    return ASSET_BASE ? `${ASSET_BASE}/${normalized}` : normalized;
  };
  // Low Altitude Flight (2D) - game.js
  // Requirements implemented:
  // - Day/Night by local clock time: Day has sun+clouds, Night has moon+stars
  // - Alternating zones: Fly zone vs Controlled zone
  // - Alarm red overlay when (controlled zone) OR (altitude > 120m)
  // - Third-party flyers: Airliner / Fighter / Birds / Torpedo (boxes with labels)
  // - Player takeoff from left, then stays near center; speed is perceived via world scrolling
  // - Score = distance traveled
  // - Police drone chase:
  //    * In Controlled zone: chase (unless amnesty)
  //    * In Fly zone: chase only if altitude > 120m (unless amnesty)
  //    * Slow initially, can fall off-screen; accelerates if altitude > 200; very fast if > 500 (闂?2x player)
  // - Rewards: 200 report / 500 report / Special mission report: after pickup, police gives up for 15 seconds
  // - Controls: Up/Down/Left/Right + Boost (Shift) + Touch buttons
  // - Audio: Random BGM playlist + acoustic SFX by event

  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");

  const LANG = window.GAME_LANG || {};
  const UI = LANG.ui || {};
  const TXT = LANG.label || {};
  const REASON = LANG.reason || {};
  const t = (obj, key, fallback) => (obj && obj[key]) || fallback;
  const startPaused = runtime.startPaused === true;
  const customFontFamily = `${window.GAME_FONT_FAMILY || ""}`.trim();
  const defaultGameFontStack = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Microsoft YaHei', sans-serif";
  const gameFontStack = customFontFamily ? `'${customFontFamily}', ${defaultGameFontStack}` : defaultGameFontStack;
  const buildGameFont = (sizePx, weight = "") =>
    `${weight ? `${weight} ` : ""}${sizePx}px ${gameFontStack}`;

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const chance = (p) => Math.random() < p;
  function roundedRectPath(c, x, y, w, h, r) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.lineTo(x + w - rr, y);
    c.quadraticCurveTo(x + w, y, x + w, y + rr);
    c.lineTo(x + w, y + h - rr);
    c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    c.lineTo(x + rr, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - rr);
    c.lineTo(x, y + rr);
    c.quadraticCurveTo(x, y, x + rr, y);
    c.closePath();
  }

  // ---------- HiDPI ----------
  function applyImageSmoothing() {
    try {
      ctx.imageSmoothingEnabled = true;
    } catch (err) {}
    if ("imageSmoothingQuality" in ctx) {
      try {
        ctx.imageSmoothingQuality = "high";
      } catch (err) {}
    }
  }

  function resize() {
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    applyImageSmoothing();
  }
  window.addEventListener("resize", resize);
  resize();

  const W = () => canvas.clientWidth;
  const H = () => canvas.clientHeight;
  const cameraOffsetY = () => {
    if (!state || !state.player) return 0;
    // Keep 0m pinned at bottom in low altitude, then switch to center-follow when climbing high enough.
    return Math.max(0, H() * 0.5 - state.player.y);
  };

  const skyTopPx = 70;
  const HORIZON_BOTTOM_MARGIN = 0;
  const ALTITUDE_LOW_SPLIT_M = 120;
  const ALTITUDE_PIN_EQUIV_M = 250; // 120m should appear where 250m used to appear
  const ALTITUDE_120_200_VISUAL_RATIO = 0.40; // explicit share of visible altitude band
  const groundBasePx = () => H() - HORIZON_BOTTOM_MARGIN;
  const metersVisible = 180;
  const metersWorldMax = 10000;

  // Piecewise altitude mapping (non-linear display scale):
  // 1) 120m is pinned to the screen position where 250m used to be.
  // 2) 120-200m is stretched relative to 200-1000m.
  // 3) Above 1000m, each +1000m keeps compressed high-altitude scale.
  function altitudeMapParams() {
    const totalH = groundBasePx() - skyTopPx;
    // Legacy (old) mapping reference point used to pin 120m to old-250m position.
    const legacySpan200 = totalH * 0.65;
    const legacySpan200to1000 = totalH - legacySpan200;
    const legacyPxPerM0 = legacySpan200 / 200;
    const legacyPxPerM1 = legacySpan200to1000 / 800;
    const legacyDAt250 = legacySpan200 + (ALTITUDE_PIN_EQUIV_M - 200) * legacyPxPerM1;

    const spanLow = clamp(legacyDAt250, totalH * 0.2, totalH * 0.9); // 0..120m
    const spanMid = totalH - spanLow;                                 // 120..1000m total
    const pxPerMLow = spanLow / ALTITUDE_LOW_SPLIT_M;
    // Split 120..1000 into:
    // - 120..200 gets an explicit visible share (so adjustment is immediately visible)
    // - 200..1000 consumes the remainder
    const spanMidA = clamp(spanMid * ALTITUDE_120_200_VISUAL_RATIO, 24, spanMid * 0.72);
    const spanMidB = spanMid - spanMidA;
    const pxPerMMidA = spanMidA / 80;  // 120..200
    const pxPerMMidB = spanMidB / 800; // 200..1000
    const pxPerMHigh = pxPerMLow * 0.12;
    return { spanLow, spanMidA, spanMidB, pxPerMLow, pxPerMMidA, pxPerMMidB, pxPerMHigh };
  }

  function m2y(m) {
    const mm = Math.max(0, m);
    const { spanLow, spanMidA, spanMidB, pxPerMLow, pxPerMMidA, pxPerMMidB, pxPerMHigh } = altitudeMapParams();
    let d = 0;
    if (mm <= ALTITUDE_LOW_SPLIT_M) d = mm * pxPerMLow;
    else if (mm <= 200) d = spanLow + (mm - ALTITUDE_LOW_SPLIT_M) * pxPerMMidA;
    else if (mm <= 1000) d = spanLow + spanMidA + (mm - 200) * pxPerMMidB;
    else d = spanLow + spanMidA + spanMidB + (mm - 1000) * pxPerMHigh;
    return groundBasePx() - d;
  }

  function y2m(y) {
    const { spanLow, spanMidA, spanMidB, pxPerMLow, pxPerMMidA, pxPerMMidB, pxPerMHigh } = altitudeMapParams();
    const d = groundBasePx() - y;
    if (d <= spanLow) return Math.max(0, d / pxPerMLow);
    if (d <= spanLow + spanMidA) return ALTITUDE_LOW_SPLIT_M + (d - spanLow) / pxPerMMidA;
    if (d <= spanLow + spanMidA + spanMidB) return 200 + (d - spanLow - spanMidA) / pxPerMMidB;
    return 1000 + (d - spanLow - spanMidA - spanMidB) / pxPerMHigh;
  }
  const SPEED_BY_STAGE = [90, 145, 215, 305, 425];
  const SPEED_G5 = SPEED_BY_STAGE[4];
  const HORIZONTAL_ACCEL_PER_SEC = 90;
  const WORLD_UNIT_TO_METER = 1.0;
  const DISPLAY_SPEED_MIN_MS = 10;
  const DISPLAY_SPEED_MAX_MS = 60;
  const PLAYER_VERTICAL_ACCEL = 950;
  const PLAYER_VERTICAL_MAX_SPEED = 190;
  const ENTITY_SCALE = 0.5;
  const SZ = (value) => value * ENTITY_SCALE;
  const AIRCRAFT_SIZE_SCALE = 1.5;
  const AIRCRAFT_SPEED_SCALE = 1.5;
  const HOT_BALLOON_SIZE_SCALE = 1.2;
  const DRONE_DISPLAY_WIDTH = 48;
  const DRONE_DISPLAY_HEIGHT = 32;
  const BIRD_DISPLAY_WIDTH = 48;
  const BIRD_DISPLAY_HEIGHT = 32;
  const VISUAL_SPEED_SCALE = 1.2;
  const SHIELD_GUARANTEE_LEAD_DISTANCE = 1200;
  const NORMALIZED_SPRITE_SOURCE_WIDTH = 144;
  const NORMALIZED_SPRITE_SOURCE_HEIGHT = 96;
  const toDisplaySpeedMs = (internalSpeed) => {
    const minSrc = SPEED_BY_STAGE[0];
    const maxSrc = SPEED_BY_STAGE[SPEED_BY_STAGE.length - 1];
    const src = clamp(Number(internalSpeed) || minSrc, minSrc, maxSrc);
    const ratio = maxSrc > minSrc ? (src - minSrc) / (maxSrc - minSrc) : 0;
    const display =
      DISPLAY_SPEED_MIN_MS + ratio * (DISPLAY_SPEED_MAX_MS - DISPLAY_SPEED_MIN_MS);
    return Math.round(display);
  };

  // ---------- Audio ----------
  const AudioBus = (() => {
    let started = false;
    let muted = false;
    let gameplayActive = !startPaused;
    const BGM_TRACKS = [
      assetPath("bgm/bgm_fly.wav"),
      assetPath("bgm/bgm_control.wav"),
      assetPath("bgm/rainforest_tropical_loop.wav"),
    ];
    const SFX = {
      crashed: assetPath("acoustic/crashed.wav"),
      duckCrashed: assetPath("acoustic/duck_crashed.mp3"),
      bark: assetPath("acoustic/bark.wav"),
      failed: assetPath("acoustic/failed.wav"),
      freeze: assetPath("acoustic/freeze.wav"),
      jet: assetPath("acoustic/jet.wav"),
      police: assetPath("acoustic/police.wav"),
      ufo: assetPath("acoustic/ufo.wav"),
    };

    let currentBgm = null;
    let bgmDelayTimer = 0;
    let bgmFadeRAF = 0;
    let lastTrack = "";
    let policeLoopEl = null;
    let policeLoopWanted = false;
    const activeSfxEls = new Set();

    function stopAndDisposeAudio(el) {
      if (!el) return;
      try {
        el.pause();
      } catch (err) {}
      try {
        el.currentTime = 0;
      } catch (err) {}
      try {
        if (typeof el.destroy === "function") el.destroy();
      } catch (err) {}
    }

    function clearBgmDelay() {
      if (!bgmDelayTimer) return;
      clearTimeout(bgmDelayTimer);
      bgmDelayTimer = 0;
    }

    function stopCurrentBgm() {
      if (!currentBgm) return;
      stopAndDisposeAudio(currentBgm);
      currentBgm.onended = null;
      currentBgm = null;
    }

    function scheduleNextTrack(delayMs = 0) {
      clearBgmDelay();
      if (!started || muted || !gameplayActive) return;
      bgmDelayTimer = setTimeout(() => {
        bgmDelayTimer = 0;
        playNextTrack();
      }, delayMs);
    }

    function pickRandomTrack() {
      if (BGM_TRACKS.length <= 1) return BGM_TRACKS[0];
      const candidates = BGM_TRACKS.filter(t => t !== lastTrack);
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    function playNextTrack() {
      if (!started || muted || !gameplayActive) return;
      stopCurrentBgm();
      const src = pickRandomTrack();
      lastTrack = src;
      const el = new Audio(src);
      el.preload = "auto";
      el.loop = false;
      el.volume = 1.0;
      el.onended = () => {
        if (currentBgm !== el) return;
        currentBgm = null;
        scheduleNextTrack(1000);
      };
      currentBgm = el;
      el.play().catch(() => {});
    }

    function fadeOutBgm(durationSec = 0.8) {
      if (!currentBgm) return;
      if (bgmFadeRAF) {
        cancelAnimationFrame(bgmFadeRAF);
        bgmFadeRAF = 0;
      }
      const el = currentBgm;
      const start = performance.now();
      const from = el.volume;
      const tick = (now) => {
        if (!currentBgm || currentBgm !== el) return;
        const t = clamp((now - start) / (durationSec * 1000), 0, 1);
        el.volume = (1 - t) * from;
        if (t >= 1) {
          bgmFadeRAF = 0;
          stopCurrentBgm();
          return;
        }
        bgmFadeRAF = requestAnimationFrame(tick);
      };
      bgmFadeRAF = requestAnimationFrame(tick);
    }

    function playSfx(src, vol = 0.9) {
      if (muted) return;
      const el = new Audio(src);
      el.volume = vol;
      activeSfxEls.add(el);
      el.onended = () => {
        activeSfxEls.delete(el);
        stopAndDisposeAudio(el);
      };
      el.play().catch(() => {});
    }

    function playSfxFadeOut(src, vol = 0.85, fadeSec = 1.2) {
      if (muted) return;
      const el = new Audio(src);
      el.volume = vol;
      activeSfxEls.add(el);
      el.onended = () => {
        activeSfxEls.delete(el);
        stopAndDisposeAudio(el);
      };
      el.play().catch(() => {});
      const t0 = performance.now();
      const tick = (now) => {
        if (el.paused || el.ended) return;
        const k = clamp((now - t0) / (fadeSec * 1000), 0, 1);
        el.volume = vol * (1 - k);
        if (k >= 1) {
          activeSfxEls.delete(el);
          stopAndDisposeAudio(el);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    function startPoliceLoop() {
      if (policeLoopEl || muted || !started || !gameplayActive) return;
      const el = new Audio(SFX.police);
      el.preload = "auto";
      el.loop = true;
      el.volume = 0.85;
      el.play().catch(() => {});
      policeLoopEl = el;
    }

    function stopPoliceLoop() {
      if (!policeLoopEl) return;
      stopAndDisposeAudio(policeLoopEl);
      policeLoopEl = null;
    }

    function stopAllSfx() {
      if (!activeSfxEls.size) return;
      const queue = [...activeSfxEls];
      activeSfxEls.clear();
      for (let i = 0; i < queue.length; i += 1) {
        stopAndDisposeAudio(queue[i]);
      }
    }

    function stopAll() {
      clearBgmDelay();
      if (bgmFadeRAF) {
        cancelAnimationFrame(bgmFadeRAF);
        bgmFadeRAF = 0;
      }
      stopCurrentBgm();
      stopPoliceLoop();
      stopAllSfx();
    }

    function setPoliceActive(next) {
      policeLoopWanted = !!next;
      if (!policeLoopWanted) {
        stopPoliceLoop();
        return;
      }
      startPoliceLoop();
    }

    function setMuted(next) {
      muted = !!next;
      if (!started) return;
      if (muted) {
        stopAll();
      } else {
        scheduleNextTrack(0);
        if (policeLoopWanted) startPoliceLoop();
      }
    }

    async function start() {
      if (started) {
        scheduleNextTrack(0);
        return;
      }
      started = true;
      scheduleNextTrack(0);
    }

    function setMode() {}

    function setGameplayActive(next) {
      gameplayActive = !!next;
      if (!started) return;
      if (gameplayActive) {
        if (bgmFadeRAF) {
          cancelAnimationFrame(bgmFadeRAF);
          bgmFadeRAF = 0;
        }
        stopCurrentBgm();
        scheduleNextTrack(0);
        if (policeLoopWanted) startPoliceLoop();
      } else {
        clearBgmDelay();
        fadeOutBgm(0.8);
        stopPoliceLoop();
      }
    }

    return {
      start,
      setMode,
      isMuted: () => muted,
      setMuted,
      toggleMuted: () => {
        setMuted(!muted);
        return muted;
      },
      setGameplayActive,
      stopAll,
      crashed: () => playSfx(SFX.crashed, 0.95),
      duckCrashed: () => playSfx(SFX.duckCrashed, 0.95),
      bark: () => playSfx(SFX.bark, 1.0),
      failed: () => playSfx(SFX.failed, 1.0),
      freeze: () => playSfx(SFX.freeze, 0.9),
      jet: () => playSfx(SFX.jet, 0.45),
      setPoliceActive,
      ufo: () => playSfx(SFX.ufo, 0.9),
    };
  })();

  // Try start immediately; keep gesture fallback for browsers that block autoplay.
  try { AudioBus.start(); } catch {}

  // Gesture fallback
  const gestureStart = async () => {
    window.removeEventListener("keydown", gestureStart);
    window.removeEventListener("pointerdown", gestureStart);
    try { await AudioBus.start(); } catch {}
  };
  window.addEventListener("keydown", gestureStart);
  window.addEventListener("pointerdown", gestureStart);

  // ---------- Input ----------
  const input = { up: false, down: false, left: false, right: false, throttleUp: false, throttleDown: false };

  function clearInput() {
    input.up = false;
    input.down = false;
    input.left = false;
    input.right = false;
    input.throttleUp = false;
    input.throttleDown = false;
  }

  const keymap = new Map([
    ["arrowup", "up"], ["w", "up"],
    ["arrowdown", "down"], ["s", "down"],
    ["arrowleft", "left"], ["a", "throttleDown"],
    ["arrowright", "right"], ["d", "right"],
    ["q", "throttleUp"], ["shift", "throttleUp"]
  ]);

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "r") { reset(); return; }
    if (k === "m") { AudioBus.toggleMuted(); return; }
    if (state && state.gameOver) return;
    const m = keymap.get(k);
    if (m) input[m] = true;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(e.key)) e.preventDefault();
  });

  window.addEventListener("keyup", (e) => {
    if (state && state.gameOver) return;
    const k = e.key.toLowerCase();
    const m = keymap.get(k);
    if (m) input[m] = false;
  });

  // ---------- Entities ----------
  const LABEL = {
    AIRLINER: t(TXT, "airliner", ""),
    FIGHTER: t(TXT, "fighter", ""),
    BIRDS: t(TXT, "birds", ""),
    TORPEDO: t(TXT, "torpedo", ""),
    E_HOT_BAL: t(TXT, "e_hot_ball", ""),
    K_HOT_BAL: t(TXT, "k_hot_ball", ""),
    N_HOT_BAL: t(TXT, "n_hot_ball", ""),
    UFO: t(TXT, "ufo", "UFO"),
    SHIELD: t(TXT, "shield", ""),
    REPORT200: t(TXT, "report_200", ""),
    REPORT500: t(TXT, "report_500", ""),
    SPECIAL: t(TXT, "special", ""),
    PLAYER: t(TXT, "player", ""),
    POLICE: t(TXT, "police", ""),
  };

  const palette = {
    player: "#ffffff",
    police: "#ff4d6d",
    airliner: "#ffd166",
    fighter: "#06d6a0",
    birds: "#a0c4ff",
    torpedo: "#f72585",
    ehot: "#ffd6a5",
    khot: "#ffd6a5",
    nhot: "#ffd6a5",
    ufo: "#8ecae6",
    shield: "#dcefff",
    report200: "#4cc9f0",
    report500: "#4895ef",
    special: "#ff9f1c",
  };

  function loadSprite(src) {
    const img = new Image();
    let ready = false;
    img.addEventListener("load", () => { ready = true; });
    img.src = src;
    return { img, ready: () => ready };
  }
  const myDroneSprite = loadSprite(assetPath("img/mydrone.png"));
  const myDroneSpeedingSprite = loadSprite(assetPath("img/mydrone-speeding.png"));
  const myDroneDizzySprite = loadSprite(assetPath("img/mydrone-dizzy.png"));
  const policeDroneSprite = loadSprite(assetPath("img/drone-police.png"));
  const fighterJetSprite = loadSprite(assetPath("img/jet.png"));
  const airlinerSprite = loadSprite(assetPath("img/aircraft.png"));
  const torpedoSprite = loadSprite(assetPath("img/torpedo.png"));
  const eHotBallSprite = loadSprite(assetPath("img/e-hot-ball.png"));
  const kHotBallSprite = loadSprite(assetPath("img/k-hot-ball.png"));
  const nHotBallSprite = loadSprite(assetPath("img/n-hot-ball.png"));
  const ufoSprite = loadSprite(assetPath("img/ufo.png"));
  const shieldRewardSprite = loadSprite(assetPath("img/shield.png"));
  const reward200Sprite = loadSprite(assetPath("img/uom200.png"));
  const reward500Sprite = loadSprite(assetPath("img/uom500.png"));
  const rewardSpecSprite = loadSprite(assetPath("img/uomspec.png"));
  const birdUpSprite = loadSprite(assetPath("img/b1-up.png"));
  const birdDownSprite = loadSprite(assetPath("img/b1-down.png"));
  const birdDizzySprite = loadSprite(assetPath("img/b1-dizzy.png"));

  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function playerHitbox() {
    const p = state.player;
    // Scale hitbox down for large sprite (144x96) so collisions match visual mass.
    const hw = p.w * 0.62;
    const hh = p.h * 0.58;
    const hx = p.screenX + (p.w - hw) * 0.5;
    const hy = p.y + (p.h - hh) * 0.56;
    return { x: hx, y: hy, w: hw, h: hh };
  }

  function policeHitbox(cop) {
    // Match police sprite body, avoid oversized transparent margins.
    const hw = cop.w * 0.60;
    const hh = cop.h * 0.56;
    const hx = cop.x + (cop.w - hw) * 0.50;
    const hy = cop.y + (cop.h - hh) * 0.56;
    return { x: hx, y: hy, w: hw, h: hh };
  }

  function entityHitbox(e) {
    // Keep bird collision proportional to sprite size (prior body ratio 100/144 by 66/96).
    if (e.kind === "birds") {
      const hw = e.w * (100 / 144);
      const hh = e.h * (66 / 96);
      const hx = e.x + (e.w - hw) * 0.5;
      const hy = e.y + (e.h - hh) * 0.56;
      return { x: hx, y: hy, w: hw, h: hh };
    }
    return { x: e.x, y: e.y, w: e.w, h: e.h };
  }

  function drawLabeledBox(x, y, w, h, stroke, label) {
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    ctx.font = buildGameFont(12);
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x, y - 16, tw + 10, 16);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x + 5, y - 4);
    ctx.restore();
  }

  const getNormalizedSourceRect = (img) => {
    const imgW = Math.max(1, Number(img?.width) || NORMALIZED_SPRITE_SOURCE_WIDTH);
    const imgH = Math.max(1, Number(img?.height) || NORMALIZED_SPRITE_SOURCE_HEIGHT);
    const sw = Math.min(NORMALIZED_SPRITE_SOURCE_WIDTH, imgW);
    const sh = Math.min(NORMALIZED_SPRITE_SOURCE_HEIGHT, imgH);
    const sx = Math.max(0, (imgW - sw) * 0.5);
    const sy = Math.max(0, (imgH - sh) * 0.5);
    return { sx, sy, sw, sh };
  };

  const drawNormalizedSprite = (img, dx, dy, dw, dh) => {
    if (!img) return;
    const { sx, sy, sw, sh } = getNormalizedSourceRect(img);
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  };

  // ---------- Terrain (commercial world) ----------
  let terrain = null;
  const createTerrain = () =>
    window.createCommercialTerrain({
      seed: Math.random() * 9999,
      worldSpan: 36000,
    });

  // ---------- Zones (alternate fly/controlled) ----------
  function buildZones() {
    const zones = [];
    let x = 0;
    let controlled = false; // start in fly zone
    for (let i = 0; i < 90; i++) {
      const len = Math.floor(rnd(2700, 6600)); // ~3x longer zone span
      zones.push({ start: x, end: x + len, controlled });
      x += len;
      controlled = !controlled;
    }
    return zones;
  }

  function zoneAt(worldX, zones) {
    const maxEnd = zones[zones.length - 1].end;
    const wx = ((worldX % maxEnd) + maxEnd) % maxEnd;
    for (const z of zones) {
      if (wx >= z.start && wx < z.end) return { ...z, wx, maxEnd };
    }
    return { ...zones[0], wx, maxEnd };
  }

  function nextControlledZoneStart(worldX, zones) {
    if (!zones.length) return null;
    const maxEnd = zones[zones.length - 1].end;
    const lap = Math.floor(worldX / maxEnd);
    const wx = ((worldX % maxEnd) + maxEnd) % maxEnd;

    for (const z of zones) {
      if (z.controlled && z.start > wx) return lap * maxEnd + z.start;
    }
    for (const z of zones) {
      if (z.controlled) return (lap + 1) * maxEnd + z.start;
    }
    return null;
  }

  // ---------- Day/Night ----------
  let isNight = false;

  const DAY_START_MIN = 6 * 60;    // 06:00
  const NIGHT_START_MIN = 18 * 60; // 18:00

  function localClockMinutes(now = new Date()) {
    return (
      now.getHours() * 60 +
      now.getMinutes() +
      now.getSeconds() / 60 +
      now.getMilliseconds() / 60000
    );
  }

  function celestialArc(progress01) {
    // Left -> right arc: low at ends, highest near middle.
    return {
      xRatio: 0.08 + 0.84 * progress01,
      yRatio: 0.80 - Math.sin(progress01 * Math.PI) * 0.64,
    };
  }

  function skyByLocalTime(now = new Date()) {
    const mins = localClockMinutes(now);
    const daySpan = NIGHT_START_MIN - DAY_START_MIN;
    const nightSpan = (24 * 60 - NIGHT_START_MIN) + DAY_START_MIN;

    if (mins >= DAY_START_MIN && mins < NIGHT_START_MIN) {
      const dayProgress = clamp((mins - DAY_START_MIN) / daySpan, 0, 1);
      const sun = celestialArc(dayProgress);
      return {
        isNight: false,
        sunXRatio: sun.xRatio,
        sunYRatio: sun.yRatio,
        moonXRatio: 0.82,
        moonYRatio: 0.18,
      };
    }

    const minsSinceNight = mins >= NIGHT_START_MIN
      ? (mins - NIGHT_START_MIN)
      : (mins + (24 * 60 - NIGHT_START_MIN));
    const nightProgress = clamp(minsSinceNight / nightSpan, 0, 1);
    const moon = celestialArc(nightProgress);
    return {
      isNight: true,
      sunXRatio: 0.85,
      sunYRatio: 0.16,
      moonXRatio: moon.xRatio,
      moonYRatio: moon.yRatio,
    };
  }

  function syncSkyFromClock(now = new Date()) {
    const sky = skyByLocalTime(now);
    isNight = sky.isNight;
    return sky;
  }

  // ---------- Game State ----------
  let state;
  let paused = startPaused;

  function reset() {
    clearInput();
    state = {
      last: performance.now(),
      t: 0,
      phase: "takeoff", // takeoff -> run
      phaseT: 0,
      gameOver: false,
      gameOverNotified: false,
      reason: "",
      worldX: 0,
      worldSpeed: SPEED_BY_STAGE[0],
      logicDistance: 0,
      score: 0,
      zones: buildZones(),
      controlled: false,
      alarm: false,
      amnesty: 0, // seconds police gives up
      shield: 0, // invincible shield seconds
      shieldGuaranteeTargetX: null,
      shieldGuaranteeSpawned: false,
      boostLevel: 1, // 1..5
      player: {
        screenX: 60, // start left
        y: m2y(160),
        w: DRONE_DISPLAY_WIDTH, h: DRONE_DISPLAY_HEIGHT,
        vy: 0,
      },
      camOffsetX: 0, // small lateral dodge while staying centered
      police: {
        active: false,
        x: -300,
        y: m2y(160),
        w: DRONE_DISPLAY_WIDTH, h: DRONE_DISPLAY_HEIGHT,
        vx: 0, vy: 0,
      },
      entities: [],
      spawn: { air: 0, torpedo: 0, reward: 0, balloon: 0, ufo: 0 },
      stars: Array.from({ length: 130 }, () => ({ x: Math.random() * W(), y: Math.random() * H() * 0.6, s: rnd(0.4, 1.8) })),
      clouds: Array.from({ length: 11 }, () => ({
        x: Math.random() * W(),
        y: rnd(58, H() * 0.45),
        r: rnd(30, 62),
        layer: rnd(0.55, 1.0),
        alpha: rnd(0.16, 0.28),
      })),
      impact: null,
      pickupToasts: [],
      waterSplashes: [],
      dogActiveIds: {},
      dogBarkCooldown: {},
      dogOverheadState: {},
      dogLastDx: {},
      crash: { active: false, reason: "", spin: Math.PI / 2, bouncesLeft: 0 },
    };

    terrain = createTerrain();

    // safe spawn above ground
    const px = state.player.screenX;
    const groundY = groundBasePx() - terrain.heightAt(state.worldX + px);
    state.player.y = clamp(groundY - SZ(140), skyTopPx + 10, groundBasePx() - SZ(30));

    AudioBus.setGameplayActive(!paused);
    AudioBus.setMode("fly");
  }

  reset();

  function updateBoostLevel(dt) {
    // Q/SHIFT accelerates hard, A decelerates hard, no input decays slowly.
    const upRate = 5.6;
    const downRate = 4.0;
    const passiveDown = 0.35;
    if (input.throttleUp && !input.throttleDown) state.boostLevel += upRate * dt;
    else if (input.throttleDown && !input.throttleUp) state.boostLevel -= downRate * dt;
    else state.boostLevel -= passiveDown * dt;
    state.boostLevel = clamp(state.boostLevel, 1, 5);
  }

  function boostStage() {
    return clamp(Math.floor(state.boostLevel + 1e-6), 1, 5);
  }

  function targetWorldSpeed() {
    const stage = boostStage();
    return SPEED_BY_STAGE[stage - 1];
  }

  function updateWorldSpeed(dt) {
    const target = targetWorldSpeed();
    const current = Number(state.worldSpeed) || SPEED_BY_STAGE[0];
    const delta = target - current;
    const maxStep = HORIZONTAL_ACCEL_PER_SEC * dt;
    if (Math.abs(delta) <= maxStep) {
      state.worldSpeed = target;
    } else {
      state.worldSpeed = current + Math.sign(delta) * maxStep;
    }
    return state.worldSpeed;
  }

  function updateZone() {
    const z = zoneAt(state.worldX, state.zones);
    state.controlled = !!z.controlled;
    AudioBus.setMode(state.controlled ? "ctl" : "fly");
  }

  function spawnEntities(dt, spd) {
    const eHotChasing = state.entities.some(e => e.kind === "e-hot-ball" && e.chaseActive);
    const hasEHotBall = state.entities.some(e => e.kind === "e-hot-ball");

    // Keep air traffic (including birds) at a stable density.
    state.spawn.air -= dt;
    // Torpedoes are controlled-zone interceptors: higher spawn rate in controlled zone.
    state.spawn.torpedo -= dt * (state.controlled ? 1.25 : 0.0);
    state.spawn.reward -= dt;
    state.spawn.balloon -= dt;
    state.spawn.ufo -= dt;

    if (!state.controlled) {
      const nextControlledStartX = nextControlledZoneStart(state.worldX, state.zones);
      if (nextControlledStartX !== null) {
        if (state.shieldGuaranteeTargetX !== nextControlledStartX) {
          state.shieldGuaranteeTargetX = nextControlledStartX;
          state.shieldGuaranteeSpawned = false;
        }
        const distanceToControlled = nextControlledStartX - state.worldX;
        if (
          !state.shieldGuaranteeSpawned &&
          distanceToControlled <= SHIELD_GUARANTEE_LEAD_DISTANCE
        ) {
          const hasShieldEntity = state.entities.some(e => e.kind === "shield");
          if (!hasShieldEntity) {
            const playerAlt = y2m(state.player.y + state.player.h * 0.5);
            const alt = clamp(playerAlt + rnd(-220, 320), 120, metersWorldMax - 80);
            state.entities.push({
              kind: "shield",
              label: LABEL.SHIELD,
              x: W() + rnd(60, 180),
              y: m2y(alt),
              w: SZ(36), h: SZ(36),
              vx: -150,
              vy: 0,
              ttl: 20,
            });
          }
          state.shieldGuaranteeSpawned = true;
        }
      }
    }

    // Airliners/Fighters/Birds
    if (state.spawn.air <= 0) {
      const r = Math.random();
      if (r > 0.97) {
        state.entities.push({
          kind: "fighter",
          label: LABEL.FIGHTER,
          x: W() + 60,
          y: m2y(rnd(500, 3500)),
          w: SZ(144 * AIRCRAFT_SIZE_SCALE), h: SZ(96 * AIRCRAFT_SIZE_SCALE),
          vx: -(SPEED_BY_STAGE[3] * AIRCRAFT_SPEED_SCALE), // G4
          vy: rnd(-18, 18),
          ttl: 14,
        });
      } else if (r > 0.79) {
        state.entities.push({
          kind: "airliner",
          label: LABEL.AIRLINER,
          x: W() + 60,
          y: m2y(rnd(2500, 9000)),
          w: SZ(288 * AIRCRAFT_SIZE_SCALE), h: SZ(192 * AIRCRAFT_SIZE_SCALE),
          vx: -(SPEED_BY_STAGE[2] * AIRCRAFT_SPEED_SCALE), // G3
          vy: rnd(-10, 10),
          ttl: 22,
        });
      } else {
        // Birds are mostly low-altitude (0-200m), with rare higher groups.
        const birdChance = eHotChasing ? 0.45 : 0.50;
        if (chance(birdChance)) {
          const birdAlt = chance(eHotChasing ? 0.90 : 0.93) ? rnd(40, 200) : rnd(200, 500);
          state.entities.push({
            kind: "birds",
            label: LABEL.BIRDS,
            x: W() + 60,
            y: m2y(birdAlt),
            w: BIRD_DISPLAY_WIDTH, h: BIRD_DISPLAY_HEIGHT,
            vx: -160,
            vy: rnd(-8, 8),
            ttl: 20,
          });
        }
      }
      state.spawn.air = rnd(0.55, 1.10);
    }

    // Torpedo (ground -> sky) only in controlled zone
    if (!eHotChasing && state.controlled && state.spawn.torpedo <= 0) {
      if (chance(0.78)) {
        state.entities.push({
          kind: "torpedo",
          label: LABEL.TORPEDO,
          x: rnd(W() * 0.60, W() + 50),
          y: groundBasePx() - rnd(10, 60),
          w: SZ(66), h: SZ(100),
          vx: -55,
          vy: -rnd(120, 210),
          ttl: 7,
        });
      }
      state.spawn.torpedo = rnd(0.65, 1.15);
    }

    // Hot balloons (600m..2000m)
    if (state.spawn.balloon <= 0) {
      if (chance(0.86)) {
        const rr = Math.random();
        let kind = "k-hot-ball", label = LABEL.K_HOT_BAL;
        if (rr < 0.34 && !hasEHotBall) {
          kind = "e-hot-ball"; label = LABEL.E_HOT_BAL;
        } else if (rr < 0.67) {
          kind = "k-hot-ball"; label = LABEL.K_HOT_BAL;
        } else {
          kind = "n-hot-ball"; label = LABEL.N_HOT_BAL;
        }
        state.entities.push({
          kind,
          label,
          x: W() + rnd(20, 180),
          y: m2y(rnd(600, 2000)),
          w: SZ(96 * HOT_BALLOON_SIZE_SCALE), h: SZ(144 * HOT_BALLOON_SIZE_SCALE),
          vx: -rnd(45, 95),
          vy: rnd(-6, 6),
          ttl: 30,
          chasePending: kind === "e-hot-ball",
          // Keep chase trigger timing similar after lowering world speed.
          chaseTriggerScore: state.logicDistance + rnd(380, 580),
          chaseActive: false,
          chaseLeft: rnd(4.5, 6.2),
          chaseDistance: 0,
        });
      }
      state.spawn.balloon = rnd(2.8, 5.2);
    }

    // UFO (2000m..10000m): low probability, appears in view then rises out fast.
    if (!eHotChasing && state.spawn.ufo <= 0) {
      if (chance(0.18)) {
        let spawned = false;
        for (let i = 0; i < 6; i++) {
          const alt = rnd(2000, 10000);
          const y = m2y(alt);
          const sy = y + cameraOffsetY();
          if (sy < 50 || sy > H() - 120) continue;
          state.entities.push({
            kind: "ufo",
            label: LABEL.UFO,
            x: rnd(W() * 0.20, W() * 0.88),
            y,
            w: SZ(128), h: SZ(72),
            vx: 0,
            vy: 0,
            phase: "hover",
            hoverLeft: rnd(1.0, 2.0),
            hoverY: y,
            ttl: 8.8,
          });
          spawned = true;
          break;
        }
        if (!spawned) {
          const sy = rnd(70, H() * 0.45);
          const alt = clamp(y2m(sy - cameraOffsetY()), 2000, 10000);
          state.entities.push({
            kind: "ufo",
            label: LABEL.UFO,
            x: rnd(W() * 0.20, W() * 0.88),
            y: m2y(alt),
            w: SZ(128), h: SZ(72),
            vx: 0,
            vy: 0,
            phase: "hover",
            hoverLeft: rnd(1.0, 2.0),
            hoverY: m2y(alt),
            ttl: 8.8,
          });
        }
      }
      state.spawn.ufo = rnd(5.0, 10.5);
    }

    // Rewards
    if (state.spawn.reward <= 0) {
      if (chance(0.85)) {
        const rr = Math.random();
        let kind = "report200", label = LABEL.REPORT200, alt = rnd(180, 260);
        if (rr < 0.40) {
          kind = "report200"; label = LABEL.REPORT200; alt = rnd(170, 250);
        } else if (rr < 0.72) {
          kind = "report500"; label = LABEL.REPORT500; alt = rnd(430, 520);
        } else if (rr < 0.95) {
          kind = "special"; label = LABEL.SPECIAL; alt = rnd(260, 580);
        } else {
          const playerAlt = y2m(state.player.y + state.player.h * 0.5);
          kind = "shield";
          label = LABEL.SHIELD;
          alt = clamp(playerAlt + rnd(-260, 420), 120, metersWorldMax - 80);
        }
        state.entities.push({
          kind, label,
          x: W() + 60,
          y: m2y(alt),
          w: SZ(36), h: SZ(36),
          vx: -170,
          vy: 0,
          ttl: 18,
        });
      }
      state.spawn.reward = rnd(3.2, 6.2);
    }
  }

  function updatePlayer(dt) {
    const p = state.player;

    // Takeoff: move from left to center in ~2s
    if (state.phase === "takeoff") {
      state.phaseT += dt;
      const k = clamp(state.phaseT / 2.0, 0, 1);
      const target = W() * 0.5;
      p.screenX = 60 + (target - 60) * (1 - Math.pow(1 - k, 3)); // ease-out
      if (k >= 1) {
        state.phase = "run";
        p.screenX = target;
      }
    } else {
      // Run: keep horizontally centered; no left/right movement
      state.camOffsetX = 0;
      p.screenX = W() * 0.5;
    }

    // Vertical movement
    let ay = 0;
    if (input.up) ay -= PLAYER_VERTICAL_ACCEL;
    if (input.down) ay += PLAYER_VERTICAL_ACCEL;

    p.vy += ay * dt;
    p.vy *= Math.pow(0.88, dt * 60);
    p.vy = clamp(p.vy, -PLAYER_VERTICAL_MAX_SPEED, PLAYER_VERTICAL_MAX_SPEED);

    p.y += p.vy * dt;
    p.y = clamp(p.y, m2y(metersWorldMax), groundBasePx() - SZ(30));
  }

  function updateEntities(dt, spd) {
    const camY = cameraOffsetY();
    for (const e of state.entities) {
      const sy = e.y + camY;
      const inView = e.x < W() && (e.x + e.w) > 0 && sy < H() && (sy + e.h) > 0;
      const worldDrift = spd * (e.kind === "torpedo" ? 0.72 : 0.55);
      if ((e.kind === "fighter" || e.kind === "airliner") && !e.jetAnnounced) {
        if (inView) {
          e.jetAnnounced = true;
          AudioBus.jet();
        }
      }
      if (e.kind === "ufo" && !e.ufoAnnounced && inView) {
        e.ufoAnnounced = true;
        AudioBus.ufo();
      }
      if (
        e.kind === "e-hot-ball" &&
        e.chasePending &&
        !e.chaseActive &&
        state.logicDistance >= (e.chaseTriggerScore || 0) &&
        e.x < W() + 140
      ) {
        e.chasePending = false;
        e.chaseActive = true;
      }
      if (e.kind === "e-hot-ball" && e.chaseActive) {
        const chaseSpeed = SPEED_BY_STAGE[0] * 1.2; // 1.2 * G1
        const tx = state.player.screenX + state.player.w * 0.5 - e.w * 0.5;
        const ty = state.player.y + state.player.h * 0.5 - e.h * 0.5;
        const dx = tx - e.x;
        const dy = ty - e.y;
        const dist = Math.hypot(dx, dy) + 1e-6;
        const desiredVX = (dx / dist) * chaseSpeed;
        const desiredVY = (dy / dist) * chaseSpeed * 0.65;
        e.vx += (desiredVX - e.vx) * (1 - Math.pow(0.06, dt * 60));
        e.vy += (desiredVY - e.vy) * (1 - Math.pow(0.08, dt * 60));
        // Use world-space drift like other entities; at very high player speed it should not unrealistically catch up.
        e.x += (e.vx - worldDrift) * dt;
        e.y += e.vy * dt;
        e.chaseLeft -= dt;
        e.chaseDistance += chaseSpeed * dt;
        e.ttl -= dt;
        if (e.chaseLeft <= 0 || e.chaseDistance >= W() * 1.8) {
          e.chaseActive = false;
          e.vx = -rnd(50, 95);
          e.vy = rnd(-8, 8);
        }
      } else if (e.kind === "k-hot-ball" || e.kind === "n-hot-ball") {
        // Active avoidance: steer away from player when too close.
        const px = state.player.screenX + state.player.w * 0.5;
        const py = state.player.y + state.player.h * 0.5;
        const ex = e.x + e.w * 0.5;
        const ey = e.y + e.h * 0.5;
        const dx = ex - px;
        const dy = ey - py;
        const dist = Math.hypot(dx, dy) + 1e-6;
        const avoidRadius = 280;
        const baseVx = -rnd(45, 95);
        const baseVy = rnd(-6, 6);
        if (dist < avoidRadius) {
          const t = (avoidRadius - dist) / avoidRadius;
          const avoidSpeed = SPEED_BY_STAGE[0] * (0.9 + 0.7 * t);
          const desiredVX = (dx / dist) * avoidSpeed;
          const desiredVY = (dy / dist) * avoidSpeed * 0.8;
          e.vx += (desiredVX - e.vx) * (1 - Math.pow(0.15, dt * 60));
          e.vy += (desiredVY - e.vy) * (1 - Math.pow(0.18, dt * 60));
        } else {
          e.vx += (baseVx - e.vx) * (1 - Math.pow(0.08, dt * 60));
          e.vy += (baseVy - e.vy) * (1 - Math.pow(0.10, dt * 60));
        }
        e.x += (e.vx - worldDrift) * dt;
        e.y += e.vy * dt;
        e.ttl -= dt;
      } else if (e.kind === "ufo") {
        if (e.phase === "hover") {
          // Hover in view for a short time, then switch to rapid ascent.
          e.hoverLeft -= dt;
          const desiredXDrift = worldDrift;
          e.vx += (desiredXDrift - e.vx) * (1 - Math.pow(0.12, dt * 60));
          e.x += (e.vx - worldDrift) * dt;
          e.y = (e.hoverY || e.y) + Math.sin(state.t * 4.2 + e.x * 0.015) * 5;
          if (e.hoverLeft <= 0) {
            e.phase = "rise";
            e.vy = -(SPEED_G5 * 3);
          }
        } else {
          // Keep UFO roughly in player view while it shoots upward.
          const desiredXDrift = worldDrift;
          e.vx += (desiredXDrift - e.vx) * (1 - Math.pow(0.12, dt * 60));
          e.x += (e.vx - worldDrift) * dt;
          e.y += e.vy * dt;
        }
        e.ttl -= dt;
      } else {
        e.x += (e.vx - worldDrift) * dt;
        e.ttl -= dt;
      }

      if (e.kind === "birds" && e.dizzy) {
        e.rot = Math.PI / 2;
        e.vy = (e.vy || 0) + 980 * dt;
        e.y += e.vy * dt;

        const groundY = groundBasePx() - terrain.heightAt(state.worldX + e.x);
        const maxY = groundY - e.h;
        if (e.y > maxY) {
          e.y = maxY;
          if ((e.bouncesLeft || 0) > 0 && Math.abs(e.vy || 0) > 90) {
            e.vy = -Math.abs(e.vy) * 0.45;
            e.bouncesLeft -= 1;
          } else {
            e.vy = 0;
            e.vx *= 0.97;
          }
        }
        continue;
      }

      if (e.kind !== "e-hot-ball" && e.kind !== "ufo" && e.kind !== "k-hot-ball" && e.kind !== "n-hot-ball") {
        e.y += (e.vy || 0) * dt;
      }

      if (e.kind === "birds") {
        e.y += Math.sin((state.t * 2.0) + e.x * 0.01) * 8 * dt;
      } else if (e.kind === "k-hot-ball" || e.kind === "n-hot-ball") {
        e.y += Math.sin((state.t * 1.3) + e.x * 0.006) * 10 * dt;
      }

      // Keep ambient flyers flowing forward (leftward) after shield repel to avoid reverse flight.
      if ((e.kind === "birds" || e.kind === "airliner" || e.kind === "fighter") && e.vx > -20) {
        e.vx = -20;
      }

      // Keep flying entities above terrain to avoid "underground flight".
      const isFlying =
        (e.kind === "birds" && !e.dizzy) ||
        e.kind === "airliner" ||
        e.kind === "fighter" ||
        e.kind === "e-hot-ball" ||
        e.kind === "k-hot-ball" ||
        e.kind === "n-hot-ball" ||
        e.kind === "ufo" ||
        e.kind === "report200" ||
        e.kind === "report500" ||
        e.kind === "special" ||
        e.kind === "shield";
      if (isFlying) {
        const groundY = groundBasePx() - terrain.heightAt(state.worldX + e.x);
        const minClearance = (e.kind === "birds") ? 14 : 10;
        const maxY = groundY - e.h - minClearance;
        if (e.y > maxY) {
          e.y = maxY;
          if ((e.vy || 0) > 0) e.vy = -(e.vy || 0) * 0.35;
        }
      }

      // Shield repels all non-reward entities (police is not in this list and remains unaffected).
      if (state.shield > 0) {
        const isReward =
          e.kind === "report200" ||
          e.kind === "report500" ||
          e.kind === "special" ||
          e.kind === "shield";
        if (!isReward) {
          const px = state.player.screenX + state.player.w * 0.5;
          const py = state.player.y + state.player.h * 0.5;
          const ex = e.x + e.w * 0.5;
          const ey = e.y + e.h * 0.5;
          const dx = ex - px;
          const dy = ey - py;
          const dist = Math.hypot(dx, dy) + 1e-6;
          const shieldR = Math.max(state.player.w, state.player.h) * 0.95 + 24;
          const entityR = Math.max(e.w, e.h) * 0.45;
          const avoidR = shieldR + entityR + 36;
          if (dist < avoidR) {
            const nx = dx / dist;
            const ny = dy / dist;
            const push = (avoidR - dist);
            e.x += nx * push * 0.55;
            e.y += ny * push * 0.55;
            const repelSpeed = SPEED_BY_STAGE[2] * 0.9;
            e.vx += nx * repelSpeed * dt * 1.6;
            e.vy += ny * repelSpeed * dt * 1.2;
          }
        }
      }
    }
    state.entities = state.entities.filter(e =>
      e.ttl > 0 &&
      e.x > -200 &&
      e.x < W() + 240 &&
      (e.y + camY) > -260 &&
      (e.y + camY) < H() + 260
    );
  }

  function updatePolice(dt, spd) {
    const p = state.player;
    const cop = state.police;
    const alt = y2m(p.y + p.h * 0.5);

    // Chase condition:
    // - Controlled zone: chase
    // - Fly zone: chase only if alt > 120
    const shouldChase = (state.controlled || (!state.controlled && alt > 120));

    // Amnesty
    if (state.amnesty > 0) state.amnesty = Math.max(0, state.amnesty - dt);

    const active = shouldChase && state.amnesty <= 0;
    AudioBus.setPoliceActive(active);

    if (!active) {
      cop.active = false;
      cop.x = Math.min(cop.x, -220);
      cop.vx = 0;
      cop.vy = 0;
      return;
    }

    if (!cop.active) {
      cop.active = true;
      cop.x = -rnd(160, 360); // can be offscreen
      cop.y = p.y + rnd(-40, 40);
      cop.vx = 0; cop.vy = 0;
    }

    // Altitude-driven speed profile (fixed bands):
    // <200m: 1.2 * G1
    // 200..1000m: G2
    // 1000..3000m: G3
    // 3000..4000m: G4
    // 4000..5000m: G5
    // >=5000m: 1.5 * G5
    let copCruise = SPEED_BY_STAGE[0] * 1.2;
    if (alt >= 5000) copCruise = SPEED_G5 * 1.5;
    else if (alt >= 4000) copCruise = SPEED_G5;
    else if (alt >= 3000) copCruise = SPEED_BY_STAGE[3];
    else if (alt >= 1000) copCruise = SPEED_BY_STAGE[2];
    else if (alt >= 200) copCruise = SPEED_BY_STAGE[1];

    const targetX = p.screenX + p.w * 0.5 - cop.w * 0.5;
    const dx = targetX - cop.x;
    const dy = p.y - cop.y;

    // Keep X speed bounded by altitude-banded cruise speed:
    // allow deceleration when police is ahead, but never allow burst above copCruise.
    let desiredVx = copCruise;
    if (dx < -6) {
      desiredVx = clamp(copCruise + dx * 2.8, 0, copCruise);
    }

    // If Y is off-line, increase vertical chase response so police pulls back quickly.
    let desiredVy = clamp(dy * 2.2, -copCruise * 1.05, copCruise * 1.05);
    if (Math.abs(dy) > 14) {
      const minTrackVy = Math.min(220, copCruise * 0.35);
      if (Math.abs(desiredVy) < minTrackVy) desiredVy = Math.sign(dy) * minTrackVy;
    }

    cop.vx += (desiredVx - cop.vx) * (1 - Math.pow(0.007, dt * 60));
    cop.vy += (desiredVy - cop.vy) * (1 - Math.pow(0.007, dt * 60));
    cop.vx = clamp(cop.vx, 0, copCruise);

    // Apply world drift so police must beat player forward speed to close in.
    cop.x += (cop.vx - spd) * dt;
    cop.y += cop.vy * dt;
    if (cop.x > targetX) {
      cop.x = targetX;
      if (cop.vx > spd) cop.vx = spd;
    }
    cop.y = clamp(cop.y, m2y(metersWorldMax), groundBasePx() - SZ(30));

    // Catch: either box overlap or very close center distance.
    const pcx = p.screenX + p.w * 0.5;
    const pcy = p.y + p.h * 0.5;
    const ccx = cop.x + cop.w * 0.5;
    const ccy = cop.y + cop.h * 0.5;
    const hb = playerHitbox();
    const cb = policeHitbox(cop);
    const nearCatch = Math.hypot(pcx - ccx, pcy - ccy) <= Math.min(hb.w, cb.w) * 0.48;
    const catchOverlap = aabb(hb.x - 5, hb.y - 5, hb.w + 10, hb.h + 10, cb.x, cb.y, cb.w, cb.h);
    const xLocked = Math.abs(pcx - ccx) <= Math.min(hb.w, cb.w) * 0.34;
    const yClose = Math.abs(pcy - ccy) <= Math.max(hb.h, cb.h) * 0.95;
    if (nearCatch || catchOverlap || (xLocked && yClose)) {
      triggerImpact(p.screenX + p.w * 0.5, p.y + p.h * 0.5, "#ff4d6d");
      startCrash(t(REASON, "caught_police", ""), "freeze");
    }
  }

  function triggerImpact(x, y, color = "#ffd166") {
    state.impact = { at: performance.now(), x, y, color };
  }

  function pushPickupToast(text) {
    if (!text) return;
    const p = state.player;
    state.pickupToasts.push({
      text,
      x: p.screenX + p.w * 0.5,
      y: p.y - 8,
      vy: -34,
      life: 1.15,
      maxLife: 1.15,
    });
  }

  function updatePickupToasts(dt) {
    if (!state.pickupToasts || state.pickupToasts.length === 0) return;
    for (const tToast of state.pickupToasts) {
      tToast.y += tToast.vy * dt;
      tToast.life -= dt;
    }
    state.pickupToasts = state.pickupToasts.filter(tToast => tToast.life > 0);
  }

  function updateVillageDogs(nowSec) {
    if (!terrain.getDogsNear) return;
    const playerWx = state.worldX + state.player.screenX;
    const nearDogs = terrain.getDogsNear(playerWx, 320);
    const nextActive = {};
    const nextOverhead = {};
    const nextLastDx = {};
    const playerAlt = y2m(state.player.y + state.player.h * 0.5);
    for (const d of nearDogs) {
      nextActive[d.id] = true;
      const dx = Number(d.dx) || 0;
      const isOverhead = Math.abs(dx) <= 56;
      const wasOverhead = !!state.dogOverheadState[d.id];
      const prevDxRaw = state.dogLastDx[d.id];
      const prevDx = Number.isFinite(prevDxRaw) ? prevDxRaw : null;
      const crossedOverhead =
        Number.isFinite(prevDx) &&
        ((prevDx > 0 && dx <= 0) || (prevDx < 0 && dx >= 0));
      const last = state.dogBarkCooldown[d.id] || -999;
      // Bark when drone passes over dog's head at low altitude.
      if ((crossedOverhead || (isOverhead && !wasOverhead)) && playerAlt <= 420 && nowSec - last > 1.2) {
        AudioBus.bark();
        state.dogBarkCooldown[d.id] = nowSec;
      }
      nextOverhead[d.id] = isOverhead;
      nextLastDx[d.id] = dx;
    }
    state.dogActiveIds = nextActive;
    state.dogOverheadState = nextOverhead;
    state.dogLastDx = nextLastDx;
  }

  function isOceanAtPlayer() {
    const wx = state.worldX + state.player.screenX + state.player.w * 0.5;
    return terrain.biomeAt(wx) === "ocean";
  }

  function triggerWaterSplash(x, y, power = 1.0) {
    const n = Math.floor(18 * power);
    for (let i = 0; i < n; i++) {
      const a = (-Math.PI * 0.9) + (Math.PI * 1.8) * (i / Math.max(1, n - 1));
      const sp = rnd(80, 230) * power;
      state.waterSplashes.push({
        x,
        y,
        vx: Math.cos(a) * sp * rnd(0.35, 1.0),
        vy: -Math.abs(Math.sin(a)) * sp * rnd(0.45, 1.1),
        life: rnd(0.45, 0.9),
        maxLife: 0.9,
        r: rnd(1.2, 3.4),
      });
    }
  }

  function updateWaterSplashes(dt) {
    if (!state.waterSplashes || state.waterSplashes.length === 0) return;
    for (const p of state.waterSplashes) {
      p.vy += 520 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    state.waterSplashes = state.waterSplashes.filter(p => p.life > 0);
  }

  function startCrash(reason, sfx = "crashed") {
    if (state.gameOver || state.crash.active) return;
    state.crash.active = true;
    state.crash.reason = reason;
    state.crash.bouncesLeft = 3;
    state.player.vy = 90;
    if (sfx === "duck") AudioBus.duckCrashed();
    else if (sfx === "freeze") AudioBus.freeze();
    else AudioBus.crashed();
  }

  function updateCrash(dt) {
    const p = state.player;
    p.vy += 980 * dt;
    p.vy = Math.min(p.vy, 980);
    p.y += p.vy * dt;

    const hb = playerHitbox();
    const groundY = groundBasePx() - terrain.heightAt(state.worldX + p.screenX);
    if (hb.y + hb.h >= groundY) {
      if (isOceanAtPlayer()) {
        state.crash.active = false;
        state.gameOver = true;
        state.reason = t(REASON, "crashed_water", "坠入水面");
        AudioBus.setGameplayActive(false);
        AudioBus.failed();
        clearInput();
        triggerWaterSplash(p.screenX + p.w * 0.5, groundY - 2, 1.35);
        return;
      }
      const dy = (hb.y + hb.h) - groundY;
      p.y -= dy;
      if (state.crash.bouncesLeft > 0 && Math.abs(p.vy) > 120) {
        triggerImpact(p.screenX + p.w * 0.5, groundY - 2, "#ffb34d");
        AudioBus.crashed();
        p.vy = -p.vy * 0.42;
        state.crash.bouncesLeft -= 1;
      } else {
        state.crash.active = false;
        state.gameOver = true;
        state.reason = state.crash.reason || t(REASON, "crashed", "");
        AudioBus.setGameplayActive(false);
        AudioBus.failed();
        clearInput();
        triggerImpact(p.screenX + p.w * 0.5, groundY - 2, "#ff9f1c");
      }
    }
  }

  function updateAlarm() {
    const p = state.player;
    const alt = y2m(p.y + p.h * 0.5);
    state.alarm = (alt > 120) || state.controlled;
  }

  function recoverEntitiesAfterShield(spd) {
    for (const e of state.entities) {
      const isReward =
        e.kind === "report200" ||
        e.kind === "report500" ||
        e.kind === "special" ||
        e.kind === "shield";
      if (isReward) continue;

      // Force immediate forward flow (leftward in screen space) once shield expires.
      const forwardVx = (e.kind === "torpedo")
        ? -Math.max(80, spd * 0.20)
        : -Math.max(140, spd * 0.40);
      e.vx = forwardVx;
      e.vy = (e.vy || 0) * 0.35;
    }
  }

  function handleCollisions() {
    if (state.gameOver || state.crash.active) return;
    const p = state.player;
    const hb = playerHitbox();

    // Ground collision
    const groundY = groundBasePx() - terrain.heightAt(state.worldX + p.screenX);
    if (hb.y + hb.h > groundY) {
      if (state.shield > 0) {
        p.y -= (hb.y + hb.h - groundY) + 1;
      } else {
        triggerImpact(p.screenX + p.w * 0.5, groundY - 2, "#ff9f1c");
        state.gameOver = true;
        if (isOceanAtPlayer()) {
          state.reason = t(REASON, "crashed_water", "坠入水面");
          triggerWaterSplash(p.screenX + p.w * 0.5, groundY - 2, 1.2);
        } else {
          state.reason = t(REASON, "crashed_terrain", "撞击地形");
        }
        AudioBus.setGameplayActive(false);
        AudioBus.failed();
        clearInput();
        return;
      }
    }

    // Entity collision
    for (const e of state.entities) {
      const eh = entityHitbox(e);
      if (!aabb(hb.x, hb.y, hb.w, hb.h, eh.x, eh.y, eh.w, eh.h)) continue;

      // Rewards
      if (e.kind === "report200" || e.kind === "report500" || e.kind === "special") {
        state.amnesty = 15.0;
        state.police.active = false;
        state.police.x = -320;
        if (e.kind === "report200") pushPickupToast(t(UI, "toast_report200", ""));
        else if (e.kind === "report500") pushPickupToast(t(UI, "toast_report500", ""));
        else pushPickupToast(t(UI, "toast_special", ""));
        e.ttl = -1;
        continue;
      }
      if (e.kind === "shield") {
        state.shield = Math.max(state.shield, 15.0);
        pushPickupToast(t(UI, "toast_shield", ""));
        e.ttl = -1;
        continue;
      }

      // Invincible shield: no collisions with non-police objects.
      if (state.shield > 0) {
        const px = p.screenX + p.w * 0.5;
        const py = p.y + p.h * 0.5;
        const ex = e.x + e.w * 0.5;
        const ey = e.y + e.h * 0.5;
        const dx = ex - px;
        const dy = ey - py;
        const dist = Math.hypot(dx, dy) + 1e-6;
        const nx = dx / dist;
        const ny = dy / dist;
        e.x += nx * 26;
        e.y += ny * 22;
        e.vx += nx * SPEED_BY_STAGE[2] * 0.4;
        e.vy += ny * SPEED_BY_STAGE[1] * 0.35;
        continue;
      }

      // Otherwise, crash
      if (e.kind === "birds" && !e.dizzy) {
        e.dizzy = true;
        e.rot = Math.PI / 2;
        e.vy = Math.max(150, Math.abs(e.vy || 0) + 120);
        e.bouncesLeft = 2;
        e.ttl = Math.max(e.ttl, 6);
      }
      triggerImpact(p.screenX + p.w * 0.5, p.y + p.h * 0.5, "#ffd166");
      startCrash(`Crashed into ${e.label}`, e.kind === "birds" ? "duck" : "crashed");
      return;
    }
  }

  function update(dt) {
    updateWaterSplashes(dt);
    if (state.gameOver) return;
    state.t += dt;
    updatePickupToasts(dt);
    updateVillageDogs(state.t);

    updateZone();
    updateBoostLevel(dt);
    const displaySpd = updateWorldSpeed(dt);
    const spd = displaySpd * VISUAL_SPEED_SCALE;
    const hadShield = state.shield > 0;
    if (hadShield) {
      state.shield = Math.max(0, state.shield - dt);
      if (state.shield <= 0) recoverEntitiesAfterShield(spd);
    }
    state.worldX += spd * dt;
    // Keep gameplay progression on internal world speed.
    state.logicDistance = state.worldX * WORLD_UNIT_TO_METER;
    // Keep HUD distance consistent with displayed speed scale (10~60 m/s).
    state.score += toDisplaySpeedMs(displaySpd) * dt;

    if (state.crash.active) {
      // Keep third-party entities running on their normal trajectories during crash animation.
      updateCrash(dt);
      spawnEntities(dt, spd);
      updateEntities(dt, spd);
      updatePolice(dt, spd);
      updateAlarm();
      notifyGameOverOnce();
      return;
    }

    updatePlayer(dt);
    spawnEntities(dt, spd);
    updateEntities(dt, spd);
    updatePolice(dt, spd);
    updateAlarm();
    handleCollisions();
    notifyGameOverOnce();
  }

  function notifyGameOverOnce() {
    if (!state || !state.gameOver || state.gameOverNotified) return;
    state.gameOverNotified = true;
    if (window && typeof window.dispatchEvent === "function") {
      window.dispatchEvent("gameover", {
        score: Math.floor(state.score || 0),
        logicDistance: Math.floor(state.logicDistance || 0),
        reason: state.reason || "",
      });
    }
  }

  // ---------- Drawing ----------
  function drawBackground(camY) {
    const sky = syncSkyFromClock();
    if (!sky.isNight) {
      // Day
      const g = ctx.createLinearGradient(0, 0, 0, H());
      g.addColorStop(0, "#7dd3fc");
      g.addColorStop(0.55, "#1b2b66");
      g.addColorStop(1, "#0b1020");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W(), H());

      // Sun
      const sunX = W() * sky.sunXRatio;
      const sunY = H() * sky.sunYRatio;
      const rg = ctx.createRadialGradient(sunX, sunY, 10, sunX, sunY, 90);
      rg.addColorStop(0, "rgba(255,255,255,0.95)");
      rg.addColorStop(1, "rgba(255,210,120,0.0)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(sunX, sunY, 90, 0, Math.PI * 2);
      ctx.fill();

      // Clouds (parallax)
      ctx.save();
      const drift = state.worldX * 0.03;
      for (const c of state.clouds) {
        const pad = c.r * 3.2;
        const span = W() + pad * 2;
        const x = (c.x - drift * c.layer) % span;
        const cx = x < -pad ? x + span : x;
        const y = c.y + camY * (0.13 + (1 - c.layer) * 0.12);

        ctx.globalAlpha = c.alpha * 0.65;
        ctx.fillStyle = "rgba(130,160,195,0.45)";
        ctx.beginPath();
        ctx.ellipse(cx + 4, y + c.r * 0.42, c.r * 1.15, c.r * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = c.alpha;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.ellipse(cx, y, c.r, c.r * 0.82, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + c.r * 0.95, y + 6, c.r * 0.78, c.r * 0.62, 0, 0, Math.PI * 2);
        ctx.ellipse(cx - c.r * 0.88, y + 9, c.r * 0.7, c.r * 0.56, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + c.r * 0.2, y - c.r * 0.34, c.r * 0.58, c.r * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = c.alpha * 0.32;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.ellipse(cx - c.r * 0.12, y - c.r * 0.23, c.r * 0.46, c.r * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else {
      // Night
      const g = ctx.createLinearGradient(0, 0, 0, H());
      g.addColorStop(0, "#050a1a");
      g.addColorStop(0.55, "#0b1020");
      g.addColorStop(1, "#050611");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W(), H());

      // Stars
      ctx.save();
      ctx.globalAlpha = 0.75;
      for (const st of state.stars) {
        const x = (st.x - state.worldX * 0.06) % W();
        const xx = x < 0 ? x + W() : x;
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.fillRect(xx, st.y, st.s, st.s);
      }
      ctx.restore();

      // Moon
      const mx = W() * sky.moonXRatio;
      const my = H() * sky.moonYRatio;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.arc(mx, my, 32, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath(); ctx.arc(mx + 12, my - 6, 30, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
    }
  }

  function drawTerrain() {
    terrain.draw({
      ctx,
      baseWorldX: state.worldX,
      screenW: W(),
      screenH: H(),
      groundBaseY: groundBasePx(),
      isNight,
      activeDogIds: state.dogActiveIds,
      phase: state.t,
    });
  }

  function drawAlarmOverlay() {
    if (!state.alarm) return;
    const inControlled = state.controlled;
    const c0 = inControlled ? "rgba(255, 40, 40, 0.18)" : "rgba(255, 60, 60, 0.06)";
    const c1 = inControlled ? "rgba(255, 35, 35, 0.30)" : "rgba(255, 60, 60, 0.12)";
    const c2 = inControlled ? "rgba(255, 30, 30, 0.46)" : "rgba(255, 60, 60, 0.20)";
    const g = ctx.createRadialGradient(W() * 0.5, H() * 0.55, 60, W() * 0.5, H() * 0.55, Math.max(W(), H()));
    g.addColorStop(0.0, c0);
    g.addColorStop(0.6, c1);
    g.addColorStop(1.0, c2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W(), H());
  }

  function drawAltitudeAxis() {
    const camY = cameraOffsetY();
    const x = 10;
    const panelW = 76;
    const yTop = 64;
    const yBottom = H() - 1;
    const axisX = x + panelW - 14;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.26)";
    ctx.fillRect(x, yTop, panelW, yBottom - yTop);

    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(axisX, yTop);
    ctx.lineTo(axisX, yBottom);
    ctx.stroke();

    ctx.font = buildGameFont(11);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const altTop = clamp(y2m(yTop - camY), 0, metersWorldMax);
    const altBottom = clamp(y2m(yBottom - camY), 0, metersWorldMax);
    const aMin = Math.min(altTop, altBottom);
    const aMax = Math.max(altTop, altBottom);
    // 0-200m: 100m major (20m minor). Above 200m: 1000m major.
    const lowCap = 200;
    const lowMinor = 20;
    const lowMajor = 100;
    const lowStart = Math.floor(aMin / lowMinor) * lowMinor;
    const lowEnd = Math.min(lowCap, Math.ceil(aMax / lowMinor) * lowMinor);
    for (let m = lowStart; m <= lowEnd; m += lowMinor) {
      const y = m2y(m) + camY;
      if (y < yTop || y > yBottom) continue;
      const major = (m % lowMajor === 0);
      const tickLen = major ? 10 : 6;
      ctx.strokeStyle = major ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.moveTo(axisX - tickLen, y);
      ctx.lineTo(axisX, y);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillText(`${m}m`, axisX - tickLen - 3, y);
      }
    }

    // Always pin the 0m mark to axis bottom so the coordinate baseline is explicit.
    ctx.strokeStyle = "rgba(255,255,255,0.82)";
    ctx.beginPath();
    ctx.moveTo(axisX - 10, yBottom);
    ctx.lineTo(axisX, yBottom);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText("0m", axisX - 13, yBottom);

    const hiStart = Math.max(1000, Math.floor(aMin / 1000) * 1000);
    const hiEnd = Math.min(metersWorldMax, Math.ceil(aMax / 1000) * 1000);
    for (let m = hiStart; m <= hiEnd; m += 1000) {
      const y = m2y(m) + camY;
      if (y < yTop || y > yBottom) continue;
      ctx.strokeStyle = "rgba(255,255,255,0.78)";
      ctx.beginPath();
      ctx.moveTo(axisX - 10, y);
      ctx.lineTo(axisX, y);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText(`${m}m`, axisX - 13, y);
    }

    // Alert threshold marker (120m)
    const y120 = m2y(120) + camY;
    if (y120 >= yTop && y120 <= yBottom) {
      ctx.strokeStyle = "rgba(255,80,80,0.9)";
      ctx.beginPath();
      ctx.moveTo(axisX - 12, y120);
      ctx.lineTo(axisX, y120);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,110,110,0.95)";
      ctx.fillText("120m", axisX - 15, y120 - 10);
    }

    // Current altitude marker
    const alt = y2m(state.player.y + state.player.h * 0.5);
    const py = m2y(alt) + camY;
    ctx.strokeStyle = "#4cc9f0";
    ctx.beginPath();
    ctx.moveTo(axisX - 14, py);
    ctx.lineTo(axisX + 1, py);
    ctx.stroke();
    ctx.fillStyle = "#7dd3fc";
    ctx.fillText(`${alt.toFixed(0)}m`, axisX - 18, py - 10);
    ctx.restore();
  }

  function drawImpactFX() {
    if (!state.impact) return;
    const life = 420;
    const elapsed = performance.now() - state.impact.at;
    if (elapsed >= life) {
      state.impact = null;
      return;
    }
    const t = elapsed / life;
    const r = 8 + 44 * t;
    const alpha = 1 - t;

    ctx.save();
    ctx.globalAlpha = 0.85 * alpha;
    ctx.strokeStyle = state.impact.color || "#ffd166";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(state.impact.x, state.impact.y, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.55 * alpha;
    ctx.beginPath();
    ctx.moveTo(state.impact.x - r * 0.8, state.impact.y);
    ctx.lineTo(state.impact.x + r * 0.8, state.impact.y);
    ctx.moveTo(state.impact.x, state.impact.y - r * 0.8);
    ctx.lineTo(state.impact.x, state.impact.y + r * 0.8);
    ctx.stroke();
    ctx.restore();
  }

  function drawWaterSplashes() {
    if (!state.waterSplashes || state.waterSplashes.length === 0) return;
    ctx.save();
    for (const p of state.waterSplashes) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = "rgba(205, 241, 255, 0.95)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEntities() {
    function drawRewardBubble(e, sprite, theme) {
      const rgba = (rgb, a) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
      const cx = e.x + e.w * 0.5;
      const cy = e.y + e.h * 0.5;
      const pulse = 1 + Math.sin(state.t * 3.2 + cx * 0.02) * 0.08;
      const r = Math.max(e.w, e.h) * 0.9 * pulse;
      const coreAlpha = 0.62 + Math.sin(state.t * 3.2 + cx * 0.02) * 0.08;

      ctx.save();
      ctx.translate(cx, cy);

      const halo = ctx.createRadialGradient(0, 0, r * 0.25, 0, 0, r * 1.45);
      halo.addColorStop(0, rgba(theme.halo, 0.62));
      halo.addColorStop(1, rgba(theme.halo, 0.0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2);
      ctx.fill();

      const bubble = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.2, 0, 0, r);
      bubble.addColorStop(0, rgba(theme.inner, Math.min(0.98, coreAlpha + 0.22)));
      bubble.addColorStop(1, rgba(theme.outer, coreAlpha));
      ctx.fillStyle = bubble;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = rgba(theme.stroke, 0.98);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,0.70)";
      ctx.beginPath();
      ctx.ellipse(-r * 0.35, -r * 0.42, r * 0.32, r * 0.19, -0.35, 0, Math.PI * 2);
      ctx.fill();

      if (sprite.ready()) {
        const icon = r * 1.35;
        ctx.drawImage(sprite.img, -icon * 0.5, -icon * 0.5, icon, icon);
      } else {
        ctx.fillStyle = "#7a5b14";
        ctx.font = buildGameFont(10, "700");
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(e.label, 0, 0);
      }
      ctx.restore();
    }

    const birdFrame = (Math.floor(state.t / 0.25) % 2 === 0) ? birdUpSprite : birdDownSprite;
    for (const e of state.entities) {
      if (e.kind === "birds") {
        const sprite = e.dizzy ? birdDizzySprite : birdFrame;
        if (sprite.ready()) {
          ctx.save();
          if (e.dizzy) {
            const cx = e.x + e.w * 0.5;
            const cy = e.y + e.h * 0.5;
            ctx.translate(cx, cy);
            ctx.rotate(Math.PI / 2);
            drawNormalizedSprite(sprite.img, -e.w * 0.5, -e.h * 0.5, e.w, e.h);
          } else {
            drawNormalizedSprite(sprite.img, e.x, e.y, e.w, e.h);
          }
          ctx.restore();
        } else {
          drawLabeledBox(e.x, e.y, e.w, e.h, palette.birds, e.label);
        }
        continue;
      }
      if (e.kind === "fighter") {
        if (fighterJetSprite.ready()) {
          ctx.drawImage(fighterJetSprite.img, e.x, e.y, e.w, e.h);
        } else {
          drawLabeledBox(e.x, e.y, e.w, e.h, palette.fighter, e.label);
        }
        continue;
      }
      if (e.kind === "airliner") {
        if (airlinerSprite.ready()) {
          ctx.drawImage(airlinerSprite.img, e.x, e.y, e.w, e.h);
        } else {
          drawLabeledBox(e.x, e.y, e.w, e.h, palette.airliner, e.label);
        }
        continue;
      }
      if (e.kind === "torpedo") {
        if (torpedoSprite.ready()) {
          ctx.drawImage(torpedoSprite.img, e.x, e.y, e.w, e.h);
        } else {
          drawLabeledBox(e.x, e.y, e.w, e.h, palette.torpedo, e.label);
        }
        continue;
      }
      if (e.kind === "e-hot-ball") {
        if (eHotBallSprite.ready()) {
          ctx.drawImage(eHotBallSprite.img, e.x, e.y, e.w, e.h);
        } else {
          drawLabeledBox(e.x, e.y, e.w, e.h, palette.ehot, e.label);
        }
        continue;
      }
      if (e.kind === "k-hot-ball") {
        if (kHotBallSprite.ready()) {
          ctx.drawImage(kHotBallSprite.img, e.x, e.y, e.w, e.h);
        } else {
          drawLabeledBox(e.x, e.y, e.w, e.h, palette.khot, e.label);
        }
        continue;
      }
      if (e.kind === "n-hot-ball") {
        if (nHotBallSprite.ready()) {
          ctx.drawImage(nHotBallSprite.img, e.x, e.y, e.w, e.h);
        } else {
          drawLabeledBox(e.x, e.y, e.w, e.h, palette.nhot, e.label);
        }
        continue;
      }
      if (e.kind === "ufo") {
        if (ufoSprite.ready()) {
          ctx.drawImage(ufoSprite.img, e.x, e.y, e.w, e.h);
        } else {
          drawLabeledBox(e.x, e.y, e.w, e.h, palette.ufo, e.label);
        }
        continue;
      }
      if (e.kind === "report200") {
        drawRewardBubble(e, reward200Sprite, {
          halo: [203, 255, 206],
          inner: [245, 255, 233],
          outer: [175, 236, 170],
          stroke: [226, 255, 209],
        });
        continue;
      }
      if (e.kind === "report500") {
        drawRewardBubble(e, reward500Sprite, {
          halo: [255, 248, 182],
          inner: [255, 252, 224],
          outer: [255, 231, 145],
          stroke: [255, 245, 190],
        });
        continue;
      }
      if (e.kind === "special") {
        drawRewardBubble(e, rewardSpecSprite, {
          halo: [234, 204, 255],
          inner: [249, 239, 255],
          outer: [209, 168, 243],
          stroke: [239, 219, 255],
        });
        continue;
      }
      if (e.kind === "shield") {
        drawRewardBubble(e, shieldRewardSprite, {
          halo: [240, 248, 255],
          inner: [255, 255, 255],
          outer: [216, 232, 248],
          stroke: [245, 252, 255],
        });
        continue;
      }

      const c = ({
        airliner: palette.airliner,
        fighter: palette.fighter,
        birds: palette.birds,
        torpedo: palette.torpedo,
        shield: palette.shield,
        report200: palette.report200,
        report500: palette.report500,
        special: palette.special,
      })[e.kind] || "#fff";
      drawLabeledBox(e.x, e.y, e.w, e.h, c, e.label);
    }
  }

  function drawPlayerPolice() {
    const p = state.player;
    const sprite = (state.gameOver || state.crash.active)
      ? myDroneDizzySprite
      : (input.throttleUp ? myDroneSpeedingSprite : myDroneSprite);

    if (sprite.ready()) {
      ctx.save();
      if (state.crash.active) {
        const cx = p.screenX + p.w * 0.5;
        const cy = p.y + p.h * 0.5;
        ctx.translate(cx, cy);
        ctx.rotate(state.crash.spin); // clockwise 90 degrees
        drawNormalizedSprite(sprite.img, -p.w * 0.5, -p.h * 0.5, p.w, p.h);
      } else {
        drawNormalizedSprite(sprite.img, p.screenX, p.y, p.w, p.h);
      }
      ctx.restore();
    } else {
      // Fallback only if image is unavailable; no title label for player.
      ctx.save();
      ctx.strokeStyle = palette.player;
      ctx.lineWidth = 2;
      ctx.strokeRect(p.screenX, p.y, p.w, p.h);
      ctx.restore();
    }

    if (state.shield > 0) {
      const cx = p.screenX + p.w * 0.5;
      const cy = p.y + p.h * 0.5;
      const pulse = 1 + Math.sin(state.t * 4.4) * 0.06;
      const r = Math.max(p.w, p.h) * 0.95 * pulse + 14;
      ctx.save();
      const halo = ctx.createRadialGradient(cx, cy, r * 0.22, cx, cy, r * 1.45);
      halo.addColorStop(0, "rgba(255,255,255,0.28)");
      halo.addColorStop(1, "rgba(230,244,255,0.0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.45, 0, Math.PI * 2);
      ctx.fill();

      const bubble = ctx.createRadialGradient(cx - r * 0.24, cy - r * 0.30, r * 0.20, cx, cy, r);
      bubble.addColorStop(0, "rgba(255,255,255,0.40)");
      bubble.addColorStop(1, "rgba(221,238,255,0.23)");
      ctx.fillStyle = bubble;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(250,255,255,0.70)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (state.police.active) {
      const cop = state.police;
      if (policeDroneSprite.ready()) {
        ctx.save();
        drawNormalizedSprite(policeDroneSprite.img, cop.x, cop.y, cop.w, cop.h);
        ctx.restore();
      } else {
        drawLabeledBox(cop.x, cop.y, cop.w, cop.h, palette.police, LABEL.POLICE);
      }

      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = palette.police;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(cop.x + cop.w, cop.y + cop.h * 0.5);
      ctx.lineTo(p.screenX, p.y + p.h * 0.5);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawHUD() {
    const alt = y2m(state.player.y + state.player.h * 0.5);
    const speedMs = toDisplaySpeedMs(Number(state.worldSpeed) || 0);
    const zoneText = state.controlled ? t(UI, "zone_controlled", "") : t(UI, "zone_fly", "");
    const amnestyText = state.amnesty > 0 ? `${state.amnesty.toFixed(0)}s` : "-";
    const shieldText = state.shield > 0 ? `${state.shield.toFixed(0)}s` : "-";

    const fontUi = buildGameFont(13);
    const fontBold = buildGameFont(13, "700");

    const drawPill = (x, y, text, bgA, bgB, border) => {
      ctx.save();
      ctx.font = fontBold;
      const w = Math.max(92, ctx.measureText(text).width + 28);
      const h = 30;
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, bgA);
      g.addColorStop(1, bgB);
      ctx.fillStyle = g;
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      roundedRectPath(ctx, x, y, w, h, 999);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f8fcff";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(text, x + w * 0.5, y + h * 0.52);
      ctx.restore();
      return w;
    };

    ctx.save();
    const hudH = 66;
    const panel = ctx.createLinearGradient(0, 0, 0, hudH);
    panel.addColorStop(0, "rgba(7, 12, 28, 0.72)");
    panel.addColorStop(1, "rgba(7, 12, 28, 0.42)");
    ctx.fillStyle = panel;
    ctx.fillRect(0, 0, W(), hudH);
    ctx.strokeStyle = "rgba(196, 226, 255, 0.22)";
    ctx.beginPath();
    ctx.moveTo(0, hudH + 0.5);
    ctx.lineTo(W(), hudH + 0.5);
    ctx.stroke();

    const leftSafeReserved = 102;
    ctx.fillStyle = "#f3f8ff";
    ctx.font = fontUi;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`${t(UI, "distance", "")}: ${Math.floor(state.score)}m`, leftSafeReserved, 24);
    ctx.fillText(`${t(UI, "altitude", "")}: ${alt.toFixed(0)}m`, leftSafeReserved, 47);
    ctx.fillText(`${t(UI, "amnesty", "")}: ${amnestyText}`, 218, 24);
    ctx.fillText(`${t(UI, "speed", "速度")}: ${speedMs}米/S`, 218, 47);
    ctx.fillText(`${t(UI, "shield", "")}: ${shieldText}`, 360, 24);

    const rightSafeReserved = 210;
    const right = Math.max(420, W() - rightSafeReserved);
    drawPill(
      right - 190,
      18,
      zoneText,
      state.controlled ? "rgba(255, 92, 112, 0.58)" : "rgba(0, 226, 170, 0.56)",
      state.controlled ? "rgba(192, 48, 68, 0.62)" : "rgba(20, 155, 120, 0.60)",
      state.controlled ? "rgba(255, 220, 226, 0.90)" : "rgba(205, 255, 242, 0.88)"
    );

    if (state.gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, 0, W(), H());
      ctx.fillStyle = "#fff";
      ctx.font = buildGameFont(28, "700");
      const gameOverText = t(UI, "game_over", "");
      ctx.fillText(gameOverText, W() * 0.5 - ctx.measureText(gameOverText).width / 2, H() * 0.45);
      ctx.font = buildGameFont(16);
      ctx.fillText(state.reason, W() * 0.5 - ctx.measureText(state.reason).width / 2, H() * 0.45 + 28);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      const retry = t(UI, "retry", "");
      ctx.fillText(retry, W() * 0.5 - ctx.measureText(retry).width / 2, H() * 0.45 + 54);
    }
    ctx.restore();
  }

  function drawPickupToasts(camY) {
    if (!state.pickupToasts || state.pickupToasts.length === 0) return;
    ctx.save();
    ctx.font = buildGameFont(14, "700");
    for (const tToast of state.pickupToasts) {
      const a = clamp(tToast.life / tToast.maxLife, 0, 1);
      const sy = tToast.y + camY;
      const textW = ctx.measureText(tToast.text).width;
      const padX = 10;
      const h = 24;
      const w = textW + padX * 2;
      const x = tToast.x - w * 0.5;
      const y = sy - h * 0.5;

      ctx.globalAlpha = a;
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, "rgba(25, 35, 56, 0.95)");
      g.addColorStop(1, "rgba(14, 22, 38, 0.92)");
      ctx.fillStyle = g;
      ctx.strokeStyle = "rgba(170, 207, 255, 0.85)";
      roundedRectPath(ctx, x, y, w, h, 999);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "rgba(245, 251, 255, 0.98)";
      ctx.textBaseline = "middle";
      ctx.fillText(tToast.text, x + padX, y + h * 0.5);
    }
    ctx.restore();
  }
  function draw() {
    const camY = cameraOffsetY();
    applyImageSmoothing();

    drawBackground(camY);
    drawAlarmOverlay();

    // Vertical follow-camera: keep player centered while preserving world-space physics.
    ctx.save();
    ctx.translate(0, camY);
    drawTerrain();
    drawEntities();
    drawPlayerPolice();
    drawImpactFX();
    drawWaterSplashes();
    ctx.restore();

    drawPickupToasts(camY);
    drawAltitudeAxis();
    drawHUD();
  }

  // ---------- Loop ----------
  let rafId = 0;
  let destroyed = false;

  function pauseGame() {
    if (paused) return true;
    paused = true;
    clearInput();
    AudioBus.setGameplayActive(false);
    return true;
  }

  function resumeGame() {
    if (!paused) return false;
    paused = false;
    state.last = performance.now();
    if (!state.gameOver) {
      AudioBus.setGameplayActive(true);
    }
    return true;
  }

  function togglePauseState() {
    if (paused) {
      resumeGame();
    } else {
      pauseGame();
    }
    return paused;
  }

  function tick(now) {
    if (destroyed) return;
    const last = state.last || now;
    let dt = (now - last) / 1000;
    dt = Math.min(0.033, Math.max(0.001, dt));
    state.last = now;

    ctx.clearRect(0, 0, W(), H());
    if (!paused) {
      update(dt);
    }
    draw();

    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
  return {
    destroy() {
      destroyed = true;
      if (rafId && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafId);
      }
      rafId = 0;
      AudioBus.stopAll();
    },
    dispatch(type, detail = {}) {
      if (window && typeof window.dispatchEvent === "function") {
        window.dispatchEvent(type, detail);
      }
    },
    toggleMuted() {
      return AudioBus.toggleMuted();
    },
    setMuted(next) {
      AudioBus.setMuted(!!next);
      return AudioBus.isMuted();
    },
    isMuted() {
      return AudioBus.isMuted();
    },
    pause() {
      return pauseGame();
    },
    resume() {
      return resumeGame();
    },
    togglePaused() {
      return togglePauseState();
    },
    isPaused() {
      return paused;
    },
    restart() {
      AudioBus.stopAll();
      reset();
    },
    stopAllAudio() {
      AudioBus.stopAll();
    },
    resize() {
      if (typeof window.dispatchEvent === "function") {
        window.dispatchEvent("resize", {});
      }
    }
  };
};



