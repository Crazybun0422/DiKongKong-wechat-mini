function onNewbieGiftTap(page) {
  const popup = page.selectComponent("#newbie-task-popup");
  if (popup && typeof popup.openFromEntry === "function") {
    popup.openFromEntry();
  }
}

function onChatButtonTap(page) {
  page.showPlaceholderToast("您暂未获得低空智能体（Agent）体验特权");
}

function onMarkerButtonTap(page) {
  if (page.hasAccessToken()) {
    page.openMarkersPage();
    return;
  }
  page.ensureProfileAuthenticated()
    .then(() => {
      page.openMarkersPage();
    })
    .catch((err) => {
      if (err && err.message === "user-cancel") {
        wx.showToast({ title: "已取消", icon: "none" });
        return;
      }
      if (err && err.message === "login-unavailable") {
        page.showPlaceholderToast("暂时无法打开标记页");
        return;
      }
      console.warn("登录失败", err);
      if (typeof wx.showToast === "function") {
        wx.showToast({ title: "登录失败，请稍后再试", icon: "none" });
      }
    });
}

function onLocateTap(page) {
  page.resetCompassState();
  page.ensureLocationPermission()
    .then(() =>
      page.pullAndCenterLocation({
        scaleMeters: 500,
        scale: 14,
        resetView: true
      })
    )
    .catch(() => {
      page.applyCachedMapLocationFallback({
        allowDefault: true,
        scale: 14
      });
      wx.showToast({ title: "定位失败，请在设置中开启定位权限", icon: "none" });
    });
}

module.exports = {
  onNewbieGiftTap,
  onChatButtonTap,
  onMarkerButtonTap,
  onLocateTap
};
