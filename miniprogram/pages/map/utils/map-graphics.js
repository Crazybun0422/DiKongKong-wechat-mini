function queueMapGraphicsSync(page, options = {}) {
  const next = page._pendingMapGraphicsSync || {
    markers: false,
    polylines: false,
    overlay: false
  };
  if (options.markers) next.markers = true;
  if (options.polylines) next.polylines = true;
  if (options.overlay) next.overlay = true;
  page._pendingMapGraphicsSync = next;
  if (page._mapGraphicsSyncTimer) return;
  page._mapGraphicsSyncTimer = setTimeout(() => {
    page._mapGraphicsSyncTimer = null;
    const pending = page._pendingMapGraphicsSync || {};
    page._pendingMapGraphicsSync = null;
    if (pending.markers) {
      syncAllMarkers(page);
    }
    if (pending.polylines) {
      syncAllPolylines(page);
    }
    if (pending.overlay) {
      page.updateOverlayGraphics();
    }
  }, 0);
}

function syncAllPolylines(page) {
  const polylines = Array.isArray(page._searchLinkPolylines) ? page._searchLinkPolylines : [];
  page.setData({ polylines });
}

function syncAllMarkers(page) {
  const nearby =
    page.data.merchantMarkersEnabled !== false && Array.isArray(page._nearbyMarkers)
      ? page._nearbyMarkers
      : [];
  const pinMarkers = Array.isArray(page._nearbyPinMarkers) ? page._nearbyPinMarkers : [];
  const search = Array.isArray(page._searchMarkers) ? page._searchMarkers : [];
  const searchLink = Array.isArray(page._searchLinkMarkers) ? page._searchLinkMarkers : [];
  const mapTapTarget = Array.isArray(page._mapTapTargetMarkers) ? page._mapTapTargetMarkers : [];
  const manual = Array.isArray(page._manualMarkers) ? page._manualMarkers : [];
  const preview = page._previewMarker ? [page._previewMarker] : [];
  const myLocation = Array.isArray(page._myLocationMarkers) ? page._myLocationMarkers : [];
  const uom2 = Array.isArray(page._uom2Markers) ? page._uom2Markers : [];
  page.normalizeMapMarkerList(uom2);
  page.normalizeMapMarkerList(nearby);
  page.normalizeMapMarkerList(pinMarkers);
  page.normalizeMapMarkerList(search);
  page.normalizeMapMarkerList(searchLink);
  page.normalizeMapMarkerList(mapTapTarget);
  page.normalizeMapMarkerList(manual);
  page.normalizeMapMarkerList(preview);
  page.normalizeMapMarkerList(myLocation);
  const combined = page.dedupeMapMarkers(
    uom2.concat(manual, pinMarkers, nearby, search, searchLink, mapTapTarget, preview, myLocation)
  );
  page.setData({ markers: combined });
}

function updateOverlayGraphics(page) {
  const polygons = [];
  const circles = [];
  if (page.data.djiNoFlyZoneEnabled !== false && Array.isArray(page._djiPolygons)) {
    polygons.push(...page._djiPolygons);
  }
  if (page.data.temporaryNoFlyZoneEnabled !== false && Array.isArray(page._nfzPolygons)) {
    polygons.push(...page._nfzPolygons);
  }
  if (page.data.djiNoFlyZoneEnabled !== false && Array.isArray(page._djiCircles)) {
    circles.push(...page._djiCircles);
  }
  if (page.data.temporaryNoFlyZoneEnabled !== false && Array.isArray(page._nfzCircles)) {
    circles.push(...page._nfzCircles);
  }
  if (Array.isArray(page._provinceCityHighlightPolygons)) {
    polygons.push(...page._provinceCityHighlightPolygons);
  }
  if (Array.isArray(page._nearbyPinPolygons)) {
    polygons.push(...page._nearbyPinPolygons);
  }
  if (Array.isArray(page._nearbyPinCircles)) {
    circles.push(...page._nearbyPinCircles);
  }
  if (Array.isArray(page._previewPolygons)) {
    polygons.push(...page._previewPolygons);
  }
  if (Array.isArray(page._previewCircles)) {
    circles.push(...page._previewCircles);
  }
  if (Array.isArray(page._myLocationCircles)) {
    circles.push(...page._myLocationCircles);
  }
  page.setData({ polygons, circles });
}

function clearManualMarkers(page) {
  if (Array.isArray(page._manualMarkers) && page._manualMarkers.length) {
    page._manualMarkers = [];
    syncAllMarkers(page);
  }
}

module.exports = {
  queueMapGraphicsSync,
  syncAllPolylines,
  syncAllMarkers,
  updateOverlayGraphics,
  clearManualMarkers
};
