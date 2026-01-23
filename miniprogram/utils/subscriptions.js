const { resolveApiBase, authorizedRequest, getAuthToken } = require("./profile");

// Fixed template ID used by latest subscription push content API
const SUBSCRIPTION_TEMPLATE_ID = "WEAPP_PUSH_CONTENT";

function normalizeTemplateIds(listLike) {
  if (!listLike) return [];
  const output = [];
  const pushText = (val) => {
    const text = typeof val === "string" || typeof val === "number" ? `${val}`.trim() : "";
    if (text) output.push(text);
  };

  const collect = (val) => {
    if (!val) return;
    if (Array.isArray(val)) {
      val.forEach(collect);
      return;
    }
    const type = typeof val;
    if (type === "string" || type === "number") {
      pushText(val);
      return;
    }
    if (type !== "object") return;

    // TemplateSettingsResponse shape: { templates: { name: { templateId, details } }, ... }
    if (val.templates && typeof val.templates === "object") {
      Object.values(val.templates).forEach(collect);
      return;
    }

    // TemplateSettingDetail shape: { templateId, details }
    if ("templateId" in val) {
      pushText(val.templateId);
      return;
    }

    // Plain object map of templateName -> templateId
    Object.values(val).forEach((item) => {
      if (item && typeof item === "object" && "templateId" in item) {
        pushText(item.templateId);
      } else {
        pushText(item);
      }
    });
  };

  collect(listLike);
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
    console.log("Fetched template settings:", templates);
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

const ACCEPTED_SUBSCRIPTION_STATUSES = new Set([
  "accept",
  "accepted",
  "always",
  "acceptwithforcepush"
]);

function isAcceptedStatus(val) {
  const text = `${val || ""}`.toLowerCase();
  return ACCEPTED_SUBSCRIPTION_STATUSES.has(text);
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
          console.log(`Template ID: ${id}, status: ${`${status}`.toLowerCase()}`);
          return isAcceptedStatus(status);
        });
        const isRejectStatus = (val) => {
          const text = `${val || ""}`.toLowerCase();
          return text === "reject" || text === "rejected" || text === "ban" || text === "always_reject" || text === "never";
        };
        const anyRejected = ids.some((id) => isRejectStatus(res[id]));
        console.log("Subscribe message request result:", res, "Accepted IDs:", acceptedIds);
        resolve({ acceptedIds, result: res, anyRejected });
      },
      fail: (err) => reject(err)
    });
  });
}

function fetchLatestSubscriptionPush(options = {}) {
  return authorizedRequest({
    apiBase: resolveApiBase(options.apiBase),
    token: options.token || getAuthToken(),
    path: "/api/weapp/subscription-pushes/latest",
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
    if (isAcceptedStatus(status)) {
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
