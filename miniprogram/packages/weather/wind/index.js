const {
  WEATHER_SNAPSHOT_MATCH_METERS,
  hasValidCoordinate,
  fetchWeatherCalendarBundle,
  loadWeatherCalendarSnapshot,
  resolveWeatherIconPath,
  saveWeatherCalendarSnapshot,
  snapshotMatches
} = require("../../../utils/weather");
const { reverseGeocode } = require("../../../utils/geocoder");
const {
  convertCoordinateFromGcj02,
  normalizeCoordinateSystem
} = require("../../../pages/map/utils/coordinate-system");

const DETAIL_ICON_LIGHT_THEME = true;
const WEATHER_WIND_SLOT_STORAGE_KEY = "weather.wind.detail.slot";
const WEATHER_ASSET_PATHS = {
  ground: "/packages/weather/assets/ground.png",
  lowAltitude: "/packages/weather/assets/low-altitude.png",
  midAltitude: "/packages/weather/assets/mid-altitude.png",
  highAltitude: "/packages/weather/assets/high-altitude.png"
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
  return normalizeCoordinateSystem(decodeOptionText(options.coordinateSystem) || "wgs84");
}

function decodeOptionText(value = "") {
  const text = `${value || ""}`;
  if (!text) {
    return "";
  }
  try {
    return decodeURIComponent(text);
  } catch (err) {
    return text;
  }
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

function resolveWeatherScene(slot = null) {
  const iconName = `${slot?.iconName || ""}`;
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

function resolveTheme(scene = "clear") {
  if (scene === "storm") {
    return { frontColor: "#ffffff", backgroundColor: "#172033" };
  }
  if (scene === "rain") {
    return { frontColor: "#ffffff", backgroundColor: "#223447" };
  }
  if (scene === "snow") {
    return { frontColor: "#ffffff", backgroundColor: "#dfe9f4" };
  }
  if (scene === "fog") {
    return { frontColor: "#ffffff", backgroundColor: "#d8e0e7" };
  }
  if (scene === "overcast") {
    return { frontColor: "#ffffff", backgroundColor: "#4c6176" };
  }
  return { frontColor: "#ffffff", backgroundColor: "#d8ebff" };
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

function findCalendarSlot(snapshot = null, dateKey = "", timeKey = "") {
  const days = Array.isArray(snapshot?.days) ? snapshot.days : [];
  const day = days.find((item) => item?.dateKey === dateKey);
  if (!day) {
    return { day: null, slot: null };
  }
  const slot = Array.isArray(day.rows) ? day.rows.find((item) => item?.timeKey === timeKey) || null : null;
  return { day, slot };
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

function buildWindCards(slot = null) {
  const list = Array.isArray(slot?.windLevels) ? slot.windLevels : [];
  return list
    .slice()
    .sort((left = {}, right = {}) => Number(right.heightMeters || 0) - Number(left.heightMeters || 0))
    .map((item = {}) => ({
      key: item.key,
      title: item.label || "",
      heightLabel: item.heightLabel || "",
      speedDisplay: item.speedDisplay || "--",
      directionDisplay: item.directionDisplay || "--",
      degreeText: item.directionDegreeText || "--",
      rotation: Number.isFinite(Number(item.rotation)) ? Number(item.rotation) : 0,
      iconPath: resolveWindLayerIconPath(item.key)
    }));
}

function buildSummaryCards(slot = null) {
  if (!slot) {
    return [];
  }
  return [
    { key: "visibility", label: "能见度", value: slot.visibilityDisplay || "暂无" },
    { key: "cloud-base", label: "云底高度", value: slot.cloudBaseDisplay || "暂无" },
    { key: "cloud-cover", label: "云量", value: slot.cloudCoverDisplay || "暂无" }
  ];
}

function loadCachedWindDetailSlot() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
    return null;
  }
  try {
    const slot = wx.getStorageSync(WEATHER_WIND_SLOT_STORAGE_KEY);
    return slot && typeof slot === "object" ? slot : null;
  } catch (err) {
    return null;
  }
}

function clearCachedWindDetailSlot() {
  if (typeof wx === "undefined" || typeof wx.removeStorageSync !== "function") {
    return;
  }
  try {
    wx.removeStorageSync(WEATHER_WIND_SLOT_STORAGE_KEY);
  } catch (err) {
    // ignore storage failure
  }
}

Page({
  data: {
    satellite: false,
    coordinateSystem: "wgs84",
    center: null,
    centerAddressText: "位置解析中",
    centerText: "地图中心点",
    dateKey: "",
    timeKey: "",
    pageReady: false,
    loading: true,
    error: "",
    weatherScene: "clear",
    slotDateLabel: "",
    slotWeekdayLabel: "",
    slotTimeLabel: "",
    slotWeatherLabel: "",
    slotWeatherIconPath: "",
    summaryCards: [],
    windCards: []
  },

  onLoad(options = {}) {
    const center = parseCenter(options);
    const coordinateSystem = parseCoordinateSystem(options);
    const satellite = `${options.satellite || ""}` === "1";
    const dateKey = decodeOptionText(options.dateKey);
    const timeKey = decodeOptionText(options.timeKey);
    this.setData({
      center,
      coordinateSystem,
      satellite,
      dateKey,
      timeKey,
      centerAddressText: center ? "位置解析中" : "",
      centerText: formatCenterText(center, coordinateSystem)
    });
    this.applyNavigationTheme("clear");
    this.loadCenterAddress(center);
    const cached = loadWeatherCalendarSnapshot();
    if (cached && (!center || snapshotMatches(cached, center, WEATHER_SNAPSHOT_MATCH_METERS))) {
      this.applySlotFromSnapshot(cached);
    }
    this.refreshSlot();
  },

  loadCenterAddress(center = null) {
    if (!hasValidCoordinate(center || {})) {
      this.setData({ centerAddressText: "" });
      return Promise.resolve("");
    }
    const token = `${Date.now()}-${Math.random()}`;
    this._centerAddressToken = token;
    this.setData({ centerAddressText: "位置解析中" });
    return resolveCenterAddress(center)
      .then((address) => {
        if (this._centerAddressToken !== token) {
          return "";
        }
        this.setData({ centerAddressText: address || "地图中心点" });
        return address;
      })
      .catch(() => {
        if (this._centerAddressToken !== token) {
          return "";
        }
        this.setData({ centerAddressText: "地图中心点" });
        return "";
      });
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

  applySlotFromSnapshot(snapshot = null) {
    const { day, slot } = findCalendarSlot(snapshot, this.data.dateKey, this.data.timeKey);
    if (!slot) {
      return false;
    }
    const weatherScene = resolveWeatherScene(slot);
    this.setData({
      pageReady: true,
      loading: false,
      error: "",
      weatherScene,
      slotDateLabel: day?.dateLabel || "",
      slotWeekdayLabel: day?.weekdayLabel || "",
      slotTimeLabel: slot.timeKey || "",
      slotWeatherLabel: slot.weatherLabel || "",
      slotWeatherIconPath: resolveWeatherIconPath(slot.iconName, DETAIL_ICON_LIGHT_THEME),
      summaryCards: buildSummaryCards(slot),
      windCards: buildWindCards(slot)
    });
    this.applyNavigationTheme(weatherScene);
    return true;
  },

  applyFallbackSlot(slot = null) {
    if (!slot) {
      return false;
    }
    const weatherScene = resolveWeatherScene(slot);
    this.setData({
      pageReady: true,
      loading: false,
      error: "",
      weatherScene,
      slotDateLabel: `${this.data.dateKey.slice(5, 7) || "--"}/${this.data.dateKey.slice(8, 10) || "--"}`,
      slotWeekdayLabel: "",
      slotTimeLabel: this.data.timeKey || "",
      slotWeatherLabel: slot.weatherLabel || "",
      slotWeatherIconPath: resolveWeatherIconPath(slot.iconName, DETAIL_ICON_LIGHT_THEME),
      summaryCards: buildSummaryCards(slot),
      windCards: buildWindCards(slot)
    });
    this.applyNavigationTheme(weatherScene);
    return true;
  },

  refreshSlot() {
    if (!hasValidCoordinate(this.data.center || {}) || !this.data.dateKey || !this.data.timeKey) {
      this.setData({
        pageReady: true,
        loading: false,
        error: "风速预告暂不可用"
      });
      return Promise.resolve(null);
    }
    this.setData({ loading: true, error: "" });
    return fetchWeatherCalendarBundle(this.data.center)
      .then((snapshot) => {
        saveWeatherCalendarSnapshot(snapshot);
        if (this.applySlotFromSnapshot(snapshot)) {
          clearCachedWindDetailSlot();
          return snapshot;
        }
        const cachedSlot = loadCachedWindDetailSlot();
        if (this.applyFallbackSlot(cachedSlot)) {
          return snapshot;
        }
        this.setData({
          pageReady: true,
          loading: false,
          error: "风速预告暂不可用，请稍后再试"
        });
        return null;
      })
      .catch((err) => {
        console.warn("wind detail refresh failed", err);
        const cachedSlot = loadCachedWindDetailSlot();
        if (this.applyFallbackSlot(cachedSlot)) {
          return cachedSlot;
        }
        this.setData({
          pageReady: true,
          loading: false,
          error: "风速预告暂不可用，请稍后再试"
        });
        return null;
      });
  }
});
