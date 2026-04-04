const { prefetchMapKey } = require("../../../utils/map-key");

const DEFAULT_LEVELS_PARAM = "2,6,1,4,3,7,8,10";

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

function ensureUomPluginReady(page, retry = 0) {
  if (page._uomPlugin && page._uomPluginInitialized) return;
  if (!page._uomPluginInitLogged) {
    console.log("[uom-plugin] init check");
    page._uomPluginInitLogged = true;
  }
  const selector = page.data.isWeChatRuntime ? "#uom-plugin" : "#uom2-plugin";
  console.log("[uom-plugin] select", { selector, useWeChatUom: page.data.isWeChatRuntime });
  const plugin = page.selectComponent(selector);
  if (plugin && typeof plugin.init === "function") {
    console.log("[uom-plugin] instance ready, init");
    plugin.init({
      mapCtx: page.mapCtx,
      center: page._centerOverride || page.data.center,
      centerPin: page._centerOverride || page.data.center,
      scale: page.data.scale,
      region: page._lastRegion,
      enabled: page.data.uomDivisionEnabled
    });
    page._uomPlugin = plugin;
    page._uomPluginInitialized = true;
    return;
  }
  if (retry === 0) {
    console.warn("[uom-plugin] instance not ready, retrying");
  }
  if (retry >= 10) {
    console.warn("[uom-plugin] init retries exhausted");
    return;
  }
  if (page._uomPluginInitTimer) clearTimeout(page._uomPluginInitTimer);
  const delay = retry === 0 ? 0 : Math.min(500, 80 * (retry + 1));
  page._uomPluginInitTimer = setTimeout(() => {
    page._uomPluginInitTimer = null;
    ensureUomPluginReady(page, retry + 1);
  }, delay);
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
  page.updateOverlayGraphics();
}

function onTemporaryNoFlyStatusChange(page, event = {}) {
  const detail = event?.detail || {};
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
  onTemporaryNoFlyStatusChange
};
