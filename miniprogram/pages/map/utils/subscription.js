const {
  fetchTemplateSettings,
  fetchSubscriptions,
  requestSubscribeMessageForTemplateIds,
  updateSubscriptions,
  fetchLatestSubscriptionPush,
  SUBSCRIPTION_TEMPLATE_ID,
  normalizeTemplateIds,
  extractAcceptedTemplateIdsFromWxSetting
} = require("../../../utils/subscriptions");
const {
  REQUIRED_SUBSCRIPTION_TEMPLATE_IDS,
  SUBSCRIPTION_TEMPLATE_IDS
} = require("../../../config/subscription-templates");
const { setSubscribeWaitOverlay } = require("../../../utils/subscribe-wait");
const { fetchLatestItemVersion, normalizeVersion } = require("../../../utils/latest-items");

const hasAllRequiredSubscriptions = (ids = [], requiredIds = REQUIRED_SUBSCRIPTION_TEMPLATE_IDS) => {
  const normalized = normalizeTemplateIds(ids);
  const normalizedRequired = normalizeTemplateIds(requiredIds);
  if (!normalizedRequired.length) return true;
  return normalizedRequired.every((id) => normalized.includes(id));
};

function initSubscriptionBanner(page) {
  return evaluateSubscriptionBannerVisibility(page).catch((err) => {
    console.warn("initSubscriptionBanner failed", err);
  });
}

function waitForSubscriptionSettingsReady(page) {
  const app = typeof getApp === "function" ? getApp() : null;
  if (app && typeof app.syncSubscriptionsFromWxSetting === "function") {
    try {
      const promise = app.syncSubscriptionsFromWxSetting();
      if (promise && typeof promise.then === "function") {
        return promise.catch((err) => {
          console.warn("waitForSubscriptionSettingsReady failed", err);
          return { ids: [], mainSwitch: true };
        });
      }
    } catch (err) {
      console.warn("syncSubscriptionsFromWxSetting threw", err);
    }
  }
  if (app && app.globalData && Array.isArray(app.globalData.subscriptionAcceptedTemplateIds)) {
    return Promise.resolve({
      ids: app.globalData.subscriptionAcceptedTemplateIds,
      mainSwitch: app.globalData.subscriptionMainSwitch !== false
    });
  }
  return Promise.resolve({ ids: [], mainSwitch: true });
}

function setGlobalSubscriptionIds(page, list = [], mainSwitch = true) {
  const app = typeof getApp === "function" ? getApp() : null;
  const normalized = normalizeTemplateIds(list);
  if (app && app.globalData) {
    app.globalData.subscriptionAcceptedTemplateIds = normalized;
    app.globalData.subscriptionSettingsReady = true;
    app.globalData.subscriptionMainSwitch = mainSwitch !== false;
  }
  return normalized;
}

function setGlobalRequiredSubscriptionIds(page, list = []) {
  const app = typeof getApp === "function" ? getApp() : null;
  const normalized = normalizeTemplateIds(list);
  if (app && app.globalData) {
    app.globalData.subscriptionRequiredTemplateIds = normalized;
  }
  return normalized;
}

function resolveRequiredSubscriptionTemplateIds(page) {
  const configured = normalizeTemplateIds(REQUIRED_SUBSCRIPTION_TEMPLATE_IDS);
  const app = typeof getApp === "function" ? getApp() : null;
  const cached = normalizeTemplateIds(app?.globalData?.subscriptionRequiredTemplateIds || []);
  const apiBase = page.getApiBase();
  const token = page.getAuthToken();
  if (!apiBase || !token) {
    return Promise.resolve(cached);
  }
  return fetchTemplateSettings({ apiBase, token })
    .then(({ templateIds = [] }) => {
      const available = normalizeTemplateIds(templateIds);
      const required = configured.filter((id) => available.includes(id));
      return setGlobalRequiredSubscriptionIds(page, required);
    })
    .catch((err) => {
      console.warn("resolveRequiredSubscriptionTemplateIds failed", err);
      return cached;
    });
}

function setSubscriptionBannerVisibility(page) {
  if (page.data.showSubscriptionBanner !== false) {
    page.setData({ showSubscriptionBanner: false }, () => {
      page.updatePreflightOverlayTop(false);
    });
    return;
  }
  page.updatePreflightOverlayTop(false);
}

function getSubscriptionMainSwitch() {
  const app = typeof getApp === "function" ? getApp() : null;
  if (app && app.globalData) {
    return app.globalData.subscriptionMainSwitch !== false;
  }
  return true;
}

function evaluateSubscriptionBannerVisibility(page) {
  return Promise.all([
    waitForSubscriptionSettingsReady(page),
    resolveRequiredSubscriptionTemplateIds(page)
  ])
    .then(([payload = {}, requiredIds = []]) => {
      const clientIds = Array.isArray(payload.ids) ? payload.ids : [];
      const mainSwitch = payload.mainSwitch !== false;
      const normalizedClient = setGlobalSubscriptionIds(page, clientIds, mainSwitch);
      if (!requiredIds.length) {
        setSubscriptionBannerVisibility(page, false);
        return normalizedClient;
      }
      if (!mainSwitch) {
        setSubscriptionBannerVisibility(page, true);
        return normalizedClient;
      }
      const apiBase = page.getApiBase();
      const token = page.getAuthToken();
      if (!apiBase || !token) {
        setSubscriptionBannerVisibility(page, !hasAllRequiredSubscriptions(normalizedClient, requiredIds));
        return normalizedClient;
      }
      return fetchSubscriptions({ apiBase, token })
        .then((serverIds) => {
          const normalized = setGlobalSubscriptionIds(page, serverIds, mainSwitch);
          setSubscriptionBannerVisibility(page, !hasAllRequiredSubscriptions(normalized, requiredIds));
          return normalized;
        })
        .catch((err) => {
          console.warn("evaluateSubscriptionBannerVisibility failed", err);
          setSubscriptionBannerVisibility(page, !hasAllRequiredSubscriptions(normalizedClient, requiredIds));
          return normalizedClient;
        });
    })
    .catch((err) => {
      console.warn("evaluateSubscriptionBannerVisibility outer failed", err);
      setSubscriptionBannerVisibility(page, false);
      return [];
    });
}

function ensureCheckinSubscriptionOnEntry(page) {
  const apiBase = page.getApiBase();
  const token = page.getAuthToken();
  if (!apiBase || !token) return Promise.resolve();
  const templateId = SUBSCRIPTION_TEMPLATE_IDS.checkinReminder;
  return fetchSubscriptions({ apiBase, token })
    .then((serverIds = []) => {
      const normalized = normalizeTemplateIds(serverIds);
      if (!normalized.includes(templateId)) return null;
      return requestSubscribeMessageForTemplateIds([templateId]).catch(() => null);
    })
    .catch((err) => {
      console.warn("map ensureCheckinSubscriptionOnEntry fetch failed", err);
    });
}

function requestProfileSubscriptions(page) {
  const apiBase = page.getApiBase();
  const token = page.getAuthToken();
  if (!apiBase || !token) return Promise.resolve();
  const clearSubscribeWait = () => {
    setSubscribeWaitOverlay(false);
  };
  const checkSubscriptionsNotFound = () =>
    new Promise((resolve) => {
      wx.request({
        url: `${apiBase}/api/weapp/subscriptions`,
        method: "GET",
        header: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`
        },
        success: (res) => {
          if (res && res.statusCode === 404) {
            setSubscribeWaitOverlay(true);
          }
          resolve();
        },
        fail: () => resolve()
      });
    });
  return checkSubscriptionsNotFound()
    .then(() => fetchTemplateSettings({ apiBase, token }))
    .then(({ templateIds: availableTemplateIds = [] }) => {
      const templateIds = setGlobalRequiredSubscriptionIds(
        page,
        normalizeTemplateIds(REQUIRED_SUBSCRIPTION_TEMPLATE_IDS)
          .filter((id) => normalizeTemplateIds(availableTemplateIds).includes(id))
      );
      if (!templateIds.length) return null;
      return requestSubscribeMessageForTemplateIds(templateIds)
        .then(({ acceptedIds }) => {
          if (acceptedIds && acceptedIds.length) {
            return updateSubscriptions(acceptedIds, { apiBase, token }).catch((err) => {
              console.warn("updateSubscriptions after consent failed", err);
              return null;
            });
          }
          return null;
        });
    })
    .catch((err) => {
      console.warn("requestProfileSubscriptions failed", err);
      return null;
    })
    .finally(() => {
      clearSubscribeWait();
    });
}

function onSubscriptionBannerTap(page) {
  if (page.data.subscriptionBannerLoading) return;
  page.setData({ subscriptionBannerLoading: true });
  page.ensureProfileAuthenticated()
    .then(() => openSubscriptionSettingPicker(page))
    .catch((err) => {
      console.warn("subscription banner auth failed", err);
      wx.showToast({ title: "请先登录后再试", icon: "none" });
    })
    .finally(() => {
      page.setData({ subscriptionBannerLoading: false });
    });
}

function openSubscriptionSettingPicker(page, options = {}) {
  const prefAccepted = Array.isArray(options.prefAccepted) ? options.prefAccepted : [];
  return new Promise((resolve) => {
    if (typeof wx.openSetting !== "function") {
      resolve([]);
      return;
    }
    wx.openSetting({
      withSubscriptions: true,
      success: (res = {}) => {
        const mainSwitch = res?.subscriptionsSetting?.mainSwitch;
        const enabled = mainSwitch !== false;
        if (!enabled) {
          setGlobalSubscriptionIds(page, [], enabled);
          setSubscriptionBannerVisibility(page, true);
          wx.showToast({ title: "请先开启订阅消息总开关", icon: "none" });
          resolve([]);
          return;
        }
        console.log("res.subscriptionsSetting", res.subscriptionsSetting);
        const ids = extractAcceptedTemplateIdsFromWxSetting(res.subscriptionsSetting) || [];
        const merged = normalizeTemplateIds([...(prefAccepted || []), ...(ids || [])]);
        console.log("openSubscriptionSettingPicker got ids", ids.length, "merged", merged.length);
        const normalized = setGlobalSubscriptionIds(page, merged, enabled);
        const apiBase = page.getApiBase();
        const token = page.getAuthToken();
        const syncPromise =
          normalized.length && apiBase && token
            ? updateSubscriptions(normalized, { apiBase, token }).catch((err) => {
              console.warn("updateSubscriptions after openSetting failed", err);
            })
            : Promise.resolve();
        const finalize = (requiredIds = []) => {
          const shouldShow =
            requiredIds.length > 0 && (!enabled || !hasAllRequiredSubscriptions(normalized, requiredIds));
          console.log("openSubscriptionSettingPicker accepted ids", normalized.length, "mainSwitch", enabled, "show", shouldShow);
          setSubscriptionBannerVisibility(page, shouldShow);
          if (normalized.length === 0) {
            wx.showToast({ title: "请在设置中开启订阅消息", icon: "none" });
          }
          resolve(normalized);
        };
        Promise.allSettled([syncPromise, resolveRequiredSubscriptionTemplateIds(page)])
          .then((results) => {
            const requiredIds = results[1]?.status === "fulfilled" ? results[1].value : [];
            finalize(requiredIds);
          })
          .catch(() => finalize([]));
      },
      fail: (err) => {
        console.warn("openSubscriptionSettingPicker failed", err);
        wx.showToast({ title: "请在设置里开启订阅消息", icon: "none" });
        setSubscriptionBannerVisibility(page, true);
        resolve([]);
      }
    });
  });
}

function prefetchSubscriptionLatest(page) {
  const apiBase = page.getApiBase();
  const token = page.getAuthToken();
  if (!apiBase || !token) return;
  fetchLatestSubscriptionPush({ apiBase, token })
    .then((payload = {}) => {
      const latestVersion = normalizeVersion(payload.version || "");
      const app = typeof getApp === "function" ? getApp() : null;
      if (app && app.globalData) {
        app.globalData.subscriptionLatestVersion = latestVersion;
      }
      if (!latestVersion) return null;
      return fetchLatestItemVersion({
        apiBase,
        token,
        itemId: SUBSCRIPTION_TEMPLATE_ID,
        version: latestVersion
      }).then((result) => {
        const serverVersion = normalizeVersion(result.version || "");
        const hasUpdate = serverVersion !== latestVersion;
        updateSubscriptionBadge(page, hasUpdate);
        if (app && app.globalData) {
          app.globalData.subscriptionFeedHasUpdate = hasUpdate;
        }
        return { latestVersion, serverVersion, hasUpdate };
      });
    })
    .catch((err) => {
      console.warn("prefetchSubscriptionLatest failed", err);
    });
}

function updateSubscriptionBadge(page, show) {
  if (typeof show !== "boolean") return;
  const app = typeof getApp === "function" ? getApp() : null;
  if (app && app.globalData) {
    app.globalData.showProfileRedDot = show;
    app.globalData.subscriptionFeedHasUpdate = show;
  }
  page.setData({ showProfileRedDot: show });
}

module.exports = {
  initSubscriptionBanner,
  waitForSubscriptionSettingsReady,
  setGlobalSubscriptionIds,
  setGlobalRequiredSubscriptionIds,
  resolveRequiredSubscriptionTemplateIds,
  setSubscriptionBannerVisibility,
  getSubscriptionMainSwitch,
  evaluateSubscriptionBannerVisibility,
  ensureCheckinSubscriptionOnEntry,
  requestProfileSubscriptions,
  onSubscriptionBannerTap,
  openSubscriptionSettingPicker,
  prefetchSubscriptionLatest,
  updateSubscriptionBadge
};
