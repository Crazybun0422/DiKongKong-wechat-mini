const {
  WEATHER_FEATURE_ENABLED,
  WEATHER_SNAPSHOT_MATCH_METERS,
  hasValidCoordinate,
  fetchWeatherBundle,
  fetchWeatherCalendarBundle,
  loadWeatherSnapshot,
  loadWeatherCalendarSnapshot,
  resolveWeatherIconPath,
  saveWeatherSnapshot,
  saveWeatherCalendarSnapshot,
  snapshotMatches
} = require("../../../utils/weather");
const { reverseGeocode } = require("../../../utils/geocoder");
const { fetchElevationSnapshot } = require("../../../utils/elevation");
const {
  appendInviteCodeToPath,
  appendInviteCodeToQuery
} = require("../../../utils/share");
const {
  convertCoordinateFromGcj02,
  normalizeCoordinateSystem
} = require("../../../pages/map/utils/coordinate-system");

const MAX_AUTO_RETRIES = 2;
const AUTO_RETRY_DELAYS = [0, 450, 900];
const DETAIL_ICON_LIGHT_THEME = true;
const WEATHER_PAGE_PATH = "/packages/weather/index/index";
const WEATHER_WIND_SLOT_STORAGE_KEY = "weather.wind.detail.slot";
const WEATHER_ASSET_PATHS = {
  cloudCover: "/packages/weather/assets/cloud-cover.png",
  elevation: "/packages/weather/assets/elevation-badge.png",
  ground: "/packages/weather/assets/ground.png",
  lowAltitude: "/packages/weather/assets/low-altitude.png",
  midAltitude: "/packages/weather/assets/mid-altitude.png",
  highAltitude: "/packages/weather/assets/high-altitude.png",
  sunrise: "/packages/weather/assets/sunrise.png",
  sunset: "/packages/weather/assets/sunset.png"
};

function parseCenter(options = {}) {
  const latitude = Number(options.latitude);
  const longitude = Number(options.longitude);
  if (!hasValidCoordinate({ latitude, longitude })) {
    return null;
  }
  return { latitude, longitude };
}

function parseCoordinateSystem(options = {}) {
  return normalizeCoordinateSystem(options.coordinateSystem || "wgs84");
}

function formatCenterText(center = null, coordinateSystem = "wgs84") {
  if (!center) {
    return "地图中心点";
  }
  const converted = convertCoordinateFromGcj02(
    Number(center.longitude),
    Number(center.latitude),
    coordinateSystem
  );
  const displayLongitude = Number(converted?.lng);
  const displayLatitude = Number(converted?.lat);
  if (!Number.isFinite(displayLongitude) || !Number.isFinite(displayLatitude)) {
    return `${Number(center.longitude).toFixed(6)}, ${Number(center.latitude).toFixed(6)}`;
  }
  return `${displayLongitude.toFixed(6)}, ${displayLatitude.toFixed(6)}`;
}

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveWeatherScene(current = null) {
  const iconName = `${current?.iconName || ""}`;
  if (!iconName) {
    return "clear";
  }
  if (iconName === "thunderstorm" || iconName === "hail" || iconName === "strong-convective") {
    return "storm";
  }
  if (iconName.includes("rain") || iconName === "showers") {
    return "rain";
  }
  if (iconName.includes("snow")) {
    return "snow";
  }
  if (iconName === "fog") {
    return "fog";
  }
  if (iconName === "overcast" || iconName === "partly-cloudy") {
    return "overcast";
  }
  return "clear";
}

function extractAddressFromGeocode(result = {}) {
  return `${result.recommend || result.formatted_addresses?.recommend || result.address || result.formatted_address || result.title || ""}`.trim();
}

function resolveCenterAddress(center = null) {
  if (!hasValidCoordinate(center || {})) {
    return Promise.resolve("");
  }
  const latitude = Number(center.latitude);
  const longitude = Number(center.longitude);
  return reverseGeocode(latitude, longitude)
    .then((result = {}) => extractAddressFromGeocode(result))
    .catch(() => "");
}

function resolveCenterElevation(center = null) {
  if (!hasValidCoordinate(center || {})) {
    return Promise.resolve("");
  }
  return fetchElevationSnapshot(center)
    .then((snapshot = {}) => `${snapshot.valueText || ""}`.trim())
    .catch(() => "");
}

function buildMetricCards(current = null) {
  if (!current) {
    return [];
  }
  return [
    {
      key: "wind-direction",
      kind: "compass",
      label: "风向",
      directionText: current.windDirectionLabel || "暂无",
      degreeText: current.windDirectionDegreeText || "--",
      rotation: Number.isFinite(Number(current.windDirectionRotation)) ? Number(current.windDirectionRotation) : 0,
      hasDirection: Number.isFinite(Number(current.windDirectionValue))
    },
    { key: "cloud-cover", label: "云量", value: current.cloudCoverDisplay, iconPath: WEATHER_ASSET_PATHS.cloudCover },
    { key: "visibility", label: "能见度", value: current.visibilityDisplay },
    { key: "cloud-base", label: "云底高度", value: current.cloudBaseDisplay }
  ];
}

function resolveWindLayerIconPath(key = "") {
  if (key === "surface") {
    return WEATHER_ASSET_PATHS.ground;
  }
  if (key === "low") {
    return WEATHER_ASSET_PATHS.lowAltitude;
  }
  if (key === "mid") {
    return WEATHER_ASSET_PATHS.midAltitude;
  }
  if (key === "high") {
    return WEATHER_ASSET_PATHS.highAltitude;
  }
  return "";
}

function buildWindLayers(current = null) {
  const list = Array.isArray(current?.windLevels) ? current.windLevels : [];
  return list
    .slice()
    .sort((left = {}, right = {}) => Number(right.heightMeters || 0) - Number(left.heightMeters || 0))
    .map((item = {}) =>
      Object.assign({}, item, {
        title: `${item.label || ""} ${item.heightLabel || ""}`.trim(),
        directionDisplay: item.directionDisplay || "--",
        iconPath: resolveWindLayerIconPath(item.key)
      })
    );
}

function buildCalendarDays(snapshot = null) {
  const now = new Date();
  const currentDateKey = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  const currentTimeKey = `${String(now.getHours()).padStart(2, "0")}:00`;
  const days = Array.isArray(snapshot?.days) ? snapshot.days : [];
  return days.map((day, index) =>
    Object.assign({}, day, {
      tabLabel:
        day.relativeDay === -1
          ? "昨天"
          : day.relativeDay === 0
            ? "今天"
            : day.relativeDay === 1
              ? "明天"
              : day.relativeDay === 2
                ? "后天"
                : (day.weekdayLabel || ""),
      tabId: `calendar-tab-${day.dateKey || index}`,
      sunriseGlow: Object.assign({}, day.sunriseGlow || {}, { iconPath: WEATHER_ASSET_PATHS.sunrise }),
      sunsetGlow: Object.assign({}, day.sunsetGlow || {}, { iconPath: WEATHER_ASSET_PATHS.sunset }),
      sunriseIconPath: WEATHER_ASSET_PATHS.sunrise,
      sunsetIconPath: WEATHER_ASSET_PATHS.sunset,
      rows: Array.isArray(day.rows)
        ? day.rows.map((item) =>
          Object.assign({}, item, {
            iconPath: resolveWeatherIconPath(item.iconName, DETAIL_ICON_LIGHT_THEME),
            isCurrentTime: day.dateKey === currentDateKey && item.timeKey === currentTimeKey
          })
        )
        : []
    })
  );
}

function resolveDefaultCalendarDay(days = []) {
  if (!Array.isArray(days) || !days.length) {
    return null;
  }
  return days.find((item) => item?.relativeDay === 0) || days[0] || null;
}

function buildWindDetailUrl(pageData = {}, slot = {}) {
  const center = pageData?.center || {};
  const coordinateSystem = pageData?.coordinateSystem || "wgs84";
  const satellite = pageData?.satellite ? "1" : "0";
  return (
    `/packages/weather/wind/index?latitude=${encodeURIComponent(Number(center.latitude).toFixed(6))}` +
    `&longitude=${encodeURIComponent(Number(center.longitude).toFixed(6))}` +
    `&coordinateSystem=${encodeURIComponent(coordinateSystem)}` +
    `&satellite=${encodeURIComponent(satellite)}` +
    `&dateKey=${encodeURIComponent(slot.dateKey || "")}` +
    `&timeKey=${encodeURIComponent(slot.timeKey || "")}`
  );
}

function buildCalendarSlotLookup(snapshot = null, dateKey = "", timeKey = "") {
  const days = Array.isArray(snapshot?.days) ? snapshot.days : [];
  const day = days.find((item) => item?.dateKey === dateKey);
  if (!day) {
    return null;
  }
  return Array.isArray(day.rows) ? day.rows.find((row) => row?.timeKey === timeKey) || null : null;
}

function cacheWindDetailSlot(slot = null) {
  if (!slot || typeof wx === "undefined" || typeof wx.setStorageSync !== "function") {
    return;
  }
  try {
    wx.setStorageSync(WEATHER_WIND_SLOT_STORAGE_KEY, slot);
  } catch (err) {
    // ignore storage failure
  }
}

function resolveTheme(scene = "clear") {
  if (scene === "storm") {
    return { frontColor: "#ffffff", backgroundColor: "#232d3b" };
  }
  if (scene === "rain") {
    return { frontColor: "#ffffff", backgroundColor: "#44596d" };
  }
  if (scene === "snow") {
    return { frontColor: "#ffffff", backgroundColor: "#d5e0e8" };
  }
  if (scene === "fog") {
    return { frontColor: "#ffffff", backgroundColor: "#c7d1da" };
  }
  if (scene === "overcast") {
    return { frontColor: "#ffffff", backgroundColor: "#6f7f90" };
  }
  return { frontColor: "#ffffff", backgroundColor: "#cfdde8" };
}

function buildWeatherShareTitle(pageData = {}) {
  const weatherLabel = `${pageData?.currentWeather?.weatherLabel || ""}`.trim();
  const address = `${pageData?.centerAddressText || ""}`.trim();
  if (address && weatherLabel) {
    return `${address}天气：${weatherLabel}`;
  }
  if (weatherLabel) {
    return `星球天气：${weatherLabel}`;
  }
  return "星球天气";
}

function buildWeatherSharePath(pageData = {}) {
  const center = pageData?.center || {};
  const coordinateSystem = pageData?.coordinateSystem || "wgs84";
  const satellite = pageData?.satellite ? "1" : "0";
  if (!hasValidCoordinate(center)) {
    return appendInviteCodeToPath(WEATHER_PAGE_PATH);
  }
  const query =
    `latitude=${encodeURIComponent(Number(center.latitude).toFixed(6))}` +
    `&longitude=${encodeURIComponent(Number(center.longitude).toFixed(6))}` +
    `&coordinateSystem=${encodeURIComponent(coordinateSystem)}` +
    `&satellite=${encodeURIComponent(satellite)}`;
  return appendInviteCodeToPath(`${WEATHER_PAGE_PATH}?${query}`);
}

function buildWeatherShareQuery(pageData = {}) {
  const center = pageData?.center || {};
  const coordinateSystem = pageData?.coordinateSystem || "wgs84";
  const satellite = pageData?.satellite ? "1" : "0";
  const queryParts = [];
  if (hasValidCoordinate(center)) {
    queryParts.push(`latitude=${encodeURIComponent(Number(center.latitude).toFixed(6))}`);
    queryParts.push(`longitude=${encodeURIComponent(Number(center.longitude).toFixed(6))}`);
  }
  queryParts.push(`coordinateSystem=${encodeURIComponent(coordinateSystem)}`);
  queryParts.push(`satellite=${encodeURIComponent(satellite)}`);
  return appendInviteCodeToQuery(queryParts.join("&"));
}

Page({
  data: {
    featureEnabled: WEATHER_FEATURE_ENABLED === true,
    satellite: false,
    coordinateSystem: "wgs84",
    center: null,
    centerAddressText: "",
    centerText: "地图中心点",
    pageReady: false,
    loading: true,
    weatherScrollRefreshing: false,
    error: "",
    updatedAtText: "",
    elevationText: "",
    elevationIconPath: WEATHER_ASSET_PATHS.elevation,
    currentWeather: null,
    currentWindLayers: [],
    currentMetricCards: [],
    calendarDays: [],
    selectedCalendarDateKey: "",
    selectedCalendarTabId: "",
    selectedCalendarDay: null,
    weatherScene: "clear"
  },

  onLoad(options = {}) {
    const satellite = `${options.satellite || ""}` === "1";
    const center = parseCenter(options);
    const coordinateSystem = parseCoordinateSystem(options);
    const featureEnabled = WEATHER_FEATURE_ENABLED === true;
    this.setData({
      featureEnabled,
      satellite,
      coordinateSystem,
      center,
      centerAddressText: "",
      centerText: formatCenterText(center, coordinateSystem)
    });
    if (typeof wx !== "undefined" && typeof wx.showShareMenu === "function") {
      wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
    }
    this.applyNavigationTheme("clear");
    if (!featureEnabled) {
      this.setData({
        pageReady: true,
        loading: false,
        error: "气象功能暂未开放"
      });
      return;
    }
    const cachedWeather = loadWeatherSnapshot();
    const cachedCalendar = loadWeatherCalendarSnapshot();
    if (
      cachedWeather &&
      cachedCalendar &&
      (!center || (
        snapshotMatches(cachedWeather, center, WEATHER_SNAPSHOT_MATCH_METERS) &&
        snapshotMatches(cachedCalendar, center, WEATHER_SNAPSHOT_MATCH_METERS)
      ))
    ) {
      this.applyWeatherData(cachedWeather, cachedCalendar);
    }
    this.loadCenterAddress(center);
    this.loadCenterElevation(center);
    this.refreshWeather({ stopPullDownRefresh: false });
  },

  loadCenterAddress(center = null) {
    if (!hasValidCoordinate(center || {})) {
      this.setData({ centerAddressText: "" });
      return Promise.resolve("");
    }
    const token = `${Date.now()}-${Math.random()}`;
    this._centerAddressToken = token;
    this.setData({ centerAddressText: "" });
    return resolveCenterAddress(center)
      .then((address) => {
        if (this._centerAddressToken !== token) {
          return "";
        }
        this.setData({ centerAddressText: address || "" });
        return address;
      })
      .catch(() => {
        if (this._centerAddressToken !== token) {
          return "";
        }
        this.setData({ centerAddressText: "" });
        return "";
      });
  },

  loadCenterElevation(center = null) {
    if (!hasValidCoordinate(center || {})) {
      this.setData({ elevationText: "" });
      return Promise.resolve("");
    }
    const token = `${Date.now()}-${Math.random()}`;
    this._centerElevationToken = token;
    this.setData({ elevationText: "海拔获取中" });
    return resolveCenterElevation(center)
      .then((elevationText) => {
        if (this._centerElevationToken !== token) {
          return "";
        }
        this.setData({ elevationText: elevationText || "" });
        return elevationText;
      })
      .catch(() => {
        if (this._centerElevationToken !== token) {
          return "";
        }
        this.setData({ elevationText: "" });
        return "";
      });
  },

  onPullDownRefresh() {
    if (this.data.featureEnabled !== true) {
      if (typeof wx !== "undefined" && typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
      return;
    }
    this.refreshWeather({ stopPullDownRefresh: true, stopScrollRefresh: true });
  },

  onScrollRefresh() {
    if (this.data.featureEnabled !== true) {
      this.setData({ weatherScrollRefreshing: false });
      return;
    }
    this.setData({ weatherScrollRefreshing: true });
    this.refreshWeather({ stopPullDownRefresh: false, stopScrollRefresh: true });
  },

  applyNavigationTheme(scene = "clear") {
    if (typeof wx === "undefined" || typeof wx.setNavigationBarColor !== "function") {
      return;
    }
    const theme = resolveTheme(scene);
    wx.setNavigationBarColor({
      frontColor: theme.frontColor,
      backgroundColor: theme.backgroundColor,
      animation: { duration: 160, timingFunc: "easeIn" }
    });
  },

  applyWeatherData(weatherSnapshot = null, calendarSnapshot = null) {
    this._calendarSnapshot = calendarSnapshot || null;
    const calendarDays = buildCalendarDays(calendarSnapshot);
    const previousSelectedDateKey = `${this.data.selectedCalendarDateKey || ""}`;
    const selectedCalendarDay =
      calendarDays.find((item) => item?.dateKey === previousSelectedDateKey) ||
      resolveDefaultCalendarDay(calendarDays) ||
      null;
    const current = weatherSnapshot?.current
      ? Object.assign({}, weatherSnapshot.current, {
        iconPath: resolveWeatherIconPath(weatherSnapshot.current.iconName, DETAIL_ICON_LIGHT_THEME)
      })
      : null;
    const weatherScene = resolveWeatherScene(current);
    this.setData({
      pageReady: true,
      loading: false,
      error: "",
      updatedAtText: weatherSnapshot?.updatedAtText || calendarSnapshot?.updatedAtText || "",
      centerText: formatCenterText(this.data.center, this.data.coordinateSystem),
      currentWeather: current,
      currentWindLayers: buildWindLayers(current),
      currentMetricCards: buildMetricCards(current),
      calendarDays,
      selectedCalendarDateKey: selectedCalendarDay?.dateKey || "",
      selectedCalendarTabId: selectedCalendarDay?.tabId || "",
      selectedCalendarDay,
      weatherScene
    }, () => {
      this.applyNavigationTheme(weatherScene);
    });
  },

  fetchWeatherWithRetry(center, retries = MAX_AUTO_RETRIES, attempt = 0) {
    return Promise.all([fetchWeatherBundle(center), fetchWeatherCalendarBundle(center)]).catch((err) => {
      if (attempt >= retries) {
        throw err;
      }
      const delayMs = AUTO_RETRY_DELAYS[Math.min(attempt + 1, AUTO_RETRY_DELAYS.length - 1)];
      return delay(delayMs).then(() => this.fetchWeatherWithRetry(center, retries, attempt + 1));
    });
  },

  refreshWeather(options = {}) {
    const center = this.data.center;
    if (!hasValidCoordinate(center || {})) {
      this.setData({
        pageReady: true,
        loading: false,
        error: "地图中心点不可用，暂时无法获取气象数据"
      });
      if (options.stopPullDownRefresh && typeof wx !== "undefined" && typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
      if (options.stopScrollRefresh) {
        this.setData({ weatherScrollRefreshing: false });
      }
      return Promise.resolve(null);
    }
    const shouldGateDisplay = !this.data.currentWeather;
    this.setData(
      shouldGateDisplay
        ? { loading: true, pageReady: false, error: "" }
        : { loading: true, error: "" }
    );
    return this.fetchWeatherWithRetry(center)
      .then(([weatherSnapshot, calendarSnapshot]) => {
        saveWeatherSnapshot(weatherSnapshot);
        saveWeatherCalendarSnapshot(calendarSnapshot);
        this.applyWeatherData(weatherSnapshot, calendarSnapshot);
        return { weatherSnapshot, calendarSnapshot };
      })
      .catch((err) => {
        console.warn("weather detail refresh failed", err);
        this.setData({
          pageReady: true,
          loading: false,
          error: "气象数据暂不可用，请稍后再试"
        });
        return null;
      })
      .finally(() => {
        if (options.stopPullDownRefresh && typeof wx !== "undefined" && typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh();
        }
        if (options.stopScrollRefresh) {
          this.setData({ weatherScrollRefreshing: false });
        }
      });
  },

  onOpenWindDetail(event) {
    const dateKey = `${event?.currentTarget?.dataset?.dateKey || ""}`;
    const timeKey = `${event?.currentTarget?.dataset?.timeKey || ""}`;
    if (!dateKey || !timeKey || !hasValidCoordinate(this.data.center || {})) {
      return;
    }
    const calendarSnapshot = this._calendarSnapshot || loadWeatherCalendarSnapshot();
    const slot = buildCalendarSlotLookup(calendarSnapshot, dateKey, timeKey);
    if (!slot) {
      return;
    }
    cacheWindDetailSlot(slot);
    wx.navigateTo({ url: buildWindDetailUrl(this.data, slot) });
  },

  onSelectCalendarDay(event) {
    const dateKey = `${event?.currentTarget?.dataset?.dateKey || ""}`;
    if (!dateKey || dateKey === this.data.selectedCalendarDateKey) {
      return;
    }
    const selectedCalendarDay =
      (Array.isArray(this.data.calendarDays) ? this.data.calendarDays : []).find((item) => item?.dateKey === dateKey) ||
      null;
    if (!selectedCalendarDay) {
      return;
    }
    this.setData({
      selectedCalendarDateKey: selectedCalendarDay.dateKey || "",
      selectedCalendarTabId: selectedCalendarDay.tabId || "",
      selectedCalendarDay
    });
  },

  onShareAppMessage() {
    return {
      title: buildWeatherShareTitle(this.data),
      path: buildWeatherSharePath(this.data)
    };
  },

  onShareTimeline() {
    return {
      title: buildWeatherShareTitle(this.data),
      query: buildWeatherShareQuery(this.data)
    };
  }
});
