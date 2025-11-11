const { haversineMeters } = require("./coords");

const DISTANCE_KM_THRESHOLD = 1000;

const normalizePoint = (point) => {
  if (!point || typeof point !== "object") {
    return null;
  }
  const lat = Number(
    point.latitude !== undefined ? point.latitude : point.lat
  );
  const lng = Number(
    point.longitude !== undefined ? point.longitude : point.lng
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { latitude: lat, longitude: lng };
};

const computeGreatCircleDistance = (origin, target) => {
  const start = normalizePoint(origin);
  const end = normalizePoint(target);
  if (!start || !end) {
    return NaN;
  }
  return haversineMeters(start.latitude, start.longitude, end.latitude, end.longitude);
};

const formatDistanceText = (meters, options = {}) => {
  if (!Number.isFinite(meters) || meters < 0) {
    return "";
  }
  const {
    prefix = "距我",
    meterUnit = "米",
    kilometerUnit = "千米",
    threshold = DISTANCE_KM_THRESHOLD
  } = options;
  if (meters >= threshold) {
    const km = meters / 1000;
    const display = km >= 10 ? Math.round(km) : Math.round(km * 10) / 10;
    return `${prefix}${display}${kilometerUnit}`;
  }
  const rounded = Math.max(1, Math.round(meters));
  return `${prefix}${rounded}${meterUnit}`;
};

module.exports = {
  DISTANCE_KM_THRESHOLD,
  computeGreatCircleDistance,
  formatDistanceText
};
