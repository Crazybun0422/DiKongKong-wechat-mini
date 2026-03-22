const {
  transformHtmlContent,
  extractImageUrls,
  buildContentSegments
} = require("../../../utils/open-platform");
const { fetchPlanetCreationAdvancedGuide } = require("../../../utils/merchant-operation");
const { resolveApiBase } = require("../../../utils/profile");

const DEFAULT_TITLE = "星球创作进阶攻略";
const DEFAULT_ERROR_NO_BASE = "未配置服务地址";
const DEFAULT_ERROR_LOAD = "加载失败";

function buildKeyVariants(key) {
  if (typeof key !== "string" || !key) {
    return [key];
  }
  const variants = new Set([key, key.toLowerCase(), key.toUpperCase()]);
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
    imageUrls: []
  },

  onLoad() {
    if (typeof wx.setNavigationBarTitle === "function") {
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
    this.setData({
      loading: !fromPullDown,
      error: fromPullDown ? this.data.error : "",
      ...(fromPullDown ? {} : { contentNodes: "", contentSegments: [], imageUrls: [] })
    });
    const apiBase = resolveApiBase();
    if (!apiBase) {
      this.setData({
        loading: false,
        error: DEFAULT_ERROR_NO_BASE,
        contentNodes: "",
        contentSegments: [],
        imageUrls: []
      });
      if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
      return;
    }
    fetchPlanetCreationAdvancedGuide({ apiBase })
      .then((payload = {}) => {
        const html = typeof payload.content === "string" ? payload.content : "";
        this.setData({
          loading: false,
          error: "",
          contentNodes: transformHtmlContent(html, { apiBase }),
          contentSegments: buildContentSegments(html, { apiBase }),
          imageUrls: extractImageUrls(html, { apiBase })
        });
      })
      .catch((err) => {
        this.setData({
          loading: false,
          error: err?.message || DEFAULT_ERROR_LOAD,
          contentNodes: "",
          contentSegments: [],
          imageUrls: []
        });
      })
      .finally(() => {
        if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh();
        }
      });
  },

  onRichTextTap(event) {
    const link = String(getRichTextAttribute(event, ["opLink", "data-op-link", "href"]) || "");
    if (link) {
      if (typeof wx.openUrl === "function" && /^https?:\/\//i.test(link)) {
        wx.openUrl({ url: link });
        return;
      }
      if (typeof wx.setClipboardData === "function") {
        wx.setClipboardData({
          data: link,
          success: () => wx.showToast({ title: "链接已复制", icon: "success" }),
          fail: () => wx.showToast({ title: "复制失败", icon: "none" })
        });
      }
      return;
    }
    const current = String(getRichTextAttribute(event, ["opImage", "data-op-image", "src"]) || "");
    if (!current || typeof wx.previewImage !== "function") return;
    const urls = this.data.imageUrls || [];
    wx.previewImage({
      urls: urls.length ? urls : [current],
      current,
      showmenu: true
    });
  },

  onImageTap(event) {
    const index = Number(event?.currentTarget?.dataset?.index);
    const urls = this.data.imageUrls || [];
    const current = Number.isInteger(index) && urls[index] ? urls[index] : urls[0] || "";
    if (!current || typeof wx.previewImage !== "function") return;
    wx.previewImage({
      urls: urls.length ? urls : [current],
      current,
      showmenu: true
    });
  }
});
