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
const { fetchElevationSnapshot, distanceBetweenCenters } = require("../../../utils/elevation");
const { hasValidCoordinate } = require("./map-shared");
const { cloneMarkerDetail } = require("./marker-shared");

const SEARCH_LINK_OWNER_SEARCH = "search";
const SEARCH_LINK_OWNER_MAP_TAP = "map-tap";
const SEARCH_LINK_ELEVATION_MATCH_METERS = 20;

function isSameSearchLinkPoint(pointA = {}, pointB = {}) {
  const distance = distanceBetweenCenters(pointA, pointB);
  return Number.isFinite(distance) && distance <= SEARCH_LINK_ELEVATION_MATCH_METERS;
}

function formatSearchLinkElevationDiff(diffMeters) {
  const numeric = Number(diffMeters);
  if (!Number.isFinite(numeric)) {
    return "";
  }
  const rounded = Math.round(numeric);
  const prefix = rounded > 0 ? "+" : "";
  return `${prefix}${rounded}m`;
}

function buildCenterPinLinkTipText(distanceText = "", elevationDiffText = "") {
  if (!distanceText) {
    return "";
  }
  return elevationDiffText
    ? `距离${distanceText}，高差${elevationDiffText}，长按解除`
    : `距离${distanceText}，长按解除`;
}

function resetSearchLinkElevationDiff(page) {
  page._searchLinkElevationDiffState = null;
  page._searchLinkElevationDiffRequestKey = "";
}

function readSearchLinkElevationDiffText(page, center, target) {
  const state = page._searchLinkElevationDiffState;
  if (!state) {
    return "";
  }
  if (!isSameSearchLinkPoint(state.center, center) || !isSameSearchLinkPoint(state.target, target)) {
    return "";
  }
  return `${state.diffText || ""}`.trim();
}

function resolveCenterElevationSnapshot(page, center = {}) {
  const snapshot = page._elevationSnapshot;
  if (
    !snapshot ||
    !hasValidCoordinate(snapshot.center?.latitude, snapshot.center?.longitude) ||
    !isSameSearchLinkPoint(snapshot.center, center)
  ) {
    return Promise.resolve(null);
  }
  return Promise.resolve(snapshot);
}

function requestSearchLinkElevationDiff(page, target = {}, options = {}) {
  const center = options.center || page.data.searchLinkCenter || page._centerOverride || page.data.center;
  if (
    !hasValidCoordinate(center?.latitude, center?.longitude) ||
    !hasValidCoordinate(target?.latitude, target?.longitude)
  ) {
    resetSearchLinkElevationDiff(page);
    return Promise.resolve(null);
  }
  const requestKey = `${Number(center.latitude).toFixed(6)},${Number(center.longitude).toFixed(6)}|${Number(target.latitude).toFixed(6)},${Number(target.longitude).toFixed(6)}`;
  page._searchLinkElevationDiffRequestKey = requestKey;
  const centerPromise = resolveCenterElevationSnapshot(page, center)
    .then((snapshot) => snapshot || fetchElevationSnapshot(center));
  const targetPromise = fetchElevationSnapshot(target);
  return Promise.all([centerPromise, targetPromise])
    .then(([centerSnapshot, targetSnapshot]) => {
      if (page._searchLinkElevationDiffRequestKey !== requestKey) {
        return null;
      }
      const centerElevation = Number(centerSnapshot?.elevationMeters);
      const targetElevation = Number(targetSnapshot?.elevationMeters);
      if (!Number.isFinite(centerElevation) || !Number.isFinite(targetElevation)) {
        resetSearchLinkElevationDiff(page);
        return null;
      }
      page._searchLinkElevationDiffState = {
        center: {
          latitude: Number(center.latitude),
          longitude: Number(center.longitude)
        },
        target: {
          latitude: Number(target.latitude),
          longitude: Number(target.longitude)
        },
        diffText: formatSearchLinkElevationDiff(centerElevation - targetElevation)
      };
      const linkState = buildCenterPinLinkState(page, page.data.searchLinkCenter || center, {
        target: page.data.searchLinkTarget || target,
        visible: page.data.searchLinkVisible === true,
        owner: page._searchLinkOwner
      });
      if (linkState.centerPinLinkActive) {
        page.setData({
          centerPinLinkActive: true,
          centerPinLinkTipText: linkState.centerPinLinkTipText
        });
      }
      return page._searchLinkElevationDiffState;
    })
    .catch(() => null)
    .finally(() => {
      if (page._searchLinkElevationDiffRequestKey === requestKey) {
        page._searchLinkElevationDiffRequestKey = "";
      }
    });
}

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
  const elevationDiffText = readSearchLinkElevationDiffText(page, center, target);
  return {
    centerPinLinkActive: true,
    centerPinLinkTipText: buildCenterPinLinkTipText(distanceText, elevationDiffText)
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
  resetSearchLinkElevationDiff(page);
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
  }, () => {
    if (hasTarget) {
      requestSearchLinkElevationDiff(page, nextTarget, {
        center: page.data.searchLinkCenter || page._centerOverride || page.data.center || null
      });
    }
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
    resetSearchLinkElevationDiff(page);
    page.setData({
      searchLinkTarget: null,
      searchLinkVisible: false,
      centerPinLinkActive: false,
      centerPinLinkTipText: ""
    });
    return true;
  }
  page._searchLinkOwner = "";
  resetSearchLinkElevationDiff(page);
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
  requestSearchLinkElevationDiff,
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
