const { prefetchMapKey } = require("../../../utils/map-key");
const { shouldUseWeChatUom } = require("../../../utils/runtime");

const DEFAULT_LEVELS_PARAM = "2,6,1,4,3,7,8,10";
const OFFLINE_UOM_MAX_SCALE = 13;
const UOM_PLUGIN_SELECTOR_MAP = Object.freeze({
  uom: "#uom-plugin",
  uom2: "#uom2-plugin",
  uom3: "#uom3-plugin"
});

function loadMapSubKey(page) {
  prefetchMapKey({ apiBase: page.getApiBase() })
    .then((mapKey) => {
      const nextKey = typeof mapKey === "string" ? mapKey.trim() : "";
      if (!nextKey || nextKey === page.data.mapSubKey) return;
      page.setData({ mapSubKey: nextKey });
    })
    .catch((err) => {
      console.warn("loadMapSubKey failed", err);
    });
}

function normalizeUomEnsureArgs(optionsOrRetry = {}, retry = 0) {
  if (typeof optionsOrRetry === "number") {
    return {
      options: {},
      retry: optionsOrRetry
    };
  }
  return {
    options: optionsOrRetry && typeof optionsOrRetry === "object" ? optionsOrRetry : {},
    retry: Number.isFinite(Number(retry)) ? Number(retry) : 0
  };
}

function resolvePreferredUomPluginSource(page, scale) {
  const numericScale = Number(scale);
  const resolvedScale = Number.isFinite(numericScale) ? numericScale : Number(page.data.scale || 0);
  if (resolvedScale > OFFLINE_UOM_MAX_SCALE) {
    return "uom3";
  }
  return shouldUseWeChatUom() ? "uom" : "uom2";
}

function getUomPluginSelector(source) {
  return UOM_PLUGIN_SELECTOR_MAP[source] || "";
}

function getUomPluginRef(page, source) {
  if (!page._uomPluginRefs || !source) return null;
  if (page._uomPluginRefs[source]) {
    return page._uomPluginRefs[source];
  }
  const selector = getUomPluginSelector(source);
  if (!selector) return null;
  const plugin = page.selectComponent(selector);
  if (plugin) {
    page._uomPluginRefs[source] = plugin;
  }
  return plugin || null;
}

function isUomPluginUsable(plugin) {
  return !!(
    plugin &&
    typeof plugin.init === "function" &&
    typeof plugin.handleRegionChange === "function" &&
    typeof plugin.setEnabled === "function"
  );
}

function buildUomPluginInitOptions(page, options = {}) {
  return {
    mapCtx: page.mapCtx,
    center: options.center || page._centerOverride || page.data.center,
    centerPin: options.centerPin || options.center || page._centerOverride || page.data.center,
    region: options.region || page._lastRegion || null,
    scale: Number.isFinite(Number(options.scale)) ? Number(options.scale) : page.data.scale,
    enabled: page.data.uomDivisionEnabled !== false,
    renderColor: page.data.uomRenderColor,
    apiBase: page.getApiBase()
  };
}

function clearInactiveUomGraphics(page) {
  const hadTileMarkers = Array.isArray(page._uomTileMarkers) && page._uomTileMarkers.length > 0;
  const hadPolygons = Array.isArray(page._uomPolygons) && page._uomPolygons.length > 0;
  const hadPolylines = Array.isArray(page._uomPolylines) && page._uomPolylines.length > 0;
  if (hadTileMarkers) {
    page._uomTileMarkers = [];
    page.queueMapGraphicsSync({ markers: true });
  }
  if (hadPolygons || hadPolylines) {
    page._uomPolygons = [];
    page._uomPolylines = [];
    page.queueMapGraphicsSync({ overlay: true, polylines: true });
  }
}

function deactivateUomPlugin(plugin) {
  if (!plugin) return;
  if (typeof plugin.stopFollow === "function") {
    plugin.stopFollow();
  }
  if (typeof plugin.stopScaleWatch === "function") {
    plugin.stopScaleWatch();
  }
  if (typeof plugin.setEnabled === "function") {
    plugin.setEnabled(false);
  }
}

function ensureUomPluginReady(page, optionsOrRetry = {}, explicitRetry = 0) {
  const { options, retry } = normalizeUomEnsureArgs(optionsOrRetry, explicitRetry);
  const desiredSource = resolvePreferredUomPluginSource(page, options.scale);
  const previousSource = page._activeUomPluginSource || "";
  const sourceChanged = previousSource && previousSource !== desiredSource;
  page._activeUomPluginSource = desiredSource;
  if (sourceChanged) {
    deactivateUomPlugin(page._uomPlugin);
    clearInactiveUomGraphics(page);
    page._uomPlugin = null;
    page._uomPluginInitialized = false;
  }
  if (page._uomPlugin && page._uomPluginInitialized && previousSource === desiredSource) {
    return page._uomPlugin;
  }
  const plugin = getUomPluginRef(page, desiredSource);
  if (
    isUomPluginUsable(plugin)
  ) {
    const initOptions = buildUomPluginInitOptions(page, options);
    const shouldInit = sourceChanged || !page._uomPluginInitState?.[desiredSource];
    page._uomPlugin = plugin;
    page._uomPluginInitialized = true;
    if (!page._uomPluginInitState) {
      page._uomPluginInitState = Object.create(null);
    }
    if (shouldInit) {
      plugin.init(initOptions);
      page._uomPluginInitState[desiredSource] = true;
      if (sourceChanged && typeof plugin.handleRegionChange === "function") {
        plugin.handleRegionChange(
          Object.assign({}, initOptions, {
            force: true
          })
        );
      }
      if (sourceChanged && typeof plugin.scheduleFinalRefresh === "function") {
        plugin.scheduleFinalRefresh();
      }
    } else {
      plugin.setEnabled(initOptions.enabled);
      if (typeof plugin.setRenderColor === "function") {
        plugin.setRenderColor(initOptions.renderColor);
      }
    }
    return plugin;
  }
  if (retry >= 10) {
    console.warn(`[${desiredSource}] init retries exhausted`);
    return null;
  }
  if (page._uomPluginInitTimer) clearTimeout(page._uomPluginInitTimer);
  const delay = retry === 0 ? 0 : Math.min(500, 80 * (retry + 1));
  page._uomPluginInitTimer = setTimeout(() => {
    page._uomPluginInitTimer = null;
    ensureUomPluginReady(page, options, retry + 1);
  }, delay);
  return null;
}

function ensureDjiLayerReady(page, retry = 0) {
  if (page._djiLayer && page._djiLayerInitialized) return;
  if (!page._djiLayerInitLogged) {
    page._djiLayerInitLogged = true;
    console.log("[dji-layer] init check");
  }
  const layer = page.selectComponent("#dji-no-fly-layer");
  if (
    layer &&
    typeof layer.init === "function" &&
    typeof layer.updateViewport === "function" &&
    typeof layer.updateQuery === "function" &&
    typeof layer.setEnabled === "function"
  ) {
    page._djiLayer = layer;
    page._djiLayerInitialized = true;
    layer.init({
      enabled: page.data.djiNoFlyZoneEnabled !== false,
      center: page._centerOverride || page.data.center,
      region: page._lastRegion || null,
      scale: page.data.scale,
      drone: page.data.selectedDrone || "",
      levels: page.data.levelsInput || DEFAULT_LEVELS_PARAM,
      force: true
    });
    return;
  }
  if (retry >= 10) {
    console.warn("[dji-layer] init retries exhausted");
    return;
  }
  if (page._djiLayerInitTimer) clearTimeout(page._djiLayerInitTimer);
  const delay = retry === 0 ? 0 : Math.min(500, 80 * (retry + 1));
  page._djiLayerInitTimer = setTimeout(() => {
    page._djiLayerInitTimer = null;
    ensureDjiLayerReady(page, retry + 1);
  }, delay);
}

function syncDjiLayerViewport(page, options = {}) {
  ensureDjiLayerReady(page);
  if (!page._djiLayer || typeof page._djiLayer.updateViewport !== "function") return;
  page._djiLayer.updateViewport({
    center: options.center || page._centerOverride || page.data.center,
    region: options.region || page._lastRegion || null,
    scale: Number.isFinite(Number(options.scale)) ? Number(options.scale) : page.data.scale,
    force: options.force === true
  });
}

function syncDjiLayerQuery(page, options = {}) {
  ensureDjiLayerReady(page);
  if (!page._djiLayer || typeof page._djiLayer.updateQuery !== "function") return;
  page._djiLayer.updateQuery({
    drone: page.data.selectedDrone || "",
    levels: page.data.levelsInput || DEFAULT_LEVELS_PARAM,
    force: options.force === true
  });
}

function setDjiLayerEnabled(page, enabled, options = {}) {
  ensureDjiLayerReady(page);
  if (!page._djiLayer || typeof page._djiLayer.setEnabled !== "function") return;
  page._djiLayer.setEnabled(enabled !== false, {
    force: options.force === true
  });
}

function onDjiGraphicsChange(page, event = {}) {
  const detail = event?.detail || {};
  page._djiPolygons = Array.isArray(detail.polygons) ? detail.polygons : [];
  page._djiCircles = Array.isArray(detail.circles) ? detail.circles : [];
  page.updateOverlayGraphics();
}

function onDjiStatusChange(page, event = {}) {
  const detail = event?.detail || {};
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(detail, "djiStatus")) {
    updates.djiStatus = detail.djiStatus;
  }
  if (Object.prototype.hasOwnProperty.call(detail, "djiStatusExtra")) {
    updates.djiStatusExtra = detail.djiStatusExtra;
  }
  if (Object.prototype.hasOwnProperty.call(detail, "djiTone")) {
    updates.djiTone = detail.djiTone;
  }
  if (Object.prototype.hasOwnProperty.call(detail, "djiColor")) {
    updates.djiColor = detail.djiColor || "";
  }
  if (Object.prototype.hasOwnProperty.call(detail, "djiMsg")) {
    updates.djiMsg = detail.djiMsg || "";
  }
  if (Object.prototype.hasOwnProperty.call(detail, "loadingDji")) {
    updates.loadingDji = !!detail.loadingDji;
  }
  if (Object.keys(updates).length) {
    page.setData(updates);
  }
}

function ensureTemporaryNoFlyLayerReady(page, retry = 0) {
  if (page._temporaryNoFlyLayer && page._temporaryNoFlyLayerInitialized) return;
  if (!page._temporaryNoFlyLayerInitLogged) {
    page._temporaryNoFlyLayerInitLogged = true;
    console.log("[temporary-no-fly-layer] init check");
  }
  const layer = page.selectComponent("#temporary-no-fly-layer");
  if (
    layer &&
    typeof layer.init === "function" &&
    typeof layer.updateViewport === "function" &&
    typeof layer.setEnabled === "function"
  ) {
    page._temporaryNoFlyLayer = layer;
    page._temporaryNoFlyLayerInitialized = true;
    layer.init({
      enabled: page.data.temporaryNoFlyZoneEnabled !== false,
      center: page._centerOverride || page.data.center,
      region: page._lastRegion || null,
      scale: page.data.scale,
      apiBase: page.getApiBase(),
      force: true
    });
    return;
  }
  if (retry >= 10) {
    console.warn("[temporary-no-fly-layer] init retries exhausted");
    return;
  }
  if (page._temporaryNoFlyLayerInitTimer) clearTimeout(page._temporaryNoFlyLayerInitTimer);
  const delay = retry === 0 ? 0 : Math.min(500, 80 * (retry + 1));
  page._temporaryNoFlyLayerInitTimer = setTimeout(() => {
    page._temporaryNoFlyLayerInitTimer = null;
    ensureTemporaryNoFlyLayerReady(page, retry + 1);
  }, delay);
}

function ensureTiandituSatelliteLayerReady(page, retry = 0) {
  if (page._tiandituSatelliteLayer && page._tiandituSatelliteLayerInitialized) return;
  const layer = page.selectComponent("#tianditu-satellite-layer");
  if (
    layer &&
    typeof layer.init === "function" &&
    typeof layer.updateViewport === "function" &&
    typeof layer.setEnabled === "function"
  ) {
    page._tiandituSatelliteLayer = layer;
    page._tiandituSatelliteLayerInitialized = true;
    const pendingEnabled = typeof page._pendingTiandituSatelliteLayerEnabled === "boolean"
      ? page._pendingTiandituSatelliteLayerEnabled
      : page.data.mapLayerType === "tianditu";
    const pendingViewport =
      page._pendingTiandituSatelliteLayerViewport && typeof page._pendingTiandituSatelliteLayerViewport === "object"
        ? page._pendingTiandituSatelliteLayerViewport
        : {};
    layer.init({
      mapCtx: page.mapCtx,
      enabled: pendingEnabled,
      center: pendingViewport.center || page._centerOverride || page.data.center,
      region: pendingViewport.region || page._lastRegion || null,
      scale: Number.isFinite(Number(pendingViewport.scale)) ? Number(pendingViewport.scale) : page.data.scale
    });
    page._pendingTiandituSatelliteLayerEnabled = null;
    page._pendingTiandituSatelliteLayerViewport = null;
    return;
  }
  if (retry >= 10) {
    console.warn("[tianditu-satellite-layer] init retries exhausted");
    return;
  }
  if (page._tiandituSatelliteLayerInitTimer) clearTimeout(page._tiandituSatelliteLayerInitTimer);
  const delay = retry === 0 ? 0 : Math.min(500, 80 * (retry + 1));
  page._tiandituSatelliteLayerInitTimer = setTimeout(() => {
    page._tiandituSatelliteLayerInitTimer = null;
    ensureTiandituSatelliteLayerReady(page, retry + 1);
  }, delay);
}

function syncTiandituSatelliteLayerViewport(page, options = {}) {
  const viewport = {
    center: options.center || page._centerOverride || page.data.center,
    region: options.region || page._lastRegion || null,
    scale: Number.isFinite(Number(options.scale)) ? Number(options.scale) : page.data.scale,
    force: options.force === true
  };
  page._pendingTiandituSatelliteLayerViewport = viewport;
  ensureTiandituSatelliteLayerReady(page);
  if (!page._tiandituSatelliteLayer || typeof page._tiandituSatelliteLayer.updateViewport !== "function") return;
  page._tiandituSatelliteLayer.updateViewport(viewport);
}

function setTiandituSatelliteLayerEnabled(page, enabled, options = {}) {
  const nextEnabled = enabled === true;
  const viewport = {
    center: options.center || page._centerOverride || page.data.center,
    region: options.region || page._lastRegion || null,
    scale: Number.isFinite(Number(options.scale)) ? Number(options.scale) : page.data.scale,
    force: options.force === true
  };
  page._pendingTiandituSatelliteLayerEnabled = nextEnabled;
  page._pendingTiandituSatelliteLayerViewport = viewport;
  ensureTiandituSatelliteLayerReady(page);
  if (!page._tiandituSatelliteLayer || typeof page._tiandituSatelliteLayer.setEnabled !== "function") return;
  page._tiandituSatelliteLayer.setEnabled(nextEnabled, viewport);
}

function syncTemporaryNoFlyLayerViewport(page, options = {}) {
  ensureTemporaryNoFlyLayerReady(page);
  if (!page._temporaryNoFlyLayer || typeof page._temporaryNoFlyLayer.updateViewport !== "function") return;
  page._temporaryNoFlyLayer.updateViewport({
    center: options.center || page._centerOverride || page.data.center,
    region: options.region || page._lastRegion || null,
    scale: Number.isFinite(Number(options.scale)) ? Number(options.scale) : page.data.scale,
    apiBase: page.getApiBase(),
    force: options.force === true
  });
}

function setTemporaryNoFlyLayerEnabled(page, enabled, options = {}) {
  ensureTemporaryNoFlyLayerReady(page);
  if (!page._temporaryNoFlyLayer || typeof page._temporaryNoFlyLayer.setEnabled !== "function") return;
  page._temporaryNoFlyLayer.setEnabled(enabled !== false, {
    force: options.force === true
  });
}

function onTemporaryNoFlyGraphicsChange(page, event = {}) {
  const detail = event?.detail || {};
  page._nfzPolygons = Array.isArray(detail.polygons) ? detail.polygons : [];
  page._nfzCircles = Array.isArray(detail.circles) ? detail.circles : [];
  page._nfzPolylines = Array.isArray(detail.polylines) ? detail.polylines : [];
  page.queueMapGraphicsSync({ overlay: true, polylines: true });
}

function onTemporaryNoFlyStatusChange(page, event = {}) {
  const detail = event?.detail || {};
  page._liveTemporaryNoFlyStatus = {
    temporaryNoFlyZoneInfo: Object.prototype.hasOwnProperty.call(detail, "temporaryNoFlyZoneInfo")
      ? (detail.temporaryNoFlyZoneInfo || null)
      : (page.data.temporaryNoFlyZoneInfo || null),
    temporaryNoFlyText: Object.prototype.hasOwnProperty.call(detail, "temporaryNoFlyText")
      ? (detail.temporaryNoFlyText || "")
      : (page.data.temporaryNoFlyText || ""),
    temporaryNoFlyTone: Object.prototype.hasOwnProperty.call(detail, "temporaryNoFlyTone")
      ? (detail.temporaryNoFlyTone || "neutral")
      : (page.data.temporaryNoFlyTone || "neutral")
  };
  if (page._previewTemporaryNoFlyOverride) {
    const keepPreview = typeof page.syncPreviewTemporaryNoFlyState === "function"
      ? page.syncPreviewTemporaryNoFlyState()
      : true;
    if (keepPreview) return;
  }
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(detail, "temporaryNoFlyZoneInfo")) {
    updates.temporaryNoFlyZoneInfo = detail.temporaryNoFlyZoneInfo || null;
  }
  if (Object.prototype.hasOwnProperty.call(detail, "temporaryNoFlyText")) {
    updates.temporaryNoFlyText = detail.temporaryNoFlyText || "";
  }
  if (Object.prototype.hasOwnProperty.call(detail, "temporaryNoFlyTone")) {
    updates.temporaryNoFlyTone = detail.temporaryNoFlyTone || "neutral";
  }
  if (Object.keys(updates).length) {
    page.setData(updates);
  }
}

module.exports = {
  loadMapSubKey,
  ensureUomPluginReady,
  ensureDjiLayerReady,
  syncDjiLayerViewport,
  syncDjiLayerQuery,
  setDjiLayerEnabled,
  onDjiGraphicsChange,
  onDjiStatusChange,
  ensureTemporaryNoFlyLayerReady,
  syncTemporaryNoFlyLayerViewport,
  setTemporaryNoFlyLayerEnabled,
  onTemporaryNoFlyGraphicsChange,
  onTemporaryNoFlyStatusChange,
  ensureTiandituSatelliteLayerReady,
  syncTiandituSatelliteLayerViewport,
  setTiandituSatelliteLayerEnabled
};
