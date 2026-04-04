function onMenuHomeTap(page) {
  const updates = {};
  if (page.data.activeTab !== "home") {
    updates.activeTab = "home";
  }
  const nextDashboardVisible = !!page.data.airBoardEnabled;
  if (page.data.showDashboardPanel !== nextDashboardVisible) {
    updates.showDashboardPanel = nextDashboardVisible;
  }
  if (Object.keys(updates).length) {
    page.setData(updates);
  }
}

function onMenuProfileTap(page) {
  if (page.data.activeTab !== "profile") {
    page.setData({ activeTab: "profile" });
  }
  const app = typeof getApp === "function" ? getApp() : null;
  if (app && app.globalData && app.globalData.inviteGuide?.active) {
    app.globalData.inviteGuide = { active: true, step: "profile" };
    if (page.data.showInviteGuideMap) {
      page.setData({ showInviteGuideMap: false });
    }
  }
  const loadingShown = typeof wx !== "undefined" && typeof wx.showLoading === "function";
  const hideLoading = typeof wx !== "undefined" && typeof wx.hideLoading === "function"
    ? () => wx.hideLoading()
    : () => {};
  if (loadingShown) {
    wx.showLoading({ title: "加载中...", mask: true });
  }
  page.ensureProfileAuthenticated()
    .then(() => {
      page.requestProfileSubscriptions().catch((err) => {
        console.warn("订阅模板流程失败", err);
      });
      if (typeof wx.navigateTo === "function") {
        wx.navigateTo({
          url: "/pages/profile/profile",
          success: () => hideLoading(),
          fail: (err) => {
            hideLoading();
            console.warn("navigate to profile failed", err);
          }
        });
      } else {
        hideLoading();
      }
    })
    .catch((err) => {
      hideLoading();
      page.setData({ activeTab: "home" });
      if (err && err.message === "user-cancel") {
        return;
      }
      if (err && err.message === "login-unavailable") {
        page.showPlaceholderToast("暂时无法打开我的页面");
      }
    });
}

module.exports = {
  onMenuHomeTap,
  onMenuProfileTap
};
