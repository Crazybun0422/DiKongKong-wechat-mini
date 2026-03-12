const EPSILON = 1e-10;
const DEFAULT_LAYER_NAMESPACE = "QGSFKYFW";
const DEFAULT_STYLE_NAME = "shifeikongyu";

const MAINLAND_PROVINCE_CODES = [
  "12", "13", "14", "15", "21", "22", "23", "31", "32", "33", "34", "35", "36", "37", "41", "42",
  "43", "44", "45", "46", "50", "51", "52", "53", "54", "61", "62", "63", "64", "65"
];

const SUPPORTED_PROVINCE_CODE_SET = new Set(MAINLAND_PROVINCE_CODES);

const normalizePoint = (point) => {
  if (!Array.isArray(point) || point.length < 2) return null;
  const longitude = Number(point[0]);
  const latitude = Number(point[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return { longitude, latitude };
};

const normalizeRing = (ring = []) => ring.map(normalizePoint).filter(Boolean);

const computeRingBounds = (ring) => ({
  minLng: Math.min(...ring.map((point) => point.longitude)),
  maxLng: Math.max(...ring.map((point) => point.longitude)),
  minLat: Math.min(...ring.map((point) => point.latitude)),
  maxLat: Math.max(...ring.map((point) => point.latitude))
});

const mergeBounds = (boundsList = []) => ({
  minLng: Math.min(...boundsList.map((bounds) => bounds.minLng)),
  maxLng: Math.max(...boundsList.map((bounds) => bounds.maxLng)),
  minLat: Math.min(...boundsList.map((bounds) => bounds.minLat)),
  maxLat: Math.max(...boundsList.map((bounds) => bounds.maxLat))
});

const normalizeRectBbox = (bbox) => {
  if (!bbox) return null;
  const southwest = bbox.southwest || bbox.sw;
  const northeast = bbox.northeast || bbox.ne;
  if (southwest && northeast) {
    const sw = normalizePoint([southwest.longitude ?? southwest.lng, southwest.latitude ?? southwest.lat]);
    const ne = normalizePoint([northeast.longitude ?? northeast.lng, northeast.latitude ?? northeast.lat]);
    if (!sw || !ne) return null;
    return {
      minLng: Math.min(sw.longitude, ne.longitude),
      maxLng: Math.max(sw.longitude, ne.longitude),
      minLat: Math.min(sw.latitude, ne.latitude),
      maxLat: Math.max(sw.latitude, ne.latitude)
    };
  }
  if (Array.isArray(bbox) && bbox.length >= 4) {
    const [minLng, minLat, maxLng, maxLat] = bbox.map(Number);
    if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null;
    return {
      minLng: Math.min(minLng, maxLng),
      maxLng: Math.max(minLng, maxLng),
      minLat: Math.min(minLat, maxLat),
      maxLat: Math.max(minLat, maxLat)
    };
  }
  const minLng = Number(bbox.minLng);
  const maxLng = Number(bbox.maxLng);
  const minLat = Number(bbox.minLat);
  const maxLat = Number(bbox.maxLat);
  if (![minLng, maxLng, minLat, maxLat].every(Number.isFinite)) return null;
  return {
    minLng: Math.min(minLng, maxLng),
    maxLng: Math.max(minLng, maxLng),
    minLat: Math.min(minLat, maxLat),
    maxLat: Math.max(minLat, maxLat)
  };
};

const rectsOverlap = (a, b) =>
  a.minLng <= b.maxLng + EPSILON &&
  a.maxLng >= b.minLng - EPSILON &&
  a.minLat <= b.maxLat + EPSILON &&
  a.maxLat >= b.minLat - EPSILON;

const pointInRect = (point, rect) =>
  point.longitude >= rect.minLng - EPSILON &&
  point.longitude <= rect.maxLng + EPSILON &&
  point.latitude >= rect.minLat - EPSILON &&
  point.latitude <= rect.maxLat + EPSILON;

const rectCenter = (rect) => ({
  longitude: (rect.minLng + rect.maxLng) / 2,
  latitude: (rect.minLat + rect.maxLat) / 2
});

const onSegment = (a, b, p) =>
  Math.min(a.longitude, b.longitude) - EPSILON <= p.longitude &&
  p.longitude <= Math.max(a.longitude, b.longitude) + EPSILON &&
  Math.min(a.latitude, b.latitude) - EPSILON <= p.latitude &&
  p.latitude <= Math.max(a.latitude, b.latitude) + EPSILON &&
  Math.abs(
    (b.longitude - a.longitude) * (p.latitude - a.latitude) -
    (b.latitude - a.latitude) * (p.longitude - a.longitude)
  ) <= EPSILON;

const orientation = (a, b, c) =>
  (b.longitude - a.longitude) * (c.latitude - a.latitude) -
  (b.latitude - a.latitude) * (c.longitude - a.longitude);

const segmentsIntersect = (a, b, c, d) => {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (
    ((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) &&
    ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))
  ) {
    return true;
  }
  if (Math.abs(o1) <= EPSILON && onSegment(a, b, c)) return true;
  if (Math.abs(o2) <= EPSILON && onSegment(a, b, d)) return true;
  if (Math.abs(o3) <= EPSILON && onSegment(c, d, a)) return true;
  if (Math.abs(o4) <= EPSILON && onSegment(c, d, b)) return true;
  return false;
};

const pointInPolygon = (point, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i];
    const pj = polygon[j];
    if (onSegment(pj, pi, point)) return true;
    const crosses = (pi.latitude > point.latitude) !== (pj.latitude > point.latitude);
    if (!crosses) continue;
    const slope = (pj.longitude - pi.longitude) / ((pj.latitude - pi.latitude) || EPSILON);
    const xAtY = slope * (point.latitude - pi.latitude) + pi.longitude;
    if (point.longitude < xAtY) inside = !inside;
  }
  return inside;
};

const pointToSegmentDistanceSquared = (point, start, end) => {
  const dx = end.longitude - start.longitude;
  const dy = end.latitude - start.latitude;
  if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) {
    const px = point.longitude - start.longitude;
    const py = point.latitude - start.latitude;
    return px * px + py * py;
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      (
        (point.longitude - start.longitude) * dx +
        (point.latitude - start.latitude) * dy
      ) / (dx * dx + dy * dy)
    )
  );
  const nearestLng = start.longitude + dx * t;
  const nearestLat = start.latitude + dy * t;
  const diffLng = point.longitude - nearestLng;
  const diffLat = point.latitude - nearestLat;
  return diffLng * diffLng + diffLat * diffLat;
};

const pointToPolygonDistanceSquared = (point, polygon) => {
  if (!Array.isArray(polygon) || polygon.length < 3) return Number.POSITIVE_INFINITY;
  if (pointInPolygon(point, polygon)) return 0;

  let minDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i += 1) {
    const start = polygon[i];
    const end = polygon[(i + 1) % polygon.length];
    const distance = pointToSegmentDistanceSquared(point, start, end);
    if (distance < minDistance) minDistance = distance;
  }
  return minDistance;
};

const polygonIntersectsRect = (polygon, rect) => {
  const rectCorners = [
    { longitude: rect.minLng, latitude: rect.minLat },
    { longitude: rect.maxLng, latitude: rect.minLat },
    { longitude: rect.maxLng, latitude: rect.maxLat },
    { longitude: rect.minLng, latitude: rect.maxLat }
  ];

  if (polygon.some((point) => pointInRect(point, rect))) return true;
  if (rectCorners.some((point) => pointInPolygon(point, polygon))) return true;

  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    for (let j = 0; j < rectCorners.length; j += 1) {
      const c = rectCorners[j];
      const d = rectCorners[(j + 1) % rectCorners.length];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
};

const extractProvinceCode = (adcode) => {
  const raw = String(adcode ?? "").trim();
  const match = raw.match(/^(\d{2})\d{4}$/);
  if (!match) return null;
  const code = match[1];
  return SUPPORTED_PROVINCE_CODE_SET.has(code) ? code : null;
};

const normalizeProvinceGeometry = (geometry) => {
  if (!geometry?.type || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === "Polygon") {
    const outerRing = normalizeRing(geometry.coordinates[0] || []);
    return outerRing.length >= 3 ? [outerRing] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates
      .map((polygon) => normalizeRing(polygon?.[0] || []))
      .filter((ring) => ring.length >= 3);
  }
  return [];
};

function buildProvinceLayerRecords(geojson, options = {}) {
  const layerNamespace = options.layerNamespace || DEFAULT_LAYER_NAMESPACE;
  const styleName = options.styleName || DEFAULT_STYLE_NAME;
  const features = Array.isArray(geojson?.features) ? geojson.features : [];

  return features
    .map((feature) => {
      const provinceCode = extractProvinceCode(feature?.properties?.adcode);
      if (!provinceCode) return null;
      const polygons = normalizeProvinceGeometry(feature.geometry);
      if (!polygons.length) return null;
      const polygonBounds = polygons.map(computeRingBounds);
      return {
        adcode: Number(feature.properties.adcode),
        provinceCode,
        name: String(feature.properties?.name || provinceCode),
        layerName: `${layerNamespace}:sf${provinceCode}0000`,
        styleName: `${layerNamespace}:${styleName}`,
        polygons,
        bounds: mergeBounds(polygonBounds)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.provinceCode.localeCompare(b.provinceCode));
}

function findIntersectingProvinceLayerRecords(records, bbox) {
  const rect = normalizeRectBbox(bbox);
  if (!rect) return [];
  return (Array.isArray(records) ? records : []).filter((record) => {
    if (!rectsOverlap(record.bounds, rect)) return false;
    return record.polygons.some((polygon) => polygonIntersectsRect(polygon, rect));
  });
}

function findNearestProvinceLayerRecord(records, bbox) {
  const rect = normalizeRectBbox(bbox);
  if (!rect) return null;

  const center = rectCenter(rect);
  let nearestRecord = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const record of Array.isArray(records) ? records : []) {
    if (!record?.polygons?.length) continue;
    const distance = record.polygons.reduce((minDistance, polygon) => {
      const polygonDistance = pointToPolygonDistanceSquared(center, polygon);
      return Math.min(minDistance, polygonDistance);
    }, Number.POSITIVE_INFINITY);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestRecord = record;
    }
  }

  return nearestRecord;
}

function buildProvinceLayerParams(records, bbox) {
  const matched = findIntersectingProvinceLayerRecords(records, bbox);
  const resolvedRecords = matched.length
    ? matched
    : [findNearestProvinceLayerRecord(records, bbox)].filter(Boolean);
  return {
    provinceCodes: resolvedRecords.map((record) => record.provinceCode),
    provinceNames: resolvedRecords.map((record) => record.name),
    layers: resolvedRecords.map((record) => record.layerName).join(","),
    styles: resolvedRecords.map((record) => record.styleName).join(","),
    matchedRecords: resolvedRecords
  };
}

module.exports = {
  MAINLAND_PROVINCE_CODES,
  buildProvinceLayerRecords,
  findIntersectingProvinceLayerRecords,
  findNearestProvinceLayerRecord,
  buildProvinceLayerParams
};

module.exports.default = module.exports;
