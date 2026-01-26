const { fetchMarkerDetail } = require("../../../utils/markers");
const { normalizeMarkerDetail } = require("../../../utils/marker-detail");
const {
  resolveApiBase,
  fetchUserProfile,
  loadStoredProfile,
  normalizeProfileData,
  getAuthToken
} = require("../../../utils/profile");
const { appendInviteCodeToPath } = require("../../../utils/share");
const {
  requestWeappMerchantPoster,
  requestWeappMerchantPosterStatus
} = require("../../../utils/weapp");

const MERCHANT_POSTER_CACHE_PREFIX = "merchantPosterCache:";
const DEFAULT_SHARE_TITLE = "低空星球商户";

const decodeParamValue = (value) => {
  if (value === undefined || value === null) return "";
  const text = `${value}`.trim();
  if (!text) return "";
  try {
    return decodeURIComponent(text);
  } catch (err) {
    return text;
  }
};

const isHttpUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value);

Page({
  data: {
    loading: true,
    loadingText: "海报加载中...",
    error: "",
    posters: [],
    currentIndex: 0,
    activeBackground: "",
    merchantName: "",
    merchantPath: "",
    shareTitle: DEFAULT_SHARE_TITLE
  },

  onLoad(options = {}) {
    this.apiBase = resolveApiBase();
    this.fileSystemManager =
      typeof wx !== "undefined" && typeof wx.getFileSystemManager === "function"
        ? wx.getFileSystemManager()
        : null;
    this.userDataPath = (typeof wx !== "undefined" && wx.env && wx.env.USER_DATA_PATH) || "";
    this.merchantId = this.extractMerchantId(options);
    this.setData({ merchantPath: this.buildMerchantPath(this.merchantId) });
    if (typeof wx.showShareMenu === "function") {
      wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
    }
    this.reloadPosters();
  },

  extractMerchantId(options = {}) {
    if (!options || typeof options !== "object") return "";
    const candidateKeys = ["mId", "markerId", "markerID", "markId", "markID", "merchantId", "id"];
    for (const key of candidateKeys) {
      const raw = options[key];
      if (raw === undefined || raw === null) continue;
      const decoded = decodeParamValue(raw);
      if (decoded) return decoded;
    }
    return "";
  },

  buildMerchantPath(merchantId) {
    if (!merchantId) return "/pages/map/map";
    const base = `/pages/map/map?fs=1&mId=${encodeURIComponent(merchantId)}`;
    return appendInviteCodeToPath(base);
  },

  getAuthToken() {
    return getAuthToken();
  },

  reloadPosters() {
    if (!this.merchantId) {
      this.setData({ loading: false, error: "缺少商户信息" });
      return;
    }
    this.setData({ error: "", loading: true, loadingText: "海报加载中..." });
    this.loadMerchantDetail()
      .then((detail) => {
        if (!detail) {
          throw new Error("加载商户信息失败");
        }
        const normalized = normalizeMarkerDetail(detail, { apiBase: this.apiBase });
        const backgrounds = this.extractBackgroundUrls(normalized, detail);
        if (!backgrounds.length) {
          throw new Error("暂无可生成海报的商户图片");
        }
        this.setData({
          merchantName: normalized.name || "",
          shareTitle: normalized.name || DEFAULT_SHARE_TITLE
        });
        return this.fetchPosterProfile()
          .then((profile) => ({
            detail: normalized,
            backgrounds,
            profile
          }));
      })
      .then((payload) => this.loadMerchantPosters(payload))
      .catch((err) => {
        console.warn("load merchant posters failed", err);
        const message =
          err && err.message === "missing-token"
            ? "请先登录后再生成海报"
            : err?.message || "海报生成失败，请稍后重试";
        this.setData({ loading: false, error: message });
      });
  },

  loadMerchantDetail() {
    return fetchMarkerDetail(this.merchantId, {
      apiBase: this.apiBase,
      token: this.getAuthToken()
    }).then((detail = {}) => detail || {});
  },

  extractBackgroundUrls(normalized = {}, raw = {}) {
    const urls = [];
    const images = Array.isArray(normalized.images) ? normalized.images : [];
    images.forEach((item) => {
      const url = item && typeof item.url === "string" ? item.url.trim() : "";
      if (url) urls.push(url);
    });
    if (!urls.length) {
      const fallback = normalized.imageUrl || raw.coverImage || raw.cover || "";
      if (fallback) urls.push(fallback);
    }
    return urls;
  },

  fetchPosterProfile() {
    const stored = loadStoredProfile() || {};
    return fetchUserProfile({ apiBase: this.apiBase, token: this.getAuthToken() })
      .then((profile = {}) =>
        normalizeProfileData(profile, { storedProfile: stored, apiBase: this.apiBase })
      )
      .catch(() => normalizeProfileData({}, { storedProfile: stored, apiBase: this.apiBase }));
  },

  loadMerchantPosters({ detail, backgrounds, profile }) {
    const merchantPath = this.buildMerchantPath(this.merchantId);
    const title = detail.name || "";
    const desc = detail.description || detail.locationText || "";
    const username = profile.nickname || "";
    const avatarUrl = profile.avatarUrl || "";
    const cacheKey = this.getCacheKey(this.merchantId);
    return this.readCachedPosterMap(cacheKey).then((cachedMap) => {
      const total = backgrounds.length;
      const posters = [];
      const run = (index) => {
        if (index >= total) {
          this.cachePosterItems(cacheKey, {
            merchantId: this.merchantId,
            merchantPath,
            title,
            desc,
            username,
            avatarUrl,
            items: posters
          });
          this.applyPosterResult(posters);
          return Promise.resolve();
        }
        const backgroundUrl = backgrounds[index];
        const payload = {
          merchantPath,
          backgroundUrl,
          username,
          avatarUrl,
          title,
          desc
        };
        return requestWeappMerchantPosterStatus(payload, { apiBase: this.apiBase, token: this.getAuthToken() })
          .then((status = {}) => {
            const cached = cachedMap[backgroundUrl];
            if (!status.needRegenerate && cached) {
              posters.push({ backgroundUrl, path: cached, source: "cache" });
              return run(index + 1);
            }
            this.setData({
              loading: true,
              loadingText: `海报生成中...（第${index + 1}张/共${total}张）`
            });
            return requestWeappMerchantPoster(payload, { apiBase: this.apiBase, token: this.getAuthToken() })
              .then((result) => this.resolvePosterPath(result))
              .then((path) => {
                if (!path) {
                  throw new Error("poster-empty");
                }
                posters.push({ backgroundUrl, path, source: "file" });
                return run(index + 1);
              });
          })
          .catch((err) => {
            console.warn("merchant poster status failed", err);
            const cached = cachedMap[backgroundUrl];
            if (cached) {
              posters.push({ backgroundUrl, path: cached, source: "cache" });
              return run(index + 1);
            }
            this.setData({
              loading: true,
              loadingText: `海报生成中...（第${index + 1}张/共${total}张）`
            });
            return requestWeappMerchantPoster(payload, { apiBase: this.apiBase, token: this.getAuthToken() })
              .then((result) => this.resolvePosterPath(result))
              .then((path) => {
                if (!path) {
                  throw new Error("poster-empty");
                }
                posters.push({ backgroundUrl, path, source: "file" });
                return run(index + 1);
              });
          });
      };
      return run(0);
    });
  },

  applyPosterResult(posters = []) {
    const list = Array.isArray(posters) ? posters : [];
    const first = list[0] || {};
    this.resetPosterLoadState(list);
    this.setData({
      posters: list,
      currentIndex: 0,
      activeBackground: first.path || first.backgroundUrl || "",
      loading: list.length > 0,
      loadingText: list.length ? "海报加载中..." : "",
      error: list.length ? "" : "暂无可用海报"
    });
  },

  resetPosterLoadState(list = []) {
    this.posterLoadedMap = new Set();
    this.posterLoadTotal = Array.isArray(list) ? list.length : 0;
  },

  handlePosterImageLoaded(index) {
    if (!this.posterLoadedMap || this.posterLoadTotal <= 0) {
      if (this.data.loading) {
        this.setData({ loading: false });
      }
      return;
    }
    const safeIndex = Number(index);
    if (Number.isNaN(safeIndex)) {
      return;
    }
    if (this.posterLoadedMap.has(safeIndex)) {
      return;
    }
    this.posterLoadedMap.add(safeIndex);
    if (this.posterLoadedMap.size >= this.posterLoadTotal) {
      this.setData({ loading: false });
    }
  },

  onPosterImageLoad(e) {
    this.handlePosterImageLoaded(e?.currentTarget?.dataset?.index);
  },

  onPosterImageError(e) {
    this.handlePosterImageLoaded(e?.currentTarget?.dataset?.index);
  },

  getCacheKey(merchantId = "") {
    const trimmed = `${merchantId || ""}`.trim();
    return `${MERCHANT_POSTER_CACHE_PREFIX}${trimmed || "unknown"}`;
  },

  readCachedPosterMap(cacheKey) {
    if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
      return Promise.resolve({});
    }
    let cached;
    try {
      cached = wx.getStorageSync(cacheKey);
    } catch (err) {
      console.warn("readCachedPosterMap failed", err);
    }
    const items = cached && Array.isArray(cached.items) ? cached.items : [];
    const map = {};
    const checks = items.map((item) => {
      const backgroundUrl = item?.backgroundUrl || "";
      const path = item?.path || "";
      if (!backgroundUrl || !path) return Promise.resolve();
      if (isHttpUrl(path)) {
        return this.downloadAndSaveFile(path)
          .then((saved) => {
            if (saved) {
              map[backgroundUrl] = saved;
            }
          })
          .catch(() => { });
      }
      return this.checkFileExists(path).then((exists) => {
        if (exists) {
          map[backgroundUrl] = path;
        }
      });
    });
    return Promise.all(checks).then(() => map);
  },

  cachePosterItems(cacheKey, payload = {}) {
    if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") {
      return;
    }
    const items = Array.isArray(payload.items) ? payload.items : [];
    const normalizedItems = items
      .filter((item) => item && item.backgroundUrl && item.path)
      .map((item) => ({
        backgroundUrl: item.backgroundUrl,
        path: item.path,
        source: item.source || "",
        updatedAt: Date.now()
      }));
    if (!normalizedItems.length) {
      return;
    }
    const cachePayload = {
      merchantId: payload.merchantId || "",
      merchantPath: payload.merchantPath || "",
      title: payload.title || "",
      desc: payload.desc || "",
      username: payload.username || "",
      avatarUrl: payload.avatarUrl || "",
      items: normalizedItems,
      updatedAt: Date.now()
    };
    try {
      wx.setStorageSync(cacheKey, cachePayload);
    } catch (err) {
      console.warn("cachePosterItems failed", err);
    }
  },

  checkFileExists(path) {
    const fs = this.fileSystemManager;
    if (!fs || !path) return Promise.resolve(false);
    if (typeof fs.access === "function") {
      return new Promise((resolve) => {
        fs.access({
          path,
          success: () => resolve(true),
          fail: () => resolve(false)
        });
      });
    }
    if (typeof fs.accessSync === "function") {
      try {
        fs.accessSync(path);
        return Promise.resolve(true);
      } catch (err) {
        return Promise.resolve(false);
      }
    }
    return Promise.resolve(true);
  },

  resolvePosterPath(result) {
    const candidate = this.normalizePosterResult(result);
    if (!candidate) {
      return Promise.resolve("");
    }
    if (isHttpUrl(candidate)) {
      return this.downloadAndSaveFile(candidate);
    }
    return Promise.resolve(candidate);
  },

  normalizePosterResult(result) {
    if (!result && result !== 0) return "";
    if (typeof result === "string") {
      return result.trim();
    }
    if (typeof result === "object") {
      const direct =
        result.tempFilePath ||
        result.path ||
        result.url ||
        result.imageUrl;
      if (typeof direct === "string" && direct.trim()) {
        return direct.trim();
      }
    }
    return "";
  },

  downloadAndSaveFile(url) {
    return new Promise((resolve, reject) => {
      if (!url) {
        reject(new Error("missing-url"));
        return;
      }
      wx.downloadFile({
        url,
        success: (res) => {
          const tempPath = res.tempFilePath;
          if (!tempPath) {
            reject(new Error("download-empty"));
            return;
          }
          if (typeof wx.saveFile !== "function") {
            resolve(tempPath);
            return;
          }
          wx.saveFile({
            tempFilePath: tempPath,
            success: (saveRes) => resolve(saveRes.savedFilePath || tempPath),
            fail: () => resolve(tempPath)
          });
        },
        fail: reject
      });
    });
  },

  onPosterChange(e) {
    const index = Number(e?.detail?.current) || 0;
    const poster = (this.data.posters || [])[index] || {};
    this.setData({
      currentIndex: index,
      activeBackground: poster.path || poster.backgroundUrl || ""
    });
  },

  onSavePosterTap() {
    const poster = this.getCurrentPoster();
    const path = poster?.path || poster?.backgroundUrl || "";
    if (!path) {
      wx.showToast({ title: "暂无可保存的海报", icon: "none" });
      return;
    }
    wx.showLoading({ title: "保存中...", mask: true });
    this.resolvePosterPath(path)
      .then((filePath) => {
        wx.saveImageToPhotosAlbum({
          filePath,
          success: () => {
            wx.hideLoading();
            wx.showToast({ title: "已保存", icon: "success" });
          },
          fail: (err) => {
            wx.hideLoading();
            this.handleSaveImageError(err);
          }
        });
      })
      .catch((err) => {
        wx.hideLoading();
        console.warn("save poster failed", err);
        wx.showToast({ title: "保存失败，请稍后再试", icon: "none" });
      });
  },

  handleSaveImageError(err) {
    if (err && typeof err.errMsg === "string" && err.errMsg.includes("auth deny")) {
      wx.showModal({
        title: "需要授权",
        content: "请在设置中允许保存到相册",
        confirmText: "去设置",
        success: (res) => {
          if (res.confirm && typeof wx.openSetting === "function") {
            wx.openSetting({});
          }
        }
      });
      return;
    }
    wx.showToast({ title: "保存失败", icon: "none" });
  },

  getCurrentPoster() {
    const list = Array.isArray(this.data.posters) ? this.data.posters : [];
    return list[this.data.currentIndex] || list[0] || null;
  },

  onShareTimelineTap() {
    if (typeof wx.showShareMenu === "function") {
      wx.showShareMenu({ menus: ["shareTimeline"] });
    }
    wx.showToast({ title: "请点击右上角分享到朋友圈", icon: "none" });
  },

  onRetryTap() {
    this.setData({ error: "" });
    this.reloadPosters();
  },

  onCloseTap() {
    wx.navigateBack({ delta: 1 });
  },

  onShareAppMessage() {
    const poster = this.getCurrentPoster();
    return {
      title: this.data.shareTitle || DEFAULT_SHARE_TITLE,
      path: this.data.merchantPath || "/pages/map/map",
      imageUrl: poster?.path || poster?.backgroundUrl || ""
    };
  },

  onShareTimeline() {
    const poster = this.getCurrentPoster();
    const path = this.data.merchantPath || "/pages/map/map";
    const queryIndex = path.indexOf("?");
    const query = queryIndex >= 0 ? path.slice(queryIndex + 1) : "";
    return {
      title: this.data.shareTitle || DEFAULT_SHARE_TITLE,
      query,
      imageUrl: poster?.path || poster?.backgroundUrl || ""
    };
  }
});
