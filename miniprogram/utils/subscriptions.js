const { resolveApiBase, authorizedRequest, getAuthToken } = require("./profile");

const SUBSCRIPTION_TEMPLATE_ID = "xkKkpiG1HkMXHfvBWzf4DyisFCsSP3LNFQ1bgMv0zeE";

function normalizeTemplateIds(listLike) {
  if (!listLike) return [];
  const output = [];
  if (Array.isArray(listLike)) {
    listLike.forEach((item) => {
      const text = typeof item === "string" || typeof item === "number" ? `${item}`.trim() : "";
      if (text) output.push(text);
    });
  } else if (typeof listLike === "object") {
    Object.values(listLike).forEach((val) => {
      const text = typeof val === "string" || typeof val === "number" ? `${val}`.trim() : "";
      if (text) output.push(text);
    });
  } else if (typeof listLike === "string" || typeof listLike === "number") {
    const text = `${listLike}`.trim();
    if (text) output.push(text);
  }
  return Array.from(new Set(output));
}

function areTemplateIdSetsEqual(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  if (setA.size !== b.length) return false;
  return b.every((id) => setA.has(id));
}

function fetchTemplateSettings(options = {}) {
  return authorizedRequest({
    apiBase: resolveApiBase(options.apiBase),
    token: options.token || getAuthToken(),
    path: "/api/config/template-settings",
    method: "GET"
  }).then((body = {}) => {
    const templates = body?.data?.templates || {};
    return {
      templateIds: normalizeTemplateIds(templates),
      raw: body?.data || {}
    };
  });
}

function fetchSubscriptions(options = {}) {
  return authorizedRequest({
    apiBase: resolveApiBase(options.apiBase),
    token: options.token || getAuthToken(),
    path: "/api/weapp/subscriptions",
    method: "GET"
  })
    .then((body = {}) => {
      const data = body?.data || {};
      return normalizeTemplateIds(data.templateIds || data.templates || data);
    })
    .catch((err) => {
      const message = err?.message || "";
      if (message.includes("404")) {
        return [];
      }
      throw err;
    });
}

function updateSubscriptions(templateIds = [], options = {}) {
  return authorizedRequest({
    apiBase: resolveApiBase(options.apiBase),
    token: options.token || getAuthToken(),
    path: "/api/weapp/subscriptions",
    method: "PUT",
    data: { templateIds: normalizeTemplateIds(templateIds) }
  }).then((body = {}) => body?.data || {});
}

function requestSubscribeMessageForTemplateIds(templateIds = []) {
  return new Promise((resolve, reject) => {
    const ids = normalizeTemplateIds(templateIds);
    if (!ids.length) {
      resolve({ acceptedIds: [], result: {} });
      return;
    }
    if (typeof wx === "undefined" || typeof wx.requestSubscribeMessage !== "function") {
      reject(new Error("requestSubscribeMessage-unavailable"));
      return;
    }
    console.log("Requesting subscribe message for template IDs:", ids);
    wx.requestSubscribeMessage({
      tmplIds: ids,
      success: (res = {}) => {
        const acceptedIds = ids.filter((id) => {
          const status = res[id];
          if (!status) return false;
          const text = `${status}`.toLowerCase();
          return text === "accept" || text === "accepted" || text === "always";
        });
        console.log("Subscribe message request result:", res, "Accepted IDs:", acceptedIds);
        resolve({ acceptedIds, result: res });
      },
      fail: (err) => reject(err)
    });
  });
}

function fetchLatestSubscriptionPush(options = {}) {
  const templateId = options.templateId || SUBSCRIPTION_TEMPLATE_ID;
  if (!templateId) {
    return Promise.reject(new Error("missing-template-id"));
  }
  return authorizedRequest({
    apiBase: resolveApiBase(options.apiBase),
    token: options.token || getAuthToken(),
    path: `/api/weapp/subscription-pushes/latest?templateId=${encodeURIComponent(templateId)}`,
    method: "GET"
  }).then((body = {}) => body?.data || {});
}

function extractAcceptedTemplateIdsFromWxSetting(subscriptionsSetting) {
  if (!subscriptionsSetting || typeof subscriptionsSetting !== "object") return null;
  const itemSettings = subscriptionsSetting.itemSettings || subscriptionsSetting.itemsettings;
  if (!itemSettings || typeof itemSettings !== "object") return [];
  const accepted = [];
  Object.keys(itemSettings).forEach((key) => {
    const status = itemSettings[key];
    const text = typeof status === "string" ? status.toLowerCase() : "";
    if (text === "accept" || text === "accepted" || text === "always") {
      accepted.push(key);
    }
  });
  return normalizeTemplateIds(accepted);
}

module.exports = {
  fetchTemplateSettings,
  fetchSubscriptions,
  updateSubscriptions,
  requestSubscribeMessageForTemplateIds,
  extractAcceptedTemplateIdsFromWxSetting,
  normalizeTemplateIds,
  areTemplateIdSetsEqual,
  fetchLatestSubscriptionPush,
  SUBSCRIPTION_TEMPLATE_ID
};
