const { fetchDrones } = require("../../utils/drones");
const { searchPlaces } = require("../../utils/search");
const {
  fetchNearbyMarkers,
  searchMarkers,
  buildFileDownloadUrl,
  buildFileStreamUrl
} = require("../../utils/markers");
const { fetchNearbyPins, searchPins } = require("../../utils/pins");
const {
  normalizeMarkerDetail: normalizeMarkerDetailUtil,
} = require("../../utils/marker-detail");
const { reverseGeocode } = require("../../utils/geocoder");
const {
  parseCoordinateSearchKeyword,
  buildCoordinateSuggestion,
  convertParsedCoordinateToGcj02,
  SEARCH_COORDINATE_TIPS_TEXT
} = require("../../utils/coordinate-search");
const {
  buildNoFlyZoneGraphics
} = require("../../utils/no-fly-zones");
const {
  haversineMeters,
  gcj02ToWgs84,
  wgs84ToGcj02,
  gcj02ToBd09,
  gcj02ToCgcs2000
} = require("../../utils/coords");
const {
  computeGreatCircleDistance
} = require("../../utils/distance");
const { QQMAP_CUSTOM_STYLE_ID, MAP_DEBUG_PANEL_ENABLED } = require("../../utils/config");
const { getMapKeySync, prefetchMapKey } = require("../../utils/map-key");
const {
  loadStoredProfile: loadStoredProfileUtil,
  prepareAvatarForUpload,
  fetchUserProfile
} = require("../../utils/profile");
const {
  fetchLatestUserAgreement,
  fetchLatestPrivacyPolicy,
  extractPolicyAccessVersions,
  normalizePolicyVersion,
  recordPolicyAccess
} = require("../../utils/policies");
const {
  appendInviteCodeToPath,
  appendInviteCodeToQuery,
  getShareInviteCode: getShareInviteCodeUtil
} = require("../../utils/share");
const {
  fetchCoordinateSystemDescription,
  fetchCoordinateLongPressGuide
} = require("../../utils/map-guides");
const { transformHtmlContent } = require("../../utils/open-platform");
const {
  fetchTencentCosConfig,
  fetchTencentCosSts,
  buildCosHost,
  isTencentCosStsValid,
  buildTencentCosSignedUrl
} = require("../../utils/tencent-cos");
const {
  DISPLAY_MODE_ICON_WITH_NAME,
  DISPLAY_MODE_SMALL_ICON_ONLY,
  DISPLAY_MODE_HIDDEN,
  resolveMapDisplayMode,
  getDisplayModeMarkerSize
} = require("../../utils/map-display-mode");
const {
  normalizeMapTapPoint,
  canReplaceMapTapTarget,
  buildMapTapTargetState,
  updateMapTapTargetAddress,
  buildMapTapTargetMarker,
  isMapTapTargetMarker,
  shouldRemoveMapTapTarget
} = require("../../utils/map-target-link");
const cityReportUtils = require("./utils/city-report");
const layerPanelUtils = require("./utils/layer-panel");
const dronePickerUtils = require("./utils/drone-picker");
const floatingControlsUtils = require("./utils/floating-controls");
const bottomNavUtils = require("./utils/bottom-nav");
const preflightDashboardUtils = require("./utils/preflight-dashboard");
const locationUtils = require("./utils/location");
const lifecycleUtils = require("./utils/lifecycle");
const bootstrapUtils = require("./utils/bootstrap");
const compassUtils = require("./utils/compass");
const engagementUtils = require("./utils/engagement");
const workgroupUtils = require("./utils/workgroup");
const cleanupUtils = require("./utils/cleanup");
const debugUtils = require("./utils/debug");
const subscriptionUtils = require("./utils/subscription");
const shareLaunchUtils = require("./utils/share-launch");
const markerDetailStateUtils = require("./utils/marker-detail-state");
const markerActionsUtils = require("./utils/marker-actions");
const centerHitUtils = require("./utils/center-hit");
const centerPinActionsUtils = require("./utils/center-pin-actions");
const centerPinFollowUtils = require("./utils/center-pin-follow");

const DEFAULT_CENTER = {
  latitude: 39.908823,
  longitude: 116.39747
};

const DEFAULT_LEVELS_PARAM = "2,6,1,4,3,7,8,10";
const ACCESS_TOKEN_STORAGE_KEY = "accessToken";
const MAP_LAST_LOCATION_STORAGE_KEY = "map.lastKnownLocation";
const PANORAMA_DEMO_FILE = "ex.jpg";
const PANORAMA_FALLBACK_ASSET = "/assets/ex.jpg";
const MAP_MIN_SCALE = 0;
const MAP_MAX_SCALE = 18;
const DEFAULT_MAP_SCALE = 11;
const MARKER_SVIP_ICON_PATH = "/assets/svip2.png";
const MARKER_CERTIFICATION_INFO_ITEMS = [
  {
    id: "location",
    icon: "/assets/position-2.png",
    title: "位置准确",
    description: "校验店铺位置，导航更准确"
  },
  {
    id: "auth",
    icon: "/assets/w-check.png",
    title: "信息真实有效",
    description: "每年认证，人工严格校验信息有效性"
  },
  {
    id: "more",
    icon: "/assets/more.png",
    title: "更丰富的产品业务资料",
    description: "主页提供更丰富的案例、产品文档等展示"
  }
];

const MAX_SEARCH_SUGGESTIONS = 10;
const MAX_SEARCH_RESULTS = 20;
const EARTH_RADIUS_METERS = 6378137;
const EARTH_CIRCUMFERENCE = 2 * Math.PI * EARTH_RADIUS_METERS;
const WEB_TILE_SIZE = 256;
const METERS_PER_PIXEL_BASE = EARTH_CIRCUMFERENCE / WEB_TILE_SIZE;
const CSS_PIXELS_PER_CM = 96 / 2.54;
const DEFAULT_SCALE_BAR_BASE_RPX = 80;
const LOCATE_SCALE_METERS = 500;
const MY_LOCATION_MARKER_ID = 991001;
const MY_LOCATION_MARKER_ICON_PATH = "/assets/p-point.png";
const MY_LOCATION_MARKER_SIZE = 40;
const MY_LOCATION_DIRECTION_THRESHOLD = 1;
const MY_LOCATION_DIRECTION_SYNC_INTERVAL_MS = 500;
const MARKER_FETCH_SCALE_LIMIT_METERS = 5000;
const MIN_CENTER_SYNC_METERS = 6;
const CENTER_PIN_FOLLOW_TIP_TEXT = "长按解除绑定状态~";
const MAP_WIDE_LAYOUT_MIN_WIDTH = 560;
const MAP_WIDE_LAYOUT_MIN_RATIO = 1.1;
const WINDOW_RESIZE_DEBOUNCE_MS = 80;
const DEFAULT_MAP_CHECKIN_ENTRY_STYLE =
  "top: calc(env(safe-area-inset-top) + 96rpx); right: 24rpx; width: 150rpx; height: 50rpx;";
const MAP_UI_BASE_WIDTH_PX = 375;
const MAP_UI_SCALE_MIN = 0.35;
const MAP_COMPASS_ROTATE_THRESHOLD = 1;
const MAP_COMPASS_ROTATE_SYNC_DELTA = 1;
const MAP_COMPASS_SKEW_SYNC_DELTA = 0.5;
const ADD_MINI_APP_SUPPRESS_SECONDS = 72 * 60 * 60;
const ADD_MINI_APP_CHECK_DELAY_MS = 2000;
const MAP_USE_PLANET_MY_LOCATION_STORAGE_KEY = "map.usePlanetMyLocationPoint";
const MAP_LAYER_EXTRA_CONFIG_DISABLE_CENTER_TARGET_LINK_KEY = "disableCenterTargetLinkDistance";
const MAP_LAYER_EXTRA_CONFIG_ENABLE_PROVINCE_CITY_HIGHLIGHT_KEY = "enableProvinceCityHighlight";
const MAP_LAYER_EXTRA_CONFIG_PROVINCE_CITY_HIGHLIGHT_SELECTION_KEY = "provinceCityHighlightSelection";
const SEARCH_LINK_OWNER_SEARCH = "search";
const SEARCH_LINK_OWNER_MAP_TAP = "map-tap";
const KML_SHAPE_TYPES = new Set(["KML", "KMZ"]);

const isKmlShapeType = (value) => KML_SHAPE_TYPES.has(`${value || ""}`.toUpperCase());

const normalizeStyleColorToTransparent = (value) => {
  if (typeof value !== "string") return value;
  const raw = value.trim();
  if (!raw) return value;
  const lower = raw.toLowerCase();
  if (lower === "transparent") return value;
  if (lower.startsWith("rgba")) {
    const match = lower.match(/rgba\(([^)]+)\)/);
    if (match && match[1]) {
      const parts = match[1].split(",").map((p) => p.trim());
      const alpha = Number(parts[3]);
      if (Number.isFinite(alpha) && alpha <= 0) return value;
    }
    return "rgba(0,0,0,0)";
  }
  if (lower.startsWith("rgb(") || lower.startsWith("hsl(") || lower.startsWith("hsla")) {
    return "rgba(0,0,0,0)";
  }
  if (lower.startsWith("#")) {
    if (lower.length === 9) {
      const hex = lower.slice(1);
      if (hex.startsWith("00") || hex.endsWith("00")) return value;
    }
    return "#00000000";
  }
  return "transparent";
};

const normalizeKmlStyle = (style) => {
  if (!style || typeof style !== "object") return style;
  const next = Object.assign({}, style);
  const colorKeys = ["color", "fillColor", "strokeColor", "lineColor", "polyColor", "outlineColor"];
  colorKeys.forEach((key) => {
    if (typeof next[key] === "string") {
      next[key] = normalizeStyleColorToTransparent(next[key]);
    }
  });
  return next;
};

const normalizeKmlShape = (shape = {}) => {
  if (!shape || typeof shape !== "object") return shape;
  const type = `${shape.type || ""}`.toUpperCase();
  if (!isKmlShapeType(type)) return shape;
  const style = normalizeKmlStyle(shape.style);
  if (style === shape.style) return shape;
  return Object.assign({}, shape, { style });
};

const flattenCoordinateList = (raw) => {
  if (!Array.isArray(raw) || !raw.length) return [];
  if (
    Array.isArray(raw[0]) &&
    raw[0].length &&
    (Array.isArray(raw[0][0]) || (raw[0][0] && typeof raw[0][0] === "object"))
  ) {
    return raw[0];
  }
  return raw;
};

const resolveCoordinateGroup = (shape = {}) => {
  const groups = shape.coordinateGroups || shape.coordinateGroup;
  if (!groups) return null;
  if (Array.isArray(groups)) return { type: "", coordinates: groups };
  if (typeof groups !== "object") return null;
  const entries = Object.entries(groups).filter(([, value]) => Array.isArray(value) && value.length);
  if (!entries.length) return null;
  const findBy = (keys = []) =>
    entries.find(([key]) => keys.some((target) => key.toLowerCase().includes(target)));
  const polygon = findBy(["polygon", "poly", "area"]);
  if (polygon) return { type: "POLYGON", coordinates: polygon[1] };
  const line = findBy(["line", "path"]);
  if (line) return { type: "LINE", coordinates: line[1] };
  const point = findBy(["point"]);
  if (point) return { type: "POINT", coordinates: point[1] };
  const first = entries[0];
  return { type: "", coordinates: first[1] };
};

const resolvePinVideoRef = (raw = {}) => {
  if (!raw || typeof raw !== "object") return "";
  const candidates = [
    raw.videoLink,
    raw.video,
    raw.videoUrl,
    raw.videoFileName,
    raw.videoPath,
    raw.videoName,
    raw.media?.videoLink,
    raw.media?.video,
    raw.content?.videoLink
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (candidate && typeof candidate === "object") {
      const nested =
        candidate.url ||
        candidate.fileName ||
        candidate.filename ||
        candidate.objectName ||
        candidate.path ||
        "";
      if (typeof nested === "string" && nested.trim()) {
        return nested.trim();
      }
    }
  }
  return "";
};

const resolvePinVideoUrl = (videoRef = "", options = {}) => {
  const ref = typeof videoRef === "string" ? videoRef.trim() : "";
  if (!ref) return "";
  const cosHost = `${options.cosHost || ""}`.trim();
  const isOldSignedCosUrl = /^https?:\/\//i.test(ref) && /[?&]q-sign-algorithm=/i.test(ref);
  if (options.isSCos && cosHost && options.cosSts) {
    return buildTencentCosSignedUrl(ref, {
      host: cosHost,
      sts: options.cosSts
    }) || ref;
  }
  if (options.isSCos && isOldSignedCosUrl) {
    return "";
  }
  if (/^https?:\/\//i.test(ref)) {
    return ref;
  }
  if (options.isSCos && cosHost) {
    return `https://${cosHost}/${ref.replace(/^\/+/, "")}`;
  }
  return buildFileStreamUrl(ref, { apiBase: options.apiBase });
};

const resolveShapeCoordinates = (shape = {}) => {
  const baseType = `${shape.type || ""}`.toUpperCase();
  let coordinates = Array.isArray(shape.coordinates) ? shape.coordinates : [];
  let resolvedType = baseType || "POINT";
  if (!coordinates.length) {
    const grouped = resolveCoordinateGroup(shape);
    if (grouped && Array.isArray(grouped.coordinates) && grouped.coordinates.length) {
      coordinates = grouped.coordinates;
      if (grouped.type) resolvedType = grouped.type;
    }
  }
  if (isKmlShapeType(baseType) && resolvedType === baseType) {
    const radius = Number(shape.radius);
    const width = Number(shape.width);
    if (Number.isFinite(radius) && radius > 0) {
      resolvedType = "CIRCLE";
    } else if (Number.isFinite(width) && width > 0) {
      resolvedType = "LINE";
    } else if (Array.isArray(coordinates) && coordinates.length <= 1) {
      resolvedType = "POINT";
    } else if (coordinates.length) {
      resolvedType = "POLYGON";
    }
  }
  return { coordinates: flattenCoordinateList(coordinates), resolvedType };
};

const clampMapScale = (value) => {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : DEFAULT_MAP_SCALE;
  const rounded = Math.round(base);
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, rounded));
};

const clampMapScaleFloat = (value) => {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : DEFAULT_MAP_SCALE;
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, base));
};

const normalizeMapRotate = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  let normalized = numeric % 360;
  if (normalized < 0) normalized += 360;
  if (Math.abs(normalized - 360) < 0.0001) normalized = 0;
  return normalized;
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

const readResizeWindowSize = (event = {}) => {
  if (!event || typeof event !== "object") {
    return { windowWidth: null, windowHeight: null };
  }
  let size = event.size || null;
  if (Array.isArray(size)) {
    size = size[0] || null;
  }
  if (!size || typeof size !== "object") {
    size = event;
  }
  const windowWidth = Number(size.windowWidth || size.width);
  const windowHeight = Number(size.windowHeight || size.height);
  return {
    windowWidth: Number.isFinite(windowWidth) && windowWidth > 0 ? windowWidth : null,
    windowHeight: Number.isFinite(windowHeight) && windowHeight > 0 ? windowHeight : null
  };
};

const resolveWideLayout = (metrics = {}) => {
  const width = Number(metrics.windowWidth);
  const height = Number(metrics.windowHeight);
  if (!Number.isFinite(width) || width <= 0) {
    return false;
  }
  if (width >= MAP_WIDE_LAYOUT_MIN_WIDTH) {
    return true;
  }
  if (Number.isFinite(height) && height > 0) {
    return width / height >= MAP_WIDE_LAYOUT_MIN_RATIO;
  }
  return false;
};

const resolveMapUiScale = (metrics = {}, wideLayout = false) => {
  const width = Number(metrics.windowWidth);
  if (!wideLayout || !Number.isFinite(width) || width <= 0) {
    return 1;
  }
  const scale = MAP_UI_BASE_WIDTH_PX / width;
  if (!Number.isFinite(scale) || scale <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(MAP_UI_SCALE_MIN, scale));
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

const resolveScaleBarDisplay = ({ rawMeters, metersPerPixel, pxPerRpx, baseRpx }) => {
  if (!Number.isFinite(rawMeters) || rawMeters <= 0) {
    return { label: "", widthRpx: Math.max(30, Number(baseRpx) || DEFAULT_SCALE_BAR_BASE_RPX), meters: 0 };
  }
  const nice = pickScaleBarLength(rawMeters);
  const meters = Number.isFinite(nice?.length) && nice.length > 0 ? nice.length : rawMeters;
  const label = nice.label || formatScaleLabel(meters);
  const computedWidthRpx =
    Number.isFinite(metersPerPixel) && metersPerPixel > 0 && Number.isFinite(pxPerRpx) && pxPerRpx > 0
      ? meters / metersPerPixel / pxPerRpx
      : baseRpx;
  const maxWidthRpx = Math.max(30, Number(baseRpx) || DEFAULT_SCALE_BAR_BASE_RPX);
  const widthRpx = Math.min(maxWidthRpx, Math.max(30, Math.round(computedWidthRpx * 10) / 10));
  return {
    label,
    widthRpx,
    meters
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

const formatCoordinateDisplayParts = (lat, lng) => {
  const parts = formatCoordinateParts(lat, lng);
  if (!parts) return null;
  const latNum = Number(lat);
  const lngNum = Number(lng);
  return {
    lngText: `${parts.lngText}°${lngNum >= 0 ? "E" : "W"}`,
    latText: `${parts.latText}°${latNum >= 0 ? "N" : "S"}`
  };
};

const formatDmsUnit = (value) => {
  const abs = Math.abs(Number(value) || 0);
  const degree = Math.floor(abs);
  const minuteFloat = (abs - degree) * 60;
  const minute = Math.floor(minuteFloat);
  const second = (minuteFloat - minute) * 60;
  const secondText = Number(second.toFixed(2)).toString();
  return `${degree}°${minute}'${secondText}"`;
};

const formatCoordinateDms = (value, axis) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const direction =
    axis === "lng"
      ? (numeric >= 0 ? "东经" : "西经")
      : (numeric >= 0 ? "北纬" : "南纬");
  return `${direction}${formatDmsUnit(numeric)}`;
};

const normalizeAddressText = (value) => {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
};

const COORDINATE_SYSTEM_OPTIONS = [
  { value: "gcj02", label: "GCJ-02" },
  { value: "bd09", label: "BD09" },
  { value: "wgs84", label: "WGS84" },
  { value: "cgcs2000", label: "CGCS2000" }
];

const COORDINATE_SYSTEM_DISPLAY_LABEL_MAP = {
  gcj02: "gcj-02",
  bd09: "bd09",
  wgs84: "wgs84",
  cgcs2000: "cgcs2000"
};

const COORDINATE_SYSTEM_CLIPBOARD_LABEL_MAP = {
  gcj02: "GCJ-02",
  bd09: "BD09",
  wgs84: "WGS84",
  cgcs2000: "CGCS2000"
};

const normalizeCoordinateSystem = (value) => {
  const raw = `${value || ""}`.toLowerCase();
  return COORDINATE_SYSTEM_OPTIONS.some((item) => item.value === raw) ? raw : "gcj02";
};

const resolveCoordinateSystemDisplayLabel = (coordinateSystem) =>
  COORDINATE_SYSTEM_DISPLAY_LABEL_MAP[normalizeCoordinateSystem(coordinateSystem)] || "gcj-02";

const resolveCoordinateSystemLabel = (coordinateSystem) =>
  COORDINATE_SYSTEM_CLIPBOARD_LABEL_MAP[normalizeCoordinateSystem(coordinateSystem)] || "GCJ-02";

const convertCoordinateFromGcj02 = (lng, lat, coordinateSystem = "gcj02") => {
  const baseLng = Number(lng);
  const baseLat = Number(lat);
  if (!Number.isFinite(baseLng) || !Number.isFinite(baseLat)) return null;
  const normalized = normalizeCoordinateSystem(coordinateSystem);
  let converted = { lng: baseLng, lat: baseLat };
  if (normalized === "wgs84") {
    converted = gcj02ToWgs84(baseLng, baseLat);
  } else if (normalized === "bd09") {
    converted = gcj02ToBd09(baseLng, baseLat);
  } else if (normalized === "cgcs2000") {
    converted = gcj02ToCgcs2000(baseLng, baseLat);
  }
  const outLng = Number(converted?.lng);
  const outLat = Number(converted?.lat);
  if (!Number.isFinite(outLng) || !Number.isFinite(outLat)) {
    return { lng: baseLng, lat: baseLat };
  }
  return { lng: outLng, lat: outLat };
};

const buildCoordinateClipboardText = ({
  lat,
  lng,
  coordinateSystem = "gcj02",
  address = ""
} = {}) => {
  const decimal = formatCoordinateParts(lat, lng);
  if (!decimal) return "";
  const lngDms = formatCoordinateDms(lng, "lng");
  const latDms = formatCoordinateDms(lat, "lat");
  const normalizedAddress = normalizeAddressText(address);
  const lines = [
    `坐标系：${resolveCoordinateSystemLabel(coordinateSystem)}`,
    `经度(十进制)：${decimal.lngText}`,
    `纬度(十进制)：${decimal.latText}`,
    `经度(时分秒)：${lngDms || "-"}`,
    `纬度(时分秒)：${latDms || "-"}`,
    `详细地址：${normalizedAddress || "未获取到地址"}`
  ];
  return lines.join("\n");
};

const mergeLaunchOptions = (primary = {}, secondary = {}) => {
  const merged = Object.assign({}, primary || {}, secondary || {});
  const primaryQuery = primary?.query && typeof primary.query === "object" ? primary.query : {};
  const secondaryQuery = secondary?.query && typeof secondary.query === "object" ? secondary.query : {};
  const query = Object.assign({}, primaryQuery, secondaryQuery);
  if (Object.keys(query).length) {
    merged.query = query;
  }
  return merged;
};

const resolveEventDataset = (event = {}) => {
  const currentTargetDataset = event?.currentTarget?.dataset;
  if (currentTargetDataset && typeof currentTargetDataset === "object") {
    return currentTargetDataset;
  }
  const detailDataset = event?.detail?.dataset;
  if (detailDataset && typeof detailDataset === "object") {
    return detailDataset;
  }
  return {};
};

const resolveEventTouches = (event = {}) => {
  if (Array.isArray(event?.touches) && event.touches.length) {
    return event.touches;
  }
  if (Array.isArray(event?.detail?.touches) && event.detail.touches.length) {
    return event.detail.touches;
  }
  return [];
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
    mapCenterReady: false,
    scale: DEFAULT_MAP_SCALE,
    minScale: MAP_MIN_SCALE,
    maxScale: MAP_MAX_SCALE,
    mapSubKey: getMapKeySync(),
    customMapStyleId: QQMAP_CUSTOM_STYLE_ID || "",
    isWideLayout: false,
    mapUiScale: 1,
    mapUiScaleStyle: "",
    subscriptionBannerScaleStyle: "transform: translateY(-50%); transform-origin: left center;",
    layerPanelMaxHeightPx: 0,
    layerPanelBodyMaxHeightPx: 0,
    layerPanelBodyHeightPx: 0,
    statusBarHeight: 0,
    centerPinOffsetPx: 0,
    markers: [],
    polylines: [],
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
    checkinTodaySigned: false,
    checkinEntryStyle: DEFAULT_MAP_CHECKIN_ENTRY_STYLE,
    uomStatus: "评估中",
    uomTone: "neutral",
    uomLoading: false,
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
    centerPinFollowActive: false,
    centerPinFollowTipText: CENTER_PIN_FOLLOW_TIP_TEXT,
    centerPinWelcomeBubbleDismissToken: 0,
    centerCoordinateLatText: "",
    centerCoordinateLngText: "",
    centerCoordinateLatValue: null,
    centerCoordinateLngValue: null,
    coordinateSystem: "wgs84",
    coordinateSystemLabel: resolveCoordinateSystemDisplayLabel("wgs84"),
    coordinateSystemOptions: COORDINATE_SYSTEM_OPTIONS,
    coordinateSystemSheetVisible: false,
    coordinateSystemDescriptionNodes: "",
    coordinateLongPressGuideNodes: "",
    searchSuggestions: [],
    searchSuggestLoading: false,
    searchSuggestError: "",
    searchCoordinateTipsVisible: false,
    searchCoordinateTipsText: SEARCH_COORDINATE_TIPS_TEXT,
    myLocationPoint: null,
    myLocationVisible: false,
    searchLinkCenter: null,
    searchLinkTarget: null,
    searchLinkVisible: false,
    centerPinLinkActive: false,
    centerPinLinkTipText: "",
    cityReportCenter: null,
    cityReportDialogVisible: false,
    cityReportDialogText: "",
    dronePickerVisible: false,
    pendingDroneIndex: null,
    showDashboardPanel: true,
    stealthModeActive: false,
    activeTab: "home",
    showProfileRedDot: false,
    showNewbieGiftEntry: false,
    newbieTaskBlockerVisible: false,
    cityReportBlockerVisible: false,
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
    subscriptionBannerTopPx: 44,
    subscriptionBannerHeightPx: 0,
    subscriptionBannerHeightRpx: 70,
    preflightBaseTopRpx: 120,
    preflightTopRpx: 120,
    preflightTopPx: 60,
    policyUpdateVisible: false,
    policyUpdateType: "",
    policyUpdateTitle: "",
    policyUpdateSubmitting: false,
    policyUpdateClosing: false,
    markerDetailVisible: false,
    detailCard: null,
    markerDetailClosing: false,
    markerDetailExpanding: false,
    markerDetailAllowExpand: true,
    markerDetailCurrentImage: 0,
    markerDetailVideoLoading: false,
    markerLikeAnimating: false,
    markerLikeHoldLabel: "",
    markerLikeLabelType: "",
    markerLikeCount: 0,
    markerLiked: false,
    markerLikeTargetType: "",
    markerLikeTargetId: "",
    markerLikeCountDisplay: "",
    markerLikeHintLabel: "",
    markerLikeResultLabel: "",
    markerPageVisible: false,
    markerPageClosing: false,
    markerPageDetail: null,
    markerPageCurrentImage: 0,
    markerPageVideoLoading: false,
    markerPageLikeCount: 0,
    markerPageLiked: false,
    markerPageLikeTargetType: "",
    markerPageLikeTargetId: "",
    markerPageLikeCountDisplay: "",
    markerPageLikeHintLabel: "",
    markerPageLikeResultLabel: "",
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
    markerCertificationSheetVisible: false,
    markerCertificationSheetClosing: false,
    markerCertificationInfoItems: MARKER_CERTIFICATION_INFO_ITEMS,
    markerSvipIconPath: MARKER_SVIP_ICON_PATH,
    callSheetVisible: false,
    callSheetPhone: "",
    callSheetMarkerId: "",
    callSheetMarkerName: "",
    scaleBarVisible: false,
    scaleBarWidthRpx: DEFAULT_SCALE_BAR_BASE_RPX,
    scaleBarLabel: "",
    mapRotate: 0,
    mapSkew: 0,
    compassVisible: false,
    compassRotate: 0,
    compassSkew: 0,
    enableSatellite: false,
    debugEnabled: MAP_DEBUG_PANEL_ENABLED === true,
    debugInfo: {},
    mapLayerType: "standard",
    isWeChatRuntime: null,
    layerPanelVisible: false,
    layerPanelClosing: false,
    airBoardEnabled: true,
    usePlanetCenterPoint: false,
    centerTargetLinkEnabled: true,
    provinceCityHighlightEnabled: false,
    provinceCityTree: [],
    provinceCityHighlightLoading: false,
    provinceCityHighlightError: "",
    provinceCityHighlightSelectedId: "",
    myLocationModeResolved: false,
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

  consumePendingLaunchOptions(options = {}) {
    const app = typeof getApp === "function" ? getApp() : null;
    const pending = app?.globalData?.pendingLaunchOptions;
    if (!pending) return options || {};
    app.globalData.pendingLaunchOptions = null;
    return mergeLaunchOptions(pending, options || {});
  },

  consumeInitialUsePlanetCenterPoint() {
    const app = typeof getApp === "function" ? getApp() : null;
    if (!app?.globalData) return null;
    const value = app.globalData.initialUsePlanetCenterPoint;
    if (typeof value !== "boolean") {
      return null;
    }
    app.globalData.initialUsePlanetCenterPoint = null;
    return value;
  },

  resolveWindowMetrics(event = {}) {
    const metrics = getWindowMetrics();
    const resize = readResizeWindowSize(event);
    if (Number.isFinite(resize.windowWidth) && resize.windowWidth > 0) {
      metrics.windowWidth = resize.windowWidth;
    }
    if (Number.isFinite(resize.windowHeight) && resize.windowHeight > 0) {
      metrics.windowHeight = resize.windowHeight;
    }
    return metrics;
  },

  refreshResponsiveLayout(options = {}) {
    const metrics =
      options && options.metrics && typeof options.metrics === "object"
        ? options.metrics
        : this.resolveWindowMetrics(options.event);
    this.initializeSystemInfo(options.force === true, metrics);
    const wideLayout = resolveWideLayout(metrics);
    const uiScale = resolveMapUiScale(metrics, wideLayout);
    const roundedScale = Number(uiScale.toFixed(4));
    const uiScaleStyle = roundedScale < 0.9999 ? `transform: scale(${roundedScale});` : "";
    const subscriptionBannerScaleStyle =
      roundedScale < 0.9999
        ? `transform: translateY(-50%) scale(${roundedScale}); transform-origin: left center;`
        : "transform: translateY(-50%); transform-origin: left center;";
    const updates = {};
    if (this.data.isWideLayout !== wideLayout) {
      updates.isWideLayout = wideLayout;
    }
    if (this.data.mapUiScale !== roundedScale) {
      updates.mapUiScale = roundedScale;
    }
    if (this.data.mapUiScaleStyle !== uiScaleStyle) {
      updates.mapUiScaleStyle = uiScaleStyle;
    }
    if (this.data.subscriptionBannerScaleStyle !== subscriptionBannerScaleStyle) {
      updates.subscriptionBannerScaleStyle = subscriptionBannerScaleStyle;
    }
    const windowHeight = Number(metrics.windowHeight);
    if (Number.isFinite(windowHeight) && windowHeight > 0) {
      const pxPerRpx = this._pxPerRpx || ((metrics.windowWidth || 375) / 750) || 0.5;
      const panelMaxHeightPx = Math.max(280, Math.floor(windowHeight * 0.8));
      const bodyMaxHeightPx = Math.max(180, panelMaxHeightPx - Math.round(124 * pxPerRpx));
      if (this.data.layerPanelMaxHeightPx !== panelMaxHeightPx) {
        updates.layerPanelMaxHeightPx = panelMaxHeightPx;
      }
      if (this.data.layerPanelBodyMaxHeightPx !== bodyMaxHeightPx) {
        updates.layerPanelBodyMaxHeightPx = bodyMaxHeightPx;
      }
    }
    if (Object.keys(updates).length) {
      this.setData(updates, () => {
        if (this.data.layerPanelVisible) {
          this.scheduleLayerPanelLayoutMeasure(0);
        }
      });
    } else if (this.data.layerPanelVisible) {
      this.scheduleLayerPanelLayoutMeasure(0);
    }
    if (options.refreshScaleBar === false) {
      return;
    }
    const latitude = Number(this.data?.center?.latitude);
    this.updateScaleBar({
      scale: this.data.scale,
      latitude: Number.isFinite(latitude) ? latitude : DEFAULT_CENTER.latitude
    });
  },

  registerWindowResizeListener() {
    if (typeof wx === "undefined" || typeof wx.onWindowResize !== "function") {
      return;
    }
    if (this._onWindowResize) {
      return;
    }
    this._onWindowResize = (event = {}) => {
      this._lastResizeEvent = event;
      if (this._windowResizeTimer) {
        clearTimeout(this._windowResizeTimer);
      }
      this._windowResizeTimer = setTimeout(() => {
        this._windowResizeTimer = null;
        this.refreshResponsiveLayout({ event: this._lastResizeEvent, force: true });
      }, WINDOW_RESIZE_DEBOUNCE_MS);
    };
    wx.onWindowResize(this._onWindowResize);
  },

  unregisterWindowResizeListener() {
    if (this._windowResizeTimer) {
      clearTimeout(this._windowResizeTimer);
      this._windowResizeTimer = null;
    }
    if (!this._onWindowResize) {
      return;
    }
    if (typeof wx !== "undefined" && typeof wx.offWindowResize === "function") {
      wx.offWindowResize(this._onWindowResize);
    }
    this._onWindowResize = null;
    this._lastResizeEvent = null;
  },

  onLoad(options = {}) {
    return bootstrapUtils.onLoad(this, options);
  },

  onReady() {
    return lifecycleUtils.onReady(this);
  },

  isMapCenterReady() {
    const center = this._centerOverride || this.data.center;
    return this.data.mapCenterReady === true && hasValidCoordinate(center?.latitude, center?.longitude);
  },

  loadMapSubKey() {
    prefetchMapKey({ apiBase: this.getApiBase() })
      .then((mapKey) => {
        const nextKey = typeof mapKey === "string" ? mapKey.trim() : "";
        if (!nextKey || nextKey === this.data.mapSubKey) return;
        this.setData({ mapSubKey: nextKey });
      })
      .catch((err) => {
        console.warn("loadMapSubKey failed", err);
      });
  },

  ensureUomPluginReady(retry = 0) {
    if (this._uomPlugin && this._uomPluginInitialized) return;
    if (!this._uomPluginInitLogged) {
      console.log("[uom-plugin] init check");
      this._uomPluginInitLogged = true;
    }
    const selector = this.data.isWeChatRuntime ? "#uom-plugin" : "#uom2-plugin";
    console.log("[uom-plugin] select", { selector, useWeChatUom: this.data.isWeChatRuntime });
    const plugin = this.selectComponent(selector);
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

  ensureDjiLayerReady(retry = 0) {
    if (this._djiLayer && this._djiLayerInitialized) return;
    if (!this._djiLayerInitLogged) {
      this._djiLayerInitLogged = true;
      console.log("[dji-layer] init check");
    }
    const layer = this.selectComponent("#dji-no-fly-layer");
    if (
      layer &&
      typeof layer.init === "function" &&
      typeof layer.updateViewport === "function" &&
      typeof layer.updateQuery === "function" &&
      typeof layer.setEnabled === "function"
    ) {
      this._djiLayer = layer;
      this._djiLayerInitialized = true;
      layer.init({
        enabled: this.data.djiNoFlyZoneEnabled !== false,
        center: this._centerOverride || this.data.center,
        region: this._lastRegion || null,
        scale: this.data.scale,
        drone: this.data.selectedDrone || "",
        levels: this.data.levelsInput || DEFAULT_LEVELS_PARAM,
        force: true
      });
      return;
    }
    if (retry >= 10) {
      console.warn("[dji-layer] init retries exhausted");
      return;
    }
    if (this._djiLayerInitTimer) clearTimeout(this._djiLayerInitTimer);
    const delay = retry === 0 ? 0 : Math.min(500, 80 * (retry + 1));
    this._djiLayerInitTimer = setTimeout(() => {
      this._djiLayerInitTimer = null;
      this.ensureDjiLayerReady(retry + 1);
    }, delay);
  },

  syncDjiLayerViewport(options = {}) {
    this.ensureDjiLayerReady();
    if (!this._djiLayer || typeof this._djiLayer.updateViewport !== "function") return;
    this._djiLayer.updateViewport({
      center: options.center || this._centerOverride || this.data.center,
      region: options.region || this._lastRegion || null,
      scale: Number.isFinite(Number(options.scale)) ? Number(options.scale) : this.data.scale,
      force: options.force === true
    });
  },

  syncDjiLayerQuery(options = {}) {
    this.ensureDjiLayerReady();
    if (!this._djiLayer || typeof this._djiLayer.updateQuery !== "function") return;
    this._djiLayer.updateQuery({
      drone: this.data.selectedDrone || "",
      levels: this.data.levelsInput || DEFAULT_LEVELS_PARAM,
      force: options.force === true
    });
  },

  setDjiLayerEnabled(enabled, options = {}) {
    this.ensureDjiLayerReady();
    if (!this._djiLayer || typeof this._djiLayer.setEnabled !== "function") return;
    this._djiLayer.setEnabled(enabled !== false, {
      force: options.force === true
    });
  },

  onDjiGraphicsChange(event = {}) {
    const detail = event?.detail || {};
    this._djiPolygons = Array.isArray(detail.polygons) ? detail.polygons : [];
    this._djiCircles = Array.isArray(detail.circles) ? detail.circles : [];
    this.updateOverlayGraphics();
  },

  onDjiStatusChange(event = {}) {
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
      this.setData(updates);
    }
  },

  ensureTemporaryNoFlyLayerReady(retry = 0) {
    if (this._temporaryNoFlyLayer && this._temporaryNoFlyLayerInitialized) return;
    if (!this._temporaryNoFlyLayerInitLogged) {
      this._temporaryNoFlyLayerInitLogged = true;
      console.log("[temporary-no-fly-layer] init check");
    }
    const layer = this.selectComponent("#temporary-no-fly-layer");
    if (
      layer &&
      typeof layer.init === "function" &&
      typeof layer.updateViewport === "function" &&
      typeof layer.setEnabled === "function"
    ) {
      this._temporaryNoFlyLayer = layer;
      this._temporaryNoFlyLayerInitialized = true;
      layer.init({
        enabled: this.data.temporaryNoFlyZoneEnabled !== false,
        center: this._centerOverride || this.data.center,
        region: this._lastRegion || null,
        scale: this.data.scale,
        apiBase: this.getApiBase(),
        force: true
      });
      return;
    }
    if (retry >= 10) {
      console.warn("[temporary-no-fly-layer] init retries exhausted");
      return;
    }
    if (this._temporaryNoFlyLayerInitTimer) clearTimeout(this._temporaryNoFlyLayerInitTimer);
    const delay = retry === 0 ? 0 : Math.min(500, 80 * (retry + 1));
    this._temporaryNoFlyLayerInitTimer = setTimeout(() => {
      this._temporaryNoFlyLayerInitTimer = null;
      this.ensureTemporaryNoFlyLayerReady(retry + 1);
    }, delay);
  },

  syncTemporaryNoFlyLayerViewport(options = {}) {
    this.ensureTemporaryNoFlyLayerReady();
    if (!this._temporaryNoFlyLayer || typeof this._temporaryNoFlyLayer.updateViewport !== "function") return;
    this._temporaryNoFlyLayer.updateViewport({
      center: options.center || this._centerOverride || this.data.center,
      region: options.region || this._lastRegion || null,
      scale: Number.isFinite(Number(options.scale)) ? Number(options.scale) : this.data.scale,
      apiBase: this.getApiBase(),
      force: options.force === true
    });
  },

  setTemporaryNoFlyLayerEnabled(enabled, options = {}) {
    this.ensureTemporaryNoFlyLayerReady();
    if (!this._temporaryNoFlyLayer || typeof this._temporaryNoFlyLayer.setEnabled !== "function") return;
    this._temporaryNoFlyLayer.setEnabled(enabled !== false, {
      force: options.force === true
    });
  },

  onTemporaryNoFlyGraphicsChange(event = {}) {
    const detail = event?.detail || {};
    this._nfzPolygons = Array.isArray(detail.polygons) ? detail.polygons : [];
    this._nfzCircles = Array.isArray(detail.circles) ? detail.circles : [];
    this.updateOverlayGraphics();
  },

  onTemporaryNoFlyStatusChange(event = {}) {
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
      this.setData(updates);
    }
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

  getCurrentScaleInMeters(scale = this.data.scale, latitude) {
    const latSource =
      latitude ??
      this._centerOverride?.latitude ??
      this.data.center?.latitude;
    return this.estimateScaleBarMeters(scale, latSource);
  },

  resolveMarkerDisplayMode(raw = {}, scaleInMeters) {
    return resolveMapDisplayMode(raw, scaleInMeters);
  },

  applyDisplayModeToMarker(marker = {}, raw = {}, options = {}) {
    if (!marker || typeof marker !== "object") {
      return null;
    }
    const hasDisplayConfig =
      !!raw &&
      typeof raw === "object" &&
      (
        Object.prototype.hasOwnProperty.call(raw, "mapDisplayMode") ||
        (
          raw.mapDisplayModes &&
          typeof raw.mapDisplayModes === "object" &&
          Object.keys(raw.mapDisplayModes).length > 0
        )
      );
    if (!hasDisplayConfig) {
      return Object.assign({}, marker);
    }
    const mode = this.resolveMarkerDisplayMode(raw, options.scaleInMeters);
    if (!mode || mode === DISPLAY_MODE_HIDDEN) {
      return null;
    }
    const next = Object.assign({}, marker);
    const extData = Object.assign({}, next.extData || {});
    extData.mapDisplayMode = mode;
    next.extData = extData;
    if (next.callout) {
      next.callout = Object.assign({}, next.callout, {
        display: mode === DISPLAY_MODE_ICON_WITH_NAME ? "ALWAYS" : "BYCLICK"
      });
    }
    if (mode === DISPLAY_MODE_SMALL_ICON_ONLY) {
      const size = getDisplayModeMarkerSize(mode, options.baseSize || next.width || next.height);
      next.width = size;
      next.height = size;
    }
    return next;
  },

  buildCanonicalMarkerKey(marker = {}) {
    if (!marker || typeof marker !== "object") return "";
    const source = `${marker?.extData?.source || marker?.source || ""}`.trim().toLowerCase();
    const raw = marker?.extData?.raw || {};
    const detail = marker?.extData?.detail || {};
    const isPin =
      source.includes("pin") ||
      raw?.pinIdNew !== undefined ||
      raw?.shape ||
      raw?.visibility ||
      detail?.shape;
    const candidates = isPin
      ? [raw?.pinIdNew, raw?.id, detail?.markerId, detail?.id, marker?.markerId, marker?.id]
      : [raw?.markIdNew, raw?.markId, raw?.id, detail?.markerId, detail?.id, marker?.markerId, marker?.id];
    for (const candidate of candidates) {
      if (candidate !== undefined && candidate !== null && `${candidate}`.trim()) {
        return `${isPin ? "pin" : "marker"}:${`${candidate}`.trim()}`;
      }
    }
    const latitude = Number(marker?.latitude);
    const longitude = Number(marker?.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return `${source || "map"}:${latitude.toFixed(6)},${longitude.toFixed(6)}`;
    }
    return "";
  },

  dedupeMapMarkers(list = []) {
    if (!Array.isArray(list) || !list.length) return [];
    const seen = new Set();
    const result = [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const marker = list[i];
      const key = this.buildCanonicalMarkerKey(marker);
      if (key && seen.has(key)) {
        continue;
      }
      if (key) {
        seen.add(key);
      }
      result.unshift(marker);
    }
    return result;
  },

  buildMyLocationMarker(point = {}) {
    const latitude = Number(point?.latitude);
    const longitude = Number(point?.longitude);
    if (!hasValidCoordinate(latitude, longitude)) return null;
    const rotate = this.normalizeCompassDirection(this._myLocationDirection);
    return {
      id: MY_LOCATION_MARKER_ID,
      latitude,
      longitude,
      iconPath: MY_LOCATION_MARKER_ICON_PATH,
      width: MY_LOCATION_MARKER_SIZE,
      height: MY_LOCATION_MARKER_SIZE,
      alpha: 1,
      zIndex: 1300,
      rotate: Math.round(rotate || 0),
      anchor: {
        x: 0.5,
        y: 0.5
      },
      extData: {
        source: "my-location-map"
      }
    };
  },

  buildMyLocationMarkers(point = {}) {
    if (!this.data.usePlanetCenterPoint) return [];
    const pointer = this.buildMyLocationMarker(point);
    return pointer ? [pointer] : [];
  },

  buildMyLocationCircles(point = {}) {
    return [];
  },

  refreshMyLocationGraphics(point = null) {
    const latitude = Number(point?.latitude);
    const longitude = Number(point?.longitude);
    if (!hasValidCoordinate(latitude, longitude)) {
      const hadMarkers = Array.isArray(this._myLocationMarkers) && this._myLocationMarkers.length > 0;
      const hadCircles = Array.isArray(this._myLocationCircles) && this._myLocationCircles.length > 0;
      if (hadMarkers || hadCircles) {
        this._myLocationMarkers = [];
        this._myLocationCircles = [];
        this.queueMapGraphicsSync({ markers: hadMarkers, overlay: hadCircles });
      }
      return;
    }
    const normalized = { latitude, longitude };
    const markers = this.buildMyLocationMarkers(normalized);
    const prevMarkers = Array.isArray(this._myLocationMarkers) ? this._myLocationMarkers : [];
    const markersChanged = this.isMyLocationMarkersChanged(prevMarkers, markers);
    if (markersChanged) {
      this._myLocationMarkers = markers;
    }
    const circles = this.buildMyLocationCircles(normalized);
    const prevCircles = Array.isArray(this._myLocationCircles) ? this._myLocationCircles : [];
    const circlesChanged = this.isMyLocationCirclesChanged(prevCircles, circles);
    if (circlesChanged) {
      this._myLocationCircles = circles;
    }
    if (!markersChanged && !circlesChanged) return;
    this.queueMapGraphicsSync({ markers: markersChanged, overlay: circlesChanged });
  },

  setMyLocationControlPoint(point = null, options = {}) {
    const latitude = Number(point?.latitude);
    const longitude = Number(point?.longitude);
    if (!hasValidCoordinate(latitude, longitude)) {
      if (this.data.myLocationVisible || this.data.myLocationPoint) {
        this.setData({
          myLocationPoint: null,
          myLocationVisible: false
        });
      }
      this.refreshMyLocationGraphics(null);
      return;
    }
    const normalized = { latitude, longitude };
    const prev = this.data.myLocationPoint || {};
    const changed =
      !hasValidCoordinate(prev.latitude, prev.longitude) ||
      Math.abs(Number(prev.latitude) - latitude) > 1e-8 ||
      Math.abs(Number(prev.longitude) - longitude) > 1e-8;
    if (changed || this.data.myLocationVisible !== true) {
      this.setData({
        myLocationPoint: normalized,
        myLocationVisible: true
      });
    }
    this.refreshMyLocationGraphics(normalized);
    if (options.syncCenter === false) {
      return;
    }
    const currentCenter = this._centerOverride || this.data.center || null;
    const centerChanged =
      !hasValidCoordinate(currentCenter?.latitude, currentCenter?.longitude) ||
      Math.abs(Number(currentCenter.latitude) - latitude) > 1e-8 ||
      Math.abs(Number(currentCenter.longitude) - longitude) > 1e-8;
    if (centerChanged || !this.isMapCenterReady()) {
      this.centerOnPoint(normalized, this.data.scale, true);
    }
  },

  findMarkerById(markerId) {
    if (markerId === undefined || markerId === null) return null;
    const targetId = this.ensureMapMarkerId(markerId);
    const nearby = Array.isArray(this._nearbyMarkers) ? this._nearbyMarkers : [];
    const nearbyPins = Array.isArray(this._nearbyPinMarkers) ? this._nearbyPinMarkers : [];
    const search = Array.isArray(this._searchMarkers) ? this._searchMarkers : [];
    const mapTapTarget = Array.isArray(this._mapTapTargetMarkers) ? this._mapTapTargetMarkers : [];
    const preview = this._previewMarker ? [this._previewMarker] : [];
    const manual = Array.isArray(this._manualMarkers) ? this._manualMarkers : [];
    const combined = manual.concat(nearbyPins, nearby, search, mapTapTarget, preview);
    for (const marker of combined) {
      const currentId = this.ensureMapMarkerId(marker?.id ?? marker?.markerId ?? marker?.markerID);
      if (currentId === targetId) {
        return marker;
      }
    }
    return null;
  },

  takePendingMarkerFocus() {
    return shareLaunchUtils.takePendingMarkerFocus(this);
  },

  consumePendingMarkerFocus(options = {}) {
    return shareLaunchUtils.consumePendingMarkerFocus(this, options);
  },

  consumePendingPinPreview() {
    return shareLaunchUtils.consumePendingPinPreview(this);
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
    const shapeRaw = rawPin.shape || {};
    const shapeType = `${shapeRaw.type || ""}`.toUpperCase();
    const shape = isKmlShapeType(shapeType) ? normalizeKmlShape(shapeRaw) : shapeRaw;
    const resolved = resolveShapeCoordinates(shape);
    const normalizedCoords = this.normalizePreviewCoordinateList(resolved.coordinates);
    const primary =
      normalizedCoords[0] ||
      this.normalizePreviewCoordinate(rawPin.location) ||
      this.normalizePreviewCoordinate({ latitude: rawPin.latitude, longitude: rawPin.longitude }) ||
      {};
    const apiBase = this.getApiBase();
    const normalized = this.normalizeMarkerDetail(rawPin);
    const pinIdValue = rawPin.pinIdNew ?? rawPin.pinId ?? rawPin.id ?? "";
    const pinId = pinIdValue !== undefined && pinIdValue !== null ? `${pinIdValue}` : "";
    const resolveImageRef = (item) => {
      if (!item) return "";
      if (typeof item === "string") {
        return item.trim();
      }
      if (typeof item === "object") {
        const candidate =
          item.fileName ||
          item.filename ||
          item.objectName ||
          item.path ||
          item.location ||
          item.url ||
          item.imageUrl ||
          "";
        return typeof candidate === "string" ? candidate.trim() : "";
      }
      return "";
    };
    const rawImages = Array.isArray(rawPin.images) ? rawPin.images : [];
    const images = rawImages
      .map((img, idx) => {
        const ref = resolveImageRef(img);
        const url = ref ? buildFileDownloadUrl(ref, { apiBase }) : "";
        if (!url) return null;
        return {
          url,
          id: `${pinId || rawPin.id || "pin"}-image-${idx}`
        };
      })
      .filter((img) => !!img.url);
    const videoRef = resolvePinVideoRef(rawPin);
    const videoUrl = resolvePinVideoUrl(videoRef, {
      apiBase,
      isSCos: rawPin.isSCos !== false,
      cosHost: this._tencentCosConfig?.host || "",
      cosSts: this._tencentCosSts || null
    });
    const mediaItems = images
      .map((item) => Object.assign({ type: "image" }, item))
      .concat(
        videoUrl
          ? [{
            type: "video",
            url: videoUrl,
            poster: images[0]?.url || "",
            id: `${pinId || rawPin.id || "pin"}-video-0`,
            isSCos: rawPin.isSCos !== false
          }]
          : []
      );
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
      mediaItems,
      videoLink: videoRef || "",
      isSCos: rawPin.isSCos !== false && !!videoRef,
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

  prefetchTencentCosConfig() {
    fetchTencentCosConfig({ apiBase: this.getApiBase() })
      .then((config = {}) => {
        const bucket = Array.isArray(config.buckets) ? `${config.buckets[0] || ""}`.trim() : "";
        const region = `${config.region || ""}`.trim();
        this._tencentCosConfig = Object.assign({}, config, {
          bucket,
          region,
          host: buildCosHost(bucket, region)
        });
      })
      .catch((err) => {
        console.warn("map prefetch tencent cos config failed", err);
      });
  },

  ensureTencentCosSts(force = false) {
    if (!force && isTencentCosStsValid(this._tencentCosSts)) {
      return Promise.resolve(this._tencentCosSts);
    }
    if (this._tencentCosStsPromise) {
      return this._tencentCosStsPromise;
    }
    const apiBase = this.getApiBase();
    const token = this.getAuthToken();
    if (!apiBase || !token) {
      return Promise.resolve(null);
    }
    this._tencentCosStsPromise = fetchTencentCosSts({ apiBase, token })
      .then((sts = {}) => {
        this._tencentCosSts = sts;
        return sts;
      })
      .catch((err) => {
        console.warn("map fetch tencent cos sts failed", err);
        return null;
      })
      .finally(() => {
        this._tencentCosStsPromise = null;
      });
    return this._tencentCosStsPromise;
  },

  ensurePlayablePinDetailMedia(detail, options = {}) {
    if (!detail || !this.isPinDetail(detail)) {
      return Promise.resolve();
    }
    return this.ensureTencentCosSts().then((sts) => {
      const cosHost = this._tencentCosConfig?.host || "";
      if (!sts || !cosHost) return;
      const mediaItems = Array.isArray(detail.mediaItems) ? detail.mediaItems : [];
      let changed = false;
      const nextMediaItems = mediaItems.map((item = {}) => {
        if (`${item.type || ""}`.toLowerCase() !== "video") {
          return item;
        }
        const signedUrl = resolvePinVideoUrl(item.url || detail.videoLink || "", {
          apiBase: this.getApiBase(),
          isSCos: item.isSCos !== false && detail.isSCos !== false,
          cosHost,
          cosSts: sts
        });
        if (!signedUrl || signedUrl === item.url) {
          return item;
        }
        changed = true;
        return Object.assign({}, item, { url: signedUrl });
      });
      if (!changed) return;
      const nextDetail = Object.assign({}, detail, { mediaItems: nextMediaItems });
      if (options.forDetailCard && this.data.detailCard && (this.data.detailCard.id === detail.id || this.data.detailCard.markerId === detail.markerId)) {
        this.setData({ detailCard: nextDetail });
      }
      if (options.forPage && this.data.markerPageDetail && (this.data.markerPageDetail.id === detail.id || this.data.markerPageDetail.markerId === detail.markerId)) {
        this.setData({ markerPageDetail: nextDetail });
      }
      if (this._lastMarkerDetail && (this._lastMarkerDetail.id === detail.id || this._lastMarkerDetail.markerId === detail.markerId)) {
        this._lastMarkerDetail = nextDetail;
      }
    });
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
    const shapeType = `${shape.type || ""}`.toUpperCase();
    const normalizedShape = isKmlShapeType(shapeType) ? normalizeKmlShape(shape) : shape;
    const resolved = resolveShapeCoordinates(normalizedShape);
    const type = resolved.resolvedType || shapeType;
    const coordinates = this.normalizePreviewCoordinateList(resolved.coordinates);
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
    const displayMode = this.resolveMarkerDisplayMode(payload.raw || payload, payload.scaleInMeters);
    if (displayMode === DISPLAY_MODE_HIDDEN) {
      return null;
    }
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
    const content = contentParts.join(" ");
    const marker = {
      id: payload.id || `pin-preview-${Date.now()}`,
      latitude,
      longitude,
      iconPath,
      width: 32,
      height: 32
    };
    if (content) {
      marker.callout = buildMarkerNameCallout(content, {
        fontSize: 10,
        fontWeight: "normal"
      });
    }
    return this.applyDisplayModeToMarker(marker, payload.raw || payload, {
      scaleInMeters: payload.scaleInMeters,
      baseSize: 32
    });
  },

  computePinPreviewCenter(shape = {}, payload = {}) {
    const location = payload.location;
    const resolved = resolveShapeCoordinates(shape || {});
    const resolvedType = `${resolved.resolvedType || shape?.type || "POINT"}`.toUpperCase();
    const coords = Array.isArray(resolved.coordinates) ? resolved.coordinates : [];
    const normalized = this.normalizePreviewCoordinateList(coords);
    if (resolvedType !== "POINT" && normalized.length) {
      let minLat = Infinity;
      let maxLat = -Infinity;
      let minLng = Infinity;
      let maxLng = -Infinity;
      normalized.forEach((item) => {
        const latitude = Number(item?.latitude);
        const longitude = Number(item?.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return;
        }
        if (latitude < minLat) minLat = latitude;
        if (latitude > maxLat) maxLat = latitude;
        if (longitude < minLng) minLng = longitude;
        if (longitude > maxLng) maxLng = longitude;
      });
      if (
        Number.isFinite(minLat) &&
        Number.isFinite(maxLat) &&
        Number.isFinite(minLng) &&
        Number.isFinite(maxLng)
      ) {
        return {
          latitude: (minLat + maxLat) / 2,
          longitude: (minLng + maxLng) / 2
        };
      }
    }
    const target = (location && hasValidCoordinate(location.latitude, location.longitude))
      ? location
      : normalized[0];
    if (target && hasValidCoordinate(target.latitude, target.longitude)) {
      const latitude = Number(target.latitude);
      const longitude = Number(target.longitude);
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

  normalizePreviewCoordinateList(raw = []) {
    if (!Array.isArray(raw) || !raw.length) return [];
    const list = flattenCoordinateList(raw);
    return list.map((coord) => this.normalizePreviewCoordinate(coord)).filter(Boolean);
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
    return preflightDashboardUtils.fillPinSuggestionAddresses(this, suggestions, keywordSnapshot);
  },

  autoLoginOnLaunch() {
    this.ensureAccessToken()
      .then(() => {
        this.loadMapGuideConfigs().catch((err) => {
          console.warn("loadMapGuideConfigs failed", err);
        });
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

  loadMapGuideConfigs() {
    const apiBase = this.getApiBase();
    if (!apiBase) {
      this.setData({
        coordinateSystemDescriptionNodes: "",
        coordinateLongPressGuideNodes: ""
      });
      this._mapGuideConfigLoaded = false;
      return Promise.resolve();
    }
    const token = this.getAuthToken();
    if (!token) {
      this.setData({
        coordinateSystemDescriptionNodes: "",
        coordinateLongPressGuideNodes: ""
      });
      this._mapGuideConfigLoaded = false;
      return Promise.resolve();
    }
    const parseRichText = (content) => {
      const html = typeof content === "string" ? content : "";
      if (!html.trim()) return "";
      return transformHtmlContent(html, { apiBase });
    };
    const loadCoordinateSystemDescription = fetchCoordinateSystemDescription({ apiBase, token })
      .then((payload = {}) => parseRichText(payload.content))
      .catch((err) => {
        console.warn("loadCoordinateSystemDescription failed", err);
        return "";
      });
    const loadCoordinateLongPressGuide = fetchCoordinateLongPressGuide({ apiBase, token })
      .then((payload = {}) => parseRichText(payload.content))
      .catch((err) => {
        console.warn("loadCoordinateLongPressGuide failed", err);
        return "";
      });
    return Promise.all([loadCoordinateSystemDescription, loadCoordinateLongPressGuide]).then(
      ([coordinateSystemDescriptionNodes, coordinateLongPressGuideNodes]) => {
        this.setData({
          coordinateSystemDescriptionNodes,
          coordinateLongPressGuideNodes
        });
      }
    ).finally(() => {
      this._mapGuideConfigLoaded = true;
    });
  },

  checkPolicyUpdateOnLaunch() {
    if (this._policyUpdateChecking || this._policyUpdateChecked) return;
    this._policyUpdateChecking = true;
    const apiBase = this.getApiBase();
    if (!apiBase) {
      this._policyUpdateChecking = false;
      return;
    }
    const app = typeof getApp === "function" ? getApp() : null;
    const cachedProfile = app?.globalData?.latestUserProfile;
    const loadLatestPolicies = () =>
      Promise.all([
        fetchLatestUserAgreement({ apiBase }),
        fetchLatestPrivacyPolicy({ apiBase })
      ]);
    const loadProfile = () =>
      fetchUserProfile({
        apiBase,
        token: this.getAuthToken()
      });
    this.ensureAccessToken()
      .then(() => {
        const profilePromise = cachedProfile ? Promise.resolve(cachedProfile) : loadProfile();
        return Promise.all([profilePromise, loadLatestPolicies()]);
      })
      .then(([profile, [latestAgreement, latestPrivacy]]) => {
        if (app && app.globalData && profile && profile !== cachedProfile) {
          app.globalData.latestUserProfile = profile;
          app.globalData.latestUserProfileAt = Date.now();
        }
        const record = extractPolicyAccessVersions(profile || {});
        const agreementVersion = normalizePolicyVersion(latestAgreement?.version);
        const privacyVersion = normalizePolicyVersion(latestPrivacy?.version);
        const agreementNeedsUpdate =
          agreementVersion && record.userAgreementVersion !== agreementVersion;
        const privacyNeedsUpdate =
          privacyVersion && record.privacyPolicyVersion !== privacyVersion;
        if (!agreementNeedsUpdate && !privacyNeedsUpdate) {
          this._policyUpdateChecked = true;
          return;
        }
        const updateType = agreementNeedsUpdate && privacyNeedsUpdate
          ? "both"
          : (agreementNeedsUpdate ? "agreement" : "privacy");
        const title =
          updateType === "both"
            ? "协议更新提示"
            : (updateType === "agreement" ? "用户协议更新提示" : "隐私政策更新提示");
        this._policyUpdateVersions = {
          userAgreementVersion: agreementVersion || record.userAgreementVersion,
          privacyPolicyVersion: privacyVersion || record.privacyPolicyVersion
        };
        this._policyUpdatePolicies = {
          agreement: latestAgreement || null,
          privacy: latestPrivacy || null
        };
        this.setData({
          policyUpdateVisible: true,
          policyUpdateType: updateType,
          policyUpdateTitle: title,
          policyUpdateClosing: false,
          mapBlockerVisible: true
        }, () => {
          this.updateMapBlockerVisible();
        });
      })
      .catch((err) => {
        console.warn("checkPolicyUpdateOnLaunch failed", err);
      })
      .finally(() => {
        this._policyUpdateChecking = false;
      });
  },

  onPolicyUpdateAgree() {
    if (this._policyUpdateSubmitting) return;
    const apiBase = this.getApiBase();
    const token = this.getAuthToken();
    const versions = this._policyUpdateVersions || {};
    const policies = this._policyUpdatePolicies || {};
    const updateType = this.data.policyUpdateType;
    if (!apiBase || !token) {
      return;
    }
    this._policyUpdateSubmitting = true;
    this.setData({ policyUpdateSubmitting: true });
    const tasks = [];
    if (updateType === "agreement" || updateType === "both") {
      const version = normalizePolicyVersion(policies?.agreement?.version || versions.userAgreementVersion);
      if (version) {
        tasks.push(
          recordPolicyAccess(
            {
              agreementType: "terms",
              version,
              docHash: policies?.agreement?.docHash,
              scene: "POPUP"
            },
            { apiBase, token }
          )
        );
      }
    }
    if (updateType === "privacy" || updateType === "both") {
      const version = normalizePolicyVersion(policies?.privacy?.version || versions.privacyPolicyVersion);
      if (version) {
        tasks.push(
          recordPolicyAccess(
            {
              agreementType: "privacy",
              version,
              docHash: policies?.privacy?.docHash,
              scene: "POPUP"
            },
            { apiBase, token }
          )
        );
      }
    }
    Promise.all(tasks)
      .then(() => {
        this._policyUpdateChecked = true;
        this.setData({ policyUpdateClosing: true }, () => {
          if (this._policyUpdateCloseTimer) {
            clearTimeout(this._policyUpdateCloseTimer);
          }
          this._policyUpdateCloseTimer = setTimeout(() => {
            this._policyUpdateCloseTimer = null;
            this.setData({
              policyUpdateVisible: false,
              policyUpdateClosing: false,
              policyUpdateSubmitting: false
            }, () => {
              this.updateMapBlockerVisible();
            });
          }, 240);
        });
      })
      .catch((err) => {
        console.warn("record policy access failed", err);
        wx.showToast({ title: "提交失败，请稍后重试", icon: "none" });
        this.setData({ policyUpdateSubmitting: false });
      })
      .finally(() => {
        this._policyUpdateSubmitting = false;
      });
  },

  onPolicyUpdateDisagree() {
    if (typeof wx.exitMiniProgram === "function") {
      wx.exitMiniProgram();
      return;
    }
    if (this.data.policyUpdateVisible) {
      this.setData({ policyUpdateVisible: false }, () => {
        this.updateMapBlockerVisible();
      });
    }
    wx.showToast({ title: "请同意后继续使用", icon: "none" });
  },

  onPolicyAgreementTap() {
    wx.navigateTo({ url: "/packages/guide/policy/index?type=agreement" });
  },

  onPolicyPrivacyTap() {
    wx.navigateTo({ url: "/packages/guide/policy/index?type=privacy" });
  },

  initSubscriptionBanner() {
    return subscriptionUtils.initSubscriptionBanner(this);
  },

  waitForSubscriptionSettingsReady() {
    return subscriptionUtils.waitForSubscriptionSettingsReady(this);
  },

  setGlobalSubscriptionIds(list = [], mainSwitch = true) {
    return subscriptionUtils.setGlobalSubscriptionIds(this, list, mainSwitch);
  },

  setGlobalRequiredSubscriptionIds(list = []) {
    return subscriptionUtils.setGlobalRequiredSubscriptionIds(this, list);
  },

  resolveRequiredSubscriptionTemplateIds() {
    return subscriptionUtils.resolveRequiredSubscriptionTemplateIds(this);
  },

  setSubscriptionBannerVisibility() {
    return subscriptionUtils.setSubscriptionBannerVisibility(this);
  },

  updatePreflightOverlayTop() {
    return preflightDashboardUtils.updatePreflightOverlayTop(this);
  },

  getSubscriptionMainSwitch() {
    return subscriptionUtils.getSubscriptionMainSwitch(this);
  },

  evaluateSubscriptionBannerVisibility() {
    return subscriptionUtils.evaluateSubscriptionBannerVisibility(this);
  },

  captureInviteCode(options = {}) {
    return shareLaunchUtils.captureInviteCode(this, options);
  },

  initializeCenterShareLaunch(options = {}) {
    return shareLaunchUtils.initializeCenterShareLaunch(this, options);
  },

  applyCenterShareLaunch() {
    return shareLaunchUtils.applyCenterShareLaunch(this);
  },

  scheduleCenterShareLaunchLockAlign(delay = 0) {
    return shareLaunchUtils.scheduleCenterShareLaunchLockAlign(this, delay);
  },

  shouldIgnoreCenterShareLaunchSync(targetCenter, cause = "") {
    return shareLaunchUtils.shouldIgnoreCenterShareLaunchSync(this, targetCenter, cause);
  },

  prepareCenterActionShare() {
    return shareLaunchUtils.prepareCenterActionShare(this);
  },

  buildCenterActionSharePayload(payload = {}) {
    return shareLaunchUtils.buildCenterActionSharePayload(this, payload);
  },

  buildCurrentCenterSharePayload() {
    return shareLaunchUtils.buildCurrentCenterSharePayload(this);
  },

  consumeCenterActionSharePayload() {
    return shareLaunchUtils.consumeCenterActionSharePayload(this);
  },

  clearPendingCenterActionShare() {
    return shareLaunchUtils.clearPendingCenterActionShare(this);
  },

  initializeShareLaunch(options = {}) {
    return shareLaunchUtils.initializeShareLaunch(this, options);
  },

  fetchShareMarkerDetailById(markerId, options = {}) {
    return shareLaunchUtils.fetchShareMarkerDetailById(this, markerId, options);
  },

  markSharePermissionAttempted() {
    return shareLaunchUtils.markSharePermissionAttempted(this);
  },

  retryShareMarkerDetailAfterAuth() {
    return shareLaunchUtils.retryShareMarkerDetailAfterAuth(this);
  },

  tryActivateShareMarker() {
    return shareLaunchUtils.tryActivateShareMarker(this);
  },

  handleShareMarkerError(err) {
    return shareLaunchUtils.handleShareMarkerError(this, err);
  },

  activateShareMarkerDetail(rawDetail) {
    return shareLaunchUtils.activateShareMarkerDetail(this, rawDetail);
  },

  buildShareMarkerFromDetail(rawDetail = {}) {
    return shareLaunchUtils.buildShareMarkerFromDetail(this, rawDetail);
  },

  initializePinShareLaunch(options = {}) {
    return shareLaunchUtils.initializePinShareLaunch(this, options);
  },

  fetchSharePinDetailById(pinId, options = {}) {
    return shareLaunchUtils.fetchSharePinDetailById(this, pinId, options);
  },

  retrySharePinDetailAfterAuth() {
    return shareLaunchUtils.retrySharePinDetailAfterAuth(this);
  },

  tryActivateSharePin() {
    return shareLaunchUtils.tryActivateSharePin(this);
  },

  handleSharePinError(err) {
    return shareLaunchUtils.handleSharePinError(this, err);
  },

  activateSharePinDetail(rawDetail) {
    return shareLaunchUtils.activateSharePinDetail(this, rawDetail);
  },

  buildSharePinFromDetail(rawDetail = {}) {
    return shareLaunchUtils.buildSharePinFromDetail(this, rawDetail);
  },

  focusOnlineMarker(request = {}) {
    return shareLaunchUtils.focusOnlineMarker(this, request);
  },

  focusOfflineMarker(request = {}) {
    return shareLaunchUtils.focusOfflineMarker(this, request);
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
    return markerDetailStateUtils.openMarkerDetail(this, marker);
  },

  onMarkerTap(event) {
    return markerDetailStateUtils.onMarkerTap(this, event);
  },

  onMarkerCalloutTap(event) {
    return markerDetailStateUtils.onMarkerCalloutTap(this, event);
  },

  closeMarkerDetail(immediate = false) {
    return markerDetailStateUtils.closeMarkerDetail(this, immediate);
  },

  onMarkerDetailMaskTap() {
    return markerDetailStateUtils.onMarkerDetailMaskTap(this);
  },

  onCreatorNameTap() {
    return markerDetailStateUtils.onCreatorNameTap();
  },

  onMarkerDetailMaskTouchMove() {
    return markerDetailStateUtils.onMarkerDetailMaskTouchMove();
  },

  onMarkerDetailCloseTap() {
    return markerDetailStateUtils.onMarkerDetailCloseTap(this);
  },

  onMarkerDetailMoreTap() {
    return markerDetailStateUtils.onMarkerDetailMoreTap(this);
  },

  triggerMarkerDetailExpand() {
    return markerDetailStateUtils.triggerMarkerDetailExpand(this);
  },

  onMarkerDetailTouchStart(event) {
    return markerDetailStateUtils.onMarkerDetailTouchStart(this, event);
  },

  onMarkerDetailTouchMove(event) {
    return markerDetailStateUtils.onMarkerDetailTouchMove(this, event);
  },

  onMarkerDetailTouchEnd() {
    return markerDetailStateUtils.onMarkerDetailTouchEnd(this);
  },

  onMarkerDetailTouchCancel() {
    return markerDetailStateUtils.onMarkerDetailTouchCancel(this);
  },

  onMarkerDetailSwiperChange(e) {
    return markerDetailStateUtils.onMarkerDetailSwiperChange(this, e);
  },

  isCurrentMarkerDetailVideoEvent(event = {}) {
    return markerDetailStateUtils.isCurrentMarkerDetailVideoEvent(this, event);
  },

  onMarkerDetailVideoWaiting(event = {}) {
    return markerDetailStateUtils.onMarkerDetailVideoWaiting(this, event);
  },

  onMarkerDetailVideoReady(event = {}) {
    return markerDetailStateUtils.onMarkerDetailVideoReady(this, event);
  },

  openMapInlineVideoFullscreen(options = {}) {
    return markerDetailStateUtils.openMapInlineVideoFullscreen(this, options);
  },

  playMapInlineVideo(videoId = "") {
    return markerDetailStateUtils.playMapInlineVideo(this, videoId);
  },

  onMapInlineVideoTap(event = {}) {
    return markerDetailStateUtils.onMapInlineVideoTap(this, event);
  },

  isMarkerCertified(detail = {}) {
    return markerDetailStateUtils.isMarkerCertified(this, detail);
  },

  applyMarkerCertificationState(detail = {}) {
    return markerDetailStateUtils.applyMarkerCertificationState(this, detail);
  },

  getDetailMediaList(detail = {}) {
    return markerDetailStateUtils.getDetailMediaList(detail);
  },

  isVideoMediaItem(item = {}) {
    return markerDetailStateUtils.isVideoMediaItem(item);
  },

  onMarkerCertificationBadgeTap() {
    return markerDetailStateUtils.onMarkerCertificationBadgeTap(this);
  },

  hideMarkerCertificationSheet(immediate = false) {
    return markerDetailStateUtils.hideMarkerCertificationSheet(this, immediate);
  },

  onMarkerCertificationSheetMaskTap() {
    return markerDetailStateUtils.onMarkerCertificationSheetMaskTap(this);
  },

  makePhoneCall(phone, options = {}) {
    return markerActionsUtils.makePhoneCall(this, phone, options);
  },

  openCallSheet(options = {}) {
    return markerActionsUtils.openCallSheet(this, options);
  },

  hideCallSheet() {
    return markerActionsUtils.hideCallSheet(this);
  },

  onCallSheetConfirm() {
    return markerActionsUtils.onCallSheetConfirm(this);
  },

  onCallSheetCancel() {
    return markerActionsUtils.onCallSheetCancel(this);
  },

  onCallSheetMaskTap() {
    return markerActionsUtils.onCallSheetMaskTap(this);
  },

  incrementMarkerPhoneCallCount(markerId) {
    return markerActionsUtils.incrementMarkerPhoneCallCount(this, markerId);
  },

  incrementMarkerExposureCount(markerId) {
    return markerActionsUtils.incrementMarkerExposureCount(this, markerId);
  },

  incrementPinExposureCount(pinId) {
    return markerActionsUtils.incrementPinExposureCount(this, pinId);
  },

  pruneMarkerExposureCache(now = Date.now()) {
    return markerActionsUtils.pruneMarkerExposureCache(this, now);
  },

  prunePinExposureCache(now = Date.now()) {
    return markerActionsUtils.prunePinExposureCache(this, now);
  },

  trackMarkerExposure(markers) {
    return markerActionsUtils.trackMarkerExposure(this, markers);
  },

  openMarkerLocation(detail, overrides = {}) {
    return markerActionsUtils.openMarkerLocation(this, detail, overrides);
  },

  onMarkerDetailCallTap(event) {
    return markerDetailStateUtils.onMarkerDetailCallTap(this, event);
  },

  onMarkerDetailNavigateTap(event) {
    return markerDetailStateUtils.onMarkerDetailNavigateTap(this, event);
  },

  openMarkerPage(detail) {
    return markerDetailStateUtils.openMarkerPage(this, detail);
  },

  onMarkerPosterTap() {
    return markerDetailStateUtils.onMarkerPosterTap(this);
  },

  refreshMarkerPageDistance() {
    return markerDetailStateUtils.refreshMarkerPageDistance(this);
  },

  buildMarkerDistanceText(detail) {
    return markerDetailStateUtils.buildMarkerDistanceText(this, detail);
  },

  normalizeMarkerPageDetail(detail = {}) {
    return markerDetailStateUtils.normalizeMarkerPageDetail(detail);
  },

  computeMarkerDistance(detail) {
    return markerDetailStateUtils.computeMarkerDistance(this, detail);
  },

  closeMarkerPage(options = {}) {
    return markerDetailStateUtils.closeMarkerPage(this, options);
  },

  onMarkerPageMaskTap() {
    return markerDetailStateUtils.onMarkerPageMaskTap(this);
  },

  onMarkerPageSwiperChange(event) {
    return markerDetailStateUtils.onMarkerPageSwiperChange(this, event);
  },

  isCurrentMarkerPageVideoEvent(event = {}) {
    return markerDetailStateUtils.isCurrentMarkerPageVideoEvent(this, event);
  },

  onMarkerPageVideoWaiting(event = {}) {
    return markerDetailStateUtils.onMarkerPageVideoWaiting(this, event);
  },

  onMarkerPageVideoReady(event = {}) {
    return markerDetailStateUtils.onMarkerPageVideoReady(this, event);
  },

  onMarkerPageScroll(event) {
    return markerDetailStateUtils.onMarkerPageScroll(this, event);
  },

  onMarkerPageTouchStart(event) {
    return markerDetailStateUtils.onMarkerPageTouchStart(this, event);
  },

  onMarkerPageTouchMove(event) {
    return markerDetailStateUtils.onMarkerPageTouchMove(this, event);
  },

  onMarkerPageTouchEnd() {
    return markerDetailStateUtils.onMarkerPageTouchEnd(this);
  },

  onMarkerPageTouchCancel() {
    return markerDetailStateUtils.onMarkerPageTouchCancel(this);
  },

  onMarkerPageAttachmentTap(event) {
    return markerDetailStateUtils.onMarkerPageAttachmentTap(this, event);
  },

  onMarkerPageVideoTap(event) {
    return markerDetailStateUtils.onMarkerPageVideoTap(this, event);
  },

  onMarkerPageCallTap(event) {
    return markerDetailStateUtils.onMarkerPageCallTap(this, event);
  },

  onMarkerPageNavigateTap(event) {
    return markerDetailStateUtils.onMarkerPageNavigateTap(this, event);
  },

  getDetailReviewStatus(detail) {
    return markerDetailStateUtils.getDetailReviewStatus(detail);
  },

  isDetailApproved(detail) {
    return markerDetailStateUtils.isDetailApproved(this, detail);
  },

  isPinDetail(detail) {
    return markerDetailStateUtils.isPinDetail(this, detail);
  },

  isDetailSharable(detail) {
    return markerDetailStateUtils.isDetailSharable(this, detail);
  },

  showShareBlockedToast() {
    return markerDetailStateUtils.showShareBlockedToast();
  },

  onMarkerPageShareDisabledTap() {
    return markerDetailStateUtils.onMarkerPageShareDisabledTap();
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

  onShareAppMessage(event = {}) {
    const posterUrl = buildFileDownloadUrl("main-page.png", { apiBase: this.getApiBase() });
    const isCenterPinShareButton =
      event?.from === "button" &&
      !this.data.markerPageVisible &&
      !this.data.markerDetailVisible;
    const centerShare = isCenterPinShareButton
      ? this.buildCurrentCenterSharePayload()
      : this.consumeCenterActionSharePayload();
    if (isCenterPinShareButton) {
      this.clearPendingCenterActionShare();
    }
    if (centerShare && centerShare.queryBase) {
      return {
        title: centerShare.title,
        path: appendInviteCodeToPath(`/pages/map/map?${centerShare.queryBase}`),
        imageUrl: posterUrl
      };
    }
    const detail = this._lastMarkerDetail;
    const inviteCode = this.getShareInviteCodeValue();
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
    const centerShare = this.consumeCenterActionSharePayload();
    if (centerShare && centerShare.queryBase) {
      return {
        title: centerShare.title,
        query: appendInviteCodeToQuery(centerShare.queryBase)
      };
    }
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
    return lifecycleUtils.onShow(this);
  },

  onResize(event = {}) {
    return lifecycleUtils.onResize(this, event);
  },

  normalizeCompassDirection(value) {
    return compassUtils.normalizeCompassDirection(value);
  },

  computeCompassDirectionDelta(next, prev) {
    return compassUtils.computeCompassDirectionDelta(this, next, prev);
  },

  startMyLocationDirectionTracking() {
    return compassUtils.startMyLocationDirectionTracking(this);
  },

  stopMyLocationDirectionTracking() {
    return compassUtils.stopMyLocationDirectionTracking(this);
  },

  onHide() {
    return cleanupUtils.onHide(this);
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
    if (Object.prototype.hasOwnProperty.call(detail, "uomLoading")) {
      updates.uomLoading = !!detail.uomLoading;
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

  onUomTilesChanged(event = {}) {
    const detail = event?.detail || {};
    const markers = Array.isArray(detail.markers) ? detail.markers : [];
    this._uom2Markers = markers;
    this.updateDebugPanel({ uom2MarkerCount: `${markers.length}` });
    this.syncAllMarkers();
  },

  onCheckinGuideStart() {
    return engagementUtils.onCheckinGuideStart(this);
  },

  buildDebugInfo(extra = {}) {
    return debugUtils.buildDebugInfo(this, extra);
  },

  updateDebugPanel(extra = {}) {
    return debugUtils.updateDebugPanel(this, extra);
  },

  formatDebugCoord(point) {
    return debugUtils.formatDebugCoord(point);
  },

  formatDebugRegion(region) {
    return debugUtils.formatDebugRegion(region);
  },

  collectRuntimeDebugInfo(options = {}) {
    return debugUtils.collectRuntimeDebugInfo(options);
  },

  onInviteGuideStart() {
    return engagementUtils.onInviteGuideStart(this);
  },

  onGuideMaskTap() {
    return engagementUtils.onGuideMaskTap(this);
  },

  showCheckinGuideOnMap() {
    return engagementUtils.showCheckinGuideOnMap(this);
  },

  showInviteGuideOnMap() {
    return engagementUtils.showInviteGuideOnMap(this);
  },

  measureCheckinGuideTarget() {
    return engagementUtils.measureCheckinGuideTarget(this);
  },

  measureInviteGuideTarget() {
    return engagementUtils.measureInviteGuideTarget(this);
  },

  updateMapCheckinEntryStyle() {
    return engagementUtils.updateMapCheckinEntryStyle(this);
  },

  updateSubscriptionBannerLayout(retry = 0) {
    return engagementUtils.updateSubscriptionBannerLayout(this, retry);
  },

  scheduleMapCheckinEntryStyleRefresh(delay = 180) {
    return engagementUtils.scheduleMapCheckinEntryStyleRefresh(this, delay);
  },

  scheduleSubscriptionBannerLayoutRefresh(delay = 32, retry = 0) {
    return engagementUtils.scheduleSubscriptionBannerLayoutRefresh(this, delay, retry);
  },

  loadCheckinStatus() {
    return engagementUtils.loadCheckinStatus(this);
  },

  buildGuideOverlayStyle(mask) {
    return engagementUtils.buildGuideOverlayStyle(mask);
  },

  onNewbieTaskStateChange(event) {
    return engagementUtils.onNewbieTaskStateChange(this, event);
  },

  onCityReportStateChange(event) {
    return cityReportUtils.onCityReportStateChange(this, event);
  },

  onCityReportDialogChange(event) {
    return cityReportUtils.onCityReportDialogChange(this, event);
  },

  onCityReportDialogClose() {
    return cityReportUtils.onCityReportDialogClose(this);
  },

  onNewbieGiftTap() {
    return floatingControlsUtils.onNewbieGiftTap(this);
  },

  onAddMiniAppStateChange(event) {
    return engagementUtils.onAddMiniAppStateChange(this, event);
  },

  updateMapBlockerVisible() {
    return engagementUtils.updateMapBlockerVisible(this);
  },

  scheduleAddMiniAppPopupCheck() {
    return engagementUtils.scheduleAddMiniAppPopupCheck(this);
  },

  shouldShowAddMiniAppPopup() {
    return engagementUtils.shouldShowAddMiniAppPopup(this);
  },

  canShowAddMiniAppPopup() {
    return engagementUtils.canShowAddMiniAppPopup(this);
  },

  maybeShowAddMiniAppPopup() {
    return engagementUtils.maybeShowAddMiniAppPopup(this);
  },

  handleAddMiniAppPopupClosed() {
    return engagementUtils.handleAddMiniAppPopupClosed(this);
  },

  onAddMiniAppPopupClose() {
    return engagementUtils.onAddMiniAppPopupClose(this);
  },

  persistMiniProgramAddedAt() {
    return engagementUtils.persistMiniProgramAddedAt(this);
  },


  onUnload() {
    return cleanupUtils.onUnload(this);
  },


  handleWorkGroupInviteOptions(options = {}) {
    return workgroupUtils.handleWorkGroupInviteOptions(this, options);
  },

  clearWorkGroupInviteParams() {
    return workgroupUtils.clearWorkGroupInviteParams(this);
  },

  setPendingWorkGroupInvite(payload = null) {
    return workgroupUtils.setPendingWorkGroupInvite(this, payload);
  },

  isSelfWorkGroupInvite(invitationCode = "") {
    return workgroupUtils.isSelfWorkGroupInvite(this, invitationCode);
  },

  promptJoinWorkGroup(promptPayload) {
    return workgroupUtils.promptJoinWorkGroup(this, promptPayload);
  },

  confirmJoinWorkGroup(promptPayload) {
    return workgroupUtils.confirmJoinWorkGroup(this, promptPayload);
  },

  cancelJoinWorkGroup() {
    return workgroupUtils.cancelJoinWorkGroup(this);
  },

  navigateToWorkGroupCenter() {
    return workgroupUtils.navigateToWorkGroupCenter(this);
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
    return preflightDashboardUtils.onKeywordInput(this, e);
  },

  onSearchConfirm() {
    return preflightDashboardUtils.onSearchConfirm(this);
  },

  computeDronePickerLabel(state = {}) {
    return dronePickerUtils.computeDronePickerLabel(this, state);
  },

  normalizeAircraftModel(value) {
    return dronePickerUtils.normalizeAircraftModel(this, value);
  },

  resolveDroneIndexByModel(model) {
    return dronePickerUtils.resolveDroneIndexByModel(this, model);
  },

  applyAircraftModelSetting(model, options = {}) {
    return dronePickerUtils.applyAircraftModelSetting(this, model, options);
  },

  getDroneList() {
    return dronePickerUtils.getDroneList(this);
  },

  resolveDroneCategoryId(item = {}) {
    return dronePickerUtils.resolveDroneCategoryId(this, item);
  },

  buildDroneCategories(list = []) {
    return dronePickerUtils.buildDroneCategories(this, list);
  },

  applyDroneList(list = []) {
    return dronePickerUtils.applyDroneList(this, list);
  },

  loadDronesFromApi() {
    return dronePickerUtils.loadDronesFromApi(this);
  },

  onSearchTap() {
    return preflightDashboardUtils.onSearchTap(this);
  },

  onSearchCoordinateTipsTap() {
    return preflightDashboardUtils.onSearchCoordinateTipsTap(this);
  },

  onCloseSearchCoordinateTipsDialog() {
    return preflightDashboardUtils.onCloseSearchCoordinateTipsDialog(this);
  },

  onChatButtonTap() {
    return floatingControlsUtils.onChatButtonTap(this);
  },

  onMapCheckinEntryTap() {
    if (typeof wx.navigateTo !== "function") {
      wx.showToast({ title: "当前版本暂不支持", icon: "none" });
      return;
    }
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData && app.globalData.checkinGuide?.active) {
      app.globalData.checkinGuide = { active: true, step: "checkin" };
      if (this.data.showCheckinGuideMap) {
        this.setData({ showCheckinGuideMap: false, checkinGuideOverlayStyle: "" });
      }
    }
    wx.navigateTo({ url: "/pages/profile/checkin/index" });
    this.ensureProfileAuthenticated()
      .then(() =>
        Promise.allSettled([
          this.ensureCheckinSubscriptionOnEntry(),
          this.requestProfileSubscriptions()
        ])
      )
      .catch((err) => {
        if (err?.message === "user-cancel") return;
        console.warn("map checkin subscriptions failed", err);
      });
  },

  onTemporaryZoneLinkTap(event) {
    return preflightDashboardUtils.onTemporaryZoneLinkTap(this, event);
  },

  onMenuHomeTap() {
    return bottomNavUtils.onMenuHomeTap(this);
  },

  onMenuProfileTap() {
    return bottomNavUtils.onMenuProfileTap(this);
  },

  onLayerButtonTap() {
    return layerPanelUtils.onLayerButtonTap(this);
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
    return layerPanelUtils.onLayerPanelMaskTap(this);
  },

  onLayerPanelClose() {
    return layerPanelUtils.onLayerPanelClose(this);
  },

  closeLayerPanel() {
    return layerPanelUtils.closeLayerPanel(this);
  },

  onMapLayerSelect(event = {}) {
    return layerPanelUtils.onMapLayerSelect(this, event);
  },

  onAirBoardSwitchChange(event = {}) {
    return layerPanelUtils.onAirBoardSwitchChange(this, event);
  },

  onUsePlanetCenterPointSwitchChange(event = {}) {
    return layerPanelUtils.onUsePlanetCenterPointSwitchChange(this, event);
  },

  onCenterTargetLinkSwitchChange(event = {}) {
    return layerPanelUtils.onCenterTargetLinkSwitchChange(this, event);
  },

  buildProvinceCityTreeViewData(treeNodes = null) {
    return layerPanelUtils.buildProvinceCityTreeViewData(this, treeNodes);
  },

  updateProvinceCityTreeData(extra = {}) {
    return layerPanelUtils.updateProvinceCityTreeData(this, extra);
  },

  scheduleLayerPanelLayoutMeasure(delay = 0) {
    return layerPanelUtils.scheduleLayerPanelLayoutMeasure(this, delay);
  },

  measureLayerPanelLayout() {
    return layerPanelUtils.measureLayerPanelLayout(this);
  },

  findProvinceCityTreeNodeById(nodeId, treeNodes = null) {
    return layerPanelUtils.findProvinceCityTreeNodeById(this, nodeId, treeNodes);
  },

  setProvinceCityHighlightPolygons(polygons = []) {
    return layerPanelUtils.setProvinceCityHighlightPolygons(this, polygons);
  },

  loadProvinceCityHighlightResource(options = {}) {
    return layerPanelUtils.loadProvinceCityHighlightResource(this, options);
  },

  syncProvinceCityHighlightLayer(enabled, options = {}) {
    return layerPanelUtils.syncProvinceCityHighlightLayer(this, enabled, options);
  },

  applyProvinceCityHighlightSelection(nodeId, options = {}) {
    return layerPanelUtils.applyProvinceCityHighlightSelection(this, nodeId, options);
  },

  onProvinceCityHighlightSwitchChange(event = {}) {
    return layerPanelUtils.onProvinceCityHighlightSwitchChange(this, event);
  },

  onProvinceCityTreeExpandTap(event = {}) {
    return layerPanelUtils.onProvinceCityTreeExpandTap(this, event);
  },

  onProvinceCityTreeSelectTap(event = {}) {
    return layerPanelUtils.onProvinceCityTreeSelectTap(this, event);
  },

  onMapElementToggle(event = {}) {
    return layerPanelUtils.onMapElementToggle(this, event);
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
    return preflightDashboardUtils.applyAirBoardToggle(this, enabled);
  },

  applyNoFlyOverlayToggle(options = {}) {
    const djiEnabled = options.djiEnabled !== false;
    const temporaryEnabled = options.temporaryEnabled !== false;
    if (!djiEnabled) {
      this._djiPolygons = [];
      this._djiCircles = [];
      this.setData({
        djiStatus: "已禁用",
        djiStatusExtra: "",
        djiTone: "warn",
        djiColor: ""
      });
    } else {
      this.setData({
        djiStatus: "评估中",
        djiStatusExtra: "",
        djiTone: "neutral",
        djiColor: ""
      });
    }
    this.setDjiLayerEnabled(djiEnabled, { force: djiEnabled });
    if (!temporaryEnabled) {
      this._nfzPolygons = [];
      this._nfzCircles = [];
      this.setData({
        temporaryNoFlyZoneInfo: null,
        temporaryNoFlyText: "已禁用",
        temporaryNoFlyTone: "warn"
      });
    } else {
      this.setData({
        temporaryNoFlyZoneInfo: null,
        temporaryNoFlyText: "评估中",
        temporaryNoFlyTone: "neutral"
      });
    }
    this.setTemporaryNoFlyLayerEnabled(temporaryEnabled, { force: temporaryEnabled });
    this.updateOverlayGraphics();
  },

  applyMerchantMarkersToggle(enabled) {
    if (enabled === false) {
      this._nearbyMarkersRaw = [];
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

  parseMapLayerExtraBoolean(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (!normalized) return fallback;
      if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
        return true;
      }
      if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
        return false;
      }
    }
    return fallback;
  },

  resolveCenterTargetLinkEnabled(settings = {}) {
    const extraConfig = settings && typeof settings.extraConfig === "object" ? settings.extraConfig : null;
    const raw = extraConfig ? extraConfig[MAP_LAYER_EXTRA_CONFIG_DISABLE_CENTER_TARGET_LINK_KEY] : undefined;
    if (raw === undefined || raw === null) {
      return true;
    }
    const disabled = this.parseMapLayerExtraBoolean(raw, false);
    return disabled !== true;
  },

  resolveProvinceCityHighlightEnabled(settings = {}) {
    const extraConfig = settings && typeof settings.extraConfig === "object" ? settings.extraConfig : null;
    const raw = extraConfig ? extraConfig[MAP_LAYER_EXTRA_CONFIG_ENABLE_PROVINCE_CITY_HIGHLIGHT_KEY] : undefined;
    if (raw === undefined || raw === null) {
      return false;
    }
    return this.parseMapLayerExtraBoolean(raw, false) === true;
  },

  resolveProvinceCityHighlightSelectionId(settings = {}) {
    const extraConfig = settings && typeof settings.extraConfig === "object" ? settings.extraConfig : null;
    const raw = extraConfig ? extraConfig[MAP_LAYER_EXTRA_CONFIG_PROVINCE_CITY_HIGHLIGHT_SELECTION_KEY] : undefined;
    if (typeof raw !== "string") {
      return "";
    }
    return raw.trim();
  },

  buildMapLayerExtraConfigPayload() {
    const existing =
      this._mapLayerSettings && typeof this._mapLayerSettings.extraConfig === "object"
        ? this._mapLayerSettings.extraConfig
        : null;
    const extraConfig = existing ? Object.assign({}, existing) : {};
    extraConfig[MAP_LAYER_EXTRA_CONFIG_DISABLE_CENTER_TARGET_LINK_KEY] =
      this.data.centerTargetLinkEnabled === false ? "true" : "false";
    extraConfig[MAP_LAYER_EXTRA_CONFIG_ENABLE_PROVINCE_CITY_HIGHLIGHT_KEY] =
      this.data.provinceCityHighlightEnabled === true ? "true" : "false";
    const selectedId =
      `${this._provinceCityHighlightSelectedId || this.data.provinceCityHighlightSelectedId || ""}`.trim();
    extraConfig[MAP_LAYER_EXTRA_CONFIG_PROVINCE_CITY_HIGHLIGHT_SELECTION_KEY] = selectedId || null;
    return extraConfig;
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
      useDefaultCenterPoint: !this.data.usePlanetCenterPoint,
      aircraftModel: this.data.selectedDrone || "",
      extraConfig: this.buildMapLayerExtraConfigPayload()
    };
  },

  normalizeCachedMapLocation(payload = null) {
    return locationUtils.normalizeCachedMapLocation(payload);
  },

  loadCachedMapLocation() {
    return locationUtils.loadCachedMapLocation(this);
  },

  cacheMapLocation(point = null) {
    return locationUtils.cacheMapLocation(this, point);
  },

  resolveCachedMapLocationPoint() {
    return locationUtils.resolveCachedMapLocationPoint(this);
  },

  applyCachedMapLocationFallback(options = {}) {
    return locationUtils.applyCachedMapLocationFallback(this, options);
  },

  loadCachedUsePlanetMyLocationPreference() {
    if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return null;
    try {
      const cached = wx.getStorageSync(MAP_USE_PLANET_MY_LOCATION_STORAGE_KEY);
      if (typeof cached === "boolean") return cached;
    } catch (err) {
      console.warn("load cached usePlanetMyLocation preference failed", err);
    }
    return null;
  },

  cacheUsePlanetMyLocationPreference(enabled) {
    if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") return;
    try {
      wx.setStorageSync(MAP_USE_PLANET_MY_LOCATION_STORAGE_KEY, enabled === true);
    } catch (err) {
      console.warn("cache usePlanetMyLocation preference failed", err);
    }
  },

  syncMyLocationPoint(options = {}) {
    return locationUtils.syncMyLocationPoint(this, options);
  },

  applyLayerSettings(settings = {}, options = {}) {
    return layerPanelUtils.applyLayerSettings(this, settings, options);
  },

  loadMapLayerSettings(force = false) {
    return layerPanelUtils.loadMapLayerSettings(this, force);
  },

  bootstrapMapLayerSettings(force = false) {
    return layerPanelUtils.bootstrapMapLayerSettings(this, force);
  },

  persistMapLayerSettings() {
    return layerPanelUtils.persistMapLayerSettings(this);
  },

  onMarkerButtonTap() {
    return floatingControlsUtils.onMarkerButtonTap(this);
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

  applyNearbyMarkers(list) {
    this._nearbyMarkersRaw = Array.isArray(list) ? list.slice() : [];
    this.rebuildNearbyMarkerGraphics();
  },

  buildNearbyMerchantMarker(item = {}, index = 0, scaleInMeters = null) {
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
    const marker = {
      id: item?.id || `nearby-${index}`,
      latitude: latitudeGcj,
      longitude: longitudeGcj,
      title: name,
      iconPath: "/assets/drone.png",
      width: 40,
      height: 40
    };
    const displayMode = this.resolveMarkerDisplayMode(item, scaleInMeters);
    if (displayMode === DISPLAY_MODE_HIDDEN) {
      return null;
    }
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
    return this.applyDisplayModeToMarker(marker, item, {
      scaleInMeters,
      baseSize: 40
    });
  },

  rebuildNearbyMarkerGraphics() {
    const rawList = Array.isArray(this._nearbyMarkersRaw) ? this._nearbyMarkersRaw : [];
    const scaleInMeters = this.getCurrentScaleInMeters(this.data.scale);
    this._nearbyMarkers = rawList
      .map((item, index) => this.buildNearbyMerchantMarker(item, index, scaleInMeters))
      .filter(Boolean);
    this.trackMarkerExposure(this._nearbyMarkers);
    this.syncAllMarkers();
  },

  refreshNearbyDisplayModes() {
    if (Array.isArray(this._nearbyMarkersRaw) && this._nearbyMarkersRaw.length) {
      this.rebuildNearbyMarkerGraphics();
    } else {
      this.syncAllMarkers();
    }
    if (Array.isArray(this._nearbyPinsRaw) && this._nearbyPinsRaw.length) {
      this.rebuildNearbyPinGraphics();
    }
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
    const scaleInMeters = this.getCurrentScaleInMeters(this.data.scale);
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
          coordsAreGcj: true,
          raw: item,
          scaleInMeters
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

  formatCenterPinLinkDistance(distanceMeters) {
    const meters = Number(distanceMeters);
    if (!Number.isFinite(meters) || meters < 0) return "";
    if (meters >= 1000) {
      const km = meters / 1000;
      const display = km >= 10 ? Math.round(km) : Math.round(km * 10) / 10;
      return `${display}km`;
    }
    return `${Math.max(1, Math.round(meters))}m`;
  },

  buildCenterPinLinkState(center, options = {}) {
    const target = options.target;
    const owner = `${options.owner || ""}`.trim();
    const visible = options.visible === true;
    if (
      this.data.centerTargetLinkEnabled === false ||
      !visible ||
      !owner ||
      !hasValidCoordinate(center?.latitude, center?.longitude) ||
      !hasValidCoordinate(target?.latitude, target?.longitude)
    ) {
      return {
        centerPinLinkActive: false,
        centerPinLinkTipText: ""
      };
    }
    const distanceMeters = computeGreatCircleDistance(center, target);
    if (!Number.isFinite(distanceMeters) || distanceMeters < 0.5) {
      return {
        centerPinLinkActive: false,
        centerPinLinkTipText: ""
      };
    }
    const distanceText = this.formatCenterPinLinkDistance(distanceMeters);
    return {
      centerPinLinkActive: true,
      centerPinLinkTipText: `距离${distanceText}，长按解除`
    };
  },

  clearCenterPinLinkState() {
    if (!this.data.centerPinLinkActive && !this.data.centerPinLinkTipText) {
      return;
    }
    this.setData({
      centerPinLinkActive: false,
      centerPinLinkTipText: ""
    });
  },

  clearActiveCenterTargetLink() {
    if (this._searchLinkOwner === SEARCH_LINK_OWNER_MAP_TAP) {
      this.clearMapTapTargetPoint();
      return true;
    }
    if (this._searchLinkOwner === SEARCH_LINK_OWNER_SEARCH) {
      this.clearSearchSelectionVisuals();
      return true;
    }
    return false;
  },

  applySearchLinkTarget(target, options = {}) {
    const owner = `${options.owner || ""}`.trim();
    const latitude = Number(target?.latitude);
    const longitude = Number(target?.longitude);
    const hasTarget = Number.isFinite(latitude) && Number.isFinite(longitude);
    const nextTarget = hasTarget ? { latitude, longitude } : null;
    this._searchLinkOwner = owner;
    const linkState = this.buildCenterPinLinkState(this.data.searchLinkCenter, {
      target: nextTarget,
      visible: hasTarget && options.visible !== false,
      owner
    });
    this.setData({
      searchLinkTarget: nextTarget,
      searchLinkVisible: hasTarget && options.visible !== false,
      ...linkState
    });
  },

  clearSearchLinkOverlay(options = {}) {
    const owner = `${options.owner || ""}`.trim();
    if (
      options.force !== true &&
      owner &&
      this._searchLinkOwner &&
      this._searchLinkOwner !== owner
    ) {
      return false;
    }
    this._searchLinkMarkers = [];
    this._searchLinkPolylines = [];
    this.syncAllPolylines();
    this.syncAllMarkers();
    if (
      this.data.searchLinkTarget ||
      this.data.searchLinkVisible ||
      this.data.centerPinLinkActive ||
      this.data.centerPinLinkTipText ||
      this._searchLinkOwner
    ) {
      this._searchLinkOwner = "";
      this.setData({
        searchLinkTarget: null,
        searchLinkVisible: false,
        centerPinLinkActive: false,
        centerPinLinkTipText: ""
      });
      return true;
    }
    this._searchLinkOwner = "";
    return true;
  },

  clearSearchSelectionVisuals() {
    return preflightDashboardUtils.clearSearchSelectionVisuals(this);
  },

  rebuildMapTapTargetMarker() {
    const marker = buildMapTapTargetMarker(this._mapTapTarget);
    this._mapTapTargetMarkers = marker ? [marker] : [];
    this.syncAllMarkers();
  },

  clearMapTapTargetPoint(options = {}) {
    const hadTarget = !!this._mapTapTarget || (Array.isArray(this._mapTapTargetMarkers) && this._mapTapTargetMarkers.length > 0);
    this._mapTapTarget = null;
    this._mapTapTargetMarkers = [];
    this._mapTapTargetResolveToken += 1;
    if (hadTarget) {
      this.syncAllMarkers();
    }
    if (options.preserveSearchLink !== true) {
      this.clearSearchLinkOverlay({ owner: SEARCH_LINK_OWNER_MAP_TAP });
    }
  },

  applyMapTapTargetPoint(point, options = {}) {
    const target = buildMapTapTargetState(point, options);
    if (!target) return false;
    const tappedAt = Number(options.tappedAt);
    this._mapTapTargetTapAt = Number.isFinite(tappedAt) ? tappedAt : Date.now();
    this._mapTapTargetResolveToken += 1;
    const resolveToken = this._mapTapTargetResolveToken;
    this._mapTapTarget = target;
    this.rebuildMapTapTargetMarker();
    this.applySearchLinkTarget(target, {
      owner: SEARCH_LINK_OWNER_MAP_TAP,
      visible: true
    });
    this.requestPinAddress(target.latitude, target.longitude)
      .then((address) => {
        if (resolveToken !== this._mapTapTargetResolveToken || !this._mapTapTarget) {
          return;
        }
        this._mapTapTarget = updateMapTapTargetAddress(this._mapTapTarget, address);
        this.rebuildMapTapTargetMarker();
      })
      .catch((err) => console.warn("resolve map tap target address failed", err));
    return true;
  },

  onMapTap(event = {}) {
    if (this.data.centerTargetLinkEnabled === false) {
      return;
    }
    if (Date.now() < (Number(this._mapTapSuppressUntil) || 0)) {
      return;
    }
    const point = normalizeMapTapPoint(event?.detail || event);
    if (!point) return;
    const now = Date.now();
    if (!canReplaceMapTapTarget(this._mapTapTargetTapAt, now)) {
      wx.showToast({ title: "请2秒后再选下一个目标点", icon: "none" });
      return;
    }
    this.clearSearchSelectionVisuals();
    this.applyMapTapTargetPoint(point, { tappedAt: now });
  },

  onMapLongPress(event = {}) {
    if (!this._mapTapTarget) return;
    const point = normalizeMapTapPoint(event?.detail || event);
    if (!point) return;
    if (!shouldRemoveMapTapTarget(this._mapTapTarget, point)) {
      return;
    }
    this._mapTapSuppressUntil = Date.now() + 800;
    this.clearMapTapTargetPoint();
  },

  onSearchLinkGraphicsChange(event = {}) {
    const detail = event?.detail || {};
    this._searchLinkMarkers = Array.isArray(detail.markers) ? detail.markers : [];
    this._searchLinkPolylines = Array.isArray(detail.polylines) ? detail.polylines : [];
    this.queueMapGraphicsSync({ markers: true, polylines: true });
  },

  isMyLocationCirclesChanged(prev = [], next = []) {
    if (!Array.isArray(prev) || !Array.isArray(next)) return true;
    if (prev.length !== next.length) return true;
    for (let i = 0; i < prev.length; i += 1) {
      const a = prev[i] || {};
      const b = next[i] || {};
      if (
        Number(a.latitude) !== Number(b.latitude) ||
        Number(a.longitude) !== Number(b.longitude) ||
        Number(a.radius) !== Number(b.radius) ||
        Number(a.strokeWidth) !== Number(b.strokeWidth) ||
        `${a.color || ""}` !== `${b.color || ""}` ||
        `${a.fillColor || ""}` !== `${b.fillColor || ""}`
      ) {
        return true;
      }
    }
    return false;
  },

  isMyLocationMarkersChanged(prev = [], next = []) {
    if (!Array.isArray(prev) || !Array.isArray(next)) return true;
    if (prev.length !== next.length) return true;
    for (let i = 0; i < prev.length; i += 1) {
      const a = prev[i] || {};
      const b = next[i] || {};
      if (
        Number(a.id) !== Number(b.id) ||
        Number(a.latitude) !== Number(b.latitude) ||
        Number(a.longitude) !== Number(b.longitude) ||
        Number(a.width) !== Number(b.width) ||
        Number(a.height) !== Number(b.height) ||
        Number(a.rotate) !== Number(b.rotate) ||
        Number(a.zIndex) !== Number(b.zIndex) ||
        `${a.iconPath || ""}` !== `${b.iconPath || ""}`
      ) {
        return true;
      }
    }
    return false;
  },

  queueMapGraphicsSync(options = {}) {
    const next = this._pendingMapGraphicsSync || {
      markers: false,
      polylines: false,
      overlay: false
    };
    if (options.markers) next.markers = true;
    if (options.polylines) next.polylines = true;
    if (options.overlay) next.overlay = true;
    this._pendingMapGraphicsSync = next;
    if (this._mapGraphicsSyncTimer) return;
    this._mapGraphicsSyncTimer = setTimeout(() => {
      this._mapGraphicsSyncTimer = null;
      const pending = this._pendingMapGraphicsSync || {};
      this._pendingMapGraphicsSync = null;
      if (pending.markers) {
        this.syncAllMarkers();
      }
      if (pending.polylines) {
        this.syncAllPolylines();
      }
      if (pending.overlay) {
        this.updateOverlayGraphics();
      }
    }, 0);
  },

  syncAllPolylines() {
    const polylines = Array.isArray(this._searchLinkPolylines) ? this._searchLinkPolylines : [];
    this.setData({ polylines });
  },

  syncAllMarkers() {
    const nearby =
      this.data.merchantMarkersEnabled !== false && Array.isArray(this._nearbyMarkers)
        ? this._nearbyMarkers
        : [];
    const pinMarkers = Array.isArray(this._nearbyPinMarkers) ? this._nearbyPinMarkers : [];
    const search = Array.isArray(this._searchMarkers) ? this._searchMarkers : [];
    const searchLink = Array.isArray(this._searchLinkMarkers) ? this._searchLinkMarkers : [];
    const mapTapTarget = Array.isArray(this._mapTapTargetMarkers) ? this._mapTapTargetMarkers : [];
    const manual = Array.isArray(this._manualMarkers) ? this._manualMarkers : [];
    const preview = this._previewMarker ? [this._previewMarker] : [];
    const myLocation = Array.isArray(this._myLocationMarkers) ? this._myLocationMarkers : [];
    const uom2 = Array.isArray(this._uom2Markers) ? this._uom2Markers : [];
    this.normalizeMapMarkerList(uom2);
    this.normalizeMapMarkerList(nearby);
    this.normalizeMapMarkerList(pinMarkers);
    this.normalizeMapMarkerList(search);
    this.normalizeMapMarkerList(searchLink);
    this.normalizeMapMarkerList(mapTapTarget);
    this.normalizeMapMarkerList(manual);
    this.normalizeMapMarkerList(preview);
    this.normalizeMapMarkerList(myLocation);
    const combined = this.dedupeMapMarkers(
      uom2.concat(manual, pinMarkers, nearby, search, searchLink, mapTapTarget, preview, myLocation)
    );
    this.setData({ markers: combined });
  },

  updateCenterPinIndicator(centerOverride) {
    const center = centerOverride || this._centerOverride || this.data.center;
    if (!center || !hasValidCoordinate(center.latitude, center.longitude)) {
      this.setData({
        centerPinTitle: "",
        centerCoordinateLatText: "",
        centerCoordinateLngText: "",
        centerCoordinateLatValue: null,
        centerCoordinateLngValue: null,
        searchLinkCenter: null,
        centerPinLinkActive: false,
        centerPinLinkTipText: "",
        cityReportCenter: null
      });
      return;
    }
    let displayLat = Number(center.latitude);
    let displayLng = Number(center.longitude);
    const converted = convertCoordinateFromGcj02(
      Number(center.longitude),
      Number(center.latitude),
      this.data.coordinateSystem
    );
    if (converted && hasValidCoordinate(converted.lat, converted.lng)) {
      displayLat = converted.lat;
      displayLng = converted.lng;
    }
    const pin = this.findPinContainingPoint(center);
    const coord = formatCoordinateDisplayParts(displayLat, displayLng);
    const normalizedCenter = {
      latitude: Number(center.latitude),
      longitude: Number(center.longitude)
    };
    const linkState = this.buildCenterPinLinkState(normalizedCenter, {
      target: this.data.searchLinkTarget,
      visible: this.data.searchLinkVisible,
      owner: this._searchLinkOwner
    });
    this.setData({
      centerPinTitle: pin ? pin.name || "" : "",
      centerCoordinateLngText: coord ? coord.lngText : "",
      centerCoordinateLatText: coord ? coord.latText : "",
      centerCoordinateLngValue: Number.isFinite(displayLng) ? displayLng : null,
      centerCoordinateLatValue: Number.isFinite(displayLat) ? displayLat : null,
      searchLinkCenter: normalizedCenter,
      cityReportCenter: normalizedCenter,
      ...linkState
    });
  },

  onCenterCoordinateTap() {
    const center = this._centerOverride || this.data.center;
    const hasCenter = hasValidCoordinate(center?.latitude, center?.longitude);
    let displayLat = hasCenter ? Number(center.latitude) : Number(this.data.centerCoordinateLatValue);
    let displayLng = hasCenter ? Number(center.longitude) : Number(this.data.centerCoordinateLngValue);

    if (hasCenter) {
      const converted = convertCoordinateFromGcj02(
        Number(center.longitude),
        Number(center.latitude),
        this.data.coordinateSystem
      );
      if (converted && hasValidCoordinate(converted.lat, converted.lng)) {
        displayLat = converted.lat;
        displayLng = converted.lng;
      }
    }

    if (!Number.isFinite(displayLat) || !Number.isFinite(displayLng)) return;

    const showCopyLoading = !this._isIOS;
    if (showCopyLoading) {
      wx.showLoading({ title: "经纬度解析中", mask: false });
    }

    const copyResolvedText = (address = "") => {
      const text = buildCoordinateClipboardText({
        lat: displayLat,
        lng: displayLng,
        coordinateSystem: this.data.coordinateSystem,
        address
      });
      if (!text) {
        if (showCopyLoading) {
          wx.hideLoading();
        }
        wx.showToast({ title: "复制失败", icon: "none" });
        return;
      }
      let copied = false;
      wx.setClipboardData({
        data: text,
        success: () => {
          copied = true;
        },
        fail: (err) => {
          console.error("复制经纬度失败", err);
          if (showCopyLoading) {
            wx.hideLoading();
          }
          wx.showToast({ title: "复制失败", icon: "none" });
        },
        complete: () => {
          if (showCopyLoading) {
            wx.hideLoading();
          }
          if (copied && !this._isIOS) {
            setTimeout(() => {
              wx.showToast({ title: "经纬度已复制", icon: "success", duration: 1500 });
            }, 120);
          }
        }
      });
    };

    if (!hasCenter) {
      copyResolvedText("");
      return;
    }

    this.requestPinAddress(Number(center.latitude), Number(center.longitude))
      .then((address) => copyResolvedText(address || ""))
      .catch((err) => {
        console.warn("center reverse geocode failed", err);
        copyResolvedText("");
      });
  },

  onCoordinateSystemToggle() {
    if (this.data.coordinateSystemSheetVisible) return;
    this.setData({ coordinateSystemSheetVisible: true });
    if (this.getAuthToken()) {
      this.loadMapGuideConfigs().catch((err) => {
        console.warn("loadMapGuideConfigs onCoordinateSystemToggle failed", err);
      });
    }
  },

  onCoordinateSystemSheetTap() { },

  onCoordinateSystemSheetMaskTap() {
    if (!this.data.coordinateSystemSheetVisible) return;
    this.setData({ coordinateSystemSheetVisible: false });
  },

  onCoordinateSystemOptionTap(event) {
    const next = normalizeCoordinateSystem(event?.currentTarget?.dataset?.value || event?.detail?.value);
    const changed = next !== this.data.coordinateSystem;
    const updates = {
      coordinateSystemSheetVisible: false
    };
    if (changed) {
      updates.coordinateSystem = next;
      updates.coordinateSystemLabel = resolveCoordinateSystemDisplayLabel(next);
    }
    this.setData(updates, () => {
      if (changed) {
        this.updateCenterPinIndicator();
      }
    });
  },

  findPinContainingPoint(point = {}) {
    return centerHitUtils.findPinContainingPoint(this, point);
  },

  shouldDismissCenterPinWelcomeBubbleOnRegionChange(cause = "") {
    const normalized = `${cause || ""}`.trim().toLowerCase();
    if (!normalized) return false;
    return (
      normalized === "drag" ||
      normalized === "gesture" ||
      normalized === "scale" ||
      normalized === "rotate" ||
      normalized === "skew" ||
      normalized === "overlook"
    );
  },

  dismissCenterPinWelcomeBubble() {
    const nextToken = (Number(this.data.centerPinWelcomeBubbleDismissToken) || 0) + 1;
    this.setData({ centerPinWelcomeBubbleDismissToken: nextToken });
  },

  suppressCenterPinOpenOnce(durationMs) {
    return centerPinFollowUtils.suppressCenterPinOpenOnce(this, durationMs);
  },

  shouldSuppressCenterPinOpen() {
    return centerPinFollowUtils.shouldSuppressCenterPinOpen(this);
  },

  onCenterPinSheetClose() {
    return centerPinFollowUtils.onCenterPinSheetClose(this);
  },

  buildStealthModeSnapshot() {
    return {
      layerPanelVisible: !!this.data.layerPanelVisible,
      coordinateSystemSheetVisible: !!this.data.coordinateSystemSheetVisible
    };
  },

  enterStealthMode() {
    if (this.data.stealthModeActive) return;
    this._stealthModeSnapshot = this.buildStealthModeSnapshot();
    if (this._layerPanelCloseTimer) {
      clearTimeout(this._layerPanelCloseTimer);
      this._layerPanelCloseTimer = null;
    }
    this.setData({
      stealthModeActive: true,
      layerPanelVisible: false,
      layerPanelClosing: false,
      coordinateSystemSheetVisible: false,
      cityReportDialogVisible: false,
      searchCoordinateTipsVisible: false
    });
  },

  exitStealthMode() {
    if (!this.data.stealthModeActive) return;
    const snapshot = this._stealthModeSnapshot || {};
    this._stealthModeSnapshot = null;
    this.setData({
      stealthModeActive: false,
      layerPanelVisible: !!snapshot.layerPanelVisible,
      layerPanelClosing: false,
      coordinateSystemSheetVisible: !!snapshot.coordinateSystemSheetVisible
    });
  },

  onCenterPinTap() {
    return centerPinActionsUtils.onCenterPinTap(this);
  },

  startCenterPinLocationFollow() {
    return centerPinFollowUtils.startCenterPinLocationFollow(this);
  },

  stopCenterPinLocationFollow(options = {}) {
    return centerPinFollowUtils.stopCenterPinLocationFollow(this, options);
  },

  scheduleCenterPinLocationFollow(delay) {
    return centerPinFollowUtils.scheduleCenterPinLocationFollow(this, delay);
  },

  runCenterPinLocationFollowTick() {
    return centerPinFollowUtils.runCenterPinLocationFollowTick(this);
  },

  shouldIgnoreRegionSyncForCenterPinFollow(cause = "") {
    return centerPinFollowUtils.shouldIgnoreRegionSyncForCenterPinFollow(this, cause);
  },

  pauseCenterPinLocationFollow() {
    return centerPinFollowUtils.pauseCenterPinLocationFollow(this);
  },

  resumeCenterPinLocationFollow() {
    return centerPinFollowUtils.resumeCenterPinLocationFollow(this);
  },

  onCenterPinLongPress(event = {}) {
    return centerPinActionsUtils.onCenterPinLongPress(this, event);
  },

  onCenterPinAction(event) {
    return centerPinActionsUtils.onCenterPinAction(this, event);
  },

  openPlanetQaAtCenter() {
    return centerPinActionsUtils.openPlanetQaAtCenter(this);
  },

  openAfeiAdventure(detail = {}) {
    return centerPinActionsUtils.openAfeiAdventure(this, detail);
  },

  openMyPinCreateAtCenter() {
    return centerPinActionsUtils.openMyPinCreateAtCenter(this);
  },

  navigateToMarkersPinCreate(payload = {}) {
    return centerPinActionsUtils.navigateToMarkersPinCreate(payload);
  },

  onCenterPinIndicatorTap() {
    return preflightDashboardUtils.onCenterPinIndicatorTap(this);
  },

  openMarkerOrPinAtCenter() {
    return centerHitUtils.openMarkerOrPinAtCenter(this);
  },

  openPinDetail(pin) {
    return centerHitUtils.openPinDetail(this, pin);
  },

  findClosestMarkerFromCenter(point = {}, maxDistanceMeters = 35) {
    return centerHitUtils.findClosestMarkerFromCenter(this, point, maxDistanceMeters);
  },

  pinContainsPoint(pin = {}, point = {}) {
    return centerHitUtils.pinContainsPoint(this, pin, point);
  },

  distanceToPolylineMeters(point, coords = []) {
    return centerHitUtils.distanceToPolylineMeters(point, coords);
  },

  distancePointToSegmentMeters(lat, lng, a = {}, b = {}, factors = null) {
    return centerHitUtils.distancePointToSegmentMeters(lat, lng, a, b, factors);
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

  loadMarkerLikeInfo(options = {}) {
    return markerActionsUtils.loadMarkerLikeInfo(this, options);
  },

  onMarkerLikeTouchStart(e) {
    return markerActionsUtils.onMarkerLikeTouchStart(this, e);
  },

  onMarkerLikeTouchEnd(e) {
    return markerActionsUtils.onMarkerLikeTouchEnd(this, e);
  },

  onLikeCountTap(e) {
    return markerActionsUtils.onLikeCountTap(this, e);
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
    const shapeRaw = raw.shape || {};
    const shapeType = `${shapeRaw.type || ""}`.toUpperCase() || "POINT";
    const shape = isKmlShapeType(shapeType) ? normalizeKmlShape(shapeRaw) : shapeRaw;
    const resolved = resolveShapeCoordinates(shape);
    const normalizedCoords = this.normalizePreviewCoordinateList(resolved.coordinates);
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
      type: resolved.resolvedType || shapeType,
      coordinates: normalizedCoords,
      radius: Number(shape.radius ?? shape.radiusKm ?? shape.radiusInKilometers),
      width: Number(shape.width ?? shape.bufferWidth ?? shape.bufferWidthMeters ?? shape.pathDistanceMeters),
      pointCategory: shape.pointCategory || shape.pointcategory,
      style: shape.style
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
    return preflightDashboardUtils.performSearch(this);
  },

  scheduleSearchSuggest() {
    return preflightDashboardUtils.scheduleSearchSuggest(this);
  },

  fetchSearchSuggestions() {
    return preflightDashboardUtils.fetchSearchSuggestions(this);
  },

  onSuggestionTap(e) {
    return preflightDashboardUtils.onSuggestionTap(this, e);
  },

  openDronePicker() {
    return dronePickerUtils.openDronePicker(this);
  },

  closeDronePicker() {
    return dronePickerUtils.closeDronePicker(this);
  },

  onSelectDroneCategory(e) {
    return dronePickerUtils.onSelectDroneCategory(this, e);
  },

  onSelectDroneOption(e) {
    return dronePickerUtils.onSelectDroneOption(this, e);
  },

  confirmDronePicker() {
    return dronePickerUtils.confirmDronePicker(this);
  },

  applyDroneByIndex(idx, options = {}) {
    return dronePickerUtils.applyDroneByIndex(this, idx, options);
  },

  onLocateTap() {
    return floatingControlsUtils.onLocateTap(this);
  },

  onCompassTap() {
    this.resetCompassState();
  },

  requestInitialLocation() {
    return locationUtils.requestInitialLocation(this);
  },

  pullAndCenterLocation(options = {}) {
    return locationUtils.pullAndCenterLocation(this, options);
  },

  getApiBase() {
    const app = getApp ? getApp() : null;
    return (app && app.globalData && app.globalData.apiBase) || "";
  },

  ensureCheckinSubscriptionOnEntry() {
    return subscriptionUtils.ensureCheckinSubscriptionOnEntry(this);
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
    return this.applyMarkerCertificationState(detail);
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

  buildCoordinateSearchMarker(payload = {}, options = {}) {
    const displayLatitude = Number(payload.latitude);
    const displayLongitude = Number(payload.longitude);
    if (!Number.isFinite(displayLatitude) || !Number.isFinite(displayLongitude)) {
      return null;
    }
    const gcj = convertParsedCoordinateToGcj02(payload, this.data.coordinateSystem);
    const latitude = Number(gcj?.lat);
    const longitude = Number(gcj?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const title = `${payload.title || "经纬度位置"}`.trim();
    const address = `${payload.address || ""}`.trim();
    const rawDetail = {
      id: payload.id || `coordinate-search-${Date.now()}`,
      name: title,
      title,
      address,
      latitude,
      longitude,
      displayLatitude,
      displayLongitude,
      coordinateSystem: this.data.coordinateSystem,
      location: { text: address }
    };
    const marker = {
      id: rawDetail.id,
      latitude,
      longitude,
      title
    };
    if (title || address) {
      marker.callout = {
        content: address ? `${title}\n${address}` : title,
        display: "ALWAYS",
        borderRadius: 4,
        padding: 4
      };
    }
    const detail = this.composeMarkerDetail(rawDetail, marker, {
      source: options.source || "coordinate-search",
      name: title,
      locationText: address,
      id: rawDetail.id
    });
    marker.extData = {
      source: options.source || "coordinate-search",
      raw: rawDetail,
      detail: cloneMarkerDetail(detail)
    };
    return marker;
  },

  buildSearchSelectionMarker(suggestion = {}, index = 0) {
    return preflightDashboardUtils.buildSearchSelectionMarker(this, suggestion, index);
  },

  isSearchMarkerSource(source = "") {
    const src = `${source || ""}`.trim().toLowerCase();
    if (!src || src.includes("search-link")) {
      return false;
    }
    return (
      src === "search" ||
      src === "search-selected" ||
      src === "marker-search" ||
      src === "marker-search-selected" ||
      src === "pin-search" ||
      src === "pin-search-selected" ||
      src === "coordinate-search" ||
      src === "coordinate-search-selected"
    );
  },

  isSearchSelectionMarker(marker = {}) {
    const source = marker?.extData?.source || marker?.source || "";
    return this.isSearchMarkerSource(source);
  },

  cloneSearchSelectionMarker(marker = {}) {
    if (!marker || typeof marker !== "object") {
      return null;
    }
    const next = Object.assign({}, marker);
    if (marker.extData && typeof marker.extData === "object") {
      next.extData = Object.assign({}, marker.extData);
      if (marker.extData.detail && typeof marker.extData.detail === "object") {
        next.extData.detail = cloneMarkerDetail(marker.extData.detail);
      }
    }
    return next;
  },

  applySearchSelectionFromMarker(marker, options = {}) {
    return preflightDashboardUtils.applySearchSelectionFromMarker(this, marker, options);
  },

  resolveSearchSelectionAddress(marker = {}) {
    const source = `${marker?.extData?.source || marker?.source || ""}`.trim().toLowerCase();
    if (!source.includes("coordinate")) return;
    const latitude = Number(marker.latitude);
    const longitude = Number(marker.longitude);
    const markerId = marker.id;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !markerId) {
      return;
    }
    this.requestPinAddress(latitude, longitude)
      .then((address) => {
        if (!address) return;
        this.applySearchMarkerAddress(markerId, address);
      })
      .catch((err) => console.warn("resolve coordinate search address failed", err));
  },

  applySearchMarkerAddress(markerId, address) {
    if (!markerId || !address || !Array.isArray(this._searchMarkers)) return;
    let changed = false;
    const nextMarkers = this._searchMarkers.map((marker) => {
      if (`${marker?.id || ""}` !== `${markerId}`) {
        return marker;
      }
      const next = Object.assign({}, marker);
      const title = `${next.title || next.name || "经纬度位置"}`.trim();
      next.callout = {
        content: `${title}\n${address}`,
        display: "ALWAYS",
        borderRadius: 4,
        padding: 4
      };
      if (next.extData && typeof next.extData === "object") {
        const raw = Object.assign({}, next.extData.raw || {}, {
          address,
          location: { text: address }
        });
        const detail = Object.assign({}, next.extData.detail || {}, {
          address,
          locationText: address
        });
        next.extData = Object.assign({}, next.extData, { raw, detail });
      }
      changed = true;
      return next;
    });
    if (!changed) return;
    this.applySearchMarkers(nextMarkers);
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
    return markerActionsUtils.trackPinExposure(this, markers);
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
    const shapeRaw = raw?.shape || {};
    const shapeType = `${shapeRaw.type || ""}`.toUpperCase();
    const shape = isKmlShapeType(shapeType) ? normalizeKmlShape(shapeRaw) : shapeRaw;
    const resolved = resolveShapeCoordinates(shape);
    const resolvedShapeType = `${resolved.resolvedType || shapeType || "POINT"}`.toUpperCase();
    const coords = this.normalizePreviewCoordinateList(resolved.coordinates);
    const primary =
      coords.find((coord) => hasValidCoordinate(coord?.latitude, coord?.longitude)) ||
      detail ||
      {};
    const center =
      resolvedShapeType !== "POINT"
        ? this.computePinPreviewCenter(
          {
            type: resolvedShapeType,
            coordinates: coords,
            radius: Number(shape.radius ?? shape.radiusKm ?? shape.radiusInKilometers),
            width: Number(shape.width ?? shape.bufferWidth ?? shape.bufferWidthMeters ?? shape.pathDistanceMeters),
            pointCategory: shape.pointCategory || shape.pointcategory,
            style: shape.style
          },
          {}
        )
        : null;
    const target = center || primary;
    const latitude = Number(target.latitude);
    const longitude = Number(target.longitude);
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
      target: {
        latitude,
        longitude
      },
      shapeType: resolvedShapeType,
      name: detail.name || "",
      locationText: detail.locationText || "",
      detail: detail,
      raw
    };
  },

  buildPinSearchMarker(payload = {}, options = {}) {
    if (!payload) return null;
    const marker = {
      id: payload.id || `pin-${Date.now()}`,
      latitude: payload.latitude,
      longitude: payload.longitude,
      title: payload.name,
      iconPath: "/assets/default.png",
      width: 44,
      height: 44
    };
    const calloutContent = formatNearbyMarkerLabel(payload.name || "");
    if (calloutContent) {
      marker.callout = buildMarkerNameCallout(calloutContent, {
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

  isAreaPinSearchPayload(payload = {}) {
    const shapeType = `${payload?.shapeType || payload?.raw?.shape?.type || ""}`.toUpperCase();
    return !!shapeType && shapeType !== "POINT";
  },

  resolvePinSearchTarget(payload = {}) {
    const target = payload?.target || payload;
    const latitude = Number(target?.latitude);
    const longitude = Number(target?.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
    return null;
  },

  applySearchSelectionFromPinPayload(payload = {}, options = {}) {
    return preflightDashboardUtils.applySearchSelectionFromPinPayload(this, payload, options);
  },

  getAuthToken() {
    const app = getApp ? getApp() : null;
    return (app && app.globalData && app.globalData.token) || "";
  },

  requestProfileSubscriptions() {
    return subscriptionUtils.requestProfileSubscriptions(this);
  },

  onSubscriptionBannerTap() {
    return subscriptionUtils.onSubscriptionBannerTap(this);
  },

  openSubscriptionSettingPicker(options = {}) {
    return subscriptionUtils.openSubscriptionSettingPicker(this, options);
  },

  prefetchSubscriptionLatest() {
    return subscriptionUtils.prefetchSubscriptionLatest(this);
  },

  updateSubscriptionBadge(show) {
    return subscriptionUtils.updateSubscriptionBadge(this, show);
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

  initializeSystemInfo(force = false, inputMetrics = null) {
    if (!force && this._pxPerRpx && this._pxPerRpx > 0) {
      return;
    }
    const metrics =
      inputMetrics && typeof inputMetrics === "object" ? inputMetrics : getWindowMetrics();
    const width = metrics.windowWidth || 375;
    this._pxPerRpx = width / 750;
    const pxPerRpx = this._pxPerRpx || 1;
    this._scaleBarBaseRpx = Math.max(30, Math.round(CSS_PIXELS_PER_CM / pxPerRpx));
    if (metrics.platform) {
      this._isIOS = metrics.platform === "ios";
    }
    const statusBarHeight = Number(metrics.statusBarHeight);
    const centerPinOffsetPx = 0;
    const updates = {};
    if (
      Number.isFinite(statusBarHeight)
      && statusBarHeight > 0
      && this.data.statusBarHeight !== statusBarHeight
    ) {
      updates.statusBarHeight = statusBarHeight;
    }
    if (this.data.centerPinOffsetPx !== centerPinOffsetPx) {
      updates.centerPinOffsetPx = centerPinOffsetPx;
    }
    if (Object.keys(updates).length) {
      this.setData(updates);
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
    const zoomSource = Object.prototype.hasOwnProperty.call(ctx, "rawScale")
      ? ctx.rawScale
      : (Object.prototype.hasOwnProperty.call(ctx, "scale") ? ctx.scale : this.data.scale);
    const zoom = clampMapScaleFloat(zoomSource);
    const metersPerPixel = computeMetersPerPixel(latitude, zoom);
    if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
      return;
    }
    const rawMeters = metersPerPixel * pxWidth;
    const display = resolveScaleBarDisplay({
      rawMeters,
      metersPerPixel,
      pxPerRpx,
      baseRpx
    });
    this._lastScaleBarMeters = display.meters;
    this.setData({
      scaleBarVisible: true,
      scaleBarLabel: display.label,
      scaleBarWidthRpx: display.widthRpx
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
    return resolveScaleBarDisplay({
      rawMeters,
      metersPerPixel,
      pxPerRpx,
      baseRpx
    }).meters;
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
    if (Number.isFinite(skew) || Number.isFinite(rotate)) {
      this.syncCompassState({ rotate, skew });
    }
  },

  syncCompassState(detail = {}) {
    const rotateValue = Object.prototype.hasOwnProperty.call(detail, "rotate")
      ? detail.rotate
      : this._mapRotate;
    const normalized = normalizeMapRotate(rotateValue);
    if (!Number.isFinite(normalized)) return;
    const skewValue = Object.prototype.hasOwnProperty.call(detail, "skew")
      ? detail.skew
      : this._mapSkew;
    const normalizedSkew = Number.isFinite(skewValue) ? Math.max(0, Math.min(60, skewValue)) : 0;
    const distance = normalized > 180 ? 360 - normalized : normalized;
    const shouldShow = distance >= MAP_COMPASS_ROTATE_THRESHOLD;
    const updates = {};
    if (shouldShow) {
      if (
        !Number.isFinite(this.data.mapRotate)
        || Math.abs(this.data.mapRotate - normalized) >= MAP_COMPASS_ROTATE_SYNC_DELTA
      ) {
        updates.mapRotate = normalized;
      }
      if (
        !Number.isFinite(this.data.compassRotate)
        || Math.abs(this.data.compassRotate - normalized) >= MAP_COMPASS_ROTATE_SYNC_DELTA
      ) {
        updates.compassRotate = normalized;
      }
    } else {
      if (this.data.mapRotate !== 0) {
        updates.mapRotate = 0;
      }
      if (this.data.compassRotate !== 0) {
        updates.compassRotate = 0;
      }
    }
    if (
      !Number.isFinite(this.data.compassSkew)
      || Math.abs(this.data.compassSkew - normalizedSkew) >= MAP_COMPASS_SKEW_SYNC_DELTA
    ) {
      updates.compassSkew = normalizedSkew;
    }
    if (shouldShow !== this.data.compassVisible) {
      updates.compassVisible = shouldShow;
    }
    if (Object.keys(updates).length) {
      this.setData(updates);
    }
  },

  resetCompassState() {
    this._mapRotate = 0;
    this._mapSkew = 0;
    const updates = {};
    if (this.data.mapRotate !== 0) {
      updates.mapRotate = 0;
    }
    if (this.data.mapSkew !== 0) {
      updates.mapSkew = 0;
    }
    if (this.data.compassRotate !== 0) {
      updates.compassRotate = 0;
    }
    if (this.data.compassSkew !== 0) {
      updates.compassSkew = 0;
    }
    if (this.data.compassVisible) {
      updates.compassVisible = false;
    }
    if (Object.keys(updates).length) {
      this._skipNextRotateRegion = true;
      this.setData(updates);
    }
  },

  shouldAvoidCenterSync(options = {}) {
    const cause = typeof options?.cause === "string" ? options.cause.toLowerCase() : "";
    if (cause === "skew" || cause === "rotate" || cause === "overlook") {
      return true;
    }
    if (cause === "drag" || cause === "scale" || cause === "gesture") {
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

  centerOnPoint(point, scale = DEFAULT_MAP_SCALE, silent = false, extraUpdates = null) {
    if (!point) return;
    this.queueRegionUpdateSkip(3);
    this._centerOverride = point;
    const targetScale = clampMapScale(scale);
    const updates = {
      center: point,
      mapCenterReady: true,
      scale: targetScale
    };
    if (extraUpdates && typeof extraUpdates === "object") {
      Object.assign(updates, extraUpdates);
    }
    this.setData(updates, () => {
      this.ensureUomPluginReady();
      this.ensureDjiLayerReady();
      this.ensureTemporaryNoFlyLayerReady();
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
      const fetchOptions = {
        center: point,
        region: this._lastRegion,
        scale: targetScale,
        force: true
      };
      this.requestNearbyMarkers(fetchOptions);
      this.syncTemporaryNoFlyLayerViewport(fetchOptions);
      this.syncDjiLayerViewport({
        center: point,
        region: this._lastRegion,
        scale: targetScale,
        force: true
      });
    });
  },

  waitForLocationPermissionGrantedWithoutPrompt(options = {}) {
    return locationUtils.waitForLocationPermissionGrantedWithoutPrompt(this, options);
  },

  pullAndCenterLocationWithRetry(options = {}) {
    return locationUtils.pullAndCenterLocationWithRetry(this, options);
  },

  bootstrapInitialNativeLocationCenter() {
    return locationUtils.bootstrapInitialNativeLocationCenter(this);
  },

  ensureLocationPermission() {
    return locationUtils.ensureLocationPermission(this);
  },

  authorizeLocation() {
    return locationUtils.authorizeLocation(this);
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
    if (!this.isMapCenterReady()) {
      return;
    }
    const cause = e?.causedBy || e?.detail?.cause || e?.detail?.causedBy || "";
    const detail = e?.detail || {};
    if (e.type !== "end") {
      this.updateMapGestureState(detail);
      if (
        !this._centerPinWelcomeBubbleDismissedInGesture &&
        this.shouldDismissCenterPinWelcomeBubbleOnRegionChange(cause)
      ) {
        this._centerPinWelcomeBubbleDismissedInGesture = true;
        this.dismissCenterPinWelcomeBubble();
      }
      if (this._markersFetchTimer) clearTimeout(this._markersFetchTimer);
      if (this._uomPlugin && typeof this._uomPlugin.startFollow === "function") {
        this._uomPlugin.startFollow();
      }
      const cl = detail && (detail.centerLocation || null);
      if (cl && this._uomPlugin && typeof this._uomPlugin.handleRegionChange === "function") {
        const region = detail.region || {
          northeast: detail.northeast,
          southwest: detail.southwest
        };
        const scale = clampMapScale(detail.scale || this.data.scale);
        const newCenter = { latitude: cl.latitude, longitude: cl.longitude };
        this.updateDebugPanel({
          scale: `${scale}`,
          rawScale: `${detail.scale ?? ""}`,
          center: this.formatDebugCoord(newCenter),
          region: this.formatDebugRegion(region),
          regionPhase: "move"
        });
        this._uomPlugin.handleRegionChange({
          center: newCenter,
          centerPin: newCenter,
          scale,
          rawScale: detail.scale,
          region,
          force: true
        });
      }
      return;
    }
    this._centerPinWelcomeBubbleDismissedInGesture = false;
    if (this._uomPlugin && typeof this._uomPlugin.stopFollow === "function") {
      this._uomPlugin.stopFollow();
    }
    this.updateMapGestureState(detail);
    if (this.shouldIgnoreRegionSyncForCenterPinFollow(cause)) {
      return;
    }
    if (this._skipNextRotateRegion) {
      const rotate = Number(detail?.rotate);
      if (Number.isFinite(rotate)) {
        const cl = detail && (detail.centerLocation || null);
        const prevCenter = this.data.center;
        const moveMeters = (cl && prevCenter && hasValidCoordinate(prevCenter.latitude, prevCenter.longitude))
          ? haversineMeters(
            prevCenter.latitude,
            prevCenter.longitude,
            cl.latitude,
            cl.longitude
          )
          : 0;
        if (!Number.isFinite(moveMeters) || moveMeters < MIN_CENTER_SYNC_METERS) {
          this._skipNextRotateRegion = false;
          return;
        }
      }
      this._skipNextRotateRegion = false;
    }
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
    if (region && region.northeast && region.southwest) {
      const newCenter = cl
        ? { latitude: cl.latitude, longitude: cl.longitude }
        : {
          latitude: (region.northeast.latitude + region.southwest.latitude) / 2,
          longitude: (region.northeast.longitude + region.southwest.longitude) / 2
        };
      if (this.shouldIgnoreCenterShareLaunchSync(newCenter, cause)) {
        return;
      }
      this._centerOverride = newCenter;
      const prevScale = this.data.scale;
      const scale = clampMapScale(detail.scale || prevScale);
      this.updateDebugPanel({
        scale: `${scale}`,
        rawScale: `${detail.scale ?? ""}`,
        center: this.formatDebugCoord(newCenter),
        region: this.formatDebugRegion(region),
        regionPhase: "end"
      });
      const scaleChanged = scale !== prevScale;
      // console.log("[map] regionchange scale", scale);
      this._lastRegion = region;
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
          this._uomPlugin.handleRegionChange({
            center: newCenter,
            centerPin: newCenter,
            scale,
            rawScale: detail.scale,
            region
          });
        }
        this.syncDjiLayerViewport({
          center: newCenter,
          region,
          scale,
          force: !!forceRefresh
        });
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
        this.syncTemporaryNoFlyLayerViewport({
          center: newCenter,
          region,
          scale,
          force: !!forceRefresh
        });
      };
      const afterSync = () => {
        this.updateScaleBar({
          scale,
          rawScale: detail.scale,
          latitude: newCenter.latitude
        });
        this.refreshNearbyDisplayModes();
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
        if (this.shouldIgnoreCenterShareLaunchSync(newCenter, cause)) {
          return;
        }
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
          const region = detail?.region || null;
          this.syncDjiLayerViewport({
            center: newCenter,
            region,
            scale,
            force: true
          });
          if (this._uomPlugin && typeof this._uomPlugin.handleRegionChange === "function") {
            this._uomPlugin.handleRegionChange({
              center: newCenter,
              centerPin: newCenter,
              scale,
              region
            });
          }
          this.scheduleFetchMarkers(0, {
            center: newCenter,
            region,
            scale,
            force: true
          });
          this.scheduleFetchPins(0, {
            center: newCenter,
            region,
            scale,
            force: true
          });
          this.syncTemporaryNoFlyLayerViewport({
            center: newCenter,
            region,
            scale,
            force: true
          });
        };
        const afterUpdate = () => {
          this.updateScaleBar({
            scale,
            rawScale: detail?.scale,
            latitude: newCenter.latitude
          });
          this.refreshNearbyDisplayModes();
          run();
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
        radiusInKilometers: radiusKm,
        scaleInMeters: this.getCurrentScaleInMeters(scale, latitude)
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
      this._nearbyMarkersRaw = [];
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
      if (
        (Array.isArray(this._nearbyMarkers) && this._nearbyMarkers.length) ||
        (Array.isArray(this._nearbyMarkersRaw) && this._nearbyMarkersRaw.length)
      ) {
        this._nearbyMarkersRaw = [];
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
        radiusInKilometers: radiusKm,
        scaleInMeters: this.getCurrentScaleInMeters(scale, center.latitude)
      },
      {
        apiBase: this.getApiBase(),
        token: this.getAuthToken()
      }
    )
      .then((items = []) => {
        if (this._activeMarkersRequest !== requestId) return;
        this.applyNearbyMarkers(Array.isArray(items) ? items : []);
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
    if (Array.isArray(this._provinceCityHighlightPolygons)) {
      polygons.push(...this._provinceCityHighlightPolygons);
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
    if (Array.isArray(this._myLocationCircles)) {
      circles.push(...this._myLocationCircles);
    }
    this.setData({ polygons, circles });
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

});


