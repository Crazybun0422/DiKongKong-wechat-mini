<<<<<<< HEAD
const { buildFileDownloadUrl, fetchOpenPlatformContent } = require("../../../utils/markers");
const { resolveApiBase } = require("../../../utils/profile");

=======
const {
  fetchOpenPlatformCopy,
  transformHtmlContent,
  extractImageUrls
} = require("../../../utils/open-platform");
const { resolveApiBase } = require("../../../utils/profile");

function formatUpdatedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (date.toString() === "Invalid Date") {
    return `${value}`;
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

>>>>>>> 24d4fd0424fb7107b18aa3f89fa13cf66d4dc455
Page({
  data: {
    loading: true,
    error: "",
<<<<<<< HEAD
    htmlSegments: [],
    previewImages: []
  },

  onLoad() {
    this.apiBase = resolveApiBase();
=======
    contentNodes: "",
    updatedAt: "",
    title: "开放平台",
    imageUrls: []
  },

  onLoad() {
>>>>>>> 24d4fd0424fb7107b18aa3f89fa13cf66d4dc455
    this.loadContent();
  },

  onPullDownRefresh() {
    this.loadContent({ fromPullDown: true });
  },

<<<<<<< HEAD
  onRetryTap() {
    this.loadContent();
  },

=======
>>>>>>> 24d4fd0424fb7107b18aa3f89fa13cf66d4dc455
  loadContent(options = {}) {
    const { fromPullDown = false } = options;
    if (!fromPullDown) {
      this.setData({ loading: true, error: "" });
    } else {
      this.setData({ error: "" });
    }
<<<<<<< HEAD
    if (!this.apiBase) {
      this.setData({
        loading: false,
        error: "未配置接口地址，无法获取开放平台内容",
        htmlSegments: [],
        previewImages: []
=======
    const apiBase = resolveApiBase();
    if (!apiBase) {
      this.setData({
        loading: false,
        error: "未配置服务地址",
        contentNodes: "",
        imageUrls: []
>>>>>>> 24d4fd0424fb7107b18aa3f89fa13cf66d4dc455
      });
      if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
      return;
    }
<<<<<<< HEAD
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
=======
    fetchOpenPlatformCopy({ apiBase })
      .then((payload) => {
        const html = typeof payload?.content === "string" ? payload.content : "";
        const transformed = transformHtmlContent(html, { apiBase });
        const rawTitle = typeof payload?.title === "string" ? payload.title.trim() : "";
        const title = rawTitle || this.data.title || "开放平台";
        if (title && title !== this.data.title && typeof wx.setNavigationBarTitle === "function") {
          wx.setNavigationBarTitle({ title });
        }
        const images = extractImageUrls(html, { apiBase });
        this.setData({
          contentNodes: transformed,
          loading: false,
          error: "",
          updatedAt: formatUpdatedAt(payload?.updatedAt),
          title,
          imageUrls: images
        });
      })
      .catch((err) => {
        const message = err?.message || "加载失败";
        this.setData({ error: message, loading: false });
>>>>>>> 24d4fd0424fb7107b18aa3f89fa13cf66d4dc455
      })
      .finally(() => {
        if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh();
        }
      });
  },

<<<<<<< HEAD
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
=======
  onRetryTap() {
    this.loadContent();
  },

  onRichTextTap(event) {
    const dataset = event?.target?.dataset || {};
    const link = dataset.opLink || dataset.oplink;
    if (link) {
      const url = `${link}`;
      const canOpen = typeof wx.openUrl === "function" && /^https?:\/\//i.test(url);
      if (canOpen) {
        wx.openUrl({ url });
        return;
      }
      if (typeof wx.setClipboardData === "function") {
        wx.setClipboardData({
          data: url,
          success: () => {
            wx.showToast({ title: "链接已复制", icon: "success" });
          },
          fail: () => {
            wx.showToast({ title: "复制失败", icon: "none" });
          }
        });
      } else {
        wx.showToast({ title: "无法打开链接", icon: "none" });
      }
    }
    const tappedImage = dataset.opImage || dataset.opimage;
    if (tappedImage) {
      const urls = this.data.imageUrls || [];
      const current = `${tappedImage}`;
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
>>>>>>> 24d4fd0424fb7107b18aa3f89fa13cf66d4dc455
    }
  }
});
