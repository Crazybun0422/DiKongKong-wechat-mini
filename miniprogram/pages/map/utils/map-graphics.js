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

function formatGraphicNumber(value, digits = 5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return numeric.toFixed(digits);
}

function pickSamplePoints(points = []) {
  if (!Array.isArray(points) || !points.length) return [];
  const indices = [0, Math.floor(points.length / 2), points.length - 1];
  const seen = new Set();
  return indices
    .filter((index) => index >= 0 && index < points.length && !seen.has(index) && seen.add(index))
    .map((index) => points[index])
    .filter(Boolean);
}

function buildPointSignature(point = {}) {
  return `${formatGraphicNumber(point.longitude)},${formatGraphicNumber(point.latitude)}`;
}

function buildPolylineSignature(polyline = {}) {
  const points = Array.isArray(polyline.points) ? polyline.points : [];
  const samples = pickSamplePoints(points).map(buildPointSignature).join("|");
  return [
    polyline.id || "",
    points.length,
    formatGraphicNumber(polyline.width, 2),
    polyline.color || "",
    polyline.dottedLine ? 1 : 0,
    polyline.arrowLine ? 1 : 0,
    samples
  ].join("#");
}

function buildPolygonSignature(polygon = {}) {
  const points = Array.isArray(polygon.points) ? polygon.points : [];
  const samples = pickSamplePoints(points).map(buildPointSignature).join("|");
  return [
    polygon.id || "",
    points.length,
    formatGraphicNumber(polygon.strokeWidth, 2),
    polygon.strokeColor || "",
    polygon.fillColor || "",
    samples
  ].join("#");
}

function buildCircleSignature(circle = {}) {
  return [
    circle.id || "",
    formatGraphicNumber(circle.longitude),
    formatGraphicNumber(circle.latitude),
    formatGraphicNumber(circle.radius, 2),
    formatGraphicNumber(circle.strokeWidth, 2),
    circle.color || "",
    circle.fillColor || ""
  ].join("#");
}

function buildGraphicCollectionSignature(list = [], type = "") {
  const source = Array.isArray(list) ? list : [];
  if (!source.length) return `${type}:0`;
  let builder = null;
  if (type === "polygon") builder = buildPolygonSignature;
  if (type === "polyline") builder = buildPolylineSignature;
  if (type === "circle") builder = buildCircleSignature;
  if (!builder) return `${type}:${source.length}`;
  return `${type}:${source.length}:${source.map(builder).join("||")}`;
}

function syncAllPolylines(page) {
  const polylines = [];
  if (page.data.uomDivisionEnabled !== false && Array.isArray(page._uomPolylines)) {
    polylines.push(...page._uomPolylines);
  }
  if (Array.isArray(page._searchLinkPolylines)) {
    polylines.push(...page._searchLinkPolylines);
  }
  if (page.data.temporaryNoFlyZoneEnabled !== false && Array.isArray(page._nfzPolylines)) {
    polylines.push(...page._nfzPolylines);
  }
  const signature = buildGraphicCollectionSignature(polylines, "polyline");
  if (page._lastPolylineSignature === signature) {
    return;
  }
  page._lastPolylineSignature = signature;
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
  page.normalizeMapMarkerList(nearby);
  page.normalizeMapMarkerList(pinMarkers);
  page.normalizeMapMarkerList(search);
  page.normalizeMapMarkerList(searchLink);
  page.normalizeMapMarkerList(mapTapTarget);
  page.normalizeMapMarkerList(manual);
  page.normalizeMapMarkerList(preview);
  page.normalizeMapMarkerList(myLocation);
  const combined = page.dedupeMapMarkers(
    manual.concat(pinMarkers, nearby, search, searchLink, mapTapTarget, preview, myLocation)
  );
  page.setData({ markers: combined });
}

function updateOverlayGraphics(page) {
  const polygons = [];
  const circles = [];
  const polygonSources = [];
  const circleSources = [];
  if (page.data.uomDivisionEnabled !== false && Array.isArray(page._uomPolygons)) {
    polygonSources.push(page._uomPolygons);
    polygons.push(...page._uomPolygons);
  }
  if (page.data.djiNoFlyZoneEnabled !== false && Array.isArray(page._djiPolygons)) {
    polygonSources.push(page._djiPolygons);
    polygons.push(...page._djiPolygons);
  }
  if (page.data.temporaryNoFlyZoneEnabled !== false && Array.isArray(page._nfzPolygons)) {
    polygonSources.push(page._nfzPolygons);
    polygons.push(...page._nfzPolygons);
  }
  if (page.data.djiNoFlyZoneEnabled !== false && Array.isArray(page._djiCircles)) {
    circleSources.push(page._djiCircles);
    circles.push(...page._djiCircles);
  }
  if (page.data.temporaryNoFlyZoneEnabled !== false && Array.isArray(page._nfzCircles)) {
    circleSources.push(page._nfzCircles);
    circles.push(...page._nfzCircles);
  }
  if (Array.isArray(page._provinceCityHighlightPolygons)) {
    polygonSources.push(page._provinceCityHighlightPolygons);
    polygons.push(...page._provinceCityHighlightPolygons);
  }
  if (Array.isArray(page._nearbyPinPolygons)) {
    polygonSources.push(page._nearbyPinPolygons);
    polygons.push(...page._nearbyPinPolygons);
  }
  if (Array.isArray(page._nearbyPinCircles)) {
    circleSources.push(page._nearbyPinCircles);
    circles.push(...page._nearbyPinCircles);
  }
  if (Array.isArray(page._previewPolygons)) {
    polygonSources.push(page._previewPolygons);
    polygons.push(...page._previewPolygons);
  }
  if (Array.isArray(page._previewCircles)) {
    circleSources.push(page._previewCircles);
    circles.push(...page._previewCircles);
  }
  if (Array.isArray(page._myLocationCircles)) {
    circleSources.push(page._myLocationCircles);
    circles.push(...page._myLocationCircles);
  }
  const prevPolygonSources = Array.isArray(page._lastOverlayPolygonSources)
    ? page._lastOverlayPolygonSources
    : [];
  const prevCircleSources = Array.isArray(page._lastOverlayCircleSources)
    ? page._lastOverlayCircleSources
    : [];
  const samePolygonSources =
    prevPolygonSources.length === polygonSources.length &&
    prevPolygonSources.every((source, index) => source === polygonSources[index]);
  const sameCircleSources =
    prevCircleSources.length === circleSources.length &&
    prevCircleSources.every((source, index) => source === circleSources[index]);
  if (
    samePolygonSources &&
    sameCircleSources &&
    page._lastOverlayPolygonsCount === polygons.length &&
    page._lastOverlayCirclesCount === circles.length
  ) {
    return;
  }
  const polygonSignature = buildGraphicCollectionSignature(polygons, "polygon");
  const circleSignature = buildGraphicCollectionSignature(circles, "circle");
  if (
    page._lastOverlayPolygonSignature === polygonSignature &&
    page._lastOverlayCircleSignature === circleSignature
  ) {
    page._lastOverlayPolygonSources = polygonSources;
    page._lastOverlayCircleSources = circleSources;
    page._lastOverlayPolygonsCount = polygons.length;
    page._lastOverlayCirclesCount = circles.length;
    return;
  }
  page._lastOverlayPolygonSources = polygonSources;
  page._lastOverlayCircleSources = circleSources;
  page._lastOverlayPolygonsCount = polygons.length;
  page._lastOverlayCirclesCount = circles.length;
  page._lastOverlayPolygonSignature = polygonSignature;
  page._lastOverlayCircleSignature = circleSignature;
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
