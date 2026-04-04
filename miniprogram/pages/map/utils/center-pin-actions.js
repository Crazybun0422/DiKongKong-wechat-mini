const hasValidCoordinate = (latitude, longitude) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
};

function onCenterPinTap(page) {
  if (page.shouldSuppressCenterPinOpen()) return;
  page.openMarkerOrPinAtCenter();
}

function onCenterPinLongPress(page, event = {}) {
  if (event?.detail?.exitStealth || page.data.stealthModeActive) {
    page.exitStealthMode();
    return;
  }
  if (event?.detail?.clearLink || page.data.centerPinLinkActive) {
    page.clearActiveCenterTargetLink();
    return;
  }
  if (page._centerPinFollowActive) {
    page.stopCenterPinLocationFollow({ toast: true });
    return;
  }
  if (!page.getAuthToken()) return;
  page.loadMapGuideConfigs().catch((err) => {
    console.warn("loadMapGuideConfigs onCenterPinLongPress failed", err);
  });
}

function onCenterPinAction(page, event) {
  const action = `${event?.detail?.action || ""}`.trim();
  if (!action) return;
  if (action === "stealthMode") {
    page.enterStealthMode();
    return;
  }
  if (action === "quickMark") {
    openMyPinCreateAtCenter(page);
    return;
  }
  if (action === "share") {
    page.prepareCenterActionShare();
    return;
  }
  if (action === "bindMyLocation") {
    if (page._centerPinFollowActive) {
      wx.showToast({ title: "长按可解除绑定", icon: "none" });
      return;
    }
    page.startCenterPinLocationFollow()
      .then(() => {
        wx.showToast({ title: "已绑定当前位置", icon: "none" });
      })
      .catch(() => {
        wx.showToast({ title: "未授权定位权限", icon: "none" });
      });
    return;
  }
  if (action === "navigate") {
    const center = page._centerOverride || page.data.center;
    if (!center || !hasValidCoordinate(center.latitude, center.longitude)) {
      wx.showToast({ title: "暂无定位信息", icon: "none" });
      return;
    }
    const pinTitle = `${page.data.centerPinTitle || ""}`.trim();
    page.openMarkerLocation(
      {
        latitude: center.latitude,
        longitude: center.longitude,
        name: pinTitle || "中心位置",
        locationText: ""
      }
    );
    return;
  }
  if (action === "afeiAdventure") {
    openAfeiAdventure(page, event?.detail || {});
    return;
  }
  if (action === "askAgent") {
    openPlanetQaAtCenter();
  }
}

function openPlanetQaAtCenter() {
  wx.showToast({ title: "正在努力接入中~", icon: "none" });
}

function openAfeiAdventure(page, detail = {}) {
  const resourceDir = `${detail?.resourceDir || detail?.extractedPath || ""}`.trim();
  const resourceVersion = `${detail?.resourceVersion || detail?.version || ""}`.trim();
  if (!resourceDir) {
    wx.showToast({ title: "资源准备中，请稍后再试", icon: "none" });
    return;
  }
  const query = [
    `resourceDir=${encodeURIComponent(resourceDir)}`,
    `version=${encodeURIComponent(resourceVersion)}`
  ].join("&");
  wx.navigateTo({
    url: `/packages/map-center-pin/afei-adventure/index?${query}`,
    fail: (err) => {
      console.warn("navigate to afei adventure failed", err);
      wx.showToast({ title: "暂时无法打开阿飞历险记", icon: "none" });
    }
  });
}

function openMyPinCreateAtCenter(page) {
  const center = page._centerOverride || page.data.center;
  if (!center || !hasValidCoordinate(center.latitude, center.longitude)) {
    wx.showToast({ title: "暂无定位信息", icon: "none" });
    return;
  }
  const latitude = Number(center.latitude);
  const longitude = Number(center.longitude);
  const centerPinTitle = `${page.data.centerPinTitle || ""}`.trim();
  const payload = {
    latitude,
    longitude,
    coordinateText: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
    addressMain: "",
    addressDetail: centerPinTitle
  };
  let navigated = false;
  const navigateOnce = () => {
    if (navigated) return;
    navigated = true;
    navigateToMarkersPinCreate(payload);
  };
  const fallbackTimer = setTimeout(() => {
    navigateOnce();
  }, 520);
  page.requestPinAddress(latitude, longitude)
    .then((address) => {
      const resolved = `${address || ""}`.trim();
      if (resolved) {
        payload.addressMain = resolved;
        if (!payload.addressDetail || payload.addressDetail === resolved) {
          payload.addressDetail = resolved;
        }
      }
    })
    .catch((err) => {
      console.warn("resolve quick mark center address failed", err);
    })
    .finally(() => {
      clearTimeout(fallbackTimer);
      navigateOnce();
    });
}

function navigateToMarkersPinCreate(payload = {}) {
  const url = "/pages/markers/index";
  try {
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) {
      app.globalData.targetMarkersCenterTab = "MY_MARKERS";
      app.globalData.pendingMyPinCreate = payload;
    }
  } catch (err) {
    console.warn("set pending my pin create failed", err);
  }
  if (typeof wx?.navigateTo === "function") {
    wx.navigateTo({
      url,
      fail: (err) => {
        console.warn("navigateTo markers failed, fallback to switchTab", err);
        if (typeof wx?.switchTab === "function") {
          wx.switchTab({ url });
        }
      }
    });
    return;
  }
  if (typeof wx?.switchTab === "function") {
    wx.switchTab({ url });
  }
}

module.exports = {
  onCenterPinTap,
  onCenterPinLongPress,
  onCenterPinAction,
  openPlanetQaAtCenter,
  openAfeiAdventure,
  openMyPinCreateAtCenter,
  navigateToMarkersPinCreate
};
