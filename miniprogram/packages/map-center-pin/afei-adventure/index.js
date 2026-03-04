const { createAfeiGame } = require("./game/runtime");
const {
  getAuthToken,
  loadStoredProfile,
  ensureFeatureCode
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
    startLoading: false,
    panelStatusText: "",

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
      restart: false
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

    const localBest = this.readLocalBestScore();
    const storedProfile = loadStoredProfile();
    const featureCode = ensureFeatureCode(storedProfile?.featureCode || "");

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
    return {
      id: `${raw.featureCode || "row"}-${raw.rank || idx}`,
      rank: Number.isFinite(rank) && rank > 0 ? Math.floor(rank) : idx + 1,
      username: `${raw.username || "匿名飞手"}`,
      featureCode: `${raw.featureCode || ""}`,
      highestScore: toSafeScore(raw.highestScore, 0),
      avatarUrl: `${raw.avatarUrl || "/assets/default-avatar.png"}`
    };
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
            const lang = await readRuntimeLang(this.data.resourceDir);
            this._game = createAfeiGame({
              canvas,
              ctx,
              width,
              height,
              dpr,
              assetsBase: this.data.assetsBase,
              lang
            });

            this._gameOverHandler = (event = {}) => {
              this.handleGameOver(event);
            };
            if (typeof this._game.on === "function" && this._gameOverHandler) {
              this._game.on("gameover", this._gameOverHandler);
            }

            this.setData({ soundMuted: this._game.isMuted() });
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
    this.updatePressed("restart", false);
  },

  buildSessionPayload() {
    const profile = loadStoredProfile() || {};
    const featureCode = ensureFeatureCode(profile.featureCode || this.data.myFeatureCode || "");
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

    this.releaseAllControls();

    let writable = !this._offlineLocked && !this.data.offlineMode;
    let session = null;

    if (writable) {
      const token = getAuthToken();
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

    this.setData({
      showStartPanel: false,
      showLeaderboardPanel: false,
      gameStarted: true,
      startLoading: false,
      lastScore: 0
    });
  },

  async handleGameOver(event = {}) {
    if (!this.data.gameStarted) return;
    const score = toSafeScore(event?.score, 0);
    this.updateBestScore(score);
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
  },

  onSoundTouchEnd() {
    this.updatePressed("sound", false);
  },

  onSoundTap() {
    if (!this._game || typeof this._game.toggleMuted !== "function") return;
    const muted = this._game.toggleMuted();
    this.setData({ soundMuted: !!muted });
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
  }
});
