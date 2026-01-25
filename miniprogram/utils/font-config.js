const { resolveApiBase } = require("./profile");

const DEFAULT_FONT_FILE = "zh.subset.v2.woff2";
const FONT_FILE_STORAGE_KEY = "fontFileConfig";

let cachedConfig = null;
let pendingPromise = null;

const normalizeFontConfig = (payload = {}) => {
  const fileName = typeof payload.fileName === "string" ? payload.fileName.trim() : "";
  const version = typeof payload.version === "string" ? payload.version.trim() : "";
  if (!fileName) return null;
  return { fileName, version };
};

const readStoredFontConfig = () => {
  try {
    const stored = wx.getStorageSync(FONT_FILE_STORAGE_KEY);
    if (stored && typeof stored === "object") {
      return normalizeFontConfig(stored);
    }
  } catch (err) {
    console.warn("read font config failed", err);
  }
  return null;
};

const writeStoredFontConfig = (config) => {
  if (!config) return;
  try {
    wx.setStorageSync(FONT_FILE_STORAGE_KEY, config);
  } catch (err) {
    console.warn("store font config failed", err);
  }
};

const fetchFontFileConfig = (options = {}) =>
  new Promise((resolve, reject) => {
    const base = resolveApiBase(options.apiBase);
    if (!base) {
      reject(new Error("missing-api-base"));
      return;
    }
    wx.request({
      url: `${base}/api/config/font-file`,
      method: "GET",
      header: {
        "content-type": "application/json"
      },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(normalizeFontConfig(res.data?.data || {}) || null);
          return;
        }
        if (res.statusCode === 404) {
          resolve(null);
          return;
        }
        const reason = res.data?.message || res.errMsg || `status-${res.statusCode}`;
        reject(new Error(typeof reason === "string" ? reason : JSON.stringify(reason)));
      },
      fail: (err) => reject(err)
    });
  });

const prefetchFontFileConfig = (options = {}) => {
  if (pendingPromise) return pendingPromise;
  const stored = cachedConfig || readStoredFontConfig();
  if (stored) cachedConfig = stored;
  pendingPromise = fetchFontFileConfig(options)
    .then((remote) => {
      if (remote?.fileName) {
        cachedConfig = remote;
        writeStoredFontConfig(remote);
      }
      return cachedConfig;
    })
    .catch((err) => {
      console.warn("fetch font config failed", err);
      return cachedConfig;
    })
    .finally(() => {
      pendingPromise = null;
    });
  return pendingPromise;
};

const getLatestFontFileName = (options = {}) => {
  if (pendingPromise) {
    return pendingPromise.then((config) => config?.fileName || DEFAULT_FONT_FILE);
  }
  const cached = cachedConfig || readStoredFontConfig();
  if (cached?.fileName && !options.forceRefresh) {
    return Promise.resolve(cached.fileName);
  }
  return prefetchFontFileConfig(options).then((config) => config?.fileName || DEFAULT_FONT_FILE);
};

module.exports = {
  DEFAULT_FONT_FILE,
  fetchFontFileConfig,
  getLatestFontFileName,
  prefetchFontFileConfig
};
