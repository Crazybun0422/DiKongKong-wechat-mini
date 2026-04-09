const { MAP_DEBUG_PANEL_ENABLED } = require("../../../utils/config");
const {
  isWeChatRuntime,
  isDevtoolsRuntime,
  isDesktopRuntime,
  shouldUseWeChatUom
} = require("../../../utils/runtime");
const {
  DEFAULT_CENTER,
  applyMapStatusBarStyle,
  clampMapScale,
  hasValidCoordinate
} = require("./map-shared");
const { normalizeLaunchCenterShareOptions } = require("./launch-shared");

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
  page._weatherFetchTimer = null;
  page._elevationFetchTimer = null;
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
  page._activeWeatherRequest = null;
  page._lastWeatherFetch = null;
  page._weatherSnapshot = null;
  page._activeElevationRequest = null;
  page._lastElevationFetch = null;
  page._elevationSnapshot = null;
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
  page._centerPinLinkElevationState = null;
  page._centerPinLinkElevationRequestKey = "";
  page._pointElevationCache = new Map();
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
  page.hydrateWeatherFromCache({ center: page._centerOverride || page.data.center });
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
    page.scheduleFetchWeather(0, {
      center: initialViewportCenter,
      scale: initialViewportScale,
      force: true
    });
    page.scheduleFetchElevation(2000, {
      center: initialViewportCenter,
      scale: initialViewportScale,
      force: true
    });
  }
  page.autoLoginOnLaunch();
  page.checkPolicyUpdateOnLaunch();
  page.loadCheckinStatus();
}

module.exports = {
  onLoad
};
