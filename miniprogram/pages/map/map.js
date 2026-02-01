const { fetchDrones } = require("../../utils/drones");
const { fetchDjiAreas, buildAreaGraphics } = require("../../utils/dji");
const { searchPlaces } = require("../../utils/search");
const {
  fetchNearbyMarkers,
  fetchMarkerDetail,
  incrementMarkerExposure,
  incrementMarkerPhoneCall,
  searchMarkers,
  buildFileDownloadUrl
} = require("../../utils/markers");
const { fetchNearbyPins, searchPins, incrementPinExposure, fetchPinDetail } = require("../../utils/pins");
const {
  normalizeMarkerDetail: normalizeMarkerDetailUtil
} = require("../../utils/marker-detail");
const { reverseGeocode } = require("../../utils/geocoder");
const {
  fetchNearbyNoFlyZones,
  buildNoFlyZoneGraphics
} = require("../../utils/no-fly-zones");
const { haversineMeters, clampRadius, gcj02ToWgs84, wgs84ToGcj02 } = require("../../utils/coords");
const {
  formatDistanceText,
  computeGreatCircleDistance
} = require("../../utils/distance");
const { QQMAP_KEY, QQMAP_CUSTOM_STYLE_ID } = require("../../utils/config");
const {
  loadStoredProfile: loadStoredProfileUtil,
  prepareAvatarForUpload
} = require("../../utils/profile");
const {
  appendInviteCodeToPath,
  appendInviteCodeToQuery,
  getShareInviteCode: getShareInviteCodeUtil
} = require("../../utils/share");
const { like, unlike, fetchLikeCount, fetchLikeStatus } = require("../../utils/likes");
const { joinWorkGroup } = require("../../utils/workGroups");
const {
  fetchMapLayerSettings,
  updateMapLayerSettings
} = require("../../utils/map-layer-settings");
const {
  fetchTemplateSettings,
  fetchSubscriptions,
  requestSubscribeMessageForTemplateIds,
  updateSubscriptions,
  fetchLatestSubscriptionPush,
  SUBSCRIPTION_TEMPLATE_ID,
  normalizeTemplateIds,
  extractAcceptedTemplateIdsFromWxSetting
} = require("../../utils/subscriptions");
const { REQUIRED_SUBSCRIPTION_TEMPLATE_IDS } = require("../../config/subscription-templates");
const { setSubscribeWaitOverlay } = require("../../utils/subscribe-wait");
const { fetchLatestItemVersion, updateLatestItemVersion, normalizeVersion } = require("../../utils/latest-items");

const DEFAULT_CENTER = {
  latitude: 39.908823,
  longitude: 116.39747
};

const DEFAULT_LEVELS_PARAM = "2,6,1,4,3,7,8,10";
const ACCESS_TOKEN_STORAGE_KEY = "accessToken";
const PENDING_INVITE_CODE_STORAGE_KEY = "pendingInviteCode";
const PANORAMA_DEMO_FILE = "ex.jpg";
const PANORAMA_FALLBACK_ASSET = "/assets/ex.jpg";
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
const MAP_MAX_SCALE = 18;
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
const MIN_CENTER_SYNC_METERS = 6;
const ADD_MINI_APP_SUPPRESS_SECONDS = 72 * 60 * 60;
const ADD_MINI_APP_CHECK_DELAY_MS = 2000;

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
  const chars = Array.from(trimmed);
  if (chars.length <= 7) {
    return chars.join("");
  }
  return `${chars.slice(0, 6).join("")}…`;
};

const buildMarkerNameCallout = (content, overrides = {}) => {
  if (!content) {
    return null;
  }
  return Object.assign(
    {
      content,
      color: "#111827",
      fontSize: 12,
      fontWeight: "bold",
      display: "ALWAYS",
      borderRadius: 5,
      padding: 6,
      borderColor: "#111827",
      borderWidth: 0.4
    },
    overrides
  );
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

const getWindowMetrics = () => {
  let windowInfo = {};
  let deviceInfo = {};
  if (typeof wx !== "undefined") {
    if (typeof wx.getWindowInfo === "function") {
      try {
        windowInfo = wx.getWindowInfo() || {};
      } catch (err) {
        windowInfo = {};
      }
    }
    if (typeof wx.getDeviceInfo === "function") {
      try {
        deviceInfo = wx.getDeviceInfo() || {};
      } catch (err) {
        deviceInfo = {};
      }
    }
  }
  const windowWidth = Number(windowInfo.windowWidth) || 375;
  const windowHeight = Number(windowInfo.windowHeight) || 667;
  const screenWidth = Number(windowInfo.screenWidth || deviceInfo.screenWidth) || windowWidth;
  const screenHeight = Number(windowInfo.screenHeight || deviceInfo.screenHeight) || windowHeight;
  const statusBarHeight = Number(windowInfo.statusBarHeight || deviceInfo.statusBarHeight) || 0;
  const platform = `${deviceInfo.platform || windowInfo.platform || ""}`.toLowerCase();
  const pixelRatio = Number(windowInfo.pixelRatio || deviceInfo.pixelRatio) || 1;
  return {
    windowWidth,
    windowHeight,
    screenWidth,
    screenHeight,
    statusBarHeight,
    platform,
    pixelRatio
  };
};

const applyMapStatusBarStyle = () => {
  if (typeof wx === "undefined" || typeof wx.setNavigationBarColor !== "function") {
    return;
  }
  wx.setNavigationBarColor({
    frontColor: "#000000",
    backgroundColor: "#ffffff",
    animation: { duration: 0, timingFunc: "linear" }
  });
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

const decodeMaybeURI = (text = "") => {
  if (typeof text !== "string") return "";
  let current = text.replace(/\+/g, " ");
  for (let i = 0; i < 3; i += 1) {
    try {
      if (/%[0-9a-fA-F]{2}/.test(current)) {
        const decoded = decodeURIComponent(current);
        if (decoded === current) break;
        current = decoded;
        continue;
      }
    } catch (err) {
      console.warn("decodeMaybeURI failed", err);
      break;
    }
    break;
  }
  return current;
};

const hasAllRequiredSubscriptions = (ids = []) => {
  const normalized = normalizeTemplateIds(ids);
  return REQUIRED_SUBSCRIPTION_TEMPLATE_IDS.every((id) => normalized.includes(id));
};

const resolvePanoramaSource = (apiBase) => {
  const candidate = buildFileDownloadUrl(PANORAMA_DEMO_FILE, { apiBase });
  if (!candidate) return PANORAMA_FALLBACK_ASSET;
  if (/^https?:\/\//.test(candidate) || candidate.startsWith("wxfile://")) {
    return candidate;
  }
  if (candidate.startsWith("/")) {
    return candidate;
  }
  return PANORAMA_FALLBACK_ASSET;
};

const isHttpUrl = (value) => /^https?:\/\//.test(value || "");

const downloadPanoramaWithRetry = (url, options = {}) =>
  new Promise((resolve, reject) => {
    let attempts = 0;
    const retryDelay = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : 1200;
    const attempt = () => {
      attempts += 1;
      wx.downloadFile({
        url,
        success: (res) => {
          const statusCode = Number(res?.statusCode);
          const filePath = res?.tempFilePath;
          if (statusCode === 200 && filePath) {
            resolve(filePath);
            return;
          }
          const err = new Error(`download-panorama-status-${statusCode || "unknown"}`);
          reject(err);
        },
        fail: (err) => {
          const msg = `${err?.errMsg || ""}`.toLowerCase();
          if (msg.includes("timeout") || msg.includes("time out")) {
            console.warn("panorama download timeout, retrying", { attempts, url });
            setTimeout(attempt, retryDelay);
            return;
          }
          reject(err || new Error("download-panorama-failed"));
        }
      });
    };
    attempt();
  });

const resolvePanoramaFilePath = (source) => {
  if (!source) return Promise.reject(new Error("missing-panorama-source"));
  if (isHttpUrl(source)) {
    return downloadPanoramaWithRetry(source);
  }
  return prepareAvatarForUpload(source);
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

const hasValidCoordinate = (lat, lng) =>
  Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

const formatCoordinateParts = (lat, lng) => {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
  const latText = latNum.toFixed(6);
  const lngText = lngNum.toFixed(6);
  return { lngText, latText };
};

const normalizeLaunchMarkerOptions = (options = {}) => {
  const normalized = {
    markerId: "",
    delayUntilPermission: false
  };
  if (!options || typeof options !== "object") {
    return normalized;
  }
  const candidateKeys = ["mId", "markerId", "markerID", "markId", "markID", "id"];
  for (const key of candidateKeys) {
    if (options[key] !== undefined && options[key] !== null) {
      const decoded = decodeParamValue(options[key]);
      if (decoded) {
        normalized.markerId = decoded;
        break;
      }
    }
  }
  const shareFlag = options.fs ?? options.fromShare ?? options.share ?? options.source;
  if (isTruthyFlag(shareFlag)) {
    normalized.delayUntilPermission = true;
  }
  const sceneParams = parseSceneParams(options.scene);
  const sceneMarkerId =
    sceneParams.mId ||
    sceneParams.markerId ||
    sceneParams.markerID ||
    sceneParams.markId ||
    sceneParams.markID;
  if (!normalized.markerId && sceneMarkerId) {
    normalized.markerId = decodeParamValue(sceneMarkerId);
  }
  if (!normalized.delayUntilPermission && sceneParams.fs) {
    normalized.delayUntilPermission = isTruthyFlag(sceneParams.fs);
  } else if (!normalized.delayUntilPermission && sceneParams.fromShare) {
    normalized.delayUntilPermission = isTruthyFlag(sceneParams.fromShare);
  } else if (!normalized.delayUntilPermission && sceneParams.share) {
    normalized.delayUntilPermission = isTruthyFlag(sceneParams.share);
  }
  if (typeof options.q === "string" && options.q.trim()) {
    const decoded = decodeParamValue(options.q);
    const queryIndex = decoded.indexOf("?");
    const queryString = queryIndex >= 0 ? decoded.slice(queryIndex + 1) : decoded;
    const qParams = parseSceneParams(queryString);
    const qMarkerId =
      qParams.mId ||
      qParams.markerId ||
      qParams.markerID ||
      qParams.markId ||
      qParams.markID;
    if (!normalized.markerId && qMarkerId) {
      normalized.markerId = decodeParamValue(qMarkerId);
    }
    if (!normalized.delayUntilPermission && qParams.fs) {
      normalized.delayUntilPermission = isTruthyFlag(qParams.fs);
    } else if (!normalized.delayUntilPermission && qParams.fromShare) {
      normalized.delayUntilPermission = isTruthyFlag(qParams.fromShare);
    } else if (!normalized.delayUntilPermission && qParams.share) {
      normalized.delayUntilPermission = isTruthyFlag(qParams.share);
    }
  }
  return normalized;
};

const normalizeLaunchPinOptions = (options = {}) => {
  const normalized = {
    pinId: "",
    delayUntilPermission: false
  };
  if (!options || typeof options !== "object") {
    return normalized;
  }
  const candidateKeys = ["pId", "pinId", "pinID", "id"];
  for (const key of candidateKeys) {
    if (options[key] !== undefined && options[key] !== null) {
      const decoded = decodeParamValue(options[key]);
      if (decoded) {
        normalized.pinId = decoded;
        break;
      }
    }
  }
  const shareFlag = options.fs ?? options.fromShare ?? options.share ?? options.source;
  if (isTruthyFlag(shareFlag)) {
    normalized.delayUntilPermission = true;
  }
  const sceneParams = parseSceneParams(options.scene);
  const scenePinId = sceneParams.pId || sceneParams.pinId || sceneParams.pinID;
  if (!normalized.pinId && scenePinId) {
    normalized.pinId = decodeParamValue(scenePinId);
  }
  if (!normalized.delayUntilPermission && sceneParams.fs) {
    normalized.delayUntilPermission = isTruthyFlag(sceneParams.fs);
  } else if (!normalized.delayUntilPermission && sceneParams.fromShare) {
    normalized.delayUntilPermission = isTruthyFlag(sceneParams.fromShare);
  } else if (!normalized.delayUntilPermission && sceneParams.share) {
    normalized.delayUntilPermission = isTruthyFlag(sceneParams.share);
  }
  if (typeof options.q === "string" && options.q.trim()) {
    const decoded = decodeParamValue(options.q);
    const queryIndex = decoded.indexOf("?");
    const queryString = queryIndex >= 0 ? decoded.slice(queryIndex + 1) : decoded;
    const qParams = parseSceneParams(queryString);
    const qPinId = qParams.pId || qParams.pinId || qParams.pinID;
    if (!normalized.pinId && qPinId) {
      normalized.pinId = decodeParamValue(qPinId);
    }
    if (!normalized.delayUntilPermission && qParams.fs) {
      normalized.delayUntilPermission = isTruthyFlag(qParams.fs);
    } else if (!normalized.delayUntilPermission && qParams.fromShare) {
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
    const candidate = source.ic ?? source.inviteCode ?? source.invitationCode;
    if (candidate === undefined || candidate === null) return "";
    return decodeParamValue(candidate);
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

const formatLikeCountDisplay = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return "0";
  if (num >= 1000) {
    const k = num / 1000;
    return `${Math.round(k * 10) / 10}k`;
  }
  return `${Math.floor(num)}`;
};

const extractWorkGroupInvite = (options = {}) => {
  const readFromObject = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    const invitationCode = decodeParamValue(obj.ic || obj.invitationCode || obj.inviteCode);
    const groupId = decodeParamValue(obj.groupId || obj.workGroupId);
    const groupName = decodeParamValue(obj.groupName);
    if (!invitationCode || !groupId) return null;
    return { invitationCode, groupId, groupName };
  };

  const direct = readFromObject(options);
  if (direct) return direct;
  if (options.query) {
    const fromQuery = readFromObject(options.query);
    if (fromQuery) return fromQuery;
  }
  const sceneParams = parseSceneParams(options.scene);
  const fromScene = readFromObject(sceneParams);
  if (fromScene) return fromScene;
  if (typeof options.q === "string" && options.q.trim()) {
    const decoded = decodeParamValue(options.q);
    const queryIndex = decoded.indexOf("?");
    const queryString = queryIndex >= 0 ? decoded.slice(queryIndex + 1) : decoded;
    const qParams = parseSceneParams(queryString);
    const fromQ = readFromObject(qParams);
    if (fromQ) return fromQ;
  }
  return null;
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
    statusBarHeight: 0,
    markers: [],
    polygons: [],
    circles: [],
    droneNames: [],
    droneCategories: [],
    droneCategoryItems: [],
    activeDroneCategoryIndex: 0,
    loadingDrones: true,
    droneListAvailable: true,
    dronePickerLabel: "加载中",
    selectedDroneIndex: -1,
    selectedDrone: "",
    selectedDroneName: "",
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
    uomTileWarningVisible: false,
    uomTileWarningDismissed: false,
    centerPinTitle: "",
    centerCoordinateLatText: "",
    centerCoordinateLngText: "",
    coordinateSystem: "gcj02",
    searchSuggestions: [],
    searchSuggestLoading: false,
    searchSuggestError: "",
    cityReportCenter: null,
    dronePickerVisible: false,
    pendingDroneIndex: null,
    showDashboardPanel: true,
    activeTab: "home",
    showProfileRedDot: false,
    showNewbieGiftEntry: false,
    newbieTaskBlockerVisible: false,
    addMiniAppBlockerVisible: false,
    mapBlockerVisible: false,
    showCheckinGuideMap: false,
    checkinGuideOverlayStyle: "",
    checkinGuideMask: {
      top: 0,
      left: 0,
      size: 0,
      rightLeft: 0,
      bottomTop: 0
    },
    showInviteGuideMap: false,
    inviteGuideOverlayStyle: "",
    inviteGuideMask: {
      top: 0,
      left: 0,
      size: 0,
      rightLeft: 0,
      bottomTop: 0
    },
    showSubscriptionBanner: false,
    subscriptionBannerLoading: false,
    showSubscribeWaitOverlay: false,
    subscriptionBannerTopRpx: 90,
    subscriptionBannerHeightRpx: 70,
    preflightBaseTopRpx: 120,
    preflightTopRpx: 120,
    markerDetailVisible: false,
    detailCard: null,
    markerDetailClosing: false,
    markerDetailExpanding: false,
    markerDetailAllowExpand: true,
    markerDetailCurrentImage: 0,
    markerLikeAnimating: false,
    markerLikeHoldLabel: "",
    markerLikeLabelType: "",
    markerLikeCount: 0,
    markerLiked: false,
    markerLikeTargetType: "",
    markerLikeTargetId: "",
    markerLikeCountDisplay: "",
    markerPageVisible: false,
    markerPageClosing: false,
    markerPageDetail: null,
    markerPageCurrentImage: 0,
    markerPageLikeCount: 0,
    markerPageLiked: false,
    markerPageLikeTargetType: "",
    markerPageLikeTargetId: "",
    markerPageLikeCountDisplay: "",
    markerPageLikeAnimating: false,
    markerPageLikeHoldLabel: "",
    markerPageLikeLabelType: "",
    markerPageLikeCount: 0,
    markerPageLiked: false,
    markerPageLikeTargetType: "",
    markerPageLikeTargetId: "",
    markerPageShareEnabled: true,
    markerPageIsPin: false,
    markerPageDistanceText: "",
    callSheetVisible: false,
    callSheetPhone: "",
    callSheetMarkerId: "",
    callSheetMarkerName: "",
    scaleBarVisible: false,
    scaleBarWidthRpx: DEFAULT_SCALE_BAR_BASE_RPX,
    scaleBarLabel: "",
    enableSatellite: false,
    mapLayerType: "standard",
    layerPanelVisible: false,
    layerPanelClosing: false,
    airBoardEnabled: true,
    temporaryNoFlyZoneEnabled: true,
    uomDivisionEnabled: true,
    djiNoFlyZoneEnabled: true,
    merchantMarkersEnabled: true,
    privateMarkersEnabled: false,
    groupSharingEnabled: false,
    platformCoConstructionEnabled: true,
    mapElementOptions: [
      { id: "uom", label: "uom划分", enabled: true },
      { id: "dji", label: "大疆划分", enabled: true },
      { id: "tempNoFly", label: "临时禁飞区", enabled: true },
      { id: "service", label: "商户服务", enabled: true },
      { id: "private", label: "私有标记", enabled: false },
      { id: "group", label: "小组共享", enabled: false },
      { id: "platform", label: "平台共建", enabled: true }
    ],
    mapLayerSettingsLoading: false,
    joinInvitePrompt: null,
    joinInviting: false,
    joinInviteLoginPending: false,
    shareWorkGroup: null
  },

  onLoad(options = {}) {
    applyMapStatusBarStyle();
    this.mapCtx = wx.createMapContext("main-map");
    this.applyCustomMapStyle();
    this.initializeSystemInfo();
    this._mapMarkerIdMap = new Map();
    this._mapMarkerIdSeq = 100000;
    this._fetchTimer = null;
    this._mapLayerSettingsLoaded = false;
    this._mapLayerAircraftModelWritten = false;
    this._pendingAircraftModel = "";
    this._markersFetchTimer = null;
    this._pinsFetchTimer = null;
    this._currentRadius = clampRadius(DEFAULT_FETCH_RADIUS);
    this._currentBounds = null;
    this._pendingRegionUpdates = 0;
    this._mapSkew = 0;
    this._mapRotate = 0;
    this._overlookSyncAvoidUntil = 0;
    this._isIOS = false;
    this._centerOverride = this.data.center;
    this._layerPanelCloseTimer = null;
    this._addMiniAppPopupChecking = false;
    this._addMiniAppPopupVisible = false;
    this._addMiniAppPopupCheckTimer = null;
    this._mapLayerSettings = null;
    this._uomPluginInitTimer = null;
    this._uomPluginInitialized = false;
    this._uomPluginInitLogged = false;
    this._djiPolygons = [];
    this._djiCircles = [];
    this._djiZonesReady = false;
    this._mapLayerSettingsInitPromise = null;
    this._nfzPolygons = [];
    this._nfzCircles = [];
    this._suggestTimer = null;
    this.prefetchSubscriptionLatest();
    this.setData({
      mapElementOptions: this.composeMapElementOptions({
        uomDivisionEnabled: this.data.uomDivisionEnabled,
        djiNoFlyZoneEnabled: this.data.djiNoFlyZoneEnabled,
        temporaryNoFlyZoneEnabled: this.data.temporaryNoFlyZoneEnabled,
        merchantMarkersEnabled: this.data.merchantMarkersEnabled,
        privateMarkersEnabled: this.data.privateMarkersEnabled,
        groupSharingEnabled: this.data.groupSharingEnabled,
        platformCoConstructionEnabled: this.data.platformCoConstructionEnabled
      })
    });
    this._droneList = [];
    this.loadDronesFromApi();
    this.bootstrapMapLayerSettings(true);
    this._markerExposureCache = new Map();
    this._pinExposureCache = new Map();
    this._activeMarkersRequest = null;
    this._lastNearbyFetch = null;
    this._activePinsRequest = null;
    this._lastNearbyPinFetch = null;
    this._activeNoFlyRequest = null;
    this._lastNoFlyFetch = null;
    this._noFlyZonesReady = false;
    this._noFlyZones = [];
    this._noFlyZonesError = null;
    this._noFlyZoneShapes = [];
    this._nfzFetchTimer = null;
    this._nearbyMarkers = [];
    this._nearbyPinsRaw = [];
    this._nearbyPinMarkers = [];
    this._nearbyPinPolygons = [];
    this._nearbyPinCircles = [];
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
    this._previewPolygons = [];
    this._previewCircles = [];
    this._previewMarker = null;
    this._previewPinId = null;
    this._lastKnownLocation = null;
    this._likeHoldTimers = { marker: null, markerPage: null };
    this._likeHoldFired = { marker: false, markerPage: false };
    this.requestInitialLocation();
    this.captureInviteCode(options);
    this.handleWorkGroupInviteOptions(options);
    this.initializeShareLaunch(options);
    this.initializePinShareLaunch(options);
    this.consumePendingMarkerFocus({ immediate: true });
    this.scheduleFetchDji(0);
    this.scheduleFetchMarkers(0, {
      center: this.data.center,
      scale: this.data.scale,
      force: true
    });
    this.scheduleFetchPins(0, {
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
    this.updateCenterPinIndicator();
    this.autoLoginOnLaunch();
    this.initSubscriptionBanner();

  },

  onReady() {
    this.ensureUomPluginReady();
  },

  ensureUomPluginReady(retry = 0) {
    if (this._uomPlugin && this._uomPluginInitialized) return;
    if (!this._uomPluginInitLogged) {
      console.log("[uom-plugin] init check");
      this._uomPluginInitLogged = true;
    }
    const plugin = this.selectComponent("#uom-plugin");
    if (plugin && typeof plugin.init === "function") {
      console.log("[uom-plugin] instance ready, init");
      plugin.init({
        mapCtx: this.mapCtx,
        center: this._centerOverride || this.data.center,
        centerPin: this._centerOverride || this.data.center,
        scale: this.data.scale,
        region: this._lastRegion,
        enabled: this.data.uomDivisionEnabled
      });
      this._uomPlugin = plugin;
      this._uomPluginInitialized = true;
      return;
    }
    if (retry === 0) {
      console.warn("[uom-plugin] instance not ready, retrying");
    }
    if (retry >= 10) {
      console.warn("[uom-plugin] init retries exhausted");
      return;
    }
    if (this._uomPluginInitTimer) clearTimeout(this._uomPluginInitTimer);
    const delay = retry === 0 ? 0 : Math.min(500, 80 * (retry + 1));
    this._uomPluginInitTimer = setTimeout(() => {
      this._uomPluginInitTimer = null;
      this.ensureUomPluginReady(retry + 1);
    }, delay);
  },

  ensureMapMarkerId(value) {
    if (Number.isFinite(value)) return Number(value);
    const text = value === undefined || value === null ? "" : `${value}`.trim();
    if (!text) {
      this._mapMarkerIdSeq += 1;
      return this._mapMarkerIdSeq;
    }
    const numeric = Number(text);
    if (Number.isFinite(numeric)) return numeric;
    if (!this._mapMarkerIdMap) {
      this._mapMarkerIdMap = new Map();
      this._mapMarkerIdSeq = 100000;
    }
    if (this._mapMarkerIdMap.has(text)) {
      return this._mapMarkerIdMap.get(text);
    }
    this._mapMarkerIdSeq += 1;
    const mapped = this._mapMarkerIdSeq;
    this._mapMarkerIdMap.set(text, mapped);
    return mapped;
  },

  normalizeMapMarkerId(marker) {
    if (!marker || typeof marker !== "object") return marker;
    const rawId =
      marker.id !== undefined && marker.id !== null
        ? marker.id
        : marker.markerId ?? marker.markerID;
    const mappedId = this.ensureMapMarkerId(rawId);
    marker.id = mappedId;
    return marker;
  },

  normalizeMapMarkerList(list) {
    if (!Array.isArray(list)) return list;
    list.forEach((marker) => this.normalizeMapMarkerId(marker));
    return list;
  },

  findMarkerById(markerId) {
    if (markerId === undefined || markerId === null) return null;
    const targetId = this.ensureMapMarkerId(markerId);
    const nearby = Array.isArray(this._nearbyMarkers) ? this._nearbyMarkers : [];
    const nearbyPins = Array.isArray(this._nearbyPinMarkers) ? this._nearbyPinMarkers : [];
    const search = Array.isArray(this._searchMarkers) ? this._searchMarkers : [];
    const preview = this._previewMarker ? [this._previewMarker] : [];
    const manual = Array.isArray(this._manualMarkers) ? this._manualMarkers : [];
    const combined = manual.concat(nearbyPins, nearby, search, preview);
    for (const marker of combined) {
      const currentId = this.ensureMapMarkerId(marker?.id ?? marker?.markerId ?? marker?.markerID);
      if (currentId === targetId) {
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

  consumePendingPinPreview() {
    const app = typeof getApp === "function" ? getApp() : null;
    if (!app || !app.globalData) return;
    const preview = app.globalData.pendingPinPreview;
    if (!preview) return;
    app.globalData.pendingPinPreview = null;
    this.applyPinPreview(preview);
  },

  applyPinPreview(payload = {}) {
    if (!payload || !payload.shape) return;
    this.clearPinPreview();
    this._previewPinId = payload.id || "";
    const center = this.computePinPreviewCenter(payload.shape, payload);
    const zone = this.buildPinPreviewZone(payload.shape);
    if (zone) {
      const graphics = buildNoFlyZoneGraphics([zone], { color: "#D3A05B" });
      this._previewPolygons = Array.isArray(graphics.polygons) ? graphics.polygons : [];
      this._previewCircles = Array.isArray(graphics.circles) ? graphics.circles : [];
    }
    const marker = this.buildPinPreviewMarker(payload);
    if (marker) {
      marker.extData = Object.assign({}, marker.extData, {
        source: "pin-preview",
        raw: payload
      });
      this._previewMarker = marker;
      if (!this._previewPinId) {
        this._previewPinId = marker.id || "";
      }
    }
    this.updateOverlayGraphics();
    this.syncAllMarkers();
    this.updateCenterPinIndicator();
    if (center) {
      this.centerOnPoint(center, clampMapScale(payload.zoom || 16));
    }
  },

  buildPinDetailFromPin(pin = {}) {
    const rawPin = pin.raw || pin;
    const coords = Array.isArray(rawPin.shape?.coordinates) ? rawPin.shape.coordinates : [];
    const normalizedCoords = coords
      .map((coord) => this.normalizePreviewCoordinate(coord))
      .filter(Boolean);
    const primary =
      normalizedCoords[0] ||
      this.normalizePreviewCoordinate(rawPin.location) ||
      this.normalizePreviewCoordinate({ latitude: rawPin.latitude, longitude: rawPin.longitude }) ||
      {};
    const apiBase = this.getApiBase();
    const normalized = this.normalizeMarkerDetail(rawPin);
    const pinIdValue = rawPin.pinIdNew ?? rawPin.pinId ?? rawPin.id ?? "";
    const pinId = pinIdValue !== undefined && pinIdValue !== null ? `${pinIdValue}` : "";
    const rawImages = Array.isArray(rawPin.images)
      ? rawPin.images
      : [];
    const images = rawImages
      .map((img, idx) => ({
        url: buildFileDownloadUrl(img, { apiBase }),
        id: `${pinId || rawPin.id || "pin"}-image-${idx}`
      }))
      .filter((img) => !!img.url);
    const pointCategory = `${rawPin.shape?.pointCategory || rawPin.shape?.pointcategory || ""}`.toUpperCase();
    const heightDisplay =
      Number.isFinite(normalized.height) && normalized.height > 0 ? `${Math.round(normalized.height)}m` : "";
    const nameBase = normalized.name || rawPin.name || rawPin.title || "自定义标记";
    const name =
      pointCategory === "TALL_BUILDING" && heightDisplay ? `${nameBase}·${heightDisplay}` : nameBase;
    const latCandidates = [primary.latitude, rawPin.location?.latitude, rawPin.latitude, normalized.latitude];
    const lngCandidates = [primary.longitude, rawPin.location?.longitude, rawPin.longitude, normalized.longitude];
    const latitude = latCandidates.find((v) => Number.isFinite(Number(v)));
    const longitude = lngCandidates.find((v) => Number.isFinite(Number(v)));
    const detail = {
      id: pinId,
      markerId: pinId,
      name,
      locationText: normalized.locationText || rawPin.location?.text || rawPin.address || "",
      latitude: Number.isFinite(Number(latitude)) ? Number(latitude) : undefined,
      longitude: Number.isFinite(Number(longitude)) ? Number(longitude) : undefined,
      description: normalized.description || rawPin.description || "",
      images: images.length ? images : normalized.images || [],
      creatorName: normalized.creatorName || rawPin.creatorName || "",
      raw: rawPin,
      source: "pin"
    };

    if (
      !detail.locationText &&
      Number.isFinite(Number(detail.latitude)) &&
      Number.isFinite(Number(detail.longitude))
    ) {
      this.lookupPinAddress(detail);
    }
    console.log("Built pin detail ->>", detail.latitude, detail.longitude);
    return detail;
  },

  ensurePinAddress(detail) {
    if (!detail || detail.source !== "pin") return;
    if (detail.locationText) return;
    const lat = Number(detail.latitude);
    const lng = Number(detail.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    this.requestPinAddress(lat, lng)
      .then((address) => {
        if (address) {
          this.applyPinAddress(detail.markerId || detail.id, address);
        }
      })
      .catch((err) => {
        console.warn("reverse geocode pin failed", err);
      });
  },

  clearPinPreview() {
    this._previewPolygons = [];
    this._previewCircles = [];
    this._previewMarker = null;
    this._previewPinId = null;
    this.updateOverlayGraphics();
    this.syncAllMarkers();
    this.updateCenterPinIndicator();
  },

  buildPinPreviewZone(shape = {}) {
    const type = `${shape.type || ""}`.toUpperCase();
    const coordinates = Array.isArray(shape.coordinates)
      ? shape.coordinates
        .map((coord) => this.normalizePreviewCoordinate(coord))
        .filter(Boolean)
      : [];
    if (!coordinates.length) return null;
    if (type === "CIRCLE") {
      const center = coordinates[0];
      const radiusKm = Number(shape.radius);
      if (!center || !Number.isFinite(radiusKm) || radiusKm <= 0) {
        return null;
      }
      return {
        type: "CIRCLE",
        circle: {
          latitude: center.latitude,
          longitude: center.longitude,
          radiusMeters: radiusKm * 1000
        }
      };
    }
    if (type === "LINE" || type === "PATH") {
      return {
        type: "PATH",
        coordinates,
        pathDistanceMeters: Number(shape.width) || 0
      };
    }
    return {
      type: "POLYGON",
      coordinates
    };
  },

  buildPinPreviewMarker(payload = {}) {
    const location = payload.location || {};
    const lat = Number(location.latitude);
    const lng = Number(location.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    const latitude = lat;
    const longitude = lng;
    const category = `${payload.shape?.pointCategory || ""}`.toUpperCase();
    const ICON_MAP = {
      GENERAL: "/assets/default.png",
      WARNING: "/assets/drone-warning.png",
      AERIAL_SHOT: "/assets/aerial.png",
      TAKEOFF_LANDING: "/assets/dock.png",
      TALL_BUILDING: "/assets/elevation.png"
    };
    const iconPath = ICON_MAP[category] || "/assets/default.png";
    const contentParts = [];
    const hasName = !!payload.name;
    const hasHeight = category === "TALL_BUILDING" && Number.isFinite(payload.height);
    if (hasName) {
      const formattedName = formatNearbyMarkerLabel(payload.name);
      if (formattedName) {
        contentParts.push(formattedName);
      }
    }
    if (hasHeight) {
      const hText = `${Math.round(payload.height)}米`;
      if (hasName) {
        contentParts.push(hText);
      } else {
        contentParts.push(`高程${hText}`);
      }
    }
    const content = contentParts.join(" ") || "标记位置";
    const callout = buildMarkerNameCallout(content, {
      fontSize: 10,
      fontWeight: "normal"
    });
    return {
      id: payload.id || `pin-preview-${Date.now()}`,
      latitude,
      longitude,
      iconPath,
      width: 32,
      height: 32,
      callout
    };
  },

  computePinPreviewCenter(shape = {}, payload = {}) {
    const location = payload.location;
    const coords = Array.isArray(shape.coordinates) ? shape.coordinates : [];
    const target = (location && hasValidCoordinate(location.latitude, location.longitude))
      ? location
      : coords.find((coord) => hasValidCoordinate(coord?.latitude, coord?.longitude));
    if (target && hasValidCoordinate(target.latitude, target.longitude)) {
      const latitude = Number(target.latitude);
      const longitude = Number(target.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude };
      }
    }
    if (coords.length) {
      const normalized = coords
        .map((coord) => this.normalizePreviewCoordinate(coord))
        .filter(Boolean);
      if (!normalized.length) return null;
      const avgLat = normalized.reduce((sum, item) => sum + item.latitude, 0) / normalized.length;
      const avgLng = normalized.reduce((sum, item) => sum + item.longitude, 0) / normalized.length;
      const latitude = avgLat;
      const longitude = avgLng;
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        return { latitude, longitude };
      }
    }
    return null;
  },

  normalizePreviewCoordinate(entry) {
    if (!entry) return null;
    if (Array.isArray(entry) && entry.length >= 2) {
      const lng = Number(entry[0]);
      const lat = Number(entry[1]);
      const alt = Number(entry[2]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const coord = { latitude: lat, longitude: lng };
      if (Number.isFinite(alt)) coord.altitude = alt;
      return coord;
    }
    const lat = Number(entry.latitude ?? entry.lat);
    const lng = Number(entry.longitude ?? entry.lng);
    const alt = Number(entry.altitude ?? entry.height ?? entry.alt);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const coord = { latitude: lat, longitude: lng };
    if (Number.isFinite(alt)) coord.altitude = alt;
    return coord;
  },

  lookupPinAddress(detail) {
    const lat = Number(detail?.latitude);
    const lng = Number(detail?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    this.requestPinAddress(lat, lng)
      .then((address) => {
        if (address) {
          this.applyPinAddress(detail.markerId || detail.id, address);
        }
      })
      .catch((err) => console.warn("lookupPinAddress failed", err));
  },

  extractAddressFromGeocode(res = {}) {
    return (
      res.recommend ||
      res.formatted_addresses?.recommend ||
      res.address ||
      res.formatted_address ||
      res.title ||
      ""
    );
  },

  requestPinAddress(lat, lng) {
    const attemptReverse = (latitude, longitude) =>
      reverseGeocode(latitude, longitude).then((res = {}) => this.extractAddressFromGeocode(res) || "");

    const wgs = gcj02ToWgs84(lng, lat);
    const hasWgs = Number.isFinite(wgs?.lat) && Number.isFinite(wgs?.lng);

    if (hasWgs) {
      return attemptReverse(wgs.lat, wgs.lng).then((addr) => {
        if (addr) return addr;
        return attemptReverse(lat, lng);
      });
    }
    return attemptReverse(lat, lng);
  },

  applyPinAddress(markerId, address) {
    if (!address) return;
    if (
      markerId &&
      this.data.detailCard &&
      (this.data.detailCard.markerId === markerId || this.data.detailCard.id === markerId)
    ) {
      this.setData({
        "detailCard.locationText": address
      });
    }
    if (
      markerId &&
      this.data.markerPageDetail &&
      (this.data.markerPageDetail.markerId === markerId || this.data.markerPageDetail.id === markerId)
    ) {
      this.setData({
        "markerPageDetail.locationText": address
      });
    }
  },

  fillPinSuggestionAddresses(suggestions = [], keywordSnapshot = "") {
    const list = Array.isArray(suggestions) ? suggestions : [];
    list.forEach((item, idx) => {
      if (item.source !== "pin") return;
      if (item.address) return;
      const lat = Number(item.latitude);
      const lng = Number(item.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      this.requestPinAddress(lat, lng)
        .then((addr) => {
          if (!addr) return;
          if (keywordSnapshot !== this.data.keyword.trim()) return;
          const patch = {};
          patch[`searchSuggestions[${idx}].address`] = addr;
          this.setData(patch);
        })
        .catch((err) => console.warn("pin suggest reverse geocode failed", err));
    });
  },

  autoLoginOnLaunch() {
    this.ensureAccessToken()
      .then(() => {
        wx.nextTick(() => {
          const popup = this.selectComponent("#newbie-task-popup");
          if (popup && typeof popup.loadTasks === "function") {
            popup.loadTasks();
          }
        });
      })
      .catch((err) => {
        console.warn("自动登录失败", err);
      });
  },

  initSubscriptionBanner() {
    this.evaluateSubscriptionBannerVisibility().catch((err) => {
      console.warn("initSubscriptionBanner failed", err);
    });
  },

  waitForSubscriptionSettingsReady() {
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && typeof app.syncSubscriptionsFromWxSetting === "function") {
      try {
        const promise = app.syncSubscriptionsFromWxSetting();
        if (promise && typeof promise.then === "function") {
          return promise.catch((err) => {
            console.warn("waitForSubscriptionSettingsReady failed", err);
            return { ids: [], mainSwitch: true };
          });
        }
      } catch (err) {
        console.warn("syncSubscriptionsFromWxSetting threw", err);
      }
    }
    if (app && app.globalData && Array.isArray(app.globalData.subscriptionAcceptedTemplateIds)) {
      return Promise.resolve({
        ids: app.globalData.subscriptionAcceptedTemplateIds,
        mainSwitch: app.globalData.subscriptionMainSwitch !== false
      });
    }
    return Promise.resolve({ ids: [], mainSwitch: true });
  },

  setGlobalSubscriptionIds(list = [], mainSwitch = true) {
    const app = typeof getApp === "function" ? getApp() : null;
    const normalized = normalizeTemplateIds(list);
    if (app && app.globalData) {
      app.globalData.subscriptionAcceptedTemplateIds = normalized;
      app.globalData.subscriptionSettingsReady = true;
      app.globalData.subscriptionMainSwitch = mainSwitch !== false;
    }
    return normalized;
  },

  setSubscriptionBannerVisibility(show) {
    const visible = !!show;
    this.setData({ showSubscriptionBanner: visible });
    this.updatePreflightOverlayTop(visible);
  },

  updatePreflightOverlayTop(showBanner = this.data.showSubscriptionBanner) {
    const bannerTop = Number(this.data.subscriptionBannerTopRpx) || 0;
    const bannerHeight = Number(this.data.subscriptionBannerHeightRpx) || 0;
    const baseTop = Number(this.data.preflightBaseTopRpx) || 120;
    const top = showBanner ? bannerTop + bannerHeight + 15 : baseTop;
    this.setData({ preflightTopRpx: top });
  },

  getSubscriptionMainSwitch() {
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) {
      return app.globalData.subscriptionMainSwitch !== false;
    }
    return true;
  },

  evaluateSubscriptionBannerVisibility() {
    return this.waitForSubscriptionSettingsReady()
      .then((payload = {}) => {
        const clientIds = Array.isArray(payload.ids) ? payload.ids : [];
        const mainSwitch = payload.mainSwitch !== false;
        const normalizedClient = this.setGlobalSubscriptionIds(clientIds, mainSwitch);
        // console.log("mainSwitch =", mainSwitch, "clientIds =", normalizedClient);
        if (!mainSwitch) {
          this.setSubscriptionBannerVisibility(true);
          return normalizedClient;
        }
        const apiBase = this.getApiBase();
        const token = this.getAuthToken();
        if (!apiBase || !token) {
          this.setSubscriptionBannerVisibility(!hasAllRequiredSubscriptions(normalizedClient));
          return normalizedClient;
        }
        return fetchSubscriptions({ apiBase, token })
          .then((serverIds) => {
            const normalized = this.setGlobalSubscriptionIds(serverIds, mainSwitch);
            this.setSubscriptionBannerVisibility(!hasAllRequiredSubscriptions(normalized));
            return normalized;
          })
          .catch((err) => {
            console.warn("evaluateSubscriptionBannerVisibility failed", err);
            this.setSubscriptionBannerVisibility(!hasAllRequiredSubscriptions(normalizedClient));
            return normalizedClient;
          });
      })
      .catch((err) => {
        console.warn("evaluateSubscriptionBannerVisibility outer failed", err);
        this.setSubscriptionBannerVisibility(false);
        return [];
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
    if (this._shareLaunchMarkerId && this._shareLaunchWaitForPermission && !this._shareLaunchPermissionSettled) {
      this._shareLaunchPermissionSettled = true;
      if (this._shareLaunchNeedAuthRetry) {
        this.retryShareMarkerDetailAfterAuth();
      } else {
        this.tryActivateShareMarker();
      }
    }
    if (this._sharePinLaunchId && this._sharePinWaitForPermission && !this._sharePinPermissionSettled) {
      this._sharePinPermissionSettled = true;
      if (this._sharePinNeedAuthRetry) {
        this.retrySharePinDetailAfterAuth();
      } else {
        this.tryActivateSharePin();
      }
    }
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
    const isApproved = this.isDetailApproved(detail);
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
      marker.callout = buildMarkerNameCallout(calloutContent);
    }
    return marker;
  },

  initializePinShareLaunch(options = {}) {
    this._sharePinLaunchId = "";
    this._sharePinWaitForPermission = false;
    this._sharePinPermissionSettled = true;
    this._sharePinHandled = false;
    this._sharePinDetail = null;
    this._sharePinError = null;
    this._sharePinFetchPromise = null;
    this._sharePinFetchSeq = 0;
    this._sharePinNeedAuthRetry = false;
    this._sharePinAuthPromise = null;
    const normalized = normalizeLaunchPinOptions(options);
    if (!normalized.pinId) {
      return;
    }
    this._sharePinLaunchId = normalized.pinId;
    this._sharePinWaitForPermission = !!normalized.delayUntilPermission;
    this._sharePinPermissionSettled = !this._sharePinWaitForPermission;
    this.fetchSharePinDetailById(normalized.pinId);
  },

  fetchSharePinDetailById(pinId, options = {}) {
    const id = `${pinId || ""}`.trim();
    if (!id) {
      return;
    }
    const allowRetry = options.allowRetry !== false;
    this._sharePinFetchSeq = (this._sharePinFetchSeq || 0) + 1;
    const seq = this._sharePinFetchSeq;
    const request = fetchPinDetail(id, {
      apiBase: this.getApiBase(),
      token: this.getAuthToken()
    });
    this._sharePinFetchPromise = request;
    request
      .then((detail) => {
        if (this._sharePinFetchPromise !== request || this._sharePinFetchSeq !== seq) {
          return;
        }
        this._sharePinFetchPromise = null;
        this._sharePinDetail = detail;
        this._sharePinError = null;
        this._sharePinNeedAuthRetry = false;
        this.tryActivateSharePin();
      })
      .catch((err) => {
        if (this._sharePinFetchPromise !== request || this._sharePinFetchSeq !== seq) {
          return;
        }
        this._sharePinFetchPromise = null;
        if (allowRetry && err && err.message === "missing-token") {
          this._sharePinNeedAuthRetry = true;
          this._sharePinDetail = null;
          this._sharePinError = null;
          if (this._sharePinPermissionSettled) {
            this.retrySharePinDetailAfterAuth();
          }
          return;
        }
        this._sharePinDetail = null;
        this._sharePinError = err || new Error("pin-detail-failed");
        this.tryActivateSharePin();
      });
  },

  retrySharePinDetailAfterAuth() {
    if (!this._sharePinLaunchId) {
      this.tryActivateSharePin();
      return;
    }
    const fetchAfterAuth = () => {
      if (!this._sharePinLaunchId || this._sharePinHandled) {
        this.tryActivateSharePin();
        return;
      }
      this._sharePinNeedAuthRetry = false;
      this.fetchSharePinDetailById(this._sharePinLaunchId, { allowRetry: false });
    };
    if (this.hasAccessToken()) {
      fetchAfterAuth();
      return;
    }
    if (this._sharePinAuthPromise) {
      return;
    }
    this._sharePinAuthPromise = this.ensureProfileAuthenticated()
      .then(() => {
        fetchAfterAuth();
      })
      .catch((err) => {
        this._sharePinError = err || new Error("login-failed");
        this.tryActivateSharePin();
      })
      .finally(() => {
        this._sharePinAuthPromise = null;
      });
  },

  tryActivateSharePin() {
    if (!this._sharePinLaunchId || this._sharePinHandled) {
      return;
    }
    if (!this._sharePinPermissionSettled) {
      return;
    }
    if (this._sharePinDetail) {
      const success = this.activateSharePinDetail(this._sharePinDetail);
      this._sharePinHandled = true;
      this._sharePinDetail = null;
      this._sharePinLaunchId = "";
      if (!success) {
        return;
      }
      return;
    }
    if (this._sharePinError) {
      this.handleSharePinError(this._sharePinError);
      this._sharePinHandled = true;
      this._sharePinLaunchId = "";
      this._sharePinError = null;
    }
  },

  handleSharePinError(err) {
    const message =
      err && err.message === "missing-token"
        ? "请先登录后查看标记信息"
        : "加载标记信息失败，请稍后再试";
    wx.showToast({ title: message, icon: "none" });
  },

  activateSharePinDetail(rawDetail) {
    const marker = this.buildSharePinFromDetail(rawDetail);
    if (!marker) {
      wx.showToast({ title: "标记信息异常", icon: "none" });
      return false;
    }
    const detail = marker?.extData?.detail || {};
    const isApproved = this.isDetailSharable(detail);
    // 分享只需要定位并打开详情，不强行重绘标记或覆盖列表
    this._previewPolygons = [];
    this._previewCircles = [];
    this.updateOverlayGraphics();
    this.centerOnPoint(
      { latitude: marker.latitude, longitude: marker.longitude },
      clampMapScale(16)
    );
    this.openMarkerPage(detail);
    return true;
  },

  buildSharePinFromDetail(rawDetail = {}) {
    if (!rawDetail) {
      return null;
    }
    const detail = this.buildPinDetailFromPin(rawDetail);
    if (!detail) {
      return null;
    }
    const latitude = Number(detail.latitude);
    const longitude = Number(detail.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    const markerName = detail.name || "空标记";
    const markerId = detail.markerId || detail.id || rawDetail.id || `pin-share-${Date.now()}`;
    const previewMarker =
      this.buildPinPreviewMarker({
        id: markerId,
        name: markerName,
        location: { latitude, longitude },
        shape: rawDetail.shape || detail.raw?.shape,
        height: rawDetail.height || rawDetail.altitude || detail.height
      }) || {};
    const marker = Object.assign(
      {
        id: markerId,
        latitude,
        longitude,
        iconPath: "/assets/default.png",
        width: 32,
        height: 32
      },
      previewMarker
    );
    marker.latitude = Number.isFinite(marker.latitude) ? marker.latitude : latitude;
    marker.longitude = Number.isFinite(marker.longitude) ? marker.longitude : longitude;
    if (!marker.callout || !marker.callout.content) {
      const calloutContent = formatNearbyMarkerLabel(markerName);
      if (calloutContent) {
        marker.callout = buildMarkerNameCallout(calloutContent);
      }
    }
    marker.extData = Object.assign({}, marker.extData, {
      source: "pin-share",
      raw: rawDetail,
      detail: cloneMarkerDetail(detail)
    });
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
      marker.callout = buildMarkerNameCallout(calloutContent);
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
    const isPin = (marker?.extData?.source || marker?.source || "").toLowerCase().includes("pin");
    const pinRaw = marker?.extData?.raw || marker?.raw || null;
    const pinDetail = isPin ? this.buildPinDetailFromPin(pinRaw || marker) : null;
    const detail = pinDetail || this.resolveMarkerDetail(marker);
    console.log("openMarkerDetail", marker, detail);
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
    console.log("Displaying marker detail", viewDetail);
    this.setData({
      markerDetailVisible: true,
      markerDetailClosing: false,
      markerDetailExpanding: false,
      detailCard: viewDetail,
      markerDetailAllowExpand: true,
      markerDetailCurrentImage: 0
    });
    this.loadMarkerLikeInfo({ detail: viewDetail, target: marker });
    if (isPin) {
      this.ensurePinAddress(viewDetail);
    }
  },

  onMarkerTap(event) {
    const markerId = event?.detail?.markerId;
    const marker = this.findMarkerById(markerId);
    if (!marker) return;
    const src = `${marker?.extData?.source || marker.source || ""}`.toLowerCase();
    if (src.includes("pin")) {
      const shapeType = `${marker?.extData?.raw?.shape?.type || marker?.shape?.type || ""}`.toUpperCase();
      if (shapeType && shapeType !== "POINT") return;
    }
    this.openMarkerDetail(marker);
  },

  onMarkerCalloutTap(event) {
    const markerId = event?.detail?.markerId;
    const marker = this.findMarkerById(markerId);
    if (!marker) return;
    const src = `${marker?.extData?.source || marker.source || ""}`.toLowerCase();
    if (src.includes("pin")) {
      const shapeType = `${marker?.extData?.raw?.shape?.type || marker?.shape?.type || ""}`.toUpperCase();
      if (shapeType && shapeType !== "POINT") return;
    }
    this.openMarkerDetail(marker);
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
        detailCard: null
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
        detailCard: null
      });
    }, 200);
  },

  onMarkerDetailMaskTap() {
    this.closeMarkerDetail();
  },

  onMarkerDetailMaskTouchMove() {
    // Stop marker detail gestures from reaching the map beneath
  },

  onMarkerDetailCloseTap() {
    this.closeMarkerDetail();
  },

  onMarkerDetailMoreTap() {
    this.triggerMarkerDetailExpand();
  },

  triggerMarkerDetailExpand() {
    const detail = this.data.detailCard;
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
      const currentDetail = this.data.detailCard || detail;
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
    if (!this.data.markerDetailAllowExpand) return;
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
    if (!this.data.markerDetailAllowExpand) return;
    if (!this._markerDetailTouch) return;
    const touch = event?.touches?.[0];
    if (!touch) return;
    const deltaY = touch.clientY - this._markerDetailTouch.startY;
    this._markerDetailTouch.lastY = touch.clientY;
    this._markerDetailTouch.deltaY = deltaY;
  },

  onMarkerDetailTouchEnd() {
    if (!this.data.markerDetailAllowExpand) return;
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
    if (!this.data.markerDetailAllowExpand) return;
    this._markerDetailTouch = null;
  },

  onMarkerDetailSwiperChange(e) {
    const idx = Number(e?.detail?.current);
    if (Number.isFinite(idx)) {
      this.setData({ markerDetailCurrentImage: idx });
    }
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

  incrementPinExposureCount(pinId) {
    if (!pinId) {
      return;
    }
    incrementPinExposure(pinId, {
      apiBase: this.getApiBase(),
      token: this.getAuthToken()
    }).catch((err) => {
      console.warn("Increment pin exposure failed", err);
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

  prunePinExposureCache(now = Date.now()) {
    if (!this._pinExposureCache || typeof this._pinExposureCache.forEach !== "function") {
      return;
    }
    const threshold = now - MARKER_EXPOSURE_CACHE_TTL;
    const staleKeys = [];
    this._pinExposureCache.forEach((timestamp, key) => {
      if (!Number.isFinite(timestamp) || timestamp < threshold) {
        staleKeys.push(key);
      }
    });
    staleKeys.forEach((key) => this._pinExposureCache.delete(key));
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
      const markerId = this.resolveMarkerNewId(detail, marker);
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
    const phone = dataset.phone || this.data.detailCard?.phone || "";
    const detail = this.data.detailCard || {};
    const markerId = this.resolveMarkerNewId(detail);
    const name = detail?.name || "";
    this.openCallSheet({ phone, markerId, name });
  },

  onMarkerDetailNavigateTap(event) {
    const detail = this.data.detailCard;
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
    // console.log("pageDetail->>", pageDetail)
    this.normalizeMarkerPageDetail(pageDetail);
    this._lastMarkerDetail = pageDetail;
    const isPin = this.isPinDetail(pageDetail);
    const distanceText = this.buildMarkerDistanceText(pageDetail);
    this.setData({
      markerPageVisible: true,
      markerPageClosing: false,
      markerPageDetail: pageDetail,
      markerPageCurrentImage: 0,
      markerPageShareEnabled: this.isDetailSharable(pageDetail),
      markerPageIsPin: isPin,
      markerPageDistanceText: distanceText
    });
    this.loadMarkerLikeInfo({ detail: pageDetail, target: detail, forPage: true });
    this._markerPageScrollTop = 0;
    this._markerPageTouch = null;
    this.closeMarkerDetail(true);
  },

  onMarkerPosterTap() {
    const detail = this.data.markerPageDetail || this._lastMarkerDetail;
    if (!detail) return;
    const raw = detail.raw || {};
    const targetValue = raw.markIdNew ?? detail.markIdNew ?? detail.markerId ?? detail.id ?? raw.id ?? "";
    const markerId = targetValue !== undefined && targetValue !== null ? `${targetValue}`.trim() : "";
    if (!markerId) {
      wx.showToast({ title: "暂无可用商户", icon: "none" });
      return;
    }
    wx.navigateTo({
      url: `/pages/markers/merchant-poster/index?mId=${encodeURIComponent(markerId)}`
    });
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
    const detail = this.data.markerPageDetail || {};
    const markerId = this.resolveMarkerNewId(detail);
    const name = detail?.name || "";
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
    return `${detail.reviewStatus || detail.raw?.reviewStatus || detail.raw?.status || ""}`.trim().toUpperCase();
  },

  isDetailApproved(detail) {
    const status = this.getDetailReviewStatus(detail);
    if (!status) return false;
    if (status === "APPROVED") return true;
    return status.startsWith("APPROVED");
  },

  isPinDetail(detail) {
    const source = `${detail?.source || detail?.raw?.source || ""}`.toLowerCase();
    if (source.includes("pin")) return true;
    if (detail?.raw && typeof detail.raw === "object" && detail.raw.shape) return true;
    return false;
  },

  isDetailSharable(detail) {
    if (!detail || detail.shareDisabled) {
      return false;
    }
    return this.isDetailApproved(detail);
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
    const posterUrl = buildFileDownloadUrl("main-page.png", { apiBase: this.getApiBase() });
    const fallback = {
      title: "与uom、大疆100%同步的低空地图，来一起探索~",
      path: appendInviteCodeToPath("/pages/map/map", { inviteCode }),
      imageUrl: posterUrl
    };
    if (!detail) {
      return fallback;
    }
    if (!this.isDetailSharable(detail)) {
      this.showShareBlockedToast();
      return fallback;
    }
    const rawDetail = detail?.raw || {};
    const isPinDetail = this.isPinDetail(detail);
    const targetValue = isPinDetail
      ? (rawDetail.pinIdNew ?? detail.pinIdNew ?? detail.markerId ?? detail.id ?? rawDetail.id ?? "")
      : (rawDetail.markIdNew ?? detail.markIdNew ?? detail.markerId ?? detail.id ?? rawDetail.id ?? "");
    const targetId = targetValue !== undefined && targetValue !== null ? `${targetValue}` : "";
    if (!targetId) {
      return fallback;
    }
    if (isPinDetail) {
      const shareTitle = detail.name;
      return {
        title: shareTitle,
        path: appendInviteCodeToPath(
          `/pages/map/map?fs=1&pId=${encodeURIComponent(targetId)}`,
          { inviteCode }
        )
      };
    }
    const shareTitle = detail.name;
    return {
      title: shareTitle,
      path: appendInviteCodeToPath(
        `/pages/map/map?fs=1&mId=${encodeURIComponent(targetId)}`,
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
    const rawDetail = detail?.raw || {};
    const isPinDetail = this.isPinDetail(detail);
    const targetValue = isPinDetail
      ? (rawDetail.pinIdNew ?? detail.pinIdNew ?? detail.markerId ?? detail.id ?? rawDetail.id ?? "")
      : (rawDetail.markIdNew ?? detail.markIdNew ?? detail.markerId ?? detail.id ?? rawDetail.id ?? "");
    const targetId = targetValue !== undefined && targetValue !== null ? `${targetValue}` : "";
    if (!targetId) {
      return fallback;
    }
    const queryBase = isPinDetail
      ? `pId=${encodeURIComponent(targetId)}&fs=1`
      : `mId=${encodeURIComponent(targetId)}&fs=1`;
    const query = appendInviteCodeToQuery(queryBase, { inviteCode });
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
    applyMapStatusBarStyle();
    if (this.data.activeTab !== "home") {
      this.setData({ activeTab: "home", showDashboardPanel: true });
      this.showDashboardPanel = true;
    }
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData && typeof app.globalData.subscriptionFeedHasUpdate === "boolean") {
      this.setData({ showProfileRedDot: app.globalData.subscriptionFeedHasUpdate });
    }
    this.evaluateSubscriptionBannerVisibility();
    if (this.data.joinInvitePrompt && !this.data.joinInviting) {
      this.promptJoinWorkGroup(this.data.joinInvitePrompt);
    }
    this.consumePendingMarkerFocus({ source: "show" });
    this.consumePendingPinPreview();
    this.updatePreflightOverlayTop(this.data.showSubscriptionBanner);
    if (app && app.globalData && app.globalData.checkinGuide?.active && app.globalData.checkinGuide.step === "map") {
      this.showCheckinGuideOnMap();
    } else if (this.data.showCheckinGuideMap) {
      this.setData({ showCheckinGuideMap: false });
    }
    if (app && app.globalData && app.globalData.inviteGuide?.active && app.globalData.inviteGuide.step === "map") {
      this.showInviteGuideOnMap();
    } else if (this.data.showInviteGuideMap) {
      this.setData({ showInviteGuideMap: false });
    }
    this.scheduleAddMiniAppPopupCheck("show");
  },

  onHide() {
    this.clearPinPreview();
  },

  noop() { },

  onUomStatusChange(event = {}) {
    const detail = event?.detail || {};
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(detail, "uomStatus")) {
      updates.uomStatus = detail.uomStatus;
    }
    if (Object.prototype.hasOwnProperty.call(detail, "uomTone")) {
      updates.uomTone = detail.uomTone;
    }
    if (Object.prototype.hasOwnProperty.call(detail, "uomTileWarningVisible")) {
      updates.uomTileWarningVisible = detail.uomTileWarningVisible;
    }
    if (Object.prototype.hasOwnProperty.call(detail, "uomTileWarningDismissed")) {
      updates.uomTileWarningDismissed = detail.uomTileWarningDismissed;
    }
    if (Object.keys(updates).length) {
      this.setData(updates);
    }
  },

  onCheckinGuideStart() {
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) {
      app.globalData.checkinGuide = { active: true, step: "map" };
    }
    this.showCheckinGuideOnMap();
  },

  onInviteGuideStart() {
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) {
      app.globalData.inviteGuide = { active: true, step: "map" };
    }
    this.showInviteGuideOnMap();
  },

  onGuideMaskTap() {
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) {
      if (app.globalData.checkinGuide?.active) {
        app.globalData.checkinGuide = { active: false, step: "" };
      }
      if (app.globalData.inviteGuide?.active) {
        app.globalData.inviteGuide = { active: false, step: "" };
      }
    }
    if (this.data.showCheckinGuideMap || this.data.showInviteGuideMap) {
      this.setData({
        showCheckinGuideMap: false,
        showInviteGuideMap: false,
        checkinGuideOverlayStyle: "",
        inviteGuideOverlayStyle: ""
      });
    }
  },

  showCheckinGuideOnMap() {
    if (this.data.showCheckinGuideMap) return;
    this.measureCheckinGuideTarget()
      .then((mask) => {
        if (!mask) return;
        const overlayStyle = this.buildGuideOverlayStyle(mask);
        this.setData({ showCheckinGuideMap: true, checkinGuideMask: mask, checkinGuideOverlayStyle: overlayStyle });
      })
      .catch((err) => {
        console.warn("measure checkin guide target failed", err);
      });
  },

  showInviteGuideOnMap() {
    if (this.data.showInviteGuideMap) return;
    this.measureInviteGuideTarget()
      .then((mask) => {
        if (!mask) return;
        const overlayStyle = this.buildGuideOverlayStyle(mask);
        this.setData({ showInviteGuideMap: true, inviteGuideMask: mask, inviteGuideOverlayStyle: overlayStyle });
      })
      .catch((err) => {
        console.warn("measure invite guide target failed", err);
      });
  },

  measureCheckinGuideTarget() {
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery().in(this);
      query.select("#menu-profile-btn").boundingClientRect();
      query.exec((res) => {
        const rect = res && res[0];
        if (!rect) {
          resolve(null);
          return;
        }
        const { windowWidth, windowHeight } = getWindowMetrics();
        const padding = 10;
        const size = Math.max(rect.width, rect.height) + padding * 2;
        const left = Math.max(0, rect.left + rect.width / 2 - size / 2);
        const top = Math.max(0, rect.top + rect.height / 2 - size / 2);
        const rightLeft = Math.min(windowWidth, left + size);
        const bottomTop = Math.min(windowHeight, top + size);
        resolve({
          top,
          left,
          size,
          rightLeft,
          bottomTop
        });
      });
    });
  },

  measureInviteGuideTarget() {
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery().in(this);
      query.select("#menu-profile-btn").boundingClientRect();
      query.exec((res) => {
        const rect = res && res[0];
        if (!rect) {
          resolve(null);
          return;
        }
        const { windowWidth, windowHeight } = getWindowMetrics();
        const padding = 10;
        const size = Math.max(rect.width, rect.height) + padding * 2;
        const left = Math.max(0, rect.left + rect.width / 2 - size / 2);
        const top = Math.max(0, rect.top + rect.height / 2 - size / 2);
        const rightLeft = Math.min(windowWidth, left + size);
        const bottomTop = Math.min(windowHeight, top + size);
        resolve({
          top,
          left,
          size,
          rightLeft,
          bottomTop
        });
      });
    });
  },

  buildGuideOverlayStyle(mask) {
    if (!mask) return "";
    const centerX = mask.left + mask.size / 2;
    const centerY = mask.top + mask.size / 2;
    const radius = Math.max(0, mask.size / 2 - 30);
    const edge = Math.max(2, Math.round(radius * 0.04));
    const clearRadius = radius + 1;
    return `background: radial-gradient(circle at ${centerX}px ${centerY}px, rgba(0,0,0,0) 0, rgba(0,0,0,0) ${clearRadius}px, rgba(0,0,0,0.6) ${clearRadius + edge}px);`;
  },

  onNewbieTaskStateChange(event) {
    const detail = event?.detail || {};
    this.setData({
      showNewbieGiftEntry: !!detail.showGiftEntry,
      newbieTaskBlockerVisible: !!detail.blockMap
    }, () => {
      this.updateMapBlockerVisible();
    });
  },

  onNewbieGiftTap() {
    const popup = this.selectComponent("#newbie-task-popup");
    if (popup && typeof popup.openFromEntry === "function") {
      popup.openFromEntry();
    }
  },

  onAddMiniAppStateChange(event) {
    const detail = event?.detail || {};
    this.setData({
      addMiniAppBlockerVisible: !!detail.blockMap
    }, () => {
      this.updateMapBlockerVisible();
    });
  },

  updateMapBlockerVisible() {
    const blocked = !!(this.data.newbieTaskBlockerVisible || this.data.addMiniAppBlockerVisible);
    if (this.data.mapBlockerVisible !== blocked) {
      this.setData({ mapBlockerVisible: blocked });
    }
  },

  scheduleAddMiniAppPopupCheck() {
    if (this._addMiniAppPopupCheckTimer) {
      clearTimeout(this._addMiniAppPopupCheckTimer);
    }
    this._addMiniAppPopupCheckTimer = setTimeout(() => {
      this._addMiniAppPopupCheckTimer = null;
      this.maybeShowAddMiniAppPopup();
    }, ADD_MINI_APP_CHECK_DELAY_MS);
  },

  shouldShowAddMiniAppPopup() {
    if (!this._mapLayerSettingsLoaded) return false;
    const lastClosedAt = Number(this._mapLayerSettings?.miniProgramAddedAt) || 0;
    if (!lastClosedAt) return true;
    const nowSec = Math.floor(Date.now() / 1000);
    if (lastClosedAt > nowSec) return false;
    return nowSec - lastClosedAt >= ADD_MINI_APP_SUPPRESS_SECONDS;
  },

  canShowAddMiniAppPopup() {
    const app = typeof getApp === "function" ? getApp() : null;
    const guideActive = !!(app?.globalData?.checkinGuide?.active || app?.globalData?.inviteGuide?.active);
    return !guideActive &&
      !this._addMiniAppPopupVisible &&
      !this.data.newbieTaskBlockerVisible &&
      !this.data.showCheckinGuideMap &&
      !this.data.showInviteGuideMap &&
      !this.data.markerDetailVisible &&
      !this.data.markerPageVisible &&
      !this.data.layerPanelVisible &&
      !this.data.callSheetVisible &&
      !this.data.joinInvitePrompt &&
      !this.data.dronePickerVisible &&
      !this.data.showSubscribeWaitOverlay;
  },

  maybeShowAddMiniAppPopup() {
    if (this._addMiniAppPopupChecking || this._addMiniAppPopupVisible) return;
    if (!this.canShowAddMiniAppPopup()) return;
    if (!this.shouldShowAddMiniAppPopup()) return;
    if (typeof wx === "undefined" || typeof wx.checkIsAddedToMyMiniProgram !== "function") return;
    this._addMiniAppPopupChecking = true;
    wx.checkIsAddedToMyMiniProgram({
      success: (res = {}) => {
        console.log("check is added to my mini program result", res);
        const isAdded = !!(res.isAdded || res.isAddedToMyMiniProgram || res.added);
        if (isAdded) {
          this.persistMiniProgramAddedAt();
          return;
        }
        if (!isAdded && this.canShowAddMiniAppPopup()) {
          const popup = this.selectComponent("#add-mini-app-popup");
          if (popup && typeof popup.open === "function") {
            popup.open();
            this._addMiniAppPopupVisible = true;
          }
        }
      },
      fail: (err) => {
        console.warn("check is added to my mini program failed", err);
      },
      complete: () => {
        this._addMiniAppPopupChecking = false;
      }
    });
  },

  handleAddMiniAppPopupClosed(reason = "") {
    this._addMiniAppPopupVisible = false;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!this._mapLayerSettings || typeof this._mapLayerSettings !== "object") {
      this._mapLayerSettings = {};
    }
    this._mapLayerSettings.miniProgramAddedAt = nowSec;
    const apiBase = this.getApiBase();
    const token = this.getAuthToken();
    if (!apiBase || !token) return;
    updateMapLayerSettings({ miniProgramAddedAt: nowSec }, { apiBase, token })
      .catch((err) => {
        console.warn("update mini program popup close time failed", err);
      });
  },

  onAddMiniAppPopupClose() {
    this._addMiniAppPopupVisible = false;
    this.persistMiniProgramAddedAt();
  },

  persistMiniProgramAddedAt() {
    const nowSec = Math.floor(Date.now() / 1000);
    if (!this._mapLayerSettings || typeof this._mapLayerSettings !== "object") {
      this._mapLayerSettings = {};
    }
    this._mapLayerSettings.miniProgramAddedAt = nowSec;
    const apiBase = this.getApiBase();
    const token = this.getAuthToken();
    if (!apiBase || !token) return;
    updateMapLayerSettings({ miniProgramAddedAt: nowSec }, { apiBase, token })
      .catch((err) => {
        console.warn("update mini program popup close time failed", err);
      });
  },


  onUnload() {
    if (this._fetchTimer) clearTimeout(this._fetchTimer);
    if (this._markersFetchTimer) clearTimeout(this._markersFetchTimer);
    if (this._nfzFetchTimer) clearTimeout(this._nfzFetchTimer);
    if (this._subscribeWaitTimer) clearTimeout(this._subscribeWaitTimer);
    setSubscribeWaitOverlay(false);
    if (this._markerDetailCloseTimer) clearTimeout(this._markerDetailCloseTimer);
    if (this._markerPageCloseTimer) clearTimeout(this._markerPageCloseTimer);
    if (this._markerDetailExpandTimer) clearTimeout(this._markerDetailExpandTimer);
    if (this._restoreMarkerDetailTimer) clearTimeout(this._restoreMarkerDetailTimer);
    if (this._layerPanelCloseTimer) clearTimeout(this._layerPanelCloseTimer);
    if (this._addMiniAppPopupCheckTimer) clearTimeout(this._addMiniAppPopupCheckTimer);
    if (this._uomPluginInitTimer) clearTimeout(this._uomPluginInitTimer);
    this._activeMarkersRequest = null;
    this._activeNoFlyRequest = null;
    if (this._uomPlugin && typeof this._uomPlugin.destroy === "function") {
      this._uomPlugin.destroy();
    }
  },


  handleWorkGroupInviteOptions(options = {}) {
    const payload = extractWorkGroupInvite(options);
    if (!payload) return;
    const normalized = {
      invitationCode: payload.invitationCode,
      groupId: payload.groupId,
      groupName: decodeMaybeURI(payload.groupName || payload.groupId || "")
    };
    if (this.isSelfWorkGroupInvite(normalized.invitationCode)) {
      this.setData({ joinInvitePrompt: null, joinInviting: false, joinInviteLoginPending: false });
      this.clearWorkGroupInviteParams();
      this.navigateToWorkGroupCenter();
      return;
    }
    this.setPendingWorkGroupInvite(normalized);
    this.clearWorkGroupInviteParams();
    this.navigateToWorkGroupCenter();
  },

  clearWorkGroupInviteParams() {
    try {
      const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
      const currentPage = Array.isArray(pages) && pages.length ? pages[pages.length - 1] : null;
      if (currentPage && currentPage.options) {
        ["invitationCode", "inviteCode", "groupId", "workGroupId", "groupName"].forEach((key) => {
          if (key in currentPage.options) {
            delete currentPage.options[key];
          }
        });
      }
    } catch (err) {
      console.warn("clearWorkGroupInviteParams failed", err);
    }
  },

  setPendingWorkGroupInvite(payload = null) {
    try {
      const app = typeof getApp === "function" ? getApp() : null;
      if (app && app.globalData) {
        app.globalData.pendingWorkGroupInvite = payload;
      }
    } catch (err) {
      console.warn("setPendingWorkGroupInvite failed", err);
    }
  },

  isSelfWorkGroupInvite(invitationCode = "") {
    const code = `${invitationCode || ""}`.trim();
    if (!code) return false;
    try {
      const shareCode = this.getShareInviteCodeValue ? this.getShareInviteCodeValue() : "";
      if (shareCode && `${shareCode}`.trim() === code) {
        return true;
      }
    } catch (err) {
      console.warn("compare invite code with share code failed", err);
    }
    try {
      const stored = typeof loadStoredProfileUtil === "function" ? loadStoredProfileUtil() : null;
      const storedCode = `${stored?.inviteCode || ""}`.trim();
      if (storedCode && storedCode === code) {
        return true;
      }
    } catch (err) {
      console.warn("compare invite code with stored profile failed", err);
    }
    return false;
  },

  promptJoinWorkGroup(promptPayload) {
    const prompt = promptPayload || this.data.joinInvitePrompt;
    if (!prompt?.invitationCode || !prompt?.groupId) return;
    const name = decodeMaybeURI(prompt.groupName || prompt.groupId || "");
    this.setData({
      joinInvitePrompt: { invitationCode: prompt.invitationCode, groupId: prompt.groupId, groupName: name },
      joinInviting: false,
      joinInviteLoginPending: false
    });
  },

  confirmJoinWorkGroup(promptPayload) {
    const evt = promptPayload && promptPayload.currentTarget ? promptPayload : null;
    const ds = (evt && evt.currentTarget && evt.currentTarget.dataset) || {};
    const prompt =
      (ds.invitationCode && ds.groupId && {
        invitationCode: ds.invitationCode,
        groupId: ds.groupId,
        groupName: ds.groupName
      }) ||
      this.data.joinInvitePrompt ||
      {};
    console.log("confirmJoinWorkGroup", prompt);
    if (!prompt.invitationCode || !prompt.groupId || this.data.joinInviting) return;
    const run = () => {
      this.setData({ joinInviting: true });
      joinWorkGroup(prompt.groupId, prompt.invitationCode, { apiBase: this.apiBase })
        .then(() => {
          wx.showToast({ title: "已加入工作组", icon: "success" });
          this.clearWorkGroupInviteParams();
          this.setData({ joinInvitePrompt: null });
          this.navigateToWorkGroupCenter();
        })
        .catch((err) => {
          console.error("加入工作组失败", err);
          const message = err?.message || "";
          if (/已加入/.test(message) || /already/i.test(message)) {
            wx.showToast({ title: "已在工作组中", icon: "success" });
            this.clearWorkGroupInviteParams();
            this.setData({ joinInvitePrompt: null });
            this.navigateToWorkGroupCenter();
            return;
          }
          wx.showToast({ title: message || "加入失败", icon: "none" });
        })
        .finally(() => this.setData({ joinInviting: false }));
    };
    run();
  },

  cancelJoinWorkGroup() {
    this.clearWorkGroupInviteParams();
    this.setData({ joinInvitePrompt: null, joinInviting: false, joinInviteLoginPending: false });
  },

  navigateToWorkGroupCenter() {
    const url = "/pages/markers/index";
    try {
      const app = typeof getApp === "function" ? getApp() : null;
      if (app && app.globalData) {
        app.globalData.targetMarkersCenterTab = "WORKGROUP";
      }
    } catch (err) {
      console.warn("set targetMarkersCenterTab failed", err);
    }
    if (typeof wx?.switchTab === "function") {
      wx.switchTab({
        url,
        success: () => {
          console.log("switchTab to markers succeeded");
        },
        fail: (err) => {
          console.warn("switchTab to markers failed, fallback to navigateTo", err);
          if (typeof wx?.navigateTo === "function") {
            wx.navigateTo({ url });
          }
        }
      });
      return;
    }
    if (typeof wx?.navigateTo === "function") {
      wx.navigateTo({ url });
    }
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

  computeDronePickerLabel(state = {}) {
    const loading =
      Object.prototype.hasOwnProperty.call(state, "loadingDrones")
        ? state.loadingDrones
        : this.data.loadingDrones;
    const available =
      Object.prototype.hasOwnProperty.call(state, "droneListAvailable")
        ? state.droneListAvailable
        : this.data.droneListAvailable;
    const name =
      Object.prototype.hasOwnProperty.call(state, "selectedDroneName")
        ? state.selectedDroneName
        : this.data.selectedDroneName;
    if (loading) return "加载中";
    if (!available) return "未提供";
    return name || "未提供";
  },

  normalizeAircraftModel(value) {
    if (typeof value !== "string") return "";
    return value.trim();
  },

  resolveDroneIndexByModel(model) {
    const normalized = this.normalizeAircraftModel(model);
    if (!normalized) return -1;
    const list = this.getDroneList();
    if (!Array.isArray(list) || !list.length) return -1;
    let index = list.findIndex((item) => item.slug === normalized);
    if (index >= 0) return index;
    const lower = normalized.toLowerCase();
    return list.findIndex((item) => (item.name || "").toLowerCase() === lower);
  },

  applyAircraftModelSetting(model, options = {}) {
    const normalized = this.normalizeAircraftModel(model);
    if (!normalized) return false;
    const index = this.resolveDroneIndexByModel(normalized);
    if (index < 0) return false;
    this.applyDroneByIndex(index, { persist: options.persist !== false });
    return true;
  },

  getDroneList() {
    if (Array.isArray(this._droneList) && this._droneList.length) {
      return this._droneList;
    }
    return [];
  },

  resolveDroneCategoryId(item = {}) {
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const slug = typeof item.slug === "string" ? item.slug.trim() : "";
    const nameLower = name.toLowerCase();
    const slugLower = slug.toLowerCase();

    const isTransport = slugLower.includes("flycart") || nameLower.includes("flycart");
    const isAgriculture =
      slugLower.startsWith("mg-") ||
      slugLower.startsWith("mg1") ||
      slugLower.startsWith("mg-new") ||
      /^mg\d/.test(slugLower) ||
      /^t\d/.test(slugLower) ||
      /^t\d/i.test(name);
    const isEnterprise =
      slugLower.includes("matrice") ||
      slugLower.startsWith("m-") ||
      slugLower.startsWith("m100") ||
      slugLower.startsWith("m200") ||
      slugLower.startsWith("m300") ||
      slugLower.startsWith("m350") ||
      slugLower.startsWith("m600") ||
      slugLower.startsWith("m30") ||
      slugLower.startsWith("industry-") ||
      nameLower.includes("enterprise");
    const isProAerial = slugLower.includes("inspire") || nameLower.includes("inspire");
    const isFpv = slugLower.includes("fpv") || nameLower.includes("fpv") ||
      slugLower.includes("avata") || nameLower.includes("avata");
    const isConsumerPortable =
      slugLower.includes("mini") ||
      nameLower.includes("mini") ||
      slugLower.includes("neo") ||
      nameLower.includes("neo") ||
      slugLower.includes("flip") ||
      nameLower.includes("flip") ||
      slugLower.includes("spark") ||
      nameLower.includes("spark");
    const isConsumerImaging =
      slugLower.includes("mavic") ||
      nameLower.includes("mavic") ||
      slugLower.includes("air") ||
      nameLower.includes("air") ||
      slugLower.includes("classic") ||
      nameLower.includes("classic") ||
      slugLower.includes("phantom") ||
      nameLower.includes("phantom") ||
      slugLower.includes("pro") ||
      nameLower.includes("pro");

    if (isTransport) return "transport";
    if (isAgriculture) return "agri";
    if (isEnterprise) return "enterprise";
    if (isProAerial) return "pro";
    if (isFpv) return "fpv";
    if (isConsumerPortable) return "consumer-portable";
    if (isConsumerImaging) return "consumer-imaging";
    return "other";
  },

  buildDroneCategories(list = []) {
    if (!Array.isArray(list) || !list.length) return [];
    const categories = [
      { id: "consumer-portable", label: "消费级便携", items: [] },
      { id: "consumer-imaging", label: "消费级影像", items: [] },
      { id: "fpv", label: "FPV 沉浸", items: [] },
      { id: "pro", label: "专业航拍", items: [] },
      { id: "enterprise", label: "企业级行业", items: [] },
      { id: "agri", label: "农业植保", items: [] },
      { id: "transport", label: "物流运输", items: [] },
      { id: "other", label: "其他", items: [] }
    ];

    const map = new Map(categories.map((category) => [category.id, category]));
    list.forEach((item, index) => {
      if (!item) return;
      const id = this.resolveDroneCategoryId(item);
      const target = map.get(id) || map.get("other");
      if (target) {
        target.items.push({
          index,
          name: item.name || "",
          slug: item.slug || ""
        });
      }
    });
    categories.forEach((category) => {
      if (!Array.isArray(category.items)) return;
      category.items.sort((a, b) =>
        `${a?.name || ""}`.toLowerCase().localeCompare(`${b?.name || ""}`.toLowerCase())
      );
    });
    return categories.filter((category) => category.items.length);
  },

  applyDroneList(list = []) {
    if (!Array.isArray(list) || !list.length) return;
    this._droneList = list;
    const currentSlug = this.data.selectedDrone;
    let nextIndex = list.findIndex((item) => item.slug === currentSlug);
    if (nextIndex < 0) {
      nextIndex = 0;
    }
    const next = list[nextIndex];
    if (!next) return;
    const changed = next.slug !== currentSlug;
    const dronePickerLabel = this.computeDronePickerLabel({
      loadingDrones: false,
      droneListAvailable: true,
      selectedDroneName: next.name
    });

    const categories = this.buildDroneCategories(list);
    let activeIndex = Number.isFinite(this.data.activeDroneCategoryIndex)
      ? this.data.activeDroneCategoryIndex
      : 0;
    if (activeIndex < 0 || activeIndex >= categories.length) {
      activeIndex = 0;
    }
    const matchedCategoryIndex = categories.findIndex((category) =>
      Array.isArray(category.items) && category.items.some((item) => item.index === nextIndex)
    );
    if (matchedCategoryIndex >= 0) {
      activeIndex = matchedCategoryIndex;
    }
    const activeCategory = categories[activeIndex] || categories[0] || { items: [] };

    this.setData({
      droneCategories: categories,
      droneCategoryItems: activeCategory.items || [],
      activeDroneCategoryIndex: activeIndex,
      selectedDroneIndex: nextIndex,
      selectedDrone: next.slug,
      selectedDroneName: next.name,
      loadingDrones: false,
      droneListAvailable: true,
      dronePickerLabel
    });
    if (changed) {
      this.scheduleFetchDji(0, true);
    }
  },

  loadDronesFromApi() {
    const dronePickerLabel = this.computeDronePickerLabel({
      loadingDrones: true,
      droneListAvailable: this.data.droneListAvailable
    });
    this.setData({ loadingDrones: true, dronePickerLabel });
    return fetchDrones()
      .then((list) => {
        if (Array.isArray(list) && list.length) {
          this.applyDroneList(list);
          const pending = this._pendingAircraftModel;
          if (pending) {
            const applied = this.applyAircraftModelSetting(pending, { persist: false });
            if (applied) {
              this._pendingAircraftModel = "";
            }
          }
          return;
        }
        this._droneList = [];
        const fallbackLabel = this.computeDronePickerLabel({
          loadingDrones: false,
          droneListAvailable: false
        });
        this.setData({
          droneNames: [],
          droneCategories: [],
          droneCategoryItems: [],
          activeDroneCategoryIndex: 0,
          loadingDrones: false,
          droneListAvailable: false,
          dronePickerLabel: fallbackLabel
        });
      })
      .catch((err) => {
        console.warn("Failed to fetch drone list", err);
        this._droneList = [];
        const fallbackLabel = this.computeDronePickerLabel({
          loadingDrones: false,
          droneListAvailable: false
        });
        this.setData({
          droneNames: [],
          droneCategories: [],
          droneCategoryItems: [],
          activeDroneCategoryIndex: 0,
          loadingDrones: false,
          droneListAvailable: false,
          dronePickerLabel: fallbackLabel
        });
      });
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
    const targetPath = dataset.path || info.linkPath || "";
    if (targetPath && typeof wx.navigateTo === "function") {
      wx.navigateTo({ url: targetPath });
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
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData && app.globalData.checkinGuide?.active) {
      app.globalData.checkinGuide = { active: true, step: "profile" };
      if (this.data.showCheckinGuideMap) {
        this.setData({ showCheckinGuideMap: false });
      }
    }
    if (app && app.globalData && app.globalData.inviteGuide?.active) {
      app.globalData.inviteGuide = { active: true, step: "profile" };
      if (this.data.showInviteGuideMap) {
        this.setData({ showInviteGuideMap: false });
      }
    }
    const loadingShown = typeof wx !== "undefined" && typeof wx.showLoading === "function";
    const hideLoading = typeof wx !== "undefined" && typeof wx.hideLoading === "function"
      ? () => wx.hideLoading()
      : () => { };
    if (loadingShown) {
      wx.showLoading({ title: "加载中...", mask: true });
    }
    this.ensureProfileAuthenticated()
      .then(() => {
        // Fire-and-forget subscription request so navigation is not blocked
        this.requestProfileSubscriptions().catch((err) => {
          console.warn("订阅模板流程失败", err);
        });
        if (typeof wx.navigateTo === "function") {
          wx.navigateTo({
            url: "/pages/profile/profile",
            success: () => hideLoading(),
            fail: (err) => {
              hideLoading();
              console.warn("navigate to profile failed", err);
            }
          });
        } else {
          hideLoading();
        }
      })
      .catch((err) => {
        hideLoading();
        this.setData({ activeTab: "home" });
        if (err && err.message === "user-cancel") {
          return;
        }
        if (err && err.message === "login-unavailable") {
          this.showPlaceholderToast("暂时无法打开我的页面");
        }
      });
  },

  onLayerButtonTap() {
    if (this._layerPanelCloseTimer) {
      clearTimeout(this._layerPanelCloseTimer);
      this._layerPanelCloseTimer = null;
    }
    this.setData({ layerPanelVisible: true, layerPanelClosing: false });
    this.loadMapLayerSettings(false);
  },

  onPanoramaDemoTap() {
    if (typeof wx.chooseMessageFile !== "function") {
      wx.showToast({ title: "当前版本不支持从聊天记录选图", icon: "none" });
      return;
    }
    wx.chooseMessageFile({
      count: 1,
      type: "image",
      success: (res) => {
        const filePath = res?.tempFiles?.[0]?.path;
        console.log("panorama file chosen", { filePath });
        if (!filePath) {
          wx.showToast({ title: "未选择图片", icon: "none" });
          return;
        }
        const fs = typeof wx.getFileSystemManager === "function" ? wx.getFileSystemManager() : null;
        const saveIfNeeded = fs && typeof fs.saveFile === "function"
          ? new Promise((resolve) => {
            fs.saveFile({
              tempFilePath: filePath,
              success: (saveRes) => {
                const saved = saveRes?.savedFilePath;
                if (saved) {
                  console.log("panorama file saved", { savedFilePath: saved });
                  resolve(saved);
                  return;
                }
                resolve(filePath);
              },
              fail: (err) => {
                console.warn("panorama save file failed", err);
                resolve(filePath);
              }
            });
          })
          : Promise.resolve(filePath);
        const getInfo = (path) => (typeof wx.getImageInfo === "function"
          ? new Promise((resolve, reject) => {
            wx.getImageInfo({
              src: path,
              success: (info) => resolve({ path, info }),
              fail: (err) => reject(err || new Error("invalid-panorama-image"))
            });
          })
          : Promise.resolve({ path, info: null }));
        const buildPlanetSrc = (path, info) => {
          const width = Number(info?.width || 0);
          const height = Number(info?.height || 0);
          const maxSide = Math.max(width, height);
          if (!Number.isFinite(maxSide) || maxSide <= 8192 || typeof wx.compressImage !== "function") {
            return Promise.resolve(path);
          }
          const scale = 8192 / maxSide;
          const targetW = Math.max(1, Math.round(width * scale));
          const targetH = Math.max(1, Math.round(height * scale));
          return new Promise((resolve) => {
            wx.compressImage({
              src: path,
              quality: 85,
              compressedWidth: targetW,
              compressedHeight: targetH,
              success: (compressRes) => {
                const temp = compressRes?.tempFilePath || path;
                console.log("panorama compressed for planet", { temp, targetW, targetH });
                resolve(temp);
              },
              fail: (err) => {
                console.warn("panorama compress failed", err);
                resolve(path);
              }
            });
          });
        };
        saveIfNeeded
          .then((path) => getInfo(path))
          .then(({ path, info }) => buildPlanetSrc(path, info).then((planetPath) => ({
            originalPath: path,
            planetPath
          })))
          .then(({ originalPath, planetPath }) => {
            const encoded = encodeURIComponent(originalPath);
            const planetEncoded = encodeURIComponent(planetPath || originalPath);
            wx.navigateTo({
              url: `/pages/dji-360/index?src=${encoded}&planetSrc=${planetEncoded}`,
              fail: (err) => {
                console.warn("navigate to panorama failed", err);
                wx.showToast({ title: "打开失败", icon: "none" });
              }
            });
          })
          .catch((err) => {
            console.warn("panorama image invalid", err);
            wx.showToast({ title: "图片不可用", icon: "none" });
          });
      },
      fail: (err) => {
        console.warn("panorama choose file failed", err);
        wx.showToast({ title: "取消选择", icon: "none" });
      }
    });
  },

  onLayerPanelMaskTap() {
    this.closeLayerPanel();
  },

  onLayerPanelClose() {
    this.closeLayerPanel();
  },

  closeLayerPanel() {
    if (!this.data.layerPanelVisible) {
      return;
    }
    if (this._layerPanelCloseTimer) {
      clearTimeout(this._layerPanelCloseTimer);
      this._layerPanelCloseTimer = null;
    }
    this.setData({ layerPanelClosing: true });
    this._layerPanelCloseTimer = setTimeout(() => {
      this.setData({ layerPanelVisible: false, layerPanelClosing: false });
      this._layerPanelCloseTimer = null;
    }, 220);
  },

  onMapLayerSelect(event = {}) {
    const type = event?.currentTarget?.dataset?.type || "";
    const nextType = type === "satellite" ? "satellite" : "standard";
    const enableSatellite = nextType === "satellite";
    this.setData({
      mapLayerType: nextType,
      enableSatellite
    }, () => {
      this.persistMapLayerSettings();
    });
  },

  onAirBoardSwitchChange(event = {}) {
    const enabled = !!event?.detail?.value;
    this.setData(
      { airBoardEnabled: enabled, showDashboardPanel: enabled },
      () => {
        this.applyAirBoardToggle(enabled);
        this.persistMapLayerSettings();
      }
    );
  },

  onMapElementToggle(event = {}) {
    const id = event?.currentTarget?.dataset?.id;
    if (!id) return;
    const flagMap = {
      uom: "uomDivisionEnabled",
      dji: "djiNoFlyZoneEnabled",
      tempNoFly: "temporaryNoFlyZoneEnabled",
      service: "merchantMarkersEnabled",
      private: "privateMarkersEnabled",
      group: "groupSharingEnabled",
      platform: "platformCoConstructionEnabled"
    };
    const flagKey = flagMap[id];
    if (!flagKey) return;
    const nextValue = !this.data[flagKey];
    const pinToggle =
      flagKey === "privateMarkersEnabled" ||
      flagKey === "groupSharingEnabled" ||
      flagKey === "platformCoConstructionEnabled";
    const updates = { [flagKey]: nextValue };
    updates.mapElementOptions = this.composeMapElementOptions({
      uomDivisionEnabled: flagKey === "uomDivisionEnabled" ? nextValue : this.data.uomDivisionEnabled,
      djiNoFlyZoneEnabled: flagKey === "djiNoFlyZoneEnabled" ? nextValue : this.data.djiNoFlyZoneEnabled,
      temporaryNoFlyZoneEnabled:
        flagKey === "temporaryNoFlyZoneEnabled" ? nextValue : this.data.temporaryNoFlyZoneEnabled,
      merchantMarkersEnabled:
        flagKey === "merchantMarkersEnabled" ? nextValue : this.data.merchantMarkersEnabled,
      privateMarkersEnabled: flagKey === "privateMarkersEnabled" ? nextValue : this.data.privateMarkersEnabled,
      groupSharingEnabled: flagKey === "groupSharingEnabled" ? nextValue : this.data.groupSharingEnabled,
      platformCoConstructionEnabled:
        flagKey === "platformCoConstructionEnabled" ? nextValue : this.data.platformCoConstructionEnabled
    });
    this.setData(updates, () => {
      if (flagKey === "uomDivisionEnabled") {
        if (this._uomPlugin && typeof this._uomPlugin.setEnabled === "function") {
          this._uomPlugin.setEnabled(nextValue);
        }
      }
      if (flagKey === "djiNoFlyZoneEnabled") {
        this.applyNoFlyOverlayToggle({
          djiEnabled: nextValue,
          temporaryEnabled: this.data.temporaryNoFlyZoneEnabled
        });
      }
      if (flagKey === "temporaryNoFlyZoneEnabled") {
        this.applyNoFlyOverlayToggle({
          djiEnabled: this.data.djiNoFlyZoneEnabled,
          temporaryEnabled: nextValue
        });
      }
      if (flagKey === "merchantMarkersEnabled") {
        this.applyMerchantMarkersToggle(nextValue);
      }
      if (pinToggle) {
        this.applyPinLayerToggle(nextValue);
      }
      this.persistMapLayerSettings();
    });
  },

  composeMapElementOptions(flags = {}) {
    const state = Object.assign(
      {
        uomDivisionEnabled: true,
        djiNoFlyZoneEnabled: true,
        temporaryNoFlyZoneEnabled: true,
        merchantMarkersEnabled: true,
        privateMarkersEnabled: false,
        groupSharingEnabled: false,
        platformCoConstructionEnabled: true
      },
      flags
    );
    const djiEnabled = !!state.djiNoFlyZoneEnabled;
    const tempEnabled = !!state.temporaryNoFlyZoneEnabled;
    return [
      { id: "uom", label: "uom划分", enabled: !!state.uomDivisionEnabled },
      { id: "dji", label: "大疆划分", enabled: djiEnabled },
      { id: "tempNoFly", label: "临时禁飞区", enabled: tempEnabled },
      { id: "service", label: "商户服务", enabled: !!state.merchantMarkersEnabled },
      { id: "private", label: "私有标记", enabled: !!state.privateMarkersEnabled },
      { id: "group", label: "小组共享", enabled: !!state.groupSharingEnabled },
      { id: "platform", label: "平台共建", enabled: !!state.platformCoConstructionEnabled }
    ];
  },

  applyAirBoardToggle(enabled) {
    this.setData({ showDashboardPanel: !!enabled });
  },

  applyNoFlyOverlayToggle(options = {}) {
    const djiEnabled = options.djiEnabled !== false;
    const temporaryEnabled = options.temporaryEnabled !== false;
    if (!djiEnabled) {
      this._djiPolygons = [];
      this._djiCircles = [];
      this._djiZonesReady = false;
    }
    if (!temporaryEnabled) {
      this._noFlyZones = [];
      this._nfzPolygons = [];
      this._nfzCircles = [];
      this._noFlyZoneShapes = [];
      this._noFlyZonesReady = false;
      this._lastNoFlyFetch = null;
    }
    this.updateOverlayGraphics();
    if (djiEnabled && !this._djiZonesReady) {
      this.scheduleFetchDji(0, true);
    }
    if (temporaryEnabled && !this._noFlyZonesReady) {
      this.scheduleFetchNoFlyZones(0, { force: true });
    }
    this.updateStatusPanel(this._lastAreas);
  },

  applyMerchantMarkersToggle(enabled) {
    if (enabled === false) {
      this._nearbyMarkers = [];
      this._lastNearbyFetch = null;
      this.syncAllMarkers();
      return;
    }
    this.syncAllMarkers();
    this.scheduleFetchMarkers(0, { force: true });
  },

  applyPinLayerToggle(forceFetch = false) {
    this.rebuildNearbyPinGraphics();
    if (!this.isPinLayerEnabled()) {
      if (this._pinsFetchTimer) {
        clearTimeout(this._pinsFetchTimer);
        this._pinsFetchTimer = null;
      }
      this._lastNearbyPinFetch = null;
      return;
    }
    if (forceFetch && this.isPinLayerEnabled()) {
      this.scheduleFetchPins(0, { force: true });
    }
  },

  buildMapLayerSettingsPayload() {
    return {
      mapType: this.data.mapLayerType === "satellite" ? "SATELLITE" : "STANDARD",
      airspaceBoardEnabled: !!this.data.airBoardEnabled,
      uomDivisionEnabled: !!this.data.uomDivisionEnabled,
      djiNoFlyZoneEnabled: !!this.data.djiNoFlyZoneEnabled,
      temporaryNoFlyZoneEnabled: !!this.data.temporaryNoFlyZoneEnabled,
      merchantMarkersEnabled: !!this.data.merchantMarkersEnabled,
      privateMarkersEnabled: !!this.data.privateMarkersEnabled,
      groupSharingEnabled: !!this.data.groupSharingEnabled,
      platformCoConstructionEnabled: !!this.data.platformCoConstructionEnabled,
      aircraftModel: this.data.selectedDrone || ""
    };
  },

  applyLayerSettings(settings = {}, options = {}) {
    const mapType = settings.mapType === "SATELLITE" ? "satellite" : "standard";
    const airspace = settings.airspaceBoardEnabled !== false;
    const uom = settings.uomDivisionEnabled !== false;
    const dji = settings.djiNoFlyZoneEnabled !== false;
    const temporary = settings.temporaryNoFlyZoneEnabled !== undefined
      ? settings.temporaryNoFlyZoneEnabled !== false
      : dji;
    const merchant = settings.merchantMarkersEnabled !== false;
    const privateMarkers = settings.privateMarkersEnabled !== false;
    const groupSharing = settings.groupSharingEnabled !== false;
    const platformCoConstruction = settings.platformCoConstructionEnabled !== false;
    const mapElementOptions = this.composeMapElementOptions({
      uomDivisionEnabled: uom,
      djiNoFlyZoneEnabled: dji,
      temporaryNoFlyZoneEnabled: temporary,
      merchantMarkersEnabled: merchant,
      privateMarkersEnabled: privateMarkers,
      groupSharingEnabled: groupSharing,
      platformCoConstructionEnabled: platformCoConstruction
    });
    this.setData(
      {
        mapLayerType: mapType,
        enableSatellite: mapType === "satellite",
        airBoardEnabled: airspace,
        showDashboardPanel: airspace,
        uomDivisionEnabled: uom,
        djiNoFlyZoneEnabled: dji,
        temporaryNoFlyZoneEnabled: temporary,
        merchantMarkersEnabled: merchant,
        privateMarkersEnabled: privateMarkers,
        groupSharingEnabled: groupSharing,
        platformCoConstructionEnabled: platformCoConstruction,
        mapElementOptions
      },
      () => {
        this.applyAirBoardToggle(airspace);
        if (this._uomPlugin && typeof this._uomPlugin.setEnabled === "function") {
          this._uomPlugin.setEnabled(uom);
        }
        this.applyNoFlyOverlayToggle({ djiEnabled: dji, temporaryEnabled: temporary });
        this.applyMerchantMarkersToggle(merchant);
        this.applyPinLayerToggle(true);
        if (typeof options.onApplied === "function") {
          options.onApplied();
        }
      }
    );
  },

  loadMapLayerSettings(force = false) {
    if (this.data.mapLayerSettingsLoading) return;
    if (this._mapLayerSettingsLoaded && !force) return;
    const apiBase = this.getApiBase();
    const token = this.getAuthToken();
    if (!apiBase || !token) return;
    this.setData({ mapLayerSettingsLoading: true });
    fetchMapLayerSettings({
      apiBase,
      token
    })
      .then((settings) => {
        if (settings) {
          this._mapLayerSettings = settings;
          this.applyLayerSettings(settings, {
            onApplied: () => {
              const aircraftModel = this.normalizeAircraftModel(settings.aircraftModel);
              if (aircraftModel) {
                const applied = this.applyAircraftModelSetting(aircraftModel, { persist: false });
                if (!applied) {
                  this._pendingAircraftModel = aircraftModel;
                } else {
                  this._pendingAircraftModel = "";
                }
              } else if (!this._mapLayerAircraftModelWritten) {
                this._mapLayerAircraftModelWritten = true;
                if (this.data.selectedDrone) {
                  this.persistMapLayerSettings();
                }
              }
            }
          });
          this._mapLayerSettingsLoaded = true;
          this.scheduleAddMiniAppPopupCheck("map-layer-settings");
        }
      })
      .catch((err) => {
        console.warn("Failed to load map layer settings", err);
      })
      .finally(() => {
        this.setData({ mapLayerSettingsLoading: false });
      });
  },

  bootstrapMapLayerSettings(force = false) {
    if (this._mapLayerSettingsInitPromise) return this._mapLayerSettingsInitPromise;
    const apiBase = this.getApiBase();
    const token = this.getAuthToken();
    if (apiBase && token) {
      this.loadMapLayerSettings(force);
      return Promise.resolve();
    }
    const promise = this.ensureProfileAuthenticated();
    if (!promise || typeof promise.then !== "function") {
      return Promise.resolve();
    }
    this._mapLayerSettingsInitPromise = promise
      .then(() => {
        this.loadMapLayerSettings(force);
      })
      .catch((err) => {
        console.warn("bootstrap map layer settings failed", err);
      })
      .finally(() => {
        this._mapLayerSettingsInitPromise = null;
      });
    return this._mapLayerSettingsInitPromise;
  },

  persistMapLayerSettings() {
    const apiBase = this.getApiBase();
    const token = this.getAuthToken();
    if (!apiBase || !token) return;
    const payload = this.buildMapLayerSettingsPayload();
    updateMapLayerSettings(payload, {
      apiBase,
      token
    }).catch((err) => {
      console.warn("Failed to update map layer settings", err);
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

  onTopicButtonTap() {
    wx.navigateTo({
      url: "/pages/topic/topic",
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

  applyNearbyPins(list) {
    this._nearbyPinsRaw = Array.isArray(list) ? list : [];
    this.rebuildNearbyPinGraphics();
    this.updateCenterPinIndicator();
    this.trackPinExposure(this._nearbyPinMarkers);
  },

  rebuildNearbyPinGraphics() {
    if (!this.isPinLayerEnabled()) {
      this._nearbyPinMarkers = [];
      this._nearbyPinPolygons = [];
      this._nearbyPinCircles = [];
      this._lastNearbyPinFetch = null;
      this.updateOverlayGraphics();
      this.syncAllMarkers();
      this.updateCenterPinIndicator();
      return;
    }
    const previewId = this._previewPinId ? `${this._previewPinId}` : "";
    const markers = [];
    const polygons = [];
    const circles = [];
    const rawList = Array.isArray(this._nearbyPinsRaw) ? this._nearbyPinsRaw : [];
    rawList.forEach((item, index) => {
      const pin = this.normalizeNearbyPin(item);
      if (!pin || !this.isPinVisibilityEnabled(pin.visibility)) return;
      // Avoid duplicating the pin currently in preview
      if (previewId && `${pin.id || ""}` === previewId) return;
      if (pin.shape.type === "POINT") {
        const marker = this.buildPinPreviewMarker({
          id: pin.id || `pin-${index}`,
          name: pin.name,
          location: pin.location,
          shape: pin.shape,
          height: pin.height,
          coordsAreGcj: true
        });
        if (marker) {
          marker.extData = Object.assign({}, marker.extData, {
            source: "pin-nearby",
            raw: item
          });
          markers.push(marker);
        }
        return;
      }
      const zone = this.buildPinPreviewZone(pin.shape);
      if (!zone) return;
      const graphics = buildNoFlyZoneGraphics([zone], { color: "#D3A05B" });
      if (Array.isArray(graphics.polygons)) {
        polygons.push(...graphics.polygons);
      }
      if (Array.isArray(graphics.circles)) {
        circles.push(...graphics.circles);
      }
    });
    this._nearbyPinMarkers = markers;
    this._nearbyPinPolygons = polygons;
    this._nearbyPinCircles = circles;
    this.updateOverlayGraphics();
    this.syncAllMarkers();
    this.updateCenterPinIndicator();
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
    const nearby =
      this.data.merchantMarkersEnabled !== false && Array.isArray(this._nearbyMarkers)
        ? this._nearbyMarkers
        : [];
    const pinMarkers = Array.isArray(this._nearbyPinMarkers) ? this._nearbyPinMarkers : [];
    const search = Array.isArray(this._searchMarkers) ? this._searchMarkers : [];
    const manual = Array.isArray(this._manualMarkers) ? this._manualMarkers : [];
    const preview = this._previewMarker ? [this._previewMarker] : [];
    this.normalizeMapMarkerList(nearby);
    this.normalizeMapMarkerList(pinMarkers);
    this.normalizeMapMarkerList(search);
    this.normalizeMapMarkerList(manual);
    this.normalizeMapMarkerList(preview);
    const combined = manual.concat(pinMarkers, nearby, search, preview);
    this.setData({ markers: combined });
  },

  updateCenterPinIndicator(centerOverride) {
    const center = centerOverride || this._centerOverride || this.data.center;
    if (!center || !hasValidCoordinate(center.latitude, center.longitude)) {
      this.setData({
        centerPinTitle: "",
        centerCoordinateLatText: "",
        centerCoordinateLngText: "",
        cityReportCenter: null
      });
      return;
    }
    let displayLat = center.latitude;
    let displayLng = center.longitude;
    if (this.data.coordinateSystem === "wgs84") {
      const wgs = gcj02ToWgs84(center.longitude, center.latitude);
      if (Number.isFinite(wgs?.lat) && Number.isFinite(wgs?.lng)) {
        displayLat = wgs.lat;
        displayLng = wgs.lng;
      }
    }
    const pin = this.findPinContainingPoint(center);
    const coord = formatCoordinateParts(displayLat, displayLng);
    this.setData({
      centerPinTitle: pin ? pin.name || "" : "",
      centerCoordinateLngText: coord ? coord.lngText : "",
      centerCoordinateLatText: coord ? coord.latText : "",
      cityReportCenter: center
    });
  },

  onCenterCoordinateTap() {
    const lngText = this.data.centerCoordinateLngText;
    const latText = this.data.centerCoordinateLatText;
    if (!latText || !lngText) return;
    const text = `${lngText},${latText}`;
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: "经纬度已复制", icon: "success" });
      },
      fail: (err) => {
        console.error("复制经纬度失败", err);
        wx.showToast({ title: "复制失败", icon: "none" });
      }
    });
  },

  onCoordinateSystemToggle() {
    const next = this.data.coordinateSystem === "wgs84" ? "gcj02" : "wgs84";
    this.setData({ coordinateSystem: next }, () => {
      this.updateCenterPinIndicator();
    });
  },

  findPinContainingPoint(point = {}) {
    if (!point || !hasValidCoordinate(point.latitude, point.longitude)) return null;
    const pins = Array.isArray(this._nearbyPinsRaw) ? this._nearbyPinsRaw : [];
    for (const raw of pins) {
      const pin = this.normalizeNearbyPin(raw);
      if (!pin) continue;
      if (this.pinContainsPoint(pin, point)) return pin;
    }
    return null;
  },

  onCenterPinIndicatorTap() {
    const center = this._centerOverride || this.data.center;
    const pin = this.findPinContainingPoint(center);
    if (!pin) {
      wx.showToast({ title: "未找到标记", icon: "none" });
      return;
    }
    const detail = this.buildPinDetailFromPin(pin);
    const marker = {
      id: detail.id || `pin-${Date.now()}`,
      latitude: detail.latitude,
      longitude: detail.longitude,
      extData: {
        source: "pin",
        raw: pin,
        detail: cloneMarkerDetail(detail)
      }
    };
    this.openMarkerDetail(marker);
  },

  pinContainsPoint(pin = {}, point = {}) {
    if (!pin || !pin.shape || !Array.isArray(pin.shape.coordinates)) return false;
    const type = `${pin.shape.type || ""}`.toUpperCase();
    const coords = pin.shape.coordinates;
    if (!coords.length) return false;
    const targetLat = Number(point.latitude);
    const targetLng = Number(point.longitude);
    if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) return false;
    if (type === "POINT") {
      const dist = haversineMeters(targetLat, targetLng, coords[0].latitude, coords[0].longitude);
      return Number.isFinite(dist) && dist <= 30;
    }
    if (type === "CIRCLE") {
      const center = coords[0];
      const radiusKm = Number(pin.shape.radius);
      const radiusMeters = Number.isFinite(radiusKm) ? radiusKm * 1000 : 0;
      const dist = haversineMeters(targetLat, targetLng, center.latitude, center.longitude);
      const threshold = radiusMeters > 0 ? radiusMeters : 30;
      return Number.isFinite(dist) && dist <= threshold;
    }
    if (type === "LINE" || type === "PATH") {
      const widthMeters = Number(pin.shape.width);
      const allowed = Number.isFinite(widthMeters) && widthMeters > 0 ? widthMeters : 30;
      const distance = this.distanceToPolylineMeters({ latitude: targetLat, longitude: targetLng }, coords);
      return Number.isFinite(distance) && distance <= allowed;
    }
    const ring = coords.map((c) => [c.longitude, c.latitude]);
    return this.ringContains(ring, targetLng, targetLat);
  },

  distanceToPolylineMeters(point, coords = []) {
    if (!Array.isArray(coords) || coords.length === 0) return Infinity;
    const lat0 = Number(point.latitude);
    const lng0 = Number(point.longitude);
    if (!Number.isFinite(lat0) || !Number.isFinite(lng0)) return Infinity;
    const factors = this._distanceFactors(lat0);
    let min = Infinity;
    for (let i = 0; i < coords.length - 1; i += 1) {
      const a = coords[i];
      const b = coords[i + 1];
      const d = this.distancePointToSegmentMeters(lat0, lng0, a, b, factors);
      if (d < min) min = d;
    }
    return min;
  },

  _distanceFactors(lat) {
    const kLat = 111320;
    const kLng = kLat * Math.max(Math.cos((Number(lat) * Math.PI) / 180), 0.0001);
    return { kLat, kLng };
  },

  distancePointToSegmentMeters(lat, lng, a = {}, b = {}, factors = null) {
    const { kLat, kLng } = factors || this._distanceFactors(lat);
    const ax = (Number(a.longitude) - lng) * kLng;
    const ay = (Number(a.latitude) - lat) * kLat;
    const bx = (Number(b.longitude) - lng) * kLng;
    const by = (Number(b.latitude) - lat) * kLat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.sqrt(ax * ax + ay * ay);
    let t = -(ax * dx + ay * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx;
    const py = ay + t * dy;
    return Math.sqrt(px * px + py * py);
  },

  resolveLikeTargetType(target = {}) {
    const source = (target?.extData?.source || target?.source || "").toLowerCase();
    const raw = target?.extData?.raw || target.raw || {};
    if (source.includes("pin") || raw.shape || (target?.shape && target.shape.coordinates)) {
      return "PIN";
    }
    return "MARKER";
  },

  resolveDeepRaw(raw = {}) {
    let current = raw;
    const seen = new Set();
    while (
      current &&
      typeof current === "object" &&
      current.raw &&
      typeof current.raw === "object" &&
      !seen.has(current.raw)
    ) {
      seen.add(current.raw);
      current = current.raw;
    }
    return current && typeof current === "object" ? current : {};
  },

  resolveMarkerNewId(detail = {}, marker = {}) {
    const rawSource = this.resolveDeepRaw(detail.raw || marker?.extData?.raw || marker?.raw || {});
    const extDetail = marker?.extData?.detail || {};
    const value =
      rawSource.markIdNew ??
      detail.markIdNew ??
      marker.markIdNew ??
      extDetail.markIdNew ??
      "";
    return value ? `${value}`.trim() : "";
  },

  resolveLikeTargetId(detail = {}, marker = {}, type = "") {
    const rawSource = this.resolveDeepRaw(detail.raw || marker?.extData?.raw || marker?.raw || {});
    const extDetail = marker?.extData?.detail || {};
    const isPin = type === "PIN";
    console.log("resolveLikeTargetId", { isPin, raw: rawSource, detail, marker, extDetail });
    const preferred = isPin
      ? (
        rawSource.pinIdNew ??
        detail.pinIdNew ??
        marker.pinIdNew ??
        extDetail.pinIdNew
      )
      : (
        rawSource.markIdNew ??
        detail.markIdNew ??
        marker.markIdNew ??
        extDetail.markIdNew
      );
    const chosen = preferred !== undefined && preferred !== null ? preferred : "";
    return chosen ? `${chosen}`.trim() : "";
  },

  applyLikeState(prefix, payload = {}) {
    // console.log("applyLikeState", { prefix, payload });
    const count = Number(payload.count);
    const liked = !!payload.liked;
    const type = payload.type || "";
    const id = payload.id || "";
    const updates = {};
    updates[`${prefix}LikeCount`] = Number.isFinite(count) && count >= 0 ? count : 0;
    updates[`${prefix}Liked`] = liked;
    updates[`${prefix}LikeTargetType`] = type;
    updates[`${prefix}LikeTargetId`] = id;
    updates[`${prefix}LikeCountDisplay`] = formatLikeCountDisplay(updates[`${prefix}LikeCount`]);
    this.setData(updates);
  },

  loadMarkerLikeInfo(options = {}) {
    const detail = options.detail || {};
    const marker = options.target || {};
    const forPage = !!options.forPage;
    const prefix = forPage ? "markerPage" : "marker";
    const type = this.resolveLikeTargetType(marker || detail);
    const id = this.resolveLikeTargetId(detail, marker, type);
    if (!type || !id) {
      this.applyLikeState(prefix, { count: 0, liked: false, type: "", id: "" });
      return;
    }
    this.applyLikeState(prefix, { count: 0, liked: false, type, id });
    const apiBase = this.getApiBase();
    fetchLikeCount(type, id, { apiBase })
      .then((data) => {
        this.applyLikeState(prefix, {
          count: data.likeCount || 0,
          liked: this.data[`${prefix}Liked`],
          type,
          id
        });
      })
      .catch((err) => {
        console.warn("fetchLikeCount failed", err);
      });
    fetchLikeStatus(type, id, { apiBase, token: this.getAuthToken() })
      .then((data) => {
        this.applyLikeState(prefix, {
          count: this.data[`${prefix}LikeCount`],
          liked: !!data.liked,
          type,
          id
        });
      })
      .catch((err) => {
        if (err?.message === "missing-token") {
          this.applyLikeState(prefix, {
            count: this.data[`${prefix}LikeCount`],
            liked: false,
            type,
            id
          });
          return;
        }
        console.warn("fetchLikeStatus failed", err);
      });
  },

  cancelLikeHold(prefix, resetAnim = true) {
    if (this._likeHoldTimers && this._likeHoldTimers[prefix]) {
      clearTimeout(this._likeHoldTimers[prefix]);
      this._likeHoldTimers[prefix] = null;
    }
    if (this._likeHoldFired) {
      this._likeHoldFired[prefix] = false;
    }
    if (resetAnim) {
      const updates = {};
      updates[`${prefix}LikeAnimating`] = false;
      updates[`${prefix}LikeHoldLabel`] = "";
      updates[`${prefix}LikeLabelType`] = "";
      this.setData(updates);
    }
  },

  onMarkerLikeTouchStart(e) {
    const pageFlag = e?.currentTarget?.dataset?.page;
    const forPage = pageFlag === true || pageFlag === "true";
    const prefix = forPage ? "markerPage" : "marker";
    const type = this.data[`${prefix}LikeTargetType`];
    const id = this.data[`${prefix}LikeTargetId`];
    console.log("onMarkerLikeTouchStart", { prefix, type, id });
    if (!type || !id) {
      wx.showToast({ title: "无法点赞", icon: "none" });
      return;
    }
    this.cancelLikeHold(prefix, false);
    this.setData({
      [`${prefix}LikeAnimating`]: true,
      // [`${prefix}LikeHintLabel`]: "长按点赞/取消赞",
      [`${prefix}LikeResultLabel`]: ""
    });
    this._likeHoldFired[prefix] = false;
    const liked = this.data[`${prefix}Liked`];
    const currentCount = Number(this.data[`${prefix}LikeCount`]) || 0;
    const apiBase = this.getApiBase();
    const doToggle = () =>
      liked
        ? unlike(type, id, { apiBase, token: this.getAuthToken() })
        : like(type, id, { apiBase, token: this.getAuthToken() });
    this._likeHoldTimers[prefix] = setTimeout(() => {
      this._likeHoldFired[prefix] = true;
      doToggle()
        .catch((err) => {
          if (err?.message === "missing-token") {
            return this.ensureAccessToken().then(() => doToggle());
          }
          throw err;
        })
        .then(() => {
          const delta = liked ? -1 : 1;
          const nextCount = Math.max(0, currentCount + delta);
          this.applyLikeState(prefix, {
            count: nextCount,
            liked: !liked,
            type,
            id
          });
          const label = liked ? "取消赞" : "点赞+1";
          this.setData({
            [`${prefix}LikeResultLabel`]: label,
            // [`${prefix}LikeHintLabel`]: ""
          });
          setTimeout(() => {
            this.setData({
              [`${prefix}LikeResultLabel`]: ""
            });
          }, 3000);
        })
        .catch((err) => {
          console.warn("like toggle failed", err);
        })
        .finally(() => {
          const done = {};
          done[`${prefix}LikeAnimating`] = false;
          this.setData(done);
          this._likeHoldTimers[prefix] = null;
        });
    }, 10);
  },

  onMarkerLikeTouchEnd(e) {
    const pageFlag = e?.currentTarget?.dataset?.page;
    const forPage = pageFlag === true || pageFlag === "true";
    const prefix = forPage ? "markerPage" : "marker";
    if (!this._likeHoldFired[prefix]) {
      this.cancelLikeHold(prefix, true);
    }
  },

  onLikeCountTap(e) {
    const count = Number(e?.currentTarget?.dataset?.count);
    if (!Number.isFinite(count)) return;
  },


  isPinLayerEnabled() {
    return (
      this.data.privateMarkersEnabled !== false ||
      this.data.groupSharingEnabled !== false ||
      this.data.platformCoConstructionEnabled !== false
    );
  },

  isPinVisibilityEnabled(visibility) {
    const vis = `${visibility || ""}`.toUpperCase();
    if (vis === "PRIVATE") {
      return this.data.privateMarkersEnabled !== false;
    }
    if (vis === "WORKGROUP" || vis === "GROUP" || vis === "TEAM") {
      return this.data.groupSharingEnabled !== false;
    }
    return this.data.platformCoConstructionEnabled !== false;
  },

  normalizeNearbyPin(raw = {}) {
    const shape = raw.shape || {};
    const type = `${shape.type || ""}`.toUpperCase() || "POINT";
    const coordinates = Array.isArray(shape.coordinates) ? shape.coordinates : [];
    const normalizedCoords = coordinates
      .map((coord) => this.normalizePreviewCoordinate(coord))
      .filter(Boolean);
    if (!normalizedCoords.length) return null;
    const name =
      (typeof raw.name === "string" && raw.name) ||
      (typeof raw.title === "string" && raw.title) ||
      "";
    const visibility = `${raw.visibility || raw.scope || ""}`.toUpperCase();
    const heightCandidates = [
      raw.height,
      raw.altitude,
      raw.shape?.height,
      raw.shape?.altitude,
      normalizedCoords[0]?.altitude
    ];
    let height = null;
    for (const candidate of heightCandidates) {
      const num = Number(candidate);
      if (Number.isFinite(num)) {
        height = num;
        break;
      }
    }
    const normalizedShape = {
      type,
      coordinates: normalizedCoords,
      radius: Number(shape.radius ?? shape.radiusKm ?? shape.radiusInKilometers),
      width: Number(shape.width ?? shape.bufferWidth ?? shape.bufferWidthMeters ?? shape.pathDistanceMeters),
      pointCategory: shape.pointCategory || shape.pointcategory
    };
    // console.log(raw)
    return {
      id: raw.pinId ? raw.pinId : raw.markId ? raw.markId : raw.id,
      name,
      visibility,
      shape: normalizedShape,
      location: normalizedCoords[0],
      height,
      raw
    };
  },

  performSearch() {
    const keyword = this.data.keyword.trim();
    // When keyword is empty, clear search-only markers and suggestions
    if (!keyword) {
      this.applySearchMarkers([]);
      this.setData({
        searchSuggestions: [],
        searchSuggestLoading: false,
        searchSuggestError: ""
      });
      return;
    }
    wx.showLoading({ title: "Searching...", mask: true });
    let locationArgs = null;
    const center = this._centerOverride || this.data.center;
    try {
      const centerWgs = center
        ? gcj02ToWgs84(center.longitude, center.latitude)
        : null;
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
    const pinPromise = settleWithValue(
      searchPins(keyword, {
        apiBase: this.getApiBase(),
        limit: MAX_SEARCH_RESULTS
      }),
      {
        defaultValue: [],
        onError: (err) => console.warn("Pin search failed", err)
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
    Promise.all([markerPromise, pinPromise, placePromise])
      .then(([markerResult, pinResult, placeResult]) => {
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
        const pinPayloads = (pinResult.value || [])
          .map((item, index) =>
            this.createPinSearchPayload(item, {
              fallbackId: `pin-search-${index}`
            })
          )
          .filter(Boolean);
        const pinMarkers = pinPayloads
          .map((payload) =>
            this.buildPinSearchMarker(payload, {
              source: "pin-search"
            })
          )
          .filter(Boolean);
        const pinLimited = pinMarkers.slice(
          0,
          Math.max(0, MAX_SEARCH_RESULTS - markerMarkers.length)
        );
        const combined = markerMarkers.concat(pinLimited);
        const remainingSlots = Math.max(
          0,
          MAX_SEARCH_RESULTS - combined.length
        );
        const qqMarkers = (placeResult.value || [])
          .map((poi, index) => this.buildQqSearchMarker(poi, index))
          .filter(Boolean)
          .slice(0, remainingSlots);
        const markers = combined.concat(qqMarkers);
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
    const center = this._centerOverride || this.data.center;
    try {
      const centerWgs = center
        ? gcj02ToWgs84(center.longitude, center.latitude)
        : null;
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
    const pinPromise = settleWithValue(
      searchPins(keyword, {
        apiBase: this.getApiBase(),
        limit: MAX_SEARCH_SUGGESTIONS
      }),
      {
        defaultValue: [],
        onError: (err) => console.warn("Pin suggest search failed", err)
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
    Promise.all([markerPromise, pinPromise, placePromise]).then(
      ([markerResult, pinResult, placeResult]) => {
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
        const pinPayloads = (pinResult.value || [])
          .map((item, index) =>
            this.createPinSearchPayload(item, {
              fallbackId: `pin-suggest-${index}`
            })
          )
          .filter(Boolean);
        const pinSuggestions = pinPayloads
          .map((payload) => this.buildPinSuggestionFromPayload(payload))
          .filter(Boolean)
          .slice(0, Math.max(0, MAX_SEARCH_SUGGESTIONS - markerSuggestions.length));
        const remainingSlots = Math.max(
          0,
          MAX_SEARCH_SUGGESTIONS - markerSuggestions.length - pinSuggestions.length
        );
        const qqSuggestions = (placeResult.value || [])
          .map((poi, index) => this.buildQqSuggestion(poi, index))
          .filter(Boolean)
          .slice(0, remainingSlots);
        const suggestions = markerSuggestions.concat(pinSuggestions, qqSuggestions);
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
        this.fillPinSuggestionAddresses(suggestions, snapshot);
      }
    );
  },

  onSuggestionTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const suggestion = this.data.searchSuggestions?.[idx];
    if (!suggestion) return;
    let marker = null;
    if (suggestion.source === "marker" || suggestion.source === "pin") {
      if (
        Number.isFinite(suggestion.latitude) &&
        Number.isFinite(suggestion.longitude)
      ) {
        this.setData({
          keyword: suggestion.title,
          searchSuggestions: [],
          searchSuggestLoading: false,
          searchSuggestError: ""
        });
        this.centerOnPoint(
          { latitude: suggestion.latitude, longitude: suggestion.longitude },
          15
        );
      }
      return;
    }
    if (suggestion.source === "qqmap" && suggestion.rawPoi) {
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
    if (this.data.loadingDrones) {
      wx.showToast({ title: "机型加载中", icon: "none" });
      return;
    }
    if (!this.data.droneListAvailable) {
      wx.showToast({ title: "机型未提供", icon: "none" });
      return;
    }
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

  onSelectDroneCategory(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(idx)) return;
    const categories = Array.isArray(this.data.droneCategories) ? this.data.droneCategories : [];
    const category = categories[idx];
    if (!category) return;
    this.setData({
      activeDroneCategoryIndex: idx,
      droneCategoryItems: category.items || []
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

  applyDroneByIndex(idx, options = {}) {
    const list = this.getDroneList();
    if (!Array.isArray(list) || !list.length) return;
    const bounded = Math.max(0, Math.min(list.length - 1, idx));
    const drone = list[bounded] || list[0];
    const dronePickerLabel = this.computeDronePickerLabel({
      loadingDrones: false,
      droneListAvailable: true,
      selectedDroneName: drone.name
    });
    const previousSlug = this.data.selectedDrone;
    const changed = drone.slug !== previousSlug;
    const shouldPersist = options.persist !== false;
    const categories = Array.isArray(this.data.droneCategories) ? this.data.droneCategories : [];
    let activeIndex = Number.isFinite(this.data.activeDroneCategoryIndex)
      ? this.data.activeDroneCategoryIndex
      : 0;
    const matchedCategoryIndex = categories.findIndex((category) =>
      Array.isArray(category.items) && category.items.some((item) => item.index === bounded)
    );
    if (matchedCategoryIndex >= 0) {
      activeIndex = matchedCategoryIndex;
    }
    const activeCategory = categories[activeIndex] || categories[0] || { items: [] };

    this.setData({
      activeDroneCategoryIndex: activeIndex,
      droneCategoryItems: activeCategory.items || [],
      selectedDroneIndex: bounded,
      selectedDrone: drone.slug,
      selectedDroneName: drone.name,
      dronePickerLabel
    }, () => {
      if (changed) {
        this.scheduleFetchDji(200, true);
        if (shouldPersist) {
          this.persistMapLayerSettings();
        }
      }
    });
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
      isHighAccuracy: false,
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
      raw?.markIdNew,
      raw?.markId,
      overrides.id,
      raw?.id,
      raw?.markerId,
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
    if (!detail.creatorName) {
      detail.creatorName =
        overrides.creatorName ||
        raw?.creatorName ||
        marker?.creatorName ||
        normalized.creatorName ||
        "";
    }
    if (source) {
      detail.source = source;
    }
    if (!detail.raw) {
      detail.raw = raw;
    }
    if (!detail.reviewStatus) {
      const reviewStatus =
        raw?.reviewStatus ??
        raw?.raw?.reviewStatus ??
        raw?.status ??
        raw?.raw?.status;
      if (reviewStatus !== undefined && reviewStatus !== null && `${reviewStatus}`.trim()) {
        detail.reviewStatus = reviewStatus;
      }
    }
    if (detail.shareDisabled === undefined) {
      const shareDisabled = raw?.shareDisabled ?? raw?.raw?.shareDisabled;
      if (shareDisabled !== undefined) {
        detail.shareDisabled = shareDisabled;
      }
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

  buildPinSuggestionFromPayload(payload) {
    if (!payload) return null;
    if (
      !Number.isFinite(payload.latitude) ||
      !Number.isFinite(payload.longitude)
    ) {
      return null;
    }
    const title = payload.name || payload.locationText || "低空星球标记";
    return {
      id: payload.id || `pin-result-${Date.now()}`,
      title,
      address: payload.locationText || "",
      latitude: payload.latitude,
      longitude: payload.longitude,
      source: "pin",
      pinPayload: payload
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
      marker.callout = buildMarkerNameCallout(calloutContent);
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

  trackPinExposure(markers) {
    if (!Array.isArray(markers) || !markers.length) {
      return;
    }
    if (!this._pinExposureCache) {
      this._pinExposureCache = new Map();
    }
    const now = Date.now();
    this.prunePinExposureCache(now);
    markers.forEach((marker) => {
      const src = `${marker?.extData?.source || marker?.source || ""}`.toLowerCase();
      if (!src.includes("pin")) return;
      const shapeType = `${marker?.extData?.raw?.shape?.type || marker?.shape?.type || ""}`.toUpperCase();
      if (shapeType && shapeType !== "POINT") return;
      const candidateId =
        marker?.extData?.raw?.id ||
        marker?.id ||
        marker?.markerId ||
        marker?.markerID ||
        "";
      const pinId = typeof candidateId === "string" ? candidateId.trim() : `${candidateId || ""}`.trim();
      if (!pinId) return;
      if (pinId.startsWith("nearby-")) return;
      const last = this._pinExposureCache.get(pinId);
      if (Number.isFinite(last) && now - last < MARKER_EXPOSURE_CACHE_TTL) {
        return;
      }
      this._pinExposureCache.set(pinId, now);
      this.incrementPinExposureCount(pinId);
    });
  },

  createPinSearchPayload(raw = {}, options = {}) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    const detail = this.composeMarkerDetail(raw, {}, {
      source: options.source || "pin-search",
      id: raw.id,
      name: raw.name || raw.title,
      locationText: raw.location?.text || raw.address
    });
    const coords = Array.isArray(raw?.shape?.coordinates) ? raw.shape.coordinates : [];
    const primary =
      coords.find((coord) => hasValidCoordinate(coord?.latitude, coord?.longitude)) ||
      detail ||
      {};
    const latitude = Number(primary.latitude);
    const longitude = Number(primary.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    const markerId =
      detail.markerId ||
      detail.id ||
      options.fallbackId ||
      `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id: markerId,
      latitude,
      longitude,
      name: detail.name || "",
      locationText: detail.locationText || "",
      detail: detail,
      raw
    };
  },

  buildPinSearchMarker(payload = {}, options = {}) {
    if (!payload) return null;
    console.log("buildPinSearchMarker", payload);
    const marker = {
      id: payload.id || `pin-${Date.now()}`,
      latitude: payload.latitude,
      longitude: payload.longitude,
      title: payload.name,
      iconPath: "/assets/default.png",
      width: 32,
      height: 32
    };
    const calloutContent = formatNearbyMarkerLabel(payload.name || "");
    if (calloutContent) {
      marker.callout = buildMarkerNameCallout(`${calloutContent}（低空星球）`, {
        color: "#14532d",
        borderColor: "#14532d"
      });
    }
    marker.extData = {
      source: options.source || "pin-search",
      raw: payload.raw || {},
      detail: cloneMarkerDetail(payload.detail || {})
    };
    return marker;
  },

  getAuthToken() {
    const app = getApp ? getApp() : null;
    return (app && app.globalData && app.globalData.token) || "";
  },

  requestProfileSubscriptions() {
    const apiBase = this.getApiBase();
    const token = this.getAuthToken();
    if (!apiBase || !token) return Promise.resolve();
    const clearSubscribeWait = () => {
      setSubscribeWaitOverlay(false);
    };
    const checkSubscriptionsNotFound = () =>
      new Promise((resolve) => {
        wx.request({
          url: `${apiBase}/api/weapp/subscriptions`,
          method: "GET",
          header: {
            "content-type": "application/json",
            Authorization: `Bearer ${token}`
          },
          success: (res) => {
            if (res && res.statusCode === 404) {
              setSubscribeWaitOverlay(true);
            }
            resolve();
          },
          fail: () => resolve()
        });
      });
    return checkSubscriptionsNotFound()
      .then(() => fetchTemplateSettings({ apiBase, token }))
      .then(() => {
        const templateIds = normalizeTemplateIds(REQUIRED_SUBSCRIPTION_TEMPLATE_IDS);
        if (!templateIds.length) return null;
        return requestSubscribeMessageForTemplateIds(templateIds)
          .then(({ acceptedIds }) => {
            if (acceptedIds && acceptedIds.length) {
              return updateSubscriptions(acceptedIds, { apiBase, token }).catch((err) => {
                console.warn("updateSubscriptions after consent failed", err);
                return null;
              });
            }
            return null;
          })
      })
      .catch((err) => {
        console.warn("requestProfileSubscriptions failed", err);
        return null;
      })
      .finally(() => {
        clearSubscribeWait();
        this.evaluateSubscriptionBannerVisibility().catch(() => { });
      });
  },

  onSubscriptionBannerTap() {
    if (this.data.subscriptionBannerLoading) return;
    this.setData({ subscriptionBannerLoading: true });
    this.ensureProfileAuthenticated()
      .then(() => this.openSubscriptionSettingPicker())
      .catch((err) => {
        console.warn("subscription banner auth failed", err);
        wx.showToast({ title: "请先登录后再试", icon: "none" });
      })
      .finally(() => {
        this.setData({ subscriptionBannerLoading: false });
      });
  },

  openSubscriptionSettingPicker(options = {}) {
    const prefAccepted = Array.isArray(options.prefAccepted) ? options.prefAccepted : [];
    return new Promise((resolve) => {
      if (typeof wx.openSetting !== "function") {
        resolve([]);
        return;
      }
      wx.openSetting({
        withSubscriptions: true,
        success: (res = {}) => {
          const mainSwitch = res?.subscriptionsSetting?.mainSwitch;
          const enabled = mainSwitch !== false;
          if (!enabled) {
            this.setGlobalSubscriptionIds([], enabled);
            this.setSubscriptionBannerVisibility(true);
            wx.showToast({ title: "请先开启订阅消息总开关", icon: "none" });
            resolve([]);
            return;
          }
          console.log("res.subscriptionsSetting", res.subscriptionsSetting);
          const ids = extractAcceptedTemplateIdsFromWxSetting(res.subscriptionsSetting) || [];
          const merged = normalizeTemplateIds([...(prefAccepted || []), ...(ids || [])]);
          console.log("openSubscriptionSettingPicker got ids", ids.length, "merged", merged.length);
          const normalized = this.setGlobalSubscriptionIds(merged, enabled);
          const apiBase = this.getApiBase();
          const token = this.getAuthToken();
          const syncPromise =
            normalized.length && apiBase && token
              ? updateSubscriptions(normalized, { apiBase, token }).catch((err) => {
                console.warn("updateSubscriptions after openSetting failed", err);
              })
              : Promise.resolve();
          const finalize = () => {
            const shouldShow = !enabled || !hasAllRequiredSubscriptions(normalized);
            console.log("openSubscriptionSettingPicker accepted ids", normalized.length, "mainSwitch", enabled, "show", shouldShow);
            this.setSubscriptionBannerVisibility(shouldShow);
            if (normalized.length === 0) {
              wx.showToast({ title: "请在设置中开启订阅消息", icon: "none" });
            }
            resolve(normalized);
            // Double-check with backend/state to avoid偶发悬挂
            this.evaluateSubscriptionBannerVisibility().catch(() => { });
          };
          syncPromise.then(finalize).catch(finalize);
        },
        fail: (err) => {
          console.warn("openSubscriptionSettingPicker failed", err);
          wx.showToast({ title: "请在设置里开启订阅消息", icon: "none" });
          this.setSubscriptionBannerVisibility(true);
          resolve([]);
        }
      });
    });
  },

  prefetchSubscriptionLatest() {
    const apiBase = this.getApiBase();
    const token = this.getAuthToken();
    if (!apiBase || !token) return;
    fetchLatestSubscriptionPush({ apiBase, token })
      .then((payload = {}) => {
        const latestVersion = normalizeVersion(payload.version || "");
        const app = typeof getApp === "function" ? getApp() : null;
        if (app && app.globalData) {
          app.globalData.subscriptionLatestVersion = latestVersion;
        }
        if (!latestVersion) return null;
        return fetchLatestItemVersion({
          apiBase,
          token,
          itemId: SUBSCRIPTION_TEMPLATE_ID,
          version: latestVersion
        }).then((result) => {
          const serverVersion = normalizeVersion(result.version || "");
          const hasUpdate = serverVersion !== latestVersion;
          this.updateSubscriptionBadge(hasUpdate);
          if (app && app.globalData) {
            app.globalData.subscriptionFeedHasUpdate = hasUpdate;
          }
          return { latestVersion, serverVersion, hasUpdate };
        });
      })
      .catch((err) => {
        console.warn("prefetchSubscriptionLatest failed", err);
      });
  },

  updateSubscriptionBadge(show) {
    if (typeof show !== "boolean") return;
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) {
      app.globalData.showProfileRedDot = show;
      app.globalData.subscriptionFeedHasUpdate = show;
    }
    this.setData({ showProfileRedDot: show });
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
    const metrics = getWindowMetrics();
    const width = metrics.windowWidth || 375;
    this._pxPerRpx = width / 750;
    const pxPerRpx = this._pxPerRpx || 1;
    this._scaleBarBaseRpx = Math.max(30, Math.round(CSS_PIXELS_PER_CM / pxPerRpx));
    if (metrics.platform) {
      this._isIOS = metrics.platform === "ios";
    }
    const statusBarHeight = Number(metrics.statusBarHeight);
    if (
      Number.isFinite(statusBarHeight)
      && statusBarHeight > 0
      && this.data.statusBarHeight !== statusBarHeight
    ) {
      this.setData({ statusBarHeight });
    }
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

  updateMapGestureState(detail = {}) {
    const now = Date.now();
    const skew = Number(detail?.skew);
    if (Number.isFinite(skew)) {
      const prevSkew = this._mapSkew;
      this._mapSkew = skew;
      if ((Number.isFinite(prevSkew) && prevSkew !== skew) || skew > 0) {
        this._overlookSyncAvoidUntil = now + 400;
      }
    }
    const rotate = Number(detail?.rotate);
    if (Number.isFinite(rotate)) {
      const prevRotate = this._mapRotate;
      this._mapRotate = rotate;
      if (Number.isFinite(prevRotate) && prevRotate !== rotate) {
        this._overlookSyncAvoidUntil = now + 400;
      }
    }
  },

  shouldAvoidCenterSync(options = {}) {
    const cause = typeof options?.cause === "string" ? options.cause.toLowerCase() : "";
    if (cause === "skew" || cause === "rotate" || cause === "overlook") {
      return true;
    }
    if (
      Number.isFinite(this._overlookSyncAvoidUntil) &&
      this._overlookSyncAvoidUntil > Date.now()
    ) {
      return true;
    }
    // iOS map can snap back when syncing center/scale during overlooking or max-zoom gestures.
    if (!this._isIOS) return false;
    if (Number.isFinite(this._mapSkew) && this._mapSkew > 0) return true;
    const rawScale = Number(options?.rawScale);
    const scale = Number(options?.scale);
    if (Number.isFinite(rawScale) && Math.round(rawScale) >= MAP_MAX_SCALE) return true;
    if (Number.isFinite(scale) && Math.round(scale) >= MAP_MAX_SCALE) return true;
    return false;
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
        if (this._uomPlugin && typeof this._uomPlugin.handleRegionChange === "function") {
          this._uomPlugin.handleRegionChange({
            center: point,
            centerPin: point,
            scale: targetScale,
            region: this._lastRegion
          });
        }
        this.updateScaleBar({ scale: targetScale, latitude: point.latitude });
        this.updateCenterPinIndicator();
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
      const detail = e?.detail || {};
      this.updateMapGestureState(detail);
      if (this._pendingRegionUpdates > 0 && (!cause || cause === "update")) {
        this._pendingRegionUpdates = Math.max(0, this._pendingRegionUpdates - 1);
        return;
      }
      // 使用事件内的中心与范围，仅用于刷新覆盖物，避免 setData 改 center 造成回环抖动
      const rawScale = Number(detail.scale);
      const forceScaleSync = Number.isFinite(rawScale) && Math.round(rawScale) > MAP_MAX_SCALE;
      const region = detail && (detail.region || {
        northeast: detail.northeast,
        southwest: detail.southwest
      });
      const cl = detail && (detail.centerLocation || null);
      if (region && region.northeast && region.southwest && cl) {
        const newCenter = { latitude: cl.latitude, longitude: cl.longitude };
        this._centerOverride = newCenter;
        const prevScale = this.data.scale;
        const scale = clampMapScale(detail.scale || prevScale);
        const scaleChanged = scale !== prevScale;
        // console.log("[map] regionchange scale", scale);
        this._lastRegion = region;
        const radius = this.computeRadius({ region });
        this._currentRadius = clampRadius(radius);
        this._currentBounds = this.buildBoundsRect(region, newCenter, this._currentRadius);
        const prevCenter = this.data.center;
        const moveMeters = (prevCenter && hasValidCoordinate(prevCenter.latitude, prevCenter.longitude))
          ? haversineMeters(
            prevCenter.latitude,
            prevCenter.longitude,
            newCenter.latitude,
            newCenter.longitude
          )
          : Number.POSITIVE_INFINITY;
        const centerMoved = !Number.isFinite(moveMeters) || moveMeters >= MIN_CENTER_SYNC_METERS;
        const shouldSync = centerMoved || scale !== this.data.scale;
        const avoidCenterSync = this.shouldAvoidCenterSync({ scale, rawScale, cause });
        if (avoidCenterSync) {
          this.data.center = newCenter;
          this.data.scale = scale;
        }
        const run = (forceRefresh) => {
          if (this._uomPlugin && typeof this._uomPlugin.handleRegionChange === "function") {
            this._uomPlugin.handleRegionChange({ center: newCenter, centerPin: newCenter, scale, region });
          }
          this.requestDjiZones(forceRefresh, newCenter, region, scale);
          this.scheduleFetchMarkers(forceRefresh ? 0 : 200, {
            center: newCenter,
            region,
            scale,
            force: !!forceRefresh
          });
          this.scheduleFetchPins(forceRefresh ? 0 : 200, {
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
          this.updateCenterPinIndicator();
        };
        if (shouldSync || forceScaleSync) {
          if (avoidCenterSync) {
            afterSync();
          } else {
            this.queueRegionUpdateSkip(1);
            this.setData({ center: newCenter, scale }, afterSync);
          }
        } else {
          afterSync();
        }
        if (this._uomPlugin && typeof this._uomPlugin.scheduleFinalRefresh === "function") {
          this._uomPlugin.scheduleFinalRefresh();
        }
        return;
      }
      // 兜底：取中心再刷新（少量机型可能无 centerLocation）
      this.updateCenterAndRadius(detail);
      if (this._uomPlugin && typeof this._uomPlugin.scheduleFinalRefresh === "function") {
        this._uomPlugin.scheduleFinalRefresh();
      }
    }
  },

  onMapUpdated() { },

  updateCenterAndRadius(detail) {
    this.updateMapGestureState(detail);
    const rawScale = Number(detail?.scale);
    const cause = detail?.causedBy || detail?.cause || "";
    const forceScaleSync = Number.isFinite(rawScale) && Math.round(rawScale) > MAP_MAX_SCALE;
    this.mapCtx.getCenterLocation({
      type: "gcj02",
      success: (res) => {
        const newCenter = {
          latitude: res.latitude,
          longitude: res.longitude
        };
        this._centerOverride = newCenter;
        const scale = clampMapScale(detail?.scale || this.data.scale);
        const avoidCenterSync = this.shouldAvoidCenterSync({ scale, rawScale, cause });
        // cache region for WMS tiling
        this._lastRegion = detail?.region || null;
        const prevCenter = this.data.center;
        const moveMeters = (prevCenter && hasValidCoordinate(prevCenter.latitude, prevCenter.longitude))
          ? haversineMeters(
            prevCenter.latitude,
            prevCenter.longitude,
            newCenter.latitude,
            newCenter.longitude
          )
          : Number.POSITIVE_INFINITY;
        const centerMoved = !Number.isFinite(moveMeters) || moveMeters >= MIN_CENTER_SYNC_METERS;
        const needSync = centerMoved || scale !== this.data.scale;
        if (avoidCenterSync) {
          this.data.center = newCenter;
          this.data.scale = scale;
        }
        const run = () => {
          const radius = this.computeRadius(detail);
          this._currentRadius = clampRadius(radius);
          this._currentBounds = this.buildBoundsRect(
            detail?.region,
            newCenter,
            this._currentRadius
          );
          if (this._uomPlugin && typeof this._uomPlugin.handleRegionChange === "function") {
            this._uomPlugin.handleRegionChange({
              center: newCenter,
              centerPin: newCenter,
              scale,
              region: detail?.region
            });
          }
          this.scheduleFetchMarkers(0, {
            center: newCenter,
            region: detail?.region,
            scale,
            force: true
          });
          this.scheduleFetchPins(0, {
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
          this.updateCenterPinIndicator();
        };
        if (needSync || forceScaleSync) {
          if (avoidCenterSync) {
            afterUpdate();
          } else {
            this.queueRegionUpdateSkip(1);
            this.setData({ center: newCenter, scale }, afterUpdate);
          }
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

  scheduleFetchPins(delay = 0, options = {}) {
    if (!this.isPinLayerEnabled()) {
      return;
    }
    if (this._pinsFetchTimer) clearTimeout(this._pinsFetchTimer);
    const ms = Math.max(0, Number(delay) || 0);
    const merged = Object.assign({}, options, { force: options.force === true });
    this._pinsFetchTimer = setTimeout(() => {
      this._pinsFetchTimer = null;
      this.requestNearbyPins(merged);
    }, ms);
  },

  scheduleFetchMarkers(delay = 0, options = {}) {
    if (this.data.merchantMarkersEnabled === false) return;
    if (this._markersFetchTimer) clearTimeout(this._markersFetchTimer);
    const ms = Math.max(0, Number(delay) || 0);
    this._markersFetchTimer = setTimeout(() => {
      this._markersFetchTimer = null;
      this.requestNearbyMarkers(options);
    }, ms);
  },

  scheduleFetchNoFlyZones(delay = 0, options = {}) {
    if (this.data.temporaryNoFlyZoneEnabled === false) return;
    if (this._nfzFetchTimer) clearTimeout(this._nfzFetchTimer);
    const ms = Math.max(0, Number(delay) || 0);
    this._nfzFetchTimer = setTimeout(() => {
      this._nfzFetchTimer = null;
      this.requestNearbyNoFlyZones(options);
    }, ms);
  },

  scheduleFetchDji(delay = 300, force = false) {
    if (this.data.djiNoFlyZoneEnabled === false) return;
    if (this._fetchTimer) clearTimeout(this._fetchTimer);
    this._fetchTimer = setTimeout(() => {
      this._fetchTimer = null;
      this.requestDjiZones(force);
    }, delay);
  },

  requestNearbyPins(options = {}) {
    if (!this.isPinLayerEnabled()) {
      if (this._pinsFetchTimer) {
        clearTimeout(this._pinsFetchTimer);
        this._pinsFetchTimer = null;
      }
      this._nearbyPinsRaw = [];
      this._nearbyPinMarkers = [];
      this._nearbyPinPolygons = [];
      this._nearbyPinCircles = [];
      this._lastNearbyPinFetch = null;
      this.updateOverlayGraphics();
      this.syncAllMarkers();
      this.updateCenterPinIndicator();
      return;
    }
    const center = options?.center || this._centerOverride || this.data.center;
    if (!center) return;
    const scale = options?.scale || this.data.scale;
    const region = options?.region || this._lastRegion;
    const force = options.force === true;
    if (!force && !this.shouldFetchNearbyMarkers(scale, center.latitude)) {
      if (Array.isArray(this._nearbyPinsRaw) && this._nearbyPinsRaw.length) {
        this._nearbyPinsRaw = [];
        this._nearbyPinMarkers = [];
        this._nearbyPinPolygons = [];
        this._nearbyPinCircles = [];
        this.updateOverlayGraphics();
        this.syncAllMarkers();
      }
      this._lastNearbyPinFetch = null;
      return;
    }
    const radiusKm = this.computeMarkerRadiusKm({ region, scale });
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) return;

    const latitude = Number(center.latitude);
    const longitude = Number(center.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    const prev = this._lastNearbyPinFetch || {};
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
    if (!force && moveMeters < 50 && radiusDiff < 0.2 && !isStale) {
      return;
    }

    const requestId = now;
    this._activePinsRequest = requestId;

    fetchNearbyPins(
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
        if (this._activePinsRequest !== requestId) return;
        this.applyNearbyPins(Array.isArray(items) ? items : []);
        this._lastNearbyPinFetch = {
          latitude: center.latitude,
          longitude: center.longitude,
          radiusKm,
          scale: clampMapScale(scale),
          timestamp: now
        };
      })
      .catch((err) => {
        console.warn("Fetch nearby pins failed", err);
      })
      .finally(() => {
        if (this._activePinsRequest === requestId) {
          this._activePinsRequest = null;
        }
      });
  },

  requestNearbyMarkers(options = {}) {
    if (this.data.merchantMarkersEnabled === false) {
      this._nearbyMarkers = [];
      this.syncAllMarkers();
      return;
    }
    const center = options?.center || this._centerOverride || this.data.center;
    if (!center) return;
    const scale = options?.scale || this.data.scale;
    const region = options?.region || this._lastRegion;
    const force = options.force === true;
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
    if (!force && moveMeters < 50 && radiusDiff < 0.2 && !isStale) {
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
            // console.log("name,", name);
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
              marker.callout = buildMarkerNameCallout(calloutContent);
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
    if (this.data.temporaryNoFlyZoneEnabled === false) {
      this._noFlyZones = [];
      this._nfzPolygons = [];
      this._nfzCircles = [];
      this._noFlyZoneShapes = [];
      this._noFlyZonesReady = false;
      this._lastNoFlyFetch = null;
      this.updateOverlayGraphics();
      return;
    }
    const force = options.force === true;
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
    if (!force && moveMeters < 50 && radiusDiff < 0.2 && !isStale) {
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
    if (this.data.djiNoFlyZoneEnabled !== false && Array.isArray(this._djiPolygons)) {
      polygons.push(...this._djiPolygons);
    }
    if (this.data.temporaryNoFlyZoneEnabled !== false && Array.isArray(this._nfzPolygons)) {
      polygons.push(...this._nfzPolygons);
    }
    if (this.data.djiNoFlyZoneEnabled !== false && Array.isArray(this._djiCircles)) {
      circles.push(...this._djiCircles);
    }
    if (this.data.temporaryNoFlyZoneEnabled !== false && Array.isArray(this._nfzCircles)) {
      circles.push(...this._nfzCircles);
    }
    if (Array.isArray(this._nearbyPinPolygons)) {
      polygons.push(...this._nearbyPinPolygons);
    }
    if (Array.isArray(this._nearbyPinCircles)) {
      circles.push(...this._nearbyPinCircles);
    }
    if (Array.isArray(this._previewPolygons)) {
      polygons.push(...this._previewPolygons);
    }
    if (Array.isArray(this._previewCircles)) {
      circles.push(...this._previewCircles);
    }
    this.setData({ polygons, circles });
  },

  requestDjiZones(force, centerOverride, regionOverride, scaleOverride) {
    if (this.data.djiNoFlyZoneEnabled === false) {
      this._djiPolygons = [];
      this._djiCircles = [];
      this._djiZonesReady = false;
      this._lastFetch = null;
      this._lastAreas = null;
      this.updateOverlayGraphics();
      return;
    }
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
        // console.log("areas", areas);
        const graphics = buildAreaGraphics(areas);
        this._lastAreas = areas;
        this.updateStatusPanel(areas);
        this._djiPolygons = graphics.polygons || [];
        this._djiCircles = graphics.circles || [];
        this._djiZonesReady = true;
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
        this._djiZonesReady = false;
      })
      .finally(() => {
        this.setData({ loadingDji: false });
      });
  },

  updateStatusPanel(areas) {
    const resolved = typeof areas === "undefined" ? this._lastAreas : areas;
    const dji = this.describeDjiStatus(resolved);
    const temporary = this.describeTemporaryNoFlyStatus();
    this.setData({
      djiStatus: dji.status,
      djiStatusExtra: dji.extra,
      djiTone: dji.tone,
      djiColor: dji.color || "",
      temporaryNoFlyZoneInfo: temporary.zoneInfo,
      temporaryNoFlyText: temporary.text,
      temporaryNoFlyTone: temporary.tone
    });
  },

  describeDjiStatus(areas) {
    if (this.data.djiNoFlyZoneEnabled === false) {
      return { status: "已禁用", extra: "", tone: "warn", color: "#f59e0b" };
    }
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
    if (this.data.temporaryNoFlyZoneEnabled === false) {
      return { zoneInfo: null, text: "已禁用", tone: "warn" };
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
      return { zoneInfo: null, text: "", tone: "safe" };
    }
    const rawName = typeof hit.zone?.name === "string" ? hit.zone.name.trim() : "";
    const name = rawName || "临时禁飞区";
    const displayName = formatTemporaryZoneLabel(name);
    const rawLink = typeof hit.zone?.wechatLink === "string" ? hit.zone.wechatLink.trim() : "";
    const validLink = /^https?:\/\/mp\.weixin\.qq\.com\//.test(rawLink) ? rawLink : "";
    const linkPath = validLink
      ? `/packages/city-report/h5/index?url=${encodeURIComponent(validLink)}`
      : "";
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


});


