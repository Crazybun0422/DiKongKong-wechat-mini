const { normalizeMarkerDetail: normalizeMarkerDetailUtil } = require("../../../utils/marker-detail");
const { wgs84ToGcj02 } = require("../../../utils/coords");
const {
  convertParsedCoordinateToGcj02
} = require("../../../utils/coordinate-search");
const {
  DISPLAY_MODE_ICON_WITH_NAME,
  DISPLAY_MODE_SMALL_ICON_ONLY,
  DISPLAY_MODE_HIDDEN,
  resolveMapDisplayMode,
  getDisplayModeMarkerSize
} = require("../../../utils/map-display-mode");
const { hasValidCoordinate } = require("./map-shared");
const {
  isKmlShapeType,
  cloneMarkerDetail
} = require("./marker-shared");

const flattenCoordinateList = (value) => {
  if (!Array.isArray(value)) return [];
  const result = [];
  const walk = (current) => {
    if (!current) return;
    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }
    const latitude = Number(current.latitude ?? current.lat);
    const longitude = Number(current.longitude ?? current.lng);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      result.push({
        latitude,
        longitude,
        altitude: Number(current.altitude ?? current.height)
      });
    }
  };
  walk(value);
  return result;
};

const normalizeKmlShape = (shape = {}) => {
  if (!shape || typeof shape !== "object") return shape;
  const next = { ...shape };
  if (Array.isArray(shape.coordinates)) {
    next.coordinates = flattenCoordinateList(shape.coordinates);
  }
  return next;
};

const resolveShapeCoordinates = (shape = {}) => {
  const baseType = `${shape?.type || ""}`.toUpperCase();
  let resolvedType = baseType;
  let coordinates = Array.isArray(shape?.coordinates) ? shape.coordinates : [];
  if (baseType === "GEOMETRYCOLLECTION" && Array.isArray(shape?.geometries)) {
    const grouped = shape.geometries.reduce((acc, item) => {
      const next = resolveShapeCoordinates(item || {});
      if (!next.coordinates.length) return acc;
      acc.coordinates = acc.coordinates.concat(next.coordinates);
      if (!acc.type && next.resolvedType) acc.type = next.resolvedType;
      return acc;
    }, { coordinates: [], type: "" });
    coordinates = grouped.coordinates;
    if (grouped.type) resolvedType = grouped.type;
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

const formatNearbyMarkerLabel = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const chars = Array.from(trimmed);
  if (chars.length <= 7) {
    return chars.join("");
  }
  return `${chars.slice(0, 6).join("")}…`;
};

const buildMarkerNameCallout = (content, overrides = {}) => {
  if (!content) {
    return null;
  }
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

function ensureMapMarkerId(page, value) {
  if (Number.isFinite(value)) return Number(value);
  const text = value === undefined || value === null ? "" : `${value}`.trim();
  if (!text) {
    page._mapMarkerIdSeq += 1;
    return page._mapMarkerIdSeq;
  }
  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;
  if (!page._mapMarkerIdMap) {
    page._mapMarkerIdMap = new Map();
    page._mapMarkerIdSeq = 100000;
  }
  if (page._mapMarkerIdMap.has(text)) {
    return page._mapMarkerIdMap.get(text);
  }
  page._mapMarkerIdSeq += 1;
  const mapped = page._mapMarkerIdSeq;
  page._mapMarkerIdMap.set(text, mapped);
  return mapped;
}

function normalizeMapMarkerId(page, marker) {
  if (!marker || typeof marker !== "object") return marker;
  const rawId =
    marker.id !== undefined && marker.id !== null
      ? marker.id
      : marker.markerId ?? marker.markerID;
  marker.id = ensureMapMarkerId(page, rawId);
  return marker;
}

function normalizeMapMarkerList(page, list) {
  if (!Array.isArray(list)) return list;
  list.forEach((marker) => normalizeMapMarkerId(page, marker));
  return list;
}

function getCurrentScaleInMeters(page, scale = page.data.scale, latitude) {
  const latSource =
    latitude ??
    page._centerOverride?.latitude ??
    page.data.center?.latitude;
  return page.estimateScaleBarMeters(scale, latSource);
}

function resolveMarkerDisplayMode(raw = {}, scaleInMeters) {
  return resolveMapDisplayMode(raw, scaleInMeters);
}

function applyDisplayModeToMarker(page, marker = {}, raw = {}, options = {}) {
  if (!marker || typeof marker !== "object") {
    return null;
  }
  const hasDisplayConfig =
    !!raw &&
    typeof raw === "object" &&
    (
      Object.prototype.hasOwnProperty.call(raw, "mapDisplayMode") ||
      (
        raw.mapDisplayModes &&
        typeof raw.mapDisplayModes === "object" &&
        Object.keys(raw.mapDisplayModes).length > 0
      )
    );
  if (!hasDisplayConfig) {
    return Object.assign({}, marker);
  }
  const mode = resolveMarkerDisplayMode(raw, options.scaleInMeters);
  if (!mode || mode === DISPLAY_MODE_HIDDEN) {
    return null;
  }
  const next = Object.assign({}, marker);
  const extData = Object.assign({}, next.extData || {});
  extData.mapDisplayMode = mode;
  next.extData = extData;
  if (next.callout) {
    next.callout = Object.assign({}, next.callout, {
      display: mode === DISPLAY_MODE_ICON_WITH_NAME ? "ALWAYS" : "BYCLICK"
    });
  }
  if (mode === DISPLAY_MODE_SMALL_ICON_ONLY) {
    const size = getDisplayModeMarkerSize(mode, options.baseSize || next.width || next.height);
    next.width = size;
    next.height = size;
  }
  return next;
}

function buildCanonicalMarkerKey(marker = {}) {
  if (!marker || typeof marker !== "object") return "";
  const source = `${marker?.extData?.source || marker?.source || ""}`.trim().toLowerCase();
  const raw = marker?.extData?.raw || {};
  const detail = marker?.extData?.detail || {};
  const isPin =
    source.includes("pin") ||
    raw?.pinIdNew !== undefined ||
    raw?.shape ||
    raw?.visibility ||
    detail?.shape;
  const candidates = isPin
    ? [raw?.pinIdNew, raw?.id, detail?.markerId, detail?.id, marker?.markerId, marker?.id]
    : [raw?.markIdNew, raw?.markId, raw?.id, detail?.markerId, detail?.id, marker?.markerId, marker?.id];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && `${candidate}`.trim()) {
      return `${isPin ? "pin" : "marker"}:${`${candidate}`.trim()}`;
    }
  }
  const latitude = Number(marker?.latitude);
  const longitude = Number(marker?.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `${source || "map"}:${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  }
  return "";
}

function dedupeMapMarkers(list = []) {
  if (!Array.isArray(list) || !list.length) return [];
  const seen = new Set();
  const result = [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const marker = list[i];
    const key = buildCanonicalMarkerKey(marker);
    if (key && seen.has(key)) {
      continue;
    }
    if (key) {
      seen.add(key);
    }
    result.unshift(marker);
  }
  return result;
}

function findMarkerById(page, markerId) {
  if (markerId === undefined || markerId === null) return null;
  const targetId = ensureMapMarkerId(page, markerId);
  const nearby = Array.isArray(page._nearbyMarkers) ? page._nearbyMarkers : [];
  const nearbyPins = Array.isArray(page._nearbyPinMarkers) ? page._nearbyPinMarkers : [];
  const search = Array.isArray(page._searchMarkers) ? page._searchMarkers : [];
  const mapTapTarget = Array.isArray(page._mapTapTargetMarkers) ? page._mapTapTargetMarkers : [];
  const preview = page._previewMarker ? [page._previewMarker] : [];
  const manual = Array.isArray(page._manualMarkers) ? page._manualMarkers : [];
  const combined = manual.concat(nearbyPins, nearby, search, mapTapTarget, preview);
  for (const marker of combined) {
    const currentId = ensureMapMarkerId(page, marker?.id ?? marker?.markerId ?? marker?.markerID);
    if (currentId === targetId) {
      return marker;
    }
  }
  return null;
}

function normalizeMarkerDetail(page, raw = {}) {
  return normalizeMarkerDetailUtil(raw, { apiBase: page.getApiBase() });
}

function composeMarkerDetail(page, raw = {}, marker = {}, overrides = {}) {
  const normalized = normalizeMarkerDetail(page, raw || {});
  const detail = { ...normalized };
  const source = overrides.source || marker?.extData?.source || "";
  const fallbackName =
    overrides.name ||
    normalized.name ||
    marker?.title ||
    marker?.name ||
    "";
  if (fallbackName && !detail.name) {
    detail.name = fallbackName;
  }
  const fallbackLocation =
    overrides.locationText ||
    normalized.locationText ||
    marker?.address ||
    marker?.locationText ||
    "";
  if (fallbackLocation && !detail.locationText) {
    detail.locationText = fallbackLocation;
  }
  const latitudeCandidates = [
    overrides.latitude,
    marker?.latitude,
    raw?.location?.latitude,
    raw?.location?.lat,
    raw?.latitude,
    raw?.lat,
    normalized.latitude,
    normalized.lat
  ];
  for (const candidate of latitudeCandidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) {
      detail.latitude = value;
      break;
    }
  }
  const longitudeCandidates = [
    overrides.longitude,
    marker?.longitude,
    raw?.location?.longitude,
    raw?.location?.lng,
    raw?.longitude,
    raw?.lng,
    normalized.longitude,
    normalized.lng
  ];
  for (const candidate of longitudeCandidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) {
      detail.longitude = value;
      break;
    }
  }
  const idCandidates = [
    raw?.markIdNew,
    raw?.markId,
    overrides.id,
    raw?.id,
    raw?.markerId,
    marker?.id,
    normalized.id
  ];
  for (const candidate of idCandidates) {
    if (candidate !== undefined && candidate !== null && `${candidate}` !== "") {
      if (!detail.id) {
        detail.id = candidate;
      }
      detail.markerId = `${candidate}`;
      break;
    }
  }
  if (!detail.markerId) {
    detail.markerId = detail.id || "";
  }
  if (!detail.creatorName) {
    detail.creatorName =
      overrides.creatorName ||
      raw?.creatorName ||
      marker?.creatorName ||
      normalized.creatorName ||
      "";
  }
  if (source) {
    detail.source = source;
  }
  if (!detail.raw) {
    detail.raw = raw;
  }
  if (!detail.reviewStatus) {
    const reviewStatus =
      raw?.reviewStatus ??
      raw?.raw?.reviewStatus ??
      raw?.status ??
      raw?.raw?.status;
    if (reviewStatus !== undefined && reviewStatus !== null && `${reviewStatus}`.trim()) {
      detail.reviewStatus = reviewStatus;
    }
  }
  if (detail.shareDisabled === undefined) {
    const shareDisabled = raw?.shareDisabled ?? raw?.raw?.shareDisabled;
    if (shareDisabled !== undefined) {
      detail.shareDisabled = shareDisabled;
    }
  }
  return page.applyMarkerCertificationState(detail);
}

function createMarkerSearchPayload(page, raw = {}, options = {}) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const detail = composeMarkerDetail(page, raw, {}, {
    source: options.source || "marker-search",
    id: raw.id,
    name: raw.name,
    locationText: raw.location?.text
  });
  const latitude = Number(detail.latitude);
  const longitude = Number(detail.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const gcj = wgs84ToGcj02(longitude, latitude);
  const latGcj = Number.isFinite(gcj?.lat) ? gcj.lat : latitude;
  const lngGcj = Number.isFinite(gcj?.lng) ? gcj.lng : longitude;
  const markerId =
    detail.markerId ||
    detail.id ||
    options.fallbackId ||
    `marker-search-${Date.now()}`;
  const title =
    detail.name ||
    detail.locationText ||
    options.fallbackTitle ||
    "低空星球标记";
  const address = detail.locationText || "";
  return {
    markerId,
    title,
    address,
    latitude: latGcj,
    longitude: lngGcj,
    detail,
    raw
  };
}

function buildMarkerSuggestionFromPayload(payload) {
  if (!payload) return null;
  if (!Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude)) {
    return null;
  }
  return {
    id: payload.markerId || `marker-result-${Date.now()}`,
    title: payload.title,
    address: payload.address,
    latitude: payload.latitude,
    longitude: payload.longitude,
    source: "marker",
    markerId: payload.markerId,
    markerPayload: payload
  };
}

function buildPinSuggestionFromPayload(payload) {
  if (!payload) return null;
  if (!Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude)) {
    return null;
  }
  const title = payload.name || payload.locationText || "低空星球标记";
  return {
    id: payload.id || `pin-result-${Date.now()}`,
    title,
    address: payload.locationText || "",
    latitude: payload.latitude,
    longitude: payload.longitude,
    source: "pin",
    pinPayload: payload
  };
}

function buildMarkerFromSearchPayload(page, payload, options = {}) {
  if (!payload || !Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude)) {
    return null;
  }
  const detail = payload.detail;
  if (!detail) return null;
  const markerTitle = payload.title || detail.name || "低空星球标记";
  const markerId = payload.markerId || options.fallbackId || `marker-search-${Date.now()}`;
  const marker = {
    id: markerId,
    latitude: payload.latitude,
    longitude: payload.longitude,
    title: markerTitle,
    iconPath: options.iconPath || "/assets/drone.png",
    width: options.width || 44,
    height: options.height || 44,
    extData: {
      source: options.source || detail.source || "marker-search",
      raw: payload.raw || detail.raw || detail,
      detail: cloneMarkerDetail(detail)
    }
  };
  const calloutContent = formatNearbyMarkerLabel(markerTitle);
  if (calloutContent) {
    marker.callout = buildMarkerNameCallout(calloutContent);
  }
  return marker;
}

function buildQqSuggestion(poi = {}, index = 0) {
  if (!poi || typeof poi !== "object") {
    return null;
  }
  const lat = Number(poi.location?.lat);
  const lng = Number(poi.location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const title = poi.title || "";
  const address = poi.address || poi.category || "";
  return {
    id: poi.id || poi.adcode || index,
    title,
    address,
    latitude: lat,
    longitude: lng,
    source: "qqmap",
    rawPoi: poi
  };
}

function buildQqSearchMarker(page, poi = {}, index = 0) {
  const suggestion = buildQqSuggestion(poi, index);
  if (!suggestion) return null;
  const marker = {
    id: suggestion.id || `qq-${index}`,
    latitude: suggestion.latitude,
    longitude: suggestion.longitude,
    title: suggestion.title,
    width: 24,
    height: 24
  };
  if (suggestion.address) {
    marker.callout = {
      content: `${suggestion.title}\n${suggestion.address}`,
      display: "ALWAYS",
      borderRadius: 4,
      padding: 4
    };
  }
  const rawDetail = {
    id: marker.id,
    name: suggestion.title,
    title: suggestion.title,
    address: suggestion.address,
    location: { text: suggestion.address }
  };
  const detail = composeMarkerDetail(page, rawDetail, marker, {
    source: "search",
    name: suggestion.title,
    locationText: suggestion.address,
    id: marker.id
  });
  marker.extData = Object.assign({}, marker.extData, {
    source: "search",
    raw: rawDetail,
    detail: cloneMarkerDetail(detail)
  });
  return marker;
}

function buildCoordinateSearchMarker(page, payload = {}, options = {}) {
  const displayLatitude = Number(payload.latitude);
  const displayLongitude = Number(payload.longitude);
  if (!Number.isFinite(displayLatitude) || !Number.isFinite(displayLongitude)) {
    return null;
  }
  const gcj = convertParsedCoordinateToGcj02(payload, page.data.coordinateSystem);
  const latitude = Number(gcj?.lat);
  const longitude = Number(gcj?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const title = `${payload.title || "经纬度位置"}`.trim();
  const address = `${payload.address || ""}`.trim();
  const rawDetail = {
    id: payload.id || `coordinate-search-${Date.now()}`,
    name: title,
    title,
    address,
    latitude,
    longitude,
    displayLatitude,
    displayLongitude,
    coordinateSystem: page.data.coordinateSystem,
    location: { text: address }
  };
  const marker = {
    id: rawDetail.id,
    latitude,
    longitude,
    title
  };
  if (title || address) {
    marker.callout = {
      content: address ? `${title}\n${address}` : title,
      display: "ALWAYS",
      borderRadius: 4,
      padding: 4
    };
  }
  const detail = composeMarkerDetail(page, rawDetail, marker, {
    source: options.source || "coordinate-search",
    name: title,
    locationText: address,
    id: rawDetail.id
  });
  marker.extData = {
    source: options.source || "coordinate-search",
    raw: rawDetail,
    detail: cloneMarkerDetail(detail)
  };
  return marker;
}

function resolveMarkerDetail(page, marker) {
  if (!marker) return null;
  const extDetail = marker?.extData?.detail;
  if (extDetail) {
    return composeMarkerDetail(page, extDetail.raw || extDetail, marker, {
      source: marker?.extData?.source,
      name: extDetail.name,
      locationText: extDetail.locationText,
      id: extDetail.markerId || extDetail.id
    });
  }
  const raw = (marker?.extData && marker.extData.raw) || marker;
  return composeMarkerDetail(page, raw, marker, {
    source: marker?.extData?.source
  });
}

function createPinSearchPayload(page, raw = {}, options = {}) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const detail = composeMarkerDetail(page, raw, {}, {
    source: options.source || "pin-search",
    id: raw.id,
    name: raw.name || raw.title,
    locationText: raw.location?.text || raw.address
  });
  const shapeRaw = raw?.shape || {};
  const shapeType = `${shapeRaw.type || ""}`.toUpperCase();
  const shape = isKmlShapeType(shapeType) ? normalizeKmlShape(shapeRaw) : shapeRaw;
  const resolved = resolveShapeCoordinates(shape);
  const resolvedShapeType = `${resolved.resolvedType || shapeType || "POINT"}`.toUpperCase();
  const coords = page.normalizePreviewCoordinateList(resolved.coordinates);
  const primary =
    coords.find((coord) => hasValidCoordinate(coord?.latitude, coord?.longitude)) ||
    detail ||
    {};
  const center =
    resolvedShapeType !== "POINT"
      ? page.computePinPreviewCenter(
        {
          type: resolvedShapeType,
          coordinates: coords,
          radius: Number(shape.radius ?? shape.radiusKm ?? shape.radiusInKilometers),
          width: Number(shape.width ?? shape.bufferWidth ?? shape.bufferWidthMeters ?? shape.pathDistanceMeters),
          pointCategory: shape.pointCategory || shape.pointcategory,
          style: shape.style
        },
        {}
      )
      : null;
  const target = center || primary;
  const latitude = Number(target.latitude);
  const longitude = Number(target.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const markerId =
    detail.markerId ||
    detail.id ||
    options.fallbackId ||
    `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: markerId,
    latitude,
    longitude,
    target: {
      latitude,
      longitude
    },
    shapeType: resolvedShapeType,
    name: detail.name || "",
    locationText: detail.locationText || "",
    detail,
    raw
  };
}

function buildPinSearchMarker(payload = {}, options = {}) {
  if (!payload) return null;
  const marker = {
    id: payload.id || `pin-${Date.now()}`,
    latitude: payload.latitude,
    longitude: payload.longitude,
    title: payload.name,
    iconPath: "/assets/default.png",
    width: 44,
    height: 44
  };
  const calloutContent = formatNearbyMarkerLabel(payload.name || "");
  if (calloutContent) {
    marker.callout = buildMarkerNameCallout(calloutContent, {
      color: "#14532d",
      borderColor: "#14532d"
    });
  }
  marker.extData = {
    source: options.source || "pin-search",
    raw: payload.raw || {},
    detail: cloneMarkerDetail(payload.detail || {})
  };
  return marker;
}

function isAreaPinSearchPayload(payload = {}) {
  const shapeType = `${payload?.shapeType || payload?.raw?.shape?.type || ""}`.toUpperCase();
  return !!shapeType && shapeType !== "POINT";
}

function resolvePinSearchTarget(payload = {}) {
  const target = payload?.target || payload;
  const latitude = Number(target?.latitude);
  const longitude = Number(target?.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude, longitude };
  }
  return null;
}

module.exports = {
  ensureMapMarkerId,
  normalizeMapMarkerId,
  normalizeMapMarkerList,
  getCurrentScaleInMeters,
  resolveMarkerDisplayMode,
  applyDisplayModeToMarker,
  buildCanonicalMarkerKey,
  dedupeMapMarkers,
  findMarkerById,
  normalizeMarkerDetail,
  composeMarkerDetail,
  createMarkerSearchPayload,
  buildMarkerSuggestionFromPayload,
  buildPinSuggestionFromPayload,
  buildMarkerFromSearchPayload,
  buildQqSuggestion,
  buildQqSearchMarker,
  buildCoordinateSearchMarker,
  resolveMarkerDetail,
  createPinSearchPayload,
  buildPinSearchMarker,
  isAreaPinSearchPayload,
  resolvePinSearchTarget
};
