const { gcj02ToWgs84, haversineMeters } = require("./coords");

const WEATHER_FEATURE_ENABLED = true;
const WEATHER_STORAGE_KEY = "map.weather.snapshot";
const WEATHER_CALENDAR_STORAGE_KEY = "map.weather.calendar.snapshot";
const WEATHER_REQUEST_TIMEOUT = 12000;
const WEATHER_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const WEATHER_MOVE_THRESHOLD_METERS = 300;
const WEATHER_SNAPSHOT_MATCH_METERS = 1500;
const WEATHER_API_BASE = "https://api.open-meteo.com/v1";
const WEATHER_HISTORY_API_BASE = "https://historical-forecast-api.open-meteo.com/v1";
const CLOUD_BASE_LOW_COVER_THRESHOLD = 15;
const WEATHER_CALENDAR_PAST_DAYS = 1;
const WEATHER_CALENDAR_DAYS = 15;
const WEATHER_CALENDAR_SLOT_HOURS = [0, 4, 8, 12, 16, 20];

const FORECAST_POINTS = [
  { key: "current", label: "当前", offsetHours: 0, useCurrent: true },
  { key: "plus-4h", label: "4小时后", offsetHours: 4, useCurrent: false },
  { key: "plus-8h", label: "8小时后", offsetHours: 8, useCurrent: false },
  { key: "plus-12h", label: "12小时后", offsetHours: 12, useCurrent: false },
  { key: "plus-24h", label: "明天", offsetHours: 24, useCurrent: false }
];

const WIND_LEVELS = [
  { key: "surface", label: "贴地", heightMeters: 10 },
  { key: "low", label: "低空", heightMeters: 80 },
  { key: "mid", label: "中空", heightMeters: 120 },
  { key: "high", label: "高空", heightMeters: 180 }
];

const DWD_ENDPOINT = {
  id: "dwd-icon",
  path: "dwd-icon",
  sourceLabel: "Open-Meteo",
  currentFields: [
    "weather_code",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_speed_80m",
    "wind_direction_80m",
    "wind_speed_120m",
    "wind_direction_120m",
    "wind_speed_180m",
    "wind_direction_180m",
    "wind_gusts_10m",
    "visibility",
    "cloud_cover",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high"
  ],
  hourlyFields: [
    "weather_code",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_speed_80m",
    "wind_direction_80m",
    "wind_speed_120m",
    "wind_direction_120m",
    "wind_speed_180m",
    "wind_direction_180m",
    "wind_gusts_10m",
    "visibility",
    "cloud_cover",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high"
  ]
};

const FORECAST_ENDPOINT = {
  id: "forecast",
  path: "forecast",
  sourceLabel: "Open-Meteo",
  currentFields: [
    "weather_code",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_speed_80m",
    "wind_direction_80m",
    "wind_speed_120m",
    "wind_direction_120m",
    "wind_speed_180m",
    "wind_direction_180m",
    "wind_gusts_10m",
    "visibility",
    "temperature_2m",
    "dew_point_2m",
    "cloud_cover",
    "cloud_cover_low"
    ,
    "cloud_cover_mid",
    "cloud_cover_high"
  ],
  hourlyFields: [
    "weather_code",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_speed_80m",
    "wind_direction_80m",
    "wind_speed_120m",
    "wind_direction_120m",
    "wind_speed_180m",
    "wind_direction_180m",
    "wind_gusts_10m",
    "visibility",
    "temperature_2m",
    "dew_point_2m",
    "cloud_cover",
    "cloud_cover_low"
    ,
    "cloud_cover_mid",
    "cloud_cover_high"
  ]
};

const CALENDAR_ENDPOINT = {
  id: "calendar-forecast",
  path: "forecast",
  hourlyFields: [
    "weather_code",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_speed_80m",
    "wind_direction_80m",
    "wind_speed_120m",
    "wind_direction_120m",
    "wind_speed_180m",
    "wind_direction_180m",
    "wind_gusts_10m",
    "visibility",
    "temperature_2m",
    "dew_point_2m",
    "cloud_cover",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high"
  ]
};

function hasValidCoordinate(center = {}) {
  return Number.isFinite(Number(center.latitude)) && Number.isFinite(Number(center.longitude));
}

function formatQueryNumber(value) {
  return Number(value).toFixed(6);
}

function pad2(value) {
  return `${value}`.padStart(2, "0");
}

function buildDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date, offsetDays = 0) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + offsetDays);
  return next;
}

function buildLocalDateFromKey(dateKey = "", hour = 0) {
  return new Date(`${dateKey}T${pad2(hour)}:00:00`);
}

function formatCalendarDateLabel(dateKey = "") {
  if (!dateKey) {
    return "--/--";
  }
  return `${dateKey.slice(5, 7)}/${dateKey.slice(8, 10)}`;
}

function formatCalendarWeekday(dateKey = "") {
  const date = buildLocalDateFromKey(dateKey, 0);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()] || "";
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
    forecast_hours: 30,
    timezone: "auto",
    wind_speed_unit: "ms"
  });
  return `${WEATHER_API_BASE}/${endpoint.path}?${query}`;
}

function buildCalendarEndpointUrl(baseUrl, centerWgs84 = {}, startDate = "", endDate = "") {
  const query = buildQuery({
    latitude: formatQueryNumber(centerWgs84.latitude),
    longitude: formatQueryNumber(centerWgs84.longitude),
    hourly: CALENDAR_ENDPOINT.hourlyFields.join(","),
    start_date: startDate,
    end_date: endDate,
    timezone: "Asia/Shanghai",
    wind_speed_unit: "ms"
  });
  return `${baseUrl}/${CALENDAR_ENDPOINT.path}?${query}`;
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

function formatWindSpeed(value) {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return "暂无";
  }
  return `${numeric.toFixed(1)} m/s`;
}

function normalizeDegrees(value) {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return null;
  }
  return ((numeric % 360) + 360) % 360;
}

function resolveWindDirectionMeta(value) {
  const degrees = normalizeDegrees(value);
  if (degrees === null) {
    return {
      value: null,
      directionLabel: "暂无",
      degreeText: "--",
      rotation: 0
    };
  }
  const labels = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"];
  const index = Math.round(degrees / 45) % labels.length;
  return {
    value: degrees,
    directionLabel: labels[index],
    degreeText: `${Math.round(degrees)}°`,
    rotation: Math.round(degrees)
  };
}

function formatVisibility(value) {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return "暂无";
  }
  return `${(numeric / 1000).toFixed(1)} km`;
}

function formatCloudCover(value) {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return "暂无";
  }
  return `${Math.round(numeric)}%`;
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
    return { label: "雷暴", iconName: "thunderstorm" };
  }
  if (weatherCode === 96 || weatherCode === 99) {
    return { label: "雷暴", iconName: "thunderstorm" };
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

function resolveHourlyIndexForTime(payload = {}, timeValue = "") {
  const list = Array.isArray(payload?.hourly?.time) ? payload.hourly.time : [];
  return list.indexOf(timeValue);
}

function resolveTimeMetric(payload = {}, timeValue = "", field = "") {
  const index = resolveHourlyIndexForTime(payload, timeValue);
  if (index < 0) {
    return null;
  }
  return resolveHourlyValue(payload?.hourly, field, index);
}

function resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, field) {
  return firstFiniteValue([
    resolveTimeMetric(primaryPayload, timeValue, field),
    resolveTimeMetric(secondaryPayload, timeValue, field)
  ]);
}

function estimateCloudBaseAtTime(primaryPayload, secondaryPayload, timeValue) {
  const lowCloudCover = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, "cloud_cover_low");
  if (lowCloudCover === null || lowCloudCover < CLOUD_BASE_LOW_COVER_THRESHOLD) {
    return null;
  }
  const temperature = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, "temperature_2m");
  const dewPoint = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, "dew_point_2m");
  if (temperature === null || dewPoint === null) {
    return null;
  }
  return Math.max(0, temperature - dewPoint) * 125;
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
  return Math.max(0, temperature - dewPoint) * 125;
}

function buildWindLayer(dwdPayload, forecastPayload, point, dwdIndex, forecastIndex, level = {}) {
  const heightMeters = Number(level.heightMeters);
  const speedField = `wind_speed_${heightMeters}m`;
  const directionField = `wind_direction_${heightMeters}m`;
  const speed = firstFiniteValue([
    resolvePointMetric(dwdPayload, point, speedField, speedField, dwdIndex),
    resolvePointMetric(forecastPayload, point, speedField, speedField, forecastIndex)
  ]);
  const direction = firstFiniteValue([
    resolvePointMetric(dwdPayload, point, directionField, directionField, dwdIndex),
    resolvePointMetric(forecastPayload, point, directionField, directionField, forecastIndex)
  ]);
  const meta = resolveWindDirectionMeta(direction);
  return {
    key: level.key || `${heightMeters}m`,
    label: level.label || `${heightMeters}m`,
    heightMeters,
    heightLabel: `${heightMeters}m`,
    speedValue: speed,
    speedDisplay: formatWindSpeed(speed),
    directionValue: meta.value,
    directionLabel: meta.directionLabel,
    directionDegreeText: meta.degreeText,
    directionDisplay: meta.value === null ? "暂无" : `${meta.directionLabel} ${meta.degreeText}`,
    rotation: meta.rotation,
    hasDirection: Number.isFinite(meta.value)
  };
}

function buildTimedWindLayer(primaryPayload, secondaryPayload, timeValue, level = {}) {
  const heightMeters = Number(level.heightMeters);
  const speedField = `wind_speed_${heightMeters}m`;
  const directionField = `wind_direction_${heightMeters}m`;
  const speed = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, speedField);
  const direction = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, directionField);
  const meta = resolveWindDirectionMeta(direction);
  return {
    key: level.key || `${heightMeters}m`,
    label: level.label || `${heightMeters}m`,
    heightMeters,
    heightLabel: `${heightMeters}m`,
    speedValue: speed,
    speedDisplay: formatWindSpeed(speed),
    directionValue: meta.value,
    directionLabel: meta.directionLabel,
    directionDegreeText: meta.degreeText,
    directionDisplay: meta.value === null ? "暂无" : `${meta.directionLabel} ${meta.degreeText}`,
    rotation: meta.rotation,
    hasDirection: Number.isFinite(meta.value)
  };
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
  const windLevels = WIND_LEVELS.map((level) =>
    buildWindLayer(dwdPayload, forecastPayload, point, dwdIndex, forecastIndex, level)
  );
  const surfaceWind = windLevels[0] || {};
  const windSpeed = normalizeNumber(surfaceWind.speedValue);
  const windGust = firstFiniteValue([
    resolvePointMetric(dwdPayload, point, "wind_gusts_10m", "wind_gusts_10m", dwdIndex),
    resolvePointMetric(forecastPayload, point, "wind_gusts_10m", "wind_gusts_10m", forecastIndex)
  ]);
  const windDirection = normalizeNumber(surfaceWind.directionValue);
  const visibility = firstFiniteValue([
    resolvePointMetric(forecastPayload, point, "visibility", "visibility", forecastIndex),
    resolvePointMetric(dwdPayload, point, "visibility", "visibility", dwdIndex)
  ]);
  const cloudCover = firstFiniteValue([
    resolvePointMetric(forecastPayload, point, "cloud_cover", "cloud_cover", forecastIndex),
    resolvePointMetric(dwdPayload, point, "cloud_cover", "cloud_cover", dwdIndex)
  ]);
  const cloudCoverLow = firstFiniteValue([
    resolvePointMetric(forecastPayload, point, "cloud_cover_low", "cloud_cover_low", forecastIndex),
    resolvePointMetric(dwdPayload, point, "cloud_cover_low", "cloud_cover_low", dwdIndex)
  ]);
  const cloudCoverMid = firstFiniteValue([
    resolvePointMetric(forecastPayload, point, "cloud_cover_mid", "cloud_cover_mid", forecastIndex),
    resolvePointMetric(dwdPayload, point, "cloud_cover_mid", "cloud_cover_mid", dwdIndex)
  ]);
  const cloudCoverHigh = firstFiniteValue([
    resolvePointMetric(forecastPayload, point, "cloud_cover_high", "cloud_cover_high", forecastIndex),
    resolvePointMetric(dwdPayload, point, "cloud_cover_high", "cloud_cover_high", dwdIndex)
  ]);
  const cloudBase = normalizeCloudBaseValue(
    estimateCloudBaseMeters(forecastPayload, point, forecastIndex)
  );
  const meta = resolveWeatherMeta(weatherCode);
  const windDirectionMeta = resolveWindDirectionMeta(windDirection);
  const item = {
    key: point.key,
    label: point.label,
    offsetHours: point.offsetHours,
    time: timeValue,
    timeText: formatClockText(timeValue),
    weatherCode,
    weatherLabel: meta.label,
    iconName: meta.iconName,
    windSpeedMinValue: windSpeed,
    windSpeedMaxValue: firstFiniteValue([windGust, windSpeed]),
    windSpeedValue: windSpeed,
    windLevels,
    windDirectionValue: windDirectionMeta.value,
    windDirectionLabel: windDirectionMeta.directionLabel,
    windDirectionDegreeText: windDirectionMeta.degreeText,
    windDirectionRotation: windDirectionMeta.rotation,
    windGustValue: windGust,
    windSpeedDisplay: formatWindSpeedBounds(windSpeed, firstFiniteValue([windGust, windSpeed])),
    visibilityValue: visibility,
    visibilityDisplay: formatVisibility(visibility),
    cloudCoverValue: cloudCover,
    cloudCoverDisplay: formatCloudCover(cloudCover),
    cloudCoverLowValue: cloudCoverLow,
    cloudCoverLowDisplay: formatCloudCover(cloudCoverLow),
    cloudCoverMidValue: cloudCoverMid,
    cloudCoverMidDisplay: formatCloudCover(cloudCoverMid),
    cloudCoverHighValue: cloudCoverHigh,
    cloudCoverHighDisplay: formatCloudCover(cloudCoverHigh),
    cloudBaseValue: cloudBase,
    cloudBaseDisplay: formatCloudBase(cloudBase)
  };
  item.inlineText =
    `风向 ${item.windDirectionLabel} ${item.windDirectionDegreeText} ` +
    `风速 ${item.windSpeedDisplay} ` +
    `能见度 ${item.visibilityDisplay} ` +
    `云量 ${item.cloudCoverDisplay} ` +
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

function buildCalendarSlot(primaryPayload, secondaryPayload, dateKey, hour, sourceTag = "forecast") {
  const timeValue = `${dateKey}T${pad2(hour)}:00`;
  const weatherCode = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, "weather_code");
  const weatherMeta = resolveWeatherMeta(weatherCode);
  const windLevels = WIND_LEVELS.map((level) =>
    buildTimedWindLayer(primaryPayload, secondaryPayload, timeValue, level)
  );
  const surfaceWind = windLevels[0] || {};
  const windSpeed = normalizeNumber(surfaceWind.speedValue);
  const windDirection = resolveWindDirectionMeta(surfaceWind.directionValue);
  const visibility = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, "visibility");
  const cloudCover = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, "cloud_cover");
  const cloudCoverLow = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, "cloud_cover_low");
  const cloudCoverMid = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, "cloud_cover_mid");
  const cloudCoverHigh = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, "cloud_cover_high");
  const cloudBase = normalizeCloudBaseValue(
    estimateCloudBaseAtTime(primaryPayload, secondaryPayload, timeValue)
  );
  return {
    key: `${dateKey}-${pad2(hour)}`,
    dateKey,
    time: timeValue,
    timeKey: `${pad2(hour)}:00`,
    hour,
    sourceTag,
    weatherCode,
    weatherLabel: weatherMeta.label,
    iconName: weatherMeta.iconName,
    windLevels,
    windSpeedValue: windSpeed,
    windSpeedDisplay: formatWindSpeed(windSpeed),
    windDirectionValue: windDirection.value,
    windDirectionLabel: windDirection.directionLabel,
    windDirectionDegreeText: windDirection.degreeText,
    windDirectionDisplay: windDirection.value === null ? "暂无" : `${windDirection.directionLabel} ${windDirection.degreeText}`,
    visibilityValue: visibility,
    visibilityDisplay: formatVisibility(visibility),
    cloudBaseValue: cloudBase,
    cloudBaseDisplay: formatCloudBase(cloudBase),
    cloudCoverValue: cloudCover,
    cloudCoverDisplay: formatCloudCover(cloudCover),
    cloudCoverLowValue: cloudCoverLow,
    cloudCoverLowDisplay: formatCloudCover(cloudCoverLow),
    cloudCoverMidValue: cloudCoverMid,
    cloudCoverMidDisplay: formatCloudCover(cloudCoverMid),
    cloudCoverHighValue: cloudCoverHigh,
    cloudCoverHighDisplay: formatCloudCover(cloudCoverHigh)
  };
}

function buildCalendarSnapshot(forecastPayload, historyPayload, centerGcj = {}, centerWgs84 = {}) {
  const now = new Date();
  const todayKey = buildDateKey(now);
  const startDate = addDays(new Date(`${todayKey}T00:00:00`), -WEATHER_CALENDAR_PAST_DAYS);
  const days = [];
  for (let dayOffset = 0; dayOffset < WEATHER_CALENDAR_DAYS; dayOffset += 1) {
    const date = addDays(startDate, dayOffset);
    const dateKey = buildDateKey(date);
    const relativeDay = dayOffset - WEATHER_CALENDAR_PAST_DAYS;
    const isToday = dateKey === todayKey;
    const rows = WEATHER_CALENDAR_SLOT_HOURS.map((hour) => {
      const slotDate = buildLocalDateFromKey(dateKey, hour);
      const useHistory =
        relativeDay < 0 ||
        (
          isToday &&
          Number.isFinite(slotDate.getTime()) &&
          slotDate.getTime() <= now.getTime()
        );
      return buildCalendarSlot(
        useHistory ? historyPayload : forecastPayload,
        useHistory ? forecastPayload : historyPayload,
        dateKey,
        hour,
        useHistory ? "history" : "forecast"
      );
    });
    days.push({
      key: dateKey,
      dateKey,
      relativeDay,
      dateLabel: formatCalendarDateLabel(dateKey),
      weekdayLabel: formatCalendarWeekday(dateKey),
      isToday,
      rows
    });
  }
  return {
    source: CALENDAR_ENDPOINT.id,
    sourceLabel: "Open-Meteo",
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
    days
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

function loadWeatherCalendarSnapshot() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
    return null;
  }
  try {
    const snapshot = wx.getStorageSync(WEATHER_CALENDAR_STORAGE_KEY);
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

function saveWeatherCalendarSnapshot(snapshot = null) {
  if (!snapshot || typeof wx === "undefined" || typeof wx.setStorageSync !== "function") {
    return snapshot;
  }
  try {
    wx.setStorageSync(WEATHER_CALENDAR_STORAGE_KEY, snapshot);
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

function fetchCalendarForecastPayload(centerWgs84 = {}, startDate = "", endDate = "") {
  return requestJson(buildCalendarEndpointUrl(WEATHER_API_BASE, centerWgs84, startDate, endDate));
}

function fetchCalendarHistoryPayload(centerWgs84 = {}, startDate = "", endDate = "") {
  return requestJson(buildCalendarEndpointUrl(WEATHER_HISTORY_API_BASE, centerWgs84, startDate, endDate || startDate));
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

function fetchWeatherCalendarBundle(centerGcj = {}) {
  if (!hasValidCoordinate(centerGcj)) {
    return Promise.reject(new Error("invalid-center"));
  }
  const converted = gcj02ToWgs84(Number(centerGcj.longitude), Number(centerGcj.latitude));
  const centerWgs84 = {
    latitude: Number(converted?.lat),
    longitude: Number(converted?.lng)
  };
  const today = new Date();
  const startDate = buildDateKey(addDays(today, -WEATHER_CALENDAR_PAST_DAYS));
  const endDate = buildDateKey(addDays(today, WEATHER_CALENDAR_DAYS - WEATHER_CALENDAR_PAST_DAYS - 1));
  return Promise.allSettled([
    fetchCalendarForecastPayload(centerWgs84, startDate, endDate),
    fetchCalendarHistoryPayload(centerWgs84, startDate, buildDateKey(today))
  ]).then((results) => {
    const forecastPayload = results[0]?.status === "fulfilled" ? results[0].value : null;
    const historyPayload = results[1]?.status === "fulfilled" ? results[1].value : null;
    if (!forecastPayload && !historyPayload) {
      throw new Error("weather-calendar-unavailable");
    }
    return buildCalendarSnapshot(forecastPayload, historyPayload, centerGcj, centerWgs84);
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
  formatWindSpeed,
  formatVisibility,
  formatCloudCover,
  resolveWeatherMeta,
  resolveWeatherIconPath,
  fetchWeatherBundle,
  fetchWeatherCalendarBundle,
  loadWeatherSnapshot,
  loadWeatherCalendarSnapshot,
  saveWeatherSnapshot,
  saveWeatherCalendarSnapshot,
  snapshotMatches
};
