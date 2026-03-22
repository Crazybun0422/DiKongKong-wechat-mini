const createLowAltitudeGame = require("./game-core");
const attachRuralHouse = require("./terrain-rural-house");
const attachZeldaDog = require("./terrain-zelda-dog");
const attachTerrainSystem = require("./terrain-system");
const gameLang = require("./lang-zh-CN");

const RAF_INTERVAL_MS = 16;

const CONTROL_KEY_MAP = {
  acc: "Shift",
  dec: "a",
  up: "ArrowUp",
  down: "ArrowDown"
};

const safeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeAssetBase = (value = "") => `${value || ""}`.trim().replace(/\/+$/g, "");

const syncCanvasClientSize = (canvas, width, height) => {
  if (!canvas) return;
  const w = Math.max(1, safeNumber(width, 1));
  const h = Math.max(1, safeNumber(height, 1));
  try {
    canvas.clientWidth = w;
    canvas.clientHeight = h;
  } catch (err) {}
  if (!Number.isFinite(canvas.clientWidth) || canvas.clientWidth <= 0) {
    try {
      Object.defineProperty(canvas, "clientWidth", {
        value: w,
        writable: true,
        configurable: true
      });
    } catch (err) {}
  }
  if (!Number.isFinite(canvas.clientHeight) || canvas.clientHeight <= 0) {
    try {
      Object.defineProperty(canvas, "clientHeight", {
        value: h,
        writable: true,
        configurable: true
      });
    } catch (err) {}
  }
};

const createEventHub = () => {
  const listeners = Object.create(null);
  const addEventListener = (type, handler) => {
    const name = `${type || ""}`.trim();
    if (!name || typeof handler !== "function") return;
    if (!Array.isArray(listeners[name])) listeners[name] = [];
    listeners[name].push(handler);
  };
  const removeEventListener = (type, handler) => {
    const name = `${type || ""}`.trim();
    if (!name || !Array.isArray(listeners[name])) return;
    listeners[name] = listeners[name].filter((fn) => fn !== handler);
  };
  const dispatchEvent = (typeOrEvent, detail = {}) => {
    let eventObj = null;
    if (typeof typeOrEvent === "string") {
      eventObj = {
        type: typeOrEvent,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...detail
      };
    } else if (typeOrEvent && typeof typeOrEvent === "object") {
      eventObj = typeOrEvent;
      if (typeof eventObj.preventDefault !== "function") {
        eventObj.defaultPrevented = false;
        eventObj.preventDefault = function preventDefault() {
          this.defaultPrevented = true;
        };
      }
    }
    if (!eventObj || !eventObj.type) return eventObj;
    const queue = Array.isArray(listeners[eventObj.type]) ? [...listeners[eventObj.type]] : [];
    for (let i = 0; i < queue.length; i += 1) {
      try {
        queue[i](eventObj);
      } catch (err) {}
    }
    return eventObj;
  };
  return {
    addEventListener,
    removeEventListener,
    dispatchEvent
  };
};

const createRafBridge = () => {
  let seed = 1;
  const jobs = new Map();
  const requestAnimationFrame = (callback) => {
    const id = seed;
    seed += 1;
    const timer = setTimeout(() => {
      jobs.delete(id);
      try {
        callback(Date.now());
      } catch (err) {}
    }, RAF_INTERVAL_MS);
    jobs.set(id, timer);
    return id;
  };
  const cancelAnimationFrame = (id) => {
    const timer = jobs.get(id);
    if (!timer) return;
    clearTimeout(timer);
    jobs.delete(id);
  };
  const destroy = () => {
    const ids = [...jobs.keys()];
    for (let i = 0; i < ids.length; i += 1) {
      cancelAnimationFrame(ids[i]);
    }
  };
  return {
    requestAnimationFrame,
    cancelAnimationFrame,
    destroy
  };
};

const createAudioAdapterFactory = () => {
  let muted = false;
  const instances = new Set();

  class AudioAdapter {
    constructor(src = "") {
      this._ctx = null;
      this._src = "";
      this._loop = false;
      this._volume = 1;
      this._currentTime = 0;
      this._ended = false;
      this._paused = true;
      this.preload = "auto";
      this.onended = null;

      if (typeof wx !== "undefined" && typeof wx.createInnerAudioContext === "function") {
        try {
          this._ctx = wx.createInnerAudioContext();
        } catch (err) {
          this._ctx = null;
        }
      }
      if (this._ctx && typeof this._ctx.onEnded === "function") {
        this._ctx.onEnded(() => {
          this._ended = true;
          this._paused = true;
          if (typeof this.onended === "function") {
            try {
              this.onended();
            } catch (err) {}
          }
        });
      }
      instances.add(this);
      if (src) {
        this.src = src;
      }
    }

    play() {
      this._ended = false;
      this._paused = false;
      if (muted) {
        return Promise.resolve();
      }
      if (!this._ctx || typeof this._ctx.play !== "function") {
        return Promise.resolve();
      }
      try {
        this._ctx.play();
      } catch (err) {
        return Promise.reject(err);
      }
      return Promise.resolve();
    }

    pause() {
      this._paused = true;
      if (this._ctx && typeof this._ctx.pause === "function") {
        try {
          this._ctx.pause();
        } catch (err) {}
      }
    }

    destroy() {
      this.pause();
      if (this._ctx && typeof this._ctx.destroy === "function") {
        try {
          this._ctx.destroy();
        } catch (err) {}
      }
      this._ctx = null;
      instances.delete(this);
    }

    get src() {
      return this._src;
    }

    set src(value) {
      this._src = `${value || ""}`.trim();
      if (this._ctx) {
        this._ctx.src = this._src;
      }
    }

    get loop() {
      return this._loop;
    }

    set loop(value) {
      this._loop = !!value;
      if (this._ctx) {
        this._ctx.loop = this._loop;
      }
    }

    get volume() {
      return this._volume;
    }

    set volume(value) {
      const next = Math.max(0, Math.min(1, safeNumber(value, 1)));
      this._volume = next;
      if (this._ctx) {
        this._ctx.volume = muted ? 0 : next;
      }
    }

    get currentTime() {
      if (this._ctx && Number.isFinite(this._ctx.currentTime)) {
        return this._ctx.currentTime;
      }
      return this._currentTime;
    }

    set currentTime(value) {
      const next = Math.max(0, safeNumber(value, 0));
      this._currentTime = next;
      if (this._ctx && typeof this._ctx.seek === "function") {
        try {
          this._ctx.seek(next);
        } catch (err) {}
      }
    }

    get paused() {
      return this._paused;
    }

    get ended() {
      return this._ended;
    }
  }

  const setMuted = (next) => {
    muted = !!next;
    instances.forEach((audio) => {
      if (!audio || !audio._ctx) return;
      if (muted) {
        audio._ctx.volume = 0;
        audio.pause();
      } else {
        audio._ctx.volume = audio._volume;
      }
    });
    return muted;
  };

  const destroy = () => {
    instances.forEach((audio) => {
      if (!audio) return;
      audio.destroy();
    });
    instances.clear();
  };

  return {
    Audio: AudioAdapter,
    setMuted,
    isMuted: () => muted,
    destroy
  };
};

const createImageAdapterFactory = (canvas) =>
  class CanvasImageAdapter {
    constructor() {
      this._img =
        canvas && typeof canvas.createImage === "function" ? canvas.createImage() : null;
      this._listeners = {
        load: [],
        error: []
      };
      this._src = "";
      if (this._img) {
        this._img.onload = (event) => {
          this._emit("load", event);
        };
        this._img.onerror = (event) => {
          this._emit("error", event);
        };
      }
    }

    _emit(type, event) {
      const queue = Array.isArray(this._listeners[type]) ? [...this._listeners[type]] : [];
      for (let i = 0; i < queue.length; i += 1) {
        try {
          queue[i](event);
        } catch (err) {}
      }
    }

    addEventListener(type, handler) {
      const name = `${type || ""}`.trim();
      if (!name || typeof handler !== "function") return;
      if (!Array.isArray(this._listeners[name])) this._listeners[name] = [];
      this._listeners[name].push(handler);
    }

    removeEventListener(type, handler) {
      const name = `${type || ""}`.trim();
      if (!name || !Array.isArray(this._listeners[name])) return;
      this._listeners[name] = this._listeners[name].filter((fn) => fn !== handler);
    }

    get width() {
      return this._img ? Number(this._img.width) || 0 : 0;
    }

    get height() {
      return this._img ? Number(this._img.height) || 0 : 0;
    }

    get src() {
      return this._src;
    }

    set src(value) {
      this._src = `${value || ""}`.trim();
      if (this._img) {
        this._img.src = this._src;
      }
    }

    toNative() {
      return this._img;
    }
  };

const patchDrawImageForAdapter = (ctx) => {
  if (!ctx || typeof ctx.drawImage !== "function") return;
  if (ctx.__afeiDrawImagePatched) return;
  const nativeDrawImage = ctx.drawImage.bind(ctx);
  ctx.drawImage = (...args) => {
    if (!args.length) return;
    const first = args[0];
    if (first && typeof first.toNative === "function") {
      args[0] = first.toNative();
    }
    nativeDrawImage(...args);
  };
  ctx.__afeiDrawImagePatched = true;
};

const createOffscreenCanvas = () => {
  if (typeof wx !== "undefined" && typeof wx.createOffscreenCanvas === "function") {
    try {
      return wx.createOffscreenCanvas({
        type: "2d",
        width: 1,
        height: 1
      });
    } catch (err) {}
  }
  return null;
};

const createAfeiGame = (options = {}) => {
  const canvas = options.canvas;
  const ctx = options.ctx;
  const width = Math.max(1, safeNumber(options.width, 1));
  const height = Math.max(1, safeNumber(options.height, 1));
  const dpr = Math.max(1, safeNumber(options.dpr, 1));
  const assetsBase = normalizeAssetBase(options.assetsBase);
  const startPaused = options.startPaused === true;
  const gameFontFamily = `${options.fontFamily || ""}`.trim();
  const runtimeLang =
    options.lang && typeof options.lang === "object" ? options.lang : gameLang;

  if (!canvas || !ctx) {
    throw new Error("missing-canvas");
  }

  patchDrawImageForAdapter(ctx);

  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  syncCanvasClientSize(canvas, width, height);
  if (typeof ctx.setTransform === "function") {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  } else if (typeof ctx.scale === "function") {
    ctx.scale(dpr, dpr);
  }

  const eventHub = createEventHub();
  const rafBridge = createRafBridge();
  const audioFactory = createAudioAdapterFactory();
  const ImageAdapter = createImageAdapterFactory(canvas);

  const runtimeWindow = {
    GAME_LANG: runtimeLang,
    GAME_FONT_FAMILY: gameFontFamily,
    devicePixelRatio: dpr,
    addEventListener: eventHub.addEventListener,
    removeEventListener: eventHub.removeEventListener,
    dispatchEvent: eventHub.dispatchEvent
  };

  const runtimeDocument = {
    getElementById(id) {
      return id === "c" ? canvas : null;
    },
    createElement(tag) {
      if (`${tag || ""}`.toLowerCase() !== "canvas") return null;
      return createOffscreenCanvas();
    }
  };

  const runtime = {
    window: runtimeWindow,
    document: runtimeDocument,
    performance: {
      now: () => Date.now()
    },
    requestAnimationFrame: rafBridge.requestAnimationFrame,
    cancelAnimationFrame: rafBridge.cancelAnimationFrame,
    Audio: audioFactory.Audio,
    Image: ImageAdapter,
    assetsBase,
    startPaused
  };

  attachRuralHouse(runtime);
  attachZeldaDog(runtime);
  attachTerrainSystem(runtime);
  const game = createLowAltitudeGame(runtime);
  const pressed = Object.create(null);

  const emitKey = (control, active) => {
    const key = CONTROL_KEY_MAP[control];
    if (!key) return;
    const next = !!active;
    const current = !!pressed[key];
    if (next === current) return;
    pressed[key] = next;
    runtimeWindow.dispatchEvent(next ? "keydown" : "keyup", { key });
  };

  const releaseAll = () => {
    Object.keys(CONTROL_KEY_MAP).forEach((control) => emitKey(control, false));
  };

  return {
    setControl(control, active) {
      emitKey(control, active);
    },
    on(type, handler) {
      eventHub.addEventListener(type, handler);
    },
    off(type, handler) {
      eventHub.removeEventListener(type, handler);
    },
    setMuted(next) {
      if (game && typeof game.setMuted === "function") {
        return game.setMuted(next);
      }
      return audioFactory.setMuted(next);
    },
    toggleMuted() {
      if (game && typeof game.toggleMuted === "function") {
        return game.toggleMuted();
      }
      return audioFactory.setMuted(!audioFactory.isMuted());
    },
    isMuted() {
      if (game && typeof game.isMuted === "function") {
        return game.isMuted();
      }
      return audioFactory.isMuted();
    },
    pause() {
      if (game && typeof game.pause === "function") {
        return game.pause();
      }
      return false;
    },
    resume() {
      if (game && typeof game.resume === "function") {
        return game.resume();
      }
      return false;
    },
    togglePaused() {
      if (game && typeof game.togglePaused === "function") {
        return game.togglePaused();
      }
      return false;
    },
    isPaused() {
      if (game && typeof game.isPaused === "function") {
        return game.isPaused();
      }
      return false;
    },
    restart() {
      releaseAll();
      if (game && typeof game.stopAllAudio === "function") {
        game.stopAllAudio();
      }
      if (game && typeof game.restart === "function") {
        game.restart();
        return;
      }
      runtimeWindow.dispatchEvent("keydown", { key: "r" });
      runtimeWindow.dispatchEvent("keyup", { key: "r" });
    },
    stopAllAudio() {
      if (game && typeof game.stopAllAudio === "function") {
        game.stopAllAudio();
      }
    },
    resize(nextWidth, nextHeight, nextDpr) {
      const w = Math.max(1, safeNumber(nextWidth, width));
      const h = Math.max(1, safeNumber(nextHeight, height));
      const ratio = Math.max(1, safeNumber(nextDpr, dpr));
      canvas.width = Math.max(1, Math.floor(w * ratio));
      canvas.height = Math.max(1, Math.floor(h * ratio));
      syncCanvasClientSize(canvas, w, h);
      if (typeof ctx.setTransform === "function") {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      runtimeWindow.devicePixelRatio = ratio;
      if (typeof game.resize === "function") {
        game.resize();
      } else {
        runtimeWindow.dispatchEvent("resize", {});
      }
    },
    destroy() {
      releaseAll();
      if (game && typeof game.stopAllAudio === "function") {
        game.stopAllAudio();
      }
      if (game && typeof game.destroy === "function") {
        game.destroy();
      }
      audioFactory.destroy();
      rafBridge.destroy();
    }
  };
};

module.exports = {
  createAfeiGame
};
