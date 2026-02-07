const { fetchUserProfile, loadStoredProfile, resolveApiBase } = require("../../utils/profile");
const { shouldShowGuide } = require("../../utils/policies");

const DEFAULT_ERROR = "初始化失败，请重试";

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
    error: ""
  },

  onLoad(options = {}) {
    this._pageOptions = options || {};
    this.bootstrap();
  },

  onRetryTap() {
    this.bootstrap();
  },

  bootstrap() {
    if (this._navigating) return;
    this._profileRetry = false;
    this.setData({ loading: true, error: "" });
    this.prepareLaunchOptions();
    this.ensureProfile()
      .then((profile = {}) => {
        if (this._navigating) return;
        if (shouldShowGuide(profile)) {
          this.goGuide();
        } else {
          this.goMap();
        }
      })
      .catch((err) => {
        console.warn("entry bootstrap failed", err);
        if (this._navigating) return;
        const message = err?.message || DEFAULT_ERROR;
        this.setData({ loading: false, error: message });
      });
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

  goGuide() {
    this._navigating = true;
    wx.reLaunch({
      url: "/packages/guide/index/index",
      fail: (err) => {
        console.warn("failed to navigate to guide", err);
        this._navigating = false;
        this.setData({ loading: false, error: DEFAULT_ERROR });
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
        this.setData({ loading: false, error: DEFAULT_ERROR });
      }
    });
  }
});
