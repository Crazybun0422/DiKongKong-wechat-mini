const { wgs84ToGcj02 } = require("../../../utils/coords");
const { buildNoFlyZoneGraphics } = require("../../../utils/no-fly-zones");

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

function applyNearbyMarkers(page, list) {
  page._nearbyMarkersRaw = Array.isArray(list) ? list.slice() : [];
  rebuildNearbyMarkerGraphics(page);
}

function buildNearbyMerchantMarker(page, item = {}, index = 0, scaleInMeters = null) {
  const latValue = Number(
    item?.location?.latitude ??
    item?.location?.lat ??
    item?.latitude ??
    item?.lat
  );
  const lngValue = Number(
    item?.location?.longitude ??
    item?.location?.lng ??
    item?.longitude ??
    item?.lng
  );
  if (!Number.isFinite(latValue) || !Number.isFinite(lngValue)) return null;
  const gcj = wgs84ToGcj02(lngValue, latValue);
  const latitudeGcj = Number.isFinite(gcj?.lat) ? gcj.lat : latValue;
  const longitudeGcj = Number.isFinite(gcj?.lng) ? gcj.lng : lngValue;
  const name =
    (typeof item?.name === "string" && item.name) ||
    (typeof item?.title === "string" && item.title) ||
    (typeof item?.location?.text === "string" && item.location.text) ||
    "";
  const locationText =
    (typeof item?.location?.text === "string" && item.location.text) ||
    (typeof item?.address === "string" && item.address) ||
    (typeof item?.locationText === "string" && item.locationText) ||
    "";
  const marker = {
    id: item?.id || `nearby-${index}`,
    latitude: latitudeGcj,
    longitude: longitudeGcj,
    title: name,
    iconPath: "/assets/drone.png",
    width: 40,
    height: 40
  };
  const displayMode = page.resolveMarkerDisplayMode(item, scaleInMeters);
  if (displayMode === page.DISPLAY_MODE_HIDDEN || displayMode === "HIDDEN") {
    return null;
  }
  const calloutContent = formatNearbyMarkerLabel(name);
  if (calloutContent) {
    marker.callout = buildMarkerNameCallout(calloutContent);
  }
  const detail = page.composeMarkerDetail(item, marker, {
    source: "nearby",
    name,
    locationText,
    latitude: latitudeGcj,
    longitude: longitudeGcj,
    id: item?.id || marker.id
  });
  marker.extData = Object.assign({}, marker.extData, {
    source: "nearby",
    raw: item,
    detail: cloneMarkerDetail(detail)
  });
  return page.applyDisplayModeToMarker(marker, item, {
    scaleInMeters,
    baseSize: 40
  });
}

function rebuildNearbyMarkerGraphics(page) {
  const rawList = Array.isArray(page._nearbyMarkersRaw) ? page._nearbyMarkersRaw : [];
  const scaleInMeters = page.getCurrentScaleInMeters(page.data.scale);
  page._nearbyMarkers = rawList
    .map((item, index) => buildNearbyMerchantMarker(page, item, index, scaleInMeters))
    .filter(Boolean);
  page.trackMarkerExposure(page._nearbyMarkers);
  page.syncAllMarkers();
}

function refreshNearbyDisplayModes(page) {
  if (Array.isArray(page._nearbyMarkersRaw) && page._nearbyMarkersRaw.length) {
    rebuildNearbyMarkerGraphics(page);
  } else {
    page.syncAllMarkers();
  }
  if (Array.isArray(page._nearbyPinsRaw) && page._nearbyPinsRaw.length) {
    rebuildNearbyPinGraphics(page);
  }
}

function applyNearbyPins(page, list) {
  page._nearbyPinsRaw = Array.isArray(list) ? list : [];
  rebuildNearbyPinGraphics(page);
  page.updateCenterPinIndicator();
  page.trackPinExposure(page._nearbyPinMarkers);
}

function rebuildNearbyPinGraphics(page) {
  if (!page.isPinLayerEnabled()) {
    page._nearbyPinMarkers = [];
    page._nearbyPinPolygons = [];
    page._nearbyPinCircles = [];
    page._lastNearbyPinFetch = null;
    page.updateOverlayGraphics();
    page.syncAllMarkers();
    page.updateCenterPinIndicator();
    return;
  }
  const previewId = page._previewPinId ? `${page._previewPinId}` : "";
  const markers = [];
  const polygons = [];
  const circles = [];
  const rawList = Array.isArray(page._nearbyPinsRaw) ? page._nearbyPinsRaw : [];
  const scaleInMeters = page.getCurrentScaleInMeters(page.data.scale);
  rawList.forEach((item, index) => {
    const pin = page.normalizeNearbyPin(item);
    if (!pin || !page.isPinVisibilityEnabled(pin.visibility)) return;
    if (previewId && `${pin.id || ""}` === previewId) return;
    if (pin.shape.type === "POINT") {
      const marker = page.buildPinPreviewMarker({
        id: pin.id || `pin-${index}`,
        name: pin.name,
        location: pin.location,
        shape: pin.shape,
        height: pin.height,
        coordsAreGcj: true,
        raw: item,
        scaleInMeters
      });
      if (marker) {
        marker.extData = Object.assign({}, marker.extData, {
          source: "pin-nearby",
          raw: item
        });
        markers.push(marker);
      }
      return;
    }
    const zone = page.buildPinPreviewZone(pin.shape);
    if (!zone) return;
    const graphics = buildNoFlyZoneGraphics([zone], { color: "#D3A05B" });
    if (Array.isArray(graphics.polygons)) {
      polygons.push(...graphics.polygons);
    }
    if (Array.isArray(graphics.circles)) {
      circles.push(...graphics.circles);
    }
  });
  page._nearbyPinMarkers = markers;
  page._nearbyPinPolygons = polygons;
  page._nearbyPinCircles = circles;
  page.updateOverlayGraphics();
  page.syncAllMarkers();
  page.updateCenterPinIndicator();
}

module.exports = {
  applyNearbyMarkers,
  buildNearbyMerchantMarker,
  rebuildNearbyMarkerGraphics,
  refreshNearbyDisplayModes,
  applyNearbyPins,
  rebuildNearbyPinGraphics
};
