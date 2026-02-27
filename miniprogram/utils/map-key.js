const { QQMAP_KEY } = require("./config");
const { resolveApiBase } = require("./profile");

const MAP_KEY_STORAGE_KEY = "weappMapKey";

let memoryMapKey = "";
let pendingMapKeyRequest = null;

function getAppInstance() {
  try {
    return getApp ? getApp() : null;
  } catch (err) {
    console.warn("getApp failed for map key", err);
    return null;
  }
}

function normalizeMapKey(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getDefaultMapKey() {
  return normalizeMapKey(QQMAP_KEY);
}

function readStoredMapKey() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
    return "";
  }
  try {
    return normalizeMapKey(wx.getStorageSync(MAP_KEY_STORAGE_KEY));
  } catch (err) {
    console.warn("Failed to read stored map key", err);
    return "";
  }
}

function cacheMapKey(value) {
  const next = normalizeMapKey(value);
  if (!next) return "";
  memoryMapKey = next;
  const app = getAppInstance();
  if (app && app.globalData) {
    app.globalData.mapKey = next;
  }
  if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
    try {
      wx.setStorageSync(MAP_KEY_STORAGE_KEY, next);
    } catch (err) {
      console.warn("Failed to store map key", err);
    }
  }
  return next;
}

function getCachedMapKey() {
  if (memoryMapKey) return memoryMapKey;
  const app = getAppInstance();
  const fromGlobal = normalizeMapKey(app?.globalData?.mapKey);
  if (fromGlobal) {
    memoryMapKey = fromGlobal;
    return fromGlobal;
  }
  const stored = readStoredMapKey();
  if (stored) {
    memoryMapKey = stored;
    return stored;
  }
  return "";
}

function requestRemoteMapKey(options = {}) {
  const apiBase = resolveApiBase(options.apiBase);
  if (!apiBase) {
    return Promise.reject(new Error("missing-api-base"));
  }
  if (!options.forceRefresh && pendingMapKeyRequest) {
    return pendingMapKeyRequest;
  }
  pendingMapKeyRequest = new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase}/api/weapp/config/map-key`,
      method: "GET",
      header: {
        "content-type": "application/json"
      },
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const reason = res.data?.message || res.errMsg || `status-${res.statusCode}`;
          reject(new Error(typeof reason === "string" ? reason : JSON.stringify(reason)));
          return;
        }
        const remoteMapKey = normalizeMapKey(res.data?.data?.mapKey || res.data?.mapKey);
        resolve(cacheMapKey(remoteMapKey));
      },
      fail: (err) => reject(err)
    });
  }).finally(() => {
    pendingMapKeyRequest = null;
  });
  return pendingMapKeyRequest;
}

function getMapKeySync() {
  return getCachedMapKey() || getDefaultMapKey();
}

function resolveMapKey(options = {}) {
  const cached = getCachedMapKey();
  const fallback = cached || getDefaultMapKey();
  if (options.preferRemote === false && fallback) {
    return Promise.resolve(fallback);
  }
  if (!options.forceRefresh && cached) {
    return Promise.resolve(cached);
  }
  return requestRemoteMapKey(options)
    .then((key) => key || fallback)
    .catch(() => fallback);
}

function prefetchMapKey(options = {}) {
  const cached = getCachedMapKey();
  if (!options.forceRefresh && cached) {
    return Promise.resolve(cached);
  }
  return requestRemoteMapKey(options)
    .then((key) => key || getDefaultMapKey())
    .catch(() => cached || getDefaultMapKey());
}

module.exports = {
  MAP_KEY_STORAGE_KEY,
  getDefaultMapKey,
  getMapKeySync,
  resolveMapKey,
  prefetchMapKey
};
