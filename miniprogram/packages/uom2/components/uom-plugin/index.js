const { buildWmsOverlay, WMS_MIN_ZOOM, WMS_MAX_ZOOM } = require("../../../../utils/wms");
const {
  isWeChatRuntime,
  isDesktopRuntime,
  shouldUseWeChatUom
} = require("../../../../utils/runtime");
const {
  buildProvinceLayerRecords,
  buildProvinceLayerParams,
  findProvinceLayerRecordForPoint
} = require("../../../../utils/uomProvinceSelector");
const {
  gcj02ToWgs84,
  wgs84ToGcj02,
  lonLatToMercator,
  haversineMeters
} = require("../../../../utils/coords");
const provinceGeojson = require("../../map-meta-data/China.js");

const MAP_MIN_SCALE = 0;
const MAP_MAX_SCALE = 18;
const DEFAULT_MAP_SCALE = 11;
const WEB_TILE_SIZE = 256;
const VIEWPORT_PADDING_PX = 120;
const TILE_ALPHA_DEFAULT = 0.65;
const TILE_SAMPLE_SIZE = 64;
const TILE_LOAD_TIMEOUT_MS = 8000;
const PAN_REFRESH_DEBOUNCE_MS = 80;
const ZOOM_SETTLE_DELAY_MS = 500;
const STATUS_EVAL_DELAY_MS = 160;
const FOLLOW_INTERVAL_MS = 80;
const TILE_KEEP_RADIUS = 1;
const TILE_CACHE_LIMIT = 9;
const MASK_ALPHA_THRESHOLD = 16;

const FORCE_HTTP_MARKER = true;

const SAFE_STATUS_TEXT = "适飞区域（限高120m）";
const RESTRICTED_STATUS_TEXT = "管制区域";

const NON_RESTRICTED_STATUS_TEXT = "非管制区域";
const isHttpUrl = (value) => /^https?:\/\//.test(value || "");
const isLocalPath = (value) => !!value && !isHttpUrl(value);
const getMiniApi = () => {
  if (typeof qq !== "undefined") return qq;
  if (typeof wx !== "undefined") return wx;
  return null;
};

const clampMapScale = (value) => {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : DEFAULT_MAP_SCALE;
  const rounded = Math.round(base);
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, rounded));
};

const sameStatusPayload = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.uomStatus === b.uomStatus &&
    a.uomTone === b.uomTone &&
    a.uomLoading === b.uomLoading &&
    a.uomTileWarningVisible === b.uomTileWarningVisible &&
    a.uomTileWarningDismissed === b.uomTileWarningDismissed
  );
};

const lonLatToWorldPixel = (lng, lat, zoom, tileSize = WEB_TILE_SIZE) => {
  const scale = Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * scale * tileSize;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y =
    (0.5 -
      Math.log((1 + sinLat) / (1 - sinLat)) /
      (4 * Math.PI)) *
    scale *
    tileSize;
  return { x, y };
};

const resolveRegionCenter = (region) => {
  if (!region || !region.northeast || !region.southwest) return null;
  return {
    latitude: (region.northeast.latitude + region.southwest.latitude) / 2,
    longitude: (region.northeast.longitude + region.southwest.longitude) / 2
  };
};

const buildCenterTileIdSet = (center, zoom, radius = TILE_KEEP_RADIUS) => {
  if (!center || !Number.isFinite(center.latitude) || !Number.isFinite(center.longitude)) {
    return new Set();
  }
  const world = lonLatToWorldPixel(center.longitude, center.latitude, zoom, WEB_TILE_SIZE);
  const maxIndex = Math.pow(2, zoom) - 1;
  const cx = Math.min(maxIndex, Math.max(0, Math.floor(world.x / WEB_TILE_SIZE)));
  const cy = Math.min(maxIndex, Math.max(0, Math.floor(world.y / WEB_TILE_SIZE)));
  const span = Number.isFinite(radius) ? Math.max(0, Math.round(radius)) : 0;
  const ids = new Set();
  for (let dx = -span; dx <= span; dx += 1) {
    for (let dy = -span; dy <= span; dy += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x > maxIndex || y > maxIndex) continue;
      ids.add(`${zoom}-${x}-${y}`);
    }
  }
  return ids;
};

const buildTileIdSetKey = (tileIds) => {
  if (!(tileIds instanceof Set) || !tileIds.size) return "";
  return Array.from(tileIds).sort().join("|");
};

const UOM_PROVINCE_LAYER_RECORDS = buildProvinceLayerRecords(provinceGeojson);
const UOM_REGION_RECORDS = buildProvinceLayerRecords(provinceGeojson, { includeSpecialRegions: true });
const UOM_PROVINCE_LAYER_PARAM_CACHE = new Map();
const UOM_PROVINCE_LAYER_PARAM_CACHE_LIMIT = 128;
const SPECIAL_REGION_CODE_SET = new Set(["71", "81", "82"]);

const getProvinceLayerCacheKey = (bbox) => {
  const sw = bbox?.southwest || {};
  const ne = bbox?.northeast || {};
  return [
    Number(sw.longitude).toFixed(6),
    Number(sw.latitude).toFixed(6),
    Number(ne.longitude).toFixed(6),
    Number(ne.latitude).toFixed(6)
  ].join(",");
};

const resolveProvinceLayerParams = (bbox) => {
  const key = getProvinceLayerCacheKey(bbox);
  if (UOM_PROVINCE_LAYER_PARAM_CACHE.has(key)) {
    return UOM_PROVINCE_LAYER_PARAM_CACHE.get(key);
  }
  const params = buildProvinceLayerParams(UOM_PROVINCE_LAYER_RECORDS, bbox);
  if (UOM_PROVINCE_LAYER_PARAM_CACHE.size >= UOM_PROVINCE_LAYER_PARAM_CACHE_LIMIT) {
    const oldestKey = UOM_PROVINCE_LAYER_PARAM_CACHE.keys().next().value;
    if (oldestKey) {
      UOM_PROVINCE_LAYER_PARAM_CACHE.delete(oldestKey);
    }
  }
  UOM_PROVINCE_LAYER_PARAM_CACHE.set(key, params);
  return params;
};

const resolveExcludedRegionRecord = (point) => {
  const record = findProvinceLayerRecordForPoint(UOM_REGION_RECORDS, point);
  if (!record) return null;
  return SPECIAL_REGION_CODE_SET.has(record.provinceCode) ? record : null;
};

Component({
  options: { virtualHost: true },
  data: {
    tiles: [],
    uomStatus: "评估中",
    uomTone: "neutral",
    uomLoading: false,
    uomTileWarningVisible: false,
    uomTileWarningDismissed: false,
    uomDivisionEnabled: true
  },
  lifetimes: {
    created() {
      this._miniApi = getMiniApi();
      this._tileSession = null;
      this._sessionSeq = 0;
      this._refreshTimer = null;
      this._zoomTimer = null;
      this._statusTimer = null;
      this._renderTimer = null;
      this._renderEpoch = 0;
      this._destroyed = false;
      this._runtimeIsWeChat = null;
      this._followAlways = false;
      this._viewport = null;
      this._center = null;
      this._scale = null;
      this._pendingZoom = null;
      this._region = null;
      this._enabled = true;
      this._followTimer = null;
      this._idleTimer = null;
      this._scaleWatchTimer = null;
      this._lastScaleWatch = null;
      this._lastFollowCenter = null;
      this._lastCenterAt = 0;
      this._isMoving = false;
      this._renderMode = "marker";
      this._allowHttpMarker = true;
      this._forceHttpMarker = true;
      this._coordType = "gcj02";
      this._centerCoordType = "gcj02";
      this._offscreenSupported =
        !!this._miniApi && typeof this._miniApi.createOffscreenCanvas === "function";
      this._currentTiles = [];
      this._currentTileKey = "";
      this._lastRenderedZoom = null;
      this._lastRenderedTileKey = "";
      this._committedMarkers = [];
      this._retainMarkersOnZoom = false;
      this._lastStatusPayload = null;
    },
    ready() {
      if (!this._miniApi) {
        this._miniApi = getMiniApi();
      }
      this._runtimeIsWeChat = shouldUseWeChatUom();
      console.log("[uom2] env", {
        runtimeIsWeChat: this._runtimeIsWeChat,
        hasWx: typeof wx !== "undefined",
        hasQq: typeof qq !== "undefined"
      });
      this.ensureViewport();
    },
    detached() {
      this.destroy();
    }
  },
  methods: {
    init(options = {}) {
      const {
        mapCtx,
        center,
        centerPin,
        scale,
        region,
        enabled,
        coordType,
        centerCoordType
      } = options;
      this.mapCtx = mapCtx || this.mapCtx || null;
      if (center || centerPin) {
        this._center = center || centerPin;
      }
      if (Number.isFinite(scale)) {
        this._scale = scale;
        this._pendingZoom = clampMapScale(scale);
      }
      if (region) {
        this._region = region;
      }
      if (typeof enabled === "boolean") {
        this._enabled = enabled;
        this.setData({ uomDivisionEnabled: enabled });
      }
      if (coordType) {
        this._coordType = `${coordType}`.toLowerCase();
      }
      if (centerCoordType) {
        this._centerCoordType = `${centerCoordType}`.toLowerCase();
      }
      if (this._runtimeIsWeChat === null) {
        this._runtimeIsWeChat = shouldUseWeChatUom();
      }
      if (this._runtimeIsWeChat) {
        this.clearTiles();
        return;
      }
      this._allowHttpMarker = FORCE_HTTP_MARKER ? true : this.detectAllowHttpMarker();
      this._forceHttpMarker = FORCE_HTTP_MARKER;
      console.log("[uom2] init", {
        runtimeIsWeChat: this._runtimeIsWeChat,
        enabled: this._enabled,
        allowHttpMarker: this._allowHttpMarker,
        forceHttpMarker: this._forceHttpMarker
      });
      this._followAlways = false;
      this.ensureViewport(() => {
        this.refreshTiles();
        this.startFollow();
        this.startScaleWatch();
      });
    },

    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      if (this._refreshTimer) {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
      }
      if (this._idleTimer) {
        clearTimeout(this._idleTimer);
        this._idleTimer = null;
      }
      if (this._zoomTimer) {
        clearTimeout(this._zoomTimer);
        this._zoomTimer = null;
      }
      if (this._statusTimer) {
        clearTimeout(this._statusTimer);
        this._statusTimer = null;
      }
      if (this._renderTimer) {
        clearTimeout(this._renderTimer);
        this._renderTimer = null;
      }
      if (this._scaleWatchTimer) {
        clearTimeout(this._scaleWatchTimer);
        this._scaleWatchTimer = null;
      }
      this.stopFollow();
      this.stopScaleWatch();
      this.clearTileSession();
      this._retainMarkersOnZoom = false;
      this.emitTileMarkers([], { force: true });
      this.mapCtx = null;
      this._lastStatusPayload = null;
    },

    setEnabled(enabled) {
      const next = enabled !== false;
      if (this._enabled === next) return;
      this._enabled = next;
      this.setData({ uomDivisionEnabled: next });
      if (!next) {
        this.clearTiles();
        this._retainMarkersOnZoom = false;
        this.emitTileMarkers([], { force: true });
        this.updateStatusPanel();
        return;
      }
      this.scheduleRefresh(true);
    },

    handleRegionChange(options = {}) {
      if (this._destroyed) return;
      const {
        center,
        centerPin,
        scale,
        rawScale,
        region,
        force,
        coordType,
        centerCoordType
      } = options;
      if (center || centerPin) {
        this._center = center || centerPin;
      }
      const numericRawScale = Number(rawScale);
      const numericScale = Number(scale);
      if (Number.isFinite(numericRawScale)) {
        this._scale = numericRawScale;
        this._pendingZoom = clampMapScale(numericRawScale);
      } else if (Number.isFinite(numericScale)) {
        this._scale = numericScale;
        this._pendingZoom = clampMapScale(numericScale);
      }
      if (region) {
        this._region = region;
      }
      if (coordType) {
        this._coordType = `${coordType}`.toLowerCase();
      }
      if (centerCoordType) {
        this._centerCoordType = `${centerCoordType}`.toLowerCase();
      }
      this.scheduleRefresh(!!force);
    },

    scheduleRefresh(force) {
      if (this._destroyed) return;
      if (this._runtimeIsWeChat) {
        this.clearTiles();
        return;
      }
      if (!this._enabled) {
        this.clearTiles();
        this.updateStatusPanel();
        return;
      }
      if (!force && this.isFractionalScale()) {
        this.scheduleZoomRefresh();
        return;
      }
      if (this._pendingZoom != null && this._tileSession) {
        if (this._tileSession.zoom !== this._pendingZoom) {
          this.scheduleZoomRefresh();
          return;
        }
      }
      if (this._refreshTimer) {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
      }
      const delay = force ? 0 : PAN_REFRESH_DEBOUNCE_MS;
      this._refreshTimer = setTimeout(() => {
        this._refreshTimer = null;
        this.refreshTiles();
      }, delay);
    },

    scheduleZoomRefresh() {
      if (this._destroyed) return;
      if (this._zoomTimer) {
        clearTimeout(this._zoomTimer);
        this._zoomTimer = null;
      }
      this._zoomTimer = setTimeout(() => {
        this._zoomTimer = null;
        if (this._destroyed) return;
        this.refreshTiles(true);
      }, ZOOM_SETTLE_DELAY_MS);
    },

    scheduleFinalRefresh() {
      if (this._destroyed) return;
      this._isMoving = false;
      this.scheduleRefresh(true);
      const zoomPending =
        this._pendingZoom != null &&
        this._tileSession &&
        this._tileSession.zoom !== this._pendingZoom;
      const delay = zoomPending ? ZOOM_SETTLE_DELAY_MS + STATUS_EVAL_DELAY_MS : STATUS_EVAL_DELAY_MS;
      this.scheduleStatusEvaluation(delay);
    },

    resolveCenterForTiles(center) {
      if (!center || !Number.isFinite(center.longitude) || !Number.isFinite(center.latitude)) {
        return null;
      }
      const coordType = this._coordType || "wgs84";
      const centerType = this._centerCoordType || coordType;
      if (coordType === centerType) return center;
      if (coordType === "wgs84" && centerType === "gcj02") {
        const wgs = gcj02ToWgs84(center.longitude, center.latitude);
        return { longitude: wgs.lng, latitude: wgs.lat };
      }
      if (coordType === "gcj02" && centerType === "wgs84") {
        const gcj = wgs84ToGcj02(center.longitude, center.latitude);
        return { longitude: gcj.lng, latitude: gcj.lat };
      }
      return center;
    },

    startFollow() {
      if (this._runtimeIsWeChat === null) {
        this._runtimeIsWeChat = isWeChatRuntime();
      }
      if (this._destroyed || this._runtimeIsWeChat) return;
      if (!this.mapCtx || typeof this.mapCtx.getCenterLocation !== "function") return;
      if (this._followTimer) return;
      this._isMoving = true;
      const tick = () => {
        if (this._destroyed || this._runtimeIsWeChat) {
          this.stopFollow();
          return;
        }
        if (!this.mapCtx || typeof this.mapCtx.getCenterLocation !== "function") {
          this.stopFollow();
          return;
        }
        this.requestCenterLocation();
        if (typeof this.mapCtx.getRegion === "function") {
          this.mapCtx.getRegion({
            success: (res) => {
              const region = res?.region || res;
              if (region && region.northeast && region.southwest) {
                const center = resolveRegionCenter(region);
                this.handleFollowSample(center, region, "region");
              }
            }
          });
        }
        this._followTimer = setTimeout(tick, FOLLOW_INTERVAL_MS);
      };
      this._followTimer = setTimeout(tick, 0);
    },

    stopFollow() {
      if (this._followTimer) {
        clearTimeout(this._followTimer);
        this._followTimer = null;
      }
      const wasMoving = this._isMoving;
      this._isMoving = false;
      if (wasMoving) {
        this.scheduleFinalRefresh();
      }
    },

    startScaleWatch() {
      if (this._destroyed || this._runtimeIsWeChat) return;
      if (!this.mapCtx || typeof this.mapCtx.getScale !== "function") return;
      if (this._scaleWatchTimer) return;
      const tick = () => {
        if (this._destroyed || this._runtimeIsWeChat) {
          this.stopScaleWatch();
          return;
        }
        if (!this.mapCtx || typeof this.mapCtx.getScale !== "function") {
          this.stopScaleWatch();
          return;
        }
        this.mapCtx.getScale({
          success: (res) => {
            const nextScale = Number(res?.scale);
            if (!Number.isFinite(nextScale)) return;
            const prev = Number(this._lastScaleWatch);
            if (!Number.isFinite(prev) || Math.abs(prev - nextScale) > 0.001) {
              this._lastScaleWatch = nextScale;
              this.handleRegionChange({
                scale: clampMapScale(nextScale),
                rawScale: nextScale,
                force: true
              });
            }
          }
        });
        this._scaleWatchTimer = setTimeout(tick, 200);
      };
      this._scaleWatchTimer = setTimeout(tick, 200);
    },

    stopScaleWatch() {
      if (this._scaleWatchTimer) {
        clearTimeout(this._scaleWatchTimer);
        this._scaleWatchTimer = null;
      }
    },

    requestCenterLocation() {
      if (!this.mapCtx || typeof this.mapCtx.getCenterLocation !== "function") return;
      this.mapCtx.getCenterLocation({
        type: "gcj02",
        success: (res) => {
          const center = { latitude: res.latitude, longitude: res.longitude };
          this.handleFollowSample(center, null, "center");
        }
      });
    },

    handleFollowSample(center, region, source) {
      const now = Date.now();
      if (region) {
        this._region = region;
      }
      if (
        center &&
        Number.isFinite(center.latitude) &&
        Number.isFinite(center.longitude) &&
        (
          source === "center" ||
          !this._lastCenterAt ||
          now - this._lastCenterAt > 200
        )
      ) {
        this._center = center;
        this._centerCoordType = "gcj02";
        this._coordType = "gcj02";
        if (source === "center") {
          this._lastCenterAt = now;
        }
        if (this.hasCenterMoved(center)) {
          this.markMoving();
        }
      }
      this.scheduleRefresh(false);
    },

    hasCenterMoved(center) {
      if (!center) return false;
      if (!this._lastFollowCenter) {
        this._lastFollowCenter = center;
        return true;
      }
      const dist = haversineMeters(
        this._lastFollowCenter.latitude,
        this._lastFollowCenter.longitude,
        center.latitude,
        center.longitude
      );
      if (!Number.isFinite(dist)) return false;
      if (dist >= 2) {
        this._lastFollowCenter = center;
        return true;
      }
      return false;
    },

    markMoving() {
      this._isMoving = true;
      if (this._idleTimer) {
        clearTimeout(this._idleTimer);
        this._idleTimer = null;
      }
      this._idleTimer = setTimeout(() => {
        this._idleTimer = null;
        this._isMoving = false;
        this.scheduleFinalRefresh();
      }, STATUS_EVAL_DELAY_MS);
    },

    refreshTiles(forceZoomSession) {
      if (this._destroyed) return;
      if (this._runtimeIsWeChat || !this._enabled) {
        this.clearTiles();
        this.emitTileMarkers([]);
        this.updateStatusPanel();
        return;
      }
      const regionCenter = this._isMoving ? null : resolveRegionCenter(this._region);
      const center = this.resolveCenterForTiles(regionCenter || this._center);
      if (!center || !Number.isFinite(center.longitude) || !Number.isFinite(center.latitude)) {
        this.clearTiles();
        this.emitTileMarkers([]);
        this.updateStatusPanel();
        return;
      }
      if (resolveExcludedRegionRecord(center)) {
        this._currentTiles = [];
        this._currentTileKey = "";
        this.clearTiles();
        this.emitTileMarkers([]);
        this.updateStatusPanel();
        return;
      }
      if (!this._viewport) {
        this.ensureViewport(() => this.refreshTiles(forceZoomSession));
        return;
      }
      const scale = clampMapScale(this._scale);
      const zoom = Number.isFinite(this._pendingZoom) ? this._pendingZoom : scale;
      if (!Number.isFinite(zoom) || zoom < WMS_MIN_ZOOM || zoom > WMS_MAX_ZOOM) {
        this.clearTiles();
        this.emitTileMarkers([]);
        this.updateStatusPanel();
        return;
      }
      const keepIds = buildCenterTileIdSet(center, zoom, TILE_KEEP_RADIUS);
      const tileKey = buildTileIdSetKey(keepIds);
      if (!this._tileSession || forceZoomSession || this._tileSession.zoom !== zoom) {
        this.createTileSession(zoom);
      }
      if (
        !forceZoomSession &&
        this._tileSession &&
        this._tileSession.zoom === zoom &&
        tileKey &&
        tileKey === this._currentTileKey &&
        Array.isArray(this._currentTiles) &&
        this._currentTiles.length
      ) {
        const session = this._tileSession;
        this._currentTiles.forEach((tile) => {
          this.ensureTileEntry(session, tile);
          this.ensureTileSrc(session, tile);
        });
        this.requestRender();
        if (!this._isMoving) {
          this.scheduleStatusEvaluation();
        }
        return;
      }
      const viewport = this._viewport;
      let tiles = buildWmsOverlay(center, zoom, this._region, {
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        viewportPaddingPx: VIEWPORT_PADDING_PX,
        tileSize: WEB_TILE_SIZE,
        maskSize: TILE_SAMPLE_SIZE,
        coordType: this._coordType || "gcj02",
        resolveLayerParams: resolveProvinceLayerParams
      });
      if (!Array.isArray(tiles)) tiles = [];
      tiles = tiles.filter((tile) => keepIds.has(tile.id));
      this._currentTiles = tiles;
      this._currentTileKey = tileKey;
      const session = this._tileSession;
      tiles.forEach((tile) => this.ensureTileEntry(session, tile));
      this.enforceTileCacheLimit(session, keepIds);
      tiles.forEach((tile) => this.ensureTileSrc(session, tile));
      // console.log("[uom2] refresh tiles", {
      //   zoom,
      //   tileCount: tiles.length,
      //   moving: this._isMoving
      // });
      this.requestRender();
      if (!this._isMoving) {
        this.scheduleStatusEvaluation();
      }
    },

    clearTiles() {
      this._lastRenderedZoom = null;
      this._lastRenderedTileKey = "";
      if (this.data.tiles && this.data.tiles.length) {
        this.setData({ tiles: [] });
      }
      if (this._renderMode === "marker") {
        this.emitTileMarkers([]);
      }
    },

    createTileSession(zoom) {
      if (
        this._renderMode === "marker" &&
        Number.isFinite(this._lastRenderedZoom) &&
        this._lastRenderedZoom !== zoom &&
        Array.isArray(this._committedMarkers) &&
        this._committedMarkers.length
      ) {
        this._retainMarkersOnZoom = true;
      }
      this.clearTileSession();
      const sessionId = `${zoom}-${Date.now()}-${this._sessionSeq++}`;
      this._tileSession = {
        id: sessionId,
        zoom,
        tiles: new Map()
      };
    },

    clearTileSession() {
      if (!this._tileSession) return;
      const session = this._tileSession;
      for (const entry of session.tiles.values()) {
        this.abortTileEntry(entry);
      }
      session.tiles.clear();
      this._tileSession = null;
      this._currentTileKey = "";
      this.syncUomLoadingState();
    },

    resolveUomLoadingState() {
      const session = this._tileSession;
      if (!session || !session.tiles || !session.tiles.size) return false;
      for (const entry of session.tiles.values()) {
        if (entry && (entry.status === "pending" || entry.maskStatus === "pending")) {
          return true;
        }
      }
      return false;
    },

    syncUomLoadingState() {
      if (this._destroyed) return;
      const loading = this.resolveUomLoadingState();
      if (this.data.uomLoading === loading) return;
      this.setData({ uomLoading: loading }, () => this.emitStatus({ uomLoading: loading }));
    },

    ensureTileEntry(session, tile) {
      if (!session || !tile || !tile.id) return null;
      const existing = session.tiles.get(tile.id);
      if (existing) {
        existing.tile = tile;
        return existing;
      }
      const entry = {
        id: tile.id,
        tile,
        status: "idle",
        src: "",
        localSrc: "",
        maskSrc: "",
        promise: null,
        downloadTask: null,
        downloadTimer: null,
        maskStatus: "idle",
        maskData: null,
        maskWidth: 0,
        maskHeight: 0,
        httpMarkerSrc: "",
        httpMarkerVerified: undefined
      };
      session.tiles.set(tile.id, entry);
      return entry;
    },

    enforceTileCacheLimit(session, keepIds) {
      if (!session || !session.tiles || session.tiles.size <= TILE_CACHE_LIMIT) return;
      const keepSet = keepIds instanceof Set ? keepIds : new Set();
      for (const key of Array.from(session.tiles.keys())) {
        if (session.tiles.size <= TILE_CACHE_LIMIT) break;
        if (keepSet.has(key)) continue;
        const entry = session.tiles.get(key);
        if (entry) this.abortTileEntry(entry);
        session.tiles.delete(key);
      }
    },

    ensureTileSrc(session, tile) {
      if (!session || !tile || !tile.id) return Promise.resolve("");
      const entry = session.tiles.get(tile.id);
      if (!entry) return Promise.resolve("");
      if (entry.status === "ready") return Promise.resolve(entry.src || "");
      if (entry.status === "pending" && entry.promise) return entry.promise;
      entry.status = "pending";
      this.syncUomLoadingState();
      entry.promise = this.downloadTile(tile.src, entry)
        .then((src) => {
          if (this._destroyed || session !== this._tileSession) return "";
          if (!session.tiles.has(tile.id)) return "";
          if (!src) {
            entry.status = "error";
            entry.promise = null;
            this.syncUomLoadingState();
            return "";
          }
          entry.status = "ready";
          entry.src = src || "";
          entry.promise = null;
          this.syncUomLoadingState();
          this.requestRender();
          if (!this._isMoving) {
            this.scheduleStatusEvaluation();
          }
          return entry.src;
        })
        .catch(() => {
          if (session !== this._tileSession) return "";
          if (!session.tiles.has(tile.id)) return "";
          entry.status = "error";
          entry.promise = null;
          this.syncUomLoadingState();
          return "";
        });
      return entry.promise;
    },

    abortTileEntry(entry) {
      if (!entry) return;
      const wasPending = entry.status === "pending" || entry.maskStatus === "pending";
      if (entry.downloadTimer) {
        clearTimeout(entry.downloadTimer);
        entry.downloadTimer = null;
      }
      if (entry.downloadTask && typeof entry.downloadTask.abort === "function") {
        try {
          entry.downloadTask.abort();
        } catch (err) {
          // ignore
        }
      }
      entry.downloadTask = null;
      entry.promise = null;
      entry.localSrc = "";
      entry.maskSrc = "";
      entry.maskStatus = "idle";
      entry.maskData = null;
      entry.maskWidth = 0;
      entry.maskHeight = 0;
      entry.httpMarkerSrc = "";
      entry.httpMarkerVerified = undefined;
      if (wasPending) {
        entry.status = "idle";
        entry.maskStatus = "idle";
        this.syncUomLoadingState();
      }
    },

    downloadTile(src, entry) {
      const isMarkerRender = this._renderMode === "marker";
      if (this._forceHttpMarker) {
        if (!isMarkerRender) {
          return Promise.resolve(src || "");
        }
        if (!src || !isHttpUrl(src)) {
          return Promise.resolve(src || "");
        }
        return this.verifyHttpMarkerSource(src, entry).then((ok) => (ok ? src : ""));
      }
      if (!src) {
        return Promise.resolve("");
      }
      if (!isHttpUrl(src)) {
        return Promise.resolve(src || "");
      }
      const api = this._miniApi || getMiniApi();
      if (!api || typeof api.downloadFile !== "function") {
        return Promise.resolve(isMarkerRender ? "" : (src || ""));
      }
      return new Promise((resolve) => {
        const finalize = (path) => resolve(path || "");
        const fallbackSrc = () => (isMarkerRender ? "" : (this._allowHttpMarker ? src : ""));
        const persistIfNeeded = (path) => {
          if (!path) {
            finalize("");
            return;
          }
          if (this._renderMode === "marker") {
            this.persistMarkerFile(path, entry)
              .then((localPath) => finalize(localPath || ""))
              .catch(() => finalize(path));
            return;
          }
          if (!api || typeof api.saveFile !== "function") {
            finalize(path);
            return;
          }
          api.saveFile({
            tempFilePath: path,
            success: (res) => {
              const saved = res?.savedFilePath || path;
              entry.localSrc = saved;
              finalize(saved);
            },
            fail: () => finalize(path)
          });
        };
        entry.downloadTask = api.downloadFile({
          url: src,
          success: (res) => {
            if (entry.downloadTimer) {
              clearTimeout(entry.downloadTimer);
              entry.downloadTimer = null;
            }
            const statusCode = Number(res?.statusCode);
            const filePath = res?.tempFilePath;
            if (statusCode === 200 && filePath) {
              persistIfNeeded(filePath);
              return;
            }
            console.warn("[uom2] download failed", { statusCode, src });
            finalize(fallbackSrc());
          },
          fail: (err) => {
            if (entry.downloadTimer) {
              clearTimeout(entry.downloadTimer);
              entry.downloadTimer = null;
            }
            console.warn("[uom2] download error", { src, err });
            finalize(fallbackSrc());
          }
        });
        if (TILE_LOAD_TIMEOUT_MS > 0) {
          entry.downloadTimer = setTimeout(() => {
            finalize(fallbackSrc());
          }, TILE_LOAD_TIMEOUT_MS);
        }
      });
    },

    downloadTileForMask(src, entry) {
      const api = this._miniApi || getMiniApi();
      if (!src || !isHttpUrl(src) || !api || typeof api.downloadFile !== "function") {
        return Promise.resolve("");
      }
      if (entry?.maskSrc && isLocalPath(entry.maskSrc)) {
        return Promise.resolve(entry.maskSrc);
      }
      const tryGetImageInfo = () =>
        new Promise((resolve, reject) => {
          if (!api || typeof api.getImageInfo !== "function") {
            reject(new Error("get-image-info-unavailable"));
            return;
          }
          api.getImageInfo({
            src,
            success: (res) => resolve(res?.path || res?.tempFilePath || ""),
            fail: (err) => reject(err || new Error("get-image-info-failed"))
          });
        });
      const tryDownload = () =>
        new Promise((resolve) => {
          api.downloadFile({
            url: src,
            success: (res) => {
              const statusCode = Number(res?.statusCode);
              const filePath = res?.tempFilePath;
              if (statusCode === 200 && filePath) {
                resolve(filePath);
                return;
              }
              resolve("");
            },
            fail: () => resolve("")
          });
        });
      return tryGetImageInfo()
        .catch(() => tryDownload())
        .then((path) => {
          if (path && entry) entry.maskSrc = path;
          return path || "";
        });
    },

    verifyHttpMarkerSource(src, entry) {
      if (!src || !isHttpUrl(src)) return Promise.resolve(!!src);
      if (entry?.httpMarkerSrc === src && typeof entry.httpMarkerVerified === "boolean") {
        return Promise.resolve(entry.httpMarkerVerified);
      }
      const api = this._miniApi || getMiniApi();
      if (!api) {
        if (entry) {
          entry.httpMarkerSrc = src;
          entry.httpMarkerVerified = false;
        }
        return Promise.resolve(false);
      }
      const mark = (ok) => {
        if (entry) {
          entry.httpMarkerSrc = src;
          entry.httpMarkerVerified = !!ok;
        }
        return !!ok;
      };
      const tryGetImageInfo = () => new Promise((resolve) => {
        if (typeof api.getImageInfo !== "function") {
          resolve(null);
          return;
        }
        api.getImageInfo({
          src,
          success: () => resolve(true),
          fail: () => resolve(false)
        });
      });
      const tryDownload = () => new Promise((resolve) => {
        if (typeof api.downloadFile !== "function") {
          resolve(false);
          return;
        }
        api.downloadFile({
          url: src,
          success: (res) => resolve(Number(res?.statusCode) === 200 && !!res?.tempFilePath),
          fail: () => resolve(false)
        });
      });
      return tryGetImageInfo()
        .then((ok) => {
          if (ok === null) return tryDownload();
          return ok;
        })
        .then(mark)
        .catch(() => mark(false));
    },

    detectAllowHttpMarker() {
      const api = this._miniApi || getMiniApi();
      let appBase = {};
      let deviceInfo = {};
      try {
        if (api && typeof api.getAppBaseInfo === "function") {
          appBase = api.getAppBaseInfo() || {};
        }
      } catch (err) {
        appBase = {};
      }
      try {
        if (api && typeof api.getDeviceInfo === "function") {
          deviceInfo = api.getDeviceInfo() || {};
        }
      } catch (err) {
        deviceInfo = {};
      }
      const appName = `${appBase.appName || appBase.hostName || ""}`.toLowerCase();
      const host = `${appBase.host || appBase.hostName || ""}`.toLowerCase();
      const platform = `${deviceInfo.platform || appBase.platform || ""}`.toLowerCase();
      const isDevtools =
        appName.includes("devtools") ||
        host.includes("devtools") ||
        platform.includes("devtools") ||
        platform.includes("tools") ||
        platform.includes("desktop") ||
        platform === "windows" ||
        platform === "mac";
      const allow = isDevtools;
      console.log("[uom2] allowHttpMarker", { allow, appName, host, platform });
      return allow;
    },

    persistMarkerFile(tempPath, entry) {
      return new Promise((resolve) => {
        const api = this._miniApi || getMiniApi();
        if (!tempPath) {
          resolve("");
          return;
        }
        if (!entry || !entry.id) {
          resolve(tempPath);
          return;
        }
        const finalize = (path) => resolve(path || tempPath);
        this.saveTempFileForMarker(tempPath)
          .then((saved) => {
            if (saved) {
              const normalized = this.normalizeMiniFilePath(saved);
              entry.localSrc = normalized;
              console.log("[uom2] marker saved", { saved: `${saved}`, normalized });
              finalize(normalized);
              return;
            }
            this.copyMarkerFile(tempPath, entry)
              .then((path) => finalize(path))
              .catch(() => finalize(tempPath));
          })
          .catch(() => {
            this.copyMarkerFile(tempPath, entry)
              .then((path) => finalize(path))
              .catch(() => finalize(tempPath));
          });
      });
    },

    saveTempFileForMarker(tempPath) {
      return new Promise((resolve, reject) => {
        const api = this._miniApi || getMiniApi();
        const fs = api && typeof api.getFileSystemManager === "function"
          ? api.getFileSystemManager()
          : null;
        if (!tempPath) {
          reject(new Error("missing-temp-path"));
          return;
        }
        if (api && typeof api.saveFile === "function") {
          api.saveFile({
            tempFilePath: tempPath,
            success: (res) => resolve(res?.savedFilePath || ""),
            fail: (err) => reject(err || new Error("save-file-failed"))
          });
          return;
        }
        if (fs && typeof fs.saveFile === "function") {
          fs.saveFile({
            tempFilePath: tempPath,
            success: (res) => resolve(res?.savedFilePath || ""),
            fail: (err) => reject(err || new Error("save-file-failed"))
          });
          return;
        }
        reject(new Error("save-file-unavailable"));
      });
    },

    copyMarkerFile(tempPath, entry) {
      return new Promise((resolve, reject) => {
        const api = this._miniApi || getMiniApi();
        const userPath = api?.env?.USER_DATA_PATH;
        const fs = api && typeof api.getFileSystemManager === "function"
          ? api.getFileSystemManager()
          : null;
        if (!tempPath) {
          reject(new Error("missing-temp-path"));
          return;
        }
        if (!userPath || !fs || typeof fs.copyFile !== "function" || typeof fs.mkdir !== "function") {
          reject(new Error("fs-unavailable"));
          return;
        }
        const safeId = `${entry?.id || ""}`.replace(/[^a-zA-Z0-9_-]/g, "_") || `${Date.now()}`;
        const dir = `${userPath}/uom2_tiles`;
        const dest = `${dir}/${safeId}.png`;
        try {
          fs.mkdir({
            dirPath: dir,
            recursive: true,
            success: () => {
              fs.copyFile({
                srcPath: tempPath,
                destPath: dest,
                success: () => {
                  const normalized = this.normalizeMiniFilePath(dest);
                  if (entry) entry.localSrc = normalized;
                  console.log("[uom2] marker copied", { dest: `${dest}`, normalized });
                  resolve(normalized);
                },
                fail: (err) => reject(err || new Error("copy-file-failed"))
              });
            },
            fail: (err) => reject(err || new Error("mkdir-failed"))
          });
        } catch (err) {
          reject(err);
        }
      });
    },

    normalizeMiniFilePath(path) {
      if (!path) return "";
      return `${path}`;
    },

    requestRender() {
      if (this._renderTimer) return;
      this._renderTimer = setTimeout(() => {
        this._renderTimer = null;
        this.applyRenderTiles();
      }, 0);
    },

    applyRenderTiles() {
      if (this._destroyed) return;
      const session = this._tileSession;
      if (!session) {
        this._lastRenderedZoom = null;
        this._lastRenderedTileKey = "";
        this.clearTiles();
        this.emitTileMarkers([]);
        return;
      }
      const tiles = Array.isArray(this._currentTiles) ? this._currentTiles : [];
      if (!tiles.length) {
        this._lastRenderedZoom = null;
        this._lastRenderedTileKey = "";
        this.clearTiles();
        this.emitTileMarkers([]);
        return;
      }
      const viewport = this._viewport;
      if (!viewport) return;
      const zoom = session.zoom;
      const regionCenter = this._isMoving ? null : resolveRegionCenter(this._region);
      const center = this.resolveCenterForTiles(regionCenter || this._center);
      if (!center) return;
      const centerWorld = lonLatToWorldPixel(center.longitude, center.latitude, zoom, WEB_TILE_SIZE);
      const renders = [];
      tiles.forEach((tile) => {
        const entry = session.tiles.get(tile.id);
        if (!entry || entry.status !== "ready" || !entry.src) return;
        const render = this.buildTileRender(tile, centerWorld, viewport, this._region, this._isMoving);
        if (!render) return;
        render.src = entry.src || tile.src;
        renders.push(render);
      });
      const sessionSettled = tiles.every((tile) => {
        const entry = session.tiles.get(tile.id);
        return !!entry && (entry.status === "ready" || entry.status === "error");
      });
      const isZoomTransition =
        Number.isFinite(this._lastRenderedZoom) &&
        this._lastRenderedZoom !== session.zoom;
      const hasPreviousDisplay =
        Number.isFinite(this._lastRenderedZoom) ||
        (this.data.tiles && this.data.tiles.length > 0);
      if (isZoomTransition && !sessionSettled && hasPreviousDisplay) {
        return;
      }
      if (this._renderMode === "marker") {
        const markers = this.buildTileMarkers(renders);
        const forceCommitEmpty = !!(isZoomTransition && sessionSettled && !markers.length);
        this.emitTileMarkers(markers, { force: forceCommitEmpty });
        if (markers.length || forceCommitEmpty) {
          this._retainMarkersOnZoom = false;
        }
        this.setData({ tiles: [] });
        this._lastRenderedZoom = session.zoom;
        this._lastRenderedTileKey = this._currentTileKey || "";
        return;
      }
      this.emitTileMarkers([]);
      this.setData({ tiles: renders });
      this._lastRenderedZoom = session.zoom;
      this._lastRenderedTileKey = this._currentTileKey || "";
    },

    buildTileRender(tile, centerWorld, viewport, region, moving) {
      if (!tile || !tile.id) return null;
      const tileSize = WEB_TILE_SIZE;
      let left = 0;
      let top = 0;
      let width = tileSize;
      let height = tileSize;
      if (!moving && region && region.northeast && region.southwest && tile.bounds) {
        const sw = region.southwest;
        const ne = region.northeast;
        const tileSW = tile.bounds.southwest;
        const tileNE = tile.bounds.northeast;
        if (sw && ne && tileSW && tileNE) {
          const mSW = lonLatToMercator(sw.longitude, sw.latitude);
          const mNE = lonLatToMercator(ne.longitude, ne.latitude);
          const mTileSW = lonLatToMercator(tileSW.longitude, tileSW.latitude);
          const mTileNE = lonLatToMercator(tileNE.longitude, tileNE.latitude);
          const spanX = mNE.x - mSW.x;
          const spanY = mNE.y - mSW.y;
          if (spanX !== 0 && spanY !== 0) {
            left = Math.round(((mTileSW.x - mSW.x) / spanX) * viewport.width);
            const right = Math.round(((mTileNE.x - mSW.x) / spanX) * viewport.width);
            top = Math.round(((mNE.y - mTileNE.y) / spanY) * viewport.height);
            const bottom = Math.round(((mNE.y - mTileSW.y) / spanY) * viewport.height);
            width = right - left;
            height = bottom - top;
          }
        }
      } else if (centerWorld) {
        const parts = tile.id.split("-");
        if (parts.length >= 3) {
          const x = Number(parts[1]);
          const y = Number(parts[2]);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            left = Math.round(x * tileSize - centerWorld.x + viewport.width / 2);
            top = Math.round(y * tileSize - centerWorld.y + viewport.height / 2);
          }
        }
      }
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
      }
      const alpha =
        tile.alpha != null ? tile.alpha : (tile.opacity != null ? tile.opacity : TILE_ALPHA_DEFAULT);
      const bounds = tile.bounds || {};
      const sw = bounds.southwest || {};
      const ne = bounds.northeast || {};
      const centerLat = Number.isFinite(sw.latitude) && Number.isFinite(ne.latitude)
        ? (sw.latitude + ne.latitude) / 2
        : null;
      const centerLng = Number.isFinite(sw.longitude) && Number.isFinite(ne.longitude)
        ? (sw.longitude + ne.longitude) / 2
        : null;
      return {
        id: tile.id,
        src: tile.src,
        left,
        top,
        size: tileSize,
        width,
        height,
        alpha,
        centerLat,
        centerLng
      };
    },

    buildTileMarkers(tiles = []) {
      if (!Array.isArray(tiles) || !tiles.length) return [];
      const markerSize = this.resolveMarkerTileSize();
      const markers = [];
      tiles.forEach((tile) => {
        if (!tile || !tile.src) return;
        const iconPath = this.normalizeMiniFilePath(tile.src);
        if (!isLocalPath(iconPath) && !this._allowHttpMarker) return;
        if (!Number.isFinite(tile.centerLat) || !Number.isFinite(tile.centerLng)) return;
        const width = markerSize;
        const height = markerSize;
        markers.push({
          id: `uom2-${tile.id}`,
          latitude: tile.centerLat,
          longitude: tile.centerLng,
          iconPath,
          width,
          height,
          anchor: { x: 0.5, y: 0.5 },
          zIndex: 1,
          alpha: tile.alpha != null ? tile.alpha : TILE_ALPHA_DEFAULT,
          extData: { source: "uom2-tile" }
        });
      });
      return markers;
    },

    resolveMarkerTileSize() {
      const scale = Number(this._scale);
      const zoom = Number(this._tileSession?.zoom);
      if (!Number.isFinite(scale) || !Number.isFinite(zoom)) {
        return WEB_TILE_SIZE;
      }
      const delta = scale - zoom;
      if (!Number.isFinite(delta) || Math.abs(delta) < 0.001) {
        return WEB_TILE_SIZE;
      }
      const factor = Math.pow(2, delta);
      if (!Number.isFinite(factor) || factor <= 0) {
        return WEB_TILE_SIZE;
      }
      const size = WEB_TILE_SIZE * factor;
      const bounded = Math.max(64, Math.min(512, size));
      return Math.max(1, Math.round(bounded));
    },

    isFractionalScale() {
      const scale = Number(this._scale);
      if (!Number.isFinite(scale)) return false;
      return Math.abs(scale - Math.round(scale)) > 0.001;
    },

    emitTileMarkers(markers = [], options = {}) {
      const nextMarkers = Array.isArray(markers) ? markers : [];
      const force = options && options.force === true;
      if (
        this._renderMode === "marker" &&
        this._retainMarkersOnZoom &&
        !force &&
        !nextMarkers.length
      ) {
        return;
      }
      this._committedMarkers = nextMarkers;
      this.triggerEvent("tileschanged", { markers: nextMarkers });
    },

    scheduleStatusEvaluation(delayOverride) {
      if (this._destroyed) return;
      if (this._statusTimer) {
        clearTimeout(this._statusTimer);
        this._statusTimer = null;
      }
      const delay = Number.isFinite(delayOverride) ? delayOverride : STATUS_EVAL_DELAY_MS;
      this._statusTimer = setTimeout(() => {
        this._statusTimer = null;
        this.updateStatusPanel();
      }, delay);
    },

    emitStatus(extra = {}) {
      if (this._destroyed) return;
      const payload = Object.assign(
        {
          uomStatus: this.data.uomStatus,
          uomTone: this.data.uomTone,
          uomLoading: this.data.uomLoading,
          uomTileWarningVisible: this.data.uomTileWarningVisible,
          uomTileWarningDismissed: this.data.uomTileWarningDismissed
        },
        extra
      );
      if (sameStatusPayload(payload, this._lastStatusPayload)) return;
      this._lastStatusPayload = payload;
      this.triggerEvent("statuschange", payload);
    },

    updateStatusPanel() {
      if (this._destroyed) return;
      const center = this.resolveCenterForTiles(resolveRegionCenter(this._region) || this._center);
      const excludedRegion = resolveExcludedRegionRecord(center);
      const uom = excludedRegion
        ? { status: NON_RESTRICTED_STATUS_TEXT, tone: "safe" }
        : this.describeUomStatus();
      const updates = {
        uomStatus: uom.status,
        uomTone: uom.tone,
        uomLoading: this.resolveUomLoadingState(),
        uomTileWarningVisible: false,
        uomTileWarningDismissed: false
      };
      this.setData(updates, () => this.emitStatus(updates));
    },

    describeUomStatus() {
      if (this._enabled === false) {
        return { status: "已禁用", tone: "warn" };
      }
      const session = this._tileSession;
      if (!session) {
        return { status: "评估中", tone: "neutral" };
      }
      const center = this.resolveCenterForTiles(resolveRegionCenter(this._region) || this._center);
      if (!center) {
        return { status: "评估中", tone: "neutral" };
      }
      const tile = this.findTileForPoint(center);
      if (!tile) {
        return { status: RESTRICTED_STATUS_TEXT, tone: "alert" };
      }
      const entry = session.tiles.get(tile.id);
      if (!entry) {
        this.ensureTileEntry(session, tile);
        this.ensureMask(tile);
        return { status: "评估中", tone: "neutral" };
      }
      if (entry.maskStatus === "idle") {
        this.ensureMask(tile);
        return { status: "评估中", tone: "neutral" };
      }
      if (entry.maskStatus === "pending") {
        return { status: "评估中", tone: "neutral" };
      }
      if (entry.maskStatus === "error") {
        return { status: "空域数据加载失败", tone: "warn" };
      }
      if (entry.maskStatus === "unsupported") {
        return { status: "当前环境不支持空域判定", tone: "warn" };
      }
      if (entry.maskStatus !== "ready" || !entry.maskData) {
        return { status: RESTRICTED_STATUS_TEXT, tone: "alert" };
      }
      const covered = this.pointCoveredByMask(center, tile.bounds, entry);
      return covered
        ? { status: SAFE_STATUS_TEXT, tone: "safe" }
        : { status: RESTRICTED_STATUS_TEXT, tone: "alert" };
    },

    findTileForPoint(point) {
      if (!point || !Array.isArray(this._currentTiles)) return null;
      for (const tile of this._currentTiles) {
        if (this.pointInBounds(point, tile.bounds)) return tile;
      }
      return null;
    },

    pointInBounds(point, bounds) {
      if (!point || !bounds) return false;
      const sw = bounds.southwest || {};
      const ne = bounds.northeast || {};
      const swLat = typeof sw.latitude === "number" ? sw.latitude : -90;
      const neLat = typeof ne.latitude === "number" ? ne.latitude : 90;
      const swLng = typeof sw.longitude === "number" ? sw.longitude : -180;
      const neLng = typeof ne.longitude === "number" ? ne.longitude : 180;
      return (
        point.latitude >= swLat &&
        point.latitude <= neLat &&
        point.longitude >= swLng &&
        point.longitude <= neLng
      );
    },

    ensureMask(tile) {
      const session = this._tileSession;
      if (!session || !tile || !tile.id) return;
      const entry = session.tiles.get(tile.id);
      if (!entry) return;
      if (entry.maskStatus === "ready" || entry.maskStatus === "pending") return;
      if (!this._offscreenSupported) {
        entry.maskStatus = "unsupported";
        this.syncUomLoadingState();
        if (!this._isMoving) {
          this.updateStatusPanel();
        }
        return;
      }
      entry.maskStatus = "pending";
      this.syncUomLoadingState();
      const sessionRef = session;
      const maskSrcPromise = this._forceHttpMarker
        ? this.downloadTileForMask(tile.src, entry)
        : this.ensureTileSrc(session, tile);
      maskSrcPromise
        .then((src) => this.decodeMaskFromSrc(src, tile.maskSize))
        .then((mask) => {
          if (this._destroyed || this._tileSession !== sessionRef) return;
          if (!sessionRef.tiles.has(tile.id)) return;
          if (!mask) {
            entry.maskStatus = "error";
            this.syncUomLoadingState();
            this.updateStatusPanel();
            return;
          }
          entry.maskStatus = "ready";
          entry.maskData = mask.data;
          entry.maskWidth = mask.width;
          entry.maskHeight = mask.height;
          this.syncUomLoadingState();
          if (!this._isMoving) {
            this.updateStatusPanel();
          }
        })
        .catch(() => {
          if (this._destroyed || this._tileSession !== sessionRef) return;
          if (!sessionRef.tiles.has(tile.id)) return;
          entry.maskStatus = "error";
          this.syncUomLoadingState();
          this.updateStatusPanel();
        });
    },

    decodeMaskFromSrc(src, sizeHint) {
      if (!src || !this._offscreenSupported) return Promise.resolve(null);
      const sampleSize = Number(sizeHint) || TILE_SAMPLE_SIZE;
      const size = Math.min(256, Math.max(16, Math.round(sampleSize)));
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value || null);
        };
        let timer = null;
        try {
          const api = this._miniApi || getMiniApi();
          if (!api || typeof api.createOffscreenCanvas !== "function") {
            finish(null);
            return;
          }
          const canvas = api.createOffscreenCanvas({ type: "2d", width: size, height: size });
          const ctx = canvas.getContext("2d");
          const img = canvas.createImage();
          if (TILE_LOAD_TIMEOUT_MS > 0) {
            timer = setTimeout(() => finish(null), TILE_LOAD_TIMEOUT_MS);
          }
          img.onload = () => {
            try {
              if (timer) clearTimeout(timer);
              canvas.width = size;
              canvas.height = size;
              ctx.clearRect(0, 0, size, size);
              ctx.drawImage(img, 0, 0, size, size);
              const imageData = ctx.getImageData(0, 0, size, size);
              finish({ data: imageData.data, width: imageData.width, height: imageData.height });
            } catch (err) {
              finish(null);
            }
          };
          img.onerror = () => {
            if (timer) clearTimeout(timer);
            finish(null);
          };
          img.src = src;
        } catch (err) {
          if (timer) clearTimeout(timer);
          finish(null);
        }
      });
    },

    pointCoveredByMask(point, bounds, entry) {
      if (!point || !bounds || !entry || entry.maskStatus !== "ready" || !entry.maskData) return false;
      const sw = bounds.southwest || {};
      const ne = bounds.northeast || {};
      const lngSpan = (ne.longitude ?? sw.longitude) - (sw.longitude ?? 0);
      const latSpan = (ne.latitude ?? sw.latitude) - (sw.latitude ?? 0);
      if (!lngSpan || !latSpan) return false;
      const u = (point.longitude - sw.longitude) / lngSpan;
      const v = (ne.latitude - point.latitude) / latSpan;
      if (u < 0 || u > 1 || v < 0 || v > 1) return false;
      const width = entry.maskWidth || 256;
      const height = entry.maskHeight || 256;
      const marginPx = 1;
      const marginU = marginPx / Math.max(1, width - 1);
      const marginV = marginPx / Math.max(1, height - 1);
      if (u <= marginU || u >= 1 - marginU || v <= marginV || v >= 1 - marginV) {
        return false;
      }
      const px = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))));
      const py = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))));
      let hits = 0;
      let samples = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const sy = py + dy;
        if (sy < 0 || sy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const sx = px + dx;
          if (sx < 0 || sx >= width) continue;
          const idx = (sy * width + sx) * 4 + 3;
          const alpha = entry.maskData[idx];
          samples += 1;
          if (alpha > MASK_ALPHA_THRESHOLD) hits += 1;
        }
      }
      if (!samples) return false;
      return hits / samples >= 0.56;
    },

    ensureViewport(callback) {
      if (this._destroyed) return;
      if (this._viewport && this._viewport.width && this._viewport.height) {
        if (typeof callback === "function") callback();
        return;
      }
      const api = this._miniApi || getMiniApi();
      if (!api || typeof api.createSelectorQuery !== "function") {
        this._viewport = { width: 375, height: 667 };
        if (typeof callback === "function") callback();
        return;
      }
      const query = api.createSelectorQuery().in(this);
      query.select(".uom2-root").boundingClientRect((rect) => {
        const width = Number(rect?.width);
        const height = Number(rect?.height);
        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
          this._viewport = { width, height };
        } else if (api && typeof api.getWindowInfo === "function") {
          try {
            const info = api.getWindowInfo() || {};
            this._viewport = {
              width: Number(info.windowWidth) || 375,
              height: Number(info.windowHeight) || 667
            };
          } catch (err) {
            this._viewport = { width: 375, height: 667 };
          }
        } else {
          this._viewport = { width: 375, height: 667 };
        }
        if (typeof callback === "function") callback();
      }).exec();
    }
  }
});
