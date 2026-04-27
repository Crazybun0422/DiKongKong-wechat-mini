const { applyMapStatusBarStyle } = require("./map-shared");

function onShow(page) {
  applyMapStatusBarStyle();
  page.startMyLocationDirectionTracking();
  page.refreshResponsiveLayout({ force: true });
  page.updateMapCheckinEntryStyle();
  page.updateSubscriptionBannerLayout();
  page.scheduleMapCheckinEntryStyleRefresh();
  page.loadCheckinStatus();
  if (page.data.activeTab !== "home") {
    page.setData({
      activeTab: "home",
      showDashboardPanel: !!page.data.airBoardEnabled
    });
  }
  const app = typeof getApp === "function" ? getApp() : null;
  if (app && app.globalData && typeof app.globalData.subscriptionFeedHasUpdate === "boolean") {
    page.setData({ showProfileRedDot: app.globalData.subscriptionFeedHasUpdate });
  }
  page.setData({ showSubscriptionBanner: false });
  if (page.data.joinInvitePrompt && !page.data.joinInviting) {
    page.promptJoinWorkGroup(page.data.joinInvitePrompt);
  }
  page.resumeCenterPinLocationFollow();
  page.hydrateWeatherFromCache({ center: page._centerOverride || page.data.center });
  page.scheduleFetchWeather(0, { center: page._centerOverride || page.data.center });
  page.scheduleFetchElevation(2000, { center: page._centerOverride || page.data.center });
  if (page._skipPendingFocusOnShow) {
    page._skipPendingFocusOnShow = false;
  } else {
    page.consumePendingMarkerFocus({ source: "show" });
    page.consumePendingPinPreview();
  }
  page.updatePreflightOverlayTop(page.data.showSubscriptionBanner);
  if (app && app.globalData && app.globalData.checkinGuide?.active && app.globalData.checkinGuide.step === "map") {
    page.showCheckinGuideOnMap();
  } else if (page.data.showCheckinGuideMap) {
    page.setData({ showCheckinGuideMap: false });
  }
  if (app && app.globalData && app.globalData.inviteGuide?.active && app.globalData.inviteGuide.step === "map") {
    page.showInviteGuideOnMap();
  } else if (page.data.showInviteGuideMap) {
    page.setData({ showInviteGuideMap: false });
  }
  if (page.getAuthToken()) {
    page.loadMapGuideConfigs().catch((err) => {
      console.warn("loadMapGuideConfigs onShow failed", err);
    });
  }
  page.scheduleAddMiniAppPopupCheck("show");
}

function onReady(page) {
  page.updateMapCheckinEntryStyle();
  page.updateSubscriptionBannerLayout();
  page.scheduleMapCheckinEntryStyleRefresh();
  if (page.isMapCenterReady()) {
    page.ensureUomPluginReady();
    page.ensureDjiLayerReady();
    page.ensureTemporaryNoFlyLayerReady();
    page.ensureTiandituSatelliteLayerReady();
  }
}

function onResize(page, event = {}) {
  page.refreshResponsiveLayout({ event, force: true });
  page.updateMapCheckinEntryStyle();
  page.updateSubscriptionBannerLayout();
}

module.exports = {
  onShow,
  onReady,
  onResize
};
