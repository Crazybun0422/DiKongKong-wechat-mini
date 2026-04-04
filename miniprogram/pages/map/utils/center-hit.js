const { haversineMeters } = require("../../../utils/coords");
const { isMapTapTargetMarker } = require("../../../utils/map-target-link");

const cloneMarkerDetail = (detail = {}) => {
  if (!detail || typeof detail !== "object") {
    return {};
  }
  const cloneArray = (value) => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item) => (item && typeof item === "object" ? { ...item } : item));
  };
  const cloned = { ...detail };
  cloned.images = cloneArray(detail.images);
  cloned.honors = Array.isArray(detail.honors) ? [...detail.honors] : [];
  cloned.attachments = cloneArray(detail.attachments);
  cloned.qrCodes = cloneArray(detail.qrCodes);
  cloned.videoAccounts = cloneArray(detail.videoAccounts);
  if (detail.primaryVideoAccount && typeof detail.primaryVideoAccount === "object") {
    cloned.primaryVideoAccount = { ...detail.primaryVideoAccount };
  } else if (!detail.primaryVideoAccount) {
    cloned.primaryVideoAccount = null;
  }
  return cloned;
};

const hasValidCoordinate = (latitude, longitude) => {
  const lat = Number(latitude);
  const lng = Number(longitude);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
};

function findPinContainingPoint(page, point = {}) {
  if (!point || !hasValidCoordinate(point.latitude, point.longitude)) return null;
  const pins = Array.isArray(page._nearbyPinsRaw) ? page._nearbyPinsRaw : [];
  for (const raw of pins) {
    const pin = page.normalizeNearbyPin(raw);
    if (!pin) continue;
    if (pinContainsPoint(page, pin, point)) return pin;
  }
  return null;
}

function openMarkerOrPinAtCenter(page) {
  const center = page._centerOverride || page.data.center;
  if (!center || !hasValidCoordinate(center.latitude, center.longitude)) return false;
  const pin = page.isPinLayerEnabled() ? findPinContainingPoint(page, center) : null;
  if (pin) {
    return openPinDetail(page, pin);
  }
  const marker = findClosestMarkerFromCenter(page, center);
  if (!marker) return false;
  page.openMarkerDetail(marker);
  return true;
}

function openPinDetail(page, pin) {
  if (!pin) return false;
  const detail = page.buildPinDetailFromPin(pin);
  if (!detail) return false;
  const marker = {
    id: detail.id || `pin-${Date.now()}`,
    latitude: detail.latitude,
    longitude: detail.longitude,
    extData: {
      source: "pin",
      raw: pin,
      detail: cloneMarkerDetail(detail)
    }
  };
  page.openMarkerDetail(marker);
  return true;
}

function findClosestMarkerFromCenter(page, point = {}, maxDistanceMeters = 35) {
  if (!point || !hasValidCoordinate(point.latitude, point.longitude)) return null;
  const targetLat = Number(point.latitude);
  const targetLng = Number(point.longitude);
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) return null;

  const candidates = Array.isArray(page.data.markers) ? page.data.markers : [];
  let target = null;
  let minDistance = Infinity;

  for (const marker of candidates) {
    if (!marker) continue;
    const lat = Number(marker.latitude);
    const lng = Number(marker.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const src = `${marker?.extData?.source || marker?.source || ""}`.toLowerCase();
    if (src === "my-location-map") continue;
    if (isMapTapTargetMarker(marker)) continue;
    if (src.includes("pin")) {
      const shapeType = `${marker?.extData?.raw?.shape?.type || marker?.shape?.type || ""}`.toUpperCase();
      if (shapeType && shapeType !== "POINT") continue;
    } else if (!page.resolveMarkerDetail(marker)) {
      continue;
    }

    const distance = haversineMeters(targetLat, targetLng, lat, lng);
    if (!Number.isFinite(distance) || distance > maxDistanceMeters) continue;
    if (distance < minDistance) {
      minDistance = distance;
      target = marker;
    }
  }
  return target;
}

function pinContainsPoint(page, pin = {}, point = {}) {
  if (!pin || !pin.shape || !Array.isArray(pin.shape.coordinates)) return false;
  const type = `${pin.shape.type || ""}`.toUpperCase();
  const coords = pin.shape.coordinates;
  if (!coords.length) return false;
  const targetLat = Number(point.latitude);
  const targetLng = Number(point.longitude);
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) return false;
  if (type === "POINT") {
    const dist = haversineMeters(targetLat, targetLng, coords[0].latitude, coords[0].longitude);
    return Number.isFinite(dist) && dist <= 30;
  }
  if (type === "CIRCLE") {
    const center = coords[0];
    const radiusKm = Number(pin.shape.radius);
    const radiusMeters = Number.isFinite(radiusKm) ? radiusKm * 1000 : 0;
    const dist = haversineMeters(targetLat, targetLng, center.latitude, center.longitude);
    const threshold = radiusMeters > 0 ? radiusMeters : 30;
    return Number.isFinite(dist) && dist <= threshold;
  }
  if (type === "LINE" || type === "PATH") {
    const widthMeters = Number(pin.shape.width);
    const allowed = Number.isFinite(widthMeters) && widthMeters > 0 ? widthMeters : 30;
    const distance = distanceToPolylineMeters(point, coords);
    return Number.isFinite(distance) && distance <= allowed;
  }
  const ring = coords.map((c) => [c.longitude, c.latitude]);
  return page.ringContains(ring, targetLng, targetLat);
}

function distanceToPolylineMeters(point, coords = []) {
  if (!Array.isArray(coords) || coords.length === 0) return Infinity;
  const lat0 = Number(point.latitude);
  const lng0 = Number(point.longitude);
  if (!Number.isFinite(lat0) || !Number.isFinite(lng0)) return Infinity;
  const factors = distanceFactors(lat0);
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const a = coords[i];
    const b = coords[i + 1];
    const d = distancePointToSegmentMeters(lat0, lng0, a, b, factors);
    if (d < min) min = d;
  }
  return min;
}

function distanceFactors(lat) {
  const kLat = 111320;
  const kLng = kLat * Math.max(Math.cos((Number(lat) * Math.PI) / 180), 0.0001);
  return { kLat, kLng };
}

function distancePointToSegmentMeters(lat, lng, a = {}, b = {}, factors = null) {
  const { kLat, kLng } = factors || distanceFactors(lat);
  const ax = (Number(a.longitude) - lng) * kLng;
  const ay = (Number(a.latitude) - lat) * kLat;
  const bx = (Number(b.longitude) - lng) * kLng;
  const by = (Number(b.latitude) - lat) * kLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt(ax * ax + ay * ay);
  let t = -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx;
  const py = ay + t * dy;
  return Math.sqrt(px * px + py * py);
}

module.exports = {
  findPinContainingPoint,
  openMarkerOrPinAtCenter,
  openPinDetail,
  findClosestMarkerFromCenter,
  pinContainsPoint,
  distanceToPolylineMeters,
  distancePointToSegmentMeters
};
