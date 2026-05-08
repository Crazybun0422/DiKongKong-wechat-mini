const {
  buildTiandituSatelliteOverlays,
  clampTiandituZoom
} = require("../../../../utils/tianditu");

const OVERLAY_ID_BASE = 810000000;
const TIANDITU_OVERLAY_Z_INDEX = 0;
const OVERLAY_REMOVE_RETRY_MS = 120;
const TILE_LOAD_TIMEOUT_MS = 8000;
const TILE_RESOURCE_CACHE_LIMIT = 72;
const FINAL_REFRESH_DELAY_MS = 150;

const isHttpUrl = (value) => /^https?:\/\//.test(value || "");
const buildTileListKey = (tiles = []) =>
  (Array.isArray(tiles) ? tiles : [])
    .map((tile) => `${tile?.id || ""}@${tile?.src || ""}`)
    .sort()
    .join("|");

Component({
  options: { virtualHost: true },
  data: {
    enabled: false,
    center: null,
    scale: null
  },
  lifetimes: {
    detached() {
      this.destroy();
    }
  },
  methods: {
    init(options = {}) {
      const { mapCtx, center, scale, region, enabled } = options;
      this.mapCtx = mapCtx || this.mapCtx || null;
      this._center = center || this.data.center || null;
      this._lastRegion = region || null;
      this._overlayMap = new Map();
      this._overlaySeed = 0;
      this._removals = new Set();
      this._removalQueue = [];
      this._removalQueued = new Set();
      this._removing = false;
      this._pendingBatch = null;
      this._batchSeq = 0;
      this._tileResourceCache = new Map();
      this._currentTileKey = "";
      this._currentTileKeyApplied = "";
      this._overlayZoom = null;
      this._destroyed = false;
      this._finalRefreshTimer = null;
      this._removalTimer = null;

      const updates = {};
      if (center) {
        updates.center = center;
        this.data.center = center;
      }
      if (Number.isFinite(scale)) {
        updates.scale = scale;
        this.data.scale = scale;
      }
      if (typeof enabled === "boolean") {
        updates.enabled = enabled;
        this.data.enabled = enabled;
      }
      if (Object.keys(updates).length) {
        this.setData(updates);
      }
      if (this.mapCtx && this.data.enabled !== false) {
        this.refreshOverlay(center, scale, region);
        this.scheduleFinalRefresh();
      }
    },

    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      if (this._finalRefreshTimer) clearTimeout(this._finalRefreshTimer);
      if (this._removalTimer) clearTimeout(this._removalTimer);
      this.cancelPendingBatch();
      if (this._tileResourceCache) {
        for (const entry of this._tileResourceCache.values()) {
          this.clearTileResourceEntry(entry, { abort: true });
        }
        this._tileResourceCache.clear();
      }
      this.clearMapOverlays();
      this.mapCtx = null;
    },

    setEnabled(enabled, options = {}) {
      const next = enabled === true;
      if (this.data.enabled === next && options.force !== true) return;
      this.data.enabled = next;
      this.setData({ enabled: next });
      if (!next) {
        this.clearMapOverlays();
        return;
      }
      this.refreshOverlay(options.center || this._center, options.scale || this.data.scale, options.region || this._lastRegion);
      this.scheduleFinalRefresh();
    },

    updateViewport(options = {}) {
      if (this._destroyed) return;
      const { center, scale, region, force } = options;
      if (center) {
        this._center = center;
        this.data.center = center;
      }
      if (Number.isFinite(scale)) {
        this.data.scale = scale;
      }
      if (region && region.northeast && region.southwest) {
        this._lastRegion = region;
      }
      const updates = {};
      if (center) updates.center = center;
      if (Number.isFinite(scale)) updates.scale = scale;
      if (Object.keys(updates).length) {
        this.setData(updates);
      }
      if (!this.mapCtx || this.data.enabled === false) return;
      if (force || center || Number.isFinite(scale)) {
        this.refreshOverlay(center || this._center, scale, region || this._lastRegion);
      }
    },

    scheduleFinalRefresh() {
      if (!this.mapCtx || this.data.enabled === false) return;
      if (this._finalRefreshTimer) clearTimeout(this._finalRefreshTimer);
      this._finalRefreshTimer = setTimeout(() => {
        this._finalRefreshTimer = null;
        if (!this.mapCtx || this.data.enabled === false) return;
        const fallbackCenter = this._center || this.data.center;
        const scale = clampTiandituZoom(this.data.scale);
        const apply = (center, region) => {
          if (!center) return;
          if (region && region.northeast && region.southwest) {
            this._lastRegion = region;
          }
          this.refreshOverlay(center, scale, region || this._lastRegion);
        };
        if (typeof this.mapCtx.getCenterLocation === "function") {
          this.mapCtx.getCenterLocation({
            type: "gcj02",
            success: (res) => {
              const center = { latitude: res.latitude, longitude: res.longitude };
              this._center = center;
              if (typeof this.mapCtx.getRegion === "function") {
                this.mapCtx.getRegion({
                  success: (regionRes) => apply(center, regionRes?.region || regionRes),
                  fail: () => apply(center, null)
                });
              } else {
                apply(center, null);
              }
            },
            fail: () => apply(fallbackCenter, null)
          });
          return;
        }
        apply(fallbackCenter, null);
      }, FINAL_REFRESH_DELAY_MS);
    },

    refreshOverlay(centerOverride, scaleOverride, regionOverride) {
      if (this.data.enabled === false) {
        this.clearMapOverlays();
        return;
      }
      const center = centerOverride || this._center || this.data.center;
      const scale = clampTiandituZoom(scaleOverride || this.data.scale);
      if (!center || !Number.isFinite(Number(center.latitude)) || !Number.isFinite(Number(center.longitude))) {
        return;
      }
      const viewport = this.getMapViewportSize();
      const overlays = buildTiandituSatelliteOverlays(center, scale, regionOverride || this._lastRegion || null, {
        viewportWidth: viewport.width,
        viewportHeight: viewport.height
      });
      const overlayKey = buildTileListKey(overlays);
      this._currentTileKey = overlayKey;
      this.pruneTileResourceCache(new Set(overlays.map((tile) => `${tile?.src || ""}`.trim()).filter(Boolean)));
      if (this._overlayZoom !== null && this._overlayZoom !== scale) {
        this.clearMapOverlays();
      }
      if (overlayKey !== this._currentTileKeyApplied) {
        this.applyOverlays(overlays, { overlayKey });
      }
      this._overlayZoom = scale;
    },

    getMapViewportSize() {
      let width = 375;
      let height = 667;
      try {
        if (typeof wx !== "undefined" && typeof wx.getWindowInfo === "function") {
          const info = wx.getWindowInfo() || {};
          width = info.windowWidth || info.screenWidth || width;
          height = info.windowHeight || info.screenHeight || height;
        }
      } catch (err) {
        console.warn("get Tianditu viewport size failed", err);
      }
      return { width, height };
    },

    applyOverlays(tiles, options = {}) {
      if (!this.mapCtx || this.data.enabled === false) return;
      this.processRemovalQueue();
      this.cancelPendingBatch();
      const currentHandles = this._overlayMap || new Map();
      const nextHandles = new Map();
      const obsoleteHandles = new Map(currentHandles);
      const additions = [];
      const batchId = `${Date.now()}-${this._batchSeq++}`;
      let pendingCount = 0;
      let committed = false;
      const overlayKey = options.overlayKey || buildTileListKey(tiles);
      const commitBatch = () => {
        if (committed) return;
        committed = true;
        if (!this._pendingBatch || this._pendingBatch.id !== batchId) return;
        this._pendingBatch = null;
        for (const [, handle] of obsoleteHandles.entries()) {
          if (handle) this.queueOverlayRemoval(handle.overlayId);
        }
        this._overlayMap = nextHandles;
        this._currentTileKeyApplied = overlayKey;
        this.processRemovalQueue();
      };
      const settleTile = () => {
        pendingCount = Math.max(0, pendingCount - 1);
        if (pendingCount === 0) commitBatch();
      };
      const pendingBatch = {
        id: batchId,
        createdHandles: new Map(),
        requestedSrcs: new Set()
      };
      let debugLogged = false;
      this._pendingBatch = pendingBatch;
      (tiles || []).forEach((tile) => {
        if (!tile || !tile.id || !tile.bounds) return;
        const signature = this.tileSignature(tile);
        const existing = currentHandles.get(tile.id);
        if (existing && existing.signature === signature) {
          nextHandles.set(tile.id, existing);
          obsoleteHandles.delete(tile.id);
          return;
        }
        additions.push({ tile, signature });
      });
      const startAdditions = () => {
        if (!this._pendingBatch || this._pendingBatch.id !== batchId || this.data.enabled === false) return;
        additions.forEach(({ tile, signature, src }) => {
          this._overlaySeed += 1;
          const overlayId = OVERLAY_ID_BASE + this._overlaySeed;
          pendingCount += 1;
          const opacity = tile.opacity == null
            ? (tile.alpha == null ? 1 : tile.alpha)
            : tile.opacity;
          this.mapCtx.addGroundOverlay({
            id: overlayId,
            src: src || tile.src,
            bounds: tile.bounds,
            visible: true,
            zIndex: TIANDITU_OVERLAY_Z_INDEX,
            opacity,
            success: () => {
              if (!debugLogged) {
                debugLogged = true;
                console.log("[tianditu] addGroundOverlay success", {
                  tileId: tile.id,
                  overlayId,
                  src: src || tile.src,
                  bounds: tile.bounds
                });
              }
              if (!this._pendingBatch || this._pendingBatch.id !== batchId || this.data.enabled === false) {
                this.queueOverlayRemoval(overlayId);
                settleTile();
                return;
              }
              const handle = { overlayId, signature };
              pendingBatch.createdHandles.set(tile.id, handle);
              nextHandles.set(tile.id, handle);
              settleTile();
            },
            fail: (err) => {
              console.warn("add Tianditu ground overlay failed", {
                tileId: tile.id,
                overlayId,
                src: src || tile.src,
                bounds: tile.bounds,
                err
              });
              settleTile();
            }
          });
        });
        if (pendingCount === 0) commitBatch();
      };
      if (!additions.length) {
        commitBatch();
        return;
      }
      Promise.all(
        additions.map((item) => {
          if (item.tile?.src) pendingBatch.requestedSrcs.add(item.tile.src);
          return this.ensureTileResource(item.tile?.src, batchId)
            .then((localSrc) => {
              item.src = localSrc || item.tile?.src || "";
              return item.src;
            })
            .catch(() => {
              item.src = item.tile?.src || "";
              return item.src;
            });
        })
      ).then(startAdditions).catch(startAdditions);
    },

    tileSignature(tile) {
      const bounds = tile?.bounds || {};
      const sw = bounds.southwest || {};
      const ne = bounds.northeast || {};
      return [
        tile?.src || "",
        tile?.opacity == null ? (tile?.alpha == null ? 1 : tile.alpha) : tile.opacity,
        Number(sw.longitude).toFixed(6),
        Number(sw.latitude).toFixed(6),
        Number(ne.longitude).toFixed(6),
        Number(ne.latitude).toFixed(6)
      ].join("|");
    },

    clearMapOverlays() {
      this.cancelPendingBatch();
      this._overlayMap = this._overlayMap || new Map();
      for (const [, handle] of this._overlayMap.entries()) {
        if (handle) this.queueOverlayRemoval(handle.overlayId);
      }
      this._overlayMap.clear();
      this._currentTileKeyApplied = "";
      this._overlayZoom = null;
      this.processRemovalQueue();
    },

    queueOverlayRemoval(overlayId) {
      if (!Number.isFinite(overlayId)) return;
      if (!this._removals) this._removals = new Set();
      if (!this._removalQueue) this._removalQueue = [];
      if (!this._removalQueued) this._removalQueued = new Set();
      this._removals.add(overlayId);
      if (this._removalQueued.has(overlayId)) return;
      this._removalQueued.add(overlayId);
      this._removalQueue.push(overlayId);
      this.processRemovalQueue();
    },

    processRemovalQueue() {
      if (!this.mapCtx || this._removing) return;
      if (!this._removalQueue || !this._removalQueue.length) return;
      const overlayId = this._removalQueue.shift();
      if (this._removalQueued) this._removalQueued.delete(overlayId);
      if (!this._removals || !this._removals.has(overlayId)) {
        this.processRemovalQueue();
        return;
      }
      this._removing = true;
      this.mapCtx.removeGroundOverlay({
        id: overlayId,
        success: () => {
          this._removals.delete(overlayId);
          this._removing = false;
          this.processRemovalQueue();
        },
        fail: (err) => {
          const msg = `${err?.errMsg || ""}`.toLowerCase();
          if (msg.includes("not exist") || msg.includes("not found") || msg.includes("no overlay")) {
            this._removals.delete(overlayId);
          } else {
            this._removalQueue.push(overlayId);
            this._removalQueued.add(overlayId);
          }
          this._removing = false;
          if (this._removalTimer) clearTimeout(this._removalTimer);
          this._removalTimer = setTimeout(() => {
            this._removalTimer = null;
            this.processRemovalQueue();
          }, OVERLAY_REMOVE_RETRY_MS);
        }
      });
    },

    cancelPendingBatch() {
      const batch = this._pendingBatch;
      if (!batch) return;
      this._pendingBatch = null;
      if (batch.requestedSrcs && batch.requestedSrcs.size) {
        batch.requestedSrcs.forEach((src) => this.releaseTileResource(src, batch.id));
      }
      if (batch.createdHandles && batch.createdHandles.size) {
        for (const handle of batch.createdHandles.values()) {
          if (handle) this.queueOverlayRemoval(handle.overlayId);
        }
      }
      this.processRemovalQueue();
    },

    ensureTileResource(src, consumerId) {
      const normalized = `${src || ""}`.trim();
      if (!normalized) return Promise.resolve("");
      if (!isHttpUrl(normalized) || typeof wx === "undefined" || typeof wx.downloadFile !== "function") {
        return Promise.resolve(normalized);
      }
      if (!this._tileResourceCache) this._tileResourceCache = new Map();
      let entry = this._tileResourceCache.get(normalized);
      if (!entry) {
        entry = {
          src: normalized,
          status: "idle",
          localSrc: "",
          promise: null,
          downloadTask: null,
          downloadTimer: null,
          finalize: null,
          requestId: 0,
          consumers: new Set()
        };
        this._tileResourceCache.set(normalized, entry);
      }
      if (consumerId) entry.consumers.add(consumerId);
      if (entry.status === "ready" && entry.localSrc) {
        return Promise.resolve(entry.localSrc);
      }
      if (entry.status === "pending" && entry.promise) {
        return entry.promise;
      }
      entry.status = "pending";
      entry.requestId += 1;
      const requestId = entry.requestId;
      entry.promise = new Promise((resolve) => {
        const finalize = (value, status) => {
          if (entry.requestId !== requestId) return;
          if (entry.downloadTimer) {
            clearTimeout(entry.downloadTimer);
            entry.downloadTimer = null;
          }
          entry.downloadTask = null;
          entry.promise = null;
          entry.finalize = null;
          entry.status = status;
          entry.localSrc = status === "ready" ? (value || "") : "";
          entry.consumers.clear();
          resolve(value || "");
        };
        entry.finalize = finalize;
        entry.downloadTask = wx.downloadFile({
          url: normalized,
          success: (res) => {
            if (entry.requestId !== requestId) return;
            const statusCode = Number(res?.statusCode);
            const filePath = `${res?.tempFilePath || ""}`.trim();
            finalize(statusCode === 200 && filePath ? filePath : "", statusCode === 200 && filePath ? "ready" : "error");
          },
          fail: () => {
            if (entry.requestId !== requestId) return;
            finalize("", "error");
          }
        });
        entry.downloadTimer = setTimeout(() => {
          if (entry.requestId !== requestId) return;
          if (entry.downloadTask && typeof entry.downloadTask.abort === "function") {
            try {
              entry.downloadTask.abort();
            } catch (err) {
              // ignore
            }
          }
          finalize("", "error");
        }, TILE_LOAD_TIMEOUT_MS);
      });
      return entry.promise;
    },

    releaseTileResource(src, consumerId) {
      const normalized = `${src || ""}`.trim();
      if (!normalized || !this._tileResourceCache) return;
      const entry = this._tileResourceCache.get(normalized);
      if (!entry) return;
      if (consumerId) entry.consumers.delete(consumerId);
      if (entry.consumers.size > 0 || entry.status !== "pending") return;
      if (entry.downloadTask && typeof entry.downloadTask.abort === "function") {
        try {
          entry.downloadTask.abort();
        } catch (err) {
          // ignore
        }
      }
      if (typeof entry.finalize === "function") {
        entry.finalize("", "idle");
      }
    },

    clearTileResourceEntry(entry, options = {}) {
      if (!entry) return;
      if (entry.downloadTimer) clearTimeout(entry.downloadTimer);
      if (options.abort && entry.downloadTask && typeof entry.downloadTask.abort === "function") {
        try {
          entry.downloadTask.abort();
        } catch (err) {
          // ignore
        }
      }
      entry.downloadTask = null;
      entry.promise = null;
      entry.finalize = null;
    },

    pruneTileResourceCache(keepSrcSet) {
      if (!this._tileResourceCache || this._tileResourceCache.size <= TILE_RESOURCE_CACHE_LIMIT) return;
      const keep = keepSrcSet instanceof Set ? keepSrcSet : new Set();
      for (const [src, entry] of Array.from(this._tileResourceCache.entries())) {
        if (this._tileResourceCache.size <= TILE_RESOURCE_CACHE_LIMIT) break;
        if (keep.has(src) || entry?.status === "pending") continue;
        this.clearTileResourceEntry(entry);
        this._tileResourceCache.delete(src);
      }
    }
  }
});
