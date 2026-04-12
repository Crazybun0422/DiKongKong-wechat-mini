const { buildFileDownloadUrl, buildFileStreamUrl } = require("../../../utils/markers");
const { reverseGeocode } = require("../../../utils/geocoder");
const { buildNoFlyZoneGraphics } = require("../../../utils/no-fly-zones");
const { gcj02ToWgs84 } = require("../../../utils/coords");
const {
  fetchTencentCosConfig,
  fetchTencentCosSts,
  buildCosHost,
  isTencentCosStsValid,
  buildTencentCosSignedUrl
} = require("../../../utils/tencent-cos");
const { hasValidCoordinate, clampMapScale } = require("./map-shared");
const {
  isKmlShapeType,
  resolvePinPointCategory,
  resolvePinPointIconPath,
  buildPinPointCalloutContent
} = require("./marker-shared");
const { pinContainsPoint } = require("./center-hit");
const MY_LOCATION_MARKER_ID = 991001;
const MY_LOCATION_MARKER_ICON_PATH = "/assets/p-point.png";
const MY_LOCATION_MARKER_SIZE = 40;

const formatNearbyMarkerLabel = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const chars = Array.from(trimmed);
  if (chars.length <= 7) return chars.join("");
  return `${chars.slice(0, 6).join("")}…`;
};

const buildMarkerNameCallout = (content, overrides = {}) => {
  if (!content) return null;
  return Object.assign(
    {
      content,
      color: "#111827",
      fontSize: 12,
      fontWeight: "bold",
      display: "ALWAYS",
      borderRadius: 5,
      padding: 6,
      borderColor: "#111827",
      borderWidth: 0.4
    },
    overrides
  );
};

const flattenCoordinateList = (raw) => {
  if (!Array.isArray(raw) || !raw.length) return [];
  if (
    Array.isArray(raw[0]) &&
    raw[0].length &&
    (Array.isArray(raw[0][0]) || (raw[0][0] && typeof raw[0][0] === "object"))
  ) {
    return raw[0];
  }
  return raw;
};

const resolveCoordinateGroup = (shape = {}) => {
  const groups = shape.coordinateGroups || shape.coordinateGroup;
  if (!groups) return null;
  if (Array.isArray(groups)) return { type: "", coordinates: groups };
  if (typeof groups !== "object") return null;
  const entries = Object.entries(groups).filter(([, value]) => Array.isArray(value) && value.length);
  if (!entries.length) return null;
  const findBy = (keys = []) =>
    entries.find(([key]) => keys.some((target) => key.toLowerCase().includes(target)));
  const polygon = findBy(["polygon", "poly", "area"]);
  if (polygon) return { type: "POLYGON", coordinates: polygon[1] };
  const line = findBy(["line", "path"]);
  if (line) return { type: "LINE", coordinates: line[1] };
  const point = findBy(["point"]);
  if (point) return { type: "POINT", coordinates: point[1] };
  const first = entries[0];
  return { type: "", coordinates: first[1] };
};

const normalizeStyleColorToTransparent = (value) => {
  if (typeof value !== "string") return value;
  const raw = value.trim();
  if (!raw) return value;
  const lower = raw.toLowerCase();
  if (lower === "transparent") return value;
  if (lower.startsWith("rgba")) {
    const match = lower.match(/rgba\(([^)]+)\)/);
    if (match && match[1]) {
      const parts = match[1].split(",").map((p) => p.trim());
      const alpha = Number(parts[3]);
      if (Number.isFinite(alpha) && alpha <= 0) return value;
    }
    return "rgba(0,0,0,0)";
  }
  if (lower.startsWith("rgb(") || lower.startsWith("hsl(") || lower.startsWith("hsla")) {
    return "rgba(0,0,0,0)";
  }
  if (lower.startsWith("#")) {
    if (lower.length === 9) {
      const hex = lower.slice(1);
      if (hex.startsWith("00") || hex.endsWith("00")) return value;
    }
    return "#00000000";
  }
  return "transparent";
};

const normalizeKmlStyle = (style) => {
  if (!style || typeof style !== "object") return style;
  const next = Object.assign({}, style);
  ["color", "fillColor", "strokeColor", "lineColor", "polyColor", "outlineColor"].forEach((key) => {
    if (typeof next[key] === "string") {
      next[key] = normalizeStyleColorToTransparent(next[key]);
    }
  });
  return next;
};

const normalizeKmlShape = (shape = {}) => {
  if (!shape || typeof shape !== "object") return shape;
  const type = `${shape.type || ""}`.toUpperCase();
  if (!isKmlShapeType(type)) return shape;
  const style = normalizeKmlStyle(shape.style);
  if (style === shape.style) return shape;
  return Object.assign({}, shape, { style });
};

const resolveShapeCoordinates = (shape = {}) => {
  const baseType = `${shape.type || ""}`.toUpperCase();
  let coordinates = Array.isArray(shape.coordinates) ? shape.coordinates : [];
  let resolvedType = baseType || "POINT";
  if (!coordinates.length) {
    const grouped = resolveCoordinateGroup(shape);
    if (grouped && Array.isArray(grouped.coordinates) && grouped.coordinates.length) {
      coordinates = grouped.coordinates;
      if (grouped.type) resolvedType = grouped.type;
    }
  }
  if (isKmlShapeType(baseType) && resolvedType === baseType) {
    const radius = Number(shape.radius);
    const width = Number(shape.width);
    if (Number.isFinite(radius) && radius > 0) {
      resolvedType = "CIRCLE";
    } else if (Number.isFinite(width) && width > 0) {
      resolvedType = "LINE";
    } else if (Array.isArray(coordinates) && coordinates.length <= 1) {
      resolvedType = "POINT";
    } else if (coordinates.length) {
      resolvedType = "POLYGON";
    }
  }
  return { coordinates: flattenCoordinateList(coordinates), resolvedType };
};

const resolvePinVideoRef = (raw = {}) => {
  if (!raw || typeof raw !== "object") return "";
  const candidates = [
    raw.videoLink,
    raw.video,
    raw.videoUrl,
    raw.videoFileName,
    raw.videoPath,
    raw.videoName,
    raw.media?.videoLink,
    raw.media?.video,
    raw.content?.videoLink
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === "object") {
      const nested = candidate.url || candidate.fileName || candidate.filename || candidate.objectName || candidate.path || "";
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
  }
  return "";
};

const resolvePinVideoUrl = (videoRef = "", options = {}) => {
  const ref = typeof videoRef === "string" ? videoRef.trim() : "";
  if (!ref) return "";
  const cosHost = `${options.cosHost || ""}`.trim();
  const isOldSignedCosUrl = /^https?:\/\//i.test(ref) && /[?&]q-sign-algorithm=/i.test(ref);
  if (options.isSCos && cosHost && options.cosSts) {
    return buildTencentCosSignedUrl(ref, { host: cosHost, sts: options.cosSts }) || ref;
  }
  if (options.isSCos && isOldSignedCosUrl) return "";
  if (/^https?:\/\//i.test(ref)) return ref;
  if (options.isSCos && cosHost) return `https://${cosHost}/${ref.replace(/^\/+/, "")}`;
  return buildFileStreamUrl(ref, { apiBase: options.apiBase });
};

function isMyLocationCirclesChanged(prev = [], next = []) {
  if (!Array.isArray(prev) || !Array.isArray(next)) return true;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i] || {};
    const b = next[i] || {};
    if (
      Number(a.latitude) !== Number(b.latitude) ||
      Number(a.longitude) !== Number(b.longitude) ||
      Number(a.radius) !== Number(b.radius) ||
      Number(a.strokeWidth) !== Number(b.strokeWidth) ||
      `${a.color || ""}` !== `${b.color || ""}` ||
      `${a.fillColor || ""}` !== `${b.fillColor || ""}`
    ) {
      return true;
    }
  }
  return false;
}

function isMyLocationMarkersChanged(prev = [], next = []) {
  if (!Array.isArray(prev) || !Array.isArray(next)) return true;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i] || {};
    const b = next[i] || {};
    if (
      Number(a.id) !== Number(b.id) ||
      Number(a.latitude) !== Number(b.latitude) ||
      Number(a.longitude) !== Number(b.longitude) ||
      Number(a.width) !== Number(b.width) ||
      Number(a.height) !== Number(b.height) ||
      Number(a.rotate) !== Number(b.rotate) ||
      Number(a.zIndex) !== Number(b.zIndex) ||
      `${a.iconPath || ""}` !== `${b.iconPath || ""}`
    ) {
      return true;
    }
  }
  return false;
}

function buildMyLocationMarker(page, point = {}) {
  const latitude = Number(point?.latitude);
  const longitude = Number(point?.longitude);
  if (!hasValidCoordinate(latitude, longitude)) return null;
  const rotate = page.normalizeCompassDirection(page._myLocationDirection);
  return {
    id: MY_LOCATION_MARKER_ID,
    latitude,
    longitude,
    iconPath: MY_LOCATION_MARKER_ICON_PATH,
    width: MY_LOCATION_MARKER_SIZE,
    height: MY_LOCATION_MARKER_SIZE,
    alpha: 1,
    zIndex: 1300,
    rotate: Math.round(rotate || 0),
    anchor: { x: 0.5, y: 0.5 },
    extData: { source: "my-location-map" }
  };
}

function buildMyLocationMarkers(page, point = {}) {
  if (!page.data.usePlanetCenterPoint) return [];
  const pointer = buildMyLocationMarker(page, point);
  return pointer ? [pointer] : [];
}

function buildMyLocationCircles() {
  return [];
}

function refreshMyLocationGraphics(page, point = null) {
  const latitude = Number(point?.latitude);
  const longitude = Number(point?.longitude);
  if (!hasValidCoordinate(latitude, longitude)) {
    const hadMarkers = Array.isArray(page._myLocationMarkers) && page._myLocationMarkers.length > 0;
    const hadCircles = Array.isArray(page._myLocationCircles) && page._myLocationCircles.length > 0;
    if (hadMarkers || hadCircles) {
      page._myLocationMarkers = [];
      page._myLocationCircles = [];
      page.queueMapGraphicsSync({ markers: hadMarkers, overlay: hadCircles });
    }
    return;
  }
  const normalized = { latitude, longitude };
  const markers = buildMyLocationMarkers(page, normalized);
  const prevMarkers = Array.isArray(page._myLocationMarkers) ? page._myLocationMarkers : [];
  const markersChanged = isMyLocationMarkersChanged(prevMarkers, markers);
  if (markersChanged) page._myLocationMarkers = markers;
  const circles = buildMyLocationCircles();
  const prevCircles = Array.isArray(page._myLocationCircles) ? page._myLocationCircles : [];
  const circlesChanged = isMyLocationCirclesChanged(prevCircles, circles);
  if (circlesChanged) page._myLocationCircles = circles;
  if (!markersChanged && !circlesChanged) return;
  page.queueMapGraphicsSync({ markers: markersChanged, overlay: circlesChanged });
}

function setMyLocationControlPoint(page, point = null, options = {}) {
  const latitude = Number(point?.latitude);
  const longitude = Number(point?.longitude);
  if (!hasValidCoordinate(latitude, longitude)) {
    if (page.data.myLocationVisible || page.data.myLocationPoint) {
      page.setData({
        myLocationPoint: null,
        myLocationVisible: false
      });
    }
    refreshMyLocationGraphics(page, null);
    return;
  }
  const normalized = { latitude, longitude };
  const prev = page.data.myLocationPoint || {};
  const changed =
    !hasValidCoordinate(prev.latitude, prev.longitude) ||
    Math.abs(Number(prev.latitude) - latitude) > 1e-8 ||
    Math.abs(Number(prev.longitude) - longitude) > 1e-8;
  if (changed || page.data.myLocationVisible !== true) {
    page.setData({
      myLocationPoint: normalized,
      myLocationVisible: true
    });
  }
  refreshMyLocationGraphics(page, normalized);
  if (options.syncCenter === false) {
    return;
  }
  const currentCenter = page._centerOverride || page.data.center || null;
  const centerChanged =
    !hasValidCoordinate(currentCenter?.latitude, currentCenter?.longitude) ||
    Math.abs(Number(currentCenter.latitude) - latitude) > 1e-8 ||
    Math.abs(Number(currentCenter.longitude) - longitude) > 1e-8;
  if (centerChanged || !page.isMapCenterReady()) {
    page.centerOnPoint(normalized, page.data.scale, true);
  }
}

function normalizePreviewCoordinate(entry) {
  if (!entry) return null;
  if (Array.isArray(entry) && entry.length >= 2) {
    const lng = Number(entry[0]);
    const lat = Number(entry[1]);
    const alt = Number(entry[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const coord = { latitude: lat, longitude: lng };
    if (Number.isFinite(alt)) coord.altitude = alt;
    return coord;
  }
  const lat = Number(entry.latitude ?? entry.lat);
  const lng = Number(entry.longitude ?? entry.lng);
  const alt = Number(entry.altitude ?? entry.height ?? entry.alt);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const coord = { latitude: lat, longitude: lng };
  if (Number.isFinite(alt)) coord.altitude = alt;
  return coord;
}

function normalizePreviewCoordinateList(raw = []) {
  if (!Array.isArray(raw) || !raw.length) return [];
  const list = flattenCoordinateList(raw);
  return list.map((coord) => normalizePreviewCoordinate(coord)).filter(Boolean);
}

function buildPinPreviewZone(page, shape = {}) {
  const shapeType = `${shape.type || ""}`.toUpperCase();
  const normalizedShape = isKmlShapeType(shapeType) ? normalizeKmlShape(shape) : shape;
  const resolved = resolveShapeCoordinates(normalizedShape);
  const type = resolved.resolvedType || shapeType;
  const coordinates = normalizePreviewCoordinateList(resolved.coordinates);
  if (!coordinates.length) return null;
  if (type === "CIRCLE") {
    const center = coordinates[0];
    const radiusKm = Number(shape.radius);
    if (!center || !Number.isFinite(radiusKm) || radiusKm <= 0) return null;
    return { type: "CIRCLE", circle: { latitude: center.latitude, longitude: center.longitude, radiusMeters: radiusKm * 1000 } };
  }
  if (type === "LINE" || type === "PATH") {
    return { type: "PATH", coordinates, pathDistanceMeters: Number(shape.width) || 0 };
  }
  return { type: "POLYGON", coordinates };
}

function buildPinPreviewZones(page, payload = {}) {
  const shapes = Array.isArray(payload?.shapes) && payload.shapes.length
    ? payload.shapes
    : (payload?.shape ? [payload.shape] : []);
  return shapes
    .map((shape) => buildPinPreviewZone(page, shape))
    .filter(Boolean);
}

function buildPinPreviewMarker(page, payload = {}) {
  const location = payload.location || {};
  const lat = Number(location.latitude);
  const lng = Number(location.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const category = resolvePinPointCategory(payload);
  const iconPath = resolvePinPointIconPath(payload);
  const displayMode = page.resolveMarkerDisplayMode(payload.raw || payload, payload.scaleInMeters);
  if (displayMode === page.DISPLAY_MODE_HIDDEN || displayMode === "HIDDEN") return null;
  const contentParts = [];
  if (payload.name) {
    const formattedName = formatNearbyMarkerLabel(payload.name);
    if (formattedName) contentParts.push(formattedName);
  }
  if (category === "TALL_BUILDING" && Number.isFinite(payload.height)) {
    const hText = `${Math.round(payload.height)}米`;
    contentParts.push(payload.name ? hText : `高程${hText}`);
  }
  const marker = {
    id: payload.id || `pin-preview-${Date.now()}`,
    latitude: lat,
    longitude: lng,
    iconPath,
    width: 32,
    height: 32
  };
  const content = buildPinPointCalloutContent(payload.name || "", category, payload.height);
  if (content) {
    marker.callout = buildMarkerNameCallout(content, { fontSize: 10, fontWeight: "normal" });
  }
  return page.applyDisplayModeToMarker(marker, payload.raw || payload, {
    scaleInMeters: payload.scaleInMeters,
    baseSize: 32
  });
}

function computePinPreviewCenter(page, shape = {}, payload = {}) {
  const location = payload.location;
  const resolved = resolveShapeCoordinates(shape || {});
  const resolvedType = `${resolved.resolvedType || shape?.type || "POINT"}`.toUpperCase();
  const normalized = normalizePreviewCoordinateList(Array.isArray(resolved.coordinates) ? resolved.coordinates : []);
  if (resolvedType !== "POINT" && normalized.length) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    normalized.forEach((item) => {
      const latitude = Number(item?.latitude);
      const longitude = Number(item?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      if (latitude < minLat) minLat = latitude;
      if (latitude > maxLat) maxLat = latitude;
      if (longitude < minLng) minLng = longitude;
      if (longitude > maxLng) maxLng = longitude;
    });
    if (Number.isFinite(minLat) && Number.isFinite(maxLat) && Number.isFinite(minLng) && Number.isFinite(maxLng)) {
      return { latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2 };
    }
  }
  const target = (location && hasValidCoordinate(location.latitude, location.longitude)) ? location : normalized[0];
  if (target && hasValidCoordinate(target.latitude, target.longitude)) {
    return { latitude: Number(target.latitude), longitude: Number(target.longitude) };
  }
  return null;
}

function buildPreviewTemporaryNoFlyOverride(info = null) {
  if (!info) return null;
  return {
    temporaryNoFlyZoneInfo: info,
    temporaryNoFlyText: info.displayName || info.name || "",
    temporaryNoFlyTone: info.effective === false ? "warn" : "alert"
  };
}

function shouldShowPreviewTemporaryNoFly(page, centerOverride) {
  const payload = page._previewTemporaryNoFlyPayload;
  if (!payload || !payload.temporaryNoFlyZoneInfo) return false;
  const center = centerOverride || page._centerOverride || page.data.center;
  if (!center || !hasValidCoordinate(center.latitude, center.longitude)) return false;
  const zones = buildPinPreviewZones(page, payload);
  if (!zones.length) return false;
  return zones.some((zone) => pinContainsPoint(page, { shape: zone }, center));
}

function syncPreviewTemporaryNoFlyState(page, centerOverride) {
  if (!page._previewTemporaryNoFlyPayload || !page._previewTemporaryNoFlyOverride) return false;
  if (shouldShowPreviewTemporaryNoFly(page, centerOverride)) {
    page.setData(page._previewTemporaryNoFlyOverride);
    return true;
  }
  if (page._liveTemporaryNoFlyStatus) {
    page.setData(page._liveTemporaryNoFlyStatus);
  } else if (page._previewTemporaryNoFlyStatus) {
    page.setData(page._previewTemporaryNoFlyStatus);
  }
  return false;
}

function clearPinPreview(page) {
  page._previewPolygons = [];
  page._previewCircles = [];
  page._previewMarker = null;
  page._previewPinId = null;
  page._previewTemporaryNoFlyPayload = null;
  page._previewTemporaryNoFlyOverride = null;
  if (page._previewTemporaryNoFlyStatus) {
    page.setData(page._liveTemporaryNoFlyStatus || page._previewTemporaryNoFlyStatus);
    page._previewTemporaryNoFlyStatus = null;
  }
  page.updateOverlayGraphics();
  page.syncAllMarkers();
  page.updateCenterPinIndicator();
}

function shouldBuildPreviewMarker(payload = {}) {
  if (payload?.suppressCenterMarker === true) {
    return false;
  }
  const shapeType = `${payload?.shape?.type || ""}`.trim().toUpperCase();
  if (!shapeType) {
    return true;
  }
  return !["POLYGON", "RECTANGLE", "CIRCLE", "PATH", "LINE"].includes(shapeType);
}

function applyPinPreview(page, payload = {}) {
  if (!payload || (!payload.shape && !(Array.isArray(payload.shapes) && payload.shapes.length))) return;
  clearPinPreview(page);
  page._previewPinId = payload.id || "";
  const center = computePinPreviewCenter(page, payload.shape, payload);
  const zones = buildPinPreviewZones(page, payload);
  if (zones.length) {
    const graphics = buildNoFlyZoneGraphics(zones, { color: payload.previewColor || "#D3A05B" });
    page._previewPolygons = Array.isArray(graphics.polygons) ? graphics.polygons : [];
    page._previewCircles = Array.isArray(graphics.circles) ? graphics.circles : [];
  }
  if (payload.temporaryNoFlyZoneInfo) {
    page._previewTemporaryNoFlyPayload = payload;
    page._previewTemporaryNoFlyStatus = {
      temporaryNoFlyZoneInfo: page.data.temporaryNoFlyZoneInfo || null,
      temporaryNoFlyText: page.data.temporaryNoFlyText || "",
      temporaryNoFlyTone: page.data.temporaryNoFlyTone || "neutral"
    };
    page._previewTemporaryNoFlyOverride = buildPreviewTemporaryNoFlyOverride(payload.temporaryNoFlyZoneInfo);
    syncPreviewTemporaryNoFlyState(page, center);
  }
  const marker = shouldBuildPreviewMarker(payload) ? buildPinPreviewMarker(page, payload) : null;
  if (marker) {
    marker.extData = Object.assign({}, marker.extData, { source: "pin-preview", raw: payload });
    page._previewMarker = marker;
    if (!page._previewPinId) page._previewPinId = marker.id || "";
  }
  page.updateOverlayGraphics();
  page.syncAllMarkers();
  page.updateCenterPinIndicator();
  if (center) page.centerOnPoint(center, clampMapScale(payload.zoom || 16));
}

function buildPinDetailFromPin(page, pin = {}) {
  const rawPin = pin.raw || pin;
  const shapeRaw = rawPin.shape || {};
  const shapeType = `${shapeRaw.type || ""}`.toUpperCase();
  const shape = isKmlShapeType(shapeType) ? normalizeKmlShape(shapeRaw) : shapeRaw;
  const resolved = resolveShapeCoordinates(shape);
  const normalizedCoords = normalizePreviewCoordinateList(resolved.coordinates);
  const primary =
    normalizedCoords[0] ||
    normalizePreviewCoordinate(rawPin.location) ||
    normalizePreviewCoordinate({ latitude: rawPin.latitude, longitude: rawPin.longitude }) ||
    {};
  const apiBase = page.getApiBase();
  const normalized = page.normalizeMarkerDetail(rawPin);
  const pinIdValue = rawPin.pinIdNew ?? rawPin.pinId ?? rawPin.id ?? "";
  const pinId = pinIdValue !== undefined && pinIdValue !== null ? `${pinIdValue}` : "";
  const resolveImageRef = (item) => {
    if (!item) return "";
    if (typeof item === "string") return item.trim();
    if (typeof item === "object") {
      const candidate = item.fileName || item.filename || item.objectName || item.path || item.location || item.url || item.imageUrl || "";
      return typeof candidate === "string" ? candidate.trim() : "";
    }
    return "";
  };
  const images = (Array.isArray(rawPin.images) ? rawPin.images : [])
    .map((img, idx) => {
      const ref = resolveImageRef(img);
      const url = ref ? buildFileDownloadUrl(ref, { apiBase }) : "";
      if (!url) return null;
      return { url, id: `${pinId || rawPin.id || "pin"}-image-${idx}` };
    })
    .filter((img) => !!img.url);
  const videoRef = resolvePinVideoRef(rawPin);
  const videoUrl = resolvePinVideoUrl(videoRef, {
    apiBase,
    isSCos: rawPin.isSCos !== false,
    cosHost: page._tencentCosConfig?.host || "",
    cosSts: page._tencentCosSts || null
  });
  const mediaItems = images.map((item) => Object.assign({ type: "image" }, item)).concat(
    videoUrl ? [{
      type: "video",
      url: videoUrl,
      poster: images[0]?.url || "",
      id: `${pinId || rawPin.id || "pin"}-video-0`,
      isSCos: rawPin.isSCos !== false
    }] : []
  );
  const pointCategory = `${rawPin.shape?.pointCategory || rawPin.shape?.pointcategory || ""}`.toUpperCase();
  const heightDisplay = Number.isFinite(normalized.height) && normalized.height > 0 ? `${Math.round(normalized.height)}m` : "";
  const nameBase = normalized.name || rawPin.name || rawPin.title || "自定义标记";
  const name = pointCategory === "TALL_BUILDING" && heightDisplay ? `${nameBase}·${heightDisplay}` : nameBase;
  const latitude = [primary.latitude, rawPin.location?.latitude, rawPin.latitude, normalized.latitude]
    .find((v) => Number.isFinite(Number(v)));
  const longitude = [primary.longitude, rawPin.location?.longitude, rawPin.longitude, normalized.longitude]
    .find((v) => Number.isFinite(Number(v)));
  const detail = {
    id: pinId,
    markerId: pinId,
    name,
    locationText: normalized.locationText || rawPin.location?.text || rawPin.address || "",
    latitude: Number.isFinite(Number(latitude)) ? Number(latitude) : undefined,
    longitude: Number.isFinite(Number(longitude)) ? Number(longitude) : undefined,
    description: normalized.description || rawPin.description || "",
    images: images.length ? images : normalized.images || [],
    mediaItems,
    videoLink: videoRef || "",
    isSCos: rawPin.isSCos !== false && !!videoRef,
    creatorName: normalized.creatorName || rawPin.creatorName || "",
    raw: rawPin,
    source: "pin"
  };
  if (!detail.locationText && Number.isFinite(Number(detail.latitude)) && Number.isFinite(Number(detail.longitude))) {
    lookupPinAddress(page, detail);
  }
  console.log("Built pin detail ->>", detail.latitude, detail.longitude);
  return detail;
}

function prefetchTencentCosConfig(page) {
  fetchTencentCosConfig({ apiBase: page.getApiBase() })
    .then((config = {}) => {
      const bucket = Array.isArray(config.buckets) ? `${config.buckets[0] || ""}`.trim() : "";
      const region = `${config.region || ""}`.trim();
      page._tencentCosConfig = Object.assign({}, config, { bucket, region, host: buildCosHost(bucket, region) });
    })
    .catch((err) => {
      console.warn("map prefetch tencent cos config failed", err);
    });
}

function ensureTencentCosSts(page, force = false) {
  if (!force && isTencentCosStsValid(page._tencentCosSts)) return Promise.resolve(page._tencentCosSts);
  if (page._tencentCosStsPromise) return page._tencentCosStsPromise;
  const apiBase = page.getApiBase();
  const token = page.getAuthToken();
  if (!apiBase || !token) return Promise.resolve(null);
  page._tencentCosStsPromise = fetchTencentCosSts({ apiBase, token })
    .then((sts = {}) => {
      page._tencentCosSts = sts;
      return sts;
    })
    .catch((err) => {
      console.warn("map fetch tencent cos sts failed", err);
      return null;
    })
    .finally(() => {
      page._tencentCosStsPromise = null;
    });
  return page._tencentCosStsPromise;
}

function ensurePlayablePinDetailMedia(page, detail, options = {}) {
  if (!detail || !page.isPinDetail(detail)) return Promise.resolve();
  return ensureTencentCosSts(page).then((sts) => {
    const cosHost = page._tencentCosConfig?.host || "";
    if (!sts || !cosHost) return;
    const mediaItems = Array.isArray(detail.mediaItems) ? detail.mediaItems : [];
    let changed = false;
    const nextMediaItems = mediaItems.map((item = {}) => {
      if (`${item.type || ""}`.toLowerCase() !== "video") return item;
      const signedUrl = resolvePinVideoUrl(item.url || detail.videoLink || "", {
        apiBase: page.getApiBase(),
        isSCos: item.isSCos !== false && detail.isSCos !== false,
        cosHost,
        cosSts: sts
      });
      if (!signedUrl || signedUrl === item.url) return item;
      changed = true;
      return Object.assign({}, item, { url: signedUrl });
    });
    if (!changed) return;
    const nextDetail = Object.assign({}, detail, { mediaItems: nextMediaItems });
    if (options.forDetailCard && page.data.detailCard && (page.data.detailCard.id === detail.id || page.data.detailCard.markerId === detail.markerId)) {
      page.setData({ detailCard: nextDetail });
    }
    if (options.forPage && page.data.markerPageDetail && (page.data.markerPageDetail.id === detail.id || page.data.markerPageDetail.markerId === detail.markerId)) {
      page.setData({ markerPageDetail: nextDetail });
    }
    if (page._lastMarkerDetail && (page._lastMarkerDetail.id === detail.id || page._lastMarkerDetail.markerId === detail.markerId)) {
      page._lastMarkerDetail = nextDetail;
    }
  });
}

function ensurePinAddress(page, detail) {
  if (!detail || detail.source !== "pin") return;
  if (detail.locationText) return;
  const lat = Number(detail.latitude);
  const lng = Number(detail.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  requestPinAddress(page, lat, lng)
    .then((address) => {
      if (address) applyPinAddress(page, detail.markerId || detail.id, address);
    })
    .catch((err) => {
      console.warn("reverse geocode pin failed", err);
    });
}

function lookupPinAddress(page, detail) {
  const lat = Number(detail?.latitude);
  const lng = Number(detail?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  requestPinAddress(page, lat, lng)
    .then((address) => {
      if (address) applyPinAddress(page, detail.markerId || detail.id, address);
    })
    .catch((err) => console.warn("lookupPinAddress failed", err));
}

function extractAddressFromGeocode(res = {}) {
  return res.recommend || res.formatted_addresses?.recommend || res.address || res.formatted_address || res.title || "";
}

function requestPinAddress(page, lat, lng) {
  const attemptReverse = (latitude, longitude) =>
    reverseGeocode(latitude, longitude).then((res = {}) => extractAddressFromGeocode(res) || "");
  const wgs = gcj02ToWgs84(lng, lat);
  const hasWgs = Number.isFinite(wgs?.lat) && Number.isFinite(wgs?.lng);
  if (hasWgs) {
    return attemptReverse(wgs.lat, wgs.lng).then((addr) => (addr ? addr : attemptReverse(lat, lng)));
  }
  return attemptReverse(lat, lng);
}

function applyPinAddress(page, markerId, address) {
  if (!address) return;
  if (markerId && page.data.detailCard && (page.data.detailCard.markerId === markerId || page.data.detailCard.id === markerId)) {
    page.setData({ "detailCard.locationText": address });
  }
  if (markerId && page.data.markerPageDetail && (page.data.markerPageDetail.markerId === markerId || page.data.markerPageDetail.id === markerId)) {
    page.setData({ "markerPageDetail.locationText": address });
  }
}

function normalizeNearbyPin(page, raw = {}) {
  const shapeRaw = raw.shape || {};
  const shapeType = `${shapeRaw.type || ""}`.toUpperCase() || "POINT";
  const shape = isKmlShapeType(shapeType) ? normalizeKmlShape(shapeRaw) : shapeRaw;
  const resolved = resolveShapeCoordinates(shape);
  const normalizedCoords = normalizePreviewCoordinateList(resolved.coordinates);
  if (!normalizedCoords.length) return null;
  const name =
    (typeof raw.name === "string" && raw.name) ||
    (typeof raw.title === "string" && raw.title) ||
    "";
  const visibility = `${raw.visibility || raw.scope || ""}`.toUpperCase();
  const heightCandidates = [
    raw.height,
    raw.altitude,
    raw.shape?.height,
    raw.shape?.altitude,
    normalizedCoords[0]?.altitude
  ];
  let height = null;
  for (const candidate of heightCandidates) {
    const num = Number(candidate);
    if (Number.isFinite(num)) {
      height = num;
      break;
    }
  }
  return {
    id: raw.pinId ? raw.pinId : raw.markId ? raw.markId : raw.id,
    name,
    visibility,
    shape: {
      type: resolved.resolvedType || shapeType,
      coordinates: normalizedCoords,
      radius: Number(shape.radius ?? shape.radiusKm ?? shape.radiusInKilometers),
      width: Number(shape.width ?? shape.bufferWidth ?? shape.bufferWidthMeters ?? shape.pathDistanceMeters),
      pointCategory: shape.pointCategory || shape.pointcategory,
      style: shape.style
    },
    location: normalizedCoords[0],
    height,
    raw
  };
}

module.exports = {
  isMyLocationCirclesChanged,
  isMyLocationMarkersChanged,
  buildMyLocationMarker,
  buildMyLocationMarkers,
  buildMyLocationCircles,
  refreshMyLocationGraphics,
  setMyLocationControlPoint,
  applyPinPreview,
  buildPinDetailFromPin,
  prefetchTencentCosConfig,
  ensureTencentCosSts,
  ensurePlayablePinDetailMedia,
  ensurePinAddress,
  clearPinPreview,
  buildPinPreviewZone,
  buildPinPreviewZones,
  buildPinPreviewMarker,
  computePinPreviewCenter,
  normalizePreviewCoordinate,
  normalizePreviewCoordinateList,
  syncPreviewTemporaryNoFlyState,
  lookupPinAddress,
  extractAddressFromGeocode,
  requestPinAddress,
  applyPinAddress,
  normalizeNearbyPin
};
