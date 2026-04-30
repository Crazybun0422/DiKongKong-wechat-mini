const { haversineMeters } = require("../../../utils/coords");
const { playVoicePackEvent } = require("../../../utils/voice-pack");
const EARTH_RADIUS_METERS = 6378137;
const EARTH_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS_METERS;
const WEB_TILE_SIZE = 256;
const METERS_PER_PIXEL_BASE = EARTH_CIRCUMFERENCE / WEB_TILE_SIZE;
const {
  DEFAULT_CENTER,
  MAP_MAX_SCALE,
  DEFAULT_MAP_SCALE,
  DEFAULT_SCALE_BAR_BASE_RPX,
  MIN_CENTER_SYNC_METERS,
  MAP_COMPASS_ROTATE_THRESHOLD,
  MAP_COMPASS_ROTATE_SYNC_DELTA,
  MAP_COMPASS_SKEW_SYNC_DELTA,
  hasValidCoordinate,
  clampMapScale
} = require("./map-shared");

const normalizeMapRotate = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  let normalized = numeric % 360;
  if (normalized < 0) normalized += 360;
  return normalized;
};

function updateMapGestureState(page, detail = {}) {
  const now = Date.now();
  const skew = Number(detail?.skew);
  if (Number.isFinite(skew)) {
    const prevSkew = page._mapSkew;
    page._mapSkew = skew;
    if ((Number.isFinite(prevSkew) && prevSkew !== skew) || skew > 0) {
      page._overlookSyncAvoidUntil = now + 400;
    }
  }
  const rotate = Number(detail?.rotate);
  if (Number.isFinite(rotate)) {
    const prevRotate = page._mapRotate;
    page._mapRotate = rotate;
    if (Number.isFinite(prevRotate) && prevRotate !== rotate) {
      page._overlookSyncAvoidUntil = now + 400;
    }
  }
  if (Number.isFinite(skew) || Number.isFinite(rotate)) {
    syncCompassState(page, { rotate, skew });
  }
}

function syncCompassState(page, detail = {}) {
  const rotateValue = Object.prototype.hasOwnProperty.call(detail, "rotate")
    ? detail.rotate
    : page._mapRotate;
  const normalized = normalizeMapRotate(rotateValue);
  if (!Number.isFinite(normalized)) return;
  const skewValue = Object.prototype.hasOwnProperty.call(detail, "skew")
    ? detail.skew
    : page._mapSkew;
  const normalizedSkew = Number.isFinite(skewValue) ? Math.max(0, Math.min(60, skewValue)) : 0;
  const distance = normalized > 180 ? 360 - normalized : normalized;
  const shouldShow = distance >= MAP_COMPASS_ROTATE_THRESHOLD;
  const updates = {};
  if (shouldShow) {
    if (
      !Number.isFinite(page.data.mapRotate)
      || Math.abs(page.data.mapRotate - normalized) >= MAP_COMPASS_ROTATE_SYNC_DELTA
    ) {
      updates.mapRotate = normalized;
    }
    if (
      !Number.isFinite(page.data.compassRotate)
      || Math.abs(page.data.compassRotate - normalized) >= MAP_COMPASS_ROTATE_SYNC_DELTA
    ) {
      updates.compassRotate = normalized;
    }
  } else {
    if (page.data.mapRotate !== 0) {
      updates.mapRotate = 0;
    }
    if (page.data.compassRotate !== 0) {
      updates.compassRotate = 0;
    }
  }
  if (
    !Number.isFinite(page.data.compassSkew)
    || Math.abs(page.data.compassSkew - normalizedSkew) >= MAP_COMPASS_SKEW_SYNC_DELTA
  ) {
    updates.compassSkew = normalizedSkew;
  }
  if (shouldShow !== page.data.compassVisible) {
    updates.compassVisible = shouldShow;
  }
  if (Object.keys(updates).length) {
    page.setData(updates);
  }
}

function resetCompassState(page) {
  page._mapRotate = 0;
  page._mapSkew = 0;
  const updates = {};
  if (page.data.mapRotate !== 0) {
    updates.mapRotate = 0;
  }
  if (page.data.mapSkew !== 0) {
    updates.mapSkew = 0;
  }
  if (page.data.compassRotate !== 0) {
    updates.compassRotate = 0;
  }
  if (page.data.compassSkew !== 0) {
    updates.compassSkew = 0;
  }
  if (page.data.compassVisible) {
    updates.compassVisible = false;
  }
  if (Object.keys(updates).length) {
    page._skipNextRotateRegion = true;
    page.setData(updates);
  }
}

function shouldAvoidCenterSync(page, options = {}) {
  const cause = typeof options?.cause === "string" ? options.cause.toLowerCase() : "";
  if (cause === "skew" || cause === "rotate" || cause === "overlook") {
    return true;
  }
  if (cause === "drag" || cause === "scale" || cause === "gesture") {
    return true;
  }
  if (
    Number.isFinite(page._overlookSyncAvoidUntil) &&
    page._overlookSyncAvoidUntil > Date.now()
  ) {
    return true;
  }
  if (!page._isIOS) return false;
  if (Number.isFinite(page._mapSkew) && page._mapSkew > 0) return true;
  const rawScale = Number(options?.rawScale);
  const scale = Number(options?.scale);
  if (Number.isFinite(rawScale) && Math.round(rawScale) >= MAP_MAX_SCALE) return true;
  if (Number.isFinite(scale) && Math.round(scale) >= MAP_MAX_SCALE) return true;
  return false;
}

function scaleForMeters(page, targetMeters, latitude) {
  if (!Number.isFinite(targetMeters) || targetMeters <= 0) return null;
  if (!page._pxPerRpx || page._pxPerRpx <= 0) {
    page.initializeSystemInfo();
  }
  const pxPerRpx = page._pxPerRpx || 1;
  const baseRpx = page._scaleBarBaseRpx || DEFAULT_SCALE_BAR_BASE_RPX;
  const pxWidth = pxPerRpx * baseRpx;
  if (!Number.isFinite(pxWidth) || pxWidth <= 0) return null;
  const latSource = typeof latitude === "number"
    ? latitude
    : (page.data.center && typeof page.data.center.latitude === "number"
      ? page.data.center.latitude
      : DEFAULT_CENTER.latitude);
  const lat = Math.max(-85, Math.min(85, Number(latSource) || 0));
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const metersPerPixel = targetMeters / pxWidth;
  if (!Number.isFinite(cosLat) || cosLat <= 0) return null;
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
  const ratio = (METERS_PER_PIXEL_BASE * cosLat) / metersPerPixel;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  const zoom = Math.log2 ? Math.log2(ratio) : Math.log(ratio) / Math.log(2);
  if (!Number.isFinite(zoom)) return null;
  return clampMapScale(zoom);
}

function centerOnPoint(page, point, scale = DEFAULT_MAP_SCALE, silent = false, extraUpdates = null) {
  if (!point) return;
  page.queueRegionUpdateSkip(3);
  page._centerOverride = point;
  const targetScale = clampMapScale(scale);
  const updates = {
    center: point,
    mapCenterReady: true,
    scale: targetScale
  };
  if (extraUpdates && typeof extraUpdates === "object") {
    Object.assign(updates, extraUpdates);
  }
  page.setData(updates, () => {
    page.ensureUomPluginReady();
    page.ensureDjiLayerReady();
    page.ensureTemporaryNoFlyLayerReady();
    page.ensureTiandituSatelliteLayerReady();
    if (page._uomPlugin && typeof page._uomPlugin.handleRegionChange === "function") {
      page._uomPlugin.handleRegionChange({
        center: point,
        centerPin: point,
        scale: targetScale,
        region: page._lastRegion
      });
    }
    page.updateScaleBar({ scale: targetScale, latitude: point.latitude });
    page.updateCenterPinIndicator();
    if (page._markersFetchTimer) {
      clearTimeout(page._markersFetchTimer);
      page._markersFetchTimer = null;
    }
    const fetchOptions = {
      center: point,
      region: page._lastRegion,
      scale: targetScale,
      force: true
    };
    page.requestNearbyMarkers(fetchOptions);
    page.scheduleFetchWeather(200, {
      center: point,
      region: page._lastRegion,
      scale: targetScale
    });
    page.scheduleFetchElevation(2000, {
      center: point,
      region: page._lastRegion,
      scale: targetScale
    });
    page.syncTemporaryNoFlyLayerViewport(fetchOptions);
    page.syncTiandituSatelliteLayerViewport(fetchOptions);
    page.syncDjiLayerViewport({
      center: point,
      region: page._lastRegion,
      scale: targetScale,
      force: true
    });
  });
}

function onRegionChange(page, e) {
  if (!page.isMapCenterReady()) {
    return;
  }
  const cause = e?.causedBy || e?.detail?.cause || e?.detail?.causedBy || "";
  const detail = e?.detail || {};
  if (e.type !== "end") {
    updateMapGestureState(page, detail);
    if (
      !page._centerPinWelcomeBubbleDismissedInGesture &&
      page.shouldDismissCenterPinWelcomeBubbleOnRegionChange(cause)
    ) {
      page._centerPinWelcomeBubbleDismissedInGesture = true;
      page.dismissCenterPinWelcomeBubble();
    }
    if (page._markersFetchTimer) clearTimeout(page._markersFetchTimer);
    if (page._uomPlugin && typeof page._uomPlugin.startFollow === "function") {
      page._uomPlugin.startFollow();
    }
    const cl = detail && (detail.centerLocation || null);
    if (cl && page._uomPlugin && typeof page._uomPlugin.handleRegionChange === "function") {
      const region = detail.region || {
        northeast: detail.northeast,
        southwest: detail.southwest
      };
      const scale = clampMapScale(detail.scale || page.data.scale);
      const newCenter = { latitude: cl.latitude, longitude: cl.longitude };
      page.updateDebugPanel({
        scale: `${scale}`,
        rawScale: `${detail.scale ?? ""}`,
        center: page.formatDebugCoord(newCenter),
        region: page.formatDebugRegion(region),
        regionPhase: "move"
      });
      page._uomPlugin.handleRegionChange({
        center: newCenter,
        centerPin: newCenter,
        scale,
        rawScale: detail.scale,
        region,
        force: true
      });
    }
    return;
  }
  page._centerPinWelcomeBubbleDismissedInGesture = false;
  if (!page._voiceFirstDragPlayed && `${cause || ""}`.toLowerCase() === "drag") {
    page._voiceFirstDragPlayed = true;
    playVoicePackEvent("first_drag_map");
  }
  if (page._uomPlugin && typeof page._uomPlugin.stopFollow === "function") {
    page._uomPlugin.stopFollow();
  }
  updateMapGestureState(page, detail);
  if (page.shouldIgnoreRegionSyncForCenterPinFollow(cause)) {
    return;
  }
  if (page._skipNextRotateRegion) {
    const rotate = Number(detail?.rotate);
    if (Number.isFinite(rotate)) {
      const cl = detail && (detail.centerLocation || null);
      const prevCenter = page.data.center;
      const moveMeters = (cl && prevCenter && hasValidCoordinate(prevCenter.latitude, prevCenter.longitude))
        ? haversineMeters(
          prevCenter.latitude,
          prevCenter.longitude,
          cl.latitude,
          cl.longitude
        )
        : 0;
      if (!Number.isFinite(moveMeters) || moveMeters < MIN_CENTER_SYNC_METERS) {
        page._skipNextRotateRegion = false;
        return;
      }
    }
    page._skipNextRotateRegion = false;
  }
  if (page._pendingRegionUpdates > 0 && (!cause || cause === "update")) {
    page._pendingRegionUpdates = Math.max(0, page._pendingRegionUpdates - 1);
    return;
  }
  const rawScale = Number(detail.scale);
  const forceScaleSync = Number.isFinite(rawScale) && Math.round(rawScale) > MAP_MAX_SCALE;
  const region = detail && (detail.region || {
    northeast: detail.northeast,
    southwest: detail.southwest
  });
  const cl = detail && (detail.centerLocation || null);
  if (region && region.northeast && region.southwest) {
    const newCenter = cl
      ? { latitude: cl.latitude, longitude: cl.longitude }
      : {
        latitude: (region.northeast.latitude + region.southwest.latitude) / 2,
        longitude: (region.northeast.longitude + region.southwest.longitude) / 2
      };
    if (page.shouldIgnoreCenterShareLaunchSync(newCenter, cause)) {
      return;
    }
    page._centerOverride = newCenter;
    const prevScale = page.data.scale;
    const scale = clampMapScale(detail.scale || prevScale);
    page.updateDebugPanel({
      scale: `${scale}`,
      rawScale: `${detail.scale ?? ""}`,
      center: page.formatDebugCoord(newCenter),
      region: page.formatDebugRegion(region),
      regionPhase: "end"
    });
    const scaleChanged = scale !== prevScale;
    page._lastRegion = region;
    const prevCenter = page.data.center;
    const moveMeters = (prevCenter && hasValidCoordinate(prevCenter.latitude, prevCenter.longitude))
      ? haversineMeters(
        prevCenter.latitude,
        prevCenter.longitude,
        newCenter.latitude,
        newCenter.longitude
      )
      : Number.POSITIVE_INFINITY;
    const centerMoved = !Number.isFinite(moveMeters) || moveMeters >= MIN_CENTER_SYNC_METERS;
    const shouldSync = centerMoved || scale !== page.data.scale;
    const avoidCenterSync = shouldAvoidCenterSync(page, { scale, rawScale, cause });
    if (avoidCenterSync) {
      page.data.center = newCenter;
      page.data.scale = scale;
    }
    const run = (forceRefresh) => {
      if (page._uomPlugin && typeof page._uomPlugin.handleRegionChange === "function") {
        page._uomPlugin.handleRegionChange({
          center: newCenter,
          centerPin: newCenter,
          scale,
          rawScale: detail.scale,
          region
        });
      }
      page.syncDjiLayerViewport({
        center: newCenter,
        region,
        scale,
        force: !!forceRefresh
      });
      page.scheduleFetchMarkers(forceRefresh ? 0 : 200, {
        center: newCenter,
        region,
        scale,
        force: !!forceRefresh
      });
      page.scheduleFetchPins(forceRefresh ? 0 : 200, {
        center: newCenter,
        region,
        scale,
        force: !!forceRefresh
      });
      page.scheduleFetchWeather(2000, {
        center: newCenter,
        region,
        scale,
        showLoading: true
      });
      page.scheduleFetchElevation(2000, {
        center: newCenter,
        region,
        scale
      });
      page.syncTemporaryNoFlyLayerViewport({
        center: newCenter,
        region,
        scale,
        force: !!forceRefresh
      });
      page.syncTiandituSatelliteLayerViewport({
        center: newCenter,
        region,
        scale,
        force: !!forceRefresh
      });
    };
    const afterSync = () => {
      page.updateScaleBar({
        scale,
        rawScale: detail.scale,
        latitude: newCenter.latitude
      });
      run(scaleChanged);
      try {
        page.refreshNearbyDisplayModes();
      } catch (err) {
        console.warn("refreshNearbyDisplayModes failed", err);
      }
      page.updateCenterPinIndicator();
    };
    if (shouldSync || forceScaleSync) {
      if (avoidCenterSync) {
        afterSync();
      } else {
        page.queueRegionUpdateSkip(1);
        page.setData({ center: newCenter, scale }, afterSync);
      }
    } else {
      afterSync();
    }
    if (page._uomPlugin && typeof page._uomPlugin.scheduleFinalRefresh === "function") {
      page._uomPlugin.scheduleFinalRefresh();
    }
    return;
  }
  updateCenterAndRadius(page, detail);
  if (page._uomPlugin && typeof page._uomPlugin.scheduleFinalRefresh === "function") {
    page._uomPlugin.scheduleFinalRefresh();
  }
}

function updateCenterAndRadius(page, detail) {
  updateMapGestureState(page, detail);
  const rawScale = Number(detail?.scale);
  const cause = detail?.causedBy || detail?.cause || "";
  const forceScaleSync = Number.isFinite(rawScale) && Math.round(rawScale) > MAP_MAX_SCALE;
  page.mapCtx.getCenterLocation({
    type: "gcj02",
    success: (res) => {
      const newCenter = {
        latitude: res.latitude,
        longitude: res.longitude
      };
      if (page.shouldIgnoreCenterShareLaunchSync(newCenter, cause)) {
        return;
      }
      page._centerOverride = newCenter;
      const scale = clampMapScale(detail?.scale || page.data.scale);
      const avoidCenterSync = shouldAvoidCenterSync(page, { scale, rawScale, cause });
      page._lastRegion = detail?.region || null;
      const prevCenter = page.data.center;
      const moveMeters = (prevCenter && hasValidCoordinate(prevCenter.latitude, prevCenter.longitude))
        ? haversineMeters(
          prevCenter.latitude,
          prevCenter.longitude,
          newCenter.latitude,
          newCenter.longitude
        )
        : Number.POSITIVE_INFINITY;
      const centerMoved = !Number.isFinite(moveMeters) || moveMeters >= MIN_CENTER_SYNC_METERS;
      const needSync = centerMoved || scale !== page.data.scale;
      if (avoidCenterSync) {
        page.data.center = newCenter;
        page.data.scale = scale;
      }
      const run = () => {
        const region = detail?.region || null;
        page.syncDjiLayerViewport({
          center: newCenter,
          region,
          scale,
          force: true
        });
        if (page._uomPlugin && typeof page._uomPlugin.handleRegionChange === "function") {
          page._uomPlugin.handleRegionChange({
            center: newCenter,
            centerPin: newCenter,
            scale,
            region
          });
        }
        page.scheduleFetchMarkers(0, {
          center: newCenter,
          region,
          scale,
          force: true
        });
        page.scheduleFetchPins(0, {
          center: newCenter,
          region,
          scale,
          force: true
        });
        page.scheduleFetchWeather(2000, {
          center: newCenter,
          region,
          scale,
          showLoading: true
        });
        page.scheduleFetchElevation(2000, {
          center: newCenter,
          region,
          scale
        });
        page.syncTemporaryNoFlyLayerViewport({
          center: newCenter,
          region,
          scale,
          force: true
        });
        page.syncTiandituSatelliteLayerViewport({
          center: newCenter,
          region,
          scale,
          force: true
        });
      };
      const afterUpdate = () => {
        page.updateScaleBar({
          scale,
          rawScale: detail?.scale,
          latitude: newCenter.latitude
        });
        run();
        try {
          page.refreshNearbyDisplayModes();
        } catch (err) {
          console.warn("refreshNearbyDisplayModes failed", err);
        }
        page.updateCenterPinIndicator();
      };
      if (needSync || forceScaleSync) {
        if (avoidCenterSync) {
          afterUpdate();
        } else {
          page.queueRegionUpdateSkip(1);
          page.setData({ center: newCenter, scale }, afterUpdate);
        }
      } else {
        afterUpdate();
      }
    }
  });
}

module.exports = {
  updateMapGestureState,
  syncCompassState,
  resetCompassState,
  shouldAvoidCenterSync,
  scaleForMeters,
  centerOnPoint,
  onRegionChange,
  updateCenterAndRadius
};
