const getSystemMetrics = () => {
  let info = {};
  if (typeof wx !== "undefined") {
    if (typeof wx.getWindowInfo === "function") {
      try {
        info = wx.getWindowInfo() || {};
      } catch (err) {
        info = {};
      }
    } else if (typeof wx.getSystemInfoSync === "function") {
      try {
        info = wx.getSystemInfoSync() || {};
      } catch (err) {
        info = {};
      }
    }
  }
  const statusBarHeight = Number(info.statusBarHeight) || 0;
  const navBarHeight = 44;
  return {
    statusBarHeight,
    navHeight: statusBarHeight + navBarHeight
  };
};

Page({
  data: {
    targetUrl: "",
    statusBarHeight: 0,
    navHeight: 44,
    navTitle: "低空星球"
  },

  onLoad(options) {
    const metrics = getSystemMetrics();
    this.setData({
      statusBarHeight: metrics.statusBarHeight,
      navHeight: metrics.navHeight
    });

    const raw = typeof options?.url === "string" ? options.url : "";
    const decoded = raw ? decodeURIComponent(raw) : "";
    if (decoded && /^https?:\/\//.test(decoded)) {
      const title = typeof options?.title === "string" ? options.title.trim() : "";
      this.setData({
        targetUrl: decoded,
        navTitle: title || "低空星球"
      });
      return;
    }
    wx.showToast({ title: "链接不可用", icon: "none" });
    setTimeout(() => {
      if (typeof wx !== "undefined" && wx.navigateBack) {
        wx.navigateBack({ delta: 1 });
      }
    }, 1200);
  },

  onBackTap() {
    if (typeof wx !== "undefined" && wx.navigateBack) {
      wx.navigateBack({ delta: 1 });
    }
  }
});