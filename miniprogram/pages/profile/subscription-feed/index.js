const {
  transformHtmlContent,
  extractImageUrls,
  buildRichTextNodes,
  buildContentSegments
} = require("../../../utils/open-platform");
const { resolveApiBase } = require("../../../utils/profile");
const {
  fetchTemplateSettings,
  fetchLatestSubscriptionPush,
  SUBSCRIPTION_TEMPLATE_ID,
  fetchSubscriptions,
  updateSubscriptions,
  normalizeTemplateIds,
  extractAcceptedTemplateIdsFromWxSetting
} = require("../../../utils/subscriptions");
const { REQUIRED_SUBSCRIPTION_TEMPLATE_IDS } = require("../../../config/subscription-templates");
const {
  updateLatestItemVersion,
  fetchLatestItemVersion,
  normalizeVersion
} = require("../../../utils/latest-items");

const DEFAULT_TITLE = "运营动态";
const DEFAULT_ERROR_NO_BASE = "未配置服务地址";
const DEFAULT_ERROR_LOAD = "加载失败";
const TOAST_LINK_COPIED = "链接已复制";
const TOAST_COPY_FAIL = "复制失败";
const TOAST_CANNOT_OPEN = "无法打开链接";

const hasAllRequiredSubscriptions = (ids = [], requiredIds = REQUIRED_SUBSCRIPTION_TEMPLATE_IDS) => {
  const normalized = normalizeTemplateIds(ids);
  const normalizedRequired = normalizeTemplateIds(requiredIds);
  if (!normalizedRequired.length) return true;
  return normalizedRequired.every((id) => normalized.includes(id));
};

function buildKeyVariants(key) {
  if (typeof key !== "string" || !key) {
    return [key];
  }
  const variants = new Set();
  variants.add(key);
  variants.add(key.toLowerCase());
  variants.add(key.toUpperCase());
  if (key.includes("-")) {
    variants.add(key.replace(/-([a-z])/gi, (_, letter) => letter.toUpperCase()));
    variants.add(key.replace(/-([a-z])/gi, (_, letter) => letter));
  } else if (/[A-Z]/.test(key)) {
    variants.add(key.replace(/([A-Z])/g, (_, letter) => `-${letter.toLowerCase()}`));
  }
  return Array.from(variants).filter(Boolean);
}

function getRichTextAttribute(event, keys = []) {
  const sources = [
    event?.target?.dataset,
    event?.detail?.target?.dataset,
    event?.detail?.dataset,
    event?.detail?.node?.dataset,
    event?.detail?.node?.attrs,
    event?.mark,
    event?.currentTarget?.dataset
  ];
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const variants = buildKeyVariants(key);
      for (const variant of variants) {
        if (variant && Object.prototype.hasOwnProperty.call(source, variant)) {
          return source[variant];
        }
      }
    }
  }
  return "";
}

Page({
  data: {
    loading: true,
    error: "",
    contentNodes: "",
    contentSegments: [],
    title: DEFAULT_TITLE,
    imageUrls: [],
    showSubscriptionBanner: false,
    subscriptionBannerLoading: false,
    refresherTriggered: false,
    adFloatingVisible: true,
    adFloatingClosed: false
  },

  onLoad() {
    if (DEFAULT_TITLE && typeof wx.setNavigationBarTitle === "function") {
      wx.setNavigationBarTitle({ title: DEFAULT_TITLE });
    }
    this.setData({
      adFloatingVisible: true,
      adFloatingClosed: false
    });
    this.loadContent();
    this.evaluateSubscriptionBannerVisibility().catch(() => { });
  },

  onShow() {
    this.evaluateSubscriptionBannerVisibility().catch(() => { });
  },

  onPullDownRefresh() {
    this.loadContent({ fromPullDown: true });
  },

  onRefresherRefresh() {
    this.setData({ refresherTriggered: true });
    this.loadContent({ fromRefresher: true });
  },

  onRetryTap() {
    this.loadContent();
  },

  loadContent(options = {}) {
    const { fromPullDown = false, fromRefresher = false } = options;
    const isBackgroundRefresh = fromPullDown || fromRefresher;
    if (!isBackgroundRefresh) {
      this.setData({ loading: true, error: "" });
    } else {
      this.setData({ error: "" });
    }

    const apiBase = resolveApiBase();
    if (!apiBase) {
      this.setData({
        loading: false,
        error: DEFAULT_ERROR_NO_BASE,
        contentNodes: "",
        imageUrls: []
      });
      this.finishRefresh({ fromPullDown, fromRefresher });
      return;
    }

    fetchLatestSubscriptionPush({ apiBase })
      .then((payload = {}) => {
        const html = typeof payload.pushContent === "string"
          ? payload.pushContent
          : typeof payload.content === "string"
            ? payload.content
            : "";
        const transformed = transformHtmlContent(html, { apiBase });
        const nodes = buildRichTextNodes(html, { apiBase });
        const segments = buildContentSegments(html, { apiBase });
        const images = extractImageUrls(html, { apiBase });
        const latestVersion = normalizeVersion(payload.version || "0");
        this.syncLatestVersion(latestVersion, { apiBase });
        this.setData({
          contentNodes: nodes.length ? nodes : transformed,
          contentSegments: segments,
          loading: false,
          error: "",
          imageUrls: images
        });
      })
      .catch((err = {}) => {
        const message = err.message || DEFAULT_ERROR_LOAD;
        this.setData({
          error: message,
          loading: false,
          contentNodes: "",
          imageUrls: []
        });
      })
      .finally(() => {
        this.finishRefresh({ fromPullDown, fromRefresher });
      });
  },

  finishRefresh(options = {}) {
    const { fromPullDown = false, fromRefresher = false } = options;
    if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
      wx.stopPullDownRefresh();
    }
    if (fromRefresher) {
      this.setData({ refresherTriggered: false });
    }
  },

  syncLatestVersion(version, options = {}) {
    const apiBase = resolveApiBase(options.apiBase);
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) {
      app.globalData.subscriptionLatestVersion = version;
    }
    if (!version) return;
    updateLatestItemVersion({
      apiBase,
      itemId: SUBSCRIPTION_TEMPLATE_ID,
      version
    })
      .then(() => fetchLatestItemVersion({
        apiBase,
        itemId: SUBSCRIPTION_TEMPLATE_ID,
        version
      }))
      .then((result) => {
        const serverVersion = normalizeVersion(result.version);
        const hasUpdate = serverVersion !== "" && serverVersion !== version ? true : false;
        if (app && app.globalData) {
          app.globalData.subscriptionFeedHasUpdate = hasUpdate;
          app.globalData.showProfileRedDot = hasUpdate;
        }
        const pages = getCurrentPages();
        if (pages && pages.length) {
          const lastPage = pages[pages.length - 1];
          if (typeof lastPage.setData === "function") {
            lastPage.setData({ showSubscriptionRedDot: hasUpdate });
          }
        }
      })
      .catch((err) => {
        console.warn("syncLatestVersion failed", err);
      });
  },

  onRichTextTap(event) {
    const link = getRichTextAttribute(event, ["opLink", "data-op-link", "href"]);
    if (link) {
      const url = String(link);
      const canOpen = typeof wx.openUrl === "function" && /^https?:\/\//i.test(url);
      if (canOpen) {
        wx.openUrl({ url });
        return;
      }
      if (typeof wx.setClipboardData === "function") {
        wx.setClipboardData({
          data: url,
          success: () => {
            wx.showToast({ title: TOAST_LINK_COPIED, icon: "success" });
          },
          fail: () => {
            wx.showToast({ title: TOAST_COPY_FAIL, icon: "none" });
          }
        });
      } else {
        wx.showToast({ title: TOAST_CANNOT_OPEN, icon: "none" });
      }
    }

    const tappedImage =
      getRichTextAttribute(event, ["opImage", "data-op-image", "src"]) ||
      event?.detail?.src ||
      event?.target?.dataset?.src ||
      event?.target?.src ||
      event?.detail?.target?.src ||
      event?.detail?.node?.attrs?.src ||
      "";
    console.log("onRichTextTap tappedImage:", tappedImage);
    if (tappedImage) {
      const urls = this.data.imageUrls || [];
      const current = String(tappedImage);
      if (typeof wx.previewImage === "function") {
        wx.previewImage({
          urls: urls.length ? urls : [current],
          current,
          showmenu: true
        });
        return;
      }
      if (typeof wx.setClipboardData === "function") {
        wx.setClipboardData({ data: current });
      }
    }
  },

  onImageTap(event) {
    const index = Number(event?.currentTarget?.dataset?.index);
    const urls = this.data.imageUrls || [];
    const current = Number.isInteger(index) && urls[index] ? urls[index] : urls[0] || "";
    if (!current) return;
    if (typeof wx.previewImage === "function") {
      wx.previewImage({
        urls: urls.length ? urls : [current],
        current,
        showmenu: true
      });
      return;
    }
    if (typeof wx.setClipboardData === "function") {
      wx.setClipboardData({ data: current });
    }
  },

  onImageLongPress(event) {
    this.onImageTap(event);
  },

  adLoad() {
    console.log("原生模板广告加载成功");
    if (this.data.adFloatingClosed) return;
    this.setData({ adFloatingVisible: true });
  },

  adError(err) {
    console.error("原生模板广告加载失败", err);
    this.setData({ adFloatingVisible: false });
  },

  adClose() {
    console.log("原生模板广告关闭");
    this.setData({
      adFloatingVisible: false,
      adFloatingClosed: true
    });
  },

  getApiBase() {
    return resolveApiBase();
  },

  getAuthToken() {
    const app = typeof getApp === "function" ? getApp() : null;
    return (app && app.globalData && app.globalData.token) || "";
  },

  waitForSubscriptionSettingsReady() {
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
  },

  setGlobalSubscriptionIds(list = [], mainSwitch = true) {
    const app = typeof getApp === "function" ? getApp() : null;
    const normalized = normalizeTemplateIds(list);
    if (app && app.globalData) {
      app.globalData.subscriptionAcceptedTemplateIds = normalized;
      app.globalData.subscriptionSettingsReady = true;
      app.globalData.subscriptionMainSwitch = mainSwitch !== false;
    }
    return normalized;
  },

  setGlobalRequiredSubscriptionIds(list = []) {
    const app = typeof getApp === "function" ? getApp() : null;
    const normalized = normalizeTemplateIds(list);
    if (app && app.globalData) {
      app.globalData.subscriptionRequiredTemplateIds = normalized;
    }
    return normalized;
  },

  resolveRequiredSubscriptionTemplateIds() {
    const configured = normalizeTemplateIds(REQUIRED_SUBSCRIPTION_TEMPLATE_IDS);
    const app = typeof getApp === "function" ? getApp() : null;
    const cached = normalizeTemplateIds(app?.globalData?.subscriptionRequiredTemplateIds || []);
    const apiBase = this.getApiBase();
    const token = this.getAuthToken();
    if (!apiBase || !token) {
      return Promise.resolve(cached);
    }
    return fetchTemplateSettings({ apiBase, token })
      .then(({ templateIds = [] }) => {
        const available = normalizeTemplateIds(templateIds);
        const required = configured.filter((id) => available.includes(id));
        return this.setGlobalRequiredSubscriptionIds(required);
      })
      .catch((err) => {
        console.warn("resolveRequiredSubscriptionTemplateIds failed", err);
        return cached;
      });
  },

  setSubscriptionBannerVisibility(show) {
    const visible = !!show;
    this.setData({ showSubscriptionBanner: visible });
  },

  evaluateSubscriptionBannerVisibility() {
    return Promise.all([
      this.waitForSubscriptionSettingsReady(),
      this.resolveRequiredSubscriptionTemplateIds()
    ])
      .then(([payload = {}, requiredIds = []]) => {
        const clientIds = Array.isArray(payload.ids) ? payload.ids : [];
        const mainSwitch = payload.mainSwitch !== false;
        const normalizedClient = this.setGlobalSubscriptionIds(clientIds, mainSwitch);
        if (!requiredIds.length) {
          this.setSubscriptionBannerVisibility(false);
          return normalizedClient;
        }
        if (!mainSwitch) {
          this.setSubscriptionBannerVisibility(true);
          return normalizedClient;
        }
        const apiBase = this.getApiBase();
        const token = this.getAuthToken();
        if (!apiBase || !token) {
          this.setSubscriptionBannerVisibility(!hasAllRequiredSubscriptions(normalizedClient, requiredIds));
          return normalizedClient;
        }
        return fetchSubscriptions({ apiBase, token })
          .then((serverIds) => {
            const normalized = this.setGlobalSubscriptionIds(serverIds, mainSwitch);
            this.setSubscriptionBannerVisibility(!hasAllRequiredSubscriptions(normalized, requiredIds));
            return normalized;
          })
          .catch((err) => {
            console.warn("evaluateSubscriptionBannerVisibility failed", err);
            this.setSubscriptionBannerVisibility(!hasAllRequiredSubscriptions(normalizedClient, requiredIds));
            return normalizedClient;
          });
      })
      .catch((err) => {
        console.warn("evaluateSubscriptionBannerVisibility outer failed", err);
        this.setSubscriptionBannerVisibility(false);
        return [];
      });
  },

  onSubscriptionBannerTap() {
    if (this.data.subscriptionBannerLoading) return;
    this.setData({ subscriptionBannerLoading: true });
    this.openSubscriptionSettingPicker()
      .catch((err) => {
        console.warn("openSubscriptionSettingPicker in subscription-feed failed", err);
      })
      .finally(() => {
        this.setData({ subscriptionBannerLoading: false });
      });
  },

  openSubscriptionSettingPicker(options = {}) {
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
            this.setGlobalSubscriptionIds([], enabled);
            this.setSubscriptionBannerVisibility(true);
            wx.showToast({ title: "请先开启订阅消息总开关", icon: "none" });
            resolve([]);
            return;
          }
          const ids = extractAcceptedTemplateIdsFromWxSetting(res.subscriptionsSetting) || [];
          const merged = normalizeTemplateIds([...(prefAccepted || []), ...(ids || [])]);
          const normalized = this.setGlobalSubscriptionIds(merged, enabled);
          const apiBase = this.getApiBase();
          const token = this.getAuthToken();
          const syncPromise =
            normalized.length && apiBase && token
              ? updateSubscriptions(normalized, { apiBase, token }).catch((err) => {
                console.warn("updateSubscriptions after openSetting failed", err);
              })
              : Promise.resolve();
          const finalize = (requiredIds = []) => {
            const shouldShow = requiredIds.length > 0 && (!enabled || !hasAllRequiredSubscriptions(normalized, requiredIds));
            this.setSubscriptionBannerVisibility(shouldShow);
            if (normalized.length === 0) {
              wx.showToast({ title: "请在设置中开启订阅消息", icon: "none" });
            }
            resolve(normalized);
            this.evaluateSubscriptionBannerVisibility().catch(() => { });
          };
          Promise.allSettled([syncPromise, this.resolveRequiredSubscriptionTemplateIds()])
            .then((results) => {
              const requiredIds = results[1]?.status === "fulfilled" ? results[1].value : [];
              finalize(requiredIds);
            })
            .catch(() => finalize([]));
        },
        fail: (err) => {
          console.warn("openSubscriptionSettingPicker failed", err);
          wx.showToast({ title: "请在设置里开启订阅消息", icon: "none" });
          this.setSubscriptionBannerVisibility(true);
          resolve([]);
        }
      });
    });
  }
});
