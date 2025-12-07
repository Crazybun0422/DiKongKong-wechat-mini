const { transformHtmlContent, extractImageUrls } = require("../../../utils/open-platform");
const { resolveApiBase } = require("../../../utils/profile");
const {
  fetchLatestSubscriptionPush,
  SUBSCRIPTION_TEMPLATE_ID
} = require("../../../utils/subscriptions");
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
    title: DEFAULT_TITLE,
    imageUrls: []
  },

  onLoad() {
    if (DEFAULT_TITLE && typeof wx.setNavigationBarTitle === "function") {
      wx.setNavigationBarTitle({ title: DEFAULT_TITLE });
    }
    this.loadContent();
  },

  onPullDownRefresh() {
    this.loadContent({ fromPullDown: true });
  },

  onRetryTap() {
    this.loadContent();
  },

  loadContent(options = {}) {
    const { fromPullDown = false } = options;
    if (!fromPullDown) {
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
      if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
      return;
    }

    fetchLatestSubscriptionPush({ apiBase, templateId: SUBSCRIPTION_TEMPLATE_ID })
      .then((payload = {}) => {
        const html =
          typeof payload.content === "string"
            ? payload.content
            : typeof payload.pushContent === "string"
              ? payload.pushContent
              : "";
        const transformed = transformHtmlContent(html, { apiBase });
        const images = extractImageUrls(html, { apiBase });
        const latestVersion = normalizeVersion(payload.version || "0");
        this.syncLatestVersion(latestVersion, { apiBase });
        this.setData({
          contentNodes: transformed,
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
        if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh();
        }
      });
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

    const tappedImage = getRichTextAttribute(event, ["opImage", "data-op-image", "src"]);
    if (tappedImage) {
      const urls = this.data.imageUrls || [];
      const current = String(tappedImage);
      if (typeof wx.previewImage === "function") {
        wx.previewImage({
          urls: urls.length ? urls : [current],
          current
        });
        return;
      }
      if (typeof wx.setClipboardData === "function") {
        wx.setClipboardData({ data: current });
      }
    }
  }
});
