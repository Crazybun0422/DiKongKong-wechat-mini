const { computeGreatCircleDistance } = require("./distance");

const MAP_TAP_TARGET_SOURCE = "map-tap-target";
const MAP_TAP_TARGET_MARKER_ID = "map-tap-target-marker";
const MAP_TAP_TARGET_TAP_INTERVAL_MS = 2000;
const MAP_TAP_TARGET_REMOVE_DISTANCE_METERS = 120;
const MAP_TAP_TARGET_PENDING_ADDRESS = "位置解析中...";
const SEARCH_LINK_HINT_SEARCH_CLEAR = "清除搜索框消失";

function normalizeCoordinateValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return NaN;
  return Math.round(numeric * 1000000) / 1000000;
}

function formatTargetCoordinateText(point = {}) {
  const latitude = normalizeCoordinateValue(point.latitude);
  const longitude = normalizeCoordinateValue(point.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return "";
  }
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function normalizeMapTapPoint(detail = {}) {
  const latitude = Number(
    detail?.latitude ??
    detail?.lat ??
    detail?.detail?.latitude ??
    detail?.detail?.lat
  );
  const longitude = Number(
    detail?.longitude ??
    detail?.lng ??
    detail?.detail?.longitude ??
    detail?.detail?.lng
  );
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude };
}

function canReplaceMapTapTarget(lastTapAt, now = Date.now()) {
  const previous = Number(lastTapAt) || 0;
  return !previous || now - previous >= MAP_TAP_TARGET_TAP_INTERVAL_MS;
}

function buildMapTapTargetState(point = {}, options = {}) {
  if (!point) return null;
  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return {
    latitude,
    longitude,
    coordinateText: formatTargetCoordinateText({ latitude, longitude }),
    addressText: `${options.addressText || ""}`.trim() || MAP_TAP_TARGET_PENDING_ADDRESS
  };
}

function updateMapTapTargetAddress(target = null, addressText = "") {
  if (!target) return null;
  return Object.assign({}, target, {
    addressText: `${addressText || ""}`.trim() || MAP_TAP_TARGET_PENDING_ADDRESS
  });
}

function buildMapTapTargetCalloutContent(target = null) {
  if (!target) return "";
  const lines = [
    target.coordinateText || "",
    target.addressText || ""
  ].filter(Boolean);
  return lines.join("\n");
}

function buildMapTapTargetMarker(target = null) {
  if (!target) return null;
  const latitude = Number(target.latitude);
  const longitude = Number(target.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const content = buildMapTapTargetCalloutContent(target);
  return {
    id: MAP_TAP_TARGET_MARKER_ID,
    latitude,
    longitude,
    title: target.coordinateText || "目标点",
    zIndex: 1080,
    anchor: {
      x: 0.5,
      y: 1
    },
    callout: content
      ? {
          content,
          color: "#111827",
          fontSize: 11,
          fontWeight: "normal",
          display: "ALWAYS",
          borderRadius: 6,
          padding: 6,
          bgColor: "#ffffff",
          borderColor: "#111827",
          borderWidth: 0.4,
          textAlign: "left"
        }
      : undefined,
    extData: {
      source: MAP_TAP_TARGET_SOURCE,
      target
    }
  };
}

function isMapTapTargetMarker(marker = {}) {
  const source = `${marker?.extData?.source || marker?.source || ""}`.trim().toLowerCase();
  return source === MAP_TAP_TARGET_SOURCE;
}

function shouldRemoveMapTapTarget(
  target = null,
  point = {},
  maxDistanceMeters = MAP_TAP_TARGET_REMOVE_DISTANCE_METERS
) {
  if (!target || !point) return false;
  const targetLat = Number(target.latitude);
  const targetLng = Number(target.longitude);
  const pointLat = Number(point.latitude);
  const pointLng = Number(point.longitude);
  if (
    !Number.isFinite(targetLat) ||
    !Number.isFinite(targetLng) ||
    !Number.isFinite(pointLat) ||
    !Number.isFinite(pointLng)
  ) {
    return false;
  }
  const distance = computeGreatCircleDistance(
    { latitude: targetLat, longitude: targetLng },
    { latitude: pointLat, longitude: pointLng }
  );
  return Number.isFinite(distance) && distance <= Math.max(0, Number(maxDistanceMeters) || 0);
}

module.exports = {
  MAP_TAP_TARGET_SOURCE,
  MAP_TAP_TARGET_MARKER_ID,
  MAP_TAP_TARGET_TAP_INTERVAL_MS,
  MAP_TAP_TARGET_PENDING_ADDRESS,
  SEARCH_LINK_HINT_SEARCH_CLEAR,
  normalizeMapTapPoint,
  canReplaceMapTapTarget,
  buildMapTapTargetState,
  updateMapTapTargetAddress,
  buildMapTapTargetMarker,
  isMapTapTargetMarker,
  shouldRemoveMapTapTarget
};
