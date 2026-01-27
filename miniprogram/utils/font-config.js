const { resolveApiBase } = require("./profile");
const { buildFileDownloadUrl } = require("./markers");

const DEFAULT_FONT_FILE = "zh.subset.v2.woff2";
const FONT_FILE_STORAGE_KEY = "fontFileConfig";
const FONT_FILE_LOCAL_STORAGE_KEY = "fontFileLocalCache";

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

const normalizeFontLocalCache = (payload = {}) => {
  const fileName = typeof payload.fileName === "string" ? payload.fileName.trim() : "";
  const path = typeof payload.path === "string" ? payload.path.trim() : "";
  if (!fileName || !path) return null;
  return { fileName, path };
};

const readStoredFontLocalCache = () => {
  try {
    const stored = wx.getStorageSync(FONT_FILE_LOCAL_STORAGE_KEY);
    if (stored && typeof stored === "object") {
      return normalizeFontLocalCache(stored);
    }
  } catch (err) {
    console.warn("read font local cache failed", err);
  }
  return null;
};

const writeStoredFontLocalCache = (payload) => {
  if (!payload) return;
  try {
    wx.setStorageSync(FONT_FILE_LOCAL_STORAGE_KEY, payload);
  } catch (err) {
    console.warn("store font local cache failed", err);
  }
};

const getFileSystemManager = () => {
  if (typeof wx === "undefined" || typeof wx.getFileSystemManager !== "function") {
    return null;
  }
  try {
    return wx.getFileSystemManager();
  } catch (err) {
    return null;
  }
};

const checkFileExists = (fs, path) => {
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
};

const downloadFontFile = (url, fileName, fs) =>
  new Promise((resolve) => {
    if (typeof wx === "undefined" || typeof wx.downloadFile !== "function") {
      resolve(url);
      return;
    }
    wx.downloadFile({
      url,
      success: (res) => {
        const status = Number(res?.statusCode);
        const tempPath = res?.tempFilePath;
        if (!tempPath || (status && status >= 400)) {
          resolve(url);
          return;
        }
        if (!fs || typeof fs.saveFile !== "function") {
          resolve(tempPath);
          return;
        }
        fs.saveFile({
          tempFilePath: tempPath,
          success: (saveRes) => {
            const savedPath = saveRes?.savedFilePath || tempPath;
            if (savedPath) {
              writeStoredFontLocalCache({
                fileName,
                path: savedPath,
                updatedAt: Date.now()
              });
            }
            resolve(savedPath || tempPath);
          },
          fail: () => resolve(tempPath)
        });
      },
      fail: () => resolve(url)
    });
  });

const getLatestFontFileSource = (options = {}) => {
  const apiBase = options.apiBase;
  const forceRefresh = options.forceRefresh === true;
  return getLatestFontFileName({ apiBase, forceRefresh }).then((fileName) => {
    if (!fileName) return "";
    const url = buildFileDownloadUrl(fileName, { apiBase });
    if (!url) return "";
    const fs = getFileSystemManager();
    if (!fs) return url;
    const cached = forceRefresh ? null : readStoredFontLocalCache();
    if (cached?.fileName === fileName && cached.path) {
      return checkFileExists(fs, cached.path).then((exists) => {
        if (exists) return cached.path;
        return downloadFontFile(url, fileName, fs);
      });
    }
    return downloadFontFile(url, fileName, fs);
  });
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
  getLatestFontFileSource,
  prefetchFontFileConfig
};
