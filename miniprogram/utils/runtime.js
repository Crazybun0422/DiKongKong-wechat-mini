function normalizeRuntimeField(value) {
  return `${value || ""}`.toLowerCase();
}

function getRuntimeInfo() {
  let appBase = {};
  if (typeof wx !== "undefined" && typeof wx.getAppBaseInfo === "function") {
    try {
      appBase = wx.getAppBaseInfo() || {};
    } catch (err) {
      appBase = {};
    }
  }
  return {
    appName: appBase.appName || appBase.hostName || "",
    host: appBase.host || appBase.hostName || "",
    hostName: appBase.hostName || ""
  };
}

function isWeChatRuntime() {
  try {
    const info = getRuntimeInfo();
    const env = normalizeRuntimeField(info.host || info.hostName);
    const appName = normalizeRuntimeField(info.appName || info.hostName);
    if (!env && !appName) return true;
    return (
      env.includes("wechat") ||
      env.includes("weixin") ||
      appName.includes("weixin") ||
      appName.includes("wechat")
    );
  } catch (err) {
    return true;
  }
}

module.exports = {
  isWeChatRuntime
};
