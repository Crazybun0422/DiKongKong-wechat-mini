const { createAfeiGame } = require("./game/runtime");
const {
  getAuthToken,
  fetchUserProfile,
  loadStoredProfile,
  ensureFeatureCode,
  extractAvatarFileName,
  buildAvatarDownloadUrl
} = require("../../../utils/profile");
const {
  fetchLadderMyRank,
  fetchLadderLeaderboard,
  startLadderGame,
  endLadderGame
} = require("../../../utils/ladder-game");

const CANVAS_ID = "#afei-stage-canvas";
const BEST_SCORE_STORAGE_KEY = "afeiAdventureBestScore";
const SPLASH_HOLD_MS = 2000;
const SPLASH_FADE_MS = 420;
const ORIENTATION_PORTRAIT = "portrait";
const AFEI_GAME_FONT_FAMILY = "AfeiGameZh";
const AFEI_GAME_FONT_PATH = "assets/font/game.zh.subset.woff2";
const AFEI_UI_FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Microsoft YaHei', sans-serif";

const decodeParam = (value = "") => {
  const raw = `${value || ""}`.trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch (err) {
    return raw;
  }
};

const normalizeDir = (value = "") => `${value || ""}`.trim().replace(/\/+$/g, "");

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });

const resolveDpr = () => {
  if (typeof wx !== "undefined" && typeof wx.getWindowInfo === "function") {
    try {
      const info = wx.getWindowInfo() || {};
      const ratio = Number(info.pixelRatio);
      if (Number.isFinite(ratio) && ratio > 0) {
        return Math.min(3, ratio);
      }
    } catch (err) {}
  }
  if (typeof wx !== "undefined" && typeof wx.getSystemInfoSync === "function") {
    try {
      const info = wx.getSystemInfoSync() || {};
      const ratio = Number(info.pixelRatio);
      if (Number.isFinite(ratio) && ratio > 0) {
        return Math.min(3, ratio);
      }
    } catch (err) {}
  }
  return 1;
};

const buildGameFontStyle = (fontFamily = "") => {
  const family = `${fontFamily || ""}`.trim();
  if (!family) {
    return `font-family: ${AFEI_UI_FONT_STACK};`;
  }
  return `font-family: '${family}', ${AFEI_UI_FONT_STACK};`;
};

const parseLangScript = (scriptText = "") => {
  const text = `${scriptText || ""}`.trim();
  if (!text) return null;
  const match = text.match(/window\.GAME_LANG\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!match || !match[1]) return null;
  try {
    // eslint-disable-next-line no-new-func
    const lang = Function(`return (${match[1]});`)();
    return lang && typeof lang === "object" ? lang : null;
  } catch (err) {
    return null;
  }
};

const readRuntimeLang = (resourceDir = "") =>
  new Promise((resolve) => {
    const dir = normalizeDir(resourceDir);
    if (!dir) {
      resolve(null);
      return;
    }
    const path = `${dir}/lang/zh-CN.js`;
    if (typeof wx === "undefined" || typeof wx.getFileSystemManager !== "function") {
      resolve(null);
      return;
    }
    let fs = null;
    try {
      fs = wx.getFileSystemManager();
    } catch (err) {
      fs = null;
    }
    if (!fs || typeof fs.readFile !== "function") {
      resolve(null);
      return;
    }
    fs.readFile({
      filePath: path,
      encoding: "utf8",
      success: (res = {}) => resolve(parseLangScript(res.data)),
      fail: () => resolve(null)
    });
  });

const toSafeScore = (value, fallback = 0) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
};

const formatRank = (value) => {
  const rank = Number(value);
  if (!Number.isFinite(rank) || rank <= 0) return "未上榜";
  return `#${Math.floor(rank)}`;
};

const buildUniqueCode = () =>
  `afei-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const getAppInstance = () => {
  try {
    return getApp ? getApp() : null;
  } catch (err) {
    return null;
  }
};

Page({
  data: {
    resourceDir: "",
    resourceVersion: "",
    assetsBase: "",
    splashSrc: "",
    btnAccSrc: "",
    btnDeclineSrc: "",
    btnUpSrc: "",
    btnDownSrc: "",

    booting: true,
    splashVisible: true,
    splashFading: false,
    splashLoadFailed: false,

    showStartPanel: false,
    showLeaderboardPanel: false,
    gameStarted: false,
    gamePaused: false,
    startLoading: false,
    panelStatusText: "",
    gameFontStyle: buildGameFontStyle(""),

    offlineMode: false,
    soundMuted: false,
    myFeatureCode: "",
    myBestScore: 0,
    myRankText: "未上榜",
    lastScore: 0,
    leaderboard: [],

    pressed: {
      acc: false,
      dec: false,
      up: false,
      down: false,
      sound: false,
      pause: false,
      restart: false,
      exit: false
    }
  },

  onLoad(options = {}) {
    const resourceDir = normalizeDir(decodeParam(options.resourceDir));
    const resourceVersion = decodeParam(options.version);
    const assetsBase = resourceDir ? `${resourceDir}/assets` : "";
    const btnBase = assetsBase ? `${assetsBase}/btn-img` : "";
    const splashSrc = assetsBase ? `${assetsBase}/bgm-img/bgm.png` : "";

    this._destroyed = false;
    this._creatingGamePromise = null;
    this._bootPromise = null;
    this._activeSession = null;
    this._gameOverHandler = null;
    this._offlineLocked = false;
    this._gameFontFamily = "";
    this._gameFontReadyPromise = this.loadGameFont(resourceDir).then((family) => {
      this._gameFontFamily = family || "";
      console.info("[afei-font] resolved family:", this._gameFontFamily || "(fallback)");
      const nextStyle = buildGameFontStyle(this._gameFontFamily);
      if (this.data.gameFontStyle !== nextStyle) {
        this.setData({ gameFontStyle: nextStyle });
      }
      return this._gameFontFamily;
    });

    const localBest = this.readLocalBestScore();
    const storedProfile = loadStoredProfile();
    const featureCode = ensureFeatureCode(storedProfile?.featureCode || "");
    this._profileFeatureCode = featureCode;

    this.setData({
      resourceDir,
      resourceVersion,
      assetsBase,
      splashSrc,
      splashLoadFailed: false,
      btnAccSrc: btnBase ? `${btnBase}/acc.png` : "",
      btnDeclineSrc: btnBase ? `${btnBase}/decline.png` : "",
      btnUpSrc: btnBase ? `${btnBase}/up.png` : "",
      btnDownSrc: btnBase ? `${btnBase}/down.png` : "",
      myFeatureCode: featureCode,
      myBestScore: localBest
    });
  },

  onReady() {
    this.runBootFlow();
  },

  onResize() {
    if (!this._game) return;
    this.ensureGame({ resizeOnly: true }).catch(() => {});
  },

  onHide() {
    this.releaseAllControls();
    this.destroyGame();
  },

  onUnload() {
    this._destroyed = true;
    this.destroyGame();
  },

  async runBootFlow() {
    if (this._bootPromise) return this._bootPromise;
    this._bootPromise = (async () => {
      const ladderTask = this.loadLadderData();
      await this.playSplash();
      await ladderTask;
      if (this._destroyed) return;
      this.setData({
        booting: false,
        showStartPanel: true
      });
    })();
    try {
      await this._bootPromise;
    } finally {
      this._bootPromise = null;
    }
  },

  async playSplash() {
    this.setData({
      splashVisible: true,
      splashFading: false,
      splashLoadFailed: false
    });
    await delay(SPLASH_HOLD_MS);
    if (this._destroyed) return;
    this.setData({ splashFading: true });
    await delay(SPLASH_FADE_MS);
    if (this._destroyed) return;
    this.setData({ splashVisible: false });
  },

  onSplashImageLoad() {
    if (this.data.splashLoadFailed) {
      this.setData({ splashLoadFailed: false });
    }
  },

  onSplashImageError() {
    if (!this.data.splashLoadFailed) {
      this.setData({ splashLoadFailed: true });
    }
  },

  loadGameFont(resourceDir = "") {
    const dir = normalizeDir(resourceDir);
    if (typeof wx === "undefined" || typeof wx.loadFontFace !== "function") {
      console.warn("[afei-font] skip: wx.loadFontFace unavailable");
      return Promise.resolve("");
    }
    const loadWithSource = (source = "", sourceTag = "unknown") =>
      new Promise((resolve) => {
        const sourceValue = `${source || ""}`.trim();
        if (!sourceValue) {
          resolve("");
          return;
        }
        let settled = false;
        const done = (family = "") => {
          if (settled) return;
          settled = true;
          resolve(`${family || ""}`.trim());
        };
        const timeoutId = setTimeout(() => {
          console.warn("[afei-font] timeout, fallback to default font", { sourceTag });
          done("");
        }, 1500);
        try {
          wx.loadFontFace({
            family: AFEI_GAME_FONT_FAMILY,
            source: sourceValue,
            global: false,
            success: () => {
              clearTimeout(timeoutId);
              console.info("[afei-font] loaded", {
                family: AFEI_GAME_FONT_FAMILY,
                sourceTag
              });
              done(AFEI_GAME_FONT_FAMILY);
            },
            fail: (err) => {
              clearTimeout(timeoutId);
              console.warn("[afei-font] load failed", { sourceTag, err });
              done("");
            }
          });
        } catch (err) {
          clearTimeout(timeoutId);
          console.error("[afei-font] load exception", { sourceTag, err });
          done("");
        }
      });

    const loadFromLocalDataUrl = (fontPath = "") =>
      new Promise((resolve) => {
        const rawPath = `${fontPath || ""}`.trim();
        if (!rawPath) {
          resolve("");
          return;
        }
        const fs =
          typeof wx.getFileSystemManager === "function" ? wx.getFileSystemManager() : null;
        if (!fs || typeof fs.readFile !== "function") {
          console.warn("[afei-font] fs unavailable, skip local font");
          resolve("");
          return;
        }
        const candidates = [rawPath];
        if (rawPath.startsWith("wxfile://")) {
          candidates.push(rawPath.replace(/^wxfile:\/\//, "/"));
        }
        const tryRead = (index = 0) => {
          if (index >= candidates.length) {
            resolve("");
            return;
          }
          const currentPath = candidates[index];
          fs.readFile({
            filePath: currentPath,
            encoding: "base64",
            success: (res = {}) => {
              const base64 = `${res.data || ""}`.trim();
              if (!base64) {
                console.warn("[afei-font] local read empty", { fontPath: currentPath });
                tryRead(index + 1);
                return;
              }
              console.info("[afei-font] local base64 prepared", {
                fontPath: currentPath,
                bytes: base64.length
              });
              resolve(`url("data:font/woff2;base64,${base64}")`);
            },
            fail: (err) => {
              console.warn("[afei-font] local read failed", { fontPath: currentPath, err });
              tryRead(index + 1);
            }
          });
        };
        tryRead(0);
      });

    return (async () => {
      if (!dir) {
        console.warn("[afei-font] skip local: empty resourceDir");
        return "";
      }
      const localFontPath = `${dir}/${AFEI_GAME_FONT_PATH}`;
      console.info("[afei-font] try local font", { path: localFontPath });
      const localSource = await loadFromLocalDataUrl(localFontPath);
      if (!localSource) {
        console.warn("[afei-font] local source unavailable, use default font");
        return "";
      }
      const localFamily = await loadWithSource(localSource, "local-data-url");
      if (localFamily) return localFamily;
      console.warn("[afei-font] local load failed, use default font");
      return "";
    })();
  },

  readLocalBestScore() {
    try {
      const score = wx.getStorageSync(BEST_SCORE_STORAGE_KEY);
      return toSafeScore(score, 0);
    } catch (err) {
      return 0;
    }
  },

  writeLocalBestScore(score) {
    const next = toSafeScore(score, 0);
    try {
      wx.setStorageSync(BEST_SCORE_STORAGE_KEY, next);
    } catch (err) {}
    return next;
  },

  updateBestScore(score) {
    const localBest = this.readLocalBestScore();
    const next = Math.max(localBest, toSafeScore(score, 0));
    this.writeLocalBestScore(next);
    this.setData({ myBestScore: next });
    return next;
  },

  async syncFeatureCodeFromProfile(token = "") {
    const authToken = `${token || ""}`.trim();
    if (!authToken) return "";
    try {
      const profile = await fetchUserProfile({ token: authToken });
      const featureCode = `${profile?.featureCode || profile?.loginSeq || ""}`.trim();
      if (!featureCode) return "";
      this._profileFeatureCode = featureCode;
      ensureFeatureCode(featureCode);
      if (this.data.myFeatureCode !== featureCode) {
        this.setData({ myFeatureCode: featureCode });
      }
      return featureCode;
    } catch (err) {
      return "";
    }
  },

  async ensureAccessToken() {
    const token = getAuthToken();
    if (token) return token;

    const app = getAppInstance();
    if (!app || typeof app.loginWithProfile !== "function") {
      throw new Error("login-unavailable");
    }

    const profile = loadStoredProfile() || {};
    await app.loginWithProfile({
      nickname: profile.nickname || "",
      avatarUrl: profile.avatarUrl || ""
    });

    const nextToken = getAuthToken();
    if (!nextToken) {
      throw new Error("missing-token-after-login");
    }
    return nextToken;
  },

  normalizeLeaderboardEntry(raw = {}, idx = 0) {
    const rank = Number(raw.rank);
    const avatarCandidate = raw.avatarUrl || raw.avatarFileName || raw.avatar || "";
    const avatarFileName = extractAvatarFileName(avatarCandidate);
    const avatarUrl = buildAvatarDownloadUrl(avatarFileName || avatarCandidate, {
      apiBase: this.getApiBase()
    });
    return {
      id: `${raw.featureCode || "row"}-${raw.rank || idx}`,
      rank: Number.isFinite(rank) && rank > 0 ? Math.floor(rank) : idx + 1,
      username: `${raw.username || "匿名飞手"}`,
      featureCode: `${raw.featureCode || ""}`,
      highestScore: toSafeScore(raw.highestScore, 0),
      avatarUrl
    };
  },

  getApiBase() {
    const app = getAppInstance();
    return (app && app.globalData && app.globalData.apiBase) || "";
  },

  async loadLadderData() {
    const localBest = this.readLocalBestScore();
    this.setData({
      panelStatusText: "加载天梯数据中..."
    });

    let token = "";
    try {
      token = await this.ensureAccessToken();
    } catch (err) {
      token = "";
    }

    if (!token) {
      this._offlineLocked = true;
      this.setData({
        offlineMode: true,
        myBestScore: localBest,
        myRankText: "离线模式",
        panelStatusText: "离线模式：本局成绩不会上传"
      });
      return;
    }

    await this.syncFeatureCodeFromProfile(token);

    try {
      const myRank = await fetchLadderMyRank({ token });
      const serverBest = toSafeScore(myRank?.highestScore, 0);
      const bestScore = Math.max(localBest, serverBest);
      this.updateBestScore(bestScore);
      this.setData({
        offlineMode: false,
        myRankText: formatRank(myRank?.rank),
        panelStatusText: ""
      });
    } catch (err) {
      this._offlineLocked = true;
      this.setData({
        offlineMode: true,
        myBestScore: localBest,
        myRankText: "离线模式",
        panelStatusText: "离线模式：本局成绩不会上传"
      });
      return;
    }

    try {
      const page = await fetchLadderLeaderboard({ page: 0, size: 10 }, { token });
      const content = Array.isArray(page?.content) ? page.content : [];
      const leaderboard = content.map((item, idx) => this.normalizeLeaderboardEntry(item, idx));
      this.setData({ leaderboard });
    } catch (err) {
      this.setData({
        leaderboard: [],
        panelStatusText: "排行榜加载失败，可先开始游戏"
      });
    }
  },

  ensureGame(options = {}) {
    const resizeOnly = !!options.resizeOnly;
    if (resizeOnly && !this._game) return Promise.resolve(null);
    if (this._creatingGamePromise) return this._creatingGamePromise;
    if (this._game && !resizeOnly) return Promise.resolve(this._game);
    if (!this.data.assetsBase) {
      return Promise.reject(new Error("missing-assets-base"));
    }

    this._creatingGamePromise = new Promise((resolve, reject) => {
      const query = this.createSelectorQuery();
      query
        .select(CANVAS_ID)
        .fields({ node: true, size: true })
        .exec(async (res = []) => {
          const payload = res[0] || {};
          const canvas = payload.node;
          const width = Number(payload.width) || 0;
          const height = Number(payload.height) || 0;

          if (!canvas || width <= 0 || height <= 0) {
            reject(new Error("canvas-not-ready"));
            return;
          }

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("context-not-ready"));
            return;
          }

          const dpr = resolveDpr();

          if (this._game && resizeOnly) {
            this._game.resize(width, height, dpr);
            resolve(this._game);
            return;
          }
          if (this._game && !resizeOnly) {
            resolve(this._game);
            return;
          }

          try {
            if (this._gameFontReadyPromise && typeof this._gameFontReadyPromise.then === "function") {
              try {
                await this._gameFontReadyPromise;
              } catch (err) {}
            }
            const lang = await readRuntimeLang(this.data.resourceDir);
            this._game = createAfeiGame({
              canvas,
              ctx,
              width,
              height,
              dpr,
              assetsBase: this.data.assetsBase,
              lang,
              fontFamily: this._gameFontFamily,
              startPaused: true
            });

            this._gameOverHandler = (event = {}) => {
              this.handleGameOver(event);
            };
            if (typeof this._game.on === "function" && this._gameOverHandler) {
              this._game.on("gameover", this._gameOverHandler);
            }

            this.setData({
              soundMuted: this._game.isMuted(),
              gamePaused: typeof this._game.isPaused === "function" ? this._game.isPaused() : false
            });
            resolve(this._game);
          } catch (err) {
            reject(err);
          }
        });
    });

    return this._creatingGamePromise.finally(() => {
      this._creatingGamePromise = null;
    });
  },

  destroyGame() {
    this.releaseAllControls();
    if (this._game && this._gameOverHandler && typeof this._game.off === "function") {
      this._game.off("gameover", this._gameOverHandler);
    }
    this._gameOverHandler = null;

    if (this._game && typeof this._game.destroy === "function") {
      this._game.destroy();
    }
    this._game = null;
    if (this.data.gamePaused) {
      this.setData({ gamePaused: false });
    }
  },

  releaseAllControls() {
    const controls = ["acc", "dec", "up", "down"];
    for (let i = 0; i < controls.length; i += 1) {
      const control = controls[i];
      this.updatePressed(control, false);
      if (this._game && typeof this._game.setControl === "function") {
        this._game.setControl(control, false);
      }
    }
    this.updatePressed("sound", false);
    this.updatePressed("pause", false);
    this.updatePressed("restart", false);
    this.updatePressed("exit", false);
  },

  setGameplayPaused(nextPaused) {
    const paused = !!nextPaused;
    if (!this._game) {
      if (this.data.gamePaused !== paused) {
        this.setData({ gamePaused: paused });
      }
      return paused;
    }
    if (paused) {
      const controls = ["acc", "dec", "up", "down"];
      for (let i = 0; i < controls.length; i += 1) {
        const control = controls[i];
        this.updatePressed(control, false);
        if (typeof this._game.setControl === "function") {
          this._game.setControl(control, false);
        }
      }
      if (typeof this._game.pause === "function") {
        this._game.pause();
      }
    } else if (typeof this._game.resume === "function") {
      this._game.resume();
    }
    const actualPaused =
      typeof this._game.isPaused === "function" ? !!this._game.isPaused() : paused;
    if (this.data.gamePaused !== actualPaused) {
      this.setData({ gamePaused: actualPaused });
    }
    return actualPaused;
  },

  buildSessionPayload() {
    const profile = loadStoredProfile() || {};
    const featureCode = ensureFeatureCode(
      this._profileFeatureCode || this.data.myFeatureCode || profile.featureCode || ""
    );
    this._profileFeatureCode = featureCode;
    this.setData({ myFeatureCode: featureCode });
    return {
      featureCode,
      uniqueCode: buildUniqueCode()
    };
  },

  async onStartGameTap() {
    if (this.data.startLoading) return;
    this.setData({
      startLoading: true,
      panelStatusText: ""
    });

    try {
      await this.ensureGame();
    } catch (err) {
      this.setData({
        startLoading: false,
        panelStatusText: "游戏初始化失败，请重试"
      });
      return;
    }

    this.setGameplayPaused(true);
    this.releaseAllControls();

    let writable = !this._offlineLocked && !this.data.offlineMode;
    let session = null;

    if (writable) {
      const token = getAuthToken();
      await this.syncFeatureCodeFromProfile(token);
      const payload = this.buildSessionPayload();
      session = {
        token,
        featureCode: payload.featureCode,
        uniqueCode: payload.uniqueCode,
        writable: true
      };
      try {
        await startLadderGame(
          {
            featureCode: payload.featureCode,
            uniqueCode: payload.uniqueCode,
            startTime: new Date().toISOString()
          },
          { token }
        );
      } catch (err) {
        writable = false;
        session.writable = false;
        this.setData({
          panelStatusText: "当前网络异常，本局将离线进行"
        });
      }
    } else {
      session = {
        token: "",
        featureCode: this.data.myFeatureCode || "",
        uniqueCode: "",
        writable: false
      };
    }

    this._activeSession = session;

    if (this._game && typeof this._game.stopAllAudio === "function") {
      this._game.stopAllAudio();
    }
    if (this._game && typeof this._game.restart === "function") {
      this._game.restart();
    }
    this.setData(
      {
        showStartPanel: false,
        showLeaderboardPanel: false,
        gameStarted: true,
        gamePaused: false,
        startLoading: false,
        lastScore: 0
      },
      () => {
        this.setGameplayPaused(false);
      }
    );
  },

  async handleGameOver(event = {}) {
    if (!this.data.gameStarted) return;
    const score = toSafeScore(event?.score, 0);
    this.updateBestScore(score);
    this.setGameplayPaused(true);
    this.releaseAllControls();

    if (this._activeSession?.writable) {
      try {
        await endLadderGame(
          {
            featureCode: this._activeSession.featureCode,
            uniqueCode: this._activeSession.uniqueCode,
            endTime: new Date().toISOString(),
            score
          },
          { token: this._activeSession.token }
        );

        const myRank = await fetchLadderMyRank({ token: this._activeSession.token });
        this.setData({
          myRankText: formatRank(myRank?.rank)
        });
        const serverBest = toSafeScore(myRank?.highestScore, 0);
        this.updateBestScore(serverBest);

        const page = await fetchLadderLeaderboard({ page: 0, size: 10 }, { token: this._activeSession.token });
        const content = Array.isArray(page?.content) ? page.content : [];
        const leaderboard = content.map((item, idx) => this.normalizeLeaderboardEntry(item, idx));
        this.setData({ leaderboard });
      } catch (err) {
        this.setData({
          panelStatusText: "成绩上传失败，已保留本地记录"
        });
      }
    }

    this._activeSession = null;
    this.setData({
      gameStarted: false,
      gamePaused: false,
      showStartPanel: true,
      showLeaderboardPanel: false,
      lastScore: score,
      startLoading: false
    });
  },

  onOpenLeaderboardTap() {
    this.setData({ showLeaderboardPanel: true });
  },

  onCloseLeaderboardTap() {
    this.setData({ showLeaderboardPanel: false });
  },

  updatePressed(control, active) {
    const key = `${control || ""}`.trim();
    if (!key) return;
    const path = `pressed.${key}`;
    this.setData({ [path]: !!active });
  },

  onControlTouchStart(event = {}) {
    if (!this.data.gameStarted) return;
    if (this.data.gamePaused) return;
    const control = `${event?.currentTarget?.dataset?.control || ""}`.trim();
    if (!control) return;
    this.updatePressed(control, true);
    if (this._game && typeof this._game.setControl === "function") {
      this._game.setControl(control, true);
    }
  },

  onControlTouchEnd(event = {}) {
    const control = `${event?.currentTarget?.dataset?.control || ""}`.trim();
    if (!control) return;
    this.updatePressed(control, false);
    if (this._game && typeof this._game.setControl === "function") {
      this._game.setControl(control, false);
    }
  },

  onSoundTouchStart() {
    this.updatePressed("sound", true);
    if (!this._game || typeof this._game.toggleMuted !== "function") return;
    const muted = this._game.toggleMuted();
    this.setData({ soundMuted: !!muted });
  },

  onSoundTouchEnd() {
    this.updatePressed("sound", false);
  },

  onSoundTap() {},

  onPauseTouchStart() {
    if (!this.data.gameStarted) return;
    this.updatePressed("pause", true);
  },

  onPauseTouchEnd() {
    this.updatePressed("pause", false);
  },

  onPauseTap() {
    if (!this.data.gameStarted) return;
    if (!this._game || typeof this._game.isPaused !== "function") return;
    const nextPaused = !this._game.isPaused();
    this.setGameplayPaused(nextPaused);
  },

  onRestartTouchStart() {
    if (!this.data.gameStarted) return;
    this.updatePressed("restart", true);
  },

  onRestartTouchEnd() {
    this.updatePressed("restart", false);
  },

  onRestartTap() {
    if (!this._game || typeof this._game.restart !== "function") return;
    if (!this.data.gameStarted) return;
    this.releaseAllControls();
    if (typeof this._game.stopAllAudio === "function") {
      this._game.stopAllAudio();
    }
    this._game.restart();
  },

  onExitTouchStart() {
    this.updatePressed("exit", true);
  },

  onExitTouchEnd() {
    this.updatePressed("exit", false);
  },

  onExitTap() {
    this.releaseAllControls();
    this.destroyGame();
    this.exitToMap();
  },

  onBackPress() {
    this.releaseAllControls();
    this.destroyGame();
    this.exitToMap();
    return true;
  },

  switchToPortraitForMapExit() {
    return new Promise((resolve) => {
      if (typeof wx === "undefined" || typeof wx.setPageOrientation !== "function") {
        resolve();
        return;
      }
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const finishTimer = setTimeout(done, 140);
      try {
        wx.setPageOrientation({
          orientation: ORIENTATION_PORTRAIT,
          success: () => {
            clearTimeout(finishTimer);
            setTimeout(done, 36);
          },
          fail: () => {
            clearTimeout(finishTimer);
            done();
          }
        });
      } catch (err) {
        clearTimeout(finishTimer);
        done();
      }
    });
  },

  async exitToMap() {
    if (this._exitingToMap) return;
    this._exitingToMap = true;
    await this.switchToPortraitForMapExit();
    if (typeof wx !== "undefined" && typeof wx.navigateBack === "function") {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          if (typeof wx.reLaunch === "function") {
            wx.reLaunch({ url: "/pages/map/map" });
          }
        }
      });
      return;
    }
    if (typeof wx !== "undefined" && typeof wx.reLaunch === "function") {
      wx.reLaunch({ url: "/pages/map/map" });
    }
  }
});
