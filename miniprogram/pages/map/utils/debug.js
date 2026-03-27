function buildDebugInfo(page, extra = {}) {
  const base = page._debugInfoBase || {};
  return Object.assign({}, base, page.data.debugInfo || {}, extra);
}

function updateDebugPanel(page, extra = {}) {
  if (!page.data.debugEnabled) return;
  page.setData({ debugInfo: buildDebugInfo(page, extra) });
}

function formatDebugCoord(point) {
  const lat = Number(point?.latitude);
  const lng = Number(point?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `${lng.toFixed(6)}, ${lat.toFixed(6)}`;
}

function formatDebugRegion(region) {
  const ne = region?.northeast;
  const sw = region?.southwest;
  if (!ne || !sw) return "";
  const neLat = Number(ne.latitude);
  const neLng = Number(ne.longitude);
  const swLat = Number(sw.latitude);
  const swLng = Number(sw.longitude);
  if (![neLat, neLng, swLat, swLng].every(Number.isFinite)) return "";
  return `${swLng.toFixed(4)},${swLat.toFixed(4)} -> ${neLng.toFixed(4)},${neLat.toFixed(4)}`;
}

function collectRuntimeDebugInfo(options = {}) {
  let deviceInfo = {};
  let systemInfo = {};
  try {
    if (typeof wx !== "undefined" && typeof wx.getDeviceInfo === "function") {
      deviceInfo = wx.getDeviceInfo() || {};
    }
  } catch (err) {
    deviceInfo = {};
  }
  try {
    if (typeof wx !== "undefined" && typeof wx.getSystemInfoSync === "function") {
      systemInfo = wx.getSystemInfoSync() || {};
    }
  } catch (err) {
    systemInfo = {};
  }
  const appBase = options.appBase || {};
  const toText = (val) => (val === undefined || val === null ? "" : `${val}`);
  return {
    appName: toText(appBase.appName || appBase.hostName || ""),
    host: toText(appBase.host || appBase.hostName || ""),
    hostName: toText(appBase.hostName || ""),
    platform: toText(deviceInfo.platform || systemInfo.platform || appBase.platform || ""),
    system: toText(systemInfo.system || ""),
    model: toText(systemInfo.model || ""),
    brand: toText(systemInfo.brand || ""),
    runtimeIsWeChat: `${!!options.runtimeIsWeChat}`,
    runtimeIsDesktop: `${!!options.runtimeIsDesktop}`,
    isDevtools: `${!!options.isDevtools}`,
    useWeChatUom: `${!!options.useWeChatUom}`,
    hasWx: `${typeof wx !== "undefined"}`,
    hasQq: `${typeof qq !== "undefined"}`
  };
}

module.exports = {
  buildDebugInfo,
  updateDebugPanel,
  formatDebugCoord,
  formatDebugRegion,
  collectRuntimeDebugInfo
};
