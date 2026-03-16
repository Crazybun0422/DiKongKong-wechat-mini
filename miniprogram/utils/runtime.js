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
    platform: deviceInfo.platform || appBase.platform || "",
    brand: deviceInfo.brand || ""
  };
}

function isWeChatRuntime() {
  try {
    const info = getRuntimeInfo();
    const appName = normalizeRuntimeField(info.appName);
    return appName === "weixin" || appName === "wechat";
  } catch (err) {
    return false;
  }
}

function isDevtoolsRuntime() {
  try {
    const info = getRuntimeInfo();
    const platform = normalizeRuntimeField(info.platform);
    const brand = normalizeRuntimeField(info.brand);
    return platform.includes("devtools") || brand.includes("devtools");
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

function isQQRuntime() {
  return !isWeChatRuntime();
}

function shouldUseWeChatUom() {
  return isWeChatRuntime() && !isDevtoolsRuntime() && !isDesktopRuntime();
}

module.exports = {
  isWeChatRuntime,
  isDevtoolsRuntime,
  isDesktopRuntime,
  isQQRuntime,
  shouldUseWeChatUom
};
