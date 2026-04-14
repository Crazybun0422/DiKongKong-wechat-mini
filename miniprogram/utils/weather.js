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
const AIR_QUALITY_API_BASE = "https://air-quality-api.open-meteo.com/v1";
const CLOUD_BASE_LOW_COVER_THRESHOLD = 15;
const WEATHER_CALENDAR_PAST_DAYS = 1;
const WEATHER_CALENDAR_DAYS = 15;
const WEATHER_CALENDAR_SLOT_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const AIR_QUALITY_FORECAST_DAYS = 7;

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
    "precipitation_probability",
    "precipitation",
    "rain",
    "showers",
    "snowfall",
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
    "precipitation_probability",
    "precipitation",
    "rain",
    "showers",
    "snowfall",
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
    "precipitation_probability",
    "precipitation",
    "rain",
    "showers",
    "snowfall",
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
  dailyFields: ["sunrise", "sunset"],
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
    "precipitation_probability",
    "precipitation",
    "visibility",
    "temperature_2m",
    "dew_point_2m",
    "cloud_cover",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high"
  ]
};

const AIR_QUALITY_ENDPOINT = {
  path: "air-quality",
  hourlyFields: ["aerosol_optical_depth"]
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
    daily: CALENDAR_ENDPOINT.dailyFields.join(","),
    hourly: CALENDAR_ENDPOINT.hourlyFields.join(","),
    start_date: startDate,
    end_date: endDate,
    timezone: "Asia/Shanghai",
    wind_speed_unit: "ms"
  });
  return `${baseUrl}/${CALENDAR_ENDPOINT.path}?${query}`;
}

function buildAirQualityEndpointUrl(centerWgs84 = {}) {
  const query = buildQuery({
    latitude: formatQueryNumber(centerWgs84.latitude),
    longitude: formatQueryNumber(centerWgs84.longitude),
    hourly: AIR_QUALITY_ENDPOINT.hourlyFields.join(","),
    past_days: WEATHER_CALENDAR_PAST_DAYS,
    forecast_days: AIR_QUALITY_FORECAST_DAYS,
    timezone: "Asia/Shanghai"
  });
  return `${AIR_QUALITY_API_BASE}/${AIR_QUALITY_ENDPOINT.path}?${query}`;
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

function formatClockTextWithSeconds(value = "") {
  if (typeof value === "string" && value.length >= 16) {
    return `${value.slice(11, 16)}:00`;
  }
  return "--:--:--";
}

function formatTimeMsToClockWithSeconds(timeMs = null) {
  if (!Number.isFinite(timeMs)) {
    return "--:--:--";
  }
  const date = new Date(timeMs);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.min(max, Math.max(min, numeric));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function triangularFactor(value, min, peak, max) {
  const numeric = normalizeNumber(value);
  if (numeric === null || max <= min || peak < min || peak > max) {
    return null;
  }
  if (numeric <= min || numeric >= max) {
    return 0;
  }
  if (numeric === peak) {
    return 1;
  }
  if (numeric < peak) {
    return clamp01((numeric - min) / Math.max(peak - min, 0.0001));
  }
  return clamp01((max - numeric) / Math.max(max - peak, 0.0001));
}

function formatRelativeDurationWithSeconds(diffMs = 0) {
  const totalSeconds = Math.max(0, Math.ceil(Number(diffMs) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours > 0) {
    parts.push(`${hours}小时`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}分`);
  }
  parts.push(`${seconds}秒`);
  return parts.join("");
}

function buildGlowWindowDisplay(timeValue = "", offsetMinutes = 11) {
  const centerMs = parseTimeMs(timeValue);
  if (!Number.isFinite(centerMs)) {
    return "--:--:-- - --:--:--";
  }
  const deltaMs = Number(offsetMinutes) * 60 * 1000;
  return `${formatTimeMsToClockWithSeconds(centerMs - deltaMs)} - ${formatTimeMsToClockWithSeconds(centerMs + deltaMs)}`;
}

function resolveGlowStatusText(kind = "sunrise", timeValue = "", referenceTimeMs = Date.now(), offsetMinutes = 11) {
  const centerMs = parseTimeMs(timeValue);
  const deltaMs = Number(offsetMinutes) * 60 * 1000;
  if (!Number.isFinite(centerMs)) {
    return "暂无";
  }
  const startMs = centerMs - deltaMs;
  const endMs = centerMs + deltaMs;
  if (referenceTimeMs < startMs) {
    return `距开始 ${formatRelativeDurationWithSeconds(startMs - referenceTimeMs)}`;
  }
  if (referenceTimeMs <= endMs) {
    return `进行中 ${formatRelativeDurationWithSeconds(endMs - referenceTimeMs)}`;
  }
  return kind === "sunrise" ? "已日出" : "已日落";
}

function resolveDailyValue(payload = {}, dateKey = "", field = "") {
  const timeList = Array.isArray(payload?.daily?.time) ? payload.daily.time : [];
  const valueList = Array.isArray(payload?.daily?.[field]) ? payload.daily[field] : [];
  if (!timeList.length || !valueList.length) {
    return "";
  }
  const index = timeList.findIndex((item) => `${item || ""}` === `${dateKey || ""}`);
  if (index < 0 || index >= valueList.length) {
    return "";
  }
  const value = valueList[index];
  return typeof value === "string" && value ? value : "";
}

function resolveCalendarDailyMetric(primaryPayload, secondaryPayload, dateKey = "", field = "") {
  return (
    resolveDailyValue(primaryPayload, dateKey, field) ||
    resolveDailyValue(secondaryPayload, dateKey, field) ||
    ""
  );
}

function formatRelativeDuration(diffMs = 0) {
  const totalMinutes = Math.max(0, Math.ceil(Number(diffMs) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days > 0) {
    parts.push(`${days}天`);
  }
  if (hours > 0) {
    parts.push(`${hours}小时`);
  }
  if (parts.length < 2 && (minutes > 0 || parts.length === 0)) {
    parts.push(`${minutes}分钟`);
  }
  return parts.slice(0, 2).join("");
}

function buildSolarEventInfo(kind = "sunrise", timeValue = "", referenceTimeMs = Date.now()) {
  const parsedMs = parseTimeMs(timeValue);
  const isSunrise = kind === "sunrise";
  if (!Number.isFinite(parsedMs)) {
    return {
      timeValue: "",
      timeDisplay: "--:--",
      statusText: "暂无"
    };
  }
  if (referenceTimeMs >= parsedMs) {
    return {
      timeValue,
      timeDisplay: formatClockText(timeValue),
      statusText: isSunrise ? "已日出" : "已日落"
    };
  }
  return {
    timeValue,
    timeDisplay: formatClockText(timeValue),
    statusText: `${isSunrise ? "距日出 " : "距日落 "}${formatRelativeDuration(parsedMs - referenceTimeMs)}`
  };
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

function resolveWindForceLevel(value) {
  const numeric = normalizeNumber(value);
  if (numeric === null || numeric < 0) {
    return null;
  }
  const thresholds = [
    0.2, 1.5, 3.3, 5.4, 7.9, 10.7, 13.8, 17.1, 20.7,
    24.4, 28.4, 32.6, 36.9, 41.4, 46.1, 50.9, 56.0, 61.2
  ];
  for (let i = 0; i < thresholds.length; i += 1) {
    if (numeric <= thresholds[i]) {
      return i;
    }
  }
  return 18;
}

function formatWindForceLevel(value) {
  const level = resolveWindForceLevel(value);
  if (level === null) {
    return "--";
  }
  return `${level}\u7ea7`;
}

function formatWindSpeedWithLevel(value) {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return "\u6682\u65e0";
  }
  return `${numeric.toFixed(1)}m/s ${formatWindForceLevel(numeric)}`;
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

function interpolateHourlyMetric(payload = {}, field = "", targetMs = null) {
  const timeList = Array.isArray(payload?.hourly?.time) ? payload.hourly.time : [];
  const valueList = Array.isArray(payload?.hourly?.[field]) ? payload.hourly[field] : [];
  if (!timeList.length || !valueList.length || !Number.isFinite(targetMs)) {
    return null;
  }
  let prevIndex = -1;
  let nextIndex = -1;
  for (let i = 0; i < timeList.length; i += 1) {
    const currentMs = parseTimeMs(timeList[i]);
    if (!Number.isFinite(currentMs)) {
      continue;
    }
    if (currentMs === targetMs) {
      return normalizeNumber(valueList[i]);
    }
    if (currentMs < targetMs) {
      prevIndex = i;
      continue;
    }
    nextIndex = i;
    break;
  }
  const prevValue = prevIndex >= 0 ? normalizeNumber(valueList[prevIndex]) : null;
  const nextValue = nextIndex >= 0 ? normalizeNumber(valueList[nextIndex]) : null;
  const prevMs = prevIndex >= 0 ? parseTimeMs(timeList[prevIndex]) : null;
  const nextMs = nextIndex >= 0 ? parseTimeMs(timeList[nextIndex]) : null;
  if (prevValue !== null && nextValue !== null && Number.isFinite(prevMs) && Number.isFinite(nextMs) && nextMs > prevMs) {
    const progress = (targetMs - prevMs) / (nextMs - prevMs);
    return prevValue + (nextValue - prevValue) * progress;
  }
  if (prevValue !== null) {
    return prevValue;
  }
  if (nextValue !== null) {
    return nextValue;
  }
  return null;
}

function resolveInterpolatedCalendarMetric(primaryPayload, secondaryPayload, targetMs, field) {
  return firstFiniteValue([
    interpolateHourlyMetric(primaryPayload, field, targetMs),
    interpolateHourlyMetric(secondaryPayload, field, targetMs)
  ]);
}

function resolveNearestDiscreteHourlyMetric(payload = {}, field = "", targetMs = null) {
  const timeList = Array.isArray(payload?.hourly?.time) ? payload.hourly.time : [];
  const valueList = Array.isArray(payload?.hourly?.[field]) ? payload.hourly[field] : [];
  if (!timeList.length || !valueList.length || !Number.isFinite(targetMs)) {
    return null;
  }
  const index = findNearestHourIndex(timeList, targetMs, 0);
  return normalizeNumber(valueList[index]);
}

function resolveNearestCalendarMetric(primaryPayload, secondaryPayload, targetMs, field) {
  return firstFiniteValue([
    resolveNearestDiscreteHourlyMetric(primaryPayload, field, targetMs),
    resolveNearestDiscreteHourlyMetric(secondaryPayload, field, targetMs)
  ]);
}

function formatAod(value) {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return "--";
  }
  return numeric.toFixed(2);
}

function resolveFireCloudLevel(score = null) {
  const numeric = normalizeNumber(score);
  if (numeric === null || numeric < 20) {
    return "无";
  }
  if (numeric < 45) {
    return "轻微";
  }
  if (numeric < 70) {
    return "明显";
  }
  return "浓烈";
}

function resolveGlowWeatherPenalty(weatherCode = null) {
  const code = normalizeNumber(weatherCode);
  if (code === null) {
    return 1;
  }
  if ([0, 1, 2].includes(code)) {
    return 1;
  }
  if (code === 3) {
    return 0.82;
  }
  if (code === 45 || code === 48) {
    return 0.55;
  }
  if (code >= 95) {
    return 0.22;
  }
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return 0.34;
  }
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return 0.3;
  }
  return 0.72;
}

function buildFireCloudScore(input = {}) {
  const visibilityKm = normalizeNumber(input.visibilityMeters) === null ? null : Number(input.visibilityMeters) / 1000;
  const components = [
    { factor: triangularFactor(input.aod, 0.06, 0.55, 1.4), weight: 0.34 },
    { factor: triangularFactor(input.highCloudCover, 6, 38, 86), weight: 0.26 },
    { factor: triangularFactor(input.midCloudCover, 0, 20, 58), weight: 0.12 },
    { factor: normalizeNumber(input.lowCloudCover) === null ? null : (1 - clamp01(Number(input.lowCloudCover) / 80)), weight: 0.18 },
    { factor: visibilityKm === null ? null : clamp01((visibilityKm - 5) / 18), weight: 0.10 }
  ];
  let total = 0;
  let weightSum = 0;
  components.forEach((item) => {
    if (item.factor === null || !Number.isFinite(item.factor)) {
      return;
    }
    total += item.factor * item.weight;
    weightSum += item.weight;
  });
  if (weightSum <= 0) {
    return { score: null, level: "无" };
  }
  const weatherPenalty = resolveGlowWeatherPenalty(input.weatherCode);
  const score = Math.round(clamp01(total / weightSum) * 100 * weatherPenalty);
  return {
    score,
    level: resolveFireCloudLevel(score)
  };
}

function isGlowWeatherEligibleAdvanced(weatherCode = null) {
  const code = normalizeNumber(weatherCode);
  if (code === null) {
    return false;
  }
  return [0, 1, 2, 3].includes(code);
}

function resolveGlowWeatherPenaltyAdvanced(weatherCode = null) {
  const code = normalizeNumber(weatherCode);
  if (code === null) return 0.52;
  if (code === 0) return 1;
  if (code === 1) return 0.96;
  if (code === 2) return 0.88;
  if (code === 3) return 0.68;
  if (code === 45 || code === 48) return 0.08;
  if (code >= 95) return 0.04;
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 0.05;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 0.04;
  return 0.2;
}

function resolveFireCloudTierAdvanced(score = null, eligible = true) {
  const numeric = normalizeNumber(score);
  if (!eligible || numeric === null || numeric < 10) {
    return { label: "无效", stars: 0, display: "无效" };
  }
  if (numeric < 20) return { label: "微微烧", stars: 1, display: "微微烧 1星" };
  if (numeric < 34) return { label: "微烧", stars: 2, display: "微烧 2星" };
  if (numeric < 50) return { label: "小烧", stars: 3, display: "小烧 3星" };
  if (numeric < 66) return { label: "中烧", stars: 4, display: "中烧 4星" };
  if (numeric < 80) return { label: "大烧", stars: 5, display: "大烧 5星" };
  if (numeric < 92) return { label: "史诗级", stars: 6, display: "史诗级 6星" };
  return { label: "世纪晚霞", stars: 7, display: "世纪晚霞 7星" };
}

function buildFireCloudStarItems(score = null) {
  const numeric = normalizeNumber(score);
  const starValue = numeric === null
    ? 0
    : clamp(Math.round(clamp01(numeric / 100) * 14) / 2, 0, 7);
  return Array.from({ length: 7 }, (_, index) => {
    const offset = index + 1;
    let fill = 0;
    if (starValue >= offset) {
      fill = 1;
    } else if (starValue >= offset - 0.5) {
      fill = 0.5;
    }
    return {
      key: `star-${index}`,
      fill
    };
  });
}

function buildLayerStructureFactorAdvanced(highCloudCover, midCloudCover, lowCloudCover) {
  const high = normalizeNumber(highCloudCover);
  const mid = normalizeNumber(midCloudCover);
  const low = normalizeNumber(lowCloudCover);
  if (high === null && mid === null && low === null) {
    return null;
  }
  const highValue = high === null ? 0 : high;
  const midValue = mid === null ? 0 : mid;
  const lowValue = low === null ? 0 : low;
  const upperBias = clamp01((highValue - lowValue + 30) / 90);
  const midBias = clamp01((midValue - lowValue + 24) / 72);
  return clamp01(upperBias * 0.68 + midBias * 0.32);
}

function buildCloudBaseFactorAdvanced(cloudBaseMeters = null) {
  return triangularFactor(cloudBaseMeters, 800, 2400, 5200);
}

function buildDewSpreadFactorAdvanced(temperature2m = null, dewPoint2m = null) {
  const temperature = normalizeNumber(temperature2m);
  const dewPoint = normalizeNumber(dewPoint2m);
  if (temperature === null || dewPoint === null) {
    return null;
  }
  return triangularFactor(temperature - dewPoint, 1.5, 6.5, 15);
}

function buildPrecipitationPenaltyFactorAdvanced(probability = null, amount = null) {
  const probabilityValue = normalizeNumber(probability);
  const amountValue = normalizeNumber(amount);
  const probabilityFactor = probabilityValue === null ? null : (1 - clamp01(probabilityValue / 22));
  const amountFactor = amountValue === null ? null : (1 - clamp01(amountValue / 0.35));
  if (probabilityFactor === null && amountFactor === null) {
    return null;
  }
  if (probabilityFactor === null) return amountFactor;
  if (amountFactor === null) return probabilityFactor;
  return clamp01(probabilityFactor * 0.6 + amountFactor * 0.4);
}

function buildFireCloudScoreAdvanced(input = {}) {
  const visibilityKm = normalizeNumber(input.visibilityMeters) === null ? null : Number(input.visibilityMeters) / 1000;
  const eligible = isGlowWeatherEligibleAdvanced(input.weatherCode);
  const components = [
    { factor: triangularFactor(input.aod, 0.08, 0.34, 0.92), weight: 0.16 },
    { factor: triangularFactor(input.highCloudCover, 10, 30, 64), weight: 0.24 },
    { factor: triangularFactor(input.midCloudCover, 0, 16, 42), weight: 0.10 },
    { factor: normalizeNumber(input.lowCloudCover) === null ? null : (1 - clamp01(Number(input.lowCloudCover) / 58)), weight: 0.18 },
    { factor: visibilityKm === null ? null : clamp01((visibilityKm - 8) / 16), weight: 0.07 },
    { factor: buildPrecipitationPenaltyFactorAdvanced(input.precipitationProbability, input.precipitation), weight: 0.08 },
    { factor: buildCloudBaseFactorAdvanced(input.cloudBaseMeters), weight: 0.07 },
    { factor: buildDewSpreadFactorAdvanced(input.temperature2m, input.dewPoint2m), weight: 0.04 },
    { factor: buildLayerStructureFactorAdvanced(input.highCloudCover, input.midCloudCover, input.lowCloudCover), weight: 0.06 }
  ];
  let total = 0;
  let weightSum = 0;
  components.forEach((item) => {
    if (item.factor === null || !Number.isFinite(item.factor)) {
      return;
    }
    total += item.factor * item.weight;
    weightSum += item.weight;
  });
  if (weightSum <= 0) {
    return { score: null, level: "无效", stars: 0, display: "--", eligible: false };
  }
  const weatherPenalty = resolveGlowWeatherPenaltyAdvanced(input.weatherCode);
  const normalizedScore = clamp01(total / weightSum);
  const compressedScore = Math.pow(normalizedScore, 1.75);
  const score = Math.round(compressedScore * 100 * weatherPenalty);
  const tier = resolveFireCloudTierAdvanced(score, eligible);
  return {
    score,
    level: tier.label,
    stars: tier.stars,
    display: `${score}% ${tier.label}`,
    eligible
  };
}

function buildGlowEventInfo(kind = "sunrise", timeValue = "", primaryPayload = null, secondaryPayload = null, airQualityPayload = null, referenceTimeMs = Date.now()) {
  const targetMs = parseTimeMs(timeValue);
  const aod = interpolateHourlyMetric(airQualityPayload, "aerosol_optical_depth", targetMs);
  const visibility = resolveInterpolatedCalendarMetric(primaryPayload, secondaryPayload, targetMs, "visibility");
  const lowCloudCover = resolveInterpolatedCalendarMetric(primaryPayload, secondaryPayload, targetMs, "cloud_cover_low");
  const midCloudCover = resolveInterpolatedCalendarMetric(primaryPayload, secondaryPayload, targetMs, "cloud_cover_mid");
  const highCloudCover = resolveInterpolatedCalendarMetric(primaryPayload, secondaryPayload, targetMs, "cloud_cover_high");
  const weatherCode = resolveNearestCalendarMetric(primaryPayload, secondaryPayload, targetMs, "weather_code");
  const precipitationProbability = resolveInterpolatedCalendarMetric(primaryPayload, secondaryPayload, targetMs, "precipitation_probability");
  const precipitation = resolveInterpolatedCalendarMetric(primaryPayload, secondaryPayload, targetMs, "precipitation");
  const temperature2m = resolveInterpolatedCalendarMetric(primaryPayload, secondaryPayload, targetMs, "temperature_2m");
  const dewPoint2m = resolveInterpolatedCalendarMetric(primaryPayload, secondaryPayload, targetMs, "dew_point_2m");
  const cloudBaseMeters = estimateCloudBaseAtTime(primaryPayload, secondaryPayload, timeValue);
  const fireCloud = buildFireCloudScoreAdvanced({
    aod,
    visibilityMeters: visibility,
    lowCloudCover,
    midCloudCover,
    highCloudCover,
    weatherCode,
    precipitationProbability,
    precipitation,
    temperature2m,
    dewPoint2m,
    cloudBaseMeters
  });
  return {
    kind,
    label: kind === "sunrise" ? "朝霞" : "晚霞",
    eventTime: timeValue,
    eventTimeDisplay: formatClockTextWithSeconds(timeValue),
    windowDisplay: buildGlowWindowDisplay(timeValue, 11),
    statusText: resolveGlowStatusText(kind, timeValue, referenceTimeMs, 11),
    aodValue: aod,
    aodDisplay: formatAod(aod),
    fireCloudScore: fireCloud.score,
    fireCloudLevel: fireCloud.level,
    fireCloudStars: fireCloud.stars,
    fireCloudStarItems: buildFireCloudStarItems(fireCloud.score),
    fireCloudEligible: fireCloud.eligible,
    fireCloudDisplay: fireCloud.display || "--"
  };
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
    speedDisplay: formatWindSpeedWithLevel(speed),
    windForceLevel: resolveWindForceLevel(speed),
    windForceLevelText: formatWindForceLevel(speed),
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
    speedDisplay: formatWindSpeedWithLevel(speed),
    windForceLevel: resolveWindForceLevel(speed),
    windForceLevelText: formatWindForceLevel(speed),
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
  const meta =
    weatherCode === 95 || weatherCode === 96 || weatherCode === 99
      ? { label: "强对流", iconName: "strong-convective" }
      : resolveWeatherMeta(weatherCode);
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
    windSpeedDisplay: formatWindSpeedWithLevel(windSpeed),
    windForceLevel: resolveWindForceLevel(windSpeed),
    windForceLevelText: formatWindForceLevel(windSpeed),
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
  const weatherMeta =
    weatherCode === 95 || weatherCode === 96 || weatherCode === 99
      ? { label: "强对流", iconName: "strong-convective" }
      : resolveWeatherMeta(weatherCode);
  const windLevels = WIND_LEVELS.map((level) =>
    buildTimedWindLayer(primaryPayload, secondaryPayload, timeValue, level)
  );
  const surfaceWind = windLevels[0] || {};
  const windSpeed = normalizeNumber(surfaceWind.speedValue);
  const windDirection = resolveWindDirectionMeta(surfaceWind.directionValue);
  const precipitationProbability = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, "precipitation_probability");
  const precipitation = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, "precipitation");
  const rain = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, "rain");
  const showers = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, "showers");
  const snowfall = resolveCalendarMetric(primaryPayload, secondaryPayload, timeValue, "snowfall");
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
    windSpeedDisplay: formatWindSpeedWithLevel(windSpeed),
    windForceLevel: resolveWindForceLevel(windSpeed),
    windForceLevelText: formatWindForceLevel(windSpeed),
    windDirectionValue: windDirection.value,
    windDirectionLabel: windDirection.directionLabel,
    windDirectionDegreeText: windDirection.degreeText,
    windDirectionDisplay: windDirection.value === null ? "暂无" : `${windDirection.directionLabel} ${windDirection.degreeText}`,
    precipitationProbabilityValue: precipitationProbability,
    precipitationValue: precipitation,
    rainValue: rain,
    showersValue: showers,
    snowfallValue: snowfall,
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

function buildCalendarSnapshot(forecastPayload, historyPayload, airQualityPayload = null, centerGcj = {}, centerWgs84 = {}) {
  const now = new Date();
  const nowMs = now.getTime();
  const todayKey = buildDateKey(now);
  const startDate = addDays(new Date(`${todayKey}T00:00:00`), -WEATHER_CALENDAR_PAST_DAYS);
  const days = [];
  for (let dayOffset = 0; dayOffset < WEATHER_CALENDAR_DAYS; dayOffset += 1) {
    const date = addDays(startDate, dayOffset);
    const dateKey = buildDateKey(date);
    const relativeDay = dayOffset - WEATHER_CALENDAR_PAST_DAYS;
    const isToday = dateKey === todayKey;
    const solarPrimaryPayload = relativeDay < 0 ? historyPayload : forecastPayload;
    const solarSecondaryPayload = relativeDay < 0 ? forecastPayload : historyPayload;
    const sunriseTime = resolveCalendarDailyMetric(solarPrimaryPayload, solarSecondaryPayload, dateKey, "sunrise");
    const sunsetTime = resolveCalendarDailyMetric(solarPrimaryPayload, solarSecondaryPayload, dateKey, "sunset");
    const sunrise = buildSolarEventInfo("sunrise", sunriseTime, nowMs);
    const sunset = buildSolarEventInfo("sunset", sunsetTime, nowMs);
    const sunriseGlow = buildGlowEventInfo("sunrise", sunriseTime, solarPrimaryPayload, solarSecondaryPayload, airQualityPayload, nowMs);
    const sunsetGlow = buildGlowEventInfo("sunset", sunsetTime, solarPrimaryPayload, solarSecondaryPayload, airQualityPayload, nowMs);
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
      sunriseTime: sunrise.timeValue,
      sunriseDisplay: sunrise.timeDisplay,
      sunriseStatusText: sunrise.statusText,
      sunsetTime: sunset.timeValue,
      sunsetDisplay: sunset.timeDisplay,
      sunsetStatusText: sunset.statusText,
      sunriseGlow,
      sunsetGlow,
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

function fetchAirQualityPayload(centerWgs84 = {}) {
  return requestJson(buildAirQualityEndpointUrl(centerWgs84));
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
    fetchCalendarHistoryPayload(centerWgs84, startDate, buildDateKey(today)),
    fetchAirQualityPayload(centerWgs84)
  ]).then((results) => {
    const forecastPayload = results[0]?.status === "fulfilled" ? results[0].value : null;
    const historyPayload = results[1]?.status === "fulfilled" ? results[1].value : null;
    const airQualityPayload = results[2]?.status === "fulfilled" ? results[2].value : null;
    if (!forecastPayload && !historyPayload) {
      throw new Error("weather-calendar-unavailable");
    }
    return buildCalendarSnapshot(forecastPayload, historyPayload, airQualityPayload, centerGcj, centerWgs84);
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
  resolveWindForceLevel,
  formatWindForceLevel,
  formatWindSpeedWithLevel,
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
