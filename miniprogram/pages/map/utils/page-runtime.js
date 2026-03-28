const { loadStoredProfile: loadStoredProfileUtil } = require("../../../utils/profile");
const ACCESS_TOKEN_STORAGE_KEY = "accessToken";
const EARTH_RADIUS_METERS = 6378137;
const EARTH_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS_METERS;
const WEB_TILE_SIZE = 256;
const METERS_PER_PIXEL_BASE = EARTH_CIRCUMFERENCE / WEB_TILE_SIZE;
const CSS_PIXELS_PER_CM = 96 / 2.54;
const {
  DEFAULT_CENTER,
  DEFAULT_SCALE_BAR_BASE_RPX,
  MARKER_FETCH_SCALE_LIMIT_METERS,
  clampMapScale,
  clampMapScaleFloat
} = require("./map-shared");
const MAP_WIDE_LAYOUT_MIN_WIDTH = 560;
const MAP_WIDE_LAYOUT_MIN_RATIO = 1.1;
const MAP_UI_BASE_WIDTH_PX = 375;
const WINDOW_RESIZE_DEBOUNCE_MS = 80;

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
  const statusBarHeight = Number(windowInfo.statusBarHeight || deviceInfo.statusBarHeight) || 0;
  const platform = `${deviceInfo.platform || windowInfo.platform || ""}`.toLowerCase();
  const pixelRatio = Number(windowInfo.pixelRatio || deviceInfo.pixelRatio) || 1;
  return {
    windowWidth,
    windowHeight,
    screenWidth,
    screenHeight,
    statusBarHeight,
    platform,
    pixelRatio
  };
};

const readResizeWindowSize = (event = {}) => {
  if (!event || typeof event !== "object") {
    return { windowWidth: null, windowHeight: null };
  }
  let size = event.size || null;
  if (Array.isArray(size)) {
    size = size[0] || null;
  }
  if (!size || typeof size !== "object") {
    size = event;
  }
  const windowWidth = Number(size.windowWidth || size.width);
  const windowHeight = Number(size.windowHeight || size.height);
  return {
    windowWidth: Number.isFinite(windowWidth) && windowWidth > 0 ? windowWidth : null,
    windowHeight: Number.isFinite(windowHeight) && windowHeight > 0 ? windowHeight : null
  };
};

const resolveWideLayout = (metrics = {}) => {
  const width = Number(metrics.windowWidth);
  const height = Number(metrics.windowHeight);
  if (!Number.isFinite(width) || width <= 0) {
    return false;
  }
  if (width >= MAP_WIDE_LAYOUT_MIN_WIDTH) {
    return true;
  }
  if (Number.isFinite(height) && height > 0) {
    return width / height >= MAP_WIDE_LAYOUT_MIN_RATIO;
  }
  return false;
};

const resolveMapUiScale = (metrics = {}, wideLayout = false) => {
  const width = Number(metrics.windowWidth);
  if (!Number.isFinite(width) || width <= 0) {
    return 1;
  }
  if (width <= MAP_UI_BASE_WIDTH_PX) {
    return 1;
  }
  const scale = MAP_UI_BASE_WIDTH_PX / width;
  if (!Number.isFinite(scale) || scale <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(0.1, scale));
};

const resolveBaselineWidth = (metrics = {}) => {
  const width = Number(metrics.windowWidth);
  if (!Number.isFinite(width) || width <= 0) {
    return MAP_UI_BASE_WIDTH_PX;
  }
  return Math.min(width, MAP_UI_BASE_WIDTH_PX);
};

const mergeLaunchOptions = (primary = {}, secondary = {}) => Object.assign({}, secondary || {}, primary || {});

const computeMetersPerPixel = (latitude, zoomLevel) => {
  if (!Number.isFinite(zoomLevel)) {
    return 0;
  }
  const lat = Math.max(-85, Math.min(85, Number(latitude) || 0));
  const zoom = Math.max(0, zoomLevel);
  const radians = (lat * Math.PI) / 180;
  const cosLat = Math.cos(radians);
  return (METERS_PER_PIXEL_BASE * cosLat) / Math.pow(2, zoom);
};

const formatScaleLabel = (meters) => {
  if (!Number.isFinite(meters) || meters <= 0) {
    return "";
  }
  if (meters >= 1000) {
    const km = meters / 1000;
    return km >= 10 ? `${Math.round(km)} km` : `${Math.round(km * 10) / 10} km`;
  }
  if (meters >= 1) {
    return `${Math.round(meters)} m`;
  }
  return `${Number(meters.toFixed(1))} m`;
};

const pickScaleBarLength = (rawMeters) => {
  if (!Number.isFinite(rawMeters) || rawMeters <= 0) {
    return { length: 0, label: "" };
  }
  const exponent = Math.floor(Math.log10(rawMeters));
  const pow = Math.pow(10, exponent);
  const steps = [1, 2, 5];
  let length = steps[0] * pow;
  for (let i = 0; i < steps.length; i += 1) {
    const candidate = steps[i] * pow;
    if (candidate <= rawMeters) {
      length = candidate;
    } else {
      break;
    }
  }
  if (!Number.isFinite(length) || length <= 0) {
    length = rawMeters;
  }
  return {
    length,
    label: formatScaleLabel(length)
  };
};

const resolveScaleBarDisplay = ({ rawMeters, metersPerPixel, pxPerRpx, baseRpx }) => {
  if (!Number.isFinite(rawMeters) || rawMeters <= 0) {
    return { label: "", widthRpx: Math.max(30, Number(baseRpx) || DEFAULT_SCALE_BAR_BASE_RPX), meters: 0 };
  }
  const nice = pickScaleBarLength(rawMeters);
  const meters = Number.isFinite(nice?.length) && nice.length > 0 ? nice.length : rawMeters;
  const label = nice.label || formatScaleLabel(meters);
  const computedWidthRpx =
    Number.isFinite(metersPerPixel) && metersPerPixel > 0 && Number.isFinite(pxPerRpx) && pxPerRpx > 0
      ? meters / metersPerPixel / pxPerRpx
      : baseRpx;
  const maxWidthRpx = Math.max(30, Number(baseRpx) || DEFAULT_SCALE_BAR_BASE_RPX);
  const widthRpx = Math.min(maxWidthRpx, Math.max(30, Math.round(computedWidthRpx * 10) / 10));
  return {
    label,
    widthRpx,
    meters
  };
};

function getApiBase() {
  const app = getApp ? getApp() : null;
  return (app && app.globalData && app.globalData.apiBase) || "";
}

function getAuthToken() {
  const app = getApp ? getApp() : null;
  return (app && app.globalData && app.globalData.token) || "";
}

function hasAccessToken() {
  const app = getApp ? getApp() : null;
  if (app && app.globalData && app.globalData.token) {
    return true;
  }
  try {
    const token = wx.getStorageSync(ACCESS_TOKEN_STORAGE_KEY);
    if (token && typeof token === "string") {
      if (app && app.globalData) app.globalData.token = token;
      return true;
    }
  } catch (err) {
    console.warn("读取 accessToken 失败", err);
  }
  return false;
}

function loadStoredProfile() {
  return loadStoredProfileUtil();
}

function ensureProfileAuthenticated(page) {
  if (hasAccessToken()) {
    return Promise.resolve(loadStoredProfile());
  }
  const showLoading = typeof wx.showLoading === "function";
  const hideLoading = typeof wx.hideLoading === "function" ? () => wx.hideLoading() : () => {};
  const profile = loadStoredProfile() || {};
  if (showLoading) wx.showLoading({ title: "登录中...", mask: true });
  return ensureAccessToken(page, { profileOverride: profile })
    .then(() => {
      hideLoading();
      return profile;
    })
    .catch((err) => {
      hideLoading();
      throw err;
    });
}

function ensureAccessToken(page, options = {}) {
  if (hasAccessToken()) return Promise.resolve();
  if (page._ensureLoginPromise) return page._ensureLoginPromise;
  const app = getApp ? getApp() : null;
  if (!app || typeof app.loginWithProfile !== "function") {
    return Promise.reject(new Error("login-unavailable"));
  }
  const override = options && options.profileOverride;
  const profile = override || loadStoredProfile() || {};
  page._ensureLoginPromise = app.loginWithProfile(profile)
    .catch((err) => {
      throw err || new Error("login-failed");
    })
    .finally(() => {
      page._ensureLoginPromise = null;
    });
  return page._ensureLoginPromise;
}

function initializeSystemInfo(page, force = false, inputMetrics = null) {
  if (!force && page._pxPerRpx && page._pxPerRpx > 0) {
    return;
  }
  const metrics =
    inputMetrics && typeof inputMetrics === "object" ? inputMetrics : getWindowMetrics();
  const width = metrics.windowWidth || 375;
  page._pxPerRpx = width / 750;
  const pxPerRpx = page._pxPerRpx || 1;
  page._scaleBarBaseRpx = Math.max(30, Math.round(CSS_PIXELS_PER_CM / pxPerRpx));
  if (metrics.platform) {
    page._isIOS = metrics.platform === "ios";
  }
  const statusBarHeight = Number(metrics.statusBarHeight);
  const centerPinOffsetPx = 0;
  const updates = {};
  if (
    Number.isFinite(statusBarHeight) &&
    statusBarHeight > 0 &&
    page.data.statusBarHeight !== statusBarHeight
  ) {
    updates.statusBarHeight = statusBarHeight;
  }
  if (page.data.centerPinOffsetPx !== centerPinOffsetPx) {
    updates.centerPinOffsetPx = centerPinOffsetPx;
  }
  if (Object.keys(updates).length) {
    page.setData(updates);
  }
}

function updateScaleBar(page, context = {}) {
  const ctx = context && typeof context === "object" ? context : {};
  if (!page._pxPerRpx || page._pxPerRpx <= 0) {
    initializeSystemInfo(page);
  }
  const pxPerRpx = page._pxPerRpx || 1;
  const baseRpx = page._scaleBarBaseRpx || DEFAULT_SCALE_BAR_BASE_RPX;
  const pxWidth = baseRpx * pxPerRpx;
  const latitude =
    typeof ctx.latitude === "number"
      ? ctx.latitude
      : (page.data.center && typeof page.data.center.latitude === "number"
        ? page.data.center.latitude
        : DEFAULT_CENTER.latitude);
  const zoomSource = Object.prototype.hasOwnProperty.call(ctx, "rawScale")
    ? ctx.rawScale
    : (Object.prototype.hasOwnProperty.call(ctx, "scale") ? ctx.scale : page.data.scale);
  const zoom = clampMapScaleFloat(zoomSource);
  const metersPerPixel = computeMetersPerPixel(latitude, zoom);
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return;
  }
  const rawMeters = metersPerPixel * pxWidth;
  const display = resolveScaleBarDisplay({
    rawMeters,
    metersPerPixel,
    pxPerRpx,
    baseRpx
  });
  page._lastScaleBarMeters = display.meters;
  page.setData({
    scaleBarVisible: true,
    scaleBarLabel: display.label,
    scaleBarWidthRpx: display.widthRpx
  });
}

function estimateScaleBarMeters(page, scale, latitude) {
  if (!page._pxPerRpx || page._pxPerRpx <= 0) {
    initializeSystemInfo(page);
  }
  const pxPerRpx = page._pxPerRpx || 1;
  const baseRpx = page._scaleBarBaseRpx || DEFAULT_SCALE_BAR_BASE_RPX;
  const pxWidth = pxPerRpx * baseRpx;
  if (!Number.isFinite(pxWidth) || pxWidth <= 0) return null;
  const latSource = typeof latitude === "number"
    ? latitude
    : (page.data.center && typeof page.data.center.latitude === "number"
      ? page.data.center.latitude
      : DEFAULT_CENTER.latitude);
  const lat = Math.max(-85, Math.min(85, Number(latSource) || 0));
  const metersPerPixel = computeMetersPerPixel(lat, clampMapScale(scale ?? page.data.scale));
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
  const rawMeters = metersPerPixel * pxWidth;
  return resolveScaleBarDisplay({
    rawMeters,
    metersPerPixel,
    pxPerRpx,
    baseRpx
  }).meters;
}

function shouldFetchNearbyMarkers(page, scale, latitude) {
  const approxMeters = estimateScaleBarMeters(page, scale, latitude);
  if (Number.isFinite(approxMeters) && approxMeters >= MARKER_FETCH_SCALE_LIMIT_METERS) {
    return false;
  }
  return true;
}

function queueRegionUpdateSkip(page, count = 1) {
  const inc = Number.isFinite(count) ? Math.max(1, Math.round(count)) : 1;
  const pending = Number.isFinite(page._pendingRegionUpdates) ? page._pendingRegionUpdates : 0;
  page._pendingRegionUpdates = pending + inc;
}

function consumePendingLaunchOptions(options = {}) {
  const app = typeof getApp === "function" ? getApp() : null;
  const pending = app?.globalData?.pendingLaunchOptions;
  if (!pending) return options || {};
  app.globalData.pendingLaunchOptions = null;
  return mergeLaunchOptions(pending, options || {});
}

function consumeInitialUsePlanetCenterPoint() {
  const app = typeof getApp === "function" ? getApp() : null;
  if (!app?.globalData) return null;
  const value = app.globalData.initialUsePlanetCenterPoint;
  if (typeof value !== "boolean") {
    return null;
  }
  app.globalData.initialUsePlanetCenterPoint = null;
  return value;
}

function resolveWindowMetrics(event = {}) {
  const metrics = getWindowMetrics();
  const resize = readResizeWindowSize(event);
  if (Number.isFinite(resize.windowWidth) && resize.windowWidth > 0) {
    metrics.windowWidth = resize.windowWidth;
  }
  if (Number.isFinite(resize.windowHeight) && resize.windowHeight > 0) {
    metrics.windowHeight = resize.windowHeight;
  }
  return metrics;
}

function refreshResponsiveLayout(page, options = {}) {
  const metrics =
    options && options.metrics && typeof options.metrics === "object"
      ? options.metrics
      : resolveWindowMetrics(options.event);
  initializeSystemInfo(page, options.force === true, metrics);
  const wideLayout = resolveWideLayout(metrics);
  const uiScale = resolveMapUiScale(metrics, wideLayout);
  const baselineWidth = resolveBaselineWidth(metrics);
  const baselinePxPerRpx = baselineWidth / 750;
  const roundedScale = Number(uiScale.toFixed(4));
  const uiScaleStyle = roundedScale < 0.9999 ? `transform: scale(${roundedScale});` : "";
  const subscriptionBannerScaleStyle =
    roundedScale < 0.9999
      ? `transform: translateY(-50%) scale(${roundedScale}); transform-origin: left center;`
      : "transform: translateY(-50%); transform-origin: left center;";
  const updates = {};
  if (page.data.isWideLayout !== wideLayout) {
    updates.isWideLayout = wideLayout;
  }
  if (page.data.mapUiScale !== roundedScale) {
    updates.mapUiScale = roundedScale;
  }
  if (page.data.mapUiScaleStyle !== uiScaleStyle) {
    updates.mapUiScaleStyle = uiScaleStyle;
  }
  if (page.data.subscriptionBannerScaleStyle !== subscriptionBannerScaleStyle) {
    updates.subscriptionBannerScaleStyle = subscriptionBannerScaleStyle;
  }
  const roundAnchorPx = (rpx) => Math.round(rpx * baselinePxPerRpx * 100) / 100;
  const subscriptionBannerLeftPx = roundAnchorPx(16);
  const preflightLeftPx = roundAnchorPx(16);
  const scaleControlsLeftPx = roundAnchorPx(32);
  const scaleControlsBottomPx = roundAnchorPx(240);
  const compassBottomPx = roundAnchorPx(490);
  const floatingControlsRightPx = roundAnchorPx(32);
  const floatingControlsBottomPx = roundAnchorPx(262);
  const bottomNavBottomPx = roundAnchorPx(42);
  if (page.data.subscriptionBannerLeftPx !== subscriptionBannerLeftPx) {
    updates.subscriptionBannerLeftPx = subscriptionBannerLeftPx;
  }
  if (page.data.preflightLeftPx !== preflightLeftPx) {
    updates.preflightLeftPx = preflightLeftPx;
  }
  if (page.data.scaleControlsLeftPx !== scaleControlsLeftPx) {
    updates.scaleControlsLeftPx = scaleControlsLeftPx;
  }
  if (page.data.scaleControlsBottomPx !== scaleControlsBottomPx) {
    updates.scaleControlsBottomPx = scaleControlsBottomPx;
  }
  if (page.data.compassBottomPx !== compassBottomPx) {
    updates.compassBottomPx = compassBottomPx;
  }
  if (page.data.floatingControlsRightPx !== floatingControlsRightPx) {
    updates.floatingControlsRightPx = floatingControlsRightPx;
  }
  if (page.data.floatingControlsBottomPx !== floatingControlsBottomPx) {
    updates.floatingControlsBottomPx = floatingControlsBottomPx;
  }
  if (page.data.bottomNavBottomPx !== bottomNavBottomPx) {
    updates.bottomNavBottomPx = bottomNavBottomPx;
  }
  const windowHeight = Number(metrics.windowHeight);
  if (Number.isFinite(windowHeight) && windowHeight > 0) {
    const pxPerRpx = page._pxPerRpx || ((metrics.windowWidth || 375) / 750) || 0.5;
    const panelMaxHeightPx = Math.max(280, Math.floor(windowHeight * 0.8));
    const bodyMaxHeightPx = Math.max(180, panelMaxHeightPx - Math.round(124 * pxPerRpx));
    if (page.data.layerPanelMaxHeightPx !== panelMaxHeightPx) {
      updates.layerPanelMaxHeightPx = panelMaxHeightPx;
    }
    if (page.data.layerPanelBodyMaxHeightPx !== bodyMaxHeightPx) {
      updates.layerPanelBodyMaxHeightPx = bodyMaxHeightPx;
    }
  }
  if (Object.keys(updates).length) {
    page.setData(updates, () => {
      if (page.data.layerPanelVisible) {
        page.scheduleLayerPanelLayoutMeasure(0);
      }
    });
  } else if (page.data.layerPanelVisible) {
    page.scheduleLayerPanelLayoutMeasure(0);
  }
  if (options.refreshScaleBar === false) {
    return;
  }
  const latitude = Number(page.data?.center?.latitude);
  page.updateScaleBar({
    scale: page.data.scale,
    latitude: Number.isFinite(latitude) ? latitude : DEFAULT_CENTER.latitude
  });
}

function registerWindowResizeListener(page) {
  if (typeof wx === "undefined" || typeof wx.onWindowResize !== "function") {
    return;
  }
  if (page._onWindowResize) {
    return;
  }
  page._onWindowResize = (event = {}) => {
    page._lastResizeEvent = event;
    if (page._windowResizeTimer) {
      clearTimeout(page._windowResizeTimer);
    }
    page._windowResizeTimer = setTimeout(() => {
      page._windowResizeTimer = null;
      page.refreshResponsiveLayout({ event: page._lastResizeEvent, force: true });
    }, WINDOW_RESIZE_DEBOUNCE_MS);
  };
  wx.onWindowResize(page._onWindowResize);
}

function unregisterWindowResizeListener(page) {
  if (page._windowResizeTimer) {
    clearTimeout(page._windowResizeTimer);
    page._windowResizeTimer = null;
  }
  if (!page._onWindowResize) {
    return;
  }
  if (typeof wx !== "undefined" && typeof wx.offWindowResize === "function") {
    wx.offWindowResize(page._onWindowResize);
  }
  page._onWindowResize = null;
  page._lastResizeEvent = null;
}

module.exports = {
  getApiBase,
  getAuthToken,
  hasAccessToken,
  loadStoredProfile,
  ensureProfileAuthenticated,
  ensureAccessToken,
  initializeSystemInfo,
  updateScaleBar,
  estimateScaleBarMeters,
  shouldFetchNearbyMarkers,
  queueRegionUpdateSkip,
  consumePendingLaunchOptions,
  consumeInitialUsePlanetCenterPoint,
  resolveWindowMetrics,
  refreshResponsiveLayout,
  registerWindowResizeListener,
  unregisterWindowResizeListener
};
