const {
  buildProvinceLayerRecords,
  findProvinceLayerRecordForPoint
} = require("../../utils/uomProvinceSelector");
const provinceGeojson = require("../../map-meta-data/China.js");
const { outOfChina } = require("../../../../utils/coords");
const {
  UOM3_SAFE_STATUS_TEXT,
  UOM3_NON_RESTRICTED_STATUS_TEXT,
  UOM3_RESTRICTED_STATUS_TEXT,
  normalizeRenderColor,
  readStoredRenderColor,
  buildGraphicsFromParsedResource,
  pointCoveredBySuitableZone,
  buildParsedResourceFromKmlText
} = require("../../utils/core");

const SPECIAL_REGION_CODE_SET = new Set(["71", "81", "82"]);
const STATUS_PENDING_TEXT = "评估中";
const STATUS_DISABLED_TEXT = "已禁用";
const STATUS_LOAD_FAILED_TEXT = "空域数据加载失败";
const REFRESH_DEBOUNCE_MS = 180;
const STATUS_EVAL_DELAY_MS = 60;
const GRAPHICS_COVERAGE_EXPAND_RATIO = 0.6;
const KML_TILE_QUERY_LIMIT = 48;
const KML_TILE_RESOURCE_LRU_LIMIT = 96;
const UOM_REGION_RECORDS = buildProvinceLayerRecords(provinceGeojson, { includeSpecialRegions: true });

function sameStatusPayload(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.uomStatus === b.uomStatus &&
    a.uomTone === b.uomTone &&
    a.uomLoading === b.uomLoading &&
    a.uomTileWarningVisible === b.uomTileWarningVisible &&
    a.uomTileWarningDismissed === b.uomTileWarningDismissed
  );
}

function resolveExcludedRegionRecord(point) {
  const record = findProvinceLayerRecordForPoint(UOM_REGION_RECORDS, point);
  if (!record) return null;
  return SPECIAL_REGION_CODE_SET.has(record.provinceCode) ? record : null;
}

function normalizeRegionBounds(region = null) {
  const northeast = region?.northeast || null;
  const southwest = region?.southwest || null;
  const neLng = Number(northeast?.longitude);
  const neLat = Number(northeast?.latitude);
  const swLng = Number(southwest?.longitude);
  const swLat = Number(southwest?.latitude);
  if (
    !Number.isFinite(neLng) ||
    !Number.isFinite(neLat) ||
    !Number.isFinite(swLng) ||
    !Number.isFinite(swLat)
  ) {
    return null;
  }
  return {
    minLng: Math.min(neLng, swLng),
    maxLng: Math.max(neLng, swLng),
    minLat: Math.min(neLat, swLat),
    maxLat: Math.max(neLat, swLat)
  };
}

function clampBounds(bounds = null) {
  if (!bounds) return null;
  return {
    minLng: Math.max(-180, Math.min(180, Number(bounds.minLng))),
    maxLng: Math.max(-180, Math.min(180, Number(bounds.maxLng))),
    minLat: Math.max(-90, Math.min(90, Number(bounds.minLat))),
    maxLat: Math.max(-90, Math.min(90, Number(bounds.maxLat)))
  };
}

function expandRegion(region = null, ratio = GRAPHICS_COVERAGE_EXPAND_RATIO) {
  const bounds = normalizeRegionBounds(region);
  if (!bounds) return region || null;
  const lngSpan = Math.max(1e-6, bounds.maxLng - bounds.minLng);
  const latSpan = Math.max(1e-6, bounds.maxLat - bounds.minLat);
  const expandLng = lngSpan * Math.max(0, Number(ratio) || 0);
  const expandLat = latSpan * Math.max(0, Number(ratio) || 0);
  const expandedBounds = clampBounds({
    minLng: bounds.minLng - expandLng,
    maxLng: bounds.maxLng + expandLng,
    minLat: bounds.minLat - expandLat,
    maxLat: bounds.maxLat + expandLat
  });
  if (!expandedBounds) return region || null;
  return {
    northeast: {
      longitude: expandedBounds.maxLng,
      latitude: expandedBounds.maxLat
    },
    southwest: {
      longitude: expandedBounds.minLng,
      latitude: expandedBounds.minLat
    }
  };
}

function boundsContain(outer = null, inner = null) {
  if (!outer || !inner) return false;
  return (
    outer.minLng <= inner.minLng &&
    outer.maxLng >= inner.maxLng &&
    outer.minLat <= inner.minLat &&
    outer.maxLat >= inner.maxLat
  );
}

function buildBoundsKey(bounds = null) {
  if (!bounds) return "none";
  return [
    bounds.minLng.toFixed(4),
    bounds.maxLng.toFixed(4),
    bounds.minLat.toFixed(4),
    bounds.maxLat.toFixed(4)
  ].join(",");
}

function formatSignatureCoordinate(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(5) : "";
}

function buildPointSignature(point = {}) {
  return `${formatSignatureCoordinate(point.longitude)},${formatSignatureCoordinate(point.latitude)}`;
}

function buildPointListSignature(points = []) {
  return (Array.isArray(points) ? points : []).map((point) => buildPointSignature(point)).join(";");
}

function buildPolygonSignature(polygon = {}) {
  const holes = (Array.isArray(polygon.gcjHolePointsList) ? polygon.gcjHolePointsList : [])
    .map((points) => buildPointListSignature(points))
    .join("|");
  return [
    buildPointListSignature(polygon.gcjPoints),
    holes,
    `${polygon.lineColor || ""}`.trim(),
    `${polygon.polyColor || ""}`.trim(),
    Number(polygon.lineWidth) || 0,
    polygon.fillEnabled === false ? 0 : 1,
    polygon.outlineEnabled === false ? 0 : 1
  ].join("#");
}

function buildPolylineSignature(polyline = {}) {
  return [
    buildPointListSignature(polyline.gcjPoints),
    `${polyline.lineColor || ""}`.trim(),
    Number(polyline.lineWidth) || 0
  ].join("#");
}

function dedupeBySignature(list = [], buildSignature = () => "") {
  const seen = new Set();
  const result = [];
  (Array.isArray(list) ? list : []).forEach((item) => {
    const signature = buildSignature(item);
    if (!signature || seen.has(signature)) return;
    seen.add(signature);
    result.push(item);
  });
  return result;
}

function encodeParams(params = {}) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && `${params[key]}` !== "")
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join("&");
}

function requestRaw(options = {}) {
  let settled = false;
  let rejectPromise = null;
  let requestTask = null;
  const promise = new Promise((resolve, reject) => {
    rejectPromise = reject;
    const url = `${options.url || ""}`.trim();
    if (!url) {
      reject(new Error("missing-url"));
      return;
    }
    requestTask = wx.request({
      url,
      method: options.method || "GET",
      data: options.data,
      responseType: options.responseType,
      header: Object.assign({}, options.header || {}),
      success: (res = {}) => {
        if (settled) return;
        settled = true;
        const statusCode = Number(res.statusCode) || 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve(res);
          return;
        }
        reject(new Error(`${res?.errMsg || "request-failed"}:${statusCode || "unknown"}`));
      },
      fail: (err) => {
        if (settled) return;
        settled = true;
        reject(err || new Error("request-failed"));
      }
    });
  });
  return {
    promise,
    abort() {
      if (settled) return;
      settled = true;
      try {
        if (requestTask && typeof requestTask.abort === "function") {
          requestTask.abort();
        }
      } catch (err) {
        // ignore
      }
      const error = new Error("request-aborted");
      error.code = "REQUEST_ABORTED";
      if (typeof rejectPromise === "function") {
        rejectPromise(error);
      }
    }
  };
}

function decodeArrayBuffer(buffer) {
  if (!(buffer instanceof ArrayBuffer)) return `${buffer || ""}`;
  try {
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-8").decode(new Uint8Array(buffer));
    }
  } catch (err) {
    // fall through
  }
  const bytes = new Uint8Array(buffer);
  let text = "";
  const chunkSize = 1024;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  try {
    return decodeURIComponent(escape(text));
  } catch (err) {
    return text;
  }
}

function normalizeTile(tile = {}, apiBase = "") {
  const z = Number(tile.z);
  const x = Number(tile.x);
  const y = Number(tile.y);
  const publicUrl = `${tile.url || ""}`.trim();
  const downloadUrl = `${tile.downloadUrl || ""}`.trim();
  const rawUrl = /^https?:\/\//.test(publicUrl) ? publicUrl : (downloadUrl || publicUrl);
  const url = rawUrl.startsWith("/")
    ? `${`${apiBase || ""}`.replace(/\/+$/, "")}${rawUrl}`
    : rawUrl;
  const relativePath = `${tile.relativePath || ""}`.trim();
  const lowerPath = `${relativePath || url}`.toLowerCase();
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y) || !url) return null;
  if (!lowerPath.endsWith(".kml")) return null;
  return {
    z,
    x,
    y,
    key: `${z}/${x}/${y}`,
    url,
    featureCount: Number(tile.featureCount) || 0,
    fileSize: Number(tile.fileSize) || 0
  };
}

Component({
  options: {
    virtualHost: true
  },
  data: {
    uomStatus: STATUS_PENDING_TEXT,
    uomTone: "neutral",
    uomLoading: false,
    uomTileWarningVisible: false,
    uomTileWarningDismissed: false,
    uomDivisionEnabled: true
  },
  lifetimes: {
    created() {
      this._destroyed = false;
      this._enabled = true;
      this._center = null;
      this._region = null;
      this._scale = null;
      this._apiBase = "";
      this._refreshTimer = null;
      this._statusTimer = null;
      this._refreshSeq = 0;
      this._activeRequestTasks = new Set();
      this._lastRefreshKey = "";
      this._lastStatusPayload = null;
      this._tileResourceCache = new Map();
      this._tileResourcePromiseCache = new Map();
      this._resourceEntries = [];
      this._graphics = { polygons: [], polylines: [] };
      this._lastGraphicsToken = "";
      this._graphicsCoverageBounds = null;
      this._graphicsClipRegion = null;
      this._lastTileQueryEmpty = false;
      this._lastTileKeys = "";
      this._renderColor = readStoredRenderColor();
    },
    detached() {
      this.destroy();
    }
  },
  methods: {
    init(options = {}) {
      if (options.centerPin || options.center) {
        this._center = options.centerPin || options.center;
      }
      if (options.region) {
        this._region = options.region;
      }
      if (Number.isFinite(Number(options.scale))) {
        this._scale = Number(options.scale);
      }
      if (typeof options.enabled === "boolean") {
        this._enabled = options.enabled;
      }
      if (typeof options.apiBase === "string") {
        this._apiBase = options.apiBase;
      }
      this._renderColor = normalizeRenderColor(options.renderColor || this._renderColor);
      this.setData({
        uomDivisionEnabled: this._enabled !== false
      });
      this.scheduleRefresh(true);
    },

    handleRegionChange(options = {}) {
      if (options.centerPin || options.center) {
        this._center = options.centerPin || options.center;
      }
      if (options.region) {
        this._region = options.region;
      }
      if (Number.isFinite(Number(options.scale))) {
        this._scale = Number(options.scale);
      }
      this.updateStatusPanel();
      if (options.force === true || !this._resourceEntries.length || this.ensureGraphicsCoverage(false)) {
        this.scheduleRefresh(options.force === true);
      }
    },

    setEnabled(enabled) {
      this._enabled = enabled !== false;
      this.setData({ uomDivisionEnabled: this._enabled });
      if (!this._enabled) {
        this.abortActiveRequests();
        this._resourceEntries = [];
        this._lastTileQueryEmpty = false;
        this._lastTileKeys = "";
        this._lastGraphicsToken = "";
        this.rebuildGraphics(true);
        this.updateStatusPanel();
      }
      this.scheduleRefresh(true);
    },

    setRenderColor(renderColor) {
      const nextColor = normalizeRenderColor(renderColor);
      if (nextColor === this._renderColor) return;
      this._renderColor = nextColor;
      this.rebuildGraphics(true);
      this.updateStatusPanel();
    },

    scheduleFinalRefresh() {
      this.rebuildGraphics(false);
      this.scheduleRefresh(false);
    },

    startFollow() {},

    stopFollow() {},

    destroy() {
      this._destroyed = true;
      this.abortActiveRequests();
      if (this._refreshTimer) {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
      }
      if (this._statusTimer) {
        clearTimeout(this._statusTimer);
        this._statusTimer = null;
      }
    },

    trackRequest(request) {
      if (!request || !request.promise) {
        return Promise.resolve(null);
      }
      if (typeof request.abort === "function") {
        this._activeRequestTasks.add(request);
      }
      return request.promise.finally(() => {
        if (typeof request.abort === "function") {
          this._activeRequestTasks.delete(request);
        }
      });
    },

    abortActiveRequests() {
      if (!this._activeRequestTasks || !this._activeRequestTasks.size) return;
      for (const request of Array.from(this._activeRequestTasks)) {
        try {
          request.abort();
        } catch (err) {
          // ignore
        }
      }
      this._activeRequestTasks.clear();
    },

    emitGraphics() {
      if (this._destroyed) return;
      this.triggerEvent("graphicschange", {
        polygons: Array.isArray(this._graphics?.polygons) ? this._graphics.polygons : [],
        polylines: Array.isArray(this._graphics?.polylines) ? this._graphics.polylines : []
      });
    },

    emitStatus(extra = {}) {
      if (this._destroyed) return;
      const payload = Object.assign(
        {
          uomStatus: this.data.uomStatus,
          uomTone: this.data.uomTone,
          uomLoading: this.data.uomLoading,
          uomTileWarningVisible: false,
          uomTileWarningDismissed: false
        },
        extra || {}
      );
      if (sameStatusPayload(payload, this._lastStatusPayload)) return;
      this._lastStatusPayload = payload;
      this.triggerEvent("statuschange", payload);
    },

    resolveCenter() {
      const center = this._center;
      const latitude = Number(center?.latitude);
      const longitude = Number(center?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      return { latitude, longitude };
    },

    resolveCurrentViewportBounds() {
      return normalizeRegionBounds(this._region || null);
    },

    ensureGraphicsCoverage(force = false) {
      const currentBounds = this.resolveCurrentViewportBounds();
      if (!force && currentBounds && boundsContain(this._graphicsCoverageBounds, currentBounds)) {
        return false;
      }
      this._graphicsClipRegion = expandRegion(this._region || null);
      this._graphicsCoverageBounds = normalizeRegionBounds(this._graphicsClipRegion);
      this.rebuildGraphics(true);
      return true;
    },

    scheduleRefresh(force = false) {
      if (this._destroyed) return;
      if (this._refreshTimer) {
        clearTimeout(this._refreshTimer);
      }
      const delay = force ? 0 : REFRESH_DEBOUNCE_MS;
      this._refreshTimer = setTimeout(() => {
        this._refreshTimer = null;
        this.refreshTiles(force);
      }, delay);
    },

    buildTileQueryUrl() {
      const apiBase = `${this._apiBase || ""}`.trim();
      if (!apiBase) return "";
      const bounds = normalizeRegionBounds(expandRegion(this._region || null, GRAPHICS_COVERAGE_EXPAND_RATIO));
      if (bounds) {
        const params = encodeParams({
          minLng: bounds.minLng,
          minLat: bounds.minLat,
          maxLng: bounds.maxLng,
          maxLat: bounds.maxLat,
          limit: KML_TILE_QUERY_LIMIT
        });
        return `${apiBase}/api/offline-layer-kml/tiles?${params}`;
      }
      const center = this.resolveCenter();
      if (!center) return "";
      const params = encodeParams({
        longitude: center.longitude,
        latitude: center.latitude,
        radiusMeters: 5000,
        limit: KML_TILE_QUERY_LIMIT
      });
      return `${apiBase}/api/offline-layer-kml/tiles/nearby?${params}`;
    },

    async queryKmlTiles() {
      const url = this.buildTileQueryUrl();
      if (!url) {
        throw new Error("missing-kml-tile-query-url");
      }
      const res = await this.trackRequest(requestRaw({
        url,
        method: "GET",
        header: {
          "content-type": "application/json"
        }
      }));
      const rawTiles = res?.data?.data?.tiles || res?.data?.tiles || [];
      return (Array.isArray(rawTiles) ? rawTiles : [])
        .map((tile) => normalizeTile(tile, this._apiBase))
        .filter(Boolean);
    },

    rememberTileResource(tileKey, resource) {
      if (!tileKey || !resource) return;
      if (this._tileResourceCache.has(tileKey)) {
        this._tileResourceCache.delete(tileKey);
      }
      this._tileResourceCache.set(tileKey, resource);
      while (this._tileResourceCache.size > KML_TILE_RESOURCE_LRU_LIMIT) {
        const oldestKey = this._tileResourceCache.keys().next().value;
        if (!oldestKey) break;
        this._tileResourceCache.delete(oldestKey);
      }
    },

    async loadTileResource(tile) {
      const tileKey = tile?.key || "";
      if (!tileKey) return null;
      const cached = this._tileResourceCache.get(tileKey);
      if (cached) {
        this.rememberTileResource(tileKey, cached);
        return { tile, resource: cached };
      }
      if (this._tileResourcePromiseCache.has(tileKey)) {
        return this._tileResourcePromiseCache.get(tileKey);
      }
      const loader = (async () => {
        const res = await this.trackRequest(requestRaw({
          url: tile.url,
          method: "GET",
          responseType: "arraybuffer"
        }));
        const text = res?.data instanceof ArrayBuffer ? decodeArrayBuffer(res.data) : `${res?.data || ""}`;
        const parsed = buildParsedResourceFromKmlText(text, {
          renderColor: this._renderColor
        });
        this.rememberTileResource(tileKey, parsed);
        return { tile, resource: parsed };
      })().finally(() => {
        this._tileResourcePromiseCache.delete(tileKey);
      });
      this._tileResourcePromiseCache.set(tileKey, loader);
      return loader;
    },

    resolveActiveResource() {
      const entries = Array.isArray(this._resourceEntries) ? this._resourceEntries : [];
      if (!entries.length) return null;
      if (entries.length === 1) return entries[0].resource;
      const polygons = [];
      const polylines = [];
      entries.forEach((entry) => {
        const resource = entry?.resource || {};
        if (Array.isArray(resource.polygons) && resource.polygons.length) {
          polygons.push(...resource.polygons);
        }
        if (Array.isArray(resource.polylines) && resource.polylines.length) {
          polylines.push(...resource.polylines);
        }
      });
      return {
        polygons: dedupeBySignature(polygons, buildPolygonSignature),
        polylines: dedupeBySignature(polylines, buildPolylineSignature)
      };
    },

    resolveGraphicsFileToken() {
      return (Array.isArray(this._resourceEntries) ? this._resourceEntries : [])
        .map((entry) => `${entry?.tile?.key || ""}`.trim())
        .filter(Boolean)
        .join(",");
    },

    rebuildGraphics(force = false) {
      const nextToken = `${this._enabled ? 1 : 0}|${this.resolveGraphicsFileToken()}|${this._renderColor || ""}|${Number(this._scale) || 0}|${buildBoundsKey(this._graphicsCoverageBounds)}`;
      if (!force && nextToken === this._lastGraphicsToken) return;
      const activeResource = this.resolveActiveResource();
      if (!this._enabled || !activeResource) {
        this._graphics = { polygons: [], polylines: [] };
      } else {
        this._graphics = buildGraphicsFromParsedResource(activeResource, this._renderColor, {
          scale: this._scale,
          region: this._graphicsClipRegion || this._region || null
        });
      }
      this._lastGraphicsToken = nextToken;
      console.log("[uom4] emitGraphics", {
        tileCount: Array.isArray(this._resourceEntries) ? this._resourceEntries.length : 0,
        polygonCount: Array.isArray(this._graphics?.polygons) ? this._graphics.polygons.length : 0,
        polylineCount: Array.isArray(this._graphics?.polylines) ? this._graphics.polylines.length : 0
      });
      this.emitGraphics();
    },

    resolveStatus(center) {
      if (this._enabled === false) {
        return { uomStatus: STATUS_DISABLED_TEXT, uomTone: "warn", uomLoading: false };
      }
      if (!center) {
        return { uomStatus: STATUS_PENDING_TEXT, uomTone: "neutral", uomLoading: false };
      }
      if (this.data.uomLoading === true) {
        return { uomStatus: STATUS_PENDING_TEXT, uomTone: "neutral", uomLoading: true };
      }
      if (outOfChina(center.longitude, center.latitude) || resolveExcludedRegionRecord(center)) {
        return { uomStatus: UOM3_NON_RESTRICTED_STATUS_TEXT, uomTone: "safe", uomLoading: false };
      }
      const activeResource = this.resolveActiveResource();
      if (!activeResource) {
        return {
          uomStatus: this._lastTileQueryEmpty ? UOM3_RESTRICTED_STATUS_TEXT : STATUS_PENDING_TEXT,
          uomTone: this._lastTileQueryEmpty ? "alert" : "neutral",
          uomLoading: false
        };
      }
      const covered = pointCoveredBySuitableZone(center, activeResource);
      return {
        uomStatus: covered ? UOM3_SAFE_STATUS_TEXT : UOM3_RESTRICTED_STATUS_TEXT,
        uomTone: covered ? "safe" : "alert",
        uomLoading: false
      };
    },

    updateStatusPanel() {
      if (this._destroyed) return;
      if (this._statusTimer) {
        clearTimeout(this._statusTimer);
      }
      this._statusTimer = setTimeout(() => {
        this._statusTimer = null;
        const updates = Object.assign(
          {
            uomTileWarningVisible: false,
            uomTileWarningDismissed: false
          },
          this.resolveStatus(this.resolveCenter())
        );
        this.setData(updates, () => this.emitStatus(updates));
      }, STATUS_EVAL_DELAY_MS);
    },

    async refreshTiles(force = false) {
      const center = this.resolveCenter();
      const bounds = normalizeRegionBounds(expandRegion(this._region || null, GRAPHICS_COVERAGE_EXPAND_RATIO));
      const refreshKey = [
        center ? center.latitude.toFixed(6) : "none",
        center ? center.longitude.toFixed(6) : "none",
        buildBoundsKey(bounds),
        this._enabled ? 1 : 0
      ].join("|");
      if (!force && refreshKey === this._lastRefreshKey) {
        this.updateStatusPanel();
        return;
      }
      this._lastRefreshKey = refreshKey;
      if (!this._enabled) {
        this.abortActiveRequests();
        this._resourceEntries = [];
        this._lastTileQueryEmpty = false;
        this._lastTileKeys = "";
        this._lastGraphicsToken = "";
        this._graphicsCoverageBounds = null;
        this._graphicsClipRegion = null;
        this.setData({ uomLoading: false });
        this.rebuildGraphics(true);
        this.updateStatusPanel();
        return;
      }
      if (!center) {
        this.abortActiveRequests();
        this.setData({ uomLoading: false });
        this.updateStatusPanel();
        return;
      }
      if (outOfChina(center.longitude, center.latitude) || resolveExcludedRegionRecord(center)) {
        this.abortActiveRequests();
        this._resourceEntries = [];
        this._lastTileQueryEmpty = false;
        this.setData({ uomLoading: false });
        this.rebuildGraphics(true);
        this.updateStatusPanel();
        return;
      }

      const refreshSeq = this._refreshSeq + 1;
      this._refreshSeq = refreshSeq;
      this.abortActiveRequests();
      this.setData({ uomLoading: true }, () => {
        this.updateStatusPanel();
      });
      try {
        const tiles = await this.queryKmlTiles();
        if (this._destroyed || refreshSeq !== this._refreshSeq) return;
        const tileKeys = tiles.map((tile) => tile.key).sort().join("|");
        this._lastTileQueryEmpty = tiles.length === 0;
        if (!tiles.length) {
          this._resourceEntries = [];
          this._lastTileQueryEmpty = true;
          this._lastTileKeys = "";
          this._lastGraphicsToken = "";
          this.setData({ uomLoading: false }, () => {
            this.rebuildGraphics(true);
            this.updateStatusPanel();
          });
          return;
        }
        if (!force && tileKeys === this._lastTileKeys && this._resourceEntries.length) {
          this.setData({ uomLoading: false }, () => this.updateStatusPanel());
          return;
        }
        const loaded = await Promise.all(tiles.map((tile) => this.loadTileResource(tile)));
        if (this._destroyed || refreshSeq !== this._refreshSeq) return;
        this._resourceEntries = loaded.filter((entry) => entry && entry.resource);
        this._lastTileKeys = tileKeys;
        this._lastGraphicsToken = "";
        this.ensureGraphicsCoverage(true);
        this.setData({ uomLoading: false }, () => this.updateStatusPanel());
      } catch (err) {
        if (this._destroyed || refreshSeq !== this._refreshSeq) return;
        console.warn("[uom4] refreshTiles failed", {
          center,
          error: err?.message || err?.errMsg || `${err || ""}`
        });
        if (err?.code === "REQUEST_ABORTED" || err?.message === "request-aborted") {
          this.setData({ uomLoading: false }, () => this.updateStatusPanel());
          return;
        }
        const updates = {
          uomStatus: STATUS_LOAD_FAILED_TEXT,
          uomTone: "warn",
          uomLoading: false,
          uomTileWarningVisible: false,
          uomTileWarningDismissed: false
        };
        this.setData(updates, () => this.emitStatus(updates));
      }
    }
  }
});
