const { buildWmsOverlay, WMS_MIN_ZOOM, WMS_MAX_ZOOM } = require("../../../../utils/wms");
const { isWeChatRuntime } = require("../../../../utils/runtime");
const { gcj02ToWgs84, wgs84ToGcj02, lonLatToMercator } = require("../../../../utils/coords");

const MAP_MIN_SCALE = 0;
const MAP_MAX_SCALE = 18;
const DEFAULT_MAP_SCALE = 11;
const WEB_TILE_SIZE = 256;
const VIEWPORT_PADDING_PX = 120;
const TILE_MAX_TILES = 36;
const TILE_ALPHA_DEFAULT = 0.65;
const TILE_CACHE_LIMIT = 80;
const TILE_SAMPLE_SIZE = 64;
const TILE_LOAD_TIMEOUT_MS = 8000;
const REFRESH_DEBOUNCE_MS = 120;
const FOLLOW_INTERVAL_MS = 60;

const isHttpUrl = (value) => /^https?:\/\//.test(value || "");

const clampMapScale = (value) => {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : DEFAULT_MAP_SCALE;
  const rounded = Math.round(base);
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, rounded));
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

const parseTileId = (tileId) => {
  if (typeof tileId !== "string") return null;
  const parts = tileId.split("-");
  if (parts.length < 3) return null;
  const zoom = Number(parts[0]);
  const x = Number(parts[1]);
  const y = Number(parts[2]);
  if (!Number.isFinite(zoom) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    zoom: Math.round(zoom),
    x: Math.round(x),
    y: Math.round(y)
  };
};

Component({
  options: { virtualHost: true },
  data: {
    tiles: []
  },
  lifetimes: {
    created() {
      this._tileCache = new Map();
      this._refreshTimer = null;
      this._renderEpoch = 0;
      this._destroyed = false;
      this._runtimeIsWeChat = null;
      this._viewport = null;
      this._center = null;
      this._scale = null;
      this._region = null;
      this._enabled = true;
      this._followTimer = null;
      this._coordType = "gcj02";
      this._centerCoordType = "gcj02";
      this._coordDetectTried = false;
      this._renderMode = "marker";
      this._offscreenSupported =
        typeof wx !== "undefined" && typeof wx.createOffscreenCanvas === "function";
    },
    ready() {
      this._runtimeIsWeChat = isWeChatRuntime();
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
      }
      if (region) {
        this._region = region;
      }
      if (typeof enabled === "boolean") {
        this._enabled = enabled;
      }
      if (coordType) {
        this._coordType = `${coordType}`.toLowerCase();
      }
      if (centerCoordType) {
        this._centerCoordType = `${centerCoordType}`.toLowerCase();
      }
      if (this._runtimeIsWeChat === null) {
        this._runtimeIsWeChat = isWeChatRuntime();
      }
      if (this._runtimeIsWeChat) {
        this.clearTiles();
        return;
      }
      this.ensureViewport(() => this.refreshTiles());
    },

    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      if (this._refreshTimer) {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
      }
      this.stopFollow();
      this._tileCache.clear();
      this.mapCtx = null;
    },

    setEnabled(enabled) {
      const next = enabled !== false;
      if (this._enabled === next) return;
      this._enabled = next;
      if (!next) {
        this.clearTiles();
        return;
      }
      this.scheduleRefresh(true);
    },

    handleRegionChange(options = {}) {
      if (this._destroyed) return;
      const { center, centerPin, scale, region, force, coordType, centerCoordType } = options;
      if (center || centerPin) {
        this._center = center || centerPin;
      }
      if (Number.isFinite(scale)) {
        this._scale = scale;
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
        return;
      }
      if (this._refreshTimer) {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
      }
      const delay = force ? 0 : REFRESH_DEBOUNCE_MS;
      this._refreshTimer = setTimeout(() => {
        this._refreshTimer = null;
        this.refreshTiles();
      }, delay);
    },

    scheduleFinalRefresh() {
      this.scheduleRefresh(true);
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
      const requestCenter = (type) => {
        this.mapCtx.getCenterLocation({
          type,
          success: (res) => {
            if (this._destroyed) return;
            const rawCenter = { latitude: res.latitude, longitude: res.longitude };
            if (type === "wgs84") {
              const gcj = wgs84ToGcj02(rawCenter.longitude, rawCenter.latitude);
              this._center = { latitude: gcj.lat, longitude: gcj.lng };
              this._centerCoordType = "gcj02";
              this._coordType = "gcj02";
            } else {
              this._center = rawCenter;
              this._centerCoordType = "gcj02";
              this._coordType = "gcj02";
            }
            this.refreshTiles();
          },
          fail: () => {
            if (type !== "wgs84") {
              requestCenter("wgs84");
            }
          }
        });
      };
      const tick = () => {
        if (this._destroyed || this._runtimeIsWeChat) {
          this.stopFollow();
          return;
        }
        if (!this.mapCtx || typeof this.mapCtx.getCenterLocation !== "function") {
          this.stopFollow();
          return;
        }
        if (typeof this.mapCtx.getRegion === "function") {
          this.mapCtx.getRegion({
            success: (res) => {
              const region = res?.region || res;
              if (region && region.northeast && region.southwest) {
                this._region = region;
                this._center = {
                  latitude: (region.northeast.latitude + region.southwest.latitude) / 2,
                  longitude: (region.northeast.longitude + region.southwest.longitude) / 2
                };
              }
              this.refreshTiles();
            },
            fail: () => requestCenter("gcj02")
          });
        } else {
          requestCenter("gcj02");
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
      this.refreshTiles();
    },

    refreshTiles() {
      if (this._destroyed) return;
      if (this._runtimeIsWeChat || !this._enabled) {
        this.clearTiles();
        return;
      }
      const center =
        this._region && this._region.northeast && this._region.southwest
          ? {
            latitude: (this._region.northeast.latitude + this._region.southwest.latitude) / 2,
            longitude: (this._region.northeast.longitude + this._region.southwest.longitude) / 2
          }
          : this.resolveCenterForTiles(this._center);
      if (!center || !Number.isFinite(center.longitude) || !Number.isFinite(center.latitude)) {
        this.clearTiles();
        return;
      }
      if (!this._viewport) {
        this.ensureViewport(() => this.refreshTiles());
        return;
      }
      const scale = clampMapScale(this._scale);
      if (!Number.isFinite(scale) || scale < WMS_MIN_ZOOM || scale > WMS_MAX_ZOOM) {
        this.clearTiles();
        return;
      }
      const viewport = this._viewport;
      let tiles = buildWmsOverlay(center, scale, this._region, {
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        viewportPaddingPx: VIEWPORT_PADDING_PX,
        tileSize: WEB_TILE_SIZE,
        maskSize: TILE_SAMPLE_SIZE,
        coordType: this._coordType || "gcj02"
      });
      if (!Array.isArray(tiles)) tiles = [];
      if (tiles.length > TILE_MAX_TILES) {
        tiles = tiles.slice(0, TILE_MAX_TILES);
      }
      const epoch = this.bumpRenderEpoch();
      const centerWorld = lonLatToWorldPixel(center.longitude, center.latitude, scale, WEB_TILE_SIZE);
      Promise.all(
        tiles.map((tile) => this.buildTileRender(tile, centerWorld, viewport, epoch, this._region))
      ).then((renders) => {
        if (this._destroyed || this._renderEpoch !== epoch) return;
        const nextTiles = renders.filter(Boolean);
        if (this._renderMode === "marker") {
          const markers = this.buildTileMarkers(nextTiles);
          this.emitTileMarkers(markers);
          this.setData({ tiles: [] });
          return;
        }
        this.setData({ tiles: nextTiles });
      });
    },

    clearTiles() {
      if (this.data.tiles && this.data.tiles.length) {
        this.setData({ tiles: [] });
      }
    },

    bumpRenderEpoch() {
      this._renderEpoch = Number.isFinite(this._renderEpoch) ? this._renderEpoch + 1 : 1;
      return this._renderEpoch;
    },

    ensureViewport(callback) {
      if (this._destroyed) return;
      if (this._viewport && this._viewport.width && this._viewport.height) {
        if (typeof callback === "function") callback();
        return;
      }
      if (typeof wx === "undefined" || typeof wx.createSelectorQuery !== "function") {
        this._viewport = { width: 375, height: 667 };
        if (typeof callback === "function") callback();
        return;
      }
      const query = wx.createSelectorQuery().in(this);
      query.select(".uom2-root").boundingClientRect((rect) => {
        const width = Number(rect?.width);
        const height = Number(rect?.height);
        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
          this._viewport = { width, height };
        } else if (typeof wx.getWindowInfo === "function") {
          try {
            const info = wx.getWindowInfo() || {};
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
    },

    async buildTileRender(tile, centerWorld, viewport, epoch, region) {
      if (!tile || !tile.id) return null;
      const tileSize = WEB_TILE_SIZE;
      let left = 0;
      let top = 0;
      let width = tileSize;
      let height = tileSize;
      if (region && region.northeast && region.southwest && tile.bounds) {
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
      } else {
        const parsed = parseTileId(tile.id);
        if (!parsed) return null;
        left = Math.round(parsed.x * tileSize - centerWorld.x + viewport.width / 2);
        top = Math.round(parsed.y * tileSize - centerWorld.y + viewport.height / 2);
        width = tileSize;
        height = tileSize;
      }
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return null;
      }
      const entry = await this.resolveTileEntry(tile);
      if (this._destroyed || this._renderEpoch !== epoch) return null;
      if (!entry || entry.transparent) return null;
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
        src: entry.src || tile.src,
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
      const markers = [];
      tiles.forEach((tile) => {
        if (!tile || !tile.src) return;
        if (isHttpUrl(tile.src)) return;
        if (!Number.isFinite(tile.centerLat) || !Number.isFinite(tile.centerLng)) return;
        const width = Math.max(1, Math.round(tile.width || tile.size || WEB_TILE_SIZE));
        const height = Math.max(1, Math.round(tile.height || tile.size || WEB_TILE_SIZE));
        markers.push({
          id: `uom2-${tile.id}`,
          latitude: tile.centerLat,
          longitude: tile.centerLng,
          iconPath: tile.src,
          width,
          height,
          anchor: { x: 0.5, y: 0.5 },
          zIndex: 1,
          extData: { source: "uom2-tile" }
        });
      });
      return markers;
    },

    emitTileMarkers(markers = []) {
      this.triggerEvent("tileschanged", { markers });
    },

    async resolveTileEntry(tile) {
      if (!tile || !tile.id) return null;
      const cached = this._tileCache.get(tile.id);
      if (cached && cached.status === "ready") {
        this.touchTileCacheEntry(tile.id);
        return cached;
      }
      if (cached && cached.status === "pending" && cached.promise) {
        return cached.promise;
      }
      const promise = this.loadTileEntry(tile);
      this._tileCache.set(tile.id, { status: "pending", promise, lastUsed: Date.now() });
      return promise;
    },

    async loadTileEntry(tile) {
      const src = await this.downloadTile(tile.src);
      const transparent = await this.checkTileTransparency(src, tile.maskSize);
      const entry = {
        status: "ready",
        src,
        transparent,
        lastUsed: Date.now()
      };
      this._tileCache.set(tile.id, entry);
      this.enforceTileCacheLimit();
      return entry;
    },

    downloadTile(src) {
      if (!src || !isHttpUrl(src) || typeof wx === "undefined" || typeof wx.downloadFile !== "function") {
        return Promise.resolve(src || "");
      }
      return new Promise((resolve) => {
        const task = wx.downloadFile({
          url: src,
          success: (res) => {
            const statusCode = Number(res?.statusCode);
            const filePath = res?.tempFilePath;
            if (statusCode === 200 && filePath) {
              resolve(filePath);
              return;
            }
            resolve(src);
          },
          fail: () => resolve(src)
        });
        if (task && typeof task.onHeadersReceived === "function") {
          // no-op, kept for future debug
        }
      });
    },

    checkTileTransparency(src, sizeHint) {
      if (!src || !this._offscreenSupported) return Promise.resolve(false);
      const sampleSize = Number(sizeHint) || TILE_SAMPLE_SIZE;
      const size = Math.min(256, Math.max(16, Math.round(sampleSize)));
      return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(!!value);
        };
        let timer = null;
        try {
          const canvas = wx.createOffscreenCanvas({ type: "2d", width: size, height: size });
          const ctx = canvas.getContext("2d");
          const img = canvas.createImage();
          if (TILE_LOAD_TIMEOUT_MS > 0) {
            timer = setTimeout(() => finish(false), TILE_LOAD_TIMEOUT_MS);
          }
          img.onload = () => {
            try {
              if (timer) clearTimeout(timer);
              canvas.width = size;
              canvas.height = size;
              ctx.clearRect(0, 0, size, size);
              ctx.drawImage(img, 0, 0, size, size);
              const imageData = ctx.getImageData(0, 0, size, size);
              const data = imageData?.data || [];
              for (let i = 3; i < data.length; i += 4) {
                if (data[i] > 0) {
                  finish(false);
                  return;
                }
              }
              finish(true);
            } catch (err) {
              finish(false);
            }
          };
          img.onerror = () => {
            if (timer) clearTimeout(timer);
            finish(false);
          };
          img.src = src;
        } catch (err) {
          if (timer) clearTimeout(timer);
          finish(false);
        }
      });
    },

    touchTileCacheEntry(tileId) {
      if (!tileId || !this._tileCache) return;
      const entry = this._tileCache.get(tileId);
      if (!entry) return;
      this._tileCache.delete(tileId);
      entry.lastUsed = Date.now();
      this._tileCache.set(tileId, entry);
    },

    enforceTileCacheLimit() {
      if (!this._tileCache || this._tileCache.size <= TILE_CACHE_LIMIT) return;
      const max = TILE_CACHE_LIMIT;
      while (this._tileCache.size > max) {
        const firstKey = this._tileCache.keys().next().value;
        if (!firstKey) break;
        this._tileCache.delete(firstKey);
      }
    }
  }
});
