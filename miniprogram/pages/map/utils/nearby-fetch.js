const { fetchNearbyMarkers } = require("../../../utils/markers");
const { fetchNearbyPins } = require("../../../utils/pins");
const { haversineMeters, gcj02ToWgs84 } = require("../../../utils/coords");
const { clampMapScale } = require("./map-shared");

function computeMarkerRadiusKm(page, context = {}) {
  const region = context?.region;
  if (region?.northeast && region?.southwest) {
    const { northeast, southwest } = region;
    const diag = haversineMeters(
      northeast.latitude,
      northeast.longitude,
      southwest.latitude,
      southwest.longitude
    );
    if (Number.isFinite(diag) && diag > 0) {
      const radiusKm = Math.max(0.1, diag / 2000);
      return Math.min(radiusKm, 200);
    }
  }
  const scale = clampMapScale(context?.scale || page.data.scale);
  const zoomFactor = Math.pow(2, Math.max(0, (18 - scale) / 1.3));
  return Math.max(0.1, Math.min(200, zoomFactor * 0.8));
}

function scheduleFetchPins(page, delay = 0, options = {}) {
  if (!page.isPinLayerEnabled()) {
    return;
  }
  if (page._pinsFetchTimer) clearTimeout(page._pinsFetchTimer);
  const ms = Math.max(0, Number(delay) || 0);
  const merged = Object.assign({}, options, { force: options.force === true });
  page._pinsFetchTimer = setTimeout(() => {
    page._pinsFetchTimer = null;
    requestNearbyPins(page, merged);
  }, ms);
}

function scheduleFetchMarkers(page, delay = 0, options = {}) {
  if (page.data.merchantMarkersEnabled === false) return;
  if (page._markersFetchTimer) clearTimeout(page._markersFetchTimer);
  const ms = Math.max(0, Number(delay) || 0);
  page._markersFetchTimer = setTimeout(() => {
    page._markersFetchTimer = null;
    requestNearbyMarkers(page, options);
  }, ms);
}

function requestNearbyPins(page, options = {}) {
  if (!page.isPinLayerEnabled()) {
    if (page._pinsFetchTimer) {
      clearTimeout(page._pinsFetchTimer);
      page._pinsFetchTimer = null;
    }
    page._nearbyPinsRaw = [];
    page._nearbyPinMarkers = [];
    page._nearbyPinPolygons = [];
    page._nearbyPinCircles = [];
    page._lastNearbyPinFetch = null;
    page.updateOverlayGraphics();
    page.syncAllMarkers();
    page.updateCenterPinIndicator();
    return;
  }
  const center = options?.center || page._centerOverride || page.data.center;
  if (!center) return;
  const scale = options?.scale || page.data.scale;
  const region = options?.region || page._lastRegion;
  const force = options.force === true;
  if (!force && !page.shouldFetchNearbyMarkers(scale, center.latitude)) {
    if (Array.isArray(page._nearbyPinsRaw) && page._nearbyPinsRaw.length) {
      page._nearbyPinsRaw = [];
      page._nearbyPinMarkers = [];
      page._nearbyPinPolygons = [];
      page._nearbyPinCircles = [];
      page.updateOverlayGraphics();
      page.syncAllMarkers();
    }
    page._lastNearbyPinFetch = null;
    return;
  }
  const radiusKm = computeMarkerRadiusKm(page, { region, scale });
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return;

  const latitude = Number(center.latitude);
  const longitude = Number(center.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  const prev = page._lastNearbyPinFetch || {};
  const moveMeters = haversineMeters(
    center.latitude,
    center.longitude,
    prev.latitude || 0,
    prev.longitude || 0
  );
  const radiusDiff = Math.abs((prev.radiusKm || 0) - radiusKm);
  const now = Date.now();
  const prevTimestamp = Number(prev.timestamp) || 0;
  const isStale = !prevTimestamp || now - prevTimestamp > 60000;
  if (!force && moveMeters < 50 && radiusDiff < 0.2 && !isStale) {
    return;
  }

  const requestId = now;
  page._activePinsRequest = requestId;

  fetchNearbyPins(
    {
      latitude,
      longitude,
      radiusInKilometers: radiusKm,
      scaleInMeters: page.getCurrentScaleInMeters(scale, latitude)
    },
    {
      apiBase: page.getApiBase(),
      token: page.getAuthToken()
    }
  )
    .then((items = []) => {
      if (page._activePinsRequest !== requestId) return;
      page.applyNearbyPins(Array.isArray(items) ? items : []);
      page._lastNearbyPinFetch = {
        latitude: center.latitude,
        longitude: center.longitude,
        radiusKm,
        scale: clampMapScale(scale),
        timestamp: now
      };
    })
    .catch((err) => {
      console.warn("Fetch nearby pins failed", err);
    })
    .finally(() => {
      if (page._activePinsRequest === requestId) {
        page._activePinsRequest = null;
      }
    });
}

function requestNearbyMarkers(page, options = {}) {
  if (page.data.merchantMarkersEnabled === false) {
    page._nearbyMarkersRaw = [];
    page._nearbyMarkers = [];
    page.syncAllMarkers();
    return;
  }
  const center = options?.center || page._centerOverride || page.data.center;
  if (!center) return;
  const scale = options?.scale || page.data.scale;
  const region = options?.region || page._lastRegion;
  const force = options.force === true;
  if (!page.shouldFetchNearbyMarkers(scale, center.latitude)) {
    if (
      (Array.isArray(page._nearbyMarkers) && page._nearbyMarkers.length) ||
      (Array.isArray(page._nearbyMarkersRaw) && page._nearbyMarkersRaw.length)
    ) {
      page._nearbyMarkersRaw = [];
      page._nearbyMarkers = [];
      page.syncAllMarkers();
    }
    page._lastNearbyFetch = null;
    return;
  }
  const radiusKm = computeMarkerRadiusKm(page, { region, scale });
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return;

  const wgs = gcj02ToWgs84(center.longitude, center.latitude);
  const latitude = Number.isFinite(wgs?.lat) ? wgs.lat : Number(center.latitude);
  const longitude = Number.isFinite(wgs?.lng) ? wgs.lng : Number(center.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  const prev = page._lastNearbyFetch || {};
  const moveMeters = haversineMeters(
    center.latitude,
    center.longitude,
    prev.latitude || 0,
    prev.longitude || 0
  );
  const radiusDiff = Math.abs((prev.radiusKm || 0) - radiusKm);
  const now = Date.now();
  const prevTimestamp = Number(prev.timestamp) || 0;
  const isStale = !prevTimestamp || now - prevTimestamp > 60000;
  if (!force && moveMeters < 50 && radiusDiff < 0.2 && !isStale) {
    return;
  }

  const requestId = now;
  page._activeMarkersRequest = requestId;

  fetchNearbyMarkers(
    {
      latitude,
      longitude,
      radiusInKilometers: radiusKm,
      scaleInMeters: page.getCurrentScaleInMeters(scale, center.latitude)
    },
    {
      apiBase: page.getApiBase(),
      token: page.getAuthToken()
    }
  )
    .then((items = []) => {
      if (page._activeMarkersRequest !== requestId) return;
      page.applyNearbyMarkers(Array.isArray(items) ? items : []);
      page._lastNearbyFetch = {
        latitude: center.latitude,
        longitude: center.longitude,
        radiusKm,
        scale: clampMapScale(scale),
        timestamp: now
      };
    })
    .catch((err) => {
      console.warn("Fetch nearby markers failed", err);
    })
    .finally(() => {
      if (page._activeMarkersRequest === requestId) {
        page._activeMarkersRequest = null;
      }
    });
}

module.exports = {
  computeMarkerRadiusKm,
  scheduleFetchPins,
  scheduleFetchMarkers,
  requestNearbyPins,
  requestNearbyMarkers
};
