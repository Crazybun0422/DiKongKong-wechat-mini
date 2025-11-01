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

Page({
  data: {
    loading: true,
    error: "",
    contentNodes: "",
    updatedAt: "",
    title: "开放平台",
    imageUrls: []
  },

  onLoad() {
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
        error: "未配置服务地址",
        contentNodes: "",
        imageUrls: []
      });
      if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
      return;
    }

    fetchOpenPlatformCopy({ apiBase })
      .then((payload = {}) => {
        const html = typeof payload.content === "string" ? payload.content : "";
        const transformed = transformHtmlContent(html, { apiBase });
        const rawTitle = typeof payload.title === "string" ? payload.title.trim() : "";
        const title = rawTitle || this.data.title || "开放平台";
        if (title && title !== this.data.title && typeof wx.setNavigationBarTitle === "function") {
          wx.setNavigationBarTitle({ title });
        }
        const images = extractImageUrls(html, { apiBase });
        this.setData({
          contentNodes: transformed,
          loading: false,
          error: "",
          updatedAt: formatUpdatedAt(payload.updatedAt),
          title,
          imageUrls: images
        });
      })
      .catch((err = {}) => {
        const message = err.message || "加载失败";
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
    }
  }
});
