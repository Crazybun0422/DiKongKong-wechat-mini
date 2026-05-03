const {
  fetchUserProfile,
  loadStoredProfile,
  normalizeProfileData,
  resolveApiBase
} = require("../../utils/profile");
const { fetchMapLayerSettings } = require("../../utils/map-layer-settings");
const { shouldShowGuide } = require("../../utils/policies");
const { prepareSelectedVoicePack, playVoicePackEvent } = require("../../utils/voice-pack");

const DEFAULT_ERROR = "初始化失败，请重试";

function normalizeInitialMyLocationIconType(settings = {}) {
  const extraConfig =
    settings && typeof settings.extraConfig === "object" && settings.extraConfig
      ? settings.extraConfig
      : {};
  const raw = `${extraConfig.myLocationIconType || ""}`.trim();
  if (raw === "avatar" || raw === "highlight") {
    return raw;
  }
  return settings.useDefaultCenterPoint === false ? "highlight" : "default";
}

function safeStringify(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (key, current) => {
        if (typeof current === "function") {
          return `[Function ${current.name || "anonymous"}]`;
        }
        if (typeof current === "object" && current !== null) {
          if (seen.has(current)) return "[Circular]";
          seen.add(current);
        }
        return current;
      },
      2
    );
  } catch (err) {
    return "";
  }
}

function formatErrorDetail(err) {
  if (!err) return "";
  const detail = {
    name: err.name || "",
    message: err.message || "",
    code: err.code || "",
    statusCode: err.statusCode || "",
    errMsg: err.errMsg || "",
    method: err.method || "",
    path: err.path || "",
    url: err.url || "",
    response: err.response || err.data || null
  };
  if (err && typeof err === "object") {
    const raw = {};
    Object.getOwnPropertyNames(err).forEach((key) => {
      raw[key] = err[key];
    });
    detail.raw = raw;
  }
  const serialized = safeStringify(detail);
  return serialized || "";
}

function mergeLaunchOptions(primary = {}, secondary = {}) {
  const merged = Object.assign({}, primary || {}, secondary || {});
  const primaryQuery = primary?.query && typeof primary.query === "object" ? primary.query : {};
  const secondaryQuery = secondary?.query && typeof secondary.query === "object" ? secondary.query : {};
  const query = Object.assign({}, primaryQuery, secondaryQuery);
  if (Object.keys(query).length) {
    merged.query = query;
  }
  return merged;
}

Page({
  data: {
    loading: true,
    error: "",
    errorDetail: ""
  },

  onLoad(options = {}) {
    this._pageOptions = options || {};
    this.bootstrap();
  },

  onRetryTap() {
    this.bootstrap();
  },

  onViewDetailTap() {
    const detail = this.data.errorDetail || "暂无错误详情";
    wx.showModal({
      title: "错误详情",
      content: detail,
      showCancel: false,
      confirmText: "我知道了",
      success: (res) => {
        if (!res?.confirm) return;
        wx.setClipboardData({
          data: detail,
          success: () => {
            wx.showToast({
              title: "内容已拷贝，请发给相关人员",
              icon: "none"
            });
          }
        });
      }
    });
  },

  bootstrap() {
    if (this._navigating) return;
    this._profileRetry = false;
    this.setData({ loading: true, error: "", errorDetail: "" });
    this.prepareLaunchOptions();
    const preloadGuide = this.preloadGuideSubpackage();
    this.ensureProfile()
      .then((profile = {}) =>
        Promise.all([
          this.preloadInitialMapLocationMode(),
          this.preloadVoicePack(profile)
        ]).then(() => profile)
      )
      .then((profile = {}) => {
        if (this._navigating) return;
        if (shouldShowGuide(profile)) {
          preloadGuide.finally(() => this.goGuide());
        } else {
          this.goMap();
        }
      })
      .catch((err) => {
        console.warn("entry bootstrap failed", err);
        if (this._navigating) return;
        const message = err?.message || DEFAULT_ERROR;
        this.setData({
          loading: false,
          error: message,
          errorDetail: formatErrorDetail(err)
        });
      });
  },

  preloadGuideSubpackage() {
    if (this._preloadGuidePromise) return this._preloadGuidePromise;
    if (typeof wx.preloadSubpackage !== "function") {
      this._preloadGuidePromise = Promise.resolve();
      return this._preloadGuidePromise;
    }
    this._preloadGuidePromise = new Promise((resolve) => {
      wx.preloadSubpackage({
        name: "packages/guide",
        success: () => resolve(),
        fail: () => resolve()
      });
    }).finally(() => {
      this._preloadGuidePromise = null;
    });
    return this._preloadGuidePromise;
  },

  prepareLaunchOptions() {
    const app = typeof getApp === "function" ? getApp() : null;
    if (!app || !app.globalData) return;
    const fallbackLaunch =
      typeof wx.getLaunchOptionsSync === "function" ? wx.getLaunchOptionsSync() : {};
    const hasLaunchOptions =
      app.globalData.launchOptions && Object.keys(app.globalData.launchOptions).length > 0;
    const launchOptions = hasLaunchOptions ? app.globalData.launchOptions : fallbackLaunch;
    const merged = mergeLaunchOptions(launchOptions, this._pageOptions || {});
    app.globalData.pendingLaunchOptions = merged;
  },

  ensureAccessToken() {
    const app = typeof getApp === "function" ? getApp() : null;
    if (app?.globalData?.token) {
      return Promise.resolve();
    }
    if (app && typeof app.loginWithProfile === "function") {
      return app.loginWithProfile(loadStoredProfile());
    }
    return Promise.reject(new Error("login-unavailable"));
  },

  ensureProfile() {
    const app = typeof getApp === "function" ? getApp() : null;
    const apiBase = resolveApiBase();
    const fetchProfile = () =>
      fetchUserProfile({
        apiBase,
        token: app?.globalData?.token
      });
    return this.ensureAccessToken()
      .then(fetchProfile)
      .then((profile = {}) => {
        if (app && app.globalData) {
          app.globalData.latestUserProfile = profile;
          app.globalData.latestUserProfileAt = Date.now();
        }
        return profile;
      })
      .catch((err) => {
        if (this._profileRetry) {
          throw err;
        }
        this._profileRetry = true;
        if (app && typeof app.loginWithProfile === "function") {
          return app.loginWithProfile(loadStoredProfile())
            .then(fetchProfile)
            .then((profile = {}) => {
              if (app && app.globalData) {
                app.globalData.latestUserProfile = profile;
                app.globalData.latestUserProfileAt = Date.now();
              }
              return profile;
            });
        }
        throw err;
      });
  },

  preloadInitialMapLocationMode() {
    const app = typeof getApp === "function" ? getApp() : null;
    if (!app || !app.globalData) {
      return Promise.resolve(false);
    }
    const apiBase = app.globalData.apiBase || resolveApiBase();
    const token = app.globalData.token;
    if (!apiBase || !token) {
      app.globalData.initialUsePlanetCenterPoint = false;
      app.globalData.initialMyLocationIconType = "default";
      return Promise.resolve(false);
    }
    return fetchMapLayerSettings({ apiBase, token })
      .then((settings = {}) => {
        const initialMyLocationIconType = normalizeInitialMyLocationIconType(settings);
        const usePlanetCenterPoint = initialMyLocationIconType !== "default";
        app.globalData.initialUsePlanetCenterPoint = usePlanetCenterPoint;
        app.globalData.initialMyLocationIconType = initialMyLocationIconType;
        return usePlanetCenterPoint;
      })
      .catch((err) => {
        console.warn("entry preload map layer settings failed", err);
        app.globalData.initialUsePlanetCenterPoint = false;
        app.globalData.initialMyLocationIconType = "default";
        return false;
      });
  },

  preloadVoicePack(profile = {}) {
    const app = typeof getApp === "function" ? getApp() : null;
    const apiBase = app?.globalData?.apiBase || resolveApiBase();
    const normalized = normalizeProfileData(profile, {
      storedProfile: loadStoredProfile(),
      apiBase
    });
    return prepareSelectedVoicePack(normalized, {
      apiBase,
      token: app?.globalData?.token
    })
      .then((pack) => {
        if (pack) playVoicePackEvent("start");
      })
      .catch((err) => {
        console.warn("entry preload voice pack failed", err);
      });
  },

  goGuide() {
    this._navigating = true;
    wx.reLaunch({
      url: "/packages/guide/index/index",
      fail: (err) => {
        console.warn("failed to navigate to guide", err);
        this._navigating = false;
        this.setData({
          loading: false,
          error: DEFAULT_ERROR,
          errorDetail: formatErrorDetail(err)
        });
      }
    });
  },

  goMap() {
    this._navigating = true;
    wx.reLaunch({
      url: "/pages/map/map",
      fail: (err) => {
        console.warn("failed to navigate to map", err);
        this._navigating = false;
        this.setData({
          loading: false,
          error: DEFAULT_ERROR,
          errorDetail: formatErrorDetail(err)
        });
      }
    });
  }
});
