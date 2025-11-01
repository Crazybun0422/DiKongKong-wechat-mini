const { buildFileDownloadUrl, fetchOpenPlatformContent } = require("../../../utils/markers");
const { resolveApiBase } = require("../../../utils/profile");

Page({
  data: {
    loading: true,
    error: "",
    htmlSegments: [],
    previewImages: []
  },

  onLoad() {
    this.apiBase = resolveApiBase();
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
    if (!this.apiBase) {
      this.setData({
        loading: false,
        error: "未配置接口地址，无法获取开放平台内容",
        htmlSegments: [],
        previewImages: []
      });
      if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
      return;
    }
    fetchOpenPlatformContent({ apiBase: this.apiBase })
      .then((data = {}) => {
        const rawContent = typeof data.content === "string" ? data.content : "";
        const segments = this.buildSegments(rawContent);
        const previewImages = segments
          .filter((item) => item.type === "image")
          .map((item) => item.src)
          .filter(Boolean);
        const uniquePreviewImages = Array.from(new Set(previewImages));
        const hasRenderableSegment = segments.some((item) => {
          if (item.type === "image") return Boolean(item.src);
          return Boolean(item.nodes && item.nodes.trim());
        });
        const finalSegments = hasRenderableSegment
          ? segments
          : [{ type: "html", nodes: "<p>暂无内容</p>" }];
        this.setData({
          htmlSegments: finalSegments,
          previewImages: uniquePreviewImages,
          loading: false,
          error: ""
        });
      })
      .catch((err) => {
        const message =
          err?.message === "missing-token"
            ? "请先登录后再查看开放平台内容"
            : err?.message || "内容加载失败，请稍后再试";
        this.setData({
          error: message,
          loading: false,
          htmlSegments: [],
          previewImages: []
        });
      })
      .finally(() => {
        if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh();
        }
      });
  },

  buildSegments(content = "") {
    if (!content || typeof content !== "string") return [];
    const segments = [];
    const imgRegex = /<img[\s\S]*?>/gi;
    let lastIndex = 0;
    let match;

    while ((match = imgRegex.exec(content))) {
      const before = content.slice(lastIndex, match.index);
      this.appendHtmlSegment(segments, before);
      const imgTag = match[0];
      const srcMatch =
        imgTag.match(/src\s*=\s*["']([^"']+)["']/i) ||
        imgTag.match(/data-src\s*=\s*["']([^"']+)["']/i);
      if (srcMatch && srcMatch[1]) {
        const fullUrl = this.ensureDownloadUrl(srcMatch[1]);
        if (fullUrl) {
          const altMatch = imgTag.match(/alt\s*=\s*["']([^"']*)["']/i);
          segments.push({
            type: "image",
            src: fullUrl,
            alt: altMatch ? altMatch[1] : ""
          });
        }
      }
      lastIndex = imgRegex.lastIndex;
    }

    const rest = content.slice(lastIndex);
    this.appendHtmlSegment(segments, rest);

    return segments;
  },

  appendHtmlSegment(list, html = "") {
    if (!html || typeof html !== "string") return;
    const cleaned = html.replace(/^\s+|\s+$/g, "");
    if (!cleaned) return;
    if (list.length && list[list.length - 1].type === "html") {
      list[list.length - 1].nodes += cleaned;
    } else {
      list.push({ type: "html", nodes: cleaned });
    }
  },

  ensureDownloadUrl(value = "") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^data:/i.test(trimmed)) return trimmed;
    const apiBase = this.apiBase;
    return buildFileDownloadUrl(trimmed, { apiBase });
  },

  onPreviewImage(e) {
    const current = e.currentTarget?.dataset?.src;
    if (!current) return;
    const urls = this.data.previewImages || [];
    if (!urls.length) return;
    if (typeof wx.previewImage === "function") {
      wx.previewImage({
        current,
        urls
      });
    }
  }
});
