const { resolveApiBase } = require("./profile");

const DEFAULT_COLOR = "#DE4329";
const FILL_OPACITY = 0.3;
const STROKE_OPACITY = 0.95;
const STROKE_WIDTH = 1;

function normalizeUnixSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (Math.abs(numeric) >= 1e12) {
    return Math.floor(numeric / 1000);
  }
  return Math.floor(numeric);
}

function isPeriodEffective(period = {}, currentSeconds = null) {
  const nowSeconds = normalizeUnixSeconds(currentSeconds ?? Date.now());
  if (!Number.isFinite(nowSeconds)) return true;
  const from = normalizeUnixSeconds(period?.effectiveFrom);
  const to = normalizeUnixSeconds(period?.effectiveTo);
  if (from === null && to === null) return true;
  if (from !== null && nowSeconds < from) return false;
  if (to !== null && nowSeconds > to) return false;
  return true;
}

function isNoFlyZoneEffective(zone = {}, currentSeconds = null) {
  const periods = Array.isArray(zone?.effectivePeriods) ? zone.effectivePeriods : [];
  const hasLegacyPeriod =
    normalizeUnixSeconds(zone?.effectiveFrom) !== null ||
    normalizeUnixSeconds(zone?.effectiveTo) !== null;
  if (!periods.length && !hasLegacyPeriod) {
    return true;
  }
  if (periods.some((period) => isPeriodEffective(period, currentSeconds))) {
    return true;
  }
  if (hasLegacyPeriod && isPeriodEffective(zone, currentSeconds)) {
    return true;
  }
  return false;
}

function isPeriodExpired(period = {}, currentSeconds = null) {
  const nowSeconds = normalizeUnixSeconds(currentSeconds ?? Date.now());
  if (!Number.isFinite(nowSeconds)) return false;
  const to = normalizeUnixSeconds(period?.effectiveTo);
  if (to === null) return false;
  return nowSeconds > to;
}

function isNoFlyZoneExpired(zone = {}, currentSeconds = null) {
  if (isNoFlyZoneEffective(zone, currentSeconds)) {
    return false;
  }
  const periods = Array.isArray(zone?.effectivePeriods) ? zone.effectivePeriods : [];
  const hasLegacyPeriod =
    normalizeUnixSeconds(zone?.effectiveFrom) !== null ||
    normalizeUnixSeconds(zone?.effectiveTo) !== null;
  if (!periods.length && !hasLegacyPeriod) {
    return false;
  }
  if (periods.length) {
    return periods.every((period) => isPeriodExpired(period, currentSeconds));
  }
  return isPeriodExpired(zone, currentSeconds);
}

function filterUnexpiredNoFlyZones(zones = [], currentSeconds = null) {
  if (!Array.isArray(zones)) return [];
  return zones.filter((zone) => !isNoFlyZoneExpired(zone, currentSeconds));
}

function filterEffectiveNoFlyZones(zones = [], currentSeconds = null) {
  if (!Array.isArray(zones)) return [];
  return zones.filter((zone) => isNoFlyZoneEffective(zone, currentSeconds));
}

function normalizeHex(hex) {
  if (!hex) return DEFAULT_COLOR;
  return hex.startsWith("#") ? hex : `#${hex}`;
}

function clampColorOpacity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function toAlphaHex(opacity) {
  const v = Math.round(clampColorOpacity(opacity) * 255);
  return v.toString(16).padStart(2, "0").toUpperCase();
}

function colorWithAlpha(hex, opacity) {
  return `${normalizeHex(hex)}${toAlphaHex(opacity)}`;
}

function extractCoordinate(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    if (raw.length < 2) return null;
    const lng = Number(raw[0]);
    const lat = Number(raw[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return { lng, lat };
  }
  const lat = Number(raw.latitude ?? raw.lat);
  const lng = Number(raw.longitude ?? raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lng, lat };
}

function ensureClosedRing(ring) {
  if (!Array.isArray(ring) || !ring.length) return [];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return ring.slice();
  const same =
    Math.abs(Number(first[0]) - Number(last[0])) <= 1e-8 &&
    Math.abs(Number(first[1]) - Number(last[1])) <= 1e-8;
  if (same) return ring.slice();
  return [...ring, [first[0], first[1]]];
}

function buildPolygonRings(rawCoordinates) {
  if (!Array.isArray(rawCoordinates)) return [];
  const buildSingleRing = (points) => {
    if (!Array.isArray(points)) return null;
    const ring = points
      .map((pt) => extractCoordinate(pt))
      .filter((pt) => pt && Number.isFinite(pt.lng) && Number.isFinite(pt.lat))
      .map((pt) => [pt.lng, pt.lat]);
    if (ring.length < 3) return null;
    return ensureClosedRing(ring);
  };

  if (rawCoordinates.length && Array.isArray(rawCoordinates[0])) {
    return rawCoordinates
      .map((entry) => buildSingleRing(entry))
      .filter((ring) => Array.isArray(ring) && ring.length >= 4);
  }

  const single = buildSingleRing(rawCoordinates);
  return single ? [single] : [];
}

function buildPathRing(rawCoordinates, widthMeters) {
  const edgeDistance = Number(widthMeters);
  if (!Array.isArray(rawCoordinates) || rawCoordinates.length < 2) return null;
  if (!Number.isFinite(edgeDistance) || edgeDistance <= 0) return null;
  const points = rawCoordinates
    .map((pt) => extractCoordinate(pt))
    .filter((pt) => pt && Number.isFinite(pt.lng) && Number.isFinite(pt.lat));
  if (points.length < 2) return null;

  const baseLat = points[0].lat;
  const baseLng = points[0].lng;
  const kLat = 111320;
  const kLng = kLat * Math.max(Math.cos((baseLat * Math.PI) / 180), 0.0001);
  const project = (pt) => ({
    x: (pt.lng - baseLng) * kLng,
    y: (pt.lat - baseLat) * kLat
  });
  const unproject = (pt) => ({
    lng: pt.x / kLng + baseLng,
    lat: pt.y / kLat + baseLat
  });
  const projected = points.map(project);
  const segmentNormals = [];
  for (let i = 0; i < projected.length - 1; i += 1) {
    const start = projected[i];
    const end = projected[i + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!len) {
      segmentNormals.push({ x: 0, y: 0 });
      continue;
    }
    segmentNormals.push({ x: -dy / len, y: dx / len });
  }
  const normals = projected.map((point, index) => {
    if (!segmentNormals.length) return { x: 0, y: 0 };
    if (index === 0) return segmentNormals[0];
    if (index === projected.length - 1) return segmentNormals[segmentNormals.length - 1];
    const prev = segmentNormals[index - 1] || { x: 0, y: 0 };
    const next = segmentNormals[index] || { x: 0, y: 0 };
    const nx = prev.x + next.x;
    const ny = prev.y + next.y;
    const len = Math.sqrt(nx * nx + ny * ny) || 1;
    return { x: nx / len, y: ny / len };
  });
  const left = [];
  const right = [];
  for (let i = 0; i < projected.length; i += 1) {
    const normal = normals[i] || { x: 0, y: 0 };
    const offsetX = normal.x * edgeDistance;
    const offsetY = normal.y * edgeDistance;
    left.push({ x: projected[i].x + offsetX, y: projected[i].y + offsetY });
    right.push({ x: projected[i].x - offsetX, y: projected[i].y - offsetY });
  }
  const polygon = left.concat(right.reverse()).map(unproject).map((pt) => [pt.lng, pt.lat]);
  if (polygon.length < 3) return null;
  return ensureClosedRing(polygon);
}

function toGcjPoint(lng, lat) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function expandNoFlyZoneAreas(zones = []) {
  if (!Array.isArray(zones)) return [];
  const areas = [];
  zones.forEach((zone) => {
    if (!zone || typeof zone !== "object") return;
    areas.push(zone);
    const extra = Array.isArray(zone.extra) ? zone.extra : [];
    extra.forEach((item, index) => {
      if (!item || typeof item !== "object") return;
      areas.push(Object.assign({}, zone, item, {
        id: `${zone.id || zone.name || "zone"}-extra-${index + 1}`,
        extra: []
      }));
    });
  });
  return areas;
}

function buildNoFlyZoneGraphics(zones = [], options = {}) {
  const polygons = [];
  const circles = [];
  const polylines = [];
  const shapes = [];
  if (!Array.isArray(zones)) {
    return { polygons, circles, polylines, shapes };
  }
  const areaList = expandNoFlyZoneAreas(zones);
  const baseColor = normalizeHex(options.color || DEFAULT_COLOR);
  const fillOpacity = Object.prototype.hasOwnProperty.call(options, "fillOpacity")
    ? clampColorOpacity(options.fillOpacity)
    : FILL_OPACITY;
  const strokeOpacity = Object.prototype.hasOwnProperty.call(options, "strokeOpacity")
    ? clampColorOpacity(options.strokeOpacity)
    : STROKE_OPACITY;
  const strokeWidth = Number.isFinite(options.strokeWidth) ? options.strokeWidth : STROKE_WIDTH;

  areaList.forEach((zone) => {
    const type = String(zone?.type || "").toUpperCase();
    if (type === "CIRCLE" && zone?.circle) {
      const center = extractCoordinate(zone.circle);
      const radius = Number(zone.circle.radiusMeters ?? zone.circle.radius ?? 0);
      if (center && Number.isFinite(radius) && radius > 0) {
        const gcj = toGcjPoint(center.lng, center.lat);
        if (gcj) {
          circles.push({
            longitude: gcj.longitude,
            latitude: gcj.latitude,
            radius,
            color: colorWithAlpha(baseColor, strokeOpacity),
            fillColor: colorWithAlpha(baseColor, fillOpacity),
            strokeWidth
          });
          shapes.push({
            type: "circle",
            center,
            radius,
            zone
          });
        }
      }
      return;
    }

    if (type === "PATH") {
      const ring = buildPathRing(zone?.coordinates, zone?.pathDistanceMeters);
      const pathPoints = Array.isArray(zone?.coordinates)
        ? zone.coordinates.map((pt) => extractCoordinate(pt)).filter(Boolean)
        : [];
      const gcjPolylinePoints = pathPoints
        .map((pt) => toGcjPoint(pt.lng, pt.lat))
        .filter(Boolean);
      if (gcjPolylinePoints.length >= 2) {
        polylines.push({
          points: gcjPolylinePoints,
          color: colorWithAlpha(baseColor, strokeOpacity),
          width: Math.max(3, strokeWidth * 2),
          dottedLine: false,
          arrowLine: false
        });
      }
      if (ring && ring.length >= 3) {
        const gcjPoints = ring
          .map((pt) => toGcjPoint(pt[0], pt[1]))
          .filter(Boolean);
        if (gcjPoints.length >= 3) {
          polygons.push({
            points: gcjPoints,
            strokeColor: colorWithAlpha(baseColor, 0),
            fillColor: colorWithAlpha(baseColor, Math.min(Math.max(fillOpacity * 0.45, 0.08), 0.16)),
            strokeWidth: 0
          });
        }
        shapes.push({
          type: "polygon",
          rings: [ring],
          zone
        });
      }
      return;
    }

    const rings = buildPolygonRings(zone?.coordinates);
    if (rings.length) {
      rings.forEach((ring) => {
        const gcjPoints = ring
          .map((pt) => toGcjPoint(pt[0], pt[1]))
          .filter(Boolean);
        if (gcjPoints.length >= 3) {
          polygons.push({
            points: gcjPoints,
            strokeColor: colorWithAlpha(baseColor, strokeOpacity),
            fillColor: colorWithAlpha(baseColor, fillOpacity),
            strokeWidth
          });
        }
      });
      shapes.push({
        type: "polygon",
        rings,
        zone
      });
    }
  });

  return { polygons, circles, polylines, shapes };
}

function requestNoFlyZoneApi(path, options = {}) {
  const base = resolveApiBase(options.apiBase);
  if (!base) {
    return Promise.reject(new Error("missing-api-base"));
  }
  const url = `${base}${path}`;
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: "GET",
      header: { "content-type": "application/json" },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data?.data);
          return;
        }
        const reason = res.data?.message || res.errMsg || `status-${res.statusCode}`;
        reject(new Error(typeof reason === "string" ? reason : JSON.stringify(reason)));
      },
      fail: (err) => reject(err)
    });
  });
}

function fetchTemporaryNoFlyZonesPage(params = {}, options = {}) {
  const page = Math.max(0, Number(params.page) || 0);
  const size = Math.max(1, Number(params.size) || 20);
  const sortOrder = `${params.sortOrder || "DESC"}`.trim().toUpperCase() === "ASC" ? "ASC" : "DESC";
  const query = [
    `page=${encodeURIComponent(page)}`,
    `size=${encodeURIComponent(size)}`,
    `sortOrder=${encodeURIComponent(sortOrder)}`
  ];
  return requestNoFlyZoneApi(`/api/no-fly-zones/temporary?${query.join("&")}`, options)
    .then((data) => (data && typeof data === "object" ? data : { content: [] }));
}

function searchTemporaryNoFlyZones(keyword = "", options = {}) {
  const text = `${keyword || ""}`.trim();
  if (!text) return Promise.resolve([]);
  return requestNoFlyZoneApi(
    `/api/no-fly-zones/temporary/search?keyword=${encodeURIComponent(text)}`,
    options
  ).then((data) => (Array.isArray(data) ? data : []));
}

function collectZoneCoordinates(zone = {}) {
  const type = String(zone?.type || "").toUpperCase();
  if (type === "CIRCLE" && zone?.circle) {
    const center = extractCoordinate(zone.circle);
    return center ? [center] : [];
  }
  if (type === "PATH") {
    const ring = buildPathRing(zone?.coordinates, zone?.pathDistanceMeters);
    if (Array.isArray(ring) && ring.length) {
      return ring
        .map((point) => ({ lng: Number(point[0]), lat: Number(point[1]) }))
        .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat));
    }
  }
  const rings = buildPolygonRings(zone?.coordinates);
  if (!rings.length) return [];
  return rings
    .flat()
    .map((point) => ({ lng: Number(point[0]), lat: Number(point[1]) }))
    .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat));
}

function computeNoFlyZoneCenter(zone = {}) {
  const points = expandNoFlyZoneAreas([zone]).flatMap((item) => collectZoneCoordinates(item));
  if (!points.length) {
    return null;
  }
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  points.forEach((point) => {
    if (point.lat < minLat) minLat = point.lat;
    if (point.lat > maxLat) maxLat = point.lat;
    if (point.lng < minLng) minLng = point.lng;
    if (point.lng > maxLng) maxLng = point.lng;
  });
  if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) {
    return null;
  }
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2
  };
}

function fetchNearbyNoFlyZones(params = {}, options = {}) {
  const base = resolveApiBase(options.apiBase);
  if (!base) {
    return Promise.reject(new Error("missing-api-base"));
  }
  const latitude = Number(params.latitude);
  const longitude = Number(params.longitude);
  const radius = Number(params.radiusInKilometers);
  const query = [];
  if (Number.isFinite(latitude)) {
    query.push(`latitude=${encodeURIComponent(latitude.toFixed(6))}`);
  }
  if (Number.isFinite(longitude)) {
    query.push(`longitude=${encodeURIComponent(longitude.toFixed(6))}`);
  }
  if (Number.isFinite(radius) && radius >= 0) {
    query.push(`radiusInKilometers=${encodeURIComponent(radius.toFixed(3))}`);
  }
  const qs = query.length ? `?${query.join("&")}` : "";
  const url = `${base}/api/no-fly-zones/nearby${qs}`;
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: "GET",
      header: { "content-type": "application/json" },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data?.data || []);
        } else {
          const reason = res.data?.message || res.errMsg || `status-${res.statusCode}`;
          reject(new Error(typeof reason === "string" ? reason : JSON.stringify(reason)));
        }
      },
      fail: (err) => reject(err)
    });
  });
}

module.exports = {
  fetchNearbyNoFlyZones,
  fetchTemporaryNoFlyZonesPage,
  searchTemporaryNoFlyZones,
  buildNoFlyZoneGraphics,
  computeNoFlyZoneCenter,
  isNoFlyZoneEffective,
  isNoFlyZoneExpired,
  filterEffectiveNoFlyZones,
  filterUnexpiredNoFlyZones,
  expandNoFlyZoneAreas
};
