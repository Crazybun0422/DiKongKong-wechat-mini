const {
  ELEVATION_REFRESH_INTERVAL_MS,
  ELEVATION_MOVE_THRESHOLD_METERS,
  hasValidCoordinate,
  fetchElevationSnapshot,
  distanceBetweenCenters
} = require("../../../utils/elevation");

function clearElevationState(page) {
  page._elevationSnapshot = null;
  page.setData({ centerElevationText: "" });
}

function applyElevationSnapshot(page, snapshot = null) {
  page._elevationSnapshot = snapshot || null;
  page.setData({
    centerElevationText: typeof snapshot?.valueText === "string" ? snapshot.valueText : ""
  });
  return snapshot;
}

function shouldFetchElevation(page, center = {}, options = {}) {
  if (!hasValidCoordinate(center)) {
    return false;
  }
  if (options.force === true || !page._elevationSnapshot) {
    return true;
  }
  const previous = page._lastElevationFetch || {};
  const previousCenter = hasValidCoordinate(previous) ? previous : page._elevationSnapshot?.center;
  const movedMeters = distanceBetweenCenters(previousCenter, center);
  const previousTimestamp =
    Number(previous.timestamp) || Number(page._elevationSnapshot?.fetchedAt) || 0;
  const isStale = !previousTimestamp || Date.now() - previousTimestamp > ELEVATION_REFRESH_INTERVAL_MS;
  return movedMeters >= ELEVATION_MOVE_THRESHOLD_METERS || isStale;
}

function scheduleFetchElevation(page, delay = 0, options = {}) {
  if (page._elevationFetchTimer) {
    clearTimeout(page._elevationFetchTimer);
  }
  const center = options?.center || page._centerOverride || page.data.center;
  if (!hasValidCoordinate(center)) {
    page._elevationFetchTimer = null;
    clearElevationState(page);
    return null;
  }
  if (!shouldFetchElevation(page, center, options)) {
    page._elevationFetchTimer = null;
    return null;
  }
  const waitMs = Math.max(0, Number(delay) || 0);
  page.setData({ centerElevationText: "" });
  page._elevationFetchTimer = setTimeout(() => {
    page._elevationFetchTimer = null;
    requestCenterElevation(page, options);
  }, waitMs);
  return page._elevationFetchTimer;
}

function requestCenterElevation(page, options = {}) {
  const center = options?.center || page._centerOverride || page.data.center;
  if (!hasValidCoordinate(center)) {
    clearElevationState(page);
    return Promise.resolve(null);
  }
  if (!shouldFetchElevation(page, center, options)) {
    return Promise.resolve(page._elevationSnapshot);
  }
  const requestId = `${Date.now()}-${Math.random()}`;
  page._activeElevationRequest = requestId;
  return fetchElevationSnapshot(center)
    .then((snapshot) => {
      if (page._activeElevationRequest !== requestId) {
        return null;
      }
      page._lastElevationFetch = {
        latitude: Number(center.latitude),
        longitude: Number(center.longitude),
        timestamp: Date.now()
      };
      applyElevationSnapshot(page, snapshot);
      return snapshot;
    })
    .catch((error) => {
      if (page._activeElevationRequest !== requestId) {
        return null;
      }
      page.setData({ centerElevationText: "" });
      console.warn("requestCenterElevation failed", error);
      return null;
    })
    .finally(() => {
      if (page._activeElevationRequest === requestId) {
        page._activeElevationRequest = null;
      }
    });
}

module.exports = {
  clearElevationState,
  applyElevationSnapshot,
  scheduleFetchElevation,
  requestCenterElevation
};
