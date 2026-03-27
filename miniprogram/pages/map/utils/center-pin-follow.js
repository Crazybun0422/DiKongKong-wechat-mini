const CENTER_PIN_FOLLOW_INTERVAL_MS = 1000;
const CENTER_PIN_FOLLOW_ERROR_TOAST_INTERVAL_MS = 5000;
const CENTER_PIN_CLOSE_TAP_SUPPRESS_MS = 320;

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

function suppressCenterPinOpenOnce(page, durationMs = CENTER_PIN_CLOSE_TAP_SUPPRESS_MS) {
  const duration = Number(durationMs);
  const windowMs = Number.isFinite(duration) && duration > 0 ? duration : CENTER_PIN_CLOSE_TAP_SUPPRESS_MS;
  page._centerPinOpenSuppressUntil = Date.now() + windowMs;
}

function shouldSuppressCenterPinOpen(page) {
  const until = Number(page._centerPinOpenSuppressUntil) || 0;
  if (until <= 0) return false;
  if (Date.now() > until) {
    page._centerPinOpenSuppressUntil = 0;
    return false;
  }
  return true;
}

function onCenterPinSheetClose(page) {
  suppressCenterPinOpenOnce(page);
}

function startCenterPinLocationFollow(page) {
  if (page._centerPinFollowActive) {
    if (!page.data.centerPinFollowActive) {
      page.setData({ centerPinFollowActive: true });
    }
    return Promise.resolve(true);
  }
  return page.ensureLocationPermission().then(() => {
    page._centerPinFollowActive = true;
    page._centerPinFollowPaused = false;
    page._centerPinFollowLocating = false;
    page._centerPinFollowLastErrorAt = 0;
    if (page._centerPinFollowTimer) {
      clearTimeout(page._centerPinFollowTimer);
      page._centerPinFollowTimer = null;
    }
    page.setData({ centerPinFollowActive: true });
    scheduleCenterPinLocationFollow(page, 0);
    return true;
  });
}

function stopCenterPinLocationFollow(page, options = {}) {
  const shouldToast = options.toast !== false;
  const wasActive = !!page._centerPinFollowActive || !!page.data.centerPinFollowActive;
  page._centerPinFollowActive = false;
  page._centerPinFollowPaused = false;
  page._centerPinFollowLocating = false;
  if (page._centerPinFollowTimer) {
    clearTimeout(page._centerPinFollowTimer);
    page._centerPinFollowTimer = null;
  }
  if (page.data.centerPinFollowActive) {
    page.setData({ centerPinFollowActive: false });
  }
  if (shouldToast && wasActive && typeof wx?.showToast === "function") {
    wx.showToast({ title: "已解除位置绑定", icon: "none" });
  }
}

function scheduleCenterPinLocationFollow(page, delay = CENTER_PIN_FOLLOW_INTERVAL_MS) {
  if (!page._centerPinFollowActive || page._centerPinFollowPaused) return;
  if (page._centerPinFollowTimer) {
    clearTimeout(page._centerPinFollowTimer);
    page._centerPinFollowTimer = null;
  }
  const wait = Math.max(0, Number(delay) || 0);
  page._centerPinFollowTimer = setTimeout(() => {
    page._centerPinFollowTimer = null;
    runCenterPinLocationFollowTick(page);
  }, wait);
}

function runCenterPinLocationFollowTick(page) {
  if (!page._centerPinFollowActive || page._centerPinFollowPaused) return;
  if (page._centerPinFollowLocating) {
    scheduleCenterPinLocationFollow(page, 200);
    return;
  }
  page._centerPinFollowLocating = true;
  wx.getLocation({
    type: "gcj02",
    isHighAccuracy: false,
    highAccuracyExpireTime: 8000,
    success: (res) => {
      if (!page._centerPinFollowActive) return;
      const latitude = Number(res?.latitude);
      const longitude = Number(res?.longitude);
      if (!hasValidCoordinate(latitude, longitude)) return;
      const point = { latitude, longitude };
      page._lastKnownLocation = point;
      page.cacheMapLocation(point);
      page.setMyLocationControlPoint(point, { syncCenter: false });
      page.refreshMarkerPageDistance();
      page.centerOnPoint(point, page.data.scale, true);
    },
    fail: (err) => {
      console.warn("center pin follow getLocation fail", err);
      const now = Date.now();
      if (
        typeof wx?.showToast === "function" &&
        (!Number.isFinite(page._centerPinFollowLastErrorAt) ||
          now - page._centerPinFollowLastErrorAt >= CENTER_PIN_FOLLOW_ERROR_TOAST_INTERVAL_MS)
      ) {
        page._centerPinFollowLastErrorAt = now;
        wx.showToast({ title: "位置读取失败", icon: "none" });
      }
    },
    complete: () => {
      page._centerPinFollowLocating = false;
      if (page._centerPinFollowActive) {
        scheduleCenterPinLocationFollow(page, CENTER_PIN_FOLLOW_INTERVAL_MS);
      }
    }
  });
}

function shouldIgnoreRegionSyncForCenterPinFollow(page, cause = "") {
  if (!page._centerPinFollowActive) return false;
  const normalized = `${cause || ""}`.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "drag" ||
    normalized === "gesture" ||
    normalized === "rotate" ||
    normalized === "skew" ||
    normalized === "overlook"
  );
}

function pauseCenterPinLocationFollow(page) {
  if (!page._centerPinFollowActive) return;
  page._centerPinFollowPaused = true;
  page._centerPinFollowLocating = false;
  if (page._centerPinFollowTimer) {
    clearTimeout(page._centerPinFollowTimer);
    page._centerPinFollowTimer = null;
  }
}

function resumeCenterPinLocationFollow(page) {
  if (!page._centerPinFollowActive) return;
  if (!page._centerPinFollowPaused && page._centerPinFollowTimer) return;
  page._centerPinFollowPaused = false;
  scheduleCenterPinLocationFollow(page, 0);
}

module.exports = {
  suppressCenterPinOpenOnce,
  shouldSuppressCenterPinOpen,
  onCenterPinSheetClose,
  startCenterPinLocationFollow,
  stopCenterPinLocationFollow,
  scheduleCenterPinLocationFollow,
  runCenterPinLocationFollowTick,
  shouldIgnoreRegionSyncForCenterPinFollow,
  pauseCenterPinLocationFollow,
  resumeCenterPinLocationFollow
};
