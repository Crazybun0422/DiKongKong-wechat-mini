const { haversineMeters } = require("../../../utils/coords");
const {
  WEATHER_FEATURE_ENABLED,
  WEATHER_MOVE_THRESHOLD_METERS,
  WEATHER_REFRESH_INTERVAL_MS,
  hasValidCoordinate,
  fetchWeatherBundle,
  loadWeatherSnapshot,
  saveWeatherSnapshot,
  snapshotMatches
} = require("../../../utils/weather");

function clearWeatherState(page) {
  page._weatherSnapshot = null;
  page.setData({
    weatherLoading: false,
    weatherError: "",
    weatherSummaryItems: [],
    weatherUpdatedAtText: ""
  });
}

function showWeatherLoadingState(page, options = {}) {
  if (WEATHER_FEATURE_ENABLED !== true) {
    return;
  }
  const updates = {
    weatherLoading: true,
    weatherError: ""
  };
  if (options.clearItems === true) {
    updates.weatherSummaryItems = [];
  }
  page.setData(updates);
}

function applyWeatherSnapshot(page, snapshot = null, options = {}) {
  if (WEATHER_FEATURE_ENABLED !== true) {
    clearWeatherState(page);
    return null;
  }
  page._weatherSnapshot = snapshot || null;
  const updates = {
    weatherLoading: false,
    weatherSummaryItems: Array.isArray(snapshot?.items) ? snapshot.items : [],
    weatherUpdatedAtText: typeof snapshot?.updatedAtText === "string" ? snapshot.updatedAtText : ""
  };
  if (options.clearError !== false) {
    updates.weatherError = "";
  }
  page.setData(updates);
  return snapshot;
}

function hydrateWeatherFromCache(page, options = {}) {
  if (WEATHER_FEATURE_ENABLED !== true) {
    clearWeatherState(page);
    return false;
  }
  const center = options?.center || page._centerOverride || page.data.center;
  const snapshot = loadWeatherSnapshot();
  if (!snapshot) {
    return false;
  }
  if (hasValidCoordinate(center) && !snapshotMatches(snapshot, center)) {
    return false;
  }
  applyWeatherSnapshot(page, snapshot, { clearError: false });
  return true;
}

function scheduleFetchWeather(page, delay = 0, options = {}) {
  if (page._weatherFetchTimer) {
    clearTimeout(page._weatherFetchTimer);
  }
  if (WEATHER_FEATURE_ENABLED !== true) {
    page._weatherFetchTimer = null;
    return null;
  }
  const waitMs = Math.max(0, Number(delay) || 0);
  if (waitMs > 0 && options.showLoading === true) {
    showWeatherLoadingState(page);
  }
  page._weatherFetchTimer = setTimeout(() => {
    page._weatherFetchTimer = null;
    requestWeatherSummary(page, options);
  }, waitMs);
  return page._weatherFetchTimer;
}

function requestWeatherSummary(page, options = {}) {
  if (WEATHER_FEATURE_ENABLED !== true) {
    clearWeatherState(page);
    return Promise.resolve(null);
  }
  const center = options?.center || page._centerOverride || page.data.center;
  if (!hasValidCoordinate(center)) {
    page.setData({ weatherLoading: false });
    return Promise.resolve(null);
  }
  const now = Date.now();
  const previous = page._lastWeatherFetch || {};
  const movedMeters = hasValidCoordinate(previous)
    ? haversineMeters(
      Number(center.latitude),
      Number(center.longitude),
      Number(previous.latitude),
      Number(previous.longitude)
    )
    : Number.POSITIVE_INFINITY;
  const previousTimestamp = Number(previous.timestamp) || 0;
  const isStale = !previousTimestamp || now - previousTimestamp > WEATHER_REFRESH_INTERVAL_MS;
  const force = options.force === true;
  if (!force && movedMeters < WEATHER_MOVE_THRESHOLD_METERS && !isStale && page._weatherSnapshot) {
    page.setData({ weatherLoading: false, weatherError: "" });
    return Promise.resolve(page._weatherSnapshot);
  }
  const requestId = `${now}-${Math.random()}`;
  page._activeWeatherRequest = requestId;
  if (
    options.showLoading === true ||
    !page._weatherSnapshot ||
    !Array.isArray(page.data.weatherSummaryItems) ||
    !page.data.weatherSummaryItems.length
  ) {
    showWeatherLoadingState(page);
  } else {
    page.setData({ weatherError: "" });
  }
  return fetchWeatherBundle(center)
    .then((snapshot) => {
      if (page._activeWeatherRequest !== requestId) {
        return null;
      }
      saveWeatherSnapshot(snapshot);
      page._lastWeatherFetch = {
        latitude: Number(center.latitude),
        longitude: Number(center.longitude),
        timestamp: Date.now()
      };
      applyWeatherSnapshot(page, snapshot);
      return snapshot;
    })
    .catch((err) => {
      if (page._activeWeatherRequest !== requestId) {
        return null;
      }
      page.setData({
        weatherLoading: false,
        weatherError: "气象数据暂不可用"
      });
      console.warn("requestWeatherSummary failed", err);
      return null;
    })
    .finally(() => {
      if (page._activeWeatherRequest === requestId) {
        page._activeWeatherRequest = null;
      }
    });
}

function onWeatherWidgetTap(page) {
  if (WEATHER_FEATURE_ENABLED !== true) {
    return;
  }
  if (page._weatherFetchTimer) {
    clearTimeout(page._weatherFetchTimer);
    page._weatherFetchTimer = null;
  }
  const center = page._centerOverride || page.data.center;
  if (!hasValidCoordinate(center)) {
    if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
      wx.showToast({ title: "中心点不可用", icon: "none" });
    }
    return;
  }
  const satellite = page.data.mapLayerType === "satellite" || page.data.mapLayerType === "tianditu" ? 1 : 0;
  const coordinateSystem = `${page.data.coordinateSystem || "wgs84"}`.toLowerCase();
  const url =
    `/packages/weather/index/index?latitude=${encodeURIComponent(Number(center.latitude).toFixed(6))}` +
    `&longitude=${encodeURIComponent(Number(center.longitude).toFixed(6))}` +
    `&satellite=${satellite}` +
    `&coordinateSystem=${encodeURIComponent(coordinateSystem)}`;
  wx.navigateTo({ url });
}

module.exports = {
  WEATHER_FEATURE_ENABLED,
  applyWeatherSnapshot,
  hydrateWeatherFromCache,
  scheduleFetchWeather,
  requestWeatherSummary,
  onWeatherWidgetTap
};
