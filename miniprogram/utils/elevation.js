const { gcj02ToWgs84, haversineMeters } = require("./coords");

const ELEVATION_API_URL = "https://api.open-meteo.com/v1/elevation";
const ELEVATION_REQUEST_TIMEOUT = 10000;
const ELEVATION_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const ELEVATION_MOVE_THRESHOLD_METERS = 250;

function hasValidCoordinate(center = {}) {
  return Number.isFinite(Number(center.latitude)) && Number.isFinite(Number(center.longitude));
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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
      timeout: ELEVATION_REQUEST_TIMEOUT,
      success: (res) => {
        const statusCode = Number(res?.statusCode) || 0;
        const payload = res?.data;
        if (statusCode >= 200 && statusCode < 300 && payload && typeof payload === "object") {
          resolve(payload);
          return;
        }
        reject(new Error(`status-${statusCode || "unknown"}`));
      },
      fail: (err) => reject(err || new Error("elevation-request-failed"))
    });
  });
}

function resolveElevationValue(payload = {}) {
  if (Array.isArray(payload?.elevation)) {
    return normalizeNumber(payload.elevation[0]);
  }
  return normalizeNumber(payload?.elevation);
}

function formatElevationValue(value) {
  const numeric = normalizeNumber(value);
  if (numeric === null) {
    return "";
  }
  return `${Math.round(numeric)} m`;
}

function convertCenterToWgs84(centerGcj = {}) {
  if (!hasValidCoordinate(centerGcj)) {
    return null;
  }
  const fallback = {
    latitude: Number(centerGcj.latitude),
    longitude: Number(centerGcj.longitude)
  };
  try {
    const converted = gcj02ToWgs84(fallback.longitude, fallback.latitude);
    const latitude = Number(converted?.lat);
    const longitude = Number(converted?.lng);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  } catch (error) {}
  return fallback;
}

function buildElevationUrl(centerWgs84 = {}) {
  const query = buildQuery({
    latitude: formatQueryNumber(centerWgs84.latitude),
    longitude: formatQueryNumber(centerWgs84.longitude)
  });
  return `${ELEVATION_API_URL}?${query}`;
}

function fetchElevationSnapshot(centerGcj = {}) {
  if (!hasValidCoordinate(centerGcj)) {
    return Promise.reject(new Error("invalid-center"));
  }
  const centerWgs84 = convertCenterToWgs84(centerGcj);
  if (!hasValidCoordinate(centerWgs84)) {
    return Promise.reject(new Error("invalid-center-wgs84"));
  }
  return requestJson(buildElevationUrl(centerWgs84)).then((payload) => {
    const elevationMeters = resolveElevationValue(payload);
    if (elevationMeters === null) {
      throw new Error("elevation-empty");
    }
    return {
      fetchedAt: Date.now(),
      center: {
        latitude: Number(centerGcj.latitude),
        longitude: Number(centerGcj.longitude)
      },
      centerWgs84: {
        latitude: Number(centerWgs84.latitude),
        longitude: Number(centerWgs84.longitude)
      },
      elevationMeters,
      valueText: formatElevationValue(elevationMeters)
    };
  });
}

function distanceBetweenCenters(centerA = {}, centerB = {}) {
  if (!hasValidCoordinate(centerA) || !hasValidCoordinate(centerB)) {
    return Number.POSITIVE_INFINITY;
  }
  return haversineMeters(
    Number(centerA.latitude),
    Number(centerA.longitude),
    Number(centerB.latitude),
    Number(centerB.longitude)
  );
}

module.exports = {
  ELEVATION_REFRESH_INTERVAL_MS,
  ELEVATION_MOVE_THRESHOLD_METERS,
  hasValidCoordinate,
  fetchElevationSnapshot,
  distanceBetweenCenters
};
