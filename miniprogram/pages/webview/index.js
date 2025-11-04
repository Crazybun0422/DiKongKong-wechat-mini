Page({
  data: {
    targetUrl: ""
  },

  onLoad(options) {
    const raw = typeof options?.url === "string" ? options.url : "";
    const decoded = raw ? decodeURIComponent(raw) : "";
    if (decoded && /^https?:\/\/mp\.weixin\.qq\.com\//.test(decoded)) {
      this.setData({ targetUrl: decoded });
      wx.setNavigationBarTitle({ title: "临时禁飞详情" });
    } else {
      wx.showToast({ title: "链接不可用", icon: "none" });
      setTimeout(() => {
        if (typeof wx !== "undefined" && wx.navigateBack) {
          wx.navigateBack({ delta: 1 });
        }
      }, 1500);
    }
  }
});
