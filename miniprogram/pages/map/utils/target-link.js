const {
  normalizeMapTapPoint,
  canReplaceMapTapTarget,
  buildMapTapTargetState,
  updateMapTapTargetAddress,
  buildMapTapTargetMarker,
  isMapTapTargetMarker,
  shouldRemoveMapTapTarget
} = require("../../../utils/map-target-link");
const { computeGreatCircleDistance } = require("../../../utils/distance");
const { hasValidCoordinate } = require("./map-shared");
const { cloneMarkerDetail } = require("./marker-shared");

const SEARCH_LINK_OWNER_SEARCH = "search";
const SEARCH_LINK_OWNER_MAP_TAP = "map-tap";

function applySearchMarkers(page, markers) {
  page._searchMarkers = Array.isArray(markers)
    ? markers.map((marker) => {
      if (marker && marker.extData && marker.extData.detail) {
        marker.extData = Object.assign({}, marker.extData, {
          detail: cloneMarkerDetail(marker.extData.detail)
        });
      }
      return marker;
    })
    : [];
  page.syncAllMarkers();
}

function formatCenterPinLinkDistance(distanceMeters) {
  const meters = Number(distanceMeters);
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (meters >= 1000) {
    const km = meters / 1000;
    const display = km >= 10 ? Math.round(km) : Math.round(km * 10) / 10;
    return `${display}km`;
  }
  return `${Math.max(1, Math.round(meters))}m`;
}

function buildCenterPinLinkState(page, center, options = {}) {
  const target = options.target;
  const owner = `${options.owner || ""}`.trim();
  const visible = options.visible === true;
  if (
    page.data.centerTargetLinkEnabled === false ||
    !visible ||
    !owner ||
    !hasValidCoordinate(center?.latitude, center?.longitude) ||
    !hasValidCoordinate(target?.latitude, target?.longitude)
  ) {
    return {
      centerPinLinkActive: false,
      centerPinLinkTipText: ""
    };
  }
  const distanceMeters = computeGreatCircleDistance(center, target);
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0.5) {
    return {
      centerPinLinkActive: false,
      centerPinLinkTipText: ""
    };
  }
  const distanceText = formatCenterPinLinkDistance(distanceMeters);
  return {
    centerPinLinkActive: true,
    centerPinLinkTipText: `距离${distanceText}，长按解除`
  };
}

function clearCenterPinLinkState(page) {
  if (!page.data.centerPinLinkActive && !page.data.centerPinLinkTipText) {
    return;
  }
  page.setData({
    centerPinLinkActive: false,
    centerPinLinkTipText: ""
  });
}

function clearActiveCenterTargetLink(page) {
  if (page._searchLinkOwner === SEARCH_LINK_OWNER_MAP_TAP) {
    clearMapTapTargetPoint(page);
    return true;
  }
  if (page._searchLinkOwner === SEARCH_LINK_OWNER_SEARCH) {
    page.clearSearchSelectionVisuals();
    return true;
  }
  return false;
}

function applySearchLinkTarget(page, target, options = {}) {
  const owner = `${options.owner || ""}`.trim();
  const latitude = Number(target?.latitude);
  const longitude = Number(target?.longitude);
  const hasTarget = Number.isFinite(latitude) && Number.isFinite(longitude);
  const nextTarget = hasTarget ? { latitude, longitude } : null;
  page._searchLinkOwner = owner;
  const linkState = buildCenterPinLinkState(page, page.data.searchLinkCenter, {
    target: nextTarget,
    visible: hasTarget && options.visible !== false,
    owner
  });
  page.setData({
    searchLinkTarget: nextTarget,
    searchLinkVisible: hasTarget && options.visible !== false,
    ...linkState
  });
}

function clearSearchLinkOverlay(page, options = {}) {
  const owner = `${options.owner || ""}`.trim();
  if (
    options.force !== true &&
    owner &&
    page._searchLinkOwner &&
    page._searchLinkOwner !== owner
  ) {
    return false;
  }
  page._searchLinkMarkers = [];
  page._searchLinkPolylines = [];
  page.syncAllPolylines();
  page.syncAllMarkers();
  if (
    page.data.searchLinkTarget ||
    page.data.searchLinkVisible ||
    page.data.centerPinLinkActive ||
    page.data.centerPinLinkTipText ||
    page._searchLinkOwner
  ) {
    page._searchLinkOwner = "";
    page.setData({
      searchLinkTarget: null,
      searchLinkVisible: false,
      centerPinLinkActive: false,
      centerPinLinkTipText: ""
    });
    return true;
  }
  page._searchLinkOwner = "";
  return true;
}

function rebuildMapTapTargetMarker(page) {
  const marker = buildMapTapTargetMarker(page._mapTapTarget);
  page._mapTapTargetMarkers = marker ? [marker] : [];
  page.syncAllMarkers();
}

function clearMapTapTargetPoint(page, options = {}) {
  const hadTarget =
    !!page._mapTapTarget ||
    (Array.isArray(page._mapTapTargetMarkers) && page._mapTapTargetMarkers.length > 0);
  page._mapTapTarget = null;
  page._mapTapTargetMarkers = [];
  page._mapTapTargetResolveToken += 1;
  if (hadTarget) {
    page.syncAllMarkers();
  }
  if (options.preserveSearchLink !== true) {
    clearSearchLinkOverlay(page, { owner: SEARCH_LINK_OWNER_MAP_TAP });
  }
}

function applyMapTapTargetPoint(page, point, options = {}) {
  const target = buildMapTapTargetState(point, options);
  if (!target) return false;
  const tappedAt = Number(options.tappedAt);
  page._mapTapTargetTapAt = Number.isFinite(tappedAt) ? tappedAt : Date.now();
  page._mapTapTargetResolveToken += 1;
  const resolveToken = page._mapTapTargetResolveToken;
  page._mapTapTarget = target;
  rebuildMapTapTargetMarker(page);
  applySearchLinkTarget(page, target, {
    owner: SEARCH_LINK_OWNER_MAP_TAP,
    visible: true
  });
  page.requestPinAddress(target.latitude, target.longitude)
    .then((address) => {
      if (resolveToken !== page._mapTapTargetResolveToken || !page._mapTapTarget) {
        return;
      }
      page._mapTapTarget = updateMapTapTargetAddress(page._mapTapTarget, address);
      rebuildMapTapTargetMarker(page);
    })
    .catch((err) => console.warn("resolve map tap target address failed", err));
  return true;
}

function onMapTap(page, event = {}) {
  if (page.data.centerTargetLinkEnabled === false) {
    return;
  }
  if (Date.now() < (Number(page._mapTapSuppressUntil) || 0)) {
    return;
  }
  const point = normalizeMapTapPoint(event?.detail || event);
  if (!point) return;
  const now = Date.now();
  if (!canReplaceMapTapTarget(page._mapTapTargetTapAt, now)) {
    wx.showToast({ title: "请2秒后再选下一个目标点", icon: "none" });
    return;
  }
  page.clearSearchSelectionVisuals();
  applyMapTapTargetPoint(page, point, { tappedAt: now });
}

function onMapLongPress(page, event = {}) {
  if (!page._mapTapTarget) return;
  const point = normalizeMapTapPoint(event?.detail || event);
  if (!point) return;
  if (!shouldRemoveMapTapTarget(page._mapTapTarget, point)) {
    return;
  }
  page._mapTapSuppressUntil = Date.now() + 800;
  clearMapTapTargetPoint(page);
}

function onSearchLinkGraphicsChange(page, event = {}) {
  const detail = event?.detail || {};
  page._searchLinkMarkers = Array.isArray(detail.markers) ? detail.markers : [];
  page._searchLinkPolylines = Array.isArray(detail.polylines) ? detail.polylines : [];
  page.queueMapGraphicsSync({ markers: true, polylines: true });
}

module.exports = {
  isMapTapTargetMarker,
  applySearchMarkers,
  formatCenterPinLinkDistance,
  buildCenterPinLinkState,
  clearCenterPinLinkState,
  clearActiveCenterTargetLink,
  applySearchLinkTarget,
  clearSearchLinkOverlay,
  rebuildMapTapTargetMarker,
  clearMapTapTargetPoint,
  applyMapTapTargetPoint,
  onMapTap,
  onMapLongPress,
  onSearchLinkGraphicsChange
};
