const { SEARCH_COORDINATE_TIPS_TEXT } = require("../../utils/coordinate-search");
const { composeAvatarLocationIcon } = require("../../utils/avatar-location-icon");
const { buildAvatarDownloadUrl } = require("../../utils/profile");
const { QQMAP_CUSTOM_STYLE_ID, MAP_DEBUG_PANEL_ENABLED } = require("../../utils/config");
const { getMapKeySync } = require("../../utils/map-key");
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
const centerPinUiUtils = require("./utils/center-pin-ui");
const mapGraphicsUtils = require("./utils/map-graphics");
const markerDataUtils = require("./utils/marker-data");
const pageRuntimeUtils = require("./utils/page-runtime");
const mapViewportUtils = require("./utils/map-viewport");
const nearbyFetchUtils = require("./utils/nearby-fetch");
const weatherUtils = require("./utils/weather");
const elevationUtils = require("./utils/elevation");
const mapGeometryUtils = require("./utils/map-geometry");
const nearbyGraphicsUtils = require("./utils/nearby-graphics");
const targetLinkUtils = require("./utils/target-link");
const pinPreviewUtils = require("./utils/pin-preview");
const policyGuideUtils = require("./utils/policy-guide");
const mapPluginsUtils = require("./utils/map-plugins");
const miscActionsUtils = require("./utils/misc-actions");
const {
  DEFAULT_CENTER,
  MAP_MIN_SCALE,
  MAP_MAX_SCALE,
  DEFAULT_MAP_SCALE,
  DEFAULT_SCALE_BAR_BASE_RPX,
  CENTER_PIN_FOLLOW_TIP_TEXT,
  DEFAULT_MAP_CHECKIN_ENTRY_STYLE,
  hasValidCoordinate
} = require("./utils/map-shared");
const {
  COORDINATE_SYSTEM_OPTIONS,
  resolveCoordinateSystemDisplayLabel
} = require("./utils/coordinate-system");

const DEFAULT_LEVELS_PARAM = "2,6,1,4,3,7,8,10";
const MARKER_SVIP_ICON_PATH = "/assets/svip2.png";
const DEFAULT_AVATAR_PATH = "/assets/default-avatar.png";
const DEFAULT_CENTER_PIN_ICON_PATH = "/assets/position.png";
const USER_PROFILE_STORAGE_KEY = "userProfile";
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

function parseMemberExpireTime(value = "") {
  const text = `${value || ""}`.trim();
  if (!text) return 0;
  const timestamp = Date.parse(text.includes("T") ? text : text.replace(/-/g, "/"));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isProfileMemberActive(profile = {}) {
  if (!profile || !profile.vip) return false;
  const expireAt = parseMemberExpireTime(
    profile.memberExpireDate || profile.membershipExpireDate || profile.vipExpireDate || ""
  );
  return !expireAt || expireAt >= Date.now();
}

function normalizeMemberFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["true", "1", "yes", "y", "vip", "svip", "member"].includes(normalized);
  }
  return false;
}

function readRawStoredUserProfile() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return {};
  try {
    const cached = wx.getStorageSync(USER_PROFILE_STORAGE_KEY);
    return cached && typeof cached === "object" ? cached : {};
  } catch (err) {
    return {};
  }
}

function resolveMapAvatarUrl(candidates = []) {
  const app = typeof getApp === "function" ? getApp() : null;
  const apiBase = app && app.globalData ? app.globalData.apiBase || "" : "";
  for (let i = 0; i < candidates.length; i += 1) {
    const text = `${candidates[i] || ""}`.trim();
    if (!text) continue;
    if (/^https?:\/\//.test(text) || text.startsWith("wxfile://") || text.startsWith("/")) {
      return text;
    }
    return buildAvatarDownloadUrl(text, { apiBase });
  }
  return DEFAULT_AVATAR_PATH;
}

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
    subscriptionBannerLeftPx: 8,
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
    centerElevationText: "",
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
    preflightLeftPx: 8,
    scaleControlsLeftPx: 16,
    scaleControlsBottomPx: 160,
    compassBottomPx: 330,
    floatingControlsRightPx: 16,
    floatingControlsBottomPx: 131,
    bottomNavBottomPx: 21,
    weatherFeatureEnabled: weatherUtils.WEATHER_FEATURE_ENABLED === true,
    weatherWidgetLeftPx: 3,
    weatherWidgetWidthPx: 105,
    weatherWidgetBottomPx: 110,
    weatherLoading: false,
    weatherError: "",
    weatherUpdatedAtText: "",
    weatherSummaryItems: [],
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
    userVip: false,
    userAvatarUrl: DEFAULT_AVATAR_PATH,
    myLocationIconType: "default",
    myLocationAvatarIconPath: "",
    centerPinIconType: "default",
    centerPinIconPath: DEFAULT_CENTER_PIN_ICON_PATH,
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
    return pageRuntimeUtils.consumePendingLaunchOptions(options);
  },

  consumeInitialUsePlanetCenterPoint() {
    return pageRuntimeUtils.consumeInitialUsePlanetCenterPoint();
  },

  resolveWindowMetrics(event = {}) {
    return pageRuntimeUtils.resolveWindowMetrics(event);
  },

  refreshResponsiveLayout(options = {}) {
    return pageRuntimeUtils.refreshResponsiveLayout(this, options);
  },

  registerWindowResizeListener() {
    return pageRuntimeUtils.registerWindowResizeListener(this);
  },

  unregisterWindowResizeListener() {
    return pageRuntimeUtils.unregisterWindowResizeListener(this);
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
    return mapPluginsUtils.loadMapSubKey(this);
  },

  ensureUomPluginReady(retry = 0) {
    return mapPluginsUtils.ensureUomPluginReady(this, retry);
  },

  ensureDjiLayerReady(retry = 0) {
    return mapPluginsUtils.ensureDjiLayerReady(this, retry);
  },

  syncDjiLayerViewport(options = {}) {
    return mapPluginsUtils.syncDjiLayerViewport(this, options);
  },

  syncDjiLayerQuery(options = {}) {
    return mapPluginsUtils.syncDjiLayerQuery(this, options);
  },

  setDjiLayerEnabled(enabled, options = {}) {
    return mapPluginsUtils.setDjiLayerEnabled(this, enabled, options);
  },

  onDjiGraphicsChange(event = {}) {
    return mapPluginsUtils.onDjiGraphicsChange(this, event);
  },

  onDjiStatusChange(event = {}) {
    return mapPluginsUtils.onDjiStatusChange(this, event);
  },

  ensureTemporaryNoFlyLayerReady(retry = 0) {
    return mapPluginsUtils.ensureTemporaryNoFlyLayerReady(this, retry);
  },

  syncTemporaryNoFlyLayerViewport(options = {}) {
    return mapPluginsUtils.syncTemporaryNoFlyLayerViewport(this, options);
  },

  setTemporaryNoFlyLayerEnabled(enabled, options = {}) {
    return mapPluginsUtils.setTemporaryNoFlyLayerEnabled(this, enabled, options);
  },

  onTemporaryNoFlyGraphicsChange(event = {}) {
    return mapPluginsUtils.onTemporaryNoFlyGraphicsChange(this, event);
  },

  onTemporaryNoFlyStatusChange(event = {}) {
    return mapPluginsUtils.onTemporaryNoFlyStatusChange(this, event);
  },

  ensureTiandituSatelliteLayerReady(retry = 0) {
    return mapPluginsUtils.ensureTiandituSatelliteLayerReady(this, retry);
  },

  syncTiandituSatelliteLayerViewport(options = {}) {
    return mapPluginsUtils.syncTiandituSatelliteLayerViewport(this, options);
  },

  setTiandituSatelliteLayerEnabled(enabled, options = {}) {
    return mapPluginsUtils.setTiandituSatelliteLayerEnabled(this, enabled, options);
  },

  ensureMapMarkerId(value) {
    return markerDataUtils.ensureMapMarkerId(this, value);
  },

  normalizeMapMarkerId(marker) {
    return markerDataUtils.normalizeMapMarkerId(this, marker);
  },

  normalizeMapMarkerList(list) {
    return markerDataUtils.normalizeMapMarkerList(this, list);
  },

  getCurrentScaleInMeters(scale = this.data.scale, latitude) {
    return markerDataUtils.getCurrentScaleInMeters(this, scale, latitude);
  },

  resolveMarkerDisplayMode(raw = {}, scaleInMeters) {
    return markerDataUtils.resolveMarkerDisplayMode(raw, scaleInMeters);
  },

  applyDisplayModeToMarker(marker = {}, raw = {}, options = {}) {
    return markerDataUtils.applyDisplayModeToMarker(this, marker, raw, options);
  },

  buildCanonicalMarkerKey(marker = {}) {
    return markerDataUtils.buildCanonicalMarkerKey(marker);
  },

  dedupeMapMarkers(list = []) {
    return markerDataUtils.dedupeMapMarkers(list);
  },

  buildMyLocationMarker(point = {}) {
    return pinPreviewUtils.buildMyLocationMarker(this, point);
  },

  buildMyLocationMarkers(point = {}) {
    return pinPreviewUtils.buildMyLocationMarkers(this, point);
  },

  buildMyLocationCircles(point = {}) {
    return pinPreviewUtils.buildMyLocationCircles(this, point);
  },

  refreshMyLocationGraphics(point = null) {
    return pinPreviewUtils.refreshMyLocationGraphics(this, point);
  },

  ensureMyLocationAvatarIcon(options = {}) {
    const avatarUrl = this.data.userAvatarUrl || DEFAULT_AVATAR_PATH;
    if (!avatarUrl) return Promise.resolve("");
    const cacheKey = `${avatarUrl}`;
    if (!options.force && this._myLocationAvatarIconCacheKey === cacheKey && this.data.myLocationAvatarIconPath) {
      return Promise.resolve(this.data.myLocationAvatarIconPath);
    }
    if (!options.force && this._myLocationAvatarIconPromise) return this._myLocationAvatarIconPromise;
    this._myLocationAvatarIconCacheKey = cacheKey;
    this._myLocationAvatarIconPromise = composeAvatarLocationIcon({
      avatarUrl,
      framePath: "/assets/vip/vip-position.png",
      size: 96
    })
      .then((iconPath) => {
        if (this._myLocationAvatarIconCacheKey === cacheKey && iconPath) {
          this.setData({ myLocationAvatarIconPath: iconPath }, () => {
            if (this.data.myLocationIconType === "avatar") {
              this.refreshMyLocationGraphics(this.data.myLocationPoint || this._lastKnownLocation || null);
            }
          });
        }
        return iconPath;
      })
      .catch((err) => {
        console.warn("compose my location avatar icon failed", err);
        return "";
      })
      .finally(() => {
        this._myLocationAvatarIconPromise = null;
      });
    return this._myLocationAvatarIconPromise;
  },

  setMyLocationControlPoint(point = null, options = {}) {
    return pinPreviewUtils.setMyLocationControlPoint(this, point, options);
  },

  findMarkerById(markerId) {
    return markerDataUtils.findMarkerById(this, markerId);
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
    return pinPreviewUtils.applyPinPreview(this, payload);
  },

  buildPinDetailFromPin(pin = {}) {
    return pinPreviewUtils.buildPinDetailFromPin(this, pin);
  },

  prefetchTencentCosConfig() {
    return pinPreviewUtils.prefetchTencentCosConfig(this);
  },

  ensureTencentCosSts(force = false) {
    return pinPreviewUtils.ensureTencentCosSts(this, force);
  },

  ensurePlayablePinDetailMedia(detail, options = {}) {
    return pinPreviewUtils.ensurePlayablePinDetailMedia(this, detail, options);
  },

  ensurePinAddress(detail) {
    return pinPreviewUtils.ensurePinAddress(this, detail);
  },

  clearPinPreview() {
    return pinPreviewUtils.clearPinPreview(this);
  },

  buildPinPreviewZone(shape = {}) {
    return pinPreviewUtils.buildPinPreviewZone(this, shape);
  },

  buildPinPreviewMarker(payload = {}) {
    return pinPreviewUtils.buildPinPreviewMarker(this, payload);
  },

  computePinPreviewCenter(shape = {}, payload = {}) {
    return pinPreviewUtils.computePinPreviewCenter(this, shape, payload);
  },

  normalizePreviewCoordinate(entry) {
    return pinPreviewUtils.normalizePreviewCoordinate(entry);
  },

  normalizePreviewCoordinateList(raw = []) {
    return pinPreviewUtils.normalizePreviewCoordinateList(raw);
  },

  syncPreviewTemporaryNoFlyState(centerOverride) {
    return pinPreviewUtils.syncPreviewTemporaryNoFlyState(this, centerOverride);
  },

  lookupPinAddress(detail) {
    return pinPreviewUtils.lookupPinAddress(this, detail);
  },

  extractAddressFromGeocode(res = {}) {
    return pinPreviewUtils.extractAddressFromGeocode(res);
  },

  requestPinAddress(lat, lng) {
    return pinPreviewUtils.requestPinAddress(this, lat, lng);
  },

  applyPinAddress(markerId, address) {
    return pinPreviewUtils.applyPinAddress(this, markerId, address);
  },

  fillPinSuggestionAddresses(suggestions = [], keywordSnapshot = "") {
    return preflightDashboardUtils.fillPinSuggestionAddresses(this, suggestions, keywordSnapshot);
  },

  autoLoginOnLaunch() {
    return policyGuideUtils.autoLoginOnLaunch(this);
  },

  loadMapGuideConfigs() {
    return policyGuideUtils.loadMapGuideConfigs(this);
  },

  checkPolicyUpdateOnLaunch() {
    return policyGuideUtils.checkPolicyUpdateOnLaunch(this);
  },

  onPolicyUpdateAgree() {
    return policyGuideUtils.onPolicyUpdateAgree(this);
  },

  onPolicyUpdateDisagree() {
    return policyGuideUtils.onPolicyUpdateDisagree(this);
  },

  onPolicyAgreementTap() {
    return policyGuideUtils.onPolicyAgreementTap(this);
  },

  onPolicyPrivacyTap() {
    return policyGuideUtils.onPolicyPrivacyTap(this);
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
    return shareLaunchUtils.applyOfflineSnapshot(detail, snapshot);
  },

  clearManualMarkers() {
    return mapGraphicsUtils.clearManualMarkers(this);
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
    return shareLaunchUtils.getShareInviteCodeValue(this);
  },

  onShareAppMessage(event = {}) {
    return shareLaunchUtils.onShareAppMessage(this, event);
  },

  onShareTimeline() {
    return shareLaunchUtils.onShareTimeline(this);
  },

  applyCustomMapStyle() {
    return miscActionsUtils.applyCustomMapStyle(this);
  },

  onShow() {
    return lifecycleUtils.onShow(this);
  },

  syncUserMembershipState() {
    const stored = this.loadStoredProfile() || {};
    const rawStored = readRawStoredUserProfile();
    const rawProfile = rawStored && typeof rawStored.profile === "object" && rawStored.profile ? rawStored.profile : {};
    let globalVip = false;
    let globalExpireDate = "";
    let globalAvatarUrl = "";
    try {
      const app = typeof getApp === "function" ? getApp() : null;
      const globalData = app && app.globalData ? app.globalData : {};
      globalVip = !!globalData.userVip;
      globalExpireDate = globalData.userMemberExpireDate || "";
      globalAvatarUrl = globalData.userProfile?.avatarUrl || "";
    } catch (err) {
      globalVip = false;
    }
    const profile = Object.assign({}, rawStored, stored, {
      vip:
        normalizeMemberFlag(stored.vip) ||
        normalizeMemberFlag(stored.member) ||
        normalizeMemberFlag(rawStored.vip) ||
        normalizeMemberFlag(rawStored.member) ||
        normalizeMemberFlag(rawStored.membership) ||
        normalizeMemberFlag(rawProfile.vip) ||
        normalizeMemberFlag(rawProfile.member) ||
        normalizeMemberFlag(rawProfile.membership) ||
        normalizeMemberFlag(globalVip),
      memberExpireDate:
        stored.memberExpireDate ||
        stored.membershipExpireDate ||
        stored.vipExpireDate ||
        rawStored.memberExpireDate ||
        rawStored.membershipExpireDate ||
        rawStored.vipExpireDate ||
        rawProfile.memberExpireDate ||
        rawProfile.membershipExpireDate ||
        rawProfile.vipExpireDate ||
        globalExpireDate
    });
    const userVip = isProfileMemberActive(profile);
    const userAvatarUrl = resolveMapAvatarUrl([
      stored.avatarUrl,
      stored.avatarFileName,
      rawStored.avatarFileName,
      rawStored.avatarUrl,
      rawProfile.avatarFileName,
      rawProfile.avatarUrl,
      globalAvatarUrl
    ]);
    const avatarChanged = this.data.userAvatarUrl !== userAvatarUrl;
    if (this.data.userVip !== userVip || avatarChanged) {
      const updates = { userVip, userAvatarUrl };
      if (avatarChanged) {
        this._myLocationAvatarIconCacheKey = "";
        updates.myLocationAvatarIconPath = "";
      }
      this.setData(updates, () => {
        if (this.data.myLocationIconType === "avatar") {
          this.ensureMyLocationAvatarIcon({ force: avatarChanged });
        }
      });
    }
    return userVip;
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
    return miscActionsUtils.onUomStatusChange(this, event);
  },

  onUomTilesChanged(event = {}) {
    return miscActionsUtils.onUomTilesChanged(this, event);
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
    return miscActionsUtils.onMapCheckinEntryTap(this);
  },

  onPreflightEntryTap() {
    return preflightDashboardUtils.onPreflightEntryTap(this);
  },

  onTemporaryNoticeEntryTap() {
    return preflightDashboardUtils.onTemporaryNoticeEntryTap(this);
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
    return miscActionsUtils.onPanoramaDemoTap(this);
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

  onLayerPanelLayoutChange() {
    return layerPanelUtils.scheduleLayerPanelLayoutMeasure(this, 32);
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

  onMyLocationIconSelect(event = {}) {
    return layerPanelUtils.onMyLocationIconSelect(this, event);
  },

  onCenterPinIconSelect(event = {}) {
    return layerPanelUtils.onCenterPinIconSelect(this, event);
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
    return layerPanelUtils.composeMapElementOptions(flags);
  },

  applyAirBoardToggle(enabled) {
    return preflightDashboardUtils.applyAirBoardToggle(this, enabled);
  },

  applyNoFlyOverlayToggle(options = {}) {
    return layerPanelUtils.applyNoFlyOverlayToggle(this, options);
  },

  applyMerchantMarkersToggle(enabled) {
    return layerPanelUtils.applyMerchantMarkersToggle(this, enabled);
  },

  applyPinLayerToggle(forceFetch = false) {
    return layerPanelUtils.applyPinLayerToggle(this, forceFetch);
  },

  parseMapLayerExtraBoolean(value, fallback = false) {
    return layerPanelUtils.parseMapLayerExtraBoolean(value, fallback);
  },

  resolveCenterTargetLinkEnabled(settings = {}) {
    return layerPanelUtils.resolveCenterTargetLinkEnabled(this, settings);
  },

  resolveProvinceCityHighlightEnabled(settings = {}) {
    return layerPanelUtils.resolveProvinceCityHighlightEnabled(this, settings);
  },

  resolveProvinceCityHighlightSelectionId(settings = {}) {
    return layerPanelUtils.resolveProvinceCityHighlightSelectionId(this, settings);
  },

  resolveMapBaseLayerType(settings = {}) {
    return layerPanelUtils.resolveMapBaseLayerType(this, settings);
  },

  resolveMyLocationIconType(settings = {}) {
    return layerPanelUtils.resolveMyLocationIconType(this, settings);
  },

  resolveCenterPinIconType(settings = {}) {
    return layerPanelUtils.resolveCenterPinIconType(this, settings);
  },

  resolveCenterPinIconPath(type = "default") {
    return layerPanelUtils.resolveCenterPinIconPath(type);
  },

  buildMapLayerExtraConfigPayload() {
    return layerPanelUtils.buildMapLayerExtraConfigPayload(this);
  },

  buildMapLayerSettingsPayload() {
    return layerPanelUtils.buildMapLayerSettingsPayload(this);
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
    return nearbyGraphicsUtils.applyNearbyMarkers(this, list);
  },

  buildNearbyMerchantMarker(item = {}, index = 0, scaleInMeters = null) {
    return nearbyGraphicsUtils.buildNearbyMerchantMarker(this, item, index, scaleInMeters);
  },

  rebuildNearbyMarkerGraphics() {
    return nearbyGraphicsUtils.rebuildNearbyMarkerGraphics(this);
  },

  refreshNearbyDisplayModes() {
    return nearbyGraphicsUtils.refreshNearbyDisplayModes(this);
  },

  applyNearbyPins(list) {
    return nearbyGraphicsUtils.applyNearbyPins(this, list);
  },

  rebuildNearbyPinGraphics() {
    return nearbyGraphicsUtils.rebuildNearbyPinGraphics(this);
  },

  applySearchMarkers(markers) {
    return targetLinkUtils.applySearchMarkers(this, markers);
  },

  formatCenterPinLinkDistance(distanceMeters) {
    return targetLinkUtils.formatCenterPinLinkDistance(distanceMeters);
  },

  requestSearchLinkElevationDiff(target, options = {}) {
    return targetLinkUtils.requestSearchLinkElevationDiff(this, target, options);
  },

  buildCenterPinLinkState(center, options = {}) {
    return targetLinkUtils.buildCenterPinLinkState(this, center, options);
  },

  clearCenterPinLinkState() {
    return targetLinkUtils.clearCenterPinLinkState(this);
  },

  clearActiveCenterTargetLink() {
    return targetLinkUtils.clearActiveCenterTargetLink(this);
  },

  applySearchLinkTarget(target, options = {}) {
    return targetLinkUtils.applySearchLinkTarget(this, target, options);
  },

  clearSearchLinkOverlay(options = {}) {
    return targetLinkUtils.clearSearchLinkOverlay(this, options);
  },

  clearSearchSelectionVisuals() {
    return preflightDashboardUtils.clearSearchSelectionVisuals(this);
  },

  rebuildMapTapTargetMarker() {
    return targetLinkUtils.rebuildMapTapTargetMarker(this);
  },

  clearMapTapTargetPoint(options = {}) {
    return targetLinkUtils.clearMapTapTargetPoint(this, options);
  },

  applyMapTapTargetPoint(point, options = {}) {
    return targetLinkUtils.applyMapTapTargetPoint(this, point, options);
  },

  onMapTap(event = {}) {
    return targetLinkUtils.onMapTap(this, event);
  },

  onMapLongPress(event = {}) {
    return targetLinkUtils.onMapLongPress(this, event);
  },

  onSearchLinkGraphicsChange(event = {}) {
    return targetLinkUtils.onSearchLinkGraphicsChange(this, event);
  },

  isMapTapTargetMarker(marker = {}) {
    return targetLinkUtils.isMapTapTargetMarker(marker);
  },

  isMyLocationCirclesChanged(prev = [], next = []) {
    return pinPreviewUtils.isMyLocationCirclesChanged(prev, next);
  },

  isMyLocationMarkersChanged(prev = [], next = []) {
    return pinPreviewUtils.isMyLocationMarkersChanged(prev, next);
  },

  queueMapGraphicsSync(options = {}) {
    return mapGraphicsUtils.queueMapGraphicsSync(this, options);
  },

  syncAllPolylines() {
    return mapGraphicsUtils.syncAllPolylines(this);
  },

  syncAllMarkers() {
    return mapGraphicsUtils.syncAllMarkers(this);
  },

  updateCenterPinIndicator(centerOverride) {
    return centerPinUiUtils.updateCenterPinIndicator(this, centerOverride);
  },

  onCenterCoordinateTap() {
    return centerPinUiUtils.onCenterCoordinateTap(this);
  },

  onCoordinateSystemToggle() {
    return centerPinUiUtils.onCoordinateSystemToggle(this);
  },

  onCoordinateSystemSheetTap() {
    return centerPinUiUtils.onCoordinateSystemSheetTap();
  },

  onCoordinateSystemSheetMaskTap() {
    return centerPinUiUtils.onCoordinateSystemSheetMaskTap(this);
  },

  onCoordinateSystemOptionTap(event) {
    return centerPinUiUtils.onCoordinateSystemOptionTap(this, event);
  },

  findPinContainingPoint(point = {}) {
    return centerHitUtils.findPinContainingPoint(this, point);
  },

  shouldDismissCenterPinWelcomeBubbleOnRegionChange(cause = "") {
    return centerPinUiUtils.shouldDismissCenterPinWelcomeBubbleOnRegionChange(cause);
  },

  dismissCenterPinWelcomeBubble() {
    return centerPinUiUtils.dismissCenterPinWelcomeBubble(this);
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
    return centerPinUiUtils.buildStealthModeSnapshot(this);
  },

  enterStealthMode() {
    return centerPinUiUtils.enterStealthMode(this);
  },

  exitStealthMode() {
    return centerPinUiUtils.exitStealthMode(this);
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
    return markerActionsUtils.resolveDeepRaw(raw);
  },

  resolveMarkerNewId(detail = {}, marker = {}) {
    return markerActionsUtils.resolveMarkerNewId(this, detail, marker);
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
    return pinPreviewUtils.normalizeNearbyPin(this, raw);
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
    return pageRuntimeUtils.getApiBase(this);
  },

  ensureCheckinSubscriptionOnEntry() {
    return subscriptionUtils.ensureCheckinSubscriptionOnEntry(this);
  },

  normalizeMarkerDetail(raw = {}) {
    return markerDataUtils.normalizeMarkerDetail(this, raw);
  },

  composeMarkerDetail(raw = {}, marker = {}, overrides = {}) {
    return markerDataUtils.composeMarkerDetail(this, raw, marker, overrides);
  },

  createMarkerSearchPayload(raw = {}, options = {}) {
    return markerDataUtils.createMarkerSearchPayload(this, raw, options);
  },

  buildMarkerSuggestionFromPayload(payload) {
    return markerDataUtils.buildMarkerSuggestionFromPayload(payload);
  },

  buildPinSuggestionFromPayload(payload) {
    return markerDataUtils.buildPinSuggestionFromPayload(payload);
  },

  buildMarkerFromSearchPayload(payload, options = {}) {
    return markerDataUtils.buildMarkerFromSearchPayload(this, payload, options);
  },

  buildQqSuggestion(poi = {}, index = 0) {
    return markerDataUtils.buildQqSuggestion(poi, index);
  },

  buildQqSearchMarker(poi = {}, index = 0) {
    return markerDataUtils.buildQqSearchMarker(this, poi, index);
  },

  buildCoordinateSearchMarker(payload = {}, options = {}) {
    return markerDataUtils.buildCoordinateSearchMarker(this, payload, options);
  },

  buildSearchSelectionMarker(suggestion = {}, index = 0) {
    return preflightDashboardUtils.buildSearchSelectionMarker(this, suggestion, index);
  },

  isSearchMarkerSource(source = "") {
    return preflightDashboardUtils.isSearchMarkerSource(source);
  },

  isSearchSelectionMarker(marker = {}) {
    return preflightDashboardUtils.isSearchSelectionMarker(marker);
  },

  cloneSearchSelectionMarker(marker = {}) {
    return preflightDashboardUtils.cloneSearchSelectionMarker(marker);
  },

  applySearchSelectionFromMarker(marker, options = {}) {
    return preflightDashboardUtils.applySearchSelectionFromMarker(this, marker, options);
  },

  resolveSearchSelectionAddress(marker = {}) {
    return preflightDashboardUtils.resolveSearchSelectionAddress(this, marker);
  },

  applySearchMarkerAddress(markerId, address) {
    return preflightDashboardUtils.applySearchMarkerAddress(this, markerId, address);
  },

  resolveMarkerDetail(marker) {
    return markerDataUtils.resolveMarkerDetail(this, marker);
  },

  trackPinExposure(markers) {
    return markerActionsUtils.trackPinExposure(this, markers);
  },

  createPinSearchPayload(raw = {}, options = {}) {
    return markerDataUtils.createPinSearchPayload(this, raw, options);
  },

  buildPinSearchMarker(payload = {}, options = {}) {
    return markerDataUtils.buildPinSearchMarker(payload, options);
  },

  isAreaPinSearchPayload(payload = {}) {
    return markerDataUtils.isAreaPinSearchPayload(payload);
  },

  resolvePinSearchTarget(payload = {}) {
    return markerDataUtils.resolvePinSearchTarget(payload);
  },

  applySearchSelectionFromPinPayload(payload = {}, options = {}) {
    return preflightDashboardUtils.applySearchSelectionFromPinPayload(this, payload, options);
  },

  getAuthToken() {
    return pageRuntimeUtils.getAuthToken(this);
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
    return pageRuntimeUtils.ensureProfileAuthenticated(this);
  },

  hasAccessToken() {
    return pageRuntimeUtils.hasAccessToken(this);
  },

  loadStoredProfile() {
    return pageRuntimeUtils.loadStoredProfile(this);
  },

  initializeSystemInfo(force = false, inputMetrics = null) {
    return pageRuntimeUtils.initializeSystemInfo(this, force, inputMetrics);
  },

  updateScaleBar(context = {}) {
    return pageRuntimeUtils.updateScaleBar(this, context);
  },

  estimateScaleBarMeters(scale, latitude) {
    return pageRuntimeUtils.estimateScaleBarMeters(this, scale, latitude);
  },

  shouldFetchNearbyMarkers(scale, latitude) {
    return pageRuntimeUtils.shouldFetchNearbyMarkers(this, scale, latitude);
  },

  queueRegionUpdateSkip(count = 1) {
    return pageRuntimeUtils.queueRegionUpdateSkip(this, count);
  },

  updateMapGestureState(detail = {}) {
    return mapViewportUtils.updateMapGestureState(this, detail);
  },

  syncCompassState(detail = {}) {
    return mapViewportUtils.syncCompassState(this, detail);
  },

  resetCompassState() {
    return mapViewportUtils.resetCompassState(this);
  },

  shouldAvoidCenterSync(options = {}) {
    return mapViewportUtils.shouldAvoidCenterSync(this, options);
  },

  scaleForMeters(targetMeters, latitude) {
    return mapViewportUtils.scaleForMeters(this, targetMeters, latitude);
  },

  centerOnPoint(point, scale = DEFAULT_MAP_SCALE, silent = false, extraUpdates = null) {
    return mapViewportUtils.centerOnPoint(this, point, scale, silent, extraUpdates);
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
    return pageRuntimeUtils.ensureAccessToken(this, options);
  },

  onRegionChange(e) {
    return mapViewportUtils.onRegionChange(this, e);
  },

  onMapUpdated() { },

  updateCenterAndRadius(detail) {
    return mapViewportUtils.updateCenterAndRadius(this, detail);
  },

  computeMarkerRadiusKm(context = {}) {
    return nearbyFetchUtils.computeMarkerRadiusKm(this, context);
  },

  scheduleFetchPins(delay = 0, options = {}) {
    return nearbyFetchUtils.scheduleFetchPins(this, delay, options);
  },

  scheduleFetchMarkers(delay = 0, options = {}) {
    return nearbyFetchUtils.scheduleFetchMarkers(this, delay, options);
  },

  requestNearbyPins(options = {}) {
    return nearbyFetchUtils.requestNearbyPins(this, options);
  },

  requestNearbyMarkers(options = {}) {
    return nearbyFetchUtils.requestNearbyMarkers(this, options);
  },

  applyWeatherSnapshot(snapshot = null, options = {}) {
    return weatherUtils.applyWeatherSnapshot(this, snapshot, options);
  },

  applyElevationSnapshot(snapshot = null) {
    return elevationUtils.applyElevationSnapshot(this, snapshot);
  },

  hydrateWeatherFromCache(options = {}) {
    return weatherUtils.hydrateWeatherFromCache(this, options);
  },

  scheduleFetchWeather(delay = 0, options = {}) {
    return weatherUtils.scheduleFetchWeather(this, delay, options);
  },

  scheduleFetchElevation(delay = 0, options = {}) {
    return elevationUtils.scheduleFetchElevation(this, delay, options);
  },

  requestWeatherSummary(options = {}) {
    return weatherUtils.requestWeatherSummary(this, options);
  },

  requestCenterElevation(options = {}) {
    return elevationUtils.requestCenterElevation(this, options);
  },

  onWeatherWidgetTap() {
    return weatherUtils.onWeatherWidgetTap(this);
  },

  updateOverlayGraphics() {
    return mapGraphicsUtils.updateOverlayGraphics(this);
  },

  ringContains(ring, lng, lat) {
    return mapGeometryUtils.ringContains(ring, lng, lat);
  },

});
