Page({
  onBackTap() {
    if (typeof wx.navigateBack === "function") {
      wx.navigateBack();
      return;
    }
    wx.redirectTo({ url: "/pages/profile/profile" });
  }
});
