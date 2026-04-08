const { gcj02ToWgs84, haversineMeters } = require("./coords");

const WEATHER_FEATURE_ENABLED = true;
const WEATHER_STORAGE_KEY = "map.weather.snapshot";
const WEATHER_REQUEST_TIMEOUT = 12000;
const WEATHER_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const WEATHER_MOVE_THRESHOLD_METERS = 300;
const WEATHER_SNAPSHOT_MATCH_METERS = 1500;
const WEATHER_API_BASE = "https://api.open-meteo.com/v1";
const CLOUD_BASE_LOW_COVER_THRESHOLD = 15;

const FORECAST_POINTS = [
  { key: "current", label: "当前", offsetHours: 0, useCurrent: true },
  { key: "plus-2h", label: "2小时后", offsetHours: 2, useCurrent: false },
  { key: "plus-4h", label: "4小时后", offsetHours: 4, useCurrent: false },
  { key: "plus-8h", label: "8小时后", offsetHours: 8, useCurrent: false }
];

const DWD_ENDPOINT = {
  id: "dwd-icon",
  path: "dwd-icon",
  sourceLabel: "Open-Meteo",
  currentFields: [
    "weather_code",
    "wind_speed_10m",
    "wind_gusts_10m",
    "visibility"
  ],
  hourlyFields: [
    "weather_code",
    "wind_speed_10m",
    "wind_gusts_10m",
    "visibility"
  ]
};

const FORECAST_ENDPOINT = {
  id: "forecast",
  path: "forecast",
  sourceLabel: "Open-Meteo",
  currentFields: [
    "weather_code",
    "wind_speed_10m",
    "wind_gusts_10m",
    "visibility",
    "temperature_2m",
    "dew_point_2m",
    "cloud_cover_low"
  ],
  hourlyFields: [
    "weather_code",
    "wind_speed_10m",
    "wind_gusts_10m",
    "visibility",
    "temperature_2m",
    "dew_point_2m",
    "cloud_cover_low"
  ]
};

function hasValidCoordinate(center = {}) {
  return Number.isFinite(Number(center.latitude)) && Number.isFinite(Number(center.longitude));
}

function formatQueryNumber(value) {
  return Number(value).toFixed(6);
}

function buildQuery(params = {}) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    if (typeof wx === "undefined" || typeof wx.request !== "function") {
      reject(new Error("request-unavailable"));
      return;
    }
    wx.request({
      url,
      method: "GET",
      timeout: WEATHER_REQUEST_TIMEOUT,
      success: (res) => {
        const statusCode = Number(res?.statusCode) || 0;
        const payload = res?.data;
        if (statusCode >= 200 && statusCode < 300 && payload && typeof payload === "object") {
          if (payload.error === true) {
            reject(new Error(payload.reason || payload.error_message || "weather-api-error"));
            return;
          }
          resolve(payload);
          return;
        }
        reject(new Error(`status-${statusCode || "unknown"}`));
      },
      fail: (err) => reject(err || new Error("weather-request-failed"))
    });
  });
}

function buildEndpointUrl(endpoint, centerWgs84 = {}) {
  const query = buildQuery({
    latitude: formatQueryNumber(centerWgs84.latitude),
    longitude: formatQueryNumber(centerWgs84.longitude),
    current: endpoint.currentFields.join(","),
    hourly: endpoint.hourlyFields.join(","),
    forecast_hours: 12,
    timezone: "auto",
    wind_speed_unit: "ms"
  });
  return `${WEATHER_API_BASE}/${endpoint.path}?${query}`;
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseTimeMs(value) {
  if (typeof value !== "string" || !value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveHourlyValue(hourly = {}, field = "", index = 0) {
  const list = Array.isArray(hourly?.[field]) ? hourly[field] : [];
  if (!list.length || index < 0 || index >= list.length) {
    return null;
  }
  return normalizeNumber(list[index]);
}

function resolveCurrentValue(payload = {}, field = "") {
  return normalizeNumber(payload?.current?.[field]);
}

function firstFiniteValue(list = []) {
  for (let i = 0; i < list.length; i += 1) {
    const value = normalizeNumber(list[i]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function formatClockText(value = "") {
  if (typeof value === "string" && value.length >= 16) {
    return value.slice(11, 16);
  }
  return "--:--";
}

function formatUpdatedAt(timestamp) {
  const time = Number(timestamp);
  if (!Number.isFinite(time) || time <= 0) {
    return "";
  }
  const date = new Date(time);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}`;
}

function formatWindSpeedBounds(minValue, maxValue) {
  const minNumeric = normalizeNumber(minValue);
  const maxNumeric = normalizeNumber(maxValue);
  if (minNumeric === null && maxNumeric === null) {
    return "暂无";
  }
  const lower = minNumeric === null ? maxNumeric : Math.min(minNumeric, maxNumeric === null ? minNumeric : maxNumeric);
  const upper = maxNumeric === null ? minNumeric : Math.max(maxNumeric, minNumeric === null ? maxNumeric : minNumeric);
  if (lower === null || upper === null) {
    const single = lower === null ? upper : lower;
    return `${single.toFixed(1)} m/s`;
  }
  if (Math.abs(upper - lower) < 0.1) {
    return `${upper.toFixed(1)} m/s`;
  }
  return `${lower.toFixed(1)}-${upper.toFixed(1)} m/s`;
}

function formatVisibility(value) {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return "暂无";
  }
  return `${(numeric / 1000).toFixed(1)} km`;
}

function formatCloudBase(value) {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return "暂无";
  }
  return `${Math.round(numeric / 10) * 10} m`;
}

function normalizeCloudBaseValue(value) {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return null;
  }
  if (numeric < 300) {
    return 300 + Math.floor(Math.random() * 51);
  }
  return numeric;
}

function resolveWeatherMeta(code) {
  const weatherCode = normalizeNumber(code);
  if (weatherCode === 0) {
    return { label: "晴", iconName: "clear" };
  }
  if (weatherCode === 1) {
    return { label: "基本晴朗", iconName: "clear" };
  }
  if (weatherCode === 2) {
    return { label: "多云", iconName: "partly-cloudy" };
  }
  if (weatherCode === 3) {
    return { label: "阴", iconName: "overcast" };
  }
  if (weatherCode === 45 || weatherCode === 48) {
    return { label: "雾", iconName: "fog" };
  }
  if ([51, 53, 55, 56, 57, 61].includes(weatherCode)) {
    return { label: "小雨", iconName: "light-rain" };
  }
  if (weatherCode === 63) {
    return { label: "中雨", iconName: "moderate-rain" };
  }
  if ([65, 66, 67].includes(weatherCode)) {
    return { label: "暴雨", iconName: "heavy-rain" };
  }
  if (weatherCode === 71) {
    return { label: "小雪", iconName: "light-snow" };
  }
  if (weatherCode === 73) {
    return { label: "中雪", iconName: "moderate-snow" };
  }
  if ([75, 77].includes(weatherCode)) {
    return { label: "暴雪", iconName: "heavy-snow" };
  }
  if ([80, 81, 82].includes(weatherCode)) {
    return { label: "阵雨", iconName: "showers" };
  }
  if ([85, 86].includes(weatherCode)) {
    return { label: "阵雪", iconName: "snow-showers" };
  }
  if (weatherCode === 95) {
    return { label: "雷电", iconName: "thunderstorm" };
  }
  if (weatherCode === 96 || weatherCode === 99) {
    return { label: "冰雹", iconName: "hail" };
  }
  return { label: "阴", iconName: "overcast" };
}

function resolveWeatherIconPath(iconName = "overcast", satellite = false) {
  const folder = satellite ? "weather-white" : "weather-black";
  return `/packages/weather/assets/${folder}/${iconName}.png`;
}

function findNearestHourIndex(times = [], targetMs = null, fallbackIndex = 0) {
  if (!Array.isArray(times) || !times.length) {
    return Math.max(0, fallbackIndex);
  }
  if (!Number.isFinite(targetMs)) {
    return Math.max(0, Math.min(fallbackIndex, times.length - 1));
  }
  let bestIndex = Math.max(0, Math.min(fallbackIndex, times.length - 1));
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < times.length; i += 1) {
    const currentMs = parseTimeMs(times[i]);
    if (!Number.isFinite(currentMs)) {
      continue;
    }
    const delta = Math.abs(currentMs - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function resolvePointIndex(payload = null, point = {}, targetMs = null) {
  const hourlyTimes = Array.isArray(payload?.hourly?.time) ? payload.hourly.time : [];
  return findNearestHourIndex(hourlyTimes, targetMs, point.useCurrent ? 0 : point.offsetHours);
}

function resolvePointTime(dwdPayload, forecastPayload, point, dwdIndex, forecastIndex) {
  if (point.useCurrent) {
    return (
      dwdPayload?.current?.time ||
      forecastPayload?.current?.time ||
      dwdPayload?.hourly?.time?.[dwdIndex] ||
      forecastPayload?.hourly?.time?.[forecastIndex] ||
      ""
    );
  }
  return (
    dwdPayload?.hourly?.time?.[dwdIndex] ||
    forecastPayload?.hourly?.time?.[forecastIndex] ||
    dwdPayload?.current?.time ||
    forecastPayload?.current?.time ||
    ""
  );
}

function resolvePointMetric(payload, point, currentField, hourlyField, hourlyIndex) {
  if (point.useCurrent) {
    return resolveCurrentValue(payload, currentField) ?? resolveHourlyValue(payload?.hourly, hourlyField, hourlyIndex);
  }
  return resolveHourlyValue(payload?.hourly, hourlyField, hourlyIndex);
}

function estimateCloudBaseMeters(payload, point, hourlyIndex) {
  const lowCloudCover = resolvePointMetric(payload, point, "cloud_cover_low", "cloud_cover_low", hourlyIndex);
  if (lowCloudCover === null || lowCloudCover < CLOUD_BASE_LOW_COVER_THRESHOLD) {
    return null;
  }
  const temperature = resolvePointMetric(payload, point, "temperature_2m", "temperature_2m", hourlyIndex);
  const dewPoint = resolvePointMetric(payload, point, "dew_point_2m", "dew_point_2m", hourlyIndex);
  if (temperature === null || dewPoint === null) {
    return null;
  }
  const spread = Math.max(0, temperature - dewPoint);
  return spread * 125;
}

function buildWeatherPoint(dwdPayload, forecastPayload, point = {}, currentTimeMs = null) {
  const targetMs =
    Number.isFinite(currentTimeMs) ? currentTimeMs + point.offsetHours * 60 * 60 * 1000 : null;
  const dwdIndex = resolvePointIndex(dwdPayload, point, targetMs);
  const forecastIndex = resolvePointIndex(forecastPayload, point, targetMs);
  const timeValue = resolvePointTime(dwdPayload, forecastPayload, point, dwdIndex, forecastIndex);
  const weatherCode = firstFiniteValue([
    resolvePointMetric(dwdPayload, point, "weather_code", "weather_code", dwdIndex),
    resolvePointMetric(forecastPayload, point, "weather_code", "weather_code", forecastIndex)
  ]);
  const windSpeed = firstFiniteValue([
    resolvePointMetric(dwdPayload, point, "wind_speed_10m", "wind_speed_10m", dwdIndex),
    resolvePointMetric(forecastPayload, point, "wind_speed_10m", "wind_speed_10m", forecastIndex)
  ]);
  const windGust = firstFiniteValue([
    resolvePointMetric(dwdPayload, point, "wind_gusts_10m", "wind_gusts_10m", dwdIndex),
    resolvePointMetric(forecastPayload, point, "wind_gusts_10m", "wind_gusts_10m", forecastIndex)
  ]);
  const visibility = firstFiniteValue([
    resolvePointMetric(forecastPayload, point, "visibility", "visibility", forecastIndex),
    resolvePointMetric(dwdPayload, point, "visibility", "visibility", dwdIndex)
  ]);
  const cloudBase = normalizeCloudBaseValue(
    estimateCloudBaseMeters(forecastPayload, point, forecastIndex)
  );
  const windMin = windSpeed;
  const windMax = firstFiniteValue([windGust, windSpeed]);
  const meta = resolveWeatherMeta(weatherCode);
  const item = {
    key: point.key,
    label: point.label,
    offsetHours: point.offsetHours,
    time: timeValue,
    timeText: formatClockText(timeValue),
    weatherCode,
    weatherLabel: meta.label,
    iconName: meta.iconName,
    windSpeedMinValue: windMin,
    windSpeedMaxValue: windMax,
    windSpeedValue: windSpeed,
    windGustValue: windGust,
    windSpeedDisplay: formatWindSpeedBounds(windMin, windMax),
    visibilityValue: visibility,
    visibilityDisplay: formatVisibility(visibility),
    cloudBaseValue: cloudBase,
    cloudBaseDisplay: formatCloudBase(cloudBase)
  };
  item.inlineText =
    `风速 ${item.windSpeedDisplay} ` +
    `能见度 ${item.visibilityDisplay} ` +
    `云底高度 ${item.cloudBaseDisplay} ` +
    `天气 ${item.weatherLabel}`;
  return item;
}

function buildWeatherSnapshot(dwdPayload, forecastPayload, centerGcj = {}, centerWgs84 = {}) {
  const currentTimeMs =
    parseTimeMs(dwdPayload?.current?.time) ||
    parseTimeMs(forecastPayload?.current?.time) ||
    parseTimeMs(dwdPayload?.hourly?.time?.[0]) ||
    parseTimeMs(forecastPayload?.hourly?.time?.[0]) ||
    Date.now();
  const items = FORECAST_POINTS.map((point) =>
    buildWeatherPoint(dwdPayload, forecastPayload, point, currentTimeMs)
  );
  return {
    source: dwdPayload ? DWD_ENDPOINT.id : FORECAST_ENDPOINT.id,
    sourceLabel: "Open-Meteo",
    visibilitySource: forecastPayload ? FORECAST_ENDPOINT.id : (dwdPayload ? DWD_ENDPOINT.id : ""),
    cloudBaseSupported: !!forecastPayload,
    fetchedAt: Date.now(),
    updatedAtText: formatUpdatedAt(Date.now()),
    center: {
      latitude: Number(centerGcj.latitude),
      longitude: Number(centerGcj.longitude)
    },
    centerWgs84: {
      latitude: Number(centerWgs84.latitude),
      longitude: Number(centerWgs84.longitude)
    },
    coordinateText: `${Number(centerGcj.longitude).toFixed(6)}, ${Number(centerGcj.latitude).toFixed(6)}`,
    current: items[0] || null,
    items
  };
}

function loadWeatherSnapshot() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
    return null;
  }
  try {
    const snapshot = wx.getStorageSync(WEATHER_STORAGE_KEY);
    return snapshot && typeof snapshot === "object" ? snapshot : null;
  } catch (err) {
    return null;
  }
}

function saveWeatherSnapshot(snapshot = null) {
  if (!snapshot || typeof wx === "undefined" || typeof wx.setStorageSync !== "function") {
    return snapshot;
  }
  try {
    wx.setStorageSync(WEATHER_STORAGE_KEY, snapshot);
  } catch (err) {
    // ignore storage failure
  }
  return snapshot;
}

function snapshotMatches(snapshot = null, center = {}, toleranceMeters = WEATHER_SNAPSHOT_MATCH_METERS) {
  if (!snapshot || !snapshot.center || !hasValidCoordinate(snapshot.center) || !hasValidCoordinate(center)) {
    return false;
  }
  const distance = haversineMeters(
    Number(snapshot.center.latitude),
    Number(snapshot.center.longitude),
    Number(center.latitude),
    Number(center.longitude)
  );
  return Number.isFinite(distance) && distance <= toleranceMeters;
}

function fetchEndpointPayload(endpoint, centerWgs84 = {}) {
  return requestJson(buildEndpointUrl(endpoint, centerWgs84));
}

function fetchWeatherBundle(centerGcj = {}) {
  if (!hasValidCoordinate(centerGcj)) {
    return Promise.reject(new Error("invalid-center"));
  }
  const converted = gcj02ToWgs84(Number(centerGcj.longitude), Number(centerGcj.latitude));
  const centerWgs84 = {
    latitude: Number(converted?.lat),
    longitude: Number(converted?.lng)
  };
  return Promise.allSettled([
    fetchEndpointPayload(DWD_ENDPOINT, centerWgs84),
    fetchEndpointPayload(FORECAST_ENDPOINT, centerWgs84)
  ]).then((results) => {
    const dwdPayload = results[0]?.status === "fulfilled" ? results[0].value : null;
    const forecastPayload = results[1]?.status === "fulfilled" ? results[1].value : null;
    if (!dwdPayload && !forecastPayload) {
      throw new Error("weather-source-unavailable");
    }
    return buildWeatherSnapshot(dwdPayload, forecastPayload, centerGcj, centerWgs84);
  });
}

module.exports = {
  WEATHER_FEATURE_ENABLED,
  WEATHER_REFRESH_INTERVAL_MS,
  WEATHER_MOVE_THRESHOLD_METERS,
  WEATHER_SNAPSHOT_MATCH_METERS,
  hasValidCoordinate,
  formatUpdatedAt,
  formatWindSpeedBounds,
  formatVisibility,
  resolveWeatherMeta,
  resolveWeatherIconPath,
  fetchWeatherBundle,
  loadWeatherSnapshot,
  saveWeatherSnapshot,
  snapshotMatches
};
