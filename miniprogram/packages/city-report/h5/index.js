Page({
  data: {
    targetUrl: ""
  },

  onLoad(options) {
    const raw = typeof options?.url === "string" ? options.url : "";
    const decoded = raw ? decodeURIComponent(raw) : "";
    if (decoded && /^https?:\/\//.test(decoded)) {
      this.setData({ targetUrl: decoded });
      const title = typeof options?.title === "string" ? options.title.trim() : "";
      if (title) {
        wx.setNavigationBarTitle({ title });
      }
      return;
    }
    wx.showToast({ title: "链接不可用", icon: "none" });
    setTimeout(() => {
      if (typeof wx !== "undefined" && wx.navigateBack) {
        wx.navigateBack({ delta: 1 });
      }
    }, 1200);
  }
});