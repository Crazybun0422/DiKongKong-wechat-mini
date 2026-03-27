const MY_LOCATION_DIRECTION_THRESHOLD = 1;
const MY_LOCATION_DIRECTION_SYNC_INTERVAL_MS = 500;

function normalizeCompassDirection(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  let normalized = numeric % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
}

function computeCompassDirectionDelta(page, next, prev) {
  const a = normalizeCompassDirection(next);
  const b = normalizeCompassDirection(prev);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  let delta = Math.abs(a - b) % 360;
  if (delta > 180) delta = 360 - delta;
  return delta;
}

function startMyLocationDirectionTracking(page) {
  if (page._myLocationDirectionTracking) return;
  if (
    typeof wx === "undefined" ||
    typeof wx.startCompass !== "function" ||
    typeof wx.onCompassChange !== "function"
  ) {
    return;
  }
  const onCompassChange = (res = {}) => {
    const now = Date.now();
    if (now - Number(page._myLocationDirectionLastSyncAt || 0) < MY_LOCATION_DIRECTION_SYNC_INTERVAL_MS) {
      return;
    }
    const direction = normalizeCompassDirection(res.direction);
    if (!Number.isFinite(direction)) return;
    const prev = normalizeCompassDirection(page._myLocationDirection);
    if (
      Number.isFinite(prev) &&
      computeCompassDirectionDelta(page, direction, prev) < MY_LOCATION_DIRECTION_THRESHOLD
    ) {
      return;
    }
    page._myLocationDirection = direction;
    page._myLocationDirectionLastSyncAt = now;
    if (Array.isArray(page._myLocationMarkers) && page._myLocationMarkers.length > 0) {
      const point = page.data.myLocationPoint || page._lastKnownLocation || null;
      page.refreshMyLocationGraphics(point);
    }
  };
  page._onMyLocationCompassChange = onCompassChange;
  page._myLocationDirectionTracking = true;
  wx.onCompassChange(onCompassChange);
  wx.startCompass({
    fail: (err) => {
      console.warn("start compass fail", err);
    }
  });
}

function stopMyLocationDirectionTracking(page) {
  if (!page._myLocationDirectionTracking) return;
  if (
    typeof wx !== "undefined" &&
    page._onMyLocationCompassChange &&
    typeof wx.offCompassChange === "function"
  ) {
    wx.offCompassChange(page._onMyLocationCompassChange);
  }
  page._onMyLocationCompassChange = null;
  page._myLocationDirectionTracking = false;
  page._myLocationDirectionLastSyncAt = 0;
  if (typeof wx !== "undefined" && typeof wx.stopCompass === "function") {
    wx.stopCompass({
      fail: () => { }
    });
  }
}

module.exports = {
  normalizeCompassDirection,
  computeCompassDirectionDelta,
  startMyLocationDirectionTracking,
  stopMyLocationDirectionTracking
};
