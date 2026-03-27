const { MAP_DEBUG_PANEL_ENABLED } = require("../../../utils/config");
const {
  isWeChatRuntime,
  isDevtoolsRuntime,
  isDesktopRuntime,
  shouldUseWeChatUom
} = require("../../../utils/runtime");

const DEFAULT_CENTER = {
  latitude: 39.908823,
  longitude: 116.39747
};

const MAP_MIN_SCALE = 0;
const MAP_MAX_SCALE = 18;
const DEFAULT_MAP_SCALE = 11;

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

const clampMapScale = (value) => {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : DEFAULT_MAP_SCALE;
  const rounded = Math.round(base);
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, rounded));
};

const hasValidCoordinate = (lat, lng) =>
  Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

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

const normalizeLaunchCenterShareOptions = (options = {}) => {
  const normalized = {
    active: false,
    latitude: null,
    longitude: null,
    scale: 15
  };
  if (!options || typeof options !== "object") {
    return normalized;
  }
  const readFromObject = (source) => {
    if (!source || typeof source !== "object") return null;
    const hasCenterKeys =
      source.clat !== undefined ||
      source.clng !== undefined ||
      source.centerLat !== undefined ||
      source.centerLng !== undefined;
    const explicitFlag = source.cs ?? source.centerShare ?? source.shareCenter ?? source.center;
    if (!hasCenterKeys && !isTruthyFlag(explicitFlag)) {
      return null;
    }
    const lat = Number(source.clat ?? source.centerLat ?? source.lat ?? source.latitude);
    const lng = Number(source.clng ?? source.centerLng ?? source.lng ?? source.longitude);
    if (!hasValidCoordinate(lat, lng)) {
      return null;
    }
    const scaleRaw = Number(source.cscale ?? source.zoom ?? source.scale);
    return {
      latitude: lat,
      longitude: lng,
      scale: Number.isFinite(scaleRaw) ? scaleRaw : normalized.scale
    };
  };
  const applyPayload = (payload) => {
    if (!payload) return false;
    normalized.active = true;
    normalized.latitude = payload.latitude;
    normalized.longitude = payload.longitude;
    normalized.scale = clampMapScale(payload.scale);
    return true;
  };
  if (applyPayload(readFromObject(options))) {
    return normalized;
  }
  if (applyPayload(readFromObject(options.query))) {
    return normalized;
  }
  if (applyPayload(readFromObject(parseSceneParams(options.scene)))) {
    return normalized;
  }
  if (typeof options.q === "string" && options.q.trim()) {
    const decoded = decodeParamValue(options.q);
    const queryIndex = decoded.indexOf("?");
    const queryString = queryIndex >= 0 ? decoded.slice(queryIndex + 1) : decoded;
    const qParams = parseSceneParams(queryString);
    if (applyPayload(readFromObject(qParams))) {
      return normalized;
    }
  }
  return normalized;
};

function onLoad(page, options = {}) {
  const initialUsePlanetCenterPoint = page.consumeInitialUsePlanetCenterPoint();
  if (typeof initialUsePlanetCenterPoint === "boolean") {
    page.data.usePlanetCenterPoint = initialUsePlanetCenterPoint;
    page.data.myLocationModeResolved = true;
  } else {
    const cachedUsePlanetMyLocation = page.loadCachedUsePlanetMyLocationPreference();
    if (typeof cachedUsePlanetMyLocation === "boolean") {
      page.data.usePlanetCenterPoint = cachedUsePlanetMyLocation;
      page.data.myLocationModeResolved = true;
    }
  }
  const launchOptions = page.consumePendingLaunchOptions(options);
  const launchCenterPreset = normalizeLaunchCenterShareOptions(launchOptions);
  const cachedMapLocation = page.loadCachedMapLocation();
  if (launchCenterPreset.active) {
    const presetLat = Number(launchCenterPreset.latitude);
    const presetLng = Number(launchCenterPreset.longitude);
    if (hasValidCoordinate(presetLat, presetLng)) {
      page.data.center = { latitude: presetLat, longitude: presetLng };
      page.data.scale = clampMapScale(launchCenterPreset.scale || 15);
      page.data.mapCenterReady = true;
    }
  } else if (cachedMapLocation) {
    const cachedPoint = {
      latitude: cachedMapLocation.latitude,
      longitude: cachedMapLocation.longitude
    };
    page._lastKnownLocation = cachedPoint;
    page.data.center = cachedPoint;
    page.data.mapCenterReady = true;
    page.data.myLocationPoint = cachedPoint;
    page.data.myLocationVisible = true;
  }
  applyMapStatusBarStyle();
  page.mapCtx = wx.createMapContext("main-map");
  page._isIOS = false;
  page.loadMapSubKey();
  page.prefetchTencentCosConfig();
  page.ensureTencentCosSts();
  page.applyCustomMapStyle();
  page._windowResizeTimer = null;
  page._onWindowResize = null;
  page._lastResizeEvent = null;
  page.refreshResponsiveLayout({ force: true, refreshScaleBar: false });
  page.registerWindowResizeListener();
  let appBase = {};
  try {
    if (typeof wx !== "undefined" && typeof wx.getAppBaseInfo === "function") {
      appBase = wx.getAppBaseInfo() || {};
    }
  } catch (err) {
    appBase = {};
  }
  const appName = `${appBase.appName || appBase.hostName || ""}`.toLowerCase();
  const host = `${appBase.host || appBase.hostName || ""}`.toLowerCase();
  const isDevtools = isDevtoolsRuntime();
  const runtimeIsWeChat = isWeChatRuntime();
  const runtimeIsDesktop = isDesktopRuntime();
  const useWeChatUom = shouldUseWeChatUom();
  console.log("[map] runtime", {
    runtimeIsWeChat,
    runtimeIsDesktop,
    useWeChatUom,
    appName,
    host
  });
  page._runtimeIsWeChat = useWeChatUom;
  page.data.isWeChatRuntime = useWeChatUom;
  const debugEnabled = MAP_DEBUG_PANEL_ENABLED === true;
  if (debugEnabled) {
    page._debugInfoBase = page.collectRuntimeDebugInfo({
      appBase,
      runtimeIsWeChat,
      runtimeIsDesktop,
      useWeChatUom,
      isDevtools
    });
  }
  page.setData({
    isWeChatRuntime: useWeChatUom,
    debugEnabled,
    debugInfo: debugEnabled ? page.buildDebugInfo({}) : {}
  });
  page._mapMarkerIdMap = new Map();
  page._mapMarkerIdSeq = 100000;
  page._mapLayerSettingsLoaded = false;
  page._mapLayerAircraftModelWritten = false;
  page._pendingAircraftModel = "";
  page._markersFetchTimer = null;
  page._pinsFetchTimer = null;
  page._pendingRegionUpdates = 0;
  page._mapSkew = 0;
  page._mapRotate = 0;
  page._myLocationDirection = null;
  page._onMyLocationCompassChange = null;
  page._myLocationDirectionTracking = false;
  page._myLocationDirectionLastSyncAt = 0;
  page._overlookSyncAvoidUntil = 0;
  page._centerOverride = page.data.center;
  page.updateMapCheckinEntryStyle();
  page.updateSubscriptionBannerLayout();
  page._layerPanelCloseTimer = null;
  page._layerPanelMeasureTimer = null;
  page._addMiniAppPopupChecking = false;
  page._addMiniAppPopupVisible = false;
  page._addMiniAppPopupCheckTimer = null;
  page._mapLayerSettings = null;
  page._uomPluginInitTimer = null;
  page._uomPluginInitialized = false;
  page._uomPluginInitLogged = false;
  page._djiLayer = null;
  page._djiLayerInitTimer = null;
  page._djiLayerInitialized = false;
  page._djiLayerInitLogged = false;
  page._temporaryNoFlyLayer = null;
  page._temporaryNoFlyLayerInitTimer = null;
  page._temporaryNoFlyLayerInitialized = false;
  page._temporaryNoFlyLayerInitLogged = false;
  page._djiPolygons = [];
  page._djiCircles = [];
  page._mapLayerSettingsInitPromise = null;
  page._mapGuideConfigLoaded = false;
  page._nfzPolygons = [];
  page._nfzCircles = [];
  page._suggestTimer = null;
  page._uom2Markers = [];
  page.prefetchSubscriptionLatest();
  page.setData({
    mapElementOptions: page.composeMapElementOptions({
      uomDivisionEnabled: page.data.uomDivisionEnabled,
      djiNoFlyZoneEnabled: page.data.djiNoFlyZoneEnabled,
      temporaryNoFlyZoneEnabled: page.data.temporaryNoFlyZoneEnabled,
      merchantMarkersEnabled: page.data.merchantMarkersEnabled,
      privateMarkersEnabled: page.data.privateMarkersEnabled,
      groupSharingEnabled: page.data.groupSharingEnabled,
      platformCoConstructionEnabled: page.data.platformCoConstructionEnabled
    })
  });
  page._droneList = [];
  page.loadDronesFromApi();
  page.bootstrapMapLayerSettings(true);
  page._markerExposureCache = new Map();
  page._pinExposureCache = new Map();
  page._activeMarkersRequest = null;
  page._lastNearbyFetch = null;
  page._activePinsRequest = null;
  page._lastNearbyPinFetch = null;
  page._nearbyMarkersRaw = [];
  page._nearbyMarkers = [];
  page._nearbyPinsRaw = [];
  page._nearbyPinMarkers = [];
  page._nearbyPinPolygons = [];
  page._nearbyPinCircles = [];
  page._searchMarkers = [];
  page._searchLinkMarkers = [];
  page._searchLinkPolylines = [];
  page._searchLinkOwner = "";
  page._lastMarkerDetail = null;
  page._markerDetailCloseTimer = null;
  page._markerPageCloseTimer = null;
  page._markerDetailTouch = null;
  page._markerPageTouch = null;
  page._markerPageScrollTop = 0;
  page._markerDetailExpandTimer = null;
  page._markerDetailExpandLock = false;
  page._restoreMarkerDetailTimer = null;
  page._manualMarkers = [];
  page._mapTapTarget = null;
  page._mapTapTargetMarkers = [];
  page._mapTapTargetTapAt = 0;
  page._mapTapTargetResolveToken = 0;
  page._mapTapSuppressUntil = 0;
  page._previewPolygons = [];
  page._previewCircles = [];
  page._previewMarker = null;
  page._previewPinId = null;
  page._lastKnownLocation = page._lastKnownLocation || null;
  page._myLocationMarkers = [];
  page._myLocationCircles = [];
  page._mapGraphicsSyncTimer = null;
  page._pendingMapGraphicsSync = null;
  page._centerPinFollowActive = false;
  page._centerPinFollowPaused = false;
  page._centerPinFollowTimer = null;
  page._centerPinFollowLocating = false;
  page._centerPinFollowLastErrorAt = 0;
  page._centerPinOpenSuppressUntil = 0;
  page._centerPinWelcomeBubbleDismissedInGesture = false;
  page._shareCenterLaunch = null;
  page._stealthModeSnapshot = null;
  page._centerShareLaunchLock = null;
  page._centerShareLaunchLockTimer = null;
  page._pendingCenterActionShare = null;
  page._pendingCenterActionShareTimer = null;
  page._nativeInitialLocationBootstrapTimer = null;
  page._nativeInitialLocationBootstrapStarted = false;
  page._skipInitialNativeAutoCenter = false;
  page._skipNextApplyLayerInitialSync = false;
  page._provinceCityHighlightPolygons = [];
  page._provinceCityHighlightTree = [];
  page._provinceCityHighlightSelectedId = "";
  page._provinceCityHighlightExpandedMap = Object.create(null);
  page._provinceCityHighlightPolygonCache = new Map();
  page._provinceCityHighlightResource = null;
  page._provinceCityHighlightLoadToken = 0;
  page._likeHoldTimers = { marker: null, markerPage: null };
  page._likeHoldFired = { marker: false, markerPage: false };
  page.captureInviteCode(launchOptions);
  page.handleWorkGroupInviteOptions(launchOptions);
  const app = typeof getApp === "function" ? getApp() : null;
  const hasPendingMarkerFocus = !!app?.globalData?.pendingMarkerFocus;
  const hasPendingPinPreview = !!app?.globalData?.pendingPinPreview;
  page._skipInitialNativeAutoCenter =
    launchCenterPreset.active === true ||
    hasPendingMarkerFocus ||
    hasPendingPinPreview;
  const hasCenterShareLaunch = page.initializeCenterShareLaunch(launchOptions);
  page.initializeShareLaunch(launchOptions);
  page.initializePinShareLaunch(launchOptions);
  if (hasCenterShareLaunch) {
    const nextApp = typeof getApp === "function" ? getApp() : null;
    if (nextApp && nextApp.globalData) {
      nextApp.globalData.pendingMarkerFocus = null;
      nextApp.globalData.pendingPinPreview = null;
    }
    page._skipPendingFocusOnShow = true;
    page.applyCenterShareLaunch();
    page.markSharePermissionAttempted();
  } else {
    page._skipPendingFocusOnShow = false;
    if (page.data.usePlanetCenterPoint) {
      page._skipNextApplyLayerInitialSync = true;
      page.requestInitialLocation();
    } else if (page.data.myLocationModeResolved) {
      page.bootstrapInitialNativeLocationCenter();
    }
    page.consumePendingMarkerFocus({ immediate: true });
  }
  if (page.isMapCenterReady()) {
    page.refreshMyLocationGraphics(page.data.myLocationPoint || page._lastKnownLocation || null);
    const initialViewportCenter = page._centerOverride || page.data.center;
    const initialViewportScale = page.data.scale;
    page.scheduleFetchMarkers(0, {
      center: initialViewportCenter,
      scale: initialViewportScale,
      force: true
    });
    page.scheduleFetchPins(0, {
      center: initialViewportCenter,
      scale: initialViewportScale,
      force: true
    });
    page.syncTemporaryNoFlyLayerViewport({
      center: initialViewportCenter,
      region: page._lastRegion || null,
      scale: initialViewportScale,
      force: true
    });
    page.syncDjiLayerViewport({
      center: initialViewportCenter,
      region: page._lastRegion || null,
      scale: initialViewportScale,
      force: true
    });
    page.updateScaleBar();
    page.updateCenterPinIndicator();
  }
  page.autoLoginOnLaunch();
  page.checkPolicyUpdateOnLaunch();
  page.loadCheckinStatus();
}

module.exports = {
  onLoad
};
