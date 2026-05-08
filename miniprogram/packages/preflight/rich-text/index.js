const {
  transformHtmlContent,
  extractImageUrls,
  buildContentSegments
} = require("../../../utils/open-platform");
const {
  fetchPreflightRichTextConfig,
  resolveConfigDefinition
} = require("../../../utils/preflight-config");
const { resolveApiBase } = require("../../../utils/profile");

const DEFAULT_ERROR_NO_BASE = "未配置服务地址";
const DEFAULT_ERROR_LOAD = "加载失败";
const DEFAULT_TITLE = "说明";
const TOAST_LINK_COPIED = "链接已复制";
const TOAST_COPY_FAIL = "复制失败";
const TOAST_CANNOT_OPEN = "无法打开链接";

function buildKeyVariants(key) {
  if (typeof key !== "string" || !key) return [key];
  const variants = new Set([key, key.toLowerCase(), key.toUpperCase()]);
  if (key.includes("-")) {
    variants.add(key.replace(/-([a-z])/gi, (_, letter) => letter.toUpperCase()));
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
    title: DEFAULT_TITLE,
    contentNodes: "",
    contentSegments: [],
    imageUrls: []
  },

  onLoad(options = {}) {
    this._richTextKey = `${options.key || ""}`.trim();
    const fallbackTitle = decodeURIComponent(options.title || "").trim();
    const definition = resolveConfigDefinition(this._richTextKey);
    const title = fallbackTitle || definition?.title || DEFAULT_TITLE;
    this.setData({ title });
    if (typeof wx.setNavigationBarTitle === "function") {
      wx.setNavigationBarTitle({ title });
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
      this.setData({ loading: false, error: DEFAULT_ERROR_NO_BASE, contentNodes: "", contentSegments: [], imageUrls: [] });
      if (fromPullDown && typeof wx.stopPullDownRefresh === "function") wx.stopPullDownRefresh();
      return;
    }
    fetchPreflightRichTextConfig(this._richTextKey, { apiBase })
      .then((payload = {}) => {
        const html = typeof payload.content === "string" ? payload.content : "";
        const title = payload.title || this.data.title || DEFAULT_TITLE;
        if (typeof wx.setNavigationBarTitle === "function") {
          wx.setNavigationBarTitle({ title });
        }
        this.setData({
          loading: false,
          error: "",
          title,
          contentNodes: transformHtmlContent(html, { apiBase }),
          contentSegments: buildContentSegments(html, { apiBase }),
          imageUrls: extractImageUrls(html, { apiBase })
        });
      })
      .catch((err = {}) => {
        this.setData({
          loading: false,
          error: err.message || DEFAULT_ERROR_LOAD,
          contentNodes: "",
          contentSegments: [],
          imageUrls: []
        });
      })
      .finally(() => {
        if (fromPullDown && typeof wx.stopPullDownRefresh === "function") wx.stopPullDownRefresh();
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
          success: () => wx.showToast({ title: TOAST_LINK_COPIED, icon: "success" }),
          fail: () => wx.showToast({ title: TOAST_COPY_FAIL, icon: "none" })
        });
        return;
      }
      wx.showToast({ title: TOAST_CANNOT_OPEN, icon: "none" });
    }
    const tappedImage = getRichTextAttribute(event, ["opImage", "data-op-image", "src"]);
    if (tappedImage && typeof wx.previewImage === "function") {
      const current = String(tappedImage);
      const urls = this.data.imageUrls || [];
      wx.previewImage({
        urls: urls.length ? urls : [current],
        current,
        showmenu: true
      });
    }
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
