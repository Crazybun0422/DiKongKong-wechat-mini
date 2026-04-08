const {
  WEATHER_FEATURE_ENABLED,
  WEATHER_SNAPSHOT_MATCH_METERS,
  hasValidCoordinate,
  fetchWeatherBundle,
  loadWeatherSnapshot,
  resolveWeatherIconPath,
  saveWeatherSnapshot,
  snapshotMatches
} = require("../../../utils/weather");

function parseCenter(options = {}) {
  const latitude = Number(options.latitude);
  const longitude = Number(options.longitude);
  if (!hasValidCoordinate({ latitude, longitude })) {
    return null;
  }
  return { latitude, longitude };
}

function formatCenterText(center = null) {
  if (!center) {
    return "地图中心点";
  }
  return `${Number(center.longitude).toFixed(6)}, ${Number(center.latitude).toFixed(6)}`;
}

Page({
  data: {
    featureEnabled: WEATHER_FEATURE_ENABLED === true,
    satellite: false,
    center: null,
    centerText: "地图中心点",
    loading: true,
    error: "",
    sourceLabel: "Open-Meteo",
    updatedAtText: "",
    windIconPath: "",
    currentWeather: null,
    weatherCards: [],
    currentMetricCards: [],
    cloudBaseSupported: true
  },

  onLoad(options = {}) {
    const satellite = `${options.satellite || ""}` === "1";
    const center = parseCenter(options);
    const featureEnabled = WEATHER_FEATURE_ENABLED === true;
    this.applyNavigationTheme(satellite);
    this.setData({
      featureEnabled,
      satellite,
      center,
      centerText: formatCenterText(center),
      windIconPath: resolveWeatherIconPath("wind-speed", satellite)
    });
    if (!featureEnabled) {
      this.setData({
        loading: false,
        error: "",
        sourceLabel: "",
        updatedAtText: "",
        currentWeather: null,
        weatherCards: [],
        currentMetricCards: [],
        cloudBaseSupported: false
      });
      return;
    }
    const cached = loadWeatherSnapshot();
    if (cached && (!center || snapshotMatches(cached, center, WEATHER_SNAPSHOT_MATCH_METERS))) {
      this.applyWeatherSnapshot(cached);
    }
    this.refreshWeather({ stopPullDownRefresh: false });
  },

  onPullDownRefresh() {
    if (this.data.featureEnabled !== true) {
      if (typeof wx !== "undefined" && typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
      return;
    }
    this.refreshWeather({ stopPullDownRefresh: true });
  },

  applyNavigationTheme(satellite = false) {
    if (typeof wx === "undefined" || typeof wx.setNavigationBarColor !== "function") {
      return;
    }
    wx.setNavigationBarColor({
      frontColor: satellite ? "#ffffff" : "#000000",
      backgroundColor: satellite ? "#0f172a" : "#f5f5f7",
      animation: { duration: 0, timingFunc: "linear" }
    });
  },

  buildMetricCards(current = null) {
    if (!current) {
      return [];
    }
    return [
      {
        key: "wind",
        label: "风速",
        value: current.windSpeedDisplay,
        iconPath: this.data.windIconPath
      },
      {
        key: "visibility",
        label: "能见度",
        value: current.visibilityDisplay,
        iconPath: ""
      },
      {
        key: "cloud-base",
        label: "云底高度",
        value: current.cloudBaseDisplay,
        iconPath: ""
      }
    ];
  },

  applyWeatherSnapshot(snapshot = null) {
    const satellite = this.data.satellite;
    const cards = Array.isArray(snapshot?.items)
      ? snapshot.items.map((item) =>
        Object.assign({}, item, {
          iconPath: resolveWeatherIconPath(item.iconName, satellite)
        })
      )
      : [];
    const current = snapshot?.current
      ? Object.assign({}, snapshot.current, {
        iconPath: resolveWeatherIconPath(snapshot.current.iconName, satellite)
      })
      : null;
    this.setData({
      loading: false,
      error: "",
      sourceLabel: snapshot?.sourceLabel || "Open-Meteo",
      updatedAtText: snapshot?.updatedAtText || "",
      centerText: snapshot?.coordinateText || formatCenterText(this.data.center),
      weatherCards: cards,
      currentWeather: current,
      currentMetricCards: this.buildMetricCards(current),
      cloudBaseSupported: snapshot?.cloudBaseSupported !== false
    });
  },

  refreshWeather(options = {}) {
    const center = this.data.center;
    if (!hasValidCoordinate(center || {})) {
      this.setData({
        loading: false,
        error: "地图中心点不可用，暂时无法获取气象数据"
      });
      if (options.stopPullDownRefresh && typeof wx !== "undefined" && typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
      return Promise.resolve(null);
    }
    if (!this.data.currentWeather) {
      this.setData({ loading: true, error: "" });
    } else {
      this.setData({ error: "" });
    }
    return fetchWeatherBundle(center)
      .then((snapshot) => {
        saveWeatherSnapshot(snapshot);
        this.applyWeatherSnapshot(snapshot);
        return snapshot;
      })
      .catch((err) => {
        console.warn("weather detail refresh failed", err);
        this.setData({
          loading: false,
          error: "气象数据暂不可用，请下拉重试"
        });
        return null;
      })
      .finally(() => {
        if (options.stopPullDownRefresh && typeof wx !== "undefined" && typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh();
        }
      });
  },

  onRetryTap() {
    this.refreshWeather({ stopPullDownRefresh: false });
  }
});
