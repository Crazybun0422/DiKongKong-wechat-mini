function normalizeRuntimeField(value) {
  return `${value || ""}`.toLowerCase();
}

function getRuntimeInfo() {
  let appBase = {};
  let deviceInfo = {};
  const api =
    (typeof wx !== "undefined" && wx) ||
    (typeof qq !== "undefined" && qq) ||
    null;
  if (api && typeof api.getAppBaseInfo === "function") {
    try {
      appBase = api.getAppBaseInfo() || {};
    } catch (err) {
      appBase = {};
    }
  }
  if (api && typeof api.getDeviceInfo === "function") {
    try {
      deviceInfo = api.getDeviceInfo() || {};
    } catch (err) {
      deviceInfo = {};
    }
  }
  return {
    appName: appBase.appName || appBase.hostName || "",
    host: appBase.host || appBase.hostName || "",
    hostName: appBase.hostName || "",
    platform: deviceInfo.platform || appBase.platform || ""
  };
}

function isWeChatRuntime() {
  try {
    const info = getRuntimeInfo();
    const env = normalizeRuntimeField(info.host || info.hostName);
    const appName = normalizeRuntimeField(info.appName || info.hostName);
    if (!env && !appName) return false;
    return (
      env.includes("wechat") ||
      env.includes("weixin") ||
      appName.includes("weixin") ||
      appName.includes("wechat")
    );
  } catch (err) {
    return false;
  }
}

function isDesktopRuntime() {
  try {
    const info = getRuntimeInfo();
    const platform = normalizeRuntimeField(info.platform);
    return (
      platform.includes("windows") ||
      platform.includes("win") ||
      platform.includes("mac") ||
      platform.includes("desktop")
    );
  } catch (err) {
    return false;
  }
}

module.exports = {
  isWeChatRuntime,
  isDesktopRuntime
};
