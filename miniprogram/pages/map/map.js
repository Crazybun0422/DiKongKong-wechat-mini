const { DRONES } = require("../../utils/drones");
const { fetchDjiAreas, buildAreaGraphics } = require("../../utils/dji");
const { searchPlaces } = require("../../utils/search");
const {
  fetchNearbyMarkers,
  fetchMarkerDetail,
  incrementMarkerExposure,
  incrementMarkerPhoneCall,
  searchMarkers
} = require("../../utils/markers");
const {
  normalizeMarkerDetail: normalizeMarkerDetailUtil
} = require("../../utils/marker-detail");
const {
  fetchNearbyNoFlyZones,
  buildNoFlyZoneGraphics
} = require("../../utils/no-fly-zones");
const {
  buildWmsOverlay,
  WMS_MIN_ZOOM,
  WMS_MAX_ZOOM
} = require("../../utils/wms");
const { haversineMeters, clampRadius, gcj02ToWgs84, wgs84ToGcj02 } = require("../../utils/coords");
const {
  formatDistanceText,
  computeGreatCircleDistance
} = require("../../utils/distance");
const { QQMAP_KEY, QQMAP_CUSTOM_STYLE_ID } = require("../../utils/config");
const { loadStoredProfile: loadStoredProfileUtil } = require("../../utils/profile");
const {
  appendInviteCodeToPath,
  appendInviteCodeToQuery,
  getShareInviteCode: getShareInviteCodeUtil
} = require("../../utils/share");

const DEFAULT_CENTER = {
  latitude: 39.908823,
  longitude: 116.39747
};

const DEFAULT_DRONE_INDEX = (() => {
  const idx = DRONES.findIndex((d) => d.slug === "dji-mavic-3");
  return idx >= 0 ? idx : 0;
})();

const DEFAULT_DRONE = DRONES[DEFAULT_DRONE_INDEX] || DRONES[0] || {
  name: "",
  slug: ""
};
const DEFAULT_LEVELS_PARAM = "2,6,1,4,3,7,8,10";
const ACCESS_TOKEN_STORAGE_KEY = "accessToken";
const PENDING_INVITE_CODE_STORAGE_KEY = "pendingInviteCode";
// 小程序静态资源使用相对路径；assets 位于 miniprogram/assets
const NFZ_CENTER_COLORS = {
  1: "#000000",
  2: "#DE4329",
  3: "#EE8815",
  4: "#FFCC00",
  6: "#979797",
  7: "#37C4DB",
  8: "#35C759",
  10: "#A9D86E"
};

const MAP_MIN_SCALE = 0;
const MAP_MAX_SCALE = 16;
const DEFAULT_MAP_SCALE = 11;
const ATTACHMENT_DISPLAY_LABEL = "企业产品和业务介绍";

const MIN_FETCH_RADIUS = 80000;
const MAX_FETCH_RADIUS = 80000;
const DEFAULT_FETCH_RADIUS = 80000;
const MARKER_EXPOSURE_CACHE_TTL = 5 * 60 * 1000;
const MAX_SEARCH_SUGGESTIONS = 10;
const MAX_SEARCH_RESULTS = 20;
const MARKER_PAGE_SCROLL_TOP_THRESHOLD = 36;
const MARKER_PAGE_CLOSE_FAST_DISTANCE = 50;
const MARKER_PAGE_CLOSE_FAST_DURATION = 600;
const MARKER_PAGE_CLOSE_DISTANCE = 90;
const EARTH_RADIUS_METERS = 6378137;
const EARTH_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS_METERS;
const WEB_TILE_SIZE = 256;
const METERS_PER_PIXEL_BASE = EARTH_CIRCUMFERENCE / WEB_TILE_SIZE;
const CSS_PIXELS_PER_CM = 96 / 2.54;
const DEFAULT_SCALE_BAR_BASE_RPX = 80;
const LOCATE_SCALE_METERS = 500;
const MARKER_FETCH_SCALE_LIMIT_METERS = 5000;
const UOM_SAFE_STATUS_TEXT = "适飞空域（限高120m）";

const clampMapScale = (value) => {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : DEFAULT_MAP_SCALE;
  const rounded = Math.round(base);
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, rounded));
};

const formatNearbyMarkerLabel = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= 5) {
    return trimmed;
  }
  const firstLine = trimmed.slice(0, 5);
  const remaining = trimmed.slice(5);
  if (!remaining) {
    return firstLine;
  }
  let secondLine = remaining.slice(0, 5);
  if (remaining.length > 5) {
    secondLine = `${secondLine}...`;
  }
  return `${firstLine}\n${secondLine}`;
};

const formatTemporaryZoneLabel = (value, maxLength = 9) => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const chars = Array.from(trimmed);
  if (chars.length <= maxLength) {
    return trimmed;
  }
  return `${chars.slice(0, maxLength).join("")}...`;
};

const computeMetersPerPixel = (latitude, zoomLevel) => {
  if (!Number.isFinite(zoomLevel)) {
    return 0;
  }
  const lat = Math.max(-85, Math.min(85, Number(latitude) || 0));
  const zoom = Math.max(0, zoomLevel);
  const radians = (lat * Math.PI) / 180;
  const cosLat = Math.cos(radians);
  return (METERS_PER_PIXEL_BASE * cosLat) / Math.pow(2, zoom);
};

const formatScaleLabel = (meters) => {
  if (!Number.isFinite(meters) || meters <= 0) {
    return "";
  }
  if (meters >= 1000) {
    const km = meters / 1000;
    return km >= 10 ? `${Math.round(km)} km` : `${Math.round(km * 10) / 10} km`;
  }
  if (meters >= 1) {
    return `${Math.round(meters)} m`;
  }
  return `${Number(meters.toFixed(1))} m`;
};

const pickScaleBarLength = (rawMeters) => {
  if (!Number.isFinite(rawMeters) || rawMeters <= 0) {
    return { length: 0, label: "" };
  }
  const exponent = Math.floor(Math.log10(rawMeters));
  const pow = Math.pow(10, exponent);
  const steps = [1, 2, 5];
  let length = steps[0] * pow;
  for (let i = 0; i < steps.length; i += 1) {
    const candidate = steps[i] * pow;
    if (candidate <= rawMeters) {
      length = candidate;
    } else {
      break;
    }
  }
  if (!Number.isFinite(length) || length <= 0) {
    length = rawMeters;
  }
  return {
    length,
    label: formatScaleLabel(length)
  };
};

const settleWithValue = (promise, options = {}) => {
  const defaultValue =
    options && Object.prototype.hasOwnProperty.call(options, "defaultValue")
      ? options.defaultValue
      : undefined;
  return promise
    .then((value) => ({ ok: true, value }))
    .catch((error) => {
      if (typeof options?.onError === "function") {
        options.onError(error);
      } else {
        console.warn(options?.label || "Promise rejected", error);
      }
      return { ok: false, error, value: defaultValue };
    });
};

const cloneMarkerDetail = (detail = {}) => {
  if (!detail || typeof detail !== "object") {
    return {};
  }
  const cloneArray = (value) => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item) => (item && typeof item === "object" ? { ...item } : item));
  };
  const cloned = { ...detail };
  cloned.images = cloneArray(detail.images);
  cloned.honors = Array.isArray(detail.honors) ? [...detail.honors] : [];
  cloned.attachments = cloneArray(detail.attachments);
  cloned.qrCodes = cloneArray(detail.qrCodes);
  cloned.videoAccounts = cloneArray(detail.videoAccounts);
  if (detail.primaryVideoAccount && typeof detail.primaryVideoAccount === "object") {
    cloned.primaryVideoAccount = { ...detail.primaryVideoAccount };
  } else if (!detail.primaryVideoAccount) {
    cloned.primaryVideoAccount = null;
  }
  return cloned;
};

const decodeParamValue = (value) => {
  if (value === undefined || value === null) return "";
  const text = `${value}`.trim();
  if (!text) return "";
  try {
    return decodeURIComponent(text);
  } catch (err) {
    return text;
  }
};

const isTruthyFlag = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return ["1", "true", "yes", "y", "on", "share"].includes(normalized);
  }
  return false;
};

const parseSceneParams = (scene) => {
  if (!scene || typeof scene !== "string") {
    return {};
  }
  let decoded = scene;
  try {
    decoded = decodeURIComponent(scene);
  } catch (err) {
    decoded = `${scene}`;
  }
  decoded = decoded.replace(/\+/g, " ");
  const params = {};
  decoded.split(/[&,|]/).forEach((segment) => {
    const chunk = segment.trim();
    if (!chunk) return;
    let separatorIndex = chunk.indexOf("=");
    if (separatorIndex < 0) {
      separatorIndex = chunk.indexOf(":");
    }
    if (separatorIndex < 0) {
      params[chunk] = "";
      return;
    }
    const key = chunk.slice(0, separatorIndex).trim();
    const value = chunk.slice(separatorIndex + 1).trim();
    if (!key) return;
    params[key] = value;
  });
  return params;
};

const normalizeLaunchMarkerOptions = (options = {}) => {
  const normalized = {
    markerId: "",
    delayUntilPermission: false
  };
  if (!options || typeof options !== "object") {
    return normalized;
  }
  const candidateKeys = ["markerId", "markerID", "id"];
  for (const key of candidateKeys) {
    if (options[key] !== undefined && options[key] !== null) {
      const decoded = decodeParamValue(options[key]);
      if (decoded) {
        normalized.markerId = decoded;
        break;
      }
    }
  }
  const shareFlag = options.fromShare ?? options.share ?? options.source;
  if (isTruthyFlag(shareFlag)) {
    normalized.delayUntilPermission = true;
  }
  const sceneParams = parseSceneParams(options.scene);
  if (!normalized.markerId && sceneParams.markerId) {
    normalized.markerId = decodeParamValue(sceneParams.markerId);
  }
  if (!normalized.delayUntilPermission && sceneParams.fromShare) {
    normalized.delayUntilPermission = isTruthyFlag(sceneParams.fromShare);
  } else if (!normalized.delayUntilPermission && sceneParams.share) {
    normalized.delayUntilPermission = isTruthyFlag(sceneParams.share);
  }
  if (typeof options.q === "string" && options.q.trim()) {
    const decoded = decodeParamValue(options.q);
    const queryIndex = decoded.indexOf("?");
    const queryString = queryIndex >= 0 ? decoded.slice(queryIndex + 1) : decoded;
    const qParams = parseSceneParams(queryString);
    if (!normalized.markerId && qParams.markerId) {
      normalized.markerId = decodeParamValue(qParams.markerId);
    }
    if (!normalized.delayUntilPermission && qParams.fromShare) {
      normalized.delayUntilPermission = isTruthyFlag(qParams.fromShare);
    } else if (!normalized.delayUntilPermission && qParams.share) {
      normalized.delayUntilPermission = isTruthyFlag(qParams.share);
    }
  }
  return normalized;
};

const extractInviteCodeFromOptions = (options = {}) => {
  const readInviteFromObject = (source) => {
    if (!source || typeof source !== "object") return "";
    if (source.inviteCode === undefined || source.inviteCode === null) return "";
    return decodeParamValue(source.inviteCode);
  };
  if (!options || typeof options !== "object") {
    return "";
  }
  const direct = readInviteFromObject(options);
  if (direct) return direct;
  if (options.query) {
    const fromQuery = readInviteFromObject(options.query);
    if (fromQuery) return fromQuery;
  }
  const sceneParams = parseSceneParams(options.scene);
  const fromScene = readInviteFromObject(sceneParams);
  if (fromScene) return fromScene;
  if (typeof options.q === "string" && options.q.trim()) {
    const decoded = decodeParamValue(options.q);
    const queryIndex = decoded.indexOf("?");
    const queryString = queryIndex >= 0 ? decoded.slice(queryIndex + 1) : decoded;
    const qParams = parseSceneParams(queryString);
    const fromQ = readInviteFromObject(qParams);
    if (fromQ) return fromQ;
  }
  return "";
};

Page({
  data: {
    keyword: "",
    djiMsg: "",
    center: DEFAULT_CENTER,
    scale: DEFAULT_MAP_SCALE,
    minScale: MAP_MIN_SCALE,
    maxScale: MAP_MAX_SCALE,
    mapSubKey: QQMAP_KEY || "",
    customMapStyleId: QQMAP_CUSTOM_STYLE_ID || "",
    markers: [],
    polygons: [],
    circles: [],
    droneNames: DRONES.map((d) => d.name),
    selectedDroneIndex: DEFAULT_DRONE_INDEX,
    selectedDrone: DEFAULT_DRONE.slug,
    selectedDroneName: DEFAULT_DRONE.name,
    levelsInput: DEFAULT_LEVELS_PARAM,
    loadingDji: false,
    uomStatus: "评估中",
    uomTone: "neutral",
    djiStatus: "评估中",
    djiTone: "neutral",
    djiColor: "",
    djiStatusExtra: "",
    temporaryNoFlyZoneInfo: null,
    temporaryNoFlyText: "评估中",
    temporaryNoFlyTone: "neutral",
    searchSuggestions: [],
    searchSuggestLoading: false,
    searchSuggestError: "",
    dronePickerVisible: false,
    pendingDroneIndex: null,
    showDashboardPanel: true,
    activeTab: "home",
    markerDetailVisible: false,
    markerDetail: null,
    markerDetailClosing: false,
    markerDetailExpanding: false,
    markerPageVisible: false,
    markerPageClosing: false,
    markerPageDetail: null,
    markerPageCurrentImage: 0,
    markerPageShareEnabled: true,
    markerPageDistanceText: "",
    callSheetVisible: false,
    callSheetPhone: "",
    callSheetMarkerId: "",
    callSheetMarkerName: "",
    scaleBarVisible: false,
    scaleBarWidthRpx: DEFAULT_SCALE_BAR_BASE_RPX,
    scaleBarLabel: ""
  },

  onLoad(options = {}) {
    this.mapCtx = wx.createMapContext("main-map");
    this.applyCustomMapStyle();
    this.initializeSystemInfo();
    this._fetchTimer = null;
    this._markersFetchTimer = null;
    this._currentRadius = clampRadius(DEFAULT_FETCH_RADIUS);
    this._currentBounds = null;
    this._pendingRegionUpdates = 0;
    this._centerOverride = this.data.center;
    this._currentWmsTiles = [];
    this._wmsOverlayMap = new Map();
    this._wmsOverlaySeed = 0;
    this._djiPolygons = [];
    this._djiCircles = [];
    this._nfzPolygons = [];
    this._nfzCircles = [];
    this._uomTileMasks = new Map();
    this._uomMaskSupported = typeof wx !== "undefined" && typeof wx.createOffscreenCanvas === "function";
    this._suggestTimer = null;
    this._markerExposureCache = new Map();
    this._activeMarkersRequest = null;
    this._lastNearbyFetch = null;
    this._activeNoFlyRequest = null;
    this._lastNoFlyFetch = null;
    this._noFlyZonesReady = false;
    this._noFlyZones = [];
    this._noFlyZonesError = null;
    this._noFlyZoneShapes = [];
    this._nfzFetchTimer = null;
    this._nearbyMarkers = [];
    this._searchMarkers = [];
    this._lastMarkerDetail = null;
    this._markerDetailCloseTimer = null;
    this._markerPageCloseTimer = null;
    this._markerDetailTouch = null;
    this._markerPageTouch = null;
    this._markerPageScrollTop = 0;
    this._markerDetailExpandTimer = null;
    this._markerDetailExpandLock = false;
    this._restoreMarkerDetailTimer = null;
    this._manualMarkers = [];
    this._lastKnownLocation = null;
    this.captureInviteCode(options);
    this.initializeShareLaunch(options);
    this.consumePendingMarkerFocus({ immediate: true });
    this.refreshWmsOverlay();
    this.scheduleFetchDji(0);
    this.scheduleFetchMarkers(0, {
      center: this.data.center,
      scale: this.data.scale,
      force: true
    });
    this.scheduleFetchNoFlyZones(0, {
      center: this.data.center,
      scale: this.data.scale,
      force: true
    });
    this.updateScaleBar();
    this.updateStatusPanel();
    this.autoLoginOnLaunch();
    this.requestInitialLocation();
  },

  findMarkerById(markerId) {
    if (markerId === undefined || markerId === null) return null;
    const markerIdStr = `${markerId}`;
    const nearby = Array.isArray(this._nearbyMarkers) ? this._nearbyMarkers : [];
    const search = Array.isArray(this._searchMarkers) ? this._searchMarkers : [];
    const manual = Array.isArray(this._manualMarkers) ? this._manualMarkers : [];
    const combined = manual.concat(nearby, search);
    for (const marker of combined) {
      if ((marker?.id || marker?.id === 0) && `${marker.id}` === markerIdStr) {
        return marker;
      }
    }
    return null;
  },

  takePendingMarkerFocus() {
    const app = typeof getApp === "function" ? getApp() : null;
    if (!app || !app.globalData) return null;
    const payload = app.globalData.pendingMarkerFocus;
    if (payload) {
      app.globalData.pendingMarkerFocus = null;
      return payload;
    }
    return null;
  },

  consumePendingMarkerFocus(options = {}) {
    const request = this.takePendingMarkerFocus();
    if (!request) return;
    if (request.mode === "offline" || request.offlineRaw) {
      this.focusOfflineMarker(request);
      return;
    }
    this.focusOnlineMarker(request);
  },

  autoLoginOnLaunch() {
    this.ensureAccessToken().catch((err) => {
      console.warn("自动登录失败", err);
    });
  },

  captureInviteCode(options = {}) {
    const inviteCode = extractInviteCodeFromOptions(options);
    if (!inviteCode) {
      return;
    }
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && typeof app.setPendingInviteCode === "function") {
      app.setPendingInviteCode(inviteCode);
      return;
    }
    if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
      try {
        wx.setStorageSync(PENDING_INVITE_CODE_STORAGE_KEY, inviteCode);
      } catch (err) {
        console.warn("Failed to cache invite code locally", err);
      }
    }
  },

  initializeShareLaunch(options = {}) {
    this._shareLaunchMarkerId = "";
    this._shareLaunchWaitForPermission = false;
    this._shareLaunchPermissionSettled = true;
    this._shareLaunchHandled = false;
    this._shareLaunchDetail = null;
    this._shareLaunchError = null;
    this._shareMarkerFetchPromise = null;
    this._shareMarkerFetchSeq = 0;
    this._shareLaunchNeedAuthRetry = false;
    this._shareLaunchAuthPromise = null;
    const normalized = normalizeLaunchMarkerOptions(options);
    if (!normalized.markerId) {
      return;
    }
    this._shareLaunchMarkerId = normalized.markerId;
    this._shareLaunchWaitForPermission = !!normalized.delayUntilPermission;
    this._shareLaunchPermissionSettled = !this._shareLaunchWaitForPermission;
    this.fetchShareMarkerDetailById(normalized.markerId);
  },

  fetchShareMarkerDetailById(markerId, options = {}) {
    const id = `${markerId || ""}`.trim();
    if (!id) {
      return;
    }
    const allowRetry = options.allowRetry !== false;
    this._shareMarkerFetchSeq = (this._shareMarkerFetchSeq || 0) + 1;
    const seq = this._shareMarkerFetchSeq;
    const request = fetchMarkerDetail(id, {
      apiBase: this.getApiBase(),
      token: this.getAuthToken()
    });
    this._shareMarkerFetchPromise = request;
    request
      .then((detail) => {
        if (this._shareMarkerFetchPromise !== request || this._shareMarkerFetchSeq !== seq) {
          return;
        }
        this._shareMarkerFetchPromise = null;
        this._shareLaunchDetail = detail;
        this._shareLaunchError = null;
        this._shareLaunchNeedAuthRetry = false;
        this.tryActivateShareMarker();
      })
      .catch((err) => {
        if (this._shareMarkerFetchPromise !== request || this._shareMarkerFetchSeq !== seq) {
          return;
        }
        this._shareMarkerFetchPromise = null;
        if (allowRetry && err && err.message === "missing-token") {
          this._shareLaunchNeedAuthRetry = true;
          this._shareLaunchDetail = null;
          this._shareLaunchError = null;
          if (this._shareLaunchPermissionSettled) {
            this.retryShareMarkerDetailAfterAuth();
          }
          return;
        }
        this._shareLaunchDetail = null;
        this._shareLaunchError = err || new Error("marker-detail-failed");
        this.tryActivateShareMarker();
      });
  },

  markSharePermissionAttempted() {
    if (!this._shareLaunchMarkerId) return;
    if (!this._shareLaunchWaitForPermission) return;
    if (this._shareLaunchPermissionSettled) return;
    this._shareLaunchPermissionSettled = true;
    if (this._shareLaunchNeedAuthRetry) {
      this.retryShareMarkerDetailAfterAuth();
      return;
    }
    this.tryActivateShareMarker();
  },

  retryShareMarkerDetailAfterAuth() {
    if (!this._shareLaunchMarkerId) {
      this.tryActivateShareMarker();
      return;
    }
    const fetchAfterAuth = () => {
      if (!this._shareLaunchMarkerId || this._shareLaunchHandled) {
        this.tryActivateShareMarker();
        return;
      }
      this._shareLaunchNeedAuthRetry = false;
      this.fetchShareMarkerDetailById(this._shareLaunchMarkerId, { allowRetry: false });
    };
    if (this.hasAccessToken()) {
      fetchAfterAuth();
      return;
    }
    if (this._shareLaunchAuthPromise) {
      return;
    }
    this._shareLaunchAuthPromise = this.ensureProfileAuthenticated()
      .then(() => {
        fetchAfterAuth();
      })
      .catch((err) => {
        this._shareLaunchError = err || new Error("login-failed");
        this.tryActivateShareMarker();
      })
      .finally(() => {
        this._shareLaunchAuthPromise = null;
      });
  },

  tryActivateShareMarker() {
    if (!this._shareLaunchMarkerId || this._shareLaunchHandled) {
      return;
    }
    if (!this._shareLaunchPermissionSettled) {
      return;
    }
    if (this._shareLaunchDetail) {
      const success = this.activateShareMarkerDetail(this._shareLaunchDetail);
      this._shareLaunchHandled = true;
      this._shareLaunchDetail = null;
      this._shareLaunchMarkerId = "";
      if (!success) {
        return;
      }
      return;
    }
    if (this._shareLaunchError) {
      this.handleShareMarkerError(this._shareLaunchError);
      this._shareLaunchHandled = true;
      this._shareLaunchMarkerId = "";
      this._shareLaunchError = null;
    }
  },

  handleShareMarkerError(err) {
    const message =
      err && err.message === "missing-token"
        ? "请先登录后再查看商户详情"
        : "加载商户详情失败，请稍后重试";
    wx.showToast({ title: message, icon: "none" });
  },

  activateShareMarkerDetail(rawDetail) {
    const marker = this.buildShareMarkerFromDetail(rawDetail);
    if (!marker) {
      wx.showToast({ title: "商户信息不完整", icon: "none" });
      return false;
    }
    const detail = marker?.extData?.detail || {};
    const isApproved = this.getDetailReviewStatus(detail) === "APPROVED";
    if (!isApproved) {
      this._manualMarkers = [marker];
      this.syncAllMarkers();
    } else if (Array.isArray(this._manualMarkers) && this._manualMarkers.length) {
      this._manualMarkers = [];
      this.syncAllMarkers();
    }
    this.centerOnPoint(
      { latitude: marker.latitude, longitude: marker.longitude },
      clampMapScale(16)
    );
    if (isApproved) {
      this.scheduleFetchMarkers(0, {
        force: true,
        center: { latitude: marker.latitude, longitude: marker.longitude },
        scale: this.data.scale
      });
    }
    this.openMarkerPage(detail);
    return true;
  },

  buildShareMarkerFromDetail(rawDetail = {}) {
    if (!rawDetail) {
      return null;
    }
    const detail = this.composeMarkerDetail(rawDetail, {}, {
      source: "share",
      id: rawDetail.id,
      name: rawDetail.name,
      locationText: rawDetail.locationText
    });
    const latitude = Number(detail.latitude);
    const longitude = Number(detail.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    const gcj = wgs84ToGcj02(longitude, latitude);
    const latitudeGcj = Number.isFinite(gcj?.lat) ? gcj.lat : latitude;
    const longitudeGcj = Number.isFinite(gcj?.lng) ? gcj.lng : longitude;
    const markerName = detail.name || "商户位置";
    const markerId = detail.markerId || detail.id || rawDetail.id || `share-${Date.now()}`;
    const marker = {
      id: markerId,
      latitude: latitudeGcj,
      longitude: longitudeGcj,
      title: markerName,
      iconPath: "/assets/drone.png",
      width: 44,
      height: 44,
      extData: {
        source: "share",
        raw: rawDetail,
        detail: cloneMarkerDetail(detail)
      }
    };
    const calloutContent = formatNearbyMarkerLabel(markerName);
    if (calloutContent) {
      marker.callout = {
        content: calloutContent,
        color: "rgba(0, 0, 0, 0.95)",
        fontSize: 14,
        fontWeight: "bold",
        display: "ALWAYS",
        borderRadius: 4,
        padding: 4
      };
    }
    return marker;
  },

  focusOnlineMarker(request = {}) {
    const latitude = Number(request.latitude);
    const longitude = Number(request.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }
    this.clearManualMarkers();
    const gcj = wgs84ToGcj02(longitude, latitude);
    const target = {
      latitude: Number.isFinite(gcj?.lat) ? gcj.lat : latitude,
      longitude: Number.isFinite(gcj?.lng) ? gcj.lng : longitude
    };
    this.centerOnPoint(target, clampMapScale(request.scale || 15));
  },

  focusOfflineMarker(request = {}) {
    const latitude = Number(request.latitude);
    const longitude = Number(request.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      wx.showToast({ title: "标记缺少位置信息", icon: "none" });
      return;
    }
    const rawDetail =
      request.offlineRaw && typeof request.offlineRaw === "object"
        ? Object.assign({}, request.offlineRaw)
        : {};
    const detail = this.composeMarkerDetail(rawDetail, {}, {
      source: "offline",
      id: request.markerId,
      name: request.name,
      locationText: request.locationText,
      latitude,
      longitude
    });
    this.applyOfflineSnapshot(detail, request.detailSnapshot);
    detail.shareDisabled = request.shareDisabled !== false;
    if (request.reviewStatus) {
      detail.reviewStatus = request.reviewStatus;
    }
    const gcj = wgs84ToGcj02(longitude, latitude);
    const latitudeGcj = Number.isFinite(gcj?.lat) ? gcj.lat : latitude;
    const longitudeGcj = Number.isFinite(gcj?.lng) ? gcj.lng : longitude;
    const markerId = detail.markerId || request.markerId || `offline-${Date.now()}`;
    const markerName = detail.name || request.name || "离线标记";
    const marker = {
      id: markerId,
      latitude: latitudeGcj,
      longitude: longitudeGcj,
      title: markerName,
      iconPath: "/assets/drone-offline.png",
      width: 44,
      height: 44,
      extData: {
        source: "offline",
        raw: rawDetail,
        detail: cloneMarkerDetail(detail)
      }
    };
    const calloutContent = formatNearbyMarkerLabel(markerName);
    if (calloutContent) {
      marker.callout = {
        content: calloutContent,
        color: "rgba(0, 0, 0, 0.95)",
        fontSize: 14,
        fontWeight: "bold",
        display: "ALWAYS",
        borderRadius: 4,
        padding: 4
      };
    }
    this._manualMarkers = [marker];
    this.syncAllMarkers();
    this.centerOnPoint(
      { latitude: latitudeGcj, longitude: longitudeGcj },
      clampMapScale(request.scale || 15)
    );
    this.openMarkerDetail(marker);
  },

  applyOfflineSnapshot(detail, snapshot = {}) {
    if (!detail || !snapshot || typeof snapshot !== "object") {
      return;
    }
    const resolveUrl = (item) => {
      if (!item) return "";
      if (typeof item === "string") {
        return item.trim();
      }
      if (typeof item.url === "string" && item.url.trim()) {
        return item.url.trim();
      }
      if (typeof item.fileName === "string" && item.fileName.trim()) {
        return item.fileName.trim();
      }
      return "";
    };
    if ((!detail.images || !detail.images.length) && Array.isArray(snapshot.images)) {
      detail.images = snapshot.images
        .map((item, index) => {
          const url = resolveUrl(item);
          if (!url) return null;
          return {
            id: (item && item.id) || `${detail.markerId || "offline"}-image-${index}`,
            url,
            fileName: (item && item.fileName) || url
          };
        })
        .filter(Boolean);
    }
    if ((!detail.attachments || !detail.attachments.length) && Array.isArray(snapshot.attachments)) {
      detail.attachments = snapshot.attachments
        .map((item, index) => {
          const url = resolveUrl(item);
          if (!url) return null;
          const displayName =
            (item && (item.displayName || item.name || item.fileName)) ||
            url.split("/").pop() ||
            "附件";
          return {
            id: (item && item.id) || `${detail.markerId || "offline"}-attachment-${index}`,
            url,
            displayName,
            fileName: (item && (item.fileName || item.name)) || displayName
          };
        })
        .filter(Boolean);
    }
    if ((!detail.qrCodes || !detail.qrCodes.length) && Array.isArray(snapshot.qrCodes)) {
      detail.qrCodes = snapshot.qrCodes
        .map((item, index) => {
          const url = resolveUrl(item);
          if (!url) return null;
          return {
            id: (item && item.id) || `${detail.markerId || "offline"}-qr-${index}`,
            url,
            fileName: (item && (item.fileName || item.name)) || ""
          };
        })
        .filter(Boolean);
    }
    if ((!detail.honors || !detail.honors.length) && Array.isArray(snapshot.honors)) {
      detail.honors = snapshot.honors.slice();
    }
    if (!detail.description && snapshot.description) {
      detail.description = snapshot.description;
    }
    if (!detail.phone && snapshot.phone) {
      detail.phone = snapshot.phone;
    }
    if (!detail.locationText && snapshot.locationText) {
      detail.locationText = snapshot.locationText;
    }
    if (!detail.name && snapshot.name) {
      detail.name = snapshot.name;
    }
  },

  clearManualMarkers() {
    if (Array.isArray(this._manualMarkers) && this._manualMarkers.length) {
      this._manualMarkers = [];
      this.syncAllMarkers();
    }
  },

  openMarkerDetail(marker) {
    if (!marker) return;
    const detail = this.resolveMarkerDetail(marker);
    if (!detail) {
      wx.showToast({ title: "未找到商户信息", icon: "none" });
      return;
    }

    const viewDetail = cloneMarkerDetail(detail);
    this._lastMarkerDetail = viewDetail;
    if (this._markerDetailCloseTimer) {
      clearTimeout(this._markerDetailCloseTimer);
      this._markerDetailCloseTimer = null;
    }
    if (this._markerDetailExpandTimer) {
      clearTimeout(this._markerDetailExpandTimer);
      this._markerDetailExpandTimer = null;
    }
    this._markerDetailExpandLock = false;
    this.setData({
      markerDetailVisible: true,
      markerDetailClosing: false,
      markerDetailExpanding: false,
      markerDetail: viewDetail
    });
  },

  onMarkerTap(event) {
    const markerId = event?.detail?.markerId;
    const marker = this.findMarkerById(markerId);
    if (marker) {
      this.openMarkerDetail(marker);
    }
  },

  onMarkerCalloutTap(event) {
    const markerId = event?.detail?.markerId;
    const marker = this.findMarkerById(markerId);
    if (marker) {
      this.openMarkerDetail(marker);
    }
  },

  closeMarkerDetail(immediate = false) {
    if (!this.data.markerDetailVisible) return;
    if (this._markerDetailCloseTimer) {
      clearTimeout(this._markerDetailCloseTimer);
      this._markerDetailCloseTimer = null;
    }
    if (this._markerDetailExpandTimer) {
      clearTimeout(this._markerDetailExpandTimer);
      this._markerDetailExpandTimer = null;
    }
    this._markerDetailExpandLock = false;
    if (immediate) {
      this.setData({
        markerDetailVisible: false,
        markerDetailClosing: false,
        markerDetailExpanding: false,
        markerDetail: null
      });
      return;
    }
    this.setData({ markerDetailClosing: true });
    this._markerDetailCloseTimer = setTimeout(() => {
      this._markerDetailCloseTimer = null;
      this.setData({
        markerDetailVisible: false,
        markerDetailClosing: false,
        markerDetailExpanding: false,
        markerDetail: null
      });
    }, 200);
  },

  onMarkerDetailMaskTap() {
    this.closeMarkerDetail();
  },

  onMarkerDetailCloseTap() {
    this.closeMarkerDetail();
  },

  onMarkerDetailMoreTap() {
    this.triggerMarkerDetailExpand();
  },

  triggerMarkerDetailExpand() {
    const detail = this.data.markerDetail;
    if (!detail) return;
    if (this.data.markerDetailExpanding) return;
    if (this._markerDetailExpandLock) return;
    if (this._markerDetailExpandTimer) {
      clearTimeout(this._markerDetailExpandTimer);
      this._markerDetailExpandTimer = null;
    }
    this._markerDetailExpandLock = true;
    this.setData({ markerDetailExpanding: true });
    this._markerDetailExpandTimer = setTimeout(() => {
      this._markerDetailExpandTimer = null;
      this._markerDetailExpandLock = false;
      const currentDetail = this.data.markerDetail || detail;
      if (!currentDetail) {
        this.setData({ markerDetailExpanding: false });
        return;
      }
      const restored = cloneMarkerDetail(currentDetail);
      this._lastMarkerDetail = restored;
      this.openMarkerPage(restored);
      this.setData({ markerDetailExpanding: false });
    }, 220);
  },

  onMarkerDetailTouchStart(event) {
    const touch = event?.touches?.[0];
    if (!touch) return;
    this._markerDetailTouch = {
      startY: touch.clientY,
      lastY: touch.clientY,
      deltaY: 0,
      startTime: Date.now()
    };
  },

  onMarkerDetailTouchMove(event) {
    if (!this._markerDetailTouch) return;
    const touch = event?.touches?.[0];
    if (!touch) return;
    const deltaY = touch.clientY - this._markerDetailTouch.startY;
    this._markerDetailTouch.lastY = touch.clientY;
    this._markerDetailTouch.deltaY = deltaY;
  },

  onMarkerDetailTouchEnd() {
    const info = this._markerDetailTouch;
    this._markerDetailTouch = null;
    if (!info) return;
    const deltaY = info.deltaY || 0;
    const duration = Date.now() - info.startTime;
    if ((deltaY <= -80 && duration <= 600) || deltaY <= -140) {
      this.triggerMarkerDetailExpand();
    }
  },

  onMarkerDetailTouchCancel() {
    this._markerDetailTouch = null;
  },

  makePhoneCall(phone, options = {}) {
    const value = typeof phone === "string" ? phone.trim() : `${phone || ""}`.trim();
    const markerIdRaw = options.markerId !== undefined && options.markerId !== null ? `${options.markerId}` : "";
    const markerId = markerIdRaw.trim();
    if (!value) {
      wx.showToast({ title: "暂无联系电话", icon: "none" });
      return;
    }
    if (typeof wx?.makePhoneCall === "function") {
      wx.makePhoneCall({
        phoneNumber: value,
        success: () => {
          if (markerId) {
            this.incrementMarkerPhoneCallCount(markerId);
          }
        }
      });
      return;
    }
    if (typeof wx?.setClipboardData === "function") {
      wx.setClipboardData({
        data: value,
        success: () => {
          wx.showToast({ title: "号码已复制", icon: "none" });
        }
      });
      return;
    }
    wx.showToast({ title: "请手动拨打", icon: "none" });
  },

  openCallSheet(options = {}) {
    const phoneValue =
      typeof options.phone === "string"
        ? options.phone.trim()
        : `${options.phone || ""}`.trim();
    if (!phoneValue) {
      wx.showToast({ title: "暂无联系电话", icon: "none" });
      return;
    }
    const markerId =
      options.markerId !== undefined && options.markerId !== null
        ? `${options.markerId}`.trim()
        : "";
    const markerName = typeof options.name === "string" ? options.name : "";
    this.setData({
      callSheetVisible: true,
      callSheetPhone: phoneValue,
      callSheetMarkerId: markerId,
      callSheetMarkerName: markerName
    });
  },

  hideCallSheet() {
    if (!this.data.callSheetVisible) {
      return;
    }
    this.setData({
      callSheetVisible: false,
      callSheetPhone: "",
      callSheetMarkerId: "",
      callSheetMarkerName: ""
    });
  },

  onCallSheetConfirm() {
    const phone = this.data.callSheetPhone || "";
    const markerId = this.data.callSheetMarkerId || "";
    this.hideCallSheet();
    this.makePhoneCall(phone, { markerId });
  },

  onCallSheetCancel() {
    this.hideCallSheet();
  },

  onCallSheetMaskTap() {
    this.hideCallSheet();
  },

  incrementMarkerPhoneCallCount(markerId) {
    if (!markerId) {
      return;
    }
    incrementMarkerPhoneCall(markerId, {
      apiBase: this.getApiBase(),
      token: this.getAuthToken()
    }).catch((err) => {
      console.warn("Increment marker phone call failed", err);
    });
  },

  incrementMarkerExposureCount(markerId) {
    if (!markerId) {
      return;
    }
    incrementMarkerExposure(markerId, {
      apiBase: this.getApiBase(),
      token: this.getAuthToken()
    }).catch((err) => {
      console.warn("Increment marker exposure failed", err);
    });
  },

  pruneMarkerExposureCache(now = Date.now()) {
    if (!this._markerExposureCache || typeof this._markerExposureCache.forEach !== "function") {
      return;
    }
    const threshold = now - MARKER_EXPOSURE_CACHE_TTL;
    const staleKeys = [];
    this._markerExposureCache.forEach((timestamp, key) => {
      if (!Number.isFinite(timestamp) || timestamp < threshold) {
        staleKeys.push(key);
      }
    });
    staleKeys.forEach((key) => this._markerExposureCache.delete(key));
  },

  trackMarkerExposure(markers) {
    if (!Array.isArray(markers) || !markers.length) {
      return;
    }
    if (!this._markerExposureCache) {
      this._markerExposureCache = new Map();
    }
    const now = Date.now();
    this.pruneMarkerExposureCache(now);
    markers.forEach((marker) => {
      const detail = this.resolveMarkerDetail(marker);
      const candidateId =
        detail?.markerId ||
        detail?.id ||
        marker?.id ||
        marker?.extData?.id ||
        "";
      const markerId = typeof candidateId === "string" ? candidateId.trim() : `${candidateId || ""}`.trim();
      if (!markerId) {
        return;
      }
      if (markerId.startsWith("nearby-")) {
        return;
      }
      const lastExposure = this._markerExposureCache.get(markerId);
      if (Number.isFinite(lastExposure) && now - lastExposure < MARKER_EXPOSURE_CACHE_TTL) {
        return;
      }
      this._markerExposureCache.set(markerId, now);
      this.incrementMarkerExposureCount(markerId);
    });
  },

  openMarkerLocation(detail, overrides = {}) {
    const latitude = Number(overrides.latitude ?? detail?.latitude);
    const longitude = Number(overrides.longitude ?? detail?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      wx.showToast({ title: "暂无定位信息", icon: "none" });
      return;
    }
    const name = overrides.name || detail?.name || "商户位置";
    const address = overrides.address || detail?.locationText || "";
    if (typeof wx?.openLocation === "function") {
      wx.openLocation({
        latitude,
        longitude,
        name,
        address
      });
      return;
    }
    wx.showToast({ title: "当前环境不支持导航", icon: "none" });
  },

  onMarkerDetailCallTap(event) {
    const dataset = event?.currentTarget?.dataset || {};
    const phone = dataset.phone || this.data.markerDetail?.phone || "";
    const markerId =
      dataset.markerId ||
      this.data.markerDetail?.markerId ||
      this.data.markerDetail?.id ||
      "";
    const name = this.data.markerDetail?.name || "";
    this.openCallSheet({ phone, markerId, name });
  },

  onMarkerDetailNavigateTap(event) {
    const detail = this.data.markerDetail;
    if (!detail) return;
    const dataset = event?.currentTarget?.dataset || {};
    this.openMarkerLocation(detail, dataset);
  },

  openMarkerPage(detail) {
    if (!detail) return;
    if (this._markerPageCloseTimer) {
      clearTimeout(this._markerPageCloseTimer);
      this._markerPageCloseTimer = null;
    }
    if (this._restoreMarkerDetailTimer) {
      clearTimeout(this._restoreMarkerDetailTimer);
      this._restoreMarkerDetailTimer = null;
    }
    const pageDetail = cloneMarkerDetail(detail);
    this.normalizeMarkerPageDetail(pageDetail);
    this._lastMarkerDetail = pageDetail;
    const distanceText = this.buildMarkerDistanceText(pageDetail);
    this.setData({
      markerPageVisible: true,
      markerPageClosing: false,
      markerPageDetail: pageDetail,
      markerPageCurrentImage: 0,
      markerPageShareEnabled: this.isDetailSharable(pageDetail),
      markerPageDistanceText: distanceText
    });
    this._markerPageScrollTop = 0;
    this._markerPageTouch = null;
    this.closeMarkerDetail(true);
  },

  refreshMarkerPageDistance() {
    if (!this.data.markerPageVisible || !this.data.markerPageDetail) {
      return;
    }
    const distanceText = this.buildMarkerDistanceText(this.data.markerPageDetail);
    if (distanceText === this.data.markerPageDistanceText) {
      return;
    }
    this.setData({ markerPageDistanceText: distanceText });
  },

  buildMarkerDistanceText(detail) {
    const distance = this.computeMarkerDistance(detail);
    if (!Number.isFinite(distance) || distance < 0) {
      return "";
    }
    return formatDistanceText(distance);
  },

  normalizeMarkerPageDetail(detail = {}) {
    if (!detail || typeof detail !== "object") {
      return;
    }
    if (Array.isArray(detail.attachments) && detail.attachments.length) {
      const first = detail.attachments.find((item) => item && (item.url || item.fileName));
      if (first) {
        const normalized = Object.assign({}, first);
        normalized.displayName = ATTACHMENT_DISPLAY_LABEL;
        normalized.shortName = ATTACHMENT_DISPLAY_LABEL;
        if (!normalized.url && typeof normalized.fileName === "string" && normalized.fileName.trim()) {
          normalized.url = normalized.fileName.trim();
        }
        detail.attachments = [normalized];
        return;
      }
    }
    detail.attachments = [];
  },

  computeMarkerDistance(detail) {
    if (!detail) return NaN;
    const markerLat = Number(detail.latitude);
    const markerLng = Number(detail.longitude);
    if (!Number.isFinite(markerLat) || !Number.isFinite(markerLng)) {
      return NaN;
    }
    const location = this._lastKnownLocation;
    const userLat = Number(location?.latitude);
    const userLng = Number(location?.longitude);
    if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
      return NaN;
    }
    const userWgs = gcj02ToWgs84(userLng, userLat);
    const userLatWgs = Number.isFinite(userWgs?.lat) ? userWgs.lat : userLat;
    const userLngWgs = Number.isFinite(userWgs?.lng) ? userWgs.lng : userLng;
    const meters = computeGreatCircleDistance(
      { latitude: markerLat, longitude: markerLng },
      { latitude: userLatWgs, longitude: userLngWgs }
    );
    return Number.isFinite(meters) ? meters : NaN;
  },

  closeMarkerPage(options = {}) {
    const { restoreDetail = true } = options || {};
    if (!this.data.markerPageVisible) return;
    if (this._markerPageCloseTimer) {
      clearTimeout(this._markerPageCloseTimer);
      this._markerPageCloseTimer = null;
    }
    const finalize = () => {
      this._markerPageCloseTimer = null;
      this.setData({
        markerPageVisible: false,
        markerPageClosing: false,
        markerPageDetail: null,
        markerPageCurrentImage: 0,
        markerPageShareEnabled: true,
        markerPageDistanceText: ""
      });
      this._markerPageTouch = null;
      this._markerPageScrollTop = 0;
      if (restoreDetail) {
        this.scheduleRestoreMarkerDetail(80);
      }
    };
    this.setData({ markerPageClosing: true });
    this._markerPageCloseTimer = setTimeout(finalize, 240);
  },

  onMarkerPageMaskTap() {
    this.closeMarkerPage();
  },

  onMarkerPageSwiperChange(event) {
    const current = Number(event?.detail?.current);
    if (Number.isFinite(current)) {
      this.setData({ markerPageCurrentImage: current });
    }
  },

  onMarkerPageScroll(event) {
    const top = Number(event?.detail?.scrollTop);
    if (Number.isFinite(top)) {
      this._markerPageScrollTop = Math.max(0, top);
      return;
    }
    this._markerPageScrollTop = 0;
  },

  onMarkerPageTouchStart(event) {
    const touch = event?.touches?.[0];
    if (!touch) return;
    const canClose = (this._markerPageScrollTop || 0) <= MARKER_PAGE_SCROLL_TOP_THRESHOLD;
    this._markerPageTouch = {
      startY: touch.clientY,
      lastY: touch.clientY,
      deltaY: 0,
      startTime: Date.now(),
      canClose
    };
  },

  onMarkerPageTouchMove(event) {
    if (!this._markerPageTouch) return;
    const touch = event?.touches?.[0];
    if (!touch) return;
    const deltaY = touch.clientY - this._markerPageTouch.startY;
    if (
      !this._markerPageTouch.canClose &&
      (this._markerPageScrollTop || 0) <= MARKER_PAGE_SCROLL_TOP_THRESHOLD &&
      deltaY >= 0
    ) {
      // 已经滑到顶部，再次下拉触发关闭手势
      this._markerPageTouch.canClose = true;
      this._markerPageTouch.startY = touch.clientY;
      this._markerPageTouch.deltaY = 0;
      this._markerPageTouch.startTime = Date.now();
    }
    this._markerPageTouch.lastY = touch.clientY;
    this._markerPageTouch.deltaY = deltaY;
  },

  onMarkerPageTouchEnd() {
    const info = this._markerPageTouch;
    this._markerPageTouch = null;
    if (!info) return;
    if (!info.canClose) {
      return;
    }
    const deltaY = info.deltaY || 0;
    const duration = Date.now() - info.startTime;
    const fastSwipe =
      deltaY >= MARKER_PAGE_CLOSE_FAST_DISTANCE && duration <= MARKER_PAGE_CLOSE_FAST_DURATION;
    const longSwipe = deltaY >= MARKER_PAGE_CLOSE_DISTANCE;
    if (
      this._markerPageScrollTop <= MARKER_PAGE_SCROLL_TOP_THRESHOLD &&
      (fastSwipe || longSwipe)
    ) {
      this.closeMarkerPage();
    }
  },

  onMarkerPageTouchCancel() {
    this._markerPageTouch = null;
  },

  onMarkerPageAttachmentTap(event) {
    const url = event?.currentTarget?.dataset?.url;
    if (!url) {
      wx.showToast({ title: "附件不可用", icon: "none" });
      return;
    }
    wx.showLoading({ title: "下载中...", mask: true });
    wx.downloadFile({
      url,
      success: (res) => {
        const statusCode = Number(res?.statusCode);
        const filePath = res?.tempFilePath;
        if (statusCode === 200 && filePath) {
          if (typeof wx.openDocument === "function") {
            wx.openDocument({
              filePath,
              showMenu: true,
              success: () => wx.hideLoading(),
              fail: () => {
                wx.hideLoading();
                wx.showToast({ title: "打开失败", icon: "none" });
              }
            });
            return;
          }
          wx.hideLoading();
          wx.showToast({ title: "已下载", icon: "success" });
          return;
        }
        wx.hideLoading();
        wx.showToast({ title: "下载失败", icon: "none" });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: "下载失败", icon: "none" });
      }
    });
  },

  onMarkerPageVideoTap(event) {
    const dataset = event?.currentTarget?.dataset || {};
    const url = dataset.url || "";
    const finderUserName = dataset.finder || "";
    const activityId = dataset.activity || "";



    const proceed = () => {
      if (finderUserName && activityId && typeof wx?.openChannelsActivity === "function") {
        console.log("here is wx.openChannelsActivity", finderUserName, activityId)
        wx.openChannelsActivity({
          finderUserName, feedId: activityId,
          success: res => console.log('open ok', res),
          fail: err => {
            console.warn('open fail', err);
            // wx.showModal({ title: '打开失败', content: JSON.stringify(err) });
          },
          complete: res => console.log('open complete', res)
        });
        return;
      }
      if (finderUserName && typeof wx?.openChannelsUserProfile === "function") {
        wx.openChannelsUserProfile({ finderUserName });
        return;
      }
      if (activityId && typeof wx?.openChannelsActivity === "function") {
        wx.openChannelsActivity({ activityId });
        return;
      }
      if (url && /^https?:\/\//.test(url)) {
        if (/^https?:\/\/mp\.weixin\.qq\.com\//.test(url) && typeof wx?.navigateTo === "function") {
          wx.navigateTo({ url: `/pages/webview/index?url=${encodeURIComponent(url)}` });
          return;
        }
        if (typeof wx?.setClipboardData === "function") {
          wx.setClipboardData({
            data: url,
            success: () => {
              wx.showToast({ title: "链接已复制", icon: "none" });
            },
            fail: () => {
              wx.showToast({ title: "复制失败", icon: "none" });
            }
          });
        } else {
          wx.showToast({ title: "请复制链接访问", icon: "none" });
        }
        return;
      }
      wx.showToast({ title: "视频不可用", icon: "none" });
    };
    proceed();
  },

  onMarkerPageCallTap(event) {
    const dataset = event?.currentTarget?.dataset || {};
    const phone = dataset.phone || this.data.markerPageDetail?.phone || "";
    const markerId =
      dataset.markerId ||
      this.data.markerPageDetail?.markerId ||
      this.data.markerPageDetail?.id ||
      "";
    const name = this.data.markerPageDetail?.name || "";
    this.openCallSheet({ phone, markerId, name });
  },

  onMarkerPageNavigateTap(event) {
    const detail = this.data.markerPageDetail;
    if (!detail) return;
    const dataset = event?.currentTarget?.dataset || {};
    this.openMarkerLocation(detail, dataset);
  },

  getDetailReviewStatus(detail) {
    if (!detail) return "";
    return `${detail.reviewStatus || detail.raw?.reviewStatus || ""}`.trim().toUpperCase();
  },

  isDetailSharable(detail) {
    if (!detail || detail.shareDisabled) {
      return false;
    }
    return this.getDetailReviewStatus(detail) === "APPROVED";
  },

  showShareBlockedToast() {
    if (typeof wx?.showToast === "function") {
      wx.showToast({ title: "审核通过后才能分享", icon: "none" });
    }
  },

  onMarkerPageShareDisabledTap() {
    this.showShareBlockedToast();
  },

  getShareInviteCodeValue() {
    if (typeof getShareInviteCodeUtil !== "function") {
      return "";
    }
    try {
      return getShareInviteCodeUtil();
    } catch (err) {
      console.warn("getShareInviteCodeValue failed", err);
      return "";
    }
  },

  onShareAppMessage() {
    const detail = this._lastMarkerDetail;
    const inviteCode = this.getShareInviteCodeValue();
    const fallback = {
      title: "uom、大疆100%同步且可视化，还有低空智能体~",
      path: appendInviteCodeToPath("/pages/map/map", { inviteCode })
    };
    if (!detail) {
      return fallback;
    }
    if (!this.isDetailSharable(detail)) {
      this.showShareBlockedToast();
      return fallback;
    }
    const markerId = detail.markerId || detail.id || "";
    if (!markerId) {
      return fallback;
    }
    const shareTitle = detail.name;
    return {
      title: shareTitle,
      path: appendInviteCodeToPath(
        `/pages/map/map?fromShare=1&markerId=${encodeURIComponent(markerId)}`,
        { inviteCode }
      )
    };
  },

  onShareTimeline() {
    const detail = this._lastMarkerDetail;
    const inviteCode = this.getShareInviteCodeValue();
    const fallback = {
      title: "uom、大疆100%同步且可视化，还有低空智能体~",
      query: appendInviteCodeToQuery("", { inviteCode })
    };
    if (!detail) {
      return fallback;
    }
    if (!this.isDetailSharable(detail)) {
      this.showShareBlockedToast();
      return fallback;
    }
    const markerId = detail.markerId || detail.id || "";
    if (!markerId) {
      return fallback;
    }
    const query = appendInviteCodeToQuery(
      `markerId=${encodeURIComponent(markerId)}&fromShare=1`,
      { inviteCode }
    );
    return {
      title: fallback.title,
      query
    };
  },

  applyCustomMapStyle() {
    const styleId = this.data.customMapStyleId;
    if (!styleId) {
      return;
    }
    if (typeof wx !== "undefined" && typeof wx.setMapCustomStyle === "function") {
      wx.setMapCustomStyle({ styleId });
      return;
    }
    if (this.mapCtx && typeof this.mapCtx.setCustomMapStyle === "function") {
      this.mapCtx.setCustomMapStyle({ styleId });
    }
  },

  onShow() {
    if (this.data.activeTab !== "home") {
      this.setData({ activeTab: "home", showDashboardPanel: true });
      this.showDashboardPanel = true;
    }
    this.consumePendingMarkerFocus({ source: "show" });
  },

  onUnload() {
    if (this._fetchTimer) clearTimeout(this._fetchTimer);
    if (this._markersFetchTimer) clearTimeout(this._markersFetchTimer);
    if (this._nfzFetchTimer) clearTimeout(this._nfzFetchTimer);
    if (this._markerDetailCloseTimer) clearTimeout(this._markerDetailCloseTimer);
    if (this._markerPageCloseTimer) clearTimeout(this._markerPageCloseTimer);
    if (this._markerDetailExpandTimer) clearTimeout(this._markerDetailExpandTimer);
    if (this._restoreMarkerDetailTimer) clearTimeout(this._restoreMarkerDetailTimer);
    this._activeMarkersRequest = null;
    this._activeNoFlyRequest = null;
    this.clearMapOverlays();
  },

  scheduleRestoreMarkerDetail(delay = 0) {
    if (this._restoreMarkerDetailTimer) {
      clearTimeout(this._restoreMarkerDetailTimer);
      this._restoreMarkerDetailTimer = null;
    }
    const detail = this._lastMarkerDetail;
    if (!detail) return;
    this._restoreMarkerDetailTimer = setTimeout(() => {
      this._restoreMarkerDetailTimer = null;
      this.openMarkerDetail(detail);
    }, delay);
  },

  onKeywordInput(e) {
    const keyword = e.detail.value || "";
    this.setData({ keyword }, () => {
      if (!keyword.trim()) {
        if (this._suggestTimer) {
          clearTimeout(this._suggestTimer);
          this._suggestTimer = null;
        }
        this.setData({
          searchSuggestions: [],
          searchSuggestLoading: false,
          searchSuggestError: ""
        });
        return;
      }
      this.setData({
        searchSuggestLoading: true,
        searchSuggestError: "",
        searchSuggestions: []
      });
      this.scheduleSearchSuggest();
    });
  },

  onSearchConfirm() {
    this.performSearch();
  },

  onSearchTap() {
    this.performSearch();
  },

  onChatButtonTap() {
    this.showPlaceholderToast("您暂未获得低空智能体（Agent）体验特权");
  },

  onTemporaryZoneLinkTap(event) {
    const info = this.data.temporaryNoFlyZoneInfo;
    if (!info || !info.hasLink) {
      this.showPlaceholderToast("链接不可用");
      return;
    }
    const dataset = event?.currentTarget?.dataset || {};
    const articleUrl = dataset.link || info.link || "";
    const fallbackPath = dataset.path || info.linkPath || "";
    if (articleUrl && typeof wx.openOfficialAccountArticle === "function") {
      wx.openOfficialAccountArticle({
        url: articleUrl,
        fail: () => {
          this.openTemporaryZoneLinkFallback(fallbackPath);
        }
      });
      return;
    }
    this.openTemporaryZoneLinkFallback(fallbackPath);
  },

  openTemporaryZoneLinkFallback(path) {
    if (path && typeof wx.navigateTo === "function") {
      wx.navigateTo({ url: path });
      return;
    }
    this.showPlaceholderToast("链接不可用");
  },

  onMenuHomeTap() {
    if (this.data.activeTab !== "home") {
      this.setData({ activeTab: "home" });
    }
    this.showPlaceholderToast("已在首页");
  },

  onMenuProfileTap() {
    if (this.data.activeTab !== "profile") {
      this.setData({ activeTab: "profile" });
    }
    this.ensureProfileAuthenticated()
      .then(() => {
        if (typeof wx.navigateTo === "function") {
          wx.navigateTo({ url: "/pages/profile/profile" });
        }
      })
      .catch((err) => {
        this.setData({ activeTab: "home" });
        if (err && err.message === "user-cancel") {
          return;
        }
        if (err && err.message === "login-unavailable") {
          this.showPlaceholderToast("暂时无法打开我的页面");
        }
      });
  },

  onMarkerButtonTap() {
    if (this.hasAccessToken()) {
      this.openMarkersPage();
      return;
    }
    this.ensureProfileAuthenticated()
      .then(() => {
        this.openMarkersPage();
      })
      .catch((err) => {
        if (err && err.message === "user-cancel") {
          wx.showToast({ title: "已取消", icon: "none" });
          return;
        }
        if (err && err.message === "login-unavailable") {
          this.showPlaceholderToast("暂时无法打开标记页");
          return;
        }
        console.warn("登录失败", err);
        if (typeof wx.showToast === "function") {
          wx.showToast({ title: "登录失败，请稍后再试", icon: "none" });
        }
      });
  },

  openMarkersPage() {
    const updates = {};
    if (this.data.activeTab !== "profile") {
      updates.activeTab = "profile";
    }
    if (Object.keys(updates).length) {
      this.setData(updates);
    }
    if (typeof wx.navigateTo === "function") {
      wx.navigateTo({ url: "/pages/markers/index" });
    } else {
      this.showPlaceholderToast("当前版本暂不支持打开标记页");
    }
  },

  showPlaceholderToast(message) {
    console.log(`[placeholder] ${message}`);
    if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
      wx.showToast({ title: message, icon: "none" });
    }
  },

  applyNearbyMarkers(markers) {
    this._nearbyMarkers = Array.isArray(markers)
      ? markers.map((marker) => {
        if (marker && marker.extData && marker.extData.detail) {
          marker.extData = Object.assign({}, marker.extData, {
            detail: cloneMarkerDetail(marker.extData.detail)
          });
        }
        return marker;
      })
      : [];
    this.trackMarkerExposure(this._nearbyMarkers);
    this.syncAllMarkers();
  },

  applySearchMarkers(markers) {
    this._searchMarkers = Array.isArray(markers)
      ? markers.map((marker) => {
        if (marker && marker.extData && marker.extData.detail) {
          marker.extData = Object.assign({}, marker.extData, {
            detail: cloneMarkerDetail(marker.extData.detail)
          });
        }
        return marker;
      })
      : [];
    this.syncAllMarkers();
  },

  syncAllMarkers() {
    const nearby = Array.isArray(this._nearbyMarkers) ? this._nearbyMarkers : [];
    const search = Array.isArray(this._searchMarkers) ? this._searchMarkers : [];
    const manual = Array.isArray(this._manualMarkers) ? this._manualMarkers : [];
    const combined = manual.concat(nearby, search);
    this.setData({ markers: combined });
  },

  performSearch() {
    const keyword = this.data.keyword.trim();
    if (!keyword) return;
    wx.showLoading({ title: "Searching...", mask: true });
    let locationArgs = null;
    try {
      const centerWgs = gcj02ToWgs84(
        this.data.center.longitude,
        this.data.center.latitude
      );
      if (Number.isFinite(centerWgs?.lat) && Number.isFinite(centerWgs?.lng)) {
        locationArgs = {
          latitude: centerWgs.lat,
          longitude: centerWgs.lng
        };
      }
    } catch (err) {
      console.warn("Failed to convert center for search", err);
    }
    const markerPromise = settleWithValue(
      searchMarkers(keyword, {
        apiBase: this.getApiBase(),
        limit: MAX_SEARCH_RESULTS
      }),
      {
        defaultValue: [],
        onError: (err) => console.warn("Marker search failed", err)
      }
    );
    const placePromise = settleWithValue(
      locationArgs
        ? searchPlaces(keyword, locationArgs)
        : searchPlaces(keyword),
      {
        defaultValue: [],
        onError: (err) => console.warn("Search failed", err)
      }
    );
    Promise.all([markerPromise, placePromise])
      .then(([markerResult, placeResult]) => {
        const markerPayloads = (markerResult.value || [])
          .map((item, index) =>
            this.createMarkerSearchPayload(item, {
              fallbackId: `marker-search-${index}`
            })
          )
          .filter(Boolean);
        const markerMarkers = markerPayloads
          .map((payload) =>
            this.buildMarkerFromSearchPayload(payload, {
              source: "marker-search"
            })
          )
          .filter(Boolean);
        const remainingSlots = Math.max(
          0,
          MAX_SEARCH_RESULTS - markerMarkers.length
        );
        const qqMarkers = (placeResult.value || [])
          .map((poi, index) => this.buildQqSearchMarker(poi, index))
          .filter(Boolean)
          .slice(0, remainingSlots);
        const markers = markerMarkers.concat(qqMarkers);
        if (markers.length) {
          this.applySearchMarkers(markers);
          const points = markers.map((m) => ({
            latitude: m.latitude,
            longitude: m.longitude
          }));
          this.mapCtx.includePoints({
            points,
            padding: [60, 60, 60, 60]
          });
        } else {
          this.applySearchMarkers([]);
          const message =
            markerResult.ok && placeResult.ok
              ? "没有匹配的地点"
              : "搜索失败，请稍后重试";
          wx.showToast({ title: message, icon: "none" });
        }
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({
          searchSuggestions: [],
          searchSuggestLoading: false,
          searchSuggestError: ""
        });
      });
  },

  scheduleSearchSuggest() {
    if (this._suggestTimer) clearTimeout(this._suggestTimer);
    this._suggestTimer = setTimeout(() => {
      this._suggestTimer = null;
      this.fetchSearchSuggestions();
    }, 250);
  },

  fetchSearchSuggestions() {
    const keyword = this.data.keyword.trim();
    if (!keyword) {
      this.setData({
        searchSuggestions: [],
        searchSuggestLoading: false,
        searchSuggestError: ""
      });
      return;
    }
    const snapshot = keyword;
    let locationArgs = null;
    try {
      const centerWgs = gcj02ToWgs84(
        this.data.center.longitude,
        this.data.center.latitude
      );
      if (Number.isFinite(centerWgs?.lat) && Number.isFinite(centerWgs?.lng)) {
        locationArgs = {
          latitude: centerWgs.lat,
          longitude: centerWgs.lng
        };
      }
    } catch (err) {
      console.warn("Failed to convert center for suggestions", err);
    }
    const markerPromise = settleWithValue(
      searchMarkers(keyword, {
        apiBase: this.getApiBase(),
        limit: MAX_SEARCH_SUGGESTIONS
      }),
      {
        defaultValue: [],
        onError: (err) => console.warn("Marker suggest search failed", err)
      }
    );
    const placePromise = settleWithValue(
      locationArgs
        ? searchPlaces(keyword, locationArgs)
        : searchPlaces(keyword),
      {
        defaultValue: [],
        onError: (err) => console.warn("Suggest failed", err)
      }
    );
    Promise.all([markerPromise, placePromise]).then(
      ([markerResult, placeResult]) => {
        if (snapshot !== this.data.keyword.trim()) return;
        const markerPayloads = (markerResult.value || [])
          .map((item, index) =>
            this.createMarkerSearchPayload(item, {
              fallbackId: `marker-suggest-${index}`
            })
          )
          .filter(Boolean);
        const markerSuggestions = markerPayloads
          .map((payload) => this.buildMarkerSuggestionFromPayload(payload))
          .filter(Boolean)
          .slice(0, MAX_SEARCH_SUGGESTIONS);
        const remainingSlots = Math.max(
          0,
          MAX_SEARCH_SUGGESTIONS - markerSuggestions.length
        );
        const qqSuggestions = (placeResult.value || [])
          .map((poi, index) => this.buildQqSuggestion(poi, index))
          .filter(Boolean)
          .slice(0, remainingSlots);
        const suggestions = markerSuggestions.concat(qqSuggestions);
        const noResults = !suggestions.length;
        const nextError = noResults
          ? markerResult.ok && placeResult.ok
            ? "没有匹配的地点"
            : "提示获取失败，请稍后重试"
          : "";
        this.setData({
          searchSuggestions: suggestions,
          searchSuggestLoading: false,
          searchSuggestError: nextError
        });
      }
    );
  },

  onSuggestionTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const suggestion = this.data.searchSuggestions?.[idx];
    if (!suggestion) return;
    let marker = null;
    if (suggestion.source === "marker" && suggestion.markerPayload) {
      marker = this.buildMarkerFromSearchPayload(suggestion.markerPayload, {
        source: "marker-search"
      });
    } else if (suggestion.source === "qqmap" && suggestion.rawPoi) {
      marker = this.buildQqSearchMarker(suggestion.rawPoi, idx);
    }
    if (!marker) {
      const { latitude, longitude } = suggestion;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      marker = {
        id: Date.now(),
        latitude,
        longitude,
        title: suggestion.title,
        width: 24,
        height: 24
      };
      if (suggestion.address) {
        marker.callout = {
          content: `${suggestion.title}\n${suggestion.address}`,
          display: "ALWAYS",
          borderRadius: 4,
          padding: 4
        };
      }
    }
    if (
      !marker ||
      !Number.isFinite(marker.latitude) ||
      !Number.isFinite(marker.longitude)
    ) {
      return;
    }
    this.setData({
      keyword: suggestion.title,
      searchSuggestions: [],
      searchSuggestLoading: false,
      searchSuggestError: ""
    });
    this.applySearchMarkers([marker]);
    this.centerOnPoint(
      { latitude: marker.latitude, longitude: marker.longitude },
      15
    );
  },

  openDronePicker() {
    this.setData({
      dronePickerVisible: true,
      pendingDroneIndex: this.data.selectedDroneIndex
    });
  },

  closeDronePicker() {
    this.setData({
      dronePickerVisible: false,
      pendingDroneIndex: null
    });
  },

  onSelectDroneOption(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(idx)) return;
    this.setData({ pendingDroneIndex: idx });
  },

  confirmDronePicker() {
    const idx = this.data.pendingDroneIndex;
    if (typeof idx === "number" && idx >= 0) {
      this.applyDroneByIndex(idx);
    }
    this.closeDronePicker();
  },

  applyDroneByIndex(idx) {
    const bounded = Math.max(0, Math.min(DRONES.length - 1, idx));
    const drone = DRONES[bounded] || DRONES[0];
    this.setData({
      selectedDroneIndex: bounded,
      selectedDrone: drone.slug,
      selectedDroneName: drone.name
    });
    this.scheduleFetchDji(200, true);
  },

  onLocateTap() {
    this.ensureLocationPermission()
      .then(() => this.pullAndCenterLocation({ scaleMeters: LOCATE_SCALE_METERS, scale: 14 }))
      .catch(() => {
        wx.showToast({ title: "未授权定位权限", icon: "none" });
      });
  },

  requestInitialLocation() {
    return this.ensureLocationPermission()
      .then(() => this.pullAndCenterLocation({ silent: true }))
      .catch(() => {
        // 用户拒绝初始授权时不打扰，仍可手动定位
      })
      .finally(() => {
        this.markSharePermissionAttempted();
      });
  },

  pullAndCenterLocation(options = {}) {
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: true,
      highAccuracyExpireTime: 8000,
      success: (res) => {
        this._lastKnownLocation = {
          latitude: res.latitude,
          longitude: res.longitude
        };
        this.refreshMarkerPageDistance();
        let targetScale = null;
        if (typeof options.scaleMeters === "number" && options.scaleMeters > 0) {
          const computed = this.scaleForMeters(options.scaleMeters, res.latitude);
          if (Number.isFinite(computed)) {
            targetScale = computed;
          }
        }
        if (!Number.isFinite(targetScale)) {
          const fallbackScale = Object.prototype.hasOwnProperty.call(options, "scale")
            ? options.scale
            : this.data.scale;
          targetScale = clampMapScale(fallbackScale);
        }
        this.centerOnPoint(
          { latitude: res.latitude, longitude: res.longitude },
          targetScale,
          !!options.silent
        );
      },
      fail: (err) => {
        console.warn("getLocation fail", err);
        wx.showToast({ title: "定位失败，请在设置中开启定位权限", icon: "none" });
      }
    });
  },

  getApiBase() {
    const app = getApp ? getApp() : null;
    return (app && app.globalData && app.globalData.apiBase) || "";
  },

  normalizeMarkerDetail(raw = {}) {
    return normalizeMarkerDetailUtil(raw, { apiBase: this.getApiBase() });
  },

  composeMarkerDetail(raw = {}, marker = {}, overrides = {}) {
    const normalized = this.normalizeMarkerDetail(raw || {});
    const detail = { ...normalized };
    const source = overrides.source || marker?.extData?.source || "";
    const fallbackName =
      overrides.name ||
      normalized.name ||
      marker?.title ||
      marker?.name ||
      "";
    if (fallbackName && !detail.name) {
      detail.name = fallbackName;
    }
    const fallbackLocation =
      overrides.locationText ||
      normalized.locationText ||
      marker?.address ||
      marker?.locationText ||
      "";
    if (fallbackLocation && !detail.locationText) {
      detail.locationText = fallbackLocation;
    }
    const latitudeCandidates = [
      overrides.latitude,
      marker?.latitude,
      raw?.location?.latitude,
      raw?.location?.lat,
      raw?.latitude,
      raw?.lat,
      normalized.latitude,
      normalized.lat
    ];
    for (const candidate of latitudeCandidates) {
      const value = Number(candidate);
      if (Number.isFinite(value)) {
        detail.latitude = value;
        break;
      }
    }
    const longitudeCandidates = [
      overrides.longitude,
      marker?.longitude,
      raw?.location?.longitude,
      raw?.location?.lng,
      raw?.longitude,
      raw?.lng,
      normalized.longitude,
      normalized.lng
    ];
    for (const candidate of longitudeCandidates) {
      const value = Number(candidate);
      if (Number.isFinite(value)) {
        detail.longitude = value;
        break;
      }
    }
    const idCandidates = [
      overrides.id,
      raw?.id,
      marker?.id,
      normalized.id
    ];
    for (const candidate of idCandidates) {
      if (candidate !== undefined && candidate !== null && `${candidate}` !== "") {
        if (!detail.id) {
          detail.id = candidate;
        }
        detail.markerId = `${candidate}`;
        break;
      }
    }
    if (!detail.markerId) {
      detail.markerId = detail.id || "";
    }
    if (source) {
      detail.source = source;
    }
    if (!detail.raw) {
      detail.raw = raw;
    }
    return detail;
  },

  createMarkerSearchPayload(raw = {}, options = {}) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const detail = this.composeMarkerDetail(raw, {}, {
      source: options.source || "marker-search",
      id: raw.id,
      name: raw.name,
      locationText: raw.location?.text
    });
    const latitude = Number(detail.latitude);
    const longitude = Number(detail.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    const gcj = wgs84ToGcj02(longitude, latitude);
    const latGcj = Number.isFinite(gcj?.lat) ? gcj.lat : latitude;
    const lngGcj = Number.isFinite(gcj?.lng) ? gcj.lng : longitude;
    const markerId =
      detail.markerId ||
      detail.id ||
      options.fallbackId ||
      `marker-search-${Date.now()}`;
    const title =
      detail.name ||
      detail.locationText ||
      options.fallbackTitle ||
      "低空星球标记";
    const address = detail.locationText || "";
    return {
      markerId,
      title,
      address,
      latitude: latGcj,
      longitude: lngGcj,
      detail,
      raw
    };
  },

  buildMarkerSuggestionFromPayload(payload) {
    if (!payload) return null;
    if (
      !Number.isFinite(payload.latitude) ||
      !Number.isFinite(payload.longitude)
    ) {
      return null;
    }
    return {
      id: payload.markerId || `marker-result-${Date.now()}`,
      title: payload.title,
      address: payload.address,
      latitude: payload.latitude,
      longitude: payload.longitude,
      source: "marker",
      markerId: payload.markerId,
      markerPayload: payload
    };
  },

  buildMarkerFromSearchPayload(payload, options = {}) {
    if (
      !payload ||
      !Number.isFinite(payload.latitude) ||
      !Number.isFinite(payload.longitude)
    ) {
      return null;
    }
    const detail = payload.detail;
    if (!detail) return null;
    const markerTitle = payload.title || detail.name || "低空星球标记";
    const markerId =
      payload.markerId || options.fallbackId || `marker-search-${Date.now()}`;
    const marker = {
      id: markerId,
      latitude: payload.latitude,
      longitude: payload.longitude,
      title: markerTitle,
      iconPath: options.iconPath || "/assets/drone.png",
      width: options.width || 44,
      height: options.height || 44,
      extData: {
        source: options.source || detail.source || "marker-search",
        raw: payload.raw || detail.raw || detail,
        detail: cloneMarkerDetail(detail)
      }
    };
    const calloutContent = formatNearbyMarkerLabel(markerTitle);
    if (calloutContent) {
      marker.callout = {
        content: calloutContent,
        color: "rgba(0, 0, 0, 0.95)",
        fontSize: 14,
        fontWeight: "bold",
        display: "ALWAYS",
        borderRadius: 4,
        padding: 4
      };
    }
    return marker;
  },

  buildQqSuggestion(poi = {}, index = 0) {
    if (!poi || typeof poi !== "object") {
      return null;
    }
    const lat = Number(poi.location?.lat);
    const lng = Number(poi.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    const title = poi.title || "";
    const address = poi.address || poi.category || "";
    return {
      id: poi.id || poi.adcode || index,
      title,
      address,
      latitude: lat,
      longitude: lng,
      source: "qqmap",
      rawPoi: poi
    };
  },

  buildQqSearchMarker(poi = {}, index = 0) {
    const suggestion = this.buildQqSuggestion(poi, index);
    if (!suggestion) return null;
    const marker = {
      id: suggestion.id || `qq-${index}`,
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      title: suggestion.title,
      width: 24,
      height: 24
    };
    if (suggestion.address) {
      marker.callout = {
        content: `${suggestion.title}\n${suggestion.address}`,
        display: "ALWAYS",
        borderRadius: 4,
        padding: 4
      };
    }
    const rawDetail = {
      id: marker.id,
      name: suggestion.title,
      title: suggestion.title,
      address: suggestion.address,
      location: { text: suggestion.address }
    };
    const detail = this.composeMarkerDetail(rawDetail, marker, {
      source: "search",
      name: suggestion.title,
      locationText: suggestion.address,
      id: marker.id
    });
    marker.extData = Object.assign({}, marker.extData, {
      source: "search",
      raw: rawDetail,
      detail: cloneMarkerDetail(detail)
    });
    return marker;
  },

  resolveMarkerDetail(marker) {
    if (!marker) return null;
    const extDetail = marker?.extData?.detail;
    if (extDetail) {
      return this.composeMarkerDetail(extDetail.raw || extDetail, marker, {
        source: marker?.extData?.source,
        name: extDetail.name,
        locationText: extDetail.locationText,
        id: extDetail.markerId || extDetail.id
      });
    }
    const raw = (marker?.extData && marker.extData.raw) || marker;
    return this.composeMarkerDetail(raw, marker, {
      source: marker?.extData?.source
    });
  },

  getAuthToken() {
    const app = getApp ? getApp() : null;
    return (app && app.globalData && app.globalData.token) || "";
  },

  ensureProfileAuthenticated() {
    if (this.hasAccessToken()) {
      return Promise.resolve(this.loadStoredProfile());
    }
    const showLoading = typeof wx.showLoading === "function";
    const hideLoading = typeof wx.hideLoading === "function" ? () => wx.hideLoading() : () => { };
    const profile = this.loadStoredProfile() || {};
    if (showLoading) wx.showLoading({ title: "登录中...", mask: true });
    return this.ensureAccessToken({ profileOverride: profile })
      .then(() => {
        hideLoading();
        return profile;
      })
      .catch((err) => {
        hideLoading();
        throw err;
      });
  },

  hasAccessToken() {
    const app = getApp ? getApp() : null;
    if (app && app.globalData && app.globalData.token) {
      return true;
    }
    try {
      const token = wx.getStorageSync(ACCESS_TOKEN_STORAGE_KEY);
      if (token && typeof token === "string") {
        if (app && app.globalData) app.globalData.token = token;
        return true;
      }
    } catch (err) {
      console.warn("读取 accessToken 失败", err);
    }
    return false;
  },

  loadStoredProfile() {
    return loadStoredProfileUtil();
  },

  initializeSystemInfo() {
    if (this._pxPerRpx && this._pxPerRpx > 0) {
      return;
    }
    let width = 375;
    try {
      if (typeof wx !== "undefined" && typeof wx.getWindowInfo === "function") {
        const info = wx.getWindowInfo();
        if (info && info.windowWidth) {
          width = info.windowWidth;
        }
      }
    } catch (err) {
      console.warn("getWindowInfo failed", err);
    }
    this._pxPerRpx = width / 750;
    const pxPerRpx = this._pxPerRpx || 1;
    this._scaleBarBaseRpx = Math.max(30, Math.round(CSS_PIXELS_PER_CM / pxPerRpx));
  },

  updateScaleBar(context = {}) {
    const ctx = context && typeof context === "object" ? context : {};
    if (!this._pxPerRpx || this._pxPerRpx <= 0) {
      this.initializeSystemInfo();
    }
    const pxPerRpx = this._pxPerRpx || 1;
    const baseRpx = this._scaleBarBaseRpx || DEFAULT_SCALE_BAR_BASE_RPX;
    const pxWidth = baseRpx * pxPerRpx;
    const latitude =
      typeof ctx.latitude === "number"
        ? ctx.latitude
        : (this.data.center && typeof this.data.center.latitude === "number"
          ? this.data.center.latitude
          : DEFAULT_CENTER.latitude);
    const zoom = clampMapScale(
      Object.prototype.hasOwnProperty.call(ctx, "scale") ? ctx.scale : this.data.scale
    );
    const metersPerPixel = computeMetersPerPixel(latitude, zoom);
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
      return;
    }
    const rawMeters = metersPerPixel * pxWidth;
    const nice = pickScaleBarLength(rawMeters);
    const labelText = nice.label || formatScaleLabel(rawMeters);
    this._lastScaleBarMeters = Number.isFinite(nice?.length) && nice.length > 0 ? nice.length : rawMeters;
    this.setData({
      scaleBarVisible: true,
      scaleBarLabel: labelText,
      scaleBarWidthRpx: Math.max(30, Math.round(baseRpx))
    });
  },

  estimateScaleBarMeters(scale, latitude) {
    if (!this._pxPerRpx || this._pxPerRpx <= 0) {
      this.initializeSystemInfo();
    }
    const pxPerRpx = this._pxPerRpx || 1;
    const baseRpx = this._scaleBarBaseRpx || DEFAULT_SCALE_BAR_BASE_RPX;
    const pxWidth = pxPerRpx * baseRpx;
    if (!Number.isFinite(pxWidth) || pxWidth <= 0) return null;
    const latSource = typeof latitude === "number"
      ? latitude
      : (this.data.center && typeof this.data.center.latitude === "number"
        ? this.data.center.latitude
        : DEFAULT_CENTER.latitude);
    const lat = Math.max(-85, Math.min(85, Number(latSource) || 0));
    const metersPerPixel = computeMetersPerPixel(lat, clampMapScale(scale ?? this.data.scale));
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
    const rawMeters = metersPerPixel * pxWidth;
    const nice = pickScaleBarLength(rawMeters);
    if (Number.isFinite(nice?.length) && nice.length > 0) return nice.length;
    return rawMeters;
  },

  shouldFetchNearbyMarkers(scale, latitude) {
    const approxMeters = this.estimateScaleBarMeters(scale, latitude);
    if (Number.isFinite(approxMeters) && approxMeters >= MARKER_FETCH_SCALE_LIMIT_METERS) {
      return false;
    }
    return true;
  },

  queueRegionUpdateSkip(count = 1) {
    const inc = Number.isFinite(count) ? Math.max(1, Math.round(count)) : 1;
    const pending = Number.isFinite(this._pendingRegionUpdates) ? this._pendingRegionUpdates : 0;
    this._pendingRegionUpdates = pending + inc;
  },

  scaleForMeters(targetMeters, latitude) {
    if (!Number.isFinite(targetMeters) || targetMeters <= 0) return null;
    if (!this._pxPerRpx || this._pxPerRpx <= 0) {
      this.initializeSystemInfo();
    }
    const pxPerRpx = this._pxPerRpx || 1;
    const baseRpx = this._scaleBarBaseRpx || DEFAULT_SCALE_BAR_BASE_RPX;
    const pxWidth = pxPerRpx * baseRpx;
    if (!Number.isFinite(pxWidth) || pxWidth <= 0) return null;
    const latSource = typeof latitude === "number"
      ? latitude
      : (this.data.center && typeof this.data.center.latitude === "number"
        ? this.data.center.latitude
        : DEFAULT_CENTER.latitude);
    const lat = Math.max(-85, Math.min(85, Number(latSource) || 0));
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const metersPerPixel = targetMeters / pxWidth;
    if (!Number.isFinite(cosLat) || cosLat <= 0) return null;
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
    const ratio = (METERS_PER_PIXEL_BASE * cosLat) / metersPerPixel;
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    const zoom = Math.log2 ? Math.log2(ratio) : Math.log(ratio) / Math.log(2);
    if (!Number.isFinite(zoom)) return null;
    return clampMapScale(zoom);
  },

  centerOnPoint(point, scale = DEFAULT_MAP_SCALE, silent = false) {
    if (!point) return;
    this.queueRegionUpdateSkip(3);
    this._centerOverride = point;
    const targetScale = clampMapScale(scale);
    this.setData(
      {
        center: point,
        scale: targetScale
      },
      () => {
        this._currentBounds = null;
        this.refreshWmsOverlay(this.data.center, this.data.scale, this._lastRegion);
        this.updateScaleBar({ scale: targetScale, latitude: point.latitude });
        if (this._markersFetchTimer) {
          clearTimeout(this._markersFetchTimer);
          this._markersFetchTimer = null;
        }
        if (this._nfzFetchTimer) {
          clearTimeout(this._nfzFetchTimer);
          this._nfzFetchTimer = null;
        }
        if (this._fetchTimer) {
          clearTimeout(this._fetchTimer);
          this._fetchTimer = null;
        }
        const fetchOptions = {
          center: point,
          region: this._lastRegion,
          scale: targetScale,
          force: true
        };
        this.requestNearbyMarkers(fetchOptions);
        this.requestNearbyNoFlyZones(fetchOptions);
        this.requestDjiZones(true, point, this._lastRegion, targetScale);
        this.updateStatusPanel(this._lastAreas);
      }
    );
  },

  ensureLocationPermission() {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (res) => {
          const granted = !!(res.authSetting && res.authSetting["scope.userLocation"]);
          if (granted) {
            resolve();
            return;
          }
          this.authorizeLocation().then(resolve).catch(reject);
        },
        fail: reject
      });
    });
  },

  authorizeLocation() {
    return new Promise((resolve, reject) => {
      wx.authorize({
        scope: "scope.userLocation",
        success: () => resolve(),
        fail: () => {
          wx.openSetting({
            success: (st) => {
              const granted = !!(st.authSetting && st.authSetting["scope.userLocation"]);
              if (granted) resolve();
              else reject(new Error("permission-denied"));
            },
            fail: (err) => reject(err)
          });
        }
      });
    });
  },

  ensureAccessToken(options = {}) {
    if (this.hasAccessToken()) return Promise.resolve();
    if (this._ensureLoginPromise) return this._ensureLoginPromise;
    const app = getApp ? getApp() : null;
    if (!app || typeof app.loginWithProfile !== "function") {
      return Promise.reject(new Error("login-unavailable"));
    }
    const override = options && options.profileOverride;
    const profile = override || this.loadStoredProfile() || {};
    this._ensureLoginPromise = app.loginWithProfile(profile)
      .catch((err) => {
        throw err || new Error("login-failed");
      })
      .finally(() => {
        this._ensureLoginPromise = null;
      });
    return this._ensureLoginPromise;
  },

  onRegionChange(e) {
    if (e.type === "begin") {
      if (this._fetchTimer) clearTimeout(this._fetchTimer);
      if (this._markersFetchTimer) clearTimeout(this._markersFetchTimer);
      this._currentBounds = null;
      return;
    }
    if (e.type === "end") {
      const cause = e?.causedBy || e?.detail?.cause || e?.detail?.causedBy || "";
      if (this._pendingRegionUpdates > 0 && (!cause || cause === "update")) {
        this._pendingRegionUpdates = Math.max(0, this._pendingRegionUpdates - 1);
        return;
      }
      // 使用事件内的中心与范围，仅用于刷新覆盖物，避免 setData 改 center 造成回环抖动
      const region = e.detail && (e.detail.region || {
        northeast: e.detail.northeast,
        southwest: e.detail.southwest
      });
      const cl = e.detail && (e.detail.centerLocation || null);
      if (region && region.northeast && region.southwest && cl) {
        const newCenter = { latitude: cl.latitude, longitude: cl.longitude };
        this._centerOverride = newCenter;
        const prevScale = this.data.scale;
        const scale = clampMapScale(e.detail.scale || prevScale);
        const scaleChanged = scale !== prevScale;
        console.log("[map] regionchange scale", scale);
        this._lastRegion = region;
        const radius = this.computeRadius({ region });
        this._currentRadius = clampRadius(radius);
        this._currentBounds = this.buildBoundsRect(region, newCenter, this._currentRadius);
        const diffLat = Math.abs((this.data.center?.latitude || 0) - newCenter.latitude);
        const diffLng = Math.abs((this.data.center?.longitude || 0) - newCenter.longitude);
        const shouldSync = diffLat > 1e-5 || diffLng > 1e-5 || scale !== this.data.scale;
        const run = (forceRefresh) => {
          this.refreshWmsOverlay(newCenter, scale, region);
          this.requestDjiZones(forceRefresh, newCenter, region, scale);
          this.scheduleFetchMarkers(forceRefresh ? 0 : 200, {
            center: newCenter,
            region,
            scale,
            force: !!forceRefresh
          });
          this.scheduleFetchNoFlyZones(forceRefresh ? 0 : 200, {
            center: newCenter,
            region,
            scale,
            force: !!forceRefresh
          });
          this.updateStatusPanel(this._lastAreas);
        };
        const afterSync = () => {
          this.updateScaleBar({ scale, latitude: newCenter.latitude });
          run(scaleChanged);
        };
        if (shouldSync) {
          this.queueRegionUpdateSkip(1);
          this.setData({ center: newCenter, scale }, afterSync);
        } else {
          afterSync();
        }
        return;
      }
      // 兜底：取中心再刷新（少量机型可能无 centerLocation）
      this.updateCenterAndRadius(e.detail);
    }
  },

  onMapUpdated() { },

  updateCenterAndRadius(detail) {
    this.mapCtx.getCenterLocation({
      type: "gcj02",
      success: (res) => {
        const newCenter = {
          latitude: res.latitude,
          longitude: res.longitude
        };
        this._centerOverride = newCenter;
        const scale = clampMapScale(detail?.scale || this.data.scale);
        // cache region for WMS tiling
        this._lastRegion = detail?.region || null;
        const diffLat = Math.abs((this.data.center?.latitude || 0) - newCenter.latitude);
        const diffLng = Math.abs((this.data.center?.longitude || 0) - newCenter.longitude);
        const needSync = diffLat > 1e-5 || diffLng > 1e-5 || scale !== this.data.scale;
        const run = () => {
          const radius = this.computeRadius(detail);
          this._currentRadius = clampRadius(radius);
          this._currentBounds = this.buildBoundsRect(
            detail?.region,
            newCenter,
            this._currentRadius
          );
          this.refreshWmsOverlay(newCenter, scale, detail?.region);
          this.scheduleFetchMarkers(0, {
            center: newCenter,
            region: detail?.region,
            scale,
            force: true
          });
          this.scheduleFetchNoFlyZones(0, {
            center: newCenter,
            region: detail?.region,
            scale,
            force: true
          });
          this.scheduleFetchDji(300);
        };
        const afterUpdate = () => {
          this.updateScaleBar({ scale, latitude: newCenter.latitude });
          run();
          this.updateStatusPanel(this._lastAreas);
        };
        if (needSync) {
          this.queueRegionUpdateSkip(1);
          this.setData({ center: newCenter, scale }, afterUpdate);
        } else {
          afterUpdate();
        }
      }
    });
  },

  computeRadius(detail) {
    if (detail?.region) {
      const { northeast, southwest } = detail.region;
      if (northeast && southwest) {
        const diag = haversineMeters(
          northeast.latitude,
          northeast.longitude,
          southwest.latitude,
          southwest.longitude
        );
        return Math.max(MIN_FETCH_RADIUS, Math.min(MAX_FETCH_RADIUS, diag / 2));
      }
    }
    return clampRadius(DEFAULT_FETCH_RADIUS);
  },

  computeMarkerRadiusKm(context = {}) {
    const region = context?.region;
    if (region?.northeast && region?.southwest) {
      const { northeast, southwest } = region;
      const diag = haversineMeters(
        northeast.latitude,
        northeast.longitude,
        southwest.latitude,
        southwest.longitude
      );
      if (Number.isFinite(diag) && diag > 0) {
        const radiusKm = Math.max(0.1, diag / 2000);
        return Math.min(radiusKm, 200);
      }
    }
    const scale = clampMapScale(context?.scale || this.data.scale);
    const zoomFactor = Math.pow(2, Math.max(0, (18 - scale) / 1.3));
    return Math.max(0.1, Math.min(200, zoomFactor * 0.8));
  },

  scheduleFetchMarkers(delay = 0, options = {}) {
    if (this._markersFetchTimer) clearTimeout(this._markersFetchTimer);
    const ms = Math.max(0, Number(delay) || 0);
    this._markersFetchTimer = setTimeout(() => {
      this._markersFetchTimer = null;
      this.requestNearbyMarkers(options);
    }, ms);
  },

  scheduleFetchNoFlyZones(delay = 0, options = {}) {
    if (this._nfzFetchTimer) clearTimeout(this._nfzFetchTimer);
    const ms = Math.max(0, Number(delay) || 0);
    this._nfzFetchTimer = setTimeout(() => {
      this._nfzFetchTimer = null;
      this.requestNearbyNoFlyZones(options);
    }, ms);
  },

  scheduleFetchDji(delay = 300, force = false) {
    if (this._fetchTimer) clearTimeout(this._fetchTimer);
    this._fetchTimer = setTimeout(() => {
      this._fetchTimer = null;
      this.requestDjiZones(force);
    }, delay);
  },

  requestNearbyMarkers(options = {}) {
    const center = options?.center || this._centerOverride || this.data.center;
    if (!center) return;
    const scale = options?.scale || this.data.scale;
    const region = options?.region || this._lastRegion;
    if (!this.shouldFetchNearbyMarkers(scale, center.latitude)) {
      if (Array.isArray(this._nearbyMarkers) && this._nearbyMarkers.length) {
        this._nearbyMarkers = [];
        this.syncAllMarkers();
      }
      this._lastNearbyFetch = null;
      return;
    }
    const radiusKm = this.computeMarkerRadiusKm({ region, scale });
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) return;

    const wgs = gcj02ToWgs84(center.longitude, center.latitude);
    const latitude = Number.isFinite(wgs?.lat) ? wgs.lat : Number(center.latitude);
    const longitude = Number.isFinite(wgs?.lng) ? wgs.lng : Number(center.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    const prev = this._lastNearbyFetch || {};
    const moveMeters = haversineMeters(
      center.latitude,
      center.longitude,
      prev.latitude || 0,
      prev.longitude || 0
    );
    const radiusDiff = Math.abs((prev.radiusKm || 0) - radiusKm);
    const now = Date.now();
    const prevTimestamp = Number(prev.timestamp) || 0;
    const isStale = !prevTimestamp || now - prevTimestamp > 60000;
    if (!options.force && moveMeters < 50 && radiusDiff < 0.2 && !isStale) {
      return;
    }

    const requestId = now;
    this._activeMarkersRequest = requestId;

    fetchNearbyMarkers(
      {
        latitude,
        longitude,
        radiusInKilometers: radiusKm
      },
      {
        apiBase: this.getApiBase(),
        token: this.getAuthToken()
      }
    )
      .then((items = []) => {
        if (this._activeMarkersRequest !== requestId) return;
        const markerList = (Array.isArray(items) ? items : [])
          .map((item, index) => {
            const latValue = Number(
              item?.location?.latitude ??
              item?.location?.lat ??
              item?.latitude ??
              item?.lat
            );
            const lngValue = Number(
              item?.location?.longitude ??
              item?.location?.lng ??
              item?.longitude ??
              item?.lng
            );
            if (!Number.isFinite(latValue) || !Number.isFinite(lngValue)) return null;
            const gcj = wgs84ToGcj02(lngValue, latValue);
            const latitudeGcj = Number.isFinite(gcj?.lat) ? gcj.lat : latValue;
            const longitudeGcj = Number.isFinite(gcj?.lng) ? gcj.lng : lngValue;
            const name =
              (typeof item?.name === "string" && item.name) ||
              (typeof item?.title === "string" && item.title) ||
              (typeof item?.location?.text === "string" && item.location.text) ||
              "";
            const locationText =
              (typeof item?.location?.text === "string" && item.location.text) ||
              (typeof item?.address === "string" && item.address) ||
              (typeof item?.locationText === "string" && item.locationText) ||
              "";
            console.log("name,", name);
            const marker = {
              id: item?.id || `nearby-${index}`,
              latitude: latitudeGcj,
              longitude: longitudeGcj,
              title: name,
              iconPath: "/assets/drone.png",
              width: 40,
              height: 40
            };
            const calloutContent = formatNearbyMarkerLabel(name);
            if (calloutContent) {
              marker.callout = {
                content: calloutContent,
                color: "rgba(0, 0, 0, 0.95)",
                fontSize: 14,
                fontWeight: "bold",
                display: "ALWAYS",
                borderRadius: 4,
                padding: 4,
                // bgColor: "rgba(255, 255, 255, 0)"
              };
            }
            const detail = this.composeMarkerDetail(item, marker, {
              source: "nearby",
              name,
              locationText,
              latitude: latitudeGcj,
              longitude: longitudeGcj,
              id: item?.id || marker.id
            });
            marker.extData = Object.assign({}, marker.extData, {
              source: "nearby",
              raw: item,
              detail: cloneMarkerDetail(detail)
            });
            return marker;
          })
          .filter(Boolean);
        this.applyNearbyMarkers(markerList);
        this._lastNearbyFetch = {
          latitude: center.latitude,
          longitude: center.longitude,
          radiusKm,
          scale: clampMapScale(scale),
          timestamp: now
        };
      })
      .catch((err) => {
        console.warn("Fetch nearby markers failed", err);
      })
      .finally(() => {
        if (this._activeMarkersRequest === requestId) {
          this._activeMarkersRequest = null;
        }
      });
  },

  requestNearbyNoFlyZones(options = {}) {
    const center = options?.center || this._centerOverride || this.data.center;
    if (!center) return;
    const scale = options?.scale || this.data.scale;
    const region = options?.region || this._lastRegion;
    const radiusKm = this.computeMarkerRadiusKm({ region, scale });
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) return;

    const wgs = gcj02ToWgs84(center.longitude, center.latitude);
    const latitude = Number.isFinite(wgs?.lat) ? wgs.lat : Number(center.latitude);
    const longitude = Number.isFinite(wgs?.lng) ? wgs.lng : Number(center.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    const prev = this._lastNoFlyFetch || {};
    const moveMeters = haversineMeters(
      center.latitude,
      center.longitude,
      prev.latitude || 0,
      prev.longitude || 0
    );
    const radiusDiff = Math.abs((prev.radiusKm || 0) - radiusKm);
    const now = Date.now();
    const prevTimestamp = Number(prev.timestamp) || 0;
    const isStale = !prevTimestamp || now - prevTimestamp > 60000;
    if (!options.force && moveMeters < 50 && radiusDiff < 0.2 && !isStale) {
      return;
    }

    const requestId = now;
    this._activeNoFlyRequest = requestId;
    this._noFlyZonesError = null;

    fetchNearbyNoFlyZones(
      {
        latitude,
        longitude,
        radiusInKilometers: radiusKm
      },
      {
        apiBase: this.getApiBase()
      }
    )
      .then((zones = []) => {
        if (this._activeNoFlyRequest !== requestId) return;
        const items = Array.isArray(zones) ? zones : [];
        const graphics = buildNoFlyZoneGraphics(items);
        this._nfzPolygons = graphics.polygons || [];
        this._nfzCircles = graphics.circles || [];
        this._noFlyZoneShapes = graphics.shapes || [];
        this._noFlyZones = items;
        this._noFlyZonesReady = true;
        this._noFlyZonesError = null;
        this.updateOverlayGraphics();
        this.updateStatusPanel();
        this._lastNoFlyFetch = {
          latitude: center.latitude,
          longitude: center.longitude,
          radiusKm,
          scale: clampMapScale(scale),
          timestamp: now
        };
      })
      .catch((err) => {
        console.warn("Fetch no-fly zones failed", err);
        if (!this._noFlyZonesReady) {
          this._noFlyZoneShapes = [];
          this._noFlyZones = [];
          this._nfzPolygons = [];
          this._nfzCircles = [];
          this.updateOverlayGraphics();
        }
        this._noFlyZonesReady = true;
        this._noFlyZonesError = err || new Error("nfz-fetch-failed");
        this.updateStatusPanel();
      })
      .finally(() => {
        if (this._activeNoFlyRequest === requestId) {
          this._activeNoFlyRequest = null;
        }
      });
  },

  updateOverlayGraphics() {
    const polygons = [];
    const circles = [];
    if (Array.isArray(this._djiPolygons)) {
      polygons.push(...this._djiPolygons);
    }
    if (Array.isArray(this._nfzPolygons)) {
      polygons.push(...this._nfzPolygons);
    }
    if (Array.isArray(this._djiCircles)) {
      circles.push(...this._djiCircles);
    }
    if (Array.isArray(this._nfzCircles)) {
      circles.push(...this._nfzCircles);
    }
    this.setData({ polygons, circles });
  },

  requestDjiZones(force, centerOverride, regionOverride, scaleOverride) {
    const center = centerOverride || this.data.center;
    const radius = this._currentRadius || clampRadius(DEFAULT_FETCH_RADIUS);
    const prev = this._lastFetch || {};
    const moved =
      haversineMeters(
        center.latitude,
        center.longitude,
        prev.latitude || 0,
        prev.longitude || 0
      ) > 300;
    const radiusDiff = Math.abs((prev.radius || 0) - radius) > 500;
    const gcjRect = regionOverride
      ? this.buildBoundsRect(regionOverride, center, radius)
      : this.currentGcjRect();
    const rectChanged = prev.rect
      ? (
        Math.abs((gcjRect.ltlng || 0) - (prev.rect.ltlng || 0)) > 0.005 ||
        Math.abs((gcjRect.ltlat || 0) - (prev.rect.ltlat || 0)) > 0.005 ||
        Math.abs((gcjRect.rblng || 0) - (prev.rect.rblng || 0)) > 0.005 ||
        Math.abs((gcjRect.rblat || 0) - (prev.rect.rblat || 0)) > 0.005
      )
      : true;
    if (!force && !moved && !radiusDiff && !rectChanged) return;

    this.setData({ loadingDji: true, djiMsg: "" });
    if (!gcjRect) {
      this.setData({
        loadingDji: false,
        djiMsg: "正在获取地图范围，请稍后再试"
      });
      return;
    }
    const rect = this.gcjRectToWgs(gcjRect);
    if (!rect) {
      this.setData({
        loadingDji: false,
        djiMsg: "坐标转换失败，稍后重试"
      });
      return;
    }
    fetchDjiAreas({
      rect,
      levels: this.levelsParam(),
      drone: this.data.selectedDrone
    })
      .then((areas) => {
        console.log("areas", areas);
        const graphics = buildAreaGraphics(areas);
        this._lastAreas = areas;
        this.updateStatusPanel(areas);
        this._djiPolygons = graphics.polygons || [];
        this._djiCircles = graphics.circles || [];
        this.updateOverlayGraphics();
        this.setData({
          djiMsg: `已获取 ${areas.length} 个空域`
        });
        this._lastFetch = {
          latitude: center.latitude,
          longitude: center.longitude,
          radius,
          rect: gcjRect
        };
      })
      .catch((err) => {
        console.error("DJI geo fetch failed", err);
        this._lastAreas = null;
        this.updateStatusPanel(null);
        this.setData({
          djiMsg: "DJI 数据暂不可用"
        });
      })
      .finally(() => {
        this.setData({ loadingDji: false });
      });
  },

  updateStatusPanel(areas) {
    const resolved = typeof areas === "undefined" ? this._lastAreas : areas;
    const dji = this.describeDjiStatus(resolved);
    const uom = this.describeUomStatus();
    const temporary = this.describeTemporaryNoFlyStatus();
    this.setData({
      djiStatus: dji.status,
      djiStatusExtra: dji.extra,
      djiTone: dji.tone,
      djiColor: dji.color || "",
      uomStatus: uom.status,
      uomTone: uom.tone,
      temporaryNoFlyZoneInfo: temporary.zoneInfo,
      temporaryNoFlyText: temporary.text,
      temporaryNoFlyTone: temporary.tone
    });
  },

  describeDjiStatus(areas) {
    const fallback = { status: "暂无空域数据", extra: "", tone: "neutral", color: "" };
    if (typeof areas === "undefined") {
      return { status: "评估中", extra: "", tone: "neutral", color: "" };
    }
    if (areas === null) {
      return { status: "空域数据加载失败", extra: "", tone: "warn", color: "" };
    }
    if (!Array.isArray(areas) || !areas.length) {
      return { status: "不在限制区", extra: "", tone: "safe", color: "" };
    }
    const center = this._centerOverride || this.data.center;
    if (!center) return fallback;
    const wgs = gcj02ToWgs84(center.longitude, center.latitude);
    if (!wgs) return fallback;
    const hits = [];
    const visitArea = (area, parent, polygonOnly) => {
      if (!area) return;
      if (Array.isArray(area.sub_areas) && area.sub_areas.length) {
        area.sub_areas.forEach((sub) => visitArea(sub, area, true));
        return;
      }
      if (this.areaContainsWgsPoint(area, wgs.lng, wgs.lat, { polygonOnly })) {
        hits.push({ area, parent });
      }
    };
    areas.forEach((area) => visitArea(area, null, false));
    if (!hits.length) {
      return { status: "不在限制区", extra: "", tone: "safe", color: "" };
    }
    hits.sort((a, b) => this.severityRank(a.area) - this.severityRank(b.area));
    const target = hits[0];
    const extraParts = [];
    const areaName = target.area.name || target.area.title || target.parent?.name;
    const city = target.area.city || target.parent?.city;
    if (areaName) extraParts.push(areaName);
    if (city && city !== areaName) extraParts.push(city);
    const height = this.effectiveHeight(target.area, target.parent);
    if (typeof height === "number" && height > 0) {
      extraParts.push(`限高 ${Math.round(height)}m`);
    }
    const reason = target.area.reason || target.area.desc || target.area.description;
    if (reason) extraParts.push(reason);
    const normalizedLevel = this.normalizedAreaLevel(target.area);
    return {
      status: this.labelForArea(target.area, target.parent),
      extra: extraParts.join(" · "),
      tone: this.toneForLevel(normalizedLevel),
      color: this.colorForArea(target.area)
    };
  },

  describeTemporaryNoFlyStatus() {
    if (!this._noFlyZonesReady) {
      return { zoneInfo: null, text: "评估中", tone: "neutral" };
    }
    if (this._noFlyZonesError) {
      return { zoneInfo: null, text: "临时禁飞数据不可用", tone: "warn" };
    }
    const center = this._centerOverride || this.data.center;
    if (!center) {
      return { zoneInfo: null, text: "评估中", tone: "neutral" };
    }
    if (!Number.isFinite(center.longitude) || !Number.isFinite(center.latitude)) {
      return { zoneInfo: null, text: "评估中", tone: "neutral" };
    }
    const hit = this.findNoFlyZoneAtPoint(center.longitude, center.latitude);
    if (!hit) {
      return { zoneInfo: null, text: "无", tone: "safe" };
    }
    const rawName = typeof hit.zone?.name === "string" ? hit.zone.name.trim() : "";
    const name = rawName || "临时禁飞区";
    const displayName = formatTemporaryZoneLabel(name);
    const rawLink = typeof hit.zone?.wechatLink === "string" ? hit.zone.wechatLink.trim() : "";
    const validLink = /^https?:\/\/mp\.weixin\.qq\.com\//.test(rawLink) ? rawLink : "";
    const linkPath = validLink ? `/pages/webview/index?url=${encodeURIComponent(validLink)}` : "";
    const zoneInfo = {
      id: hit.zone?.id || "",
      name,
      displayName,
      hasLink: !!validLink,
      link: validLink,
      linkPath
    };
    return { zoneInfo, text: displayName, tone: "alert" };
  },

  describeUomStatus() {
    const currentScale = Number(this.data?.scale);
    // if (Number.isFinite(currentScale) && currentScale > 16) {
    //   return { status: "当前比例尺下不可见（请缩小地图）", tone: "warn" };
    // }
    const center = this._centerOverride || this.data.center;
    if (!center) {
      return { status: "评估中", tone: "neutral" };
    }
    const tile = this.findUomTileForPoint(center);
    if (!tile) {
      return { status: "非适飞空域", tone: "alert" };
    }
    const maskEntry = this._uomTileMasks?.get(tile.id);
    if (!maskEntry) {
      this.ensureUomMask(tile);
      return { status: "评估中", tone: "neutral" };
    }
    if (maskEntry.status === "pending") {
      return { status: "评估中", tone: "neutral" };
    }
    if (maskEntry.status === "unsupported") {
      const withinBounds = this.pointInBounds(center, tile.bounds);
      return withinBounds
        ? { status: UOM_SAFE_STATUS_TEXT, tone: "safe" }
        : { status: "非适飞空域", tone: "alert" };
    }
    if (maskEntry.status !== "ready" || !maskEntry.data) {
      return { status: "非适飞空域", tone: "alert" };
    }
    const covered = this.pointCoveredByUomMask(center, tile.bounds, maskEntry);
    return covered
      ? { status: UOM_SAFE_STATUS_TEXT, tone: "safe" }
      : { status: "非适飞空域", tone: "alert" };
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

  toneForLevel(level) {
    const normalized = Number(level);
    if (normalized === 2 || normalized === 1) return "alert";
    if (normalized === 6 || normalized === 3 || normalized === 4) return "warn";
    if (normalized === 7 || normalized === 10) return "neutral";
    return "safe";
  },

  levelsParam() {
    const cleaned = this.data.levelsInput
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    return cleaned.length ? cleaned.join(",") : DEFAULT_LEVELS_PARAM;
  },

  refreshWmsOverlay(centerOverride, scaleOverride, regionOverride) {
    const center = centerOverride || this.data.center;
    const scale = clampMapScale(scaleOverride || this.data.scale);
    if (scale < WMS_MIN_ZOOM || scale > WMS_MAX_ZOOM) {
      this.clearMapOverlays();
      this._currentWmsTiles = [];
      this.updateStatusPanel(this._lastAreas);
      return;
    }
    const overlays = buildWmsOverlay(
      { longitude: center.longitude, latitude: center.latitude },
      scale,
      regionOverride || this._lastRegion || null
    );
    this._currentWmsTiles = overlays;
    this.updateStatusPanel(this._lastAreas);
    overlays.forEach((tile) => this.ensureUomMask(tile));
    this.applyWmsOverlays(overlays);
  },

  applyWmsOverlays(tiles) {
    if (!this.mapCtx) return;
    const ctx = this.mapCtx;
    this._wmsOverlayMap = this._wmsOverlayMap || new Map();
    this._wmsOverlaySeed = this._wmsOverlaySeed || 0;
    const nextIds = new Set();
    (tiles || []).forEach((tile) => {
      if (tile && tile.id) nextIds.add(tile.id);
    });
    if (this._wmsOverlayMap.size) {
      for (const [tileId, handle] of Array.from(this._wmsOverlayMap.entries())) {
        if (!nextIds.has(tileId)) {
          ctx.removeGroundOverlay({
            id: handle.overlayId,
            fail: () => { }
          });
          this._wmsOverlayMap.delete(tileId);
        }
      }
    }
    (tiles || []).forEach((tile) => {
      if (!tile || !tile.id || !tile.bounds) return;
      const signature = this.tileSignature(tile);
      const existing = this._wmsOverlayMap.get(tile.id);
      if (existing && existing.signature === signature) {
        return;
      }
      if (existing) {
        ctx.removeGroundOverlay({
          id: existing.overlayId,
          fail: () => { }
        });
        this._wmsOverlayMap.delete(tile.id);
      }
      this._wmsOverlaySeed += 1;
      const overlayId = this._wmsOverlaySeed;
      const alpha = tile.alpha != null ? tile.alpha : (tile.opacity != null ? tile.opacity : 0.65);
      ctx.addGroundOverlay({
        id: overlayId,
        src: tile.src,
        bounds: tile.bounds,
        alpha,
        fail: (err) => {
          console.error("addGroundOverlay failed", tile.id, err);
          this._wmsOverlayMap.delete(tile.id);
        }
      });
      this._wmsOverlayMap.set(tile.id, { overlayId, signature });
    });
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

  clearMapOverlays() {
    this._wmsOverlayMap = this._wmsOverlayMap || new Map();
    if (this.mapCtx) {
      for (const [, handle] of this._wmsOverlayMap.entries()) {
        this.mapCtx.removeGroundOverlay({
          id: handle.overlayId,
          fail: () => { }
        });
      }
    }
    this._wmsOverlayMap.clear();
    this._currentWmsTiles = [];
    this.updateStatusPanel(this._lastAreas);
  },

  buildBoundsRect(region, center, radius) {
    if (typeof radius === "number" && Number.isFinite(radius)) {
      return this.circleRectFromCenter(center, radius);
    }
    if (region?.northeast && region?.southwest) {
      const { northeast, southwest } = region;
      return {
        ltlat: northeast.latitude,
        ltlng: southwest.longitude,
        rblat: southwest.latitude,
        rblng: northeast.longitude
      };
    }
    return this.circleRectFromCenter(center, radius);
  },

  circleRectFromCenter(center, radius) {
    if (!center) return null;
    const metersLat = 111320;
    const useRadius = clampRadius(radius || DEFAULT_FETCH_RADIUS);
    const latDelta = useRadius / metersLat;
    const cosLat = Math.cos((center.latitude * Math.PI) / 180);
    const metersLng = metersLat * Math.max(cosLat, 0.01);
    const lngDelta = useRadius / metersLng;
    const clampLat = (lat) => Math.max(-90, Math.min(90, lat));
    const clampLng = (lng) => {
      if (!isFinite(lng)) return 0;
      let val = lng;
      while (val > 180) val -= 360;
      while (val < -180) val += 360;
      return val;
    };
    return {
      ltlat: clampLat(center.latitude + latDelta),
      ltlng: clampLng(center.longitude - lngDelta),
      rblat: clampLat(center.latitude - latDelta),
      rblng: clampLng(center.longitude + lngDelta)
    };
  },

  currentGcjRect() {
    if (this._currentBounds) return this._currentBounds;
    const rect = this.circleRectFromCenter(
      this.data.center || DEFAULT_CENTER,
      this._currentRadius || DEFAULT_FETCH_RADIUS
    );
    this._currentBounds = rect;
    return rect;
  },

  gcjRectToWgs(rect) {
    if (!rect) return null;
    const leftTop = gcj02ToWgs84(rect.ltlng, rect.ltlat);
    const rightBottom = gcj02ToWgs84(rect.rblng, rect.rblat);
    if (!leftTop || !rightBottom) return null;
    return {
      ltlat: leftTop.lat,
      ltlng: leftTop.lng,
      rblat: rightBottom.lat,
      rblng: rightBottom.lng
    };
  },

  labelForArea(area, parent) {
    const level = this.normalizedAreaLevel(area);
    switch (level) {
      case 2: return "禁飞区";
      case 6: return "限高区";
      case 1: return "授权区";
      case 4: return "警示区";
      case 3: return "加强警示区";
      case 7: return "法规限制区";
      case 8: return "法规适飞区";
      case 10: return "风景示范区";
      default: return "空域限制";
    }
  },

  severityRank(area) {
    const level = this.normalizedAreaLevel(area);
    if (level === 2) return 0;
    if (level === 6) return 1;
    if (level === 1) return 2;
    if (level === 3) return 3;
    if (level === 4) return 4;
    if (level === 7) return 5;
    if (level === 10) return 6;
    if (level === 8) return 7;
    return 100;
  },

  effectiveHeight(area, parent) {
    if (typeof area.height === "number" && area.height > 0) return area.height;
    const fallback = parent && Array.isArray(parent.sub_areas)
      ? parent.sub_areas.find((sa) => this.sameGeometry(area, sa) && typeof sa.height === "number" && sa.height > 0)
      : null;
    return fallback ? fallback.height : null;
  },

  sameGeometry(a, b) {
    if (!a || !b) return false;
    return this.sameCircle(a, b) || this.samePolygon(a, b);
  },

  sameCircle(a, b) {
    const ar = Number(a.radius), br = Number(b.radius);
    if (!isFinite(ar) || !isFinite(br)) return false;
    const ax = Number(a.lng), ay = Number(a.lat);
    const bx = Number(b.lng), by = Number(b.lat);
    if (!isFinite(ax) || !isFinite(ay) || !isFinite(bx) || !isFinite(by)) return false;
    const near = (x, y, eps = 1e-5) => Math.abs(x - y) <= eps;
    return near(ar, br, 1) && near(ax, bx) && near(ay, by);
  },

  samePolygon(a, b) {
    const ap = a.polygon_points || a.points || a.polygon || a.geometry?.coordinates;
    const bp = b.polygon_points || b.points || b.polygon || b.geometry?.coordinates;
    if (!ap || !bp) return false;
    try {
      return JSON.stringify(ap) === JSON.stringify(bp);
    } catch (err) {
      return false;
    }
  },

  findNoFlyZoneAtPoint(lng, lat) {
    if (!Array.isArray(this._noFlyZoneShapes) || !this._noFlyZoneShapes.length) {
      return null;
    }
    for (const entry of this._noFlyZoneShapes) {
      if (!entry) continue;
      if (entry.type === "circle" && entry.center) {
        const radius = Number(entry.radius);
        if (!Number.isFinite(radius) || radius <= 0) continue;
        const dist = haversineMeters(lat, lng, Number(entry.center.lat), Number(entry.center.lng));
        if (Number.isFinite(dist) && dist <= radius) {
          return { zone: entry.zone, shape: entry };
        }
        continue;
      }
      if (entry.type === "polygon" && Array.isArray(entry.rings)) {
        for (const ring of entry.rings) {
          if (this.ringContains(ring, lng, lat)) {
            return { zone: entry.zone, shape: entry };
          }
        }
      }
    }
    return null;
  },

  areaContainsWgsPoint(area, lng, lat, options = {}) {
    if (!area) return false;
    const polygonOnly = !!options.polygonOnly;
    const poly = this.resolvePolygonCoords(area, polygonOnly);
    if (this.hasPolygonCoords(poly)) {
      return this.polygonPointsContain(poly, lng, lat);
    }
    return this.circleContainsArea(area, lng, lat);
  },

  resolvePolygonCoords(area, polygonOnly) {
    if (!area) return null;
    if (polygonOnly) return area.polygon_points;
    return area.polygon_points || area.points || area.polygon || (area.geometry && area.geometry.coordinates);
  },

  hasPolygonCoords(poly) {
    return Array.isArray(poly) && poly.length > 0;
  },

  polygonPointsContain(poly, lng, lat) {
    if (!this.hasPolygonCoords(poly)) return false;
    if (Array.isArray(poly[0]) && Array.isArray(poly[0][0]) && Array.isArray(poly[0][0][0])) {
      return poly.some((single) => {
        const outer = Array.isArray(single[0]) ? single[0] : single;
        const ring = Array.isArray(outer[0]) ? outer[0] : outer;
        return this.ringContains(ring, lng, lat);
      });
    }
    if (Array.isArray(poly[0]) && Array.isArray(poly[0][0])) {
      const ring = Array.isArray(poly[0]) ? poly[0] : poly;
      return this.ringContains(ring, lng, lat);
    }
    return this.ringContains(poly, lng, lat);
  },

  circleContainsArea(area, lng, lat) {
    if (!area) return false;
    const isCircleShape = area.shape === 0;
    const hasCircleParams = area.radius && area.lat && area.lng;
    if (!isCircleShape && !hasCircleParams) return false;
    const radius = Number(area.radius);
    const centerLng = Number(area.lng);
    const centerLat = Number(area.lat);
    if (!Number.isFinite(radius) || radius <= 0) return false;
    if (!Number.isFinite(centerLng) || !Number.isFinite(centerLat)) return false;
    const dist = haversineMeters(lat, lng, centerLat, centerLng);
    return Number.isFinite(dist) && dist <= radius;
  },

  ringContains(ring, lng, lat) {
    if (!Array.isArray(ring) || ring.length === 0) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = Number(ring[i][0]), yi = Number(ring[i][1]);
      const xj = Number(ring[j][0]), yj = Number(ring[j][1]);
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  },

  normalizedAreaLevel(area) {
    const level = Number(area?.level);
    if (!Number.isFinite(level)) return level;
    const color = this.normalizeHexColor(area?.color);
    if (color === "#979797" && level === 2) {
      return 6;
    }
    return level;
  },

  normalizeHexColor(hex) {
    if (typeof hex !== "string") return "";
    const trimmed = hex.trim();
    if (!trimmed) return "";
    const prefixed = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    return prefixed.toUpperCase();
  },

  colorForArea(area) {
    const level = this.normalizedAreaLevel(area);
    if (level === 6) {
      return "#FFFFFF";
    }
    const explicit = this.normalizeHexColor(area?.color);
    if (explicit) return explicit;
    return NFZ_CENTER_COLORS[level] || "#DE4329";
  },

  findUomTileForPoint(point) {
    if (!point || !Array.isArray(this._currentWmsTiles)) return null;
    for (const tile of this._currentWmsTiles) {
      if (this.pointInBounds(point, tile.bounds)) return tile;
    }
    return null;
  },

  ensureUomMask(tile) {
    if (!tile || !tile.id) return;
    if (!this._uomTileMasks) this._uomTileMasks = new Map();
    const cached = this._uomTileMasks.get(tile.id);
    if (cached && (cached.status === "ready" || cached.status === "pending")) return;
    if (!this._uomMaskSupported) {
      this._uomTileMasks.set(tile.id, { status: "unsupported" });
      return;
    }
    try {
      const canvas = wx.createOffscreenCanvas({ type: "2d", width: 256, height: 256 });
      const ctx = canvas.getContext("2d");
      const img = canvas.createImage();
      const entry = { status: "pending" };
      this._uomTileMasks.set(tile.id, entry);
      img.onload = () => {
        try {
          const w = img.width || 256;
          const h = img.height || 256;
          canvas.width = w;
          canvas.height = h;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          entry.status = "ready";
          entry.width = imageData.width;
          entry.height = imageData.height;
          entry.data = imageData.data;
          this.updateStatusPanel(this._lastAreas);
        } catch (err) {
          console.error("解析 UOM 瓦片失败", err);
          entry.status = "error";
        }
      };
      img.onerror = (err) => {
        console.error("加载 UOM 瓦片失败", err);
        const entry = this._uomTileMasks.get(tile.id);
        if (entry) entry.status = "error";
      };
      img.src = tile.src;
    } catch (err) {
      console.error("创建 UOM 蒙版失败", err);
      this._uomTileMasks.set(tile.id, { status: "error" });
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
});
