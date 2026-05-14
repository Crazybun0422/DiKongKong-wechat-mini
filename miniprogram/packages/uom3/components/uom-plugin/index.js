const {
  buildProvinceLayerRecords,
  findProvinceLayerRecordForPoint
} = require("../../utils/uomProvinceSelector");
const provinceGeojson = require("../../map-meta-data/China.js");
const {
  outOfChina
} = require("../../../../utils/coords");
const {
  UOM3_DEFAULT_RENDER_COLOR,
  UOM3_SAFE_STATUS_TEXT,
  UOM3_NON_RESTRICTED_STATUS_TEXT,
  UOM3_RESTRICTED_STATUS_TEXT,
  normalizeRenderColor,
  readStoredRenderColor,
  resolveSuitableFlyZoneFile,
  loadParsedResourceForResolvedFile,
  buildGraphicsFromParsedResource,
  pointCoveredBySuitableZone
} = require("../../utils/core");

const SPECIAL_REGION_CODE_SET = new Set(["71", "81", "82"]);
const STATUS_PENDING_TEXT = "评估中";
const STATUS_DISABLED_TEXT = "已禁用";
const STATUS_LOAD_FAILED_TEXT = "空域数据加载失败";
const REFRESH_DEBOUNCE_MS = 180;
const STATUS_EVAL_DELAY_MS = 60;
const UOM_REGION_RECORDS = buildProvinceLayerRecords(provinceGeojson, { includeSpecialRegions: true });

function describeRuntimeError(err) {
  let rawString = "";
  try {
    rawString = err && typeof err === "object" ? JSON.stringify(err) : `${err || ""}`;
  } catch (jsonErr) {
    rawString = `${err || ""}`;
  }
  return {
    message: err?.message || `${err || ""}`,
    errMsg: err?.errMsg || "",
    statusCode: Number(err?.statusCode) || 0,
    stack: err?.stack || "",
    rawType: Object.prototype.toString.call(err),
    rawKeys: err && typeof err === "object" ? Object.keys(err) : [],
    rawString
  };
}

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
      this._refreshTimer = null;
      this._statusTimer = null;
      this._refreshSeq = 0;
      this._lastRefreshKey = "";
      this._lastStatusPayload = null;
      this._parsedResource = null;
      this._currentFileName = "";
      this._graphics = { polygons: [], polylines: [] };
      this._lastGraphicsToken = "";
      this._graphicsViewportKey = "";
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
      if (options.force === true || !this._currentFileName || !this._parsedResource) {
        this.scheduleRefresh(options.force === true);
      }
    },

    setEnabled(enabled) {
      this._enabled = enabled !== false;
      this.setData({ uomDivisionEnabled: this._enabled });
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
      this.rebuildGraphicsIfViewportChanged();
      this.scheduleRefresh(false);
    },

    startFollow() {},

    stopFollow() {},

    destroy() {
      this._destroyed = true;
      if (this._refreshTimer) {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = null;
      }
      if (this._statusTimer) {
        clearTimeout(this._statusTimer);
        this._statusTimer = null;
      }
    },

    emitGraphics() {
      if (this._destroyed) return;
      const detail = {
        polygons: Array.isArray(this._graphics?.polygons) ? this._graphics.polygons : [],
        polylines: Array.isArray(this._graphics?.polylines) ? this._graphics.polylines : []
      };
      this.triggerEvent("graphicschange", detail);
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
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }
      return { latitude, longitude };
    },

    scheduleRefresh(force = false) {
      if (this._destroyed) return;
      if (this._refreshTimer) {
        clearTimeout(this._refreshTimer);
      }
      const delay = force ? 0 : REFRESH_DEBOUNCE_MS;
      this._refreshTimer = setTimeout(() => {
        this._refreshTimer = null;
        this.refreshResource(force);
      }, delay);
    },

    resolveGraphicsViewportKey() {
      const region = this._region || null;
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
        return "none";
      }
      return [
        neLng.toFixed(4),
        neLat.toFixed(4),
        swLng.toFixed(4),
        swLat.toFixed(4)
      ].join(",");
    },

    rebuildGraphicsIfViewportChanged(force = false) {
      const nextViewportKey = this.resolveGraphicsViewportKey();
      if (!force && nextViewportKey === this._graphicsViewportKey) {
        return;
      }
      this._graphicsViewportKey = nextViewportKey;
      this.rebuildGraphics(true);
    },

    resolveStatus(center) {
      if (this._enabled === false) {
        return { uomStatus: STATUS_DISABLED_TEXT, uomTone: "warn", uomLoading: false };
      }
      if (!center) {
        return { uomStatus: STATUS_PENDING_TEXT, uomTone: "neutral", uomLoading: false };
      }
      if (outOfChina(center.longitude, center.latitude) || resolveExcludedRegionRecord(center)) {
        return { uomStatus: UOM3_NON_RESTRICTED_STATUS_TEXT, uomTone: "safe", uomLoading: false };
      }
      if (!this._parsedResource) {
        return { uomStatus: STATUS_PENDING_TEXT, uomTone: "neutral", uomLoading: this.data.uomLoading === true };
      }
      const covered = pointCoveredBySuitableZone(center, this._parsedResource);
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

    rebuildGraphics(force = false) {
      const nextToken = `${this._enabled ? 1 : 0}|${this._currentFileName || ""}|${this._renderColor || ""}|${this._graphicsViewportKey || "none"}|${Number(this._scale) || 0}`;
      if (!force && nextToken === this._lastGraphicsToken) {
        return;
      }
      if (!this._enabled || !this._parsedResource) {
        this._graphics = { polygons: [], polylines: [] };
      } else {
        this._graphics = buildGraphicsFromParsedResource(this._parsedResource, this._renderColor, {
          region: this._region || null,
          scale: this._scale
        });
      }
      this._lastGraphicsToken = nextToken;
      console.log("[uom3] emitGraphics", {
        fileName: this._currentFileName || "",
        polygonCount: Array.isArray(this._graphics?.polygons) ? this._graphics.polygons.length : 0,
        firstPolygonPointCount:
          Array.isArray(this._graphics?.polygons) &&
          this._graphics.polygons[0] &&
          Array.isArray(this._graphics.polygons[0].points)
            ? this._graphics.polygons[0].points.length
            : 0,
        polylineCount: Array.isArray(this._graphics?.polylines) ? this._graphics.polylines.length : 0
      });
      this.emitGraphics();
    },

    async refreshResource(force = false) {
      const center = this.resolveCenter();
      const centerKey = center
        ? `${center.latitude.toFixed(6)},${center.longitude.toFixed(6)},${this._enabled ? 1 : 0}`
        : `none,${this._enabled ? 1 : 0}`;
      if (!force && centerKey === this._lastRefreshKey) {
        this.updateStatusPanel();
        return;
      }
      this._lastRefreshKey = centerKey;
      if (!this._enabled) {
        this._parsedResource = null;
        this._currentFileName = "";
        this._lastGraphicsToken = "";
        this._graphicsViewportKey = "";
        this.setData({ uomLoading: false });
        this.rebuildGraphics(true);
        this.updateStatusPanel();
        return;
      }
      if (!center) {
        this.setData({ uomLoading: false });
        this.updateStatusPanel();
        return;
      }
      if (outOfChina(center.longitude, center.latitude) || resolveExcludedRegionRecord(center)) {
        this.setData({ uomLoading: false });
        this.updateStatusPanel();
        return;
      }

      const refreshSeq = this._refreshSeq + 1;
      this._refreshSeq = refreshSeq;
      this.setData({ uomLoading: true });
      this.updateStatusPanel();
      try {
        const resolved = await resolveSuitableFlyZoneFile(center);
        if (this._destroyed || refreshSeq !== this._refreshSeq) return;
        const resolvedFileName = typeof resolved?.fileName === "string" ? resolved.fileName.trim() : "";
        if (!resolvedFileName) {
          this.setData({ uomLoading: false });
          this.updateStatusPanel();
          return;
        }
        if (resolvedFileName && resolvedFileName === this._currentFileName && this._parsedResource) {
          this.setData({ uomLoading: false });
          this.updateStatusPanel();
          return;
        }
        const loaded = await loadParsedResourceForResolvedFile(resolved, {
          renderColor: this._renderColor
        });
        if (this._destroyed || refreshSeq !== this._refreshSeq) return;
        const sameFile = loaded.fileName === this._currentFileName;
        const sameResource = loaded.resource === this._parsedResource;
        this._currentFileName = loaded.fileName;
        this._parsedResource = loaded.resource;
        this.setData({ uomLoading: false });
        if (!sameFile || !sameResource) {
          this._lastGraphicsToken = "";
          this.rebuildGraphicsIfViewportChanged(true);
        }
        this.updateStatusPanel();
      } catch (err) {
        if (this._destroyed || refreshSeq !== this._refreshSeq) return;
        const errorDetail = describeRuntimeError(err);
        console.warn("[uom3] refreshResource failed", {
          center,
          currentFileName: this._currentFileName || "",
          errorMessage: errorDetail.message,
          errorErrMsg: errorDetail.errMsg,
          errorStatusCode: errorDetail.statusCode,
          errorStack: errorDetail.stack,
          errorRawType: errorDetail.rawType,
          errorRawKeys: errorDetail.rawKeys,
          errorRawString: errorDetail.rawString
        });
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
