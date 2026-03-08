const { buildWmsOverlay, WMS_MIN_ZOOM, WMS_MAX_ZOOM } = require("../../../../utils/wms");
const {
  buildProvinceLayerRecords,
  buildProvinceLayerParams
} = require("../../../../utils/uomProvinceSelector");
const provinceGeojson = require("../../map-meta-data/China.js");

const UOM_WARNING_DISMISS_STORAGE_KEY = "uomTileWarningDismissed";
const MIN_GROUND_OVERLAY_SDK = "2.21.2";
const UOM_SAFE_STATUS_TEXT = "适飞空域（限高120m）";
const MAP_MIN_SCALE = 0;
const MAP_MAX_SCALE = 18;
const DEFAULT_MAP_SCALE = 11;
const WEB_TILE_SIZE = 256;
const UOM_MASK_SAMPLE_SIZE = 256;
const UOM_MASK_LOAD_TIMEOUT_MS = 8000;
const UOM_TILE_HIRES_SIZE = 512;
const UOM_TILE_HIRES_MIN_ZOOM = 14;
const UOM_TILE_MAX_TILES = 36;
const UOM_VIEWPORT_PADDING_PX = 120;
const UOM_MASK_KEEP_RADIUS = 1;
const UOM_MASK_MAX_CACHE = (UOM_MASK_KEEP_RADIUS * 2 + 1) * (UOM_MASK_KEEP_RADIUS * 2 + 1);
const UOM_MASK_RETRY_LIMIT = 2;
const UOM_MASK_RETRY_DELAY_MS = 1200;
const WMS_FINAL_REFRESH_DELAY_MS = 150;
const WMS_OVERLAY_REMOVE_RETRY_MS = 120;
const WMS_OVERLAY_STALE_REMOVE_MS = WMS_FINAL_REFRESH_DELAY_MS * 2;
const isHttpUrl = (value) => /^https?:\/\//.test(value || "");
const UOM_PROVINCE_LAYER_RECORDS = buildProvinceLayerRecords(provinceGeojson);
const UOM_PROVINCE_LAYER_PARAM_CACHE = new Map();
const UOM_PROVINCE_LAYER_PARAM_CACHE_LIMIT = 256;

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

const normalizeRuntimeField = (value) => `${value || ""}`.toLowerCase();
const getRuntimeInfo = () => {
  let appBase = {};
  let device = {};
  let windowInfo = {};
  if (typeof wx !== "undefined") {
    try {
      if (typeof wx.getAppBaseInfo === "function") {
        appBase = wx.getAppBaseInfo() || {};
      }
    } catch (err) {
      appBase = {};
    }
    try {
      if (typeof wx.getDeviceInfo === "function") {
        device = wx.getDeviceInfo() || {};
      }
    } catch (err) {
      device = {};
    }
    try {
      if (typeof wx.getWindowInfo === "function") {
        windowInfo = wx.getWindowInfo() || {};
      }
    } catch (err) {
      windowInfo = {};
    }
  }
  return {
    SDKVersion: appBase.SDKVersion || "",
    appName: appBase.appName || appBase.hostName || "",
    app: "",
    AppPlatform: appBase.platform || device.platform || "",
    environment: "",
    platform: device.platform || "",
    pixelRatio: Number(windowInfo.pixelRatio || device.pixelRatio) || 1,
    host: appBase.host || "",
    hostName: appBase.hostName || ""
  };
};

const isWeChatRuntime = () => {
  try {
    const info = getRuntimeInfo();
    const env = normalizeRuntimeField(info.environment || info.AppPlatform || info.host || info.hostName);
    const appName = normalizeRuntimeField(info.appName || info.app || info.hostName);
    return (
      env === "wechat" ||
      env === "weixin" ||
      appName === "weixin" ||
      appName === "wechat"
    );
  } catch (err) {
    // ignore
  }
  return false;
};

const compareVersion = (v1, v2) => {
  const s1 = `${v1 || ""}`.split(".");
  const s2 = `${v2 || ""}`.split(".");
  const len = Math.max(s1.length, s2.length);
  for (let i = 0; i < len; i += 1) {
    const n1 = Number(s1[i] || 0);
    const n2 = Number(s2[i] || 0);
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
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
    a.uomTileWarningVisible === b.uomTileWarningVisible &&
    a.uomTileWarningDismissed === b.uomTileWarningDismissed
  );
};

Component({
  options: { virtualHost: true },
  data: {
    uomStatus: "评估中",
    uomTone: "neutral",
    uomTileWarningVisible: false,
    uomTileWarningDismissed: false,
    uomDivisionEnabled: true,
    center: null,
    scale: null
  },
  lifetimes: {
    created() {
      console.log("[uom-plugin] created");
    },
    attached() {
      console.log("[uom-plugin] attached");
    },
    ready() {
      console.log("[uom-plugin] ready");
    },
    detached() {
      console.log("[uom-plugin] detached");
      this.destroy();
    }
  },
  methods: {
    init(options = {}) {
      const { mapCtx, center, centerPin, scale, region, enabled } = options;
      console.log("[uom-plugin] init", { hasMapCtx: !!mapCtx, scale, enabled });
      this.mapCtx = mapCtx || this.mapCtx || null;
      this._centerOverride = center || this.data.center || null;
      this._centerPin = centerPin || center || this._centerPin || this.data.center || null;
      this._lastRegion = region || null;
      this._currentWmsTiles = [];
      this._wmsOverlayMap = new Map();
      this._wmsOverlaySeed = 0;
      this._wmsOverlayZoom = null;
      this._wmsOverlayEpoch = 0;
      this._wmsOverlayRemovals = new Set();
      this._wmsOverlayRemovalQueue = [];
      this._wmsOverlayRemovalQueued = new Set();
      this._wmsOverlayRemoving = false;
      this._wmsOverlayClearCallbacks = [];
      this._wmsOverlayRemovalTimer = null;
      this._wmsFinalRefreshTimer = null;
      this._uomEnvReported = false;
      this._uomModalShown = false;
      this._uomFallbackTimer = null;
      this._uomTileMasks = new Map();
      this._uomMaskKeepIds = new Set();
      this._uomMaskSupported = typeof wx !== "undefined" && typeof wx.createOffscreenCanvas === "function";
      this._uomOverlayFailed = false;
      this._uomOverlayUnsupported = false;
      this._mapViewport = null;
      this._devicePixelRatio = 1;
      this._sdkVersion = "";
      this._destroyed = false;

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
        updates.uomDivisionEnabled = enabled;
        this.data.uomDivisionEnabled = enabled;
      }
      const storedUomDismissed = this.readStoredUomWarningDismissed();
      if (storedUomDismissed) {
        updates.uomTileWarningDismissed = true;
        this.data.uomTileWarningDismissed = true;
      }

      if (Object.keys(updates).length) {
        this.setData(updates);
      }

      this.detectUomOverlaySupport();
      this.updateUomTileWarning();

      const initialCenter = centerPin || center;
      if (this.mapCtx && initialCenter && Number.isFinite(scale)) {
        this.refreshWmsOverlay(initialCenter, scale, region || this._lastRegion);
      }
    },
    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      if (this._uomFallbackTimer) clearTimeout(this._uomFallbackTimer);
      if (this._wmsOverlayRemovalTimer) clearTimeout(this._wmsOverlayRemovalTimer);
      if (this._wmsFinalRefreshTimer) clearTimeout(this._wmsFinalRefreshTimer);
      if (this._uomTileMasks) {
        for (const entry of this._uomTileMasks.values()) {
          this.clearUomMaskEntryTimeout(entry);
        }
      }
      this.clearMapOverlays();
      this.mapCtx = null;
      this._lastStatusPayload = null;
    },

    setEnabled(enabled) {
      const next = enabled !== false;
      if (this.data.uomDivisionEnabled === next) return;
      this.data.uomDivisionEnabled = next;
      this.setData({ uomDivisionEnabled: next });
      if (!next) {
        this.clearMapOverlays();
        this.updateStatusPanel();
        return;
      }
      this.refreshWmsOverlay();
      this.updateStatusPanel();
    },

    handleRegionChange(options = {}) {
      if (this._destroyed) return;
      const { center, centerPin, scale, region, force } = options;
      if (centerPin) {
        this._centerPin = centerPin;
      } else if (center) {
        this._centerPin = center;
      }
      if (center) {
        this._centerOverride = center;
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
      if (!this.mapCtx) return;
      if (force || center || centerPin || Number.isFinite(scale)) {
        this.refreshWmsOverlay(center || centerPin || this._centerOverride, scale, region || this._lastRegion);
      }
    },

    resolveUomCenter(centerOverride) {
      return centerOverride || this._centerPin || this._centerOverride || this.data.center || null;
    },

    scheduleFinalRefresh() {
      if (!this.mapCtx) return;
      if (this._wmsFinalRefreshTimer) clearTimeout(this._wmsFinalRefreshTimer);
      this._wmsFinalRefreshTimer = setTimeout(() => {
        if (!this.mapCtx) return;
        const scale = clampMapScale(this.data?.scale);
        const isMaxScale = Math.round(scale) >= MAP_MAX_SCALE;
        const fallbackCenter = this.resolveUomCenter();
        const apply = (center, region) => {
          const resolvedCenter = this.resolveUomCenter(center);
          if (!resolvedCenter) return;
          if (region && region.northeast && region.southwest) {
            this._lastRegion = region;
          }
          this.refreshWmsOverlay(resolvedCenter, scale, region || this._lastRegion);
        };
        const applyRegion = (center, res) => {
          const region = res?.region || (res?.northeast && res?.southwest
            ? { northeast: res.northeast, southwest: res.southwest }
            : null);
          apply(center, region);
        };
        if (isMaxScale) {
          if (typeof this.mapCtx.getRegion === "function") {
            this.mapCtx.getRegion({
              success: (regionRes) => applyRegion(fallbackCenter, regionRes),
              fail: () => apply(fallbackCenter, null)
            });
          } else {
            apply(fallbackCenter, null);
          }
          return;
        }
        if (typeof this.mapCtx.getCenterLocation === "function") {
          this.mapCtx.getCenterLocation({
            type: "gcj02",
            success: (res) => {
              const center = {
                latitude: res.latitude,
                longitude: res.longitude
              };
              this._centerOverride = center;
              this._centerPin = center;
              if (typeof this.mapCtx.getRegion === "function") {
                this.mapCtx.getRegion({
                  success: (regionRes) => applyRegion(center, regionRes),
                  fail: () => apply(center, null)
                });
              } else {
                apply(center, null);
              }
            },
            fail: () => apply(fallbackCenter, null)
          });
        } else {
          apply(fallbackCenter, null);
        }
      }, WMS_FINAL_REFRESH_DELAY_MS);
    },

    emitStatus(extra = {}) {
      if (this._destroyed) return;
      const payload = Object.assign(
        {
          uomStatus: this.data.uomStatus,
          uomTone: this.data.uomTone,
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
      const uom = this.describeUomStatus();
      const shouldShowWarning = this.shouldShowUomTileWarning();
      const dismissed = !!this.data.uomTileWarningDismissed;
      const uomWarningVisible = shouldShowWarning && !dismissed;
      const updates = {
        uomStatus: uom.status,
        uomTone: uom.tone,
        uomTileWarningVisible: uomWarningVisible,
        uomTileWarningDismissed: dismissed
      };
      this.setData(updates, () => this.emitStatus(updates));
    },

    shouldShowUomTileWarning() {
      if (this._uomOverlayUnsupported || this._uomOverlayFailed) {
        return true;
      }
      const tiles = Array.isArray(this._currentWmsTiles) ? this._currentWmsTiles : [];
      const scale = clampMapScale(this.data?.scale);
      if (!tiles.length || scale < WMS_MIN_ZOOM || scale > WMS_MAX_ZOOM) {
        return false;
      }
      const center = this.resolveUomCenter();
      if (!center) return false;
      const tile = this.findUomTileForPoint(center);
      if (!tile) return false;
      const maskEntry = this._uomTileMasks?.get(tile.id);
      if (maskEntry && maskEntry.status === "error") {
        return (maskEntry.retryCount || 0) > UOM_MASK_RETRY_LIMIT;
      }
      return false;
    },

    updateUomTileWarning() {
      if (this._destroyed) return;
      const shouldShow = this.shouldShowUomTileWarning();
      const dismissed = !!this.data.uomTileWarningDismissed;
      const visible = shouldShow && !dismissed;
      if (
        this.data &&
        this.data.uomTileWarningVisible === visible &&
        this.data.uomTileWarningDismissed === dismissed
      ) {
        return;
      }
      const updates = {
        uomTileWarningVisible: visible,
        uomTileWarningDismissed: dismissed
      };
      this.setData(updates, () => this.emitStatus(updates));
    },

    detectUomOverlaySupport() {
      try {
        const info = getRuntimeInfo();
        this._sdkVersion = info.SDKVersion || "";
        const appName = normalizeRuntimeField(info.appName || info.hostName || info.app || "");
        const appPlatform = normalizeRuntimeField(
          info.AppPlatform || info.environment || info.host || info.hostName || ""
        );
        const platform = normalizeRuntimeField(info.platform || "");
        this._isIOS = platform === "ios";
        this._devicePixelRatio = Number(info.pixelRatio) || 1;
        this.reportUomEnv({
          appName,
          appPlatform,
          platform,
          host: info.host || "",
          hostName: info.hostName || "",
          sdk: this._sdkVersion,
          isQQ: false,
          hasGlobalQQ: typeof qq !== "undefined"
        });
        const hasApi = !!(this.mapCtx && typeof this.mapCtx.addGroundOverlay === "function");
        const sdkOk = this._sdkVersion ? compareVersion(this._sdkVersion, MIN_GROUND_OVERLAY_SDK) >= 0 : true;
        const isDesktopEnv = platform && platform !== "ios" && platform !== "android";
        if (!hasApi || !sdkOk || isDesktopEnv) {
          this._uomOverlayUnsupported = true;
          this._uomOverlayFailed = true;
        }
      } catch (err) {
        console.warn("detectUomOverlaySupport failed", err);
      }
    },

    showUomWarningModal() {
      const modalApi =
        (typeof wx !== "undefined" && wx && typeof wx.showModal === "function" && wx.showModal) ||
        (typeof qq !== "undefined" && qq && typeof qq.showModal === "function" && qq.showModal);
      if (!modalApi) return;
      modalApi({
        title: "提示",
        content: "受地图组件能力限制，本页部分地图功能暂不可用。完整功能已在微信小程序「低空星球」上线，欢迎前往使用。",
        confirmText: "知道了",
        cancelText: "不再提示",
        success: (res) => {
          if (res && res.cancel) {
            this.onUomTileWarningNever();
          }
        }
      });
    },

    reportUomEnv(info = {}) {
      // no-op: was used for debugging environment detection
      this._uomEnvReported = true;
    },

    forceShowUomWarningFallback() {
      if (isWeChatRuntime()) return;
      if (this.data.uomTileWarningDismissed) return;
      if (!this.data.uomTileWarningVisible) {
        this.setData({ uomTileWarningVisible: true });
        if (!this._uomModalShown) {
          this._uomModalShown = true;
          this.showUomWarningModal();
        }
        this.emitStatus({ uomTileWarningVisible: true });
      }
    },

    onUomTileWarningNever() {
      this.persistUomWarningDismissed();
      this.setData({
        uomTileWarningVisible: false,
        uomTileWarningDismissed: true
      });
      this.emitStatus({
        uomTileWarningVisible: false,
        uomTileWarningDismissed: true
      });
    },

    readStoredUomWarningDismissed() {
      try {
        const val = wx.getStorageSync(UOM_WARNING_DISMISS_STORAGE_KEY);
        return !!val;
      } catch (err) {
        console.warn("failed to read UOM warning dismissal flag", err);
        return false;
      }
    },

    persistUomWarningDismissed() {
      try {
        wx.setStorageSync(UOM_WARNING_DISMISS_STORAGE_KEY, 1);
      } catch (err) {
        console.warn("failed to persist UOM warning dismissal flag", err);
      }
    },

    describeUomStatus() {
      if (this.data.uomDivisionEnabled === false) {
        return { status: "已禁用", tone: "warn" };
      }
      const currentScale = Number(this.data?.scale);
      // if (Number.isFinite(currentScale) && currentScale > 16) {
      //   return { status: "当前比例尺下不可见（请缩小地图）", tone: "warn" };
      // }
      const center = this.resolveUomCenter();
      if (!center) {
        return { status: "评估中", tone: "neutral" };
      }
      const tile = this.findUomTileForPoint(center);
      if (!tile) {
        return { status: "管制空域", tone: "alert" };
      }
      const maskEntry = this._uomTileMasks?.get(tile.id);
      if (!maskEntry) {
        //console.log("no mask entry for tile", tile.id);
        this.ensureUomMask(tile);
        return { status: "评估中", tone: "neutral" };
      }
      if (maskEntry.status === "pending") {
        //console.log("mask pending for tile", tile.id);
        return { status: "评估中", tone: "neutral" };
      }
      if (maskEntry.status === "error") {
        if ((maskEntry.retryCount || 0) <= UOM_MASK_RETRY_LIMIT) {
          this.scheduleUomMaskRetry(tile, maskEntry);
          return { status: "评估中", tone: "neutral" };
        }
        return { status: "空域数据加载失败", tone: "warn" };
      }
      if (maskEntry.status === "unsupported") {
        return { status: "当前环境不支持空域判定", tone: "warn" };
      }
      if (maskEntry.status !== "ready" || !maskEntry.data) {
        return { status: "管制空域", tone: "alert" };
      }
      //console.log("checking point coverage for tile,center,tile.bounds", tile.id, center, tile.bounds);
      const covered = this.pointCoveredByUomMask(center, tile.bounds, maskEntry);
      return covered
        ? { status: UOM_SAFE_STATUS_TEXT, tone: "safe" }
        : { status: "管制空域", tone: "alert" };
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

    resolveUomTileSize(scale) {
      const zoom = clampMapScale(scale ?? this.data.scale);
      const dpr = Number(this._devicePixelRatio) || 1;
      if (dpr >= 2 && zoom >= UOM_TILE_HIRES_MIN_ZOOM) {
        return UOM_TILE_HIRES_SIZE;
      }
      return WEB_TILE_SIZE;
    },

    resolveUomTilePadding(scale) {
      const zoom = clampMapScale(scale ?? this.data.scale);
      if (zoom >= 17) return 3;
      if (zoom >= 15) return 3;
      return 0;
    },

    resolveUomTileSpan(scale) {
      const zoom = clampMapScale(scale ?? this.data.scale);
      if (zoom >= 17) return 16;
      if (zoom >= 15) return 16;
      return 6;
    },

    refreshWmsOverlay(centerOverride, scaleOverride, regionOverride) {
      if (this.data.uomDivisionEnabled === false) {
        this.clearMapOverlays();
        return;
      }
      const center = this.resolveUomCenter(centerOverride);
      const scale = clampMapScale(scaleOverride || this.data.scale);
      this._uomOverlayFailed = false;
      if (!center || !Number.isFinite(center.latitude) || !Number.isFinite(center.longitude)) {
        return;
      }
      if (scale < WMS_MIN_ZOOM || scale > WMS_MAX_ZOOM) {
        this.clearMapOverlays();
        this._currentWmsTiles = [];
        this.updateStatusPanel();
        return;
      }
      const tileSize = this.resolveUomTileSize(scale);
      const viewport = this.getMapViewportSize();
      const overlays = buildWmsOverlay(
        { longitude: center.longitude, latitude: center.latitude },
        scale,
        regionOverride || this._lastRegion || null,
        {
          tileSize,
          maskSize: UOM_MASK_SAMPLE_SIZE,
          paddingTiles: this.resolveUomTilePadding(scale),
          maxSpan: this.resolveUomTileSpan(scale),
          maxTiles: UOM_TILE_MAX_TILES,
          viewportWidth: viewport?.width,
          viewportHeight: viewport?.height,
          viewportPaddingPx: UOM_VIEWPORT_PADDING_PX,
          resolveLayerParams: resolveProvinceLayerParams
        }
      );
      const applyOverlays = () => {
        if (this.data.uomDivisionEnabled === false) return;
        this._currentWmsTiles = overlays;
        const maskTiles = this.pickUomMaskTiles(overlays, center, UOM_MASK_KEEP_RADIUS);
        this.pruneUomTileMasks(maskTiles);
        this.updateStatusPanel();
        maskTiles.forEach((tile) => this.ensureUomMask(tile));
        this.applyWmsOverlays(overlays);
        this._wmsOverlayZoom = scale;
      };
      if (this._wmsOverlayZoom !== null && this._wmsOverlayZoom !== scale) {
        this.bumpWmsOverlayEpoch();
      }
      applyOverlays();
    },
    getMapViewportSize() {
      if (this._mapViewport && this._mapViewport.width && this._mapViewport.height) {
        return this._mapViewport;
      }
      let width = 375;
      let height = 667;
      try {
        if (typeof wx !== "undefined" && typeof wx.getWindowInfo === "function") {
          const info = wx.getWindowInfo();
          if (info) {
            width = info.windowWidth || info.screenWidth || width;
            height = info.windowHeight || info.screenHeight || height;
          }
        }
        if (typeof wx !== "undefined" && typeof wx.getDeviceInfo === "function") {
          const device = wx.getDeviceInfo();
          if (device) {
            width = width || device.screenWidth || width;
            height = height || device.screenHeight || height;
          }
        }
      } catch (err) {
        console.warn("getMapViewportSize failed", err);
      }
      this._mapViewport = { width, height };
      return this._mapViewport;
    },

    pruneUomTileMasks(tiles = []) {
      const keepIds = new Set();
      (tiles || []).forEach((tile) => {
        if (tile && tile.id) keepIds.add(tile.id);
      });
      this._uomMaskKeepIds = keepIds;
      if (!this._uomTileMasks || !this._uomTileMasks.size) return;
      if (keepIds.size) {
        for (const key of Array.from(this._uomTileMasks.keys())) {
          if (!keepIds.has(key)) {
            const entry = this._uomTileMasks.get(key);
            if (entry) this.clearUomMaskEntryTimeout(entry);
            this._uomTileMasks.delete(key);
          }
        }
      }
      this.enforceUomMaskCacheLimit(keepIds);
    },

    bumpWmsOverlayEpoch() {
      const next = Number.isFinite(this._wmsOverlayEpoch) ? this._wmsOverlayEpoch + 1 : 1;
      this._wmsOverlayEpoch = next;
      return next;
    },

    isWmsOverlayNotFound(err) {
      const msg = `${err?.errMsg || ""}`.toLowerCase();
      return (
        msg.includes("not exist") ||
        msg.includes("not found") ||
        msg.includes("no overlay") ||
        msg.includes("不存在")
      );
    },

    queueWmsOverlayRemoval(overlayId) {
      if (!Number.isFinite(overlayId)) return;
      if (!this._wmsOverlayRemovals) this._wmsOverlayRemovals = new Set();
      if (!this._wmsOverlayRemovalQueue) this._wmsOverlayRemovalQueue = [];
      if (!this._wmsOverlayRemovalQueued) this._wmsOverlayRemovalQueued = new Set();
      this._wmsOverlayRemovals.add(overlayId);
      if (this._wmsOverlayRemovalQueued.has(overlayId)) return;
      this._wmsOverlayRemovalQueued.add(overlayId);
      this._wmsOverlayRemovalQueue.push(overlayId);
      this.processWmsOverlayRemovalQueue();
    },

    processWmsOverlayRemovalQueue() {
      if (!this.mapCtx) return;
      if (this._wmsOverlayRemoving) return;
      if (!this._wmsOverlayRemovalQueue || !this._wmsOverlayRemovalQueue.length) {
        this.flushWmsOverlayClearCallbacks();
        return;
      }
      const overlayId = this._wmsOverlayRemovalQueue.shift();
      if (this._wmsOverlayRemovalQueued) {
        this._wmsOverlayRemovalQueued.delete(overlayId);
      }
      if (!this._wmsOverlayRemovals || !this._wmsOverlayRemovals.has(overlayId)) {
        this.processWmsOverlayRemovalQueue();
        return;
      }
      this._wmsOverlayRemoving = true;
      this.mapCtx.removeGroundOverlay({
        id: overlayId,
        success: () => {
          if (this._wmsOverlayRemovals) {
            this._wmsOverlayRemovals.delete(overlayId);
          }
          if (this._wmsOverlayRemovalQueued) {
            this._wmsOverlayRemovalQueued.delete(overlayId);
          }
          this._wmsOverlayRemoving = false;
          this.processWmsOverlayRemovalQueue();
        },
        fail: (err) => {
          console.warn("removeGroundOverlay failed", overlayId, err);
          if (this.isWmsOverlayNotFound(err)) {
            if (this._wmsOverlayRemovals) {
              this._wmsOverlayRemovals.delete(overlayId);
            }
            if (this._wmsOverlayRemovalQueued) {
              this._wmsOverlayRemovalQueued.delete(overlayId);
            }
            this._wmsOverlayRemoving = false;
            this.processWmsOverlayRemovalQueue();
            return;
          }
          if (this._wmsOverlayRemovalQueue) {
            this._wmsOverlayRemovalQueue.push(overlayId);
            if (this._wmsOverlayRemovalQueued) {
              this._wmsOverlayRemovalQueued.add(overlayId);
            }
          }
          this._wmsOverlayRemoving = false;
          if (this._wmsOverlayRemovalTimer) clearTimeout(this._wmsOverlayRemovalTimer);
          if (WMS_OVERLAY_REMOVE_RETRY_MS > 0) {
            this._wmsOverlayRemovalTimer = setTimeout(() => {
              this._wmsOverlayRemovalTimer = null;
              this.processWmsOverlayRemovalQueue();
            }, WMS_OVERLAY_REMOVE_RETRY_MS);
          } else {
            this._wmsOverlayRemovalTimer = null;
            this.processWmsOverlayRemovalQueue();
          }
        }
      });
    },

    flushWmsOverlayClearCallbacks() {
      if (this._wmsOverlayRemoving) return;
      if (this._wmsOverlayRemovalQueue && this._wmsOverlayRemovalQueue.length) return;
      if (!this._wmsOverlayClearCallbacks || !this._wmsOverlayClearCallbacks.length) return;
      const callbacks = this._wmsOverlayClearCallbacks.slice();
      this._wmsOverlayClearCallbacks = [];
      callbacks.forEach((fn) => {
        try {
          fn();
        } catch (err) {
          console.warn("WMS clear callback failed", err);
        }
      });
    },

    clearWmsOverlayHandleTimer(handle) {
      if (!handle) return;
      if (handle.staleTimer) {
        clearTimeout(handle.staleTimer);
      }
      handle.staleTimer = null;
      handle.stale = false;
    },

    markWmsOverlayStale(tileId, handle) {
      if (!handle || handle.staleTimer) return;
      handle.stale = true;
      handle.staleTimer = setTimeout(() => {
        const current = this._wmsOverlayMap?.get(tileId);
        if (!current || current !== handle || !current.stale) return;
        this.clearWmsOverlayHandleTimer(current);
        this.queueWmsOverlayRemoval(current.overlayId);
        this._wmsOverlayMap.delete(tileId);
        this.processWmsOverlayRemovalQueue();
      }, WMS_OVERLAY_STALE_REMOVE_MS);
    },

    dropWmsOverlay(tileId, handle) {
      if (!handle) return;
      this.clearWmsOverlayHandleTimer(handle);
      this.queueWmsOverlayRemoval(handle.overlayId);
      this._wmsOverlayMap.delete(tileId);
    },

    applyWmsOverlays(tiles, options = {}) {
      if (!this.mapCtx) return;
      this.processWmsOverlayRemovalQueue();
      const ctx = this.mapCtx;
      const epoch = Number.isFinite(options.epoch) ? options.epoch : this._wmsOverlayEpoch;
      this._wmsOverlayMap = this._wmsOverlayMap || new Map();
      this._wmsOverlaySeed = this._wmsOverlaySeed || 0;
      const nextIds = new Set();
      (tiles || []).forEach((tile) => {
        if (tile && tile.id) nextIds.add(tile.id);
      });
      if (this._wmsOverlayMap.size) {
        for (const [tileId, handle] of Array.from(this._wmsOverlayMap.entries())) {
          if (!nextIds.has(tileId)) {
            this.markWmsOverlayStale(tileId, handle);
            continue;
          }
          if (handle && handle.stale) {
            this.clearWmsOverlayHandleTimer(handle);
          }
        }
      }
      (tiles || []).forEach((tile) => {
        if (!tile || !tile.id || !tile.bounds) return;
        const signature = this.tileSignature(tile);
        const existing = this._wmsOverlayMap.get(tile.id);
        if (existing && existing.signature === signature) {
          if (existing.stale) this.clearWmsOverlayHandleTimer(existing);
          existing.epoch = epoch;
          return;
        }

        if (existing) {
          this.dropWmsOverlay(tile.id, existing);
        }
        this._wmsOverlaySeed += 1;
        const overlayId = this._wmsOverlaySeed;

        const alpha = tile.alpha != null ? tile.alpha : (tile.opacity != null ? tile.opacity : 0.65);
        ctx.addGroundOverlay({
          id: overlayId,
          src: tile.src,
          bounds: tile.bounds,
          alpha,
          success: () => {
            if (this._wmsOverlayRemovals && this._wmsOverlayRemovals.has(overlayId)) {
              this.queueWmsOverlayRemoval(overlayId);
              return;
            }
            if (epoch !== this._wmsOverlayEpoch) {
              this.queueWmsOverlayRemoval(overlayId);
            }
          },
          fail: (err) => {
            console.error("addGroundOverlay failed", tile.id, err);
            this._uomOverlayFailed = true;
            this.updateUomTileWarning();

            this.queueWmsOverlayRemoval(overlayId);
            this._wmsOverlayMap.delete(tile.id);
          }
        });
        this._wmsOverlayMap.set(tile.id, { overlayId, signature, epoch, stale: false, staleTimer: null });
      });
      this.processWmsOverlayRemovalQueue();
    },
    tileSignature(tile) {
      if (!tile) return "";
      const bounds = tile.bounds || {};
      const ne = bounds.northeast || {};
      const sw = bounds.southwest || {};
      const values = [
        tile.src || "",
        tile.alpha != null ? tile.alpha : tile.opacity,
        Number.isFinite(ne.latitude) ? ne.latitude.toFixed(6) : "",
        Number.isFinite(ne.longitude) ? ne.longitude.toFixed(6) : "",
        Number.isFinite(sw.latitude) ? sw.latitude.toFixed(6) : "",
        Number.isFinite(sw.longitude) ? sw.longitude.toFixed(6) : ""
      ];
      return values.join("|");
    },

    clearMapOverlays(options = {}) {
      this.bumpWmsOverlayEpoch();
      this._wmsOverlayMap = this._wmsOverlayMap || new Map();
      if (options && typeof options.onCleared === "function") {
        if (!this._wmsOverlayClearCallbacks) this._wmsOverlayClearCallbacks = [];
        this._wmsOverlayClearCallbacks.push(options.onCleared);
      }
      for (const [, handle] of this._wmsOverlayMap.entries()) {
        this.clearWmsOverlayHandleTimer(handle);
        if (this.mapCtx) {
          this.queueWmsOverlayRemoval(handle.overlayId);
        }
      }
      this._wmsOverlayMap.clear();
      this.processWmsOverlayRemovalQueue();
      this._wmsOverlayZoom = null;
      if (this._uomTileMasks) {
        for (const entry of this._uomTileMasks.values()) {
          this.clearUomMaskEntryTimeout(entry);
        }
        this._uomTileMasks.clear();
      }
      this._currentWmsTiles = [];
      this.updateStatusPanel();
    },

    findUomTileForPoint(point) {
      if (!point || !Array.isArray(this._currentWmsTiles)) return null;
      for (const tile of this._currentWmsTiles) {
        if (this.pointInBounds(point, tile.bounds)) return tile;
      }
      return null;
    },

    parseWmsTileId(tileId) {
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
    },

    pickUomMaskTiles(tiles = [], center, radius = UOM_MASK_KEEP_RADIUS) {
      if (!Array.isArray(tiles) || !tiles.length || !center) return [];
      const centerTile = this.findUomTileForPoint(center);
      if (!centerTile || !centerTile.id) return [];
      const parsed = this.parseWmsTileId(centerTile.id);
      if (!parsed) return [centerTile];
      const span = Number.isFinite(radius) ? Math.max(0, Math.round(radius)) : 0;
      const tileMap = new Map();
      tiles.forEach((tile) => {
        if (tile && tile.id) tileMap.set(tile.id, tile);
      });
      const picked = [];
      for (let dx = -span; dx <= span; dx += 1) {
        for (let dy = -span; dy <= span; dy += 1) {
          const id = `${parsed.zoom}-${parsed.x + dx}-${parsed.y + dy}`;
          const tile = tileMap.get(id);
          if (tile) picked.push(tile);
        }
      }
      return picked.length ? picked : [centerTile];
    },

    touchUomMaskEntry(tileId) {
      if (!this._uomTileMasks || !tileId) return;
      const entry = this._uomTileMasks.get(tileId);
      if (!entry) return;
      this._uomTileMasks.delete(tileId);
      this._uomTileMasks.set(tileId, entry);
    },

    clearUomMaskEntryTimeout(entry) {
      if (!entry) return;
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
        entry.timeoutId = null;
      }
      if (entry.retryTimer) {
        clearTimeout(entry.retryTimer);
        entry.retryTimer = null;
      }
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
    },

    scheduleUomMaskRetry(tile, entry) {
      if (!tile || !tile.id || !entry) return;
      if (entry.retryTimer) return;
      if (entry.status === "unsupported") return;
      const retryCount = Number.isFinite(entry.retryCount) ? entry.retryCount : 0;
      if (retryCount >= UOM_MASK_RETRY_LIMIT) return;
      const delay = UOM_MASK_RETRY_DELAY_MS * Math.pow(2, Math.max(0, retryCount - 1));
      entry.retryTimer = setTimeout(() => {
        entry.retryTimer = null;
        const active = this._uomTileMasks?.get(tile.id);
        if (!active || active !== entry) return;
        this.ensureUomMask(tile);
      }, delay);
    },

    markUomMaskError(tile, entry) {
      if (!tile || !tile.id) return;
      if (!this._uomTileMasks) this._uomTileMasks = new Map();
      const active = entry || this._uomTileMasks.get(tile.id) || { status: "error" };
      if (!entry && !this._uomTileMasks.get(tile.id)) {
        this._uomTileMasks.set(tile.id, active);
      }
      this.clearUomMaskEntryTimeout(active);
      const nextRetry = (active.retryCount || 0) + 1;
      active.retryCount = nextRetry;
      if (nextRetry > UOM_MASK_RETRY_LIMIT) {
        active.status = "unsupported";
        this.updateStatusPanel();
        this.updateUomTileWarning();
        return;
      }
      active.status = "error";
      this.scheduleUomMaskRetry(tile, active);
      this.updateStatusPanel();
    },

    loadUomMaskImage(tile, entry, img) {
      if (!tile || !tile.src || !entry || !img) {
        this.markUomMaskError(tile, entry);
        return;
      }
      const applySrc = (src) => {
        try {
          img.src = src;
        } catch (err) {
          this.markUomMaskError(tile, entry);
        }
      };
      if (entry.localSrc) {
        applySrc(entry.localSrc);
        return;
      }
      if (!isHttpUrl(tile.src) || typeof wx === "undefined" || typeof wx.downloadFile !== "function") {
        applySrc(tile.src);
        return;
      }
      const activeEntry = () => this._uomTileMasks?.get(tile.id) === entry;
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
      entry.downloadTask = wx.downloadFile({
        url: tile.src,
        success: (res) => {
          if (!activeEntry()) return;
          if (entry.downloadTimer) {
            clearTimeout(entry.downloadTimer);
            entry.downloadTimer = null;
          }
          const statusCode = Number(res?.statusCode);
          const filePath = res?.tempFilePath;
          if (statusCode === 200 && filePath) {
            entry.localSrc = filePath;
            applySrc(filePath);
            return;
          }
          this.markUomMaskError(tile, entry);
        },
        fail: () => {
          if (!activeEntry()) return;
          if (entry.downloadTimer) {
            clearTimeout(entry.downloadTimer);
            entry.downloadTimer = null;
          }
          this.markUomMaskError(tile, entry);
        }
      });
      if (UOM_MASK_LOAD_TIMEOUT_MS > 0) {
        entry.downloadTimer = setTimeout(() => {
          if (!activeEntry()) return;
          this.markUomMaskError(tile, entry);
        }, UOM_MASK_LOAD_TIMEOUT_MS);
      }
    },

    enforceUomMaskCacheLimit(keepIds) {
      if (!this._uomTileMasks || !this._uomTileMasks.size) return;
      const max = UOM_MASK_MAX_CACHE;
      if (!Number.isFinite(max) || max <= 0) return;
      if (this._uomTileMasks.size <= max) return;
      const keepSet = keepIds instanceof Set ? keepIds : new Set();
      for (const key of Array.from(this._uomTileMasks.keys())) {
        if (this._uomTileMasks.size <= max) break;
        if (!keepSet.has(key)) {
          const entry = this._uomTileMasks.get(key);
          if (entry) this.clearUomMaskEntryTimeout(entry);
          this._uomTileMasks.delete(key);
        }
      }
      for (const key of Array.from(this._uomTileMasks.keys())) {
        if (this._uomTileMasks.size <= max) break;
        const entry = this._uomTileMasks.get(key);
        if (entry) this.clearUomMaskEntryTimeout(entry);
        this._uomTileMasks.delete(key);
      }
    },

    ensureUomMask(tile) {
      if (!tile || !tile.id) return;
      if (!this._uomTileMasks) this._uomTileMasks = new Map();
      const cached = this._uomTileMasks.get(tile.id);
      if (cached && (cached.status === "ready" || cached.status === "pending")) {
        this.touchUomMaskEntry(tile.id);
        return;
      }
      if (cached && cached.status === "unsupported") {
        this.touchUomMaskEntry(tile.id);
        return;
      }
      const retryCount = cached && Number.isFinite(cached.retryCount) ? cached.retryCount : 0;
      if (cached) {
        this.clearUomMaskEntryTimeout(cached);
      }
      if (!this._uomMaskSupported) {
        this._uomTileMasks.set(tile.id, { status: "unsupported" });
        this.updateStatusPanel();
        return;
      }
      try {
        const sampleSize = Number(tile.maskSize) || UOM_MASK_SAMPLE_SIZE;
        const canvas = wx.createOffscreenCanvas({ type: "2d", width: sampleSize, height: sampleSize });
        const ctx = canvas.getContext("2d");
        const img = canvas.createImage();
        const entry = {
          status: "pending",
          timeoutId: null,
          retryCount,
          retryTimer: null,
          downloadTask: null,
          downloadTimer: null,
          localSrc: ""
        };
        this._uomTileMasks.set(tile.id, entry);
        this.enforceUomMaskCacheLimit(this._uomMaskKeepIds);
        if (UOM_MASK_LOAD_TIMEOUT_MS > 0) {
          entry.timeoutId = setTimeout(() => {
            const active = this._uomTileMasks.get(tile.id);
            if (!active || active !== entry || active.status !== "pending") return;
            this.markUomMaskError(tile, entry);
          }, UOM_MASK_LOAD_TIMEOUT_MS);
        }
        img.onload = () => {
          try {
            const active = this._uomTileMasks.get(tile.id);
            if (!active || active !== entry) return;
            this.clearUomMaskEntryTimeout(entry);
            canvas.width = sampleSize;
            canvas.height = sampleSize;
            ctx.clearRect(0, 0, sampleSize, sampleSize);
            ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
            const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
            active.status = "ready";
            active.width = imageData.width;
            active.height = imageData.height;
            active.data = imageData.data;
            active.retryCount = 0;
            this.updateStatusPanel();
          } catch (err) {
            console.error("解析 UOM 瓦片失败", err);
            this.markUomMaskError(tile, entry);
          }
        };
        img.onerror = (err) => {
          console.error("加载 UOM 瓦片失败11111111", err);
          const active = this._uomTileMasks.get(tile.id);
          if (!active || active !== entry) return;
          this.markUomMaskError(tile, entry);
        };
        this.loadUomMaskImage(tile, entry, img);
      } catch (err) {
        console.error("创建 UOM 蒙版失败", err);
        this.markUomMaskError(tile);
      }
    },

    pointCoveredByUomMask(point, bounds, mask) {
      if (!point || !bounds || !mask || mask.status !== "ready" || !mask.data) return false;
      const sw = bounds.southwest || {};
      const ne = bounds.northeast || {};
      const lngSpan = (ne.longitude ?? sw.longitude) - (sw.longitude ?? 0);
      const latSpan = (ne.latitude ?? sw.latitude) - (sw.latitude ?? 0);
      if (!lngSpan || !latSpan) return false;
      const u = (point.longitude - sw.longitude) / lngSpan;
      const v = (ne.latitude - point.latitude) / latSpan;
      if (u < 0 || u > 1 || v < 0 || v > 1) return false;
      const width = mask.width || 256;
      const height = mask.height || 256;
      const px = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))));
      const py = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))));
      const idx = (py * width + px) * 4;
      const alpha = mask.data[idx + 3];
      return alpha > 16;
    }
  }
});
