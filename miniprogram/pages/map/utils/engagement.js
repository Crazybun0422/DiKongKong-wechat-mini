const { fetchCheckinDetail } = require("../../../utils/checkin");
const { updateMapLayerSettings } = require("../../../utils/map-layer-settings");

const DEFAULT_MAP_CHECKIN_ENTRY_STYLE =
  "top: calc(env(safe-area-inset-top) + 96rpx); right: 24rpx; width: 150rpx; height: 50rpx;";
const ADD_MINI_APP_SUPPRESS_SECONDS = 72 * 60 * 60;
const ADD_MINI_APP_CHECK_DELAY_MS = 2000;

const getWindowMetrics = () => {
  let windowInfo = {};
  let deviceInfo = {};
  if (typeof wx !== "undefined") {
    if (typeof wx.getWindowInfo === "function") {
      try {
        windowInfo = wx.getWindowInfo() || {};
      } catch (err) {
        windowInfo = {};
      }
    }
    if (typeof wx.getDeviceInfo === "function") {
      try {
        deviceInfo = wx.getDeviceInfo() || {};
      } catch (err) {
        deviceInfo = {};
      }
    }
  }
  const windowWidth = Number(windowInfo.windowWidth) || 375;
  const windowHeight = Number(windowInfo.windowHeight) || 667;
  const screenWidth = Number(windowInfo.screenWidth || deviceInfo.screenWidth) || windowWidth;
  const screenHeight = Number(windowInfo.screenHeight || deviceInfo.screenHeight) || windowHeight;
  return {
    windowWidth,
    windowHeight,
    screenWidth,
    screenHeight
  };
};

function onCheckinGuideStart(page) {
  const app = typeof getApp === "function" ? getApp() : null;
  if (app && app.globalData) {
    app.globalData.checkinGuide = { active: true, step: "map" };
  }
  page.showCheckinGuideOnMap();
}

function onInviteGuideStart(page) {
  const app = typeof getApp === "function" ? getApp() : null;
  if (app && app.globalData) {
    app.globalData.inviteGuide = { active: true, step: "map" };
  }
  page.showInviteGuideOnMap();
}

function onGuideMaskTap(page) {
  const app = typeof getApp === "function" ? getApp() : null;
  if (app && app.globalData) {
    if (app.globalData.checkinGuide?.active) {
      app.globalData.checkinGuide = { active: false, step: "" };
    }
    if (app.globalData.inviteGuide?.active) {
      app.globalData.inviteGuide = { active: false, step: "" };
    }
  }
  if (page.data.showCheckinGuideMap || page.data.showInviteGuideMap) {
    page.setData({
      showCheckinGuideMap: false,
      showInviteGuideMap: false,
      checkinGuideOverlayStyle: "",
      inviteGuideOverlayStyle: ""
    });
  }
}

function showCheckinGuideOnMap(page) {
  if (page.data.showCheckinGuideMap) return;
  measureCheckinGuideTarget(page)
    .then((mask) => {
      if (!mask) return;
      const overlayStyle = buildGuideOverlayStyle(mask);
      page.setData({ showCheckinGuideMap: true, checkinGuideMask: mask, checkinGuideOverlayStyle: overlayStyle });
    })
    .catch((err) => {
      console.warn("measure checkin guide target failed", err);
    });
}

function showInviteGuideOnMap(page) {
  if (page.data.showInviteGuideMap) return;
  measureInviteGuideTarget(page)
    .then((mask) => {
      if (!mask) return;
      const overlayStyle = buildGuideOverlayStyle(mask);
      page.setData({ showInviteGuideMap: true, inviteGuideMask: mask, inviteGuideOverlayStyle: overlayStyle });
    })
    .catch((err) => {
      console.warn("measure invite guide target failed", err);
    });
}

function measureCheckinGuideTarget(page) {
  return new Promise((resolve) => {
    const query = wx.createSelectorQuery().in(page);
    query.select("#map-checkin-entry-btn").boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      if (!rect) {
        resolve(null);
        return;
      }
      const { windowWidth, windowHeight } = getWindowMetrics();
      const padding = 10 + (20 * windowWidth / 750);
      const size = Math.max(rect.width, rect.height) + padding * 2;
      const left = Math.max(0, rect.left + rect.width / 2 - size / 2);
      const top = Math.max(0, rect.top + rect.height / 2 - size / 2);
      const rightLeft = Math.min(windowWidth, left + size);
      const bottomTop = Math.min(windowHeight, top + size);
      resolve({
        top,
        left,
        size,
        rightLeft,
        bottomTop
      });
    });
  });
}

function measureInviteGuideTarget(page) {
  const nav = page.selectComponent("#map-bottom-nav");
  const measurePromise =
    nav && typeof nav.measureProfileButtonRect === "function"
      ? nav.measureProfileButtonRect()
      : new Promise((resolve) => {
        const query = wx.createSelectorQuery().in(page);
        query.select("#menu-profile-btn").boundingClientRect();
        query.exec((res) => resolve((res && res[0]) || null));
      });
  return Promise.resolve(measurePromise).then((rect) => {
    if (!rect) {
      return null;
    }
    const { windowWidth, windowHeight } = getWindowMetrics();
    const padding = 10;
    const size = Math.max(rect.width, rect.height) + padding * 2;
    const left = Math.max(0, rect.left + rect.width / 2 - size / 2);
    const top = Math.max(0, rect.top + rect.height / 2 - size / 2);
    const rightLeft = Math.min(windowWidth, left + size);
    const bottomTop = Math.min(windowHeight, top + size);
    return {
      top,
      left,
      size,
      rightLeft,
      bottomTop
    };
  });
}

function updateMapCheckinEntryStyle(page) {
  if (typeof wx === "undefined" || typeof wx.getMenuButtonBoundingClientRect !== "function") {
    if (!page.data.checkinEntryStyle) {
      page.setData({ checkinEntryStyle: DEFAULT_MAP_CHECKIN_ENTRY_STYLE });
    }
    return;
  }
  const menuRect = wx.getMenuButtonBoundingClientRect();
  if (!menuRect || !menuRect.right) {
    if (!page.data.checkinEntryStyle) {
      page.setData({ checkinEntryStyle: DEFAULT_MAP_CHECKIN_ENTRY_STYLE });
    }
    return;
  }
  const { screenWidth } = getWindowMetrics();
  if (!screenWidth) {
    if (!page.data.checkinEntryStyle) {
      page.setData({ checkinEntryStyle: DEFAULT_MAP_CHECKIN_ENTRY_STYLE });
    }
    return;
  }
  const rpx = screenWidth / 750;
  const buttonWidth = 150 * rpx;
  const buttonHeight = 50 * rpx;
  const gapY = 16 * rpx;
  const top = menuRect.bottom + gapY;
  const right = Math.max(12 * rpx, screenWidth - menuRect.right);
  page.setData({
    checkinEntryStyle: `top:${top.toFixed(2)}px;right:${right.toFixed(2)}px;width:${buttonWidth.toFixed(2)}px;height:${buttonHeight.toFixed(2)}px;`
  });
}

function updateSubscriptionBannerLayout(page, retry = 0) {
  const { screenWidth } = getWindowMetrics();
  const fallbackTopPx = screenWidth ? (90 * screenWidth) / 750 : 44;
  const applyFallback = () => {
    page.setData({
      subscriptionBannerTopPx: fallbackTopPx
    }, () => {
      page.updatePreflightOverlayTop(page.data.showSubscriptionBanner);
    });
  };
  if (!page.data.showSubscriptionBanner) {
    return;
  }
  if (typeof wx === "undefined" || typeof wx.getMenuButtonBoundingClientRect !== "function") {
    applyFallback();
    return;
  }
  const menuRect = wx.getMenuButtonBoundingClientRect();
  if (!menuRect || !Number.isFinite(Number(menuRect.top)) || !Number.isFinite(Number(menuRect.bottom))) {
    applyFallback();
    return;
  }
  const query =
    typeof page.createSelectorQuery === "function"
      ? page.createSelectorQuery()
      : wx.createSelectorQuery();
  query.select("#subscription-banner").boundingClientRect();
  query.exec((result = []) => {
    const rect = Array.isArray(result) ? result[0] : null;
    const measuredHeight = Number(rect?.height);
    if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) {
      if (retry < 6) {
        scheduleSubscriptionBannerLayoutRefresh(page, 32 * (retry + 1), retry + 1);
        return;
      }
      applyFallback();
      return;
    }
    const capsuleCenterY = (Number(menuRect.top) + Number(menuRect.bottom)) / 2;
    const nextTopPx = capsuleCenterY - measuredHeight / 2;
    const currentTopPx = Number(page.data.subscriptionBannerTopPx) || 0;
    const currentHeightPx = Number(page.data.subscriptionBannerHeightPx) || 0;
    if (Math.abs(currentTopPx - nextTopPx) < 0.5 && Math.abs(currentHeightPx - measuredHeight) < 0.5) {
      return;
    }
    page.setData({
      subscriptionBannerTopPx: nextTopPx,
      subscriptionBannerHeightPx: measuredHeight
    }, () => {
      page.updatePreflightOverlayTop(page.data.showSubscriptionBanner);
    });
  });
}

function scheduleMapCheckinEntryStyleRefresh(page, delay = 180) {
  if (page._checkinEntryStyleTimer) {
    clearTimeout(page._checkinEntryStyleTimer);
  }
  page._checkinEntryStyleTimer = setTimeout(() => {
    page._checkinEntryStyleTimer = null;
    page.updateMapCheckinEntryStyle();
    page.updateSubscriptionBannerLayout();
  }, Math.max(0, Number(delay) || 0));
}

function scheduleSubscriptionBannerLayoutRefresh(page, delay = 32, retry = 0) {
  if (page._subscriptionBannerLayoutTimer) {
    clearTimeout(page._subscriptionBannerLayoutTimer);
  }
  page._subscriptionBannerLayoutTimer = setTimeout(() => {
    page._subscriptionBannerLayoutTimer = null;
    page.updateSubscriptionBannerLayout(retry);
  }, Math.max(0, Number(delay) || 0));
}

function loadCheckinStatus(page) {
  const apiBase = page.getApiBase();
  const token = page.getAuthToken();
  if (!apiBase || !token) {
    if (page.data.checkinTodaySigned) {
      page.setData({ checkinTodaySigned: false });
    }
    return;
  }
  fetchCheckinDetail({ apiBase, token })
    .then((detail = {}) => {
      page.setData({ checkinTodaySigned: !!detail.todaySigned });
    })
    .catch((err) => {
      if (err?.message === "missing-token") {
        page.setData({ checkinTodaySigned: false });
        return;
      }
      console.warn("map loadCheckinStatus failed", err);
      page.setData({ checkinTodaySigned: false });
    });
}

function buildGuideOverlayStyle(mask) {
  if (!mask) return "";
  const centerX = mask.left + mask.size / 2;
  const centerY = mask.top + mask.size / 2;
  const radius = Math.max(0, mask.size / 2 - 30);
  const edge = Math.max(2, Math.round(radius * 0.04));
  const clearRadius = radius + 1;
  return `background: radial-gradient(circle at ${centerX}px ${centerY}px, rgba(0,0,0,0) 0, rgba(0,0,0,0) ${clearRadius}px, rgba(0,0,0,0.6) ${clearRadius + edge}px);`;
}

function onNewbieTaskStateChange(page, event = {}) {
  const detail = event?.detail || {};
  page.setData({
    showNewbieGiftEntry: !!detail.showGiftEntry,
    newbieTaskBlockerVisible: !!detail.blockMap
  }, () => {
    updateMapBlockerVisible(page);
  });
}

function onAddMiniAppStateChange(page, event = {}) {
  const detail = event?.detail || {};
  page.setData({
    addMiniAppBlockerVisible: !!detail.blockMap
  }, () => {
    updateMapBlockerVisible(page);
  });
}

function updateMapBlockerVisible(page) {
  const blocked = !!(
    page.data.newbieTaskBlockerVisible ||
    page.data.addMiniAppBlockerVisible ||
    page.data.cityReportBlockerVisible ||
    page.data.policyUpdateVisible
  );
  if (page.data.mapBlockerVisible !== blocked) {
    page.setData({ mapBlockerVisible: blocked });
  }
}

function scheduleAddMiniAppPopupCheck(page) {
  if (page._addMiniAppPopupCheckTimer) {
    clearTimeout(page._addMiniAppPopupCheckTimer);
  }
  page._addMiniAppPopupCheckTimer = setTimeout(() => {
    page._addMiniAppPopupCheckTimer = null;
    maybeShowAddMiniAppPopup(page);
  }, ADD_MINI_APP_CHECK_DELAY_MS);
}

function shouldShowAddMiniAppPopup(page) {
  if (!page._mapLayerSettingsLoaded) return false;
  const lastClosedAt = Number(page._mapLayerSettings?.miniProgramAddedAt) || 0;
  if (!lastClosedAt) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  if (lastClosedAt > nowSec) return false;
  return nowSec - lastClosedAt >= ADD_MINI_APP_SUPPRESS_SECONDS;
}

function canShowAddMiniAppPopup(page) {
  const app = typeof getApp === "function" ? getApp() : null;
  const guideActive = !!(app?.globalData?.checkinGuide?.active || app?.globalData?.inviteGuide?.active);
  return !guideActive &&
    !page._addMiniAppPopupVisible &&
    !page.data.newbieTaskBlockerVisible &&
    !page.data.showCheckinGuideMap &&
    !page.data.showInviteGuideMap &&
    !page.data.markerDetailVisible &&
    !page.data.markerPageVisible &&
    !page.data.layerPanelVisible &&
    !page.data.callSheetVisible &&
    !page.data.joinInvitePrompt &&
    !page.data.dronePickerVisible &&
    !page.data.showSubscribeWaitOverlay;
}

function maybeShowAddMiniAppPopup(page) {
  if (page._addMiniAppPopupChecking || page._addMiniAppPopupVisible) return;
  if (!canShowAddMiniAppPopup(page)) return;
  if (!shouldShowAddMiniAppPopup(page)) return;
  if (typeof wx === "undefined" || typeof wx.checkIsAddedToMyMiniProgram !== "function") return;
  page._addMiniAppPopupChecking = true;
  wx.checkIsAddedToMyMiniProgram({
    success: (res = {}) => {
      console.log("check is added to my mini program result", res);
      const isAdded = !!(res.isAdded || res.isAddedToMyMiniProgram || res.added);
      if (isAdded) {
        persistMiniProgramAddedAt(page);
        return;
      }
      if (!isAdded && canShowAddMiniAppPopup(page)) {
        const popup = page.selectComponent("#add-mini-app-popup");
        if (popup && typeof popup.open === "function") {
          popup.open();
          page._addMiniAppPopupVisible = true;
        }
      }
    },
    fail: (err) => {
      console.warn("check is added to my mini program failed", err);
    },
    complete: () => {
      page._addMiniAppPopupChecking = false;
    }
  });
}

function handleAddMiniAppPopupClosed(page) {
  page._addMiniAppPopupVisible = false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (!page._mapLayerSettings || typeof page._mapLayerSettings !== "object") {
    page._mapLayerSettings = {};
  }
  page._mapLayerSettings.miniProgramAddedAt = nowSec;
  const apiBase = page.getApiBase();
  const token = page.getAuthToken();
  if (!apiBase || !token) return;
  updateMapLayerSettings({ miniProgramAddedAt: nowSec }, { apiBase, token })
    .catch((err) => {
      console.warn("update mini program popup close time failed", err);
    });
}

function onAddMiniAppPopupClose(page) {
  page._addMiniAppPopupVisible = false;
  persistMiniProgramAddedAt(page);
}

function persistMiniProgramAddedAt(page) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (!page._mapLayerSettings || typeof page._mapLayerSettings !== "object") {
    page._mapLayerSettings = {};
  }
  page._mapLayerSettings.miniProgramAddedAt = nowSec;
  const apiBase = page.getApiBase();
  const token = page.getAuthToken();
  if (!apiBase || !token) return;
  updateMapLayerSettings({ miniProgramAddedAt: nowSec }, { apiBase, token })
    .catch((err) => {
      console.warn("update mini program popup close time failed", err);
    });
}

module.exports = {
  onCheckinGuideStart,
  onInviteGuideStart,
  onGuideMaskTap,
  showCheckinGuideOnMap,
  showInviteGuideOnMap,
  measureCheckinGuideTarget,
  measureInviteGuideTarget,
  updateMapCheckinEntryStyle,
  updateSubscriptionBannerLayout,
  scheduleMapCheckinEntryStyleRefresh,
  scheduleSubscriptionBannerLayoutRefresh,
  loadCheckinStatus,
  buildGuideOverlayStyle,
  onNewbieTaskStateChange,
  onAddMiniAppStateChange,
  updateMapBlockerVisible,
  scheduleAddMiniAppPopupCheck,
  shouldShowAddMiniAppPopup,
  canShowAddMiniAppPopup,
  maybeShowAddMiniAppPopup,
  handleAddMiniAppPopupClosed,
  onAddMiniAppPopupClose,
  persistMiniProgramAddedAt
};
