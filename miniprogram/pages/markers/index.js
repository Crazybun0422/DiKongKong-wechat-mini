const {
  listMarkers,
  createMarker,
  updateMarker,
  deleteMarker,
  uploadMarkerFile,
  buildFileDownloadUrl,
  fetchMapSettlementConfig
} = require("../../utils/markers");
const {
  resolveApiBase,
  ensureFeatureCode,
  loadStoredProfile,
  normalizeProfileData,
  fetchUserProfile,
  persistProfileLocally
} = require("../../utils/profile");
const {
  createWechatPrepayOrder,
  fetchWechatPaymentStatus
} = require("../../utils/payments");
const { getShareInviteCode } = require("../../utils/share");
const { payWithFlp } = require("../../utils/flp");
const { reverseGeocode } = require("../../utils/geocoder");
const {
  listMyPins,
  createPin: createPinApi,
  updatePin: updatePinApi,
  deletePin: deletePinApi,
  updatePinGroups,
  publishPin,
  revokePin
} = require("../../utils/pins");
const {
  listMyWorkGroups,
  fetchFeatureCodeProfiles,
  createWorkGroup,
  updateWorkGroup,
  dissolveWorkGroup,
  exitWorkGroup,
  addWorkGroupMembers,
  uploadWorkGroupImage,
  fetchWorkGroupById,
  joinWorkGroup
} = require("../../utils/workGroups");
const { buildImageUrl } = require("../../utils/images");

const STATIC_ASSETS = {
  add: "/assets/add.png",
  exposure: "/assets/exposure.png",
  telephone: "/assets/telephone.png",
  defaultCover: "/assets/no-image.png",
  emptyPin: "/assets/empty-pin.png",
  workGroup: "/assets/work-group.png",
  arrowRight: "/assets/arrow-right.png",
  plus: "/assets/plus-circle-fill.png",
  defaultAvatar: "/assets/default-avatar.png",
  publish: "/assets/publish.png",
  revoke: "/assets/revoke.png",
  home: "/assets/home.png",
  modify: "/assets/modify.png",
  delete: "/assets/delete.png"
};

const CENTER_TABS = [
  { id: "MERCHANT", label: "商户入驻" },
  { id: "MY_MARKERS", label: "我的标记" },
  { id: "WORKGROUP", label: "工作组" }
];

const MY_MARKER_FILTERS = [
  { id: "ALL", label: "全部" },
  { id: "PRIVATE", label: "私有" },
  { id: "WORKGROUP", label: "工作组" },
  { id: "PUBLISHED", label: "发布" }
];

const STATUS_TABS = [
  { id: "ALL", label: "全部" },
  { id: "DRAFT", label: "草稿" },
  { id: "PENDING", label: "审核中" },
  { id: "APPROVED", label: "在线" },
  { id: "REJECTED", label: "被驳回" }
];

const REVIEW_STATUS_META = {
  PENDING: { label: "审核中", tone: "pending" },
  APPROVED: { label: "在线", tone: "online" },
  REJECTED: { label: "被驳回", tone: "danger" }
};

const CREATE_STEPS = [
  { label: "基础信息" },
  { label: "资质资料" },
  { label: "管理员" },
  { label: "提交审核" }
];

const DRAFT_PAYMENT_METHOD = "NONE";
const PAYMENT_METHODS = [
  { id: "WECHAT", label: "微信支付" },
  { id: "FLP", label: "FLP 余额抵扣" }
];

const WECHAT_PAYMENT_METHOD = "WECHAT";
const INDUSTRY_HONOR_TAG_LIMIT = 5;
const ATTACHMENT_MAX_COUNT = 1;
const QR_CODE_MAX_COUNT = 2;
const ATTACHMENT_FIXED_LABEL = "企业产品和业务介绍";
const PIN_MEDIA_MAX_COUNT = 3;
const PIN_CATEGORY_LABELS = {
  POINT: "点",
  LINE: "线",
  AREA: "面"
};
const PIN_TYPE_ICONS = {
  POINT_DEFAULT: "/assets/default.png",
  POINT_WARNING: "/assets/drone-warning.png",
  POINT_AERIAL: "/assets/aerial.png",
  POINT_DOCK: "/assets/dock.png",
  POINT_ELEVATION: "/assets/elevation.png",
  LINE_PATH_BUFFER: "/assets/path.png",
  AREA_CIRCLE: "/assets/circle.png",
  AREA_RECTANGLE: "/assets/rectangle.png",
  AREA_POLYGON: "/assets/polygon.png"
};
const PIN_REVIEW_STATUS_META = {
  PENDING: { label: "审核中", tone: "pending" },
  APPROVED_A: { label: "通过", tone: "online" },
  APPROVED_B: { label: "通过", tone: "online" },
  REJECTED: { label: "被驳回", tone: "danger" }
};

const decodeMaybeURI = (text = "") => {
  const raw = `${text || ""}`;
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch (err) {
    return raw;
  }
};

const normalizeInviteCode = (value) => {
  if (value === undefined || value === null) return "";
  return `${value}`.trim();
};

function createEmptyForm() {
  return {
    name: "",
    locationText: "",
    locationLatitude: null,
    locationLongitude: null,
    phone: "",
    description: "",
    images: [],
    businessLicense: null,
    industryHonorTags: [],
    attachmentFiles: [],
    qrCodeImages: [],
    videoChannelId: "",
    videoId: "",
    adminInfo: { name: "", title: "", phone: "" }
  };
}

function createEmptyPinForm() {
  return {
    geometryType: "POINT_DEFAULT",
    geometryLabel: "点-通用",
    geometryName: "通用",
    geometryIcon: PIN_TYPE_ICONS.POINT_DEFAULT,
    geometryCategory: "POINT",
    latitude: null,
    longitude: null,
    coordinateText: "",
    addressMain: "",
    addressDetail: "",
    coordinateList: [],
    activeCoordIndex: 0,
    bufferWidth: null,
    radius: null,
    images: [],
    name: "",
    description: "",
    workspace: "",
    publishToPlatform: false,
    groupIds: []
  };
}

function hasValidCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function normalizePinCoordValue(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Number(num.toFixed(6));
}

function normalizePinAltitude(value) {
  if (value === undefined || value === null || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return Number(num.toFixed(2));
}

function normalizePinCoordinateList(list) {
  if (!Array.isArray(list) || !list.length) return [];
  return list.map((item = {}) => ({
    latitude: normalizePinCoordValue(item.latitude),
    longitude: normalizePinCoordValue(item.longitude),
    altitude: normalizePinAltitude(item.altitude)
  }));
}

function isPinLocationConfigured(form = {}) {
  if (hasValidCoordinate(form.latitude, form.longitude)) return true;
  if (Array.isArray(form.coordinateList)) {
    return form.coordinateList.some((item = {}) => hasValidCoordinate(item.latitude, item.longitude));
  }
  return false;
}

Page({
  data: {
    loading: false,
    listRefreshing: false,
    centerTabs: CENTER_TABS,
    activeCenterTab: CENTER_TABS[0].id,
    pinFilters: MY_MARKER_FILTERS,
    activePinFilter: MY_MARKER_FILTERS[0].id,
    pins: [],
    visiblePins: [],
    pinsLoading: false,
    pinsLoaded: false,
    pinsError: "",
    pinsRefreshing: false,
    showMyPinCreate: false,
    myPinForm: createEmptyPinForm(),
    myPinFormConfigured: false,
    pinSubmitting: false,
    pinError: "",
    editingPinId: "",
    pinLocationDisplay: "",
    myPinSelectedGroups: [],
    markers: [],
    visibleMarkers: [],
    error: "",
    statusTabs: STATUS_TABS,
    filterStatus: "ALL",
    showCreate: false,
    createStep: 0,
    maxStepReached: 0,
    createSteps: CREATE_STEPS,
    form: createEmptyForm(),
    tagInput: "",
    paymentMethods: PAYMENT_METHODS.map((item) => Object.assign({}, item)),
    selectedPaymentMethod: PAYMENT_METHODS[0].id,
    settlementConfig: null,
    wechatPriceDisplay: "",
    wechatListPriceDisplay: "",
    flpPriceDisplay: "",
    flpListPriceDisplay: "",
    flpBalance: null,
    flpBalanceDisplay: "--",
    flpPaymentNote: "我的FLP余额:--",
    flpPaymentDisabled: true,
    creationSubmitting: false,
    creationError: "",
    creationResult: null,
    showDetail: false,
    activeMarker: null,
    actionSheetVisible: false,
    actionSheetMarker: null,
    actionSheetDisableModify: false,
    actionSheetOptions: [],
    actionSheetPrimaryOption: null,
    actionSheetSecondaryOptions: [],
    actionProcessingId: "",
    // pin confirm dialog
    pinConfirmVisible: false,
    pinConfirmAction: "",
    pinConfirmTargetId: "",
    pinConfirmMessage: "",
    pinConfirmBusy: false,
    publishPlatformDialogVisible: false,
    publishPlatformDialogSource: "",
    publishPlatformPendingMarker: null,
    deletingId: "",
    hasLoaded: false,
    editingMarkerId: "",
    assetPaths: STATIC_ASSETS,
    defaultCoverImage: STATIC_ASSETS.defaultCover,
    submitButtonText: "提交审核",
    showPaymentSection: true,
    resultStepsLocked: false,
    qrCodeMaxCount: QR_CODE_MAX_COUNT,
    // 工作组
    workGroups: [],
    workGroupsLoaded: false,
    workGroupsLoading: false,
    workGroupsRefreshing: false,
    workGroupsError: "",
    showWorkGroupCreate: false,
    workGroupForm: { name: "", description: "", images: [] },
    workGroupSubmitting: false,
    showWorkGroupDetail: false,
    activeWorkGroup: null,
    workGroupDetailForm: { name: "", description: "", images: [] },
    workGroupDetailSaving: false,
    workGroupInviteSubmitting: false,
    showWorkGroupInviteDialog: false,
    workGroupInviteInput: "",
    showDissolveDialog: false,
    workGroupDissolveInput: "",
    workGroupDissolving: false,
    currentFeatureCode: "",
    shareWorkGroup: null,
    // work group picker for pin stats
    showWorkGroupPicker: false,
    workGroupPickerLoading: false,
    workGroupPickerPage: 0,
    workGroupPickerHasMore: true,
    workGroupPickerList: [],
    workGroupPickerSelected: [],
    workGroupPickerSelectedMap: {},
    workGroupPickerTarget: "",
    workGroupPickerSaving: false,
    deleteDialogVisible: false,
    deleteDialogInput: "",
    deleteDialogMarkerId: "",
    deleteDialogMarkerName: "",
    deleteDialogError: "",
    joinInvitePrompt: null,
    joinInviting: false
  },

  onLoad(options = {}) {
    this.apiBase = resolveApiBase();
    this._pinActionPending = false;
    this.initializeProfileInfo();
    this.ensureAccessToken().catch((err) => {
      console.warn("ensureAccessToken failed before loading markers", err);
    });
    this.refreshMarkers({ initial: true });
    this.fetchSettlementConfig();
    this.refreshWorkGroups({ initial: true });
    // this.handleWorkGroupInviteOptions(options);
    if (options.create === "1") {
      this.onCreateTap();
    }
  },

  onShow() {
    this.consumePendingCenterTab();
    const pendingInvite = this.consumePendingWorkGroupInvite();
    if (pendingInvite) {
      this.promptJoinWorkGroup(pendingInvite);
    }
    const needMarkers = !this.data.hasLoaded && !this.data.loading;
    const needPins = this.data.activeCenterTab === "MY_MARKERS" && !this.data.pinsLoaded && !this.data.pinsLoading;
    const needWorkGroups =
      this.data.activeCenterTab === "WORKGROUP" &&
      !this.data.workGroupsLoaded &&
      !this.data.workGroupsLoading;
    if (!needMarkers && !needPins && !needWorkGroups) return;
    if (needMarkers) {
      this.refreshMarkers({ initial: true });
    }
    if (needPins) {
      this.refreshPins({ silent: false });
    }
    if (needWorkGroups) {
      this.refreshWorkGroups({ silent: false });
    }
    this.ensureAccessToken().catch((err) => {
      console.warn("ensureAccessToken failed on show", err);
    });
  },

  consumePendingCenterTab() {
    try {
      const app = typeof getApp === "function" ? getApp() : null;
      const targetTab = app?.globalData?.targetMarkersCenterTab;
      if (targetTab === "WORKGROUP") {
        console.log("consumePendingCenterTab -> WORKGROUP");
        this.setData({ activeCenterTab: "WORKGROUP" });
      }
      if (app && app.globalData && app.globalData.targetMarkersCenterTab) {
        delete app.globalData.targetMarkersCenterTab;
      }
    } catch (err) {
      console.warn("consumePendingCenterTab failed", err);
    }
  },

  consumePendingWorkGroupInvite() {
    try {
      const app = typeof getApp === "function" ? getApp() : null;
      const invite = app?.globalData?.pendingWorkGroupInvite;
      if (invite && invite.invitationCode && invite.groupId) {
        app.globalData.pendingWorkGroupInvite = null;
        const normalized = {
          invitationCode: normalizeInviteCode(invite.invitationCode),
          groupId: invite.groupId,
          groupName: decodeMaybeURI(invite.groupName || invite.groupId || "")
        };
        if (this.isSelfWorkGroupInvite(normalized.invitationCode)) {
          return null;
        }
        return normalized;
      }
    } catch (err) {
      console.warn("consumePendingWorkGroupInvite failed", err);
    }
    return null;
  },

  isSelfWorkGroupInvite(invitationCode = "") {
    const code = normalizeInviteCode(invitationCode);
    if (!code) return false;
    try {
      const fromShare = normalizeInviteCode(getShareInviteCode());
      if (fromShare && fromShare === code) return true;
    } catch (err) {
      console.warn("compare invite code with share invite failed", err);
    }
    try {
      const app = typeof getApp === "function" ? getApp() : null;
      const fromGlobal = normalizeInviteCode(app?.globalData?.userInviteCode);
      if (fromGlobal && fromGlobal === code) return true;
    } catch (err) {
      console.warn("compare invite code with global profile failed", err);
    }
    try {
      const stored = loadStoredProfile();
      const storedCode = normalizeInviteCode(stored?.inviteCode);
      if (storedCode && storedCode === code) return true;
    } catch (err) {
      console.warn("compare invite code with stored profile failed", err);
    }
    return false;
  },

  fetchSettlementConfig() {
    fetchMapSettlementConfig({ apiBase: this.apiBase })
      .then((config) => {
        this.applySettlementConfig(config || {});
      })
      .catch((err) => {
        console.warn("获取入驻配置失败", err);
      });
  },

  applySettlementConfig(config = {}) {
    const wechatNet = this.formatPriceValue(config.wechatNetPrice, "¥");
    const wechatList = this.formatPriceValue(config.wechatListPrice, "¥");
    const flpNet = this.formatPriceValue(config.flpNetPrice, "FLP");
    const flpList = this.formatPriceValue(config.flpListPrice, "FLP");
    this.setData(
      {
        settlementConfig: config,
        wechatPriceDisplay: wechatNet,
        wechatListPriceDisplay: wechatList,
        flpPriceDisplay: flpNet,
        flpListPriceDisplay: flpList
      },
      () => {
        this.updateFlpPaymentState(this.data.flpBalance);
      }
    );
  },

  formatPriceValue(value, prefix = "") {
    if (value === undefined || value === null || value === "") return "";
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const formatted = number.toFixed(2).replace(/\.00$/, "");
    return `${prefix}${formatted}`;
  },

  initializeProfileInfo() {
    this._storedProfileCache = {};
    try {
      this._storedProfileCache = loadStoredProfile() || {};
      const normalized = normalizeProfileData(this._storedProfileCache, {
        storedProfile: this._storedProfileCache,
        apiBase: this.apiBase
      });
      this.applyProfileSnapshot(normalized);
    } catch (err) {
      console.warn("初始化用户资料失败", err);
      this._storedProfileCache = this._storedProfileCache || {};
    }
    this.refreshProfileFromRemote();
  },

  refreshProfileFromRemote() {
    fetchUserProfile({ apiBase: this.apiBase })
      .then((remoteProfile) => {
        const normalized = normalizeProfileData(remoteProfile, {
          storedProfile: this._storedProfileCache,
          apiBase: this.apiBase
        });
        this._storedProfileCache = persistProfileLocally({
          nickname: normalized.nickname,
          avatarUrl: normalized.avatarFileName || normalized.avatarUrl,
          featureCode: normalized.featureCode,
          flpValue: normalized.flpValue,
          inviteCode: normalized.inviteCode
        });
        this.applyProfileSnapshot(normalized);
      })
      .catch((err) => {
        if (err && err.message === "missing-token") {
          this.updateFlpPaymentState(this.data.flpBalance);
          return;
        }
        console.warn("刷新用户资料失败", err);
      });
  },

  applyProfileSnapshot(profile = {}) {
    this._normalizedProfile = profile || {};
    const balance =
      typeof profile.flpValue === "number" && Number.isFinite(profile.flpValue)
        ? profile.flpValue
        : null;
    const featureCode = ensureFeatureCode(profile.featureCode || this.data.currentFeatureCode || "");
    this.setData({
      currentFeatureCode: featureCode
    });
    this.refreshWorkGroupOwnerFlags(featureCode);
    this.updateFlpPaymentState(balance);
  },

  refreshWorkGroupOwnerFlags(featureCode) {
    const code = ensureFeatureCode(featureCode || this.data.currentFeatureCode || "");
    if (!code) return;
    const updated = (this.data.workGroups || []).map((g = {}) => {
      const owner = ensureFeatureCode(g.ownerFeatureCode || g.ownerCode || "");
      return Object.assign({}, g, {
        isOwner: !!owner && owner === code
      });
    });
    this.setData({ workGroups: updated });
  },

  updateFlpPaymentState(balanceValue) {
    let balance = null;
    if (typeof balanceValue === "number" && Number.isFinite(balanceValue)) {
      balance = balanceValue;
    }
    const display = balance === null ? "--" : balance.toFixed(2);
    const priceRaw = this.data.settlementConfig?.flpNetPrice;
    const price = Number(priceRaw);
    let disabled = false;
    if (Number.isFinite(price) && price > 0) {
      disabled = balance === null || balance < price;
    } else {
      disabled = balance === null;
    }
    this.setData(
      {
        flpBalance: balance,
        flpBalanceDisplay: display,
        flpPaymentNote: `我的FLP余额:${display}`,
        flpPaymentDisabled: disabled
      },
      () => {
        this.ensureValidPaymentSelection();
      }
    );
  },

  getAuthToken() {
    if (typeof getApp !== "function") {
      return "";
    }
    try {
      const app = getApp();
      return (app && app.globalData && app.globalData.token) || "";
    } catch (err) {
      console.warn("Failed to read global token", err);
      return "";
    }
  },

  ensureAccessToken(options = {}) {
    if (this.getAuthToken()) {
      return Promise.resolve();
    }
    if (this._ensureLoginPromise) {
      return this._ensureLoginPromise;
    }
    if (typeof getApp !== "function") {
      return Promise.reject(new Error("login-unavailable"));
    }
    const app = getApp();
    if (!app || typeof app.loginWithProfile !== "function") {
      return Promise.reject(new Error("login-unavailable"));
    }
    const profile =
      options.profileOverride ||
      this._normalizedProfile ||
      this._storedProfileCache ||
      loadStoredProfile() ||
      {};
    this._ensureLoginPromise = app
      .loginWithProfile(profile)
      .catch((err) => {
        throw err || new Error("login-failed");
      })
      .finally(() => {
        this._ensureLoginPromise = null;
      });
    return this._ensureLoginPromise;
  },

  ensureValidPaymentSelection() {
    if (this.data.selectedPaymentMethod === "FLP" && this.data.flpPaymentDisabled) {
      this.setData({ selectedPaymentMethod: WECHAT_PAYMENT_METHOD });
    }
  },

  applyFlpBalanceChange(balance) {
    if (typeof balance !== "number" || !Number.isFinite(balance)) {
      this.refreshProfileFromRemote();
      return;
    }
    const baseProfile = this._normalizedProfile || {};
    const updatedProfile = Object.assign({}, baseProfile, {
      flpValue: balance,
      flpDisplay: balance.toFixed(2)
    });
    this._storedProfileCache = persistProfileLocally({
      nickname: updatedProfile.nickname || this._storedProfileCache?.nickname,
      avatarUrl:
        updatedProfile.avatarFileName ||
        updatedProfile.avatarUrl ||
        this._storedProfileCache?.avatarUrl,
      featureCode: updatedProfile.featureCode || this._storedProfileCache?.featureCode,
      flpValue: balance
    });
    this.applyProfileSnapshot(updatedProfile);
  },

  onCenterTabTap(e) {
    const nextTab = e?.currentTarget?.dataset?.tab;
    if (!nextTab || nextTab === this.data.activeCenterTab) return;
    const updates = {
      activeCenterTab: nextTab
    };
    if (nextTab !== "MERCHANT" && (this.data.showCreate || this.data.showDetail)) {
      updates.showCreate = false;
      updates.showDetail = false;
    }
    if (nextTab !== "MY_MARKERS" && this.data.showMyPinCreate) {
      updates.showMyPinCreate = false;
    }
    this.setData(updates);
    if (nextTab === "MERCHANT" && !this.data.hasLoaded && !this.data.loading) {
      this.refreshMarkers({ silent: false });
    }
    if (nextTab === "MY_MARKERS") {
      if (!this.data.pinsLoaded && !this.data.pinsLoading) {
        this.refreshPins({ silent: false, filter: this.data.activePinFilter });
      } else {
        this.applyPinFilters();
      }
    }
    if (nextTab === "WORKGROUP") {
      if (!this.data.workGroupsLoaded && !this.data.workGroupsLoading) {
        this.refreshWorkGroups({ silent: false });
      }
    }
  },

  onPinFilterTap(e) {
    const filter = e?.currentTarget?.dataset?.filter;
    if (!filter || filter === this.data.activePinFilter) return;
    if (!this.data.pinsLoaded && !this.data.pinsLoading) {
      this.refreshPins({ silent: false, filter });
      return;
    }
    this.setData({ activePinFilter: filter }, () => this.applyPinFilters());
  },

  onPullDownRefresh() {
    const tab = this.data.activeCenterTab;
    const finalize = () => {
      if (typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
    };
    if (tab === "MY_MARKERS") {
      this.refreshPins({ silent: false, filter: this.data.activePinFilter }).finally(finalize);
      return;
    }
    if (tab === "WORKGROUP") {
      this.refreshWorkGroups({ silent: false }).finally(finalize);
      return;
    }
    this.refreshMarkers({ silent: true }).finally(finalize);
  },

  applyPinFilters(list = this.data.pins, filter = this.data.activePinFilter) {
    let visible = Array.isArray(list) ? list.slice() : [];
    if (filter !== "ALL") {
      visible = visible.filter((item = {}) => {
        const scope = (item.scope || item.permission || "").toUpperCase();
        const hasGroupScope = scope === "WORKGROUP" || scope === "GROUP" || scope === "TEAM";
        const hasGroupId = !!item.workGroupId;
        const hasGroupIds = Array.isArray(item.workGroupIds) && item.workGroupIds.length > 0;
        const rawGroups =
          (item.raw && Array.isArray(item.raw.groups) && item.raw.groups.length > 0) || false;
        const hasGroupFlag = !!item.hasWorkGroup;
        const isWorkGroup = hasGroupScope || hasGroupId || hasGroupIds || rawGroups || hasGroupFlag;
        if (filter === "PRIVATE") return scope === "PRIVATE";
        if (filter === "WORKGROUP") return isWorkGroup;
        if (filter === "PUBLISHED") return scope === "PUBLISHED" || scope === "PUBLIC";
        return true;
      });
    }
    this.setData({ visiblePins: visible });
    return visible;
  },

  extractPinList(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    const direct =
      (Array.isArray(payload.content) && payload.content) ||
      (Array.isArray(payload.records) && payload.records) ||
      (Array.isArray(payload.items) && payload.items) ||
      (Array.isArray(payload.list) && payload.list);
    if (direct) return direct;
    const data = payload.data;
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
      if (Array.isArray(data.content)) return data.content;
      if (Array.isArray(data.records)) return data.records;
      if (Array.isArray(data.items)) return data.items;
      if (Array.isArray(data.list)) return data.list;
    }
    return [];
  },

  refreshWorkGroups(options = {}) {
    const { silent = false } = options;
    if (!silent) {
      this.setData({ workGroupsLoading: true, workGroupsError: "" });
    } else {
      this.setData({ workGroupsRefreshing: true, workGroupsError: "" });
    }
    const ensureProfile = typeof this.ensureProfileReady === "function" ? this.ensureProfileReady() : Promise.resolve();
    const fetchPage = () => listMyWorkGroups({ page: 0, size: 1000 }, { apiBase: this.apiBase });
    let retried = false;
    const load = () =>
      fetchPage().catch((err) => {
        if (!retried && err?.message === "missing-token") {
          retried = true;
          return this.ensureAccessToken().then(() => fetchPage());
        }
        throw err;
      });
    return Promise.resolve(ensureProfile)
      .then(() => load())
      .then((payload) => {
        const list = this.extractWorkGroupList(payload);
        const normalized = list.map((item) => this.normalizeWorkGroup(item));
        this.setData({ workGroups: normalized, workGroupsLoaded: true });
        if (this.data.activeWorkGroup) {
          const updated = normalized.find((g) => g.id === this.data.activeWorkGroup.id);
          if (updated) this.setData({ activeWorkGroup: updated });
        }
        this.prefetchWorkGroupProfiles(normalized);
        this.refreshWorkGroupOwnerFlags();
      })
      .catch((err) => {
        console.error("加载工作组失败", err);
        this.setData({ workGroupsError: err?.message || "加载失败，请稍后重试" });
      })
      .finally(() => {
        this.setData({ workGroupsLoading: false, workGroupsRefreshing: false });
      });
  },

  extractWorkGroupList(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    const data = payload.data || payload;
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
      if (Array.isArray(data.combinedPage?.content)) return data.combinedPage.content;
      if (Array.isArray(data.owned) && data.owned.length) return data.owned;
      if (Array.isArray(data.joined) && data.joined.length) return data.joined;
    }
    if (Array.isArray(payload.content)) return payload.content;
    return [];
  },

  normalizeWorkGroup(raw = {}) {
    const images = Array.isArray(raw.images)
      ? raw.images
        .map((img, index) => ({
          fileName: img,
          url: buildImageUrl(img, { apiBase: this.apiBase }),
          id: `${raw.id || "wg"}-img-${index}`
        }))
        .filter((i) => !!i.url)
      : [];
    const coverImage = images.length ? images[0].url : this.data.assetPaths.workGroup;
    const memberFeatureCodes = Array.isArray(raw.memberFeatureCodes)
      ? raw.memberFeatureCodes.map((c) => ensureFeatureCode(c)).filter(Boolean)
      : [];
    const memberCount = memberFeatureCodes.length;
    const pinCount = Array.isArray(raw.pinIds) ? raw.pinIds.length : 0;
    const cache = this._workGroupProfileCache || {};
    const memberAvatars = memberFeatureCodes.slice(0, 5).map((code, idx) => {
      const prof = cache[code] || {};
      return {
        featureCode: code,
        avatarUrl:
          prof.avatarUrl ||
          buildImageUrl(prof.fileName || prof.avatar || "", {
            apiBase: this.apiBase,
            fallback: this.data.assetPaths.defaultAvatar
          }) ||
          this.data.assetPaths.defaultAvatar,
        nickname: prof.nickname || "",
        id: `${raw.id || "wg"}-member-${idx}`
      };
    });
    return {
      id: raw.id || "",
      name: raw.name || "",
      description: raw.description || "",
      images,
      coverImage,
      updatedAtDisplay: this.formatDateTime(raw.updatedAt),
      memberFeatureCodes,
      memberCount,
      pinCount,
      memberAvatars,
      ownerFeatureCode: raw.ownerFeatureCode || "",
      isOwner:
        !!this.data.currentFeatureCode &&
        !!raw.ownerFeatureCode &&
        ensureFeatureCode(this.data.currentFeatureCode) === ensureFeatureCode(raw.ownerFeatureCode)
    };
  },

  prefetchWorkGroupProfiles(list = []) {
    const codes = [];
    list.forEach((g) => {
      if (Array.isArray(g.memberFeatureCodes)) {
        g.memberFeatureCodes.slice(0, 5).forEach((c) => c && codes.push(c));
      }
    });
    const unique = Array.from(new Set(codes)).filter(Boolean);
    if (!unique.length) return;
    fetchFeatureCodeProfiles(unique, { apiBase: this.apiBase })
      .then((profiles = []) => {
        const cache = this._workGroupProfileCache || {};
        profiles.forEach((p) => {
          if (!p || !p.featureCode) return;
          const code = ensureFeatureCode(p.featureCode);
          cache[code] = {
            avatarUrl: buildImageUrl(p.avatarUrl || p.avatar || p.fileName || "", {
              apiBase: this.apiBase,
              fallback: this.data.assetPaths.defaultAvatar
            }),
            nickname: p.nickname || ""
          };
        });
        this._workGroupProfileCache = cache;
        this.refreshWorkGroupAvatarsFromCache();
      })
      .catch((err) => console.warn("拉取工作组成员头像失败", err));
  },

  refreshWorkGroupAvatarsFromCache() {
    const cache = this._workGroupProfileCache || {};
    const updated = (this.data.workGroups || []).map((g) => {
      const memberAvatars = (g.memberFeatureCodes || []).slice(0, 5).map((code, idx) => {
        const prof = cache[code] || {};
        return {
          featureCode: code,
          avatarUrl:
            prof.avatarUrl ||
            buildImageUrl(prof.fileName || prof.avatar || "", {
              apiBase: this.apiBase,
              fallback: this.data.assetPaths.defaultAvatar
            }) ||
            this.data.assetPaths.defaultAvatar,
          nickname: prof.nickname || "",
          id: `${g.id || "wg"}-member-${idx}`
        };
      });
      return Object.assign({}, g, { memberAvatars });
    });
    this.setData({ workGroups: updated });
    if (this.data.activeWorkGroup) {
      const active = updated.find((g) => g.id === this.data.activeWorkGroup.id);
      if (active) this.setData({ activeWorkGroup: active });
    }
  },

  onWorkGroupCreateTap() {
    this.setData({
      showWorkGroupCreate: true,
      workGroupForm: { name: "", description: "", images: [] }
    });
  },

  onCloseWorkGroupCreate() {
    this.setData({ showWorkGroupCreate: false, workGroupSubmitting: false });
  },

  onWorkGroupNameInput(e) {
    this.setData({ "workGroupForm.name": e?.detail?.value || "" });
  },

  onWorkGroupDescInput(e) {
    this.setData({ "workGroupForm.description": e?.detail?.value || "" });
  },

  onWorkGroupChooseImage() {
    if (typeof wx.chooseImage !== "function") {
      wx.showToast({ title: "当前版本不支持图片选择", icon: "none" });
      return;
    }
    wx.chooseImage({
      count: 1,
      sizeType: ["compressed"],
      success: (res) => {
        const path = res?.tempFilePaths?.[0];
        if (!path) return;
        wx.showLoading({ title: "上传中...", mask: true });
        uploadWorkGroupImage(path, { apiBase: this.apiBase })
          .then((fileName) => {
            const url = buildImageUrl(fileName, { apiBase: this.apiBase });
            this.setData({ "workGroupForm.images": [{ fileName, url }] });
          })
          .catch(() => wx.showToast({ title: "上传失败", icon: "none" }))
          .finally(() => wx.hideLoading());
      }
    });
  },

  onSubmitWorkGroupCreate() {
    if (this.data.workGroupSubmitting) return;
    const name = (this.data.workGroupForm.name || "").trim();
    if (!name) {
      wx.showToast({ title: "请填写名称", icon: "none" });
      return;
    }
    const images = Array.isArray(this.data.workGroupForm.images) ? this.data.workGroupForm.images : [];
    if (!images.length) {
      wx.showToast({ title: "请上传工作组头像", icon: "none" });
      return;
    }
    const selfCode = ensureFeatureCode(this.data.currentFeatureCode || "");
    const payload = {
      name,
      description: (this.data.workGroupForm.description || "").trim(),
      images: images.map((i) => i.fileName),
      memberFeatureCodes: selfCode ? [selfCode] : []
    };
    this.setData({ workGroupSubmitting: true });
    createWorkGroup(payload, { apiBase: this.apiBase })
      .then(() => {
        wx.showToast({ title: "已创建", icon: "success" });
        this.setData({
          showWorkGroupCreate: false,
          workGroupForm: { name: "", description: "", images: [] }
        });
        this.refreshWorkGroups({ silent: true });
      })
      .catch((err) => {
        console.error("创建工作组失败", err);
        wx.showToast({ title: err?.message || "创建失败", icon: "none" });
      })
      .finally(() => this.setData({ workGroupSubmitting: false }));
  },

  onWorkGroupCardTap(e) {
    const id = e?.currentTarget?.dataset?.id;
    if (!id) return;
    const target = (this.data.workGroups || []).find((g) => g.id === id);
    if (!target) return;
    this.setData({
      activeWorkGroup: target,
      workGroupDetailForm: {
        name: target.name || "",
        description: target.description || "",
        images: target.images || []
      },
      showWorkGroupDetail: true
    });
    this.prefetchWorkGroupProfiles([target]);
  },

  onCloseWorkGroupDetail() {
    this.setData({ showWorkGroupDetail: false, activeWorkGroup: null });
  },

  onWorkGroupDetailNameInput(e) {
    this.setData({ "workGroupDetailForm.name": e?.detail?.value || "" });
  },

  onWorkGroupDetailDescInput(e) {
    this.setData({ "workGroupDetailForm.description": e?.detail?.value || "" });
  },

  onWorkGroupDetailChooseImage() {
    const group = this.data.activeWorkGroup;
    if (!group || !group.isOwner) return;
    if (typeof wx.chooseImage !== "function") {
      wx.showToast({ title: "当前版本不支持图片选择", icon: "none" });
      return;
    }
    wx.chooseImage({
      count: 1,
      sizeType: ["compressed"],
      success: (res) => {
        const path = res?.tempFilePaths?.[0];
        if (!path) return;
        wx.showLoading({ title: "上传中...", mask: true });
        uploadWorkGroupImage(path, { apiBase: this.apiBase })
          .then((fileName) => {
            const url = buildImageUrl(fileName, { apiBase: this.apiBase });
            this.setData({ "workGroupDetailForm.images": [{ fileName, url }] });
          })
          .catch(() => wx.showToast({ title: "上传失败", icon: "none" }))
          .finally(() => wx.hideLoading());
      }
    });
  },

  onSaveWorkGroupDetail() {
    const group = this.data.activeWorkGroup;
    if (!group || !group.isOwner) return;
    const name = (this.data.workGroupDetailForm.name || "").trim();
    if (!name) {
      wx.showToast({ title: "请填写名称", icon: "none" });
      return;
    }
    const images = Array.isArray(this.data.workGroupDetailForm.images)
      ? this.data.workGroupDetailForm.images
      : [];
    if (!images.length) {
      wx.showToast({ title: "请先上传封面", icon: "none" });
      return;
    }
    const payload = {
      name,
      description: (this.data.workGroupDetailForm.description || "").trim(),
      images: images.map((i) => i.fileName)
    };
    this.setData({ workGroupDetailSaving: true });
    updateWorkGroup(group.id, payload, { apiBase: this.apiBase })
      .then((res) => {
        wx.showToast({ title: "已保存", icon: "success" });
        const updated = this.normalizeWorkGroup(res || Object.assign({}, group, payload));
        this.setData({ activeWorkGroup: updated });
        this.refreshWorkGroups({ silent: true });
      })
      .catch((err) => {
        console.error("更新工作组失败", err);
        wx.showToast({ title: err?.message || "保存失败", icon: "none" });
      })
      .finally(() => this.setData({ workGroupDetailSaving: false }));
  },

  onWorkGroupInviteTap() {
    if (!this.data.activeWorkGroup?.isOwner) return;
    this.setData({ showWorkGroupInviteDialog: true, workGroupInviteInput: "" });
  },

  onCloseWorkGroupInviteDialog() {
    this.setData({ showWorkGroupInviteDialog: false, workGroupInviteInput: "" });
  },

  onWorkGroupInviteInput(e) {
    this.setData({ workGroupInviteInput: e?.detail?.value || "" });
  },

  onSubmitWorkGroupInvite() {
    const group = this.data.activeWorkGroup;
    if (!group || !group.isOwner || this.data.workGroupInviteSubmitting) return;
    const codes = (this.data.workGroupInviteInput || "")
      .split(/[,，\s]+/)
      .map((c) => ensureFeatureCode(c))
      .filter(Boolean);
    if (!codes.length) {
      wx.showToast({ title: "请输入成员码", icon: "none" });
      return;
    }
    this.setData({ workGroupInviteSubmitting: true });
    addWorkGroupMembers(group.id, codes, { apiBase: this.apiBase })
      .then(() => {
        wx.showToast({ title: "已添加", icon: "success" });
        this.setData({ showWorkGroupInviteDialog: false, workGroupInviteInput: "" });
        this.refreshWorkGroups({ silent: true });
      })
      .catch((err) => {
        console.error("添加成员失败", err);
        wx.showToast({ title: err?.message || "添加失败", icon: "none" });
      })
      .finally(() => this.setData({ workGroupInviteSubmitting: false }));
  },

  onExitWorkGroupTap() {
    const group = this.data.activeWorkGroup;
    if (!group) return;
    wx.showModal({
      title: "退出工作组",
      content: "退出后将无法访问组内标记，确认退出？",
      confirmText: "退出",
      confirmColor: "#ff3b30",
      success: (res) => {
        if (!res.confirm) return;
        exitWorkGroup(group.id, { apiBase: this.apiBase })
          .then(() => {
            wx.showToast({ title: "已退出", icon: "success" });
            this.onCloseWorkGroupDetail();
            this.refreshWorkGroups({ silent: true });
          })
          .catch((err) => {
            console.error("退出工作组失败", err);
            wx.showToast({ title: err?.message || "退出失败", icon: "none" });
          });
      }
    });
  },

  onWorkGroupMemberListTap() {
    const group = this.data.activeWorkGroup;
    if (!group || !Array.isArray(group.memberFeatureCodes)) return;
    try {
      wx.setStorageSync("workGroupMembersTemp", {
        id: group.id,
        name: group.name,
        ownerFeatureCode: group.ownerFeatureCode,
        memberFeatureCodes: group.memberFeatureCodes,
        memberCount: group.memberCount,
        isOwner: !!group.isOwner,
        selfFeatureCode: this.data.currentFeatureCode || ""
      });
    } catch (err) {
      console.warn("缓存工作组成员列表失败", err);
    }
    wx.navigateTo({ url: "/pages/markers/workgroup-members/index" });
  },

  onWorkGroupDissolveInput(e) {
    this.setData({ workGroupDissolveInput: e?.detail?.value || "" });
  },

  onDissolveWorkGroupTap() {
    const group = this.data.activeWorkGroup;
    if (!group) return;
    if (!group.isOwner) {
      wx.showToast({ title: "仅管理员可解散", icon: "none" });
      return;
    }
    this.setData({ showDissolveDialog: true, workGroupDissolveInput: "", workGroupDissolving: false });
  },

  onConfirmDissolveWorkGroup() {
    if (this.data.workGroupDissolving) return;
    const group = this.data.activeWorkGroup;
    if (!group || !group.isOwner) return;
    const name = (group.name || "").trim();
    const input = (this.data.workGroupDissolveInput || "").trim();
    if (name && input !== name) {
      wx.showToast({ title: "请输入正确的工作组名称确认", icon: "none" });
      return;
    }
    this.setData({ workGroupDissolving: true });
    dissolveWorkGroup(group.id, { apiBase: this.apiBase })
      .then(() => {
        wx.showToast({ title: "已解散", icon: "success" });
        this.setData({ showDissolveDialog: false, workGroupDissolveInput: "" });
        this.onCloseWorkGroupDetail();
        this.refreshWorkGroups({ silent: true });
      })
      .catch((err) => {
        console.error("解散工作组失败", err);
        wx.showToast({ title: err?.message || "解散失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ workGroupDissolving: false });
      });
  },

  onCloseDissolveDialog() {
    this.setData({ showDissolveDialog: false, workGroupDissolveInput: "", workGroupDissolving: false });
  },

  promptJoinWorkGroup(promptPayload) {
    const prompt = promptPayload || this.data.joinInvitePrompt;
    if (!prompt?.invitationCode || !prompt?.groupId) return;
    if (this.isSelfWorkGroupInvite(prompt.invitationCode)) {
      this.setData({ joinInvitePrompt: null, joinInviting: false });
      return;
    }
    const name = decodeMaybeURI(prompt.groupName || prompt.groupId || "");
    this.setData({
      activeCenterTab: "WORKGROUP",
      joinInvitePrompt: { invitationCode: prompt.invitationCode, groupId: prompt.groupId, groupName: name },
      joinInviting: false
    });
  },

  confirmJoinWorkGroup(evt) {
    const ds = (evt && evt.currentTarget && evt.currentTarget.dataset) || {};
    const prompt =
      (ds.invitationCode && ds.groupId && {
        invitationCode: ds.invitationCode,
        groupId: ds.groupId,
        groupName: ds.groupName
      }) ||
      this.data.joinInvitePrompt ||
      null;
    if (!prompt?.invitationCode || !prompt?.groupId || this.data.joinInviting) return;
    this.setData({ joinInviting: true, activeCenterTab: "WORKGROUP" });
    joinWorkGroup(prompt.groupId, prompt.invitationCode, { apiBase: this.apiBase })
      .then(() => {
        wx.showToast({ title: "已加入工作组", icon: "success" });
        this.setData({ joinInvitePrompt: null });
        this.refreshWorkGroups({ silent: true });
      })
      .catch((err) => {
        console.error("加入工作组失败", err);
        const message = err?.message || "";
        if (/已加入/.test(message) || /already/i.test(message)) {
          wx.showToast({ title: "已在工作组中", icon: "success" });
          this.setData({ joinInvitePrompt: null });
          this.refreshWorkGroups({ silent: true });
          return;
        }
        wx.showToast({ title: message || "加入失败", icon: "none" });
      })
      .finally(() => this.setData({ joinInviting: false }));
  },

  cancelJoinWorkGroup() {
    this.setData({ joinInvitePrompt: null, joinInviting: false });
  },

  onShareAppMessage() {
    const group = this.data.activeWorkGroup;
    if (!group) return {};
    const invitationCode = getShareInviteCode();
    console.log("onShareAppMessage work group invite", { invitationCode, groupId: group.id });
    const posterUrl = buildFileDownloadUrl("main-page.png", { apiBase: this.apiBase });
    const title = `邀请你加入我的工作组 ${group.name || ""}`.trim() || "邀请你加入我的工作组";
    const path = `/pages/map/map?invitationCode=${encodeURIComponent(invitationCode)}&groupId=${encodeURIComponent(
      group.id || ""
    )}&groupName=${encodeURIComponent(group.name || "")}`;
    return { title, path, imageUrl: posterUrl };
  },

  onCopyWorkGroupCode() {
    const code = this.data.activeWorkGroup?.id || "";
    if (!code) {
      wx.showToast({ title: "暂无工作组码", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: `${code}`,
      success: () => wx.showToast({ title: "已复制", icon: "success" }),
      fail: () => wx.showToast({ title: "复制失败", icon: "none" })
    });
  },

  formatPinCoordinateText(lat, lng) {
    const la = Number(lat);
    const lo = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return "";
    return `${la.toFixed(6)}, ${lo.toFixed(6)}`;
  },

  ensureProfileReady() {
    if (this.data.currentFeatureCode) return Promise.resolve();
    if (this._ensureProfileReadyPromise) return this._ensureProfileReadyPromise;
    const fetchProfile =
      typeof this.refreshProfileFromRemote === "function"
        ? this.refreshProfileFromRemote()
        : Promise.resolve();
    this._ensureProfileReadyPromise = Promise.resolve(fetchProfile)
      .catch((err) => {
        console.warn("ensureProfileReady failed", err);
      })
      .finally(() => {
        this._ensureProfileReadyPromise = null;
      });
    return this._ensureProfileReadyPromise;
  },

  formatExposureDisplay(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return { display: "--", full: "--" };
    const text = `${num}`;
    if (text.length > 5) return { display: `${text.slice(0, 5)}...`, full: text };
    return { display: text, full: text };
  },

  normalizePin(raw = {}) {
    const reviewStatus = raw.reviewStatus || "PENDING";
    const statusMeta = PIN_REVIEW_STATUS_META[reviewStatus] || PIN_REVIEW_STATUS_META.PENDING;
    const visibility = (raw.visibility || "").toUpperCase();
    const scope = visibility || "PRIVATE";
    const groups = Array.isArray(raw.groups) ? raw.groups.filter(Boolean) : [];
    const primaryGroup = groups[0] || {};
    const download = (value) => buildFileDownloadUrl(value, { apiBase: this.apiBase });
    const images = Array.isArray(raw.images)
      ? raw.images
        .map((img, index) => ({
          fileName: img,
          url: download(img),
          id: `${raw.id || "pin"}-image-${index}`
        }))
        .filter((item) => !!item.url)
      : [];
    const coords = Array.isArray(raw.shape?.coordinates) ? raw.shape.coordinates : [];
    const firstCoord = coords[0] || {};
    const locationText =
      raw.location?.text ||
      raw.locationText ||
      "";
    const createdAtDisplay = this.formatDateTime(raw.createdAt);
    const updatedAtDisplay = this.formatDateTime(raw.updatedAt);
    const hasUpdatedAt = !!raw.updatedAt && updatedAtDisplay !== "--";
    const timelineLabel = hasUpdatedAt ? "更新时间" : "创建时间";
    const timelineDisplay = hasUpdatedAt ? updatedAtDisplay : createdAtDisplay;
    const exposureCount = Number(raw.exposureCount);
    const exposureDisplay = this.formatExposureDisplay(exposureCount);
    const phoneCallCount = Number(raw.phoneCallCount);
    const workGroupIdsRaw =
      (groups.length ? groups.map((g) => g && (g.id || g.groupId)).filter(Boolean) : null) ||
      raw.groupIds ||
      raw.workGroupIds ||
      raw.workGroupIdList ||
      raw.workGroupId ||
      raw.groupId ||
      [];
    console.log("normalizePin workGroupIdsRaw", workGroupIdsRaw);
    const workGroupIds = Array.isArray(workGroupIdsRaw)
      ? workGroupIdsRaw.filter(Boolean)
      : [`${workGroupIdsRaw || ""}`.trim()].filter(Boolean);
    const primaryGroupId = workGroupIds[0] || "";
    const hasWorkGroup = workGroupIds.length > 0;
    const workGroupName =
      primaryGroup.name ||
      primaryGroup.groupName ||
      raw.workGroupName ||
      raw.workGroupNickname ||
      primaryGroupId ||
      "";
    const workGroupDisplayName = this.sanitizeWorkGroupName(
      primaryGroup.displayName ||
      primaryGroup.nickname ||
      raw.workGroupDisplayName ||
      raw.workGroupNickname ||
      workGroupName ||
      primaryGroupId
    );
    const rawCoverImage =
      (Array.isArray(primaryGroup.images) && primaryGroup.images.length && primaryGroup.images[0]) ||
      primaryGroup.coverImage ||
      primaryGroup.avatarUrl ||
      raw.workGroupCoverImage ||
      raw.workGroupCover ||
      raw.workGroupAvatar ||
      raw.groupCoverImage ||
      raw.groupCover ||
      "";
    const workGroupCoverImage =
      buildImageUrl(rawCoverImage, {
        apiBase: this.apiBase,
        fallback: this.data.assetPaths.workGroup
      }) || this.data.assetPaths.workGroup;
    const workGroupMemberCount =
      primaryGroup.memberCount ||
      (Array.isArray(primaryGroup.memberFeatureCodes) ? primaryGroup.memberFeatureCodes.length : 0) ||
      raw.workGroupMemberCount ||
      raw.workGroupMembers ||
      raw.memberCount ||
      raw.membersCount ||
      0;
    let statusLabel;
    let statusTone;
    if (scope === "PRIVATE") {
      statusLabel = "私有";
      statusTone = "draft";
    } else if (scope === "GROUP" || scope === "WORKGROUP" || scope === "TEAM") {
      statusLabel = "工作组";
      statusTone = "pending";
    } else {
      statusLabel = statusMeta.label;
      statusTone = statusMeta.tone;
    }
    return {
      id: raw.id || "",
      name: raw.name || "",
      description: raw.description || "",
      images,
      coverImage: images.length ? images[0].url : "",
      reviewStatus,
      reviewStatusLabel: statusLabel,
      reviewTone: statusTone,
      scope,
      permission: scope,
      createdAtDisplay,
      updatedAtDisplay,
      timelineLabel,
      timelineDisplay,
      locationText,
      exposureCount: Number.isFinite(exposureCount) ? exposureCount : 0,
      exposureDisplay: exposureDisplay.display,
      exposureFull: exposureDisplay.full,
      phoneCallCount: Number.isFinite(phoneCallCount) ? phoneCallCount : 0,
      workGroupName,
      workGroupMemberCount: Number.isFinite(Number(workGroupMemberCount))
        ? Number(workGroupMemberCount)
        : 0,
      workGroupCoverImage: workGroupCoverImage,
      workGroupDisplayName,
      workGroupId: primaryGroupId,
      workGroupIds: workGroupIds,
      hasWorkGroup,
      raw
    };
  },

  fetchWorkGroupMeta(id) {
    if (!id) return;
    if (!this._fetchingWorkGroup) this._fetchingWorkGroup = {};
    if (this._fetchingWorkGroup[id]) return;
    this._fetchingWorkGroup[id] = true;
    const apiBase = this.apiBase;
    // fallback: use我的工作组列表获取元数据
    const fetchList = () =>
      listMyWorkGroups({ page: 0, size: 500 }, { apiBase }).then((res) => {
        const list = this.extractWorkGroupList(res) || [];
        const found = list.find((g) => g && (g.id === id || g.groupId === id));
        if (found) {
          const img =
            (Array.isArray(found.images) && found.images.length && found.images[0]) ||
            found.coverImage ||
            found.cover ||
            "";
          const cover = img ? buildImageUrl(img, { apiBase }) : this.data.assetPaths.workGroup;
          const memberCount = Array.isArray(found.memberFeatureCodes)
            ? found.memberFeatureCodes.length
            : found.memberCount || 0;
          console.log("fetchWorkGroupMeta via list found", id, found);
          this.updatePinsByGroupId(id, {
            workGroupName: found.name || found.groupName || id,
            workGroupCoverImage: cover,
            workGroupMemberCount: memberCount
          });
        } else {
          this.updatePinsByGroupId(id, { workGroupName: id });
        }
      });
    fetchList()
      .catch((err) => {
        if (err?.message === "missing-token") {
          return this.ensureAccessToken().then(() => fetchList());
        }
        console.warn("fetchWorkGroupMeta via list failed", err);
      })
      .finally(() => {
        this._fetchingWorkGroup[id] = false;
      });
  },

  updatePinsByGroupId(groupId, patch = {}) {
    console.log("updatePinsByGroupId", groupId, patch);
    const apply = (list = []) =>
      list.map((item = {}) => {
        const candidates = [];
        const pushId = (val) => {
          if (val === undefined || val === null) return;
          const text = `${val}`.trim();
          if (text) candidates.push(text);
        };
        pushId(item.raw?.workGroupId);
        pushId(item.raw?.groupId);
        if (Array.isArray(item.raw?.groupIds)) item.raw.groupIds.forEach(pushId);
        if (Array.isArray(item.raw?.workGroupIds)) item.raw.workGroupIds.forEach(pushId);
        pushId(item.workGroupId);
        pushId(item.groupId);
        if (Array.isArray(item.workGroupIds)) item.workGroupIds.forEach(pushId);
        const target = `${groupId}`.trim();
        if (!target || !candidates.includes(target)) return item;
        const next = Object.assign({}, item);
        if (patch.workGroupName) {
          next.workGroupName = patch.workGroupName;
          next.workGroupDisplayName =
            patch.workGroupName ||
            next.workGroupId ||
            (Array.isArray(next.workGroupIds) ? next.workGroupIds[0] : "") ||
            "工作组";
        }
        if (patch.workGroupCoverImage) {
          next.workGroupCoverImage = patch.workGroupCoverImage;
        }
        if (
          typeof patch.workGroupMemberCount === "number" &&
          !Number.isNaN(patch.workGroupMemberCount) &&
          patch.workGroupMemberCount >= 0
        ) {
          next.workGroupMemberCount = patch.workGroupMemberCount;
        }
        return next;
      });
    this.setData({
      pins: apply(this.data.pins),
      visiblePins: apply(this.data.visiblePins)
    });
  },

  sanitizeWorkGroupName(value) {
    const text = typeof value === "string" ? value.trim() : `${value || ""}`.trim();
    if (!text) return "工作组";
    const lower = text.toLowerCase();
    if (lower === "undefined" || lower === "null") return "工作组";
    return text;
  },

  onOpenWorkGroupPicker(event = {}) {
    const targetId = event?.currentTarget?.dataset?.id || "";
    if (!targetId) return;
    if (this.data.workGroupPickerLoading) return;
    const pin = targetId === "create-pin" ? {} : this.findPinById(targetId) || {};
    const selected = Array.isArray(pin.workGroupIds)
      ? pin.workGroupIds.filter(Boolean)
      : pin.workGroupId
        ? [`${pin.workGroupId}`.trim()].filter(Boolean)
        : (targetId === "create-pin" && Array.isArray(this.data.myPinForm?.groupIds)
          ? this.data.myPinForm.groupIds.filter(Boolean)
          : []);
    const selectedMap = selected.reduce((acc, id) => {
      acc[id] = true;
      return acc;
    }, {});
    this.setData(
      {
        showWorkGroupPicker: true,
        workGroupPickerList: [],
        workGroupPickerPage: 0,
        workGroupPickerHasMore: true,
        workGroupPickerSelected: selected,
        workGroupPickerSelectedMap: selectedMap,
        workGroupPickerTarget: targetId,
        workGroupPickerSaving: false
      },
      () => {
        this.loadWorkGroupPickerPage({ reset: true });
      }
    );
  },

  onOpenWorkGroupPickerForCreate() {
    this.onOpenWorkGroupPicker({ currentTarget: { dataset: { id: "create-pin" } } });
  },

  onCloseWorkGroupPicker() {
    if (this.data.workGroupPickerLoading) return;
    this.setData({ showWorkGroupPicker: false });
  },

  onWorkGroupPickerScrollLower() {
    if (!this.data.workGroupPickerHasMore || this.data.workGroupPickerLoading) return;
    this.loadWorkGroupPickerPage({ reset: false });
  },

  loadWorkGroupPickerPage(options = {}) {
    const { reset = false } = options;
    const page = reset ? 0 : this.data.workGroupPickerPage + 1;
    const size = 10;
    this.setData({ workGroupPickerLoading: true });
    const fetchPage = () => listMyWorkGroups({ page, size }, { apiBase: this.apiBase });
    let retried = false;
    const load = () =>
      fetchPage().catch((err) => {
        if (!retried && err?.message === "missing-token") {
          retried = true;
          return this.ensureAccessToken().then(() => fetchPage());
        }
        throw err;
      });
    load()
      .then((payload) => {
        const list = this.extractWorkGroupList(payload).map((item) => this.normalizeWorkGroup(item));
        const merged = reset ? list : (this.data.workGroupPickerList || []).concat(list);
        const hasMore = Array.isArray(list) && list.length === size;
        console.log("this.data.workGroupPickerList->", this.data.workGroupPickerList);
        this.setData({
          workGroupPickerList: merged,
          workGroupPickerPage: page,
          workGroupPickerHasMore: hasMore
        });
      })
      .catch((err) => {
        console.warn("loadWorkGroupPickerPage failed", err);
        wx.showToast({ title: err?.message || "加载工作组失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ workGroupPickerLoading: false });
      });
  },

  onWorkGroupPickerSelect(event = {}) {
    const id = event?.currentTarget?.dataset?.id || "";
    if (!id) return;
    const current = Array.isArray(this.data.workGroupPickerSelected)
      ? this.data.workGroupPickerSelected.slice()
      : [];
    const idx = current.indexOf(id);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(id);
    }
    const map = {};
    current.forEach((gid) => {
      map[gid] = true;
    });
    this.setData({ workGroupPickerSelected: current, workGroupPickerSelectedMap: map });
  },

  onWorkGroupPickerSave() {
    if (this.data.workGroupPickerSaving) return;
    const pinId = this.data.workGroupPickerTarget;
    const isCreateTarget = pinId === "create-pin";
    if (!pinId) {
      wx.showToast({ title: "未选择标记", icon: "none" });
      return;
    }
    const selectedIds = Array.isArray(this.data.workGroupPickerSelected)
      ? this.data.workGroupPickerSelected.filter(Boolean)
      : [];
    if (isCreateTarget) {
      this.setData({
        "myPinForm.groupIds": selectedIds,
        myPinSelectedGroups: this.data.workGroupPickerList
          .filter((g) => selectedIds.includes(g.id))
          .map((g) => this.buildSelectedGroupDisplay(g)),
        showWorkGroupPicker: false,
        workGroupPickerSaving: false,
        workGroupPickerSelected: [],
        workGroupPickerTarget: ""
      });
      this.updatePinLocationDisplay();
      return;
    }
    const pin = this.findPinById(pinId);
    if (!pin) {
      wx.showToast({ title: "未找到标记", icon: "none" });
      return;
    }
    const scope = (pin.scope || pin.permission || "").toUpperCase();
    const hadGroupScope = scope === "WORKGROUP" || scope === "GROUP" || scope === "TEAM";
    const hadGroupId = !!pin.workGroupId;
    const hadGroupIds = Array.isArray(pin.workGroupIds) && pin.workGroupIds.length > 0;
    const hadRawGroups =
      (pin.raw && Array.isArray(pin.raw.groups) && pin.raw.groups.length > 0) || false;
    const hadGroupFlag = !!pin.hasWorkGroup;
    const hadGroup = hadGroupScope || hadGroupId || hadGroupIds || hadRawGroups || hadGroupFlag;
    const willHaveGroup = selectedIds.length > 0;

    const proceed = () => {
      this.setData({ workGroupPickerSaving: true });
      const payload = selectedIds.length
        ? { groupIds: selectedIds, groups: selectedIds.map((id) => ({ id })) }
        : { groupIds: [], groups: [] };
      const fetch = () =>
        updatePinGroups(pinId, payload, { apiBase: this.apiBase }).catch((err) => {
          if (err?.message === "missing-token") {
            return this.ensureAccessToken().then(() =>
              updatePinGroups(pinId, payload, { apiBase: this.apiBase })
            );
          }
          throw err;
        });
      fetch()
        .then(() => {
          wx.showToast({ title: "已保存", icon: "success" });
          this.setData({
            showWorkGroupPicker: false,
            workGroupPickerSaving: false,
            workGroupPickerSelected: [],
            workGroupPickerTarget: ""
          });
          if (this.data.editingPinId && this.data.editingPinId === pinId) {
            this.setData({ "myPinForm.groupIds": selectedIds });
          }
          this.setData({
            myPinSelectedGroups: this.data.workGroupPickerList
              .filter((g) => selectedIds.includes(g.id))
              .map((g) => this.buildSelectedGroupDisplay(g))
          });
          this.refreshPins({ silent: true, filter: this.data.activePinFilter });
        })
        .catch((err) => {
          console.warn("update pin groups failed", err);
          wx.showToast({ title: err?.message || "保存失败", icon: "none" });
        })
        .finally(() => {
          this.setData({ workGroupPickerSaving: false });
        });
    };

    if (!hadGroup && willHaveGroup) {
      wx.showModal({
        title: "切换到工作组",
        content: "保存后该标记将从私有转为工作组可见，是否继续？",
        cancelText: "取消",
        confirmText: "继续",
        success: (res) => {
          if (res.confirm) proceed();
        }
      });
      return;
    }

    if (hadGroup && !willHaveGroup) {
      wx.showModal({
        title: "切换为私有",
        content: "保存后该标记将从工作组改为私有，仅自己可见，是否继续？",
        cancelText: "取消",
        confirmText: "继续",
        success: (res) => {
          if (res.confirm) proceed();
        }
      });
      return;
    }

    proceed();
  },

  findPinById(id) {
    if (!id) return null;
    const list = Array.isArray(this.data.pins) ? this.data.pins : [];
    const visible = Array.isArray(this.data.visiblePins) ? this.data.visiblePins : [];
    const combined = list.concat(visible);
    return combined.find((p) => p.id === id) || null;
  },

  findAnyMarkerById(id) {
    if (!id) return null;
    const markers = Array.isArray(this.data.markers) ? this.data.markers : [];
    const pins = Array.isArray(this.data.pins) ? this.data.pins : [];
    const visiblePins = Array.isArray(this.data.visiblePins) ? this.data.visiblePins : [];
    return (
      pins.find((p) => p.id === id) ||
      visiblePins.find((p) => p.id === id) ||
      markers.find((m) => m.id === id) ||
      null
    );
  },

  mapPointCategoryToTypeId(category = "") {
    const cat = `${category || ""}`.toUpperCase();
    switch (cat) {
      case "WARNING":
        return "POINT_WARNING";
      case "AERIAL_SHOT":
        return "POINT_AERIAL";
      case "TAKEOFF_LANDING":
        return "POINT_DOCK";
      case "TALL_BUILDING":
        return "POINT_ELEVATION";
      default:
        return "POINT_DEFAULT";
    }
  },

  mapShapeTypeToGeometry(shape = {}) {
    const type = `${shape.type || ""}`.toUpperCase();
    if (type === "LINE" || type === "PATH") {
      return { category: "LINE", typeId: "LINE_PATH_BUFFER" };
    }
    if (type === "CIRCLE") {
      return { category: "AREA", typeId: "AREA_CIRCLE" };
    }
    if (type === "RECTANGLE") {
      return { category: "AREA", typeId: "AREA_RECTANGLE" };
    }
    if (type === "POLYGON" || type === "AREA") {
      return { category: "AREA", typeId: "AREA_POLYGON" };
    }
    return { category: "POINT", typeId: "POINT_DEFAULT" };
  },

  buildPinFormFromPin(pin = {}) {
    const shape = pin?.raw?.shape || {};
    if (!shape || !shape.type || !Array.isArray(shape.coordinates)) return null;
    const geometry = this.mapShapeTypeToGeometry(shape);
    const pointCategory = `${shape.pointCategory || shape.pointcategory || ""}`.toUpperCase();
    const typeId = geometry.category === "POINT"
      ? this.mapPointCategoryToTypeId(pointCategory)
      : geometry.typeId;
    const coords = Array.isArray(shape.coordinates) ? shape.coordinates : [];
    const coordinateList = coords
      .map((item) => ({
        latitude: normalizePinCoordValue(item.latitude ?? item.lat),
        longitude: normalizePinCoordValue(item.longitude ?? item.lng),
        altitude: normalizePinAltitude(item.altitude ?? item.height ?? item.alt)
      }))
      .filter((c) => hasValidCoordinate(c.latitude, c.longitude));
    const first = coordinateList[0] || {};
    const form = createEmptyPinForm();
    form.geometryCategory = geometry.category;
    form.geometryType = typeId;
    form.geometryLabel = pin.geometryLabel || this.computePinGeometryLabel(form.geometryCategory, form.geometryType);
    form.geometryName = this.getPinTypeLabel(form.geometryType) || "通用";
    form.geometryIcon = this.getPinTypeIcon(form.geometryType);
    form.latitude = first.latitude ?? null;
    form.longitude = first.longitude ?? null;
    form.coordinateList = coordinateList;
    form.activeCoordIndex = 0;
    form.addressMain = pin.locationText || "";
    form.bufferWidth = Number.isFinite(shape.width) ? Number(shape.width) : null;
    form.radius = Number.isFinite(shape.radius) ? Math.round(Number(shape.radius) * 1000) : null; // km -> m
    form.name = pin.name || "";
    form.description = pin.description || "";
    form.images = Array.isArray(pin.images) ? pin.images.map((img) => ({
      fileName: img.fileName || "",
      url: img.url || "",
      id: img.id
    })) : [];
    form.publishToPlatform = `${pin.scope || ""}`.toUpperCase() === "PUBLIC";
    form.groupIds = Array.isArray(pin.workGroupIds) ? pin.workGroupIds.filter(Boolean) : [];
    return form;
  },

  buildPinSelectedGroupsFromPin(pin = {}) {
    const groups = Array.isArray(pin.raw?.groups) ? pin.raw.groups : [];
    if (!groups.length) return [];
    return groups
      .map((g) => this.buildSelectedGroupDisplay(g))
      .filter((item) => item.id);
  },

  updatePinLocalState(id, patch = {}) {
    const applyPatch = (list = []) =>
      list.map((item) => {
        if (item.id !== id) return item;
        return Object.assign({}, item, patch);
      });
    this.setData({
      pins: applyPatch(this.data.pins),
      visiblePins: applyPatch(this.data.visiblePins)
    });
  },

  applyCachedPinAddresses(list = []) {
    if (!Array.isArray(list) || !list.length) return [];
    const cache = this._pinAddressCache || {};
    let changed = false;
    const next = list.map((item) => {
      if (item.locationText) return item;
      const coords = Array.isArray(item.raw?.shape?.coordinates) ? item.raw.shape.coordinates : [];
      const first = coords[0] || {};
      const lat = Number(first.latitude);
      const lng = Number(first.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return item;
      const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
      if (cache[key]) {
        changed = true;
        return Object.assign({}, item, { locationText: cache[key] });
      }
      return item;
    });
    return changed ? next : list;
  },

  enrichPinAddresses(list = this.data.pins) {
    if (!Array.isArray(list) || !list.length) return;
    if (!this._pinAddressCache) this._pinAddressCache = {};
    if (!this._pendingPinGeo) this._pendingPinGeo = {};
    list.forEach((item) => {
      if (item.locationText) return;
      const coords = Array.isArray(item.raw?.shape?.coordinates) ? item.raw.shape.coordinates : [];
      const first = coords[0] || {};
      const lat = Number(first.latitude);
      const lng = Number(first.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
      if (this._pinAddressCache[key]) {
        return;
      }
      if (this._pendingPinGeo[key]) {
        return;
      }
      this._pendingPinGeo[key] = true;
      reverseGeocode(lat, lng)
        .then((res = {}) => {
          const addr = this.extractAddressFromReverse(res);
          if (!addr) return;
          this._pinAddressCache[key] = addr;
          const updated = (this.data.pins || []).map((pin) => {
            if (
              !pin.locationText &&
              pin.raw &&
              Array.isArray(pin.raw.shape?.coordinates) &&
              pin.raw.shape.coordinates[0] &&
              Number(pin.raw.shape.coordinates[0].latitude) === lat &&
              Number(pin.raw.shape.coordinates[0].longitude) === lng
            ) {
              return Object.assign({}, pin, { locationText: addr });
            }
            return pin;
          });
          this.setData({ pins: updated }, () => this.applyPinFilters(updated, this.data.activePinFilter));
        })
        .catch((err) => {
          console.warn("reverse geocode pin failed", err);
        })
        .finally(() => {
          delete this._pendingPinGeo[key];
        });
    });
  },

  extractAddressFromReverse(result = {}) {
    const rec = result.result || result;
    const fromRecommend =
      rec?.address ||
      rec?.formatted_addresses?.recommend ||
      rec?.formatted_addresses?.rough_address ||
      rec?.formatted_addresses?.standard_address;
    if (fromRecommend && typeof fromRecommend === "string") {
      const trimmed = fromRecommend.trim();
      if (trimmed) return trimmed;
    }
    if (rec && typeof rec === "object" && rec.address_component) {
      const comp = rec.address_component;
      const parts = [comp.city, comp.district, comp.street, comp.street_number]
        .map((p) => (p || "").trim())
        .filter(Boolean);
      const joined = parts.join("");
      if (joined) return joined;
    }
    return "";
  },

  refreshPins(options = {}) {
    const { silent = false, filter = this.data.activePinFilter } = options;
    if (!silent) {
      this.setData({ pinsLoading: true, pinsError: "", pinsRefreshing: true });
    } else {
      this.setData({ pinsError: "", pinsRefreshing: true });
    }
    const fetchPage = () =>
      listMyPins(
        { page: 0, size: 1000 },
        { apiBase: this.apiBase }
      );
    let retriedWithAuth = false;
    const load = () =>
      fetchPage().catch((err) => {
        if (!retriedWithAuth && err?.message === "missing-token") {
          retriedWithAuth = true;
          return this.ensureAccessToken().then(() => fetchPage());
        }
        throw err;
      });
    return load()
      .then((page) => {
        const content = this.extractPinList(page);
        const normalized = content.map((item) => this.normalizePin(item));
        this._pinAddressCache = this._pinAddressCache || {};
        this._pendingPinGeo = this._pendingPinGeo || {};
        const applied = this.applyCachedPinAddresses(normalized);
        this.setData(
          {
            pins: applied,
            pinsLoaded: true,
            activePinFilter: filter
          },
          () => {
            this.applyPinFilters(applied, filter);
            this.enrichPinAddresses(applied);
          }
        );
      })
      .catch((err) => {
        console.error("Failed to load my pins", err);
        const message = err?.message || "加载我的标记失败，请稍后重试";
        this.setData({ pinsError: message });
      })
      .finally(() => {
        this.setData({ pinsLoading: false, pinsRefreshing: false });
      });
  },

  normalizePinCoordinateForPayload(item = {}) {
    const lat = normalizePinCoordValue(item.latitude);
    const lng = normalizePinCoordValue(item.longitude);
    const altitude = normalizePinAltitude(item.altitude ?? item.height ?? item.alt);
    const coord = {
      latitude: Number.isFinite(lat) ? lat : null,
      longitude: Number.isFinite(lng) ? lng : null
    };
    if (altitude !== "") {
      coord.altitude = altitude;
    }
    return coord;
  },

  mapPointCategoryByType(typeId) {
    switch (typeId) {
      case "POINT_WARNING":
        return "WARNING";
      case "POINT_AERIAL":
        return "AERIAL_SHOT";
      case "POINT_DOCK":
        return "TAKEOFF_LANDING";
      case "POINT_ELEVATION":
        return "TALL_BUILDING";
      default:
        return "GENERAL";
    }
  },

  mapLineCategoryByType(typeId) {
    if (typeId === "LINE_PATH_BUFFER") return "TEMPORARY_NO_FLY_ZONE_BUFFER";
    return "STANDARD";
  },

  mapPinShapeType(category, typeId) {
    if (category === "LINE") return "LINE";
    if (category === "AREA") {
      if (typeId === "AREA_CIRCLE") return "CIRCLE";
      if (typeId === "AREA_RECTANGLE") return "RECTANGLE";
      return "POLYGON";
    }
    return "POINT";
  },

  buildSelectedGroupDisplay(item = {}) {
    const name =
      item.displayName ||
      item.name ||
      item.groupName ||
      item.nickname ||
      item.title ||
      "";

    const memberCount =
      item.memberCount ??
      (Array.isArray(item.memberFeatureCodes) ? item.memberFeatureCodes.length : null);
    const coverRaw =
      item.coverImage ||
      item.cover ||
      (Array.isArray(item.images) && item.images.length ? item.images[0] : "") ||
      "";
    const coverImage =
      buildImageUrl(coverRaw, {
        apiBase: this.apiBase,
        fallback: this.data.assetPaths.workGroup
      }) || this.data.assetPaths.workGroup;
    console.log("memberCount", memberCount);
    return {
      id: item.id || item.groupId || "",
      name: name || "工作组",
      memberCount: Number.isFinite(Number(memberCount)) ? Number(memberCount) : null,
      coverImage
    };
  },

  getPinTypeLabel(typeId) {
    const map = {
      POINT_DEFAULT: "通用",
      POINT_WARNING: "警示点",
      POINT_AERIAL: "航拍点",
      POINT_DOCK: "起降场",
      POINT_ELEVATION: "高程建筑",
      LINE_PATH_BUFFER: "路径",
      AREA_CIRCLE: "圆形",
      AREA_RECTANGLE: "矩形",
      AREA_POLYGON: "多边形"
    };
    return map[typeId] || "";
  },
  getPinTypeIcon(typeId) {
    return PIN_TYPE_ICONS[typeId] || PIN_TYPE_ICONS.POINT_DEFAULT;
  },


  computePinGeometryLabel(category, typeId) {
    const cat = `${category || ""}`.toUpperCase();
    const catLabel = PIN_CATEGORY_LABELS[cat] || "";
    const typeLabel = this.getPinTypeLabel(typeId);
    if (catLabel && typeLabel) return `${catLabel}-${typeLabel}`;
    if (typeLabel) return typeLabel;
    if (catLabel) return catLabel;
    return "点-通用";
  },

  buildPinCoordinates(form, shapeType) {
    const coordList = Array.isArray(form.coordinateList) ? form.coordinateList : [];
    const coords = coordList
      .map((item) => this.normalizePinCoordinateForPayload(item))
      .filter((item) => hasValidCoordinate(item.latitude, item.longitude));
    if (!coords.length && hasValidCoordinate(form.latitude, form.longitude)) {
      coords.push(
        this.normalizePinCoordinateForPayload({
          latitude: form.latitude,
          longitude: form.longitude
        })
      );
    }
    if (shapeType === "LINE" && coords.length < 2) {
      throw new Error("请绘制两个以上的路径点");
    }
    if ((shapeType === "RECTANGLE" || shapeType === "POLYGON") && coords.length < 3) {
      throw new Error("请绘制三个以上的面点位");
    }
    if (shapeType === "CIRCLE" && !coords.length) {
      throw new Error("请先选择圆心");
    }
    if (shapeType === "POINT" && !coords.length) {
      throw new Error("请先选择标记位置");
    }
    return coords;
  },

  extractPinImagesForPayload(list = []) {
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => {
        if (!item) return "";
        if (typeof item === "string") return item;
        return (
          item.fileName ||
          item.filename ||
          item.objectName ||
          item.name ||
          item.location ||
          item.path ||
          item.url ||
          ""
        );
      })
      .map((text) => `${text}`.trim())
      .filter(Boolean);
  },

  buildPinShapePayload(form = this.data.myPinForm) {
    const shapeType = this.mapPinShapeType(form.geometryCategory, form.geometryType);
    const coordinates = this.buildPinCoordinates(form, shapeType);
    const shape = {
      type: shapeType,
      coordinates
    };
    if (shapeType === "POINT") {
      shape.pointCategory = this.mapPointCategoryByType(form.geometryType);
    }
    if (shapeType === "LINE") {
      const width = Number(form.bufferWidth);
      if (!Number.isFinite(width) || width <= 0) {
        throw new Error("请填写沿边宽度");
      }
      shape.width = Number(width.toFixed(2));
      shape.lineCategory = this.mapLineCategoryByType(form.geometryType);
    }
    if (shapeType === "CIRCLE") {
      const radius = Number(form.radius);
      if (!Number.isFinite(radius) || radius <= 0) {
        throw new Error("请填写半径");
      }
      shape.radius = Number((radius / 1000).toFixed(3)); // API 以公里为单位
    }
    return shape;
  },

  buildPinCreatePayload(form = this.data.myPinForm) {
    const name = (form.name || "").trim();
    if (!name) {
      throw new Error("请填写名称");
    }
    if (!form.geometryType || !form.geometryCategory) {
      throw new Error("请先选择标记类型");
    }
    const shape = this.buildPinShapePayload(form);
    const groupIds = Array.isArray(form.groupIds)
      ? form.groupIds.map((id) => `${id}`.trim()).filter(Boolean)
      : [];
    const hasGroups = groupIds.length > 0;
    const visibility = hasGroups
      ? "GROUP"
      : form.publishToPlatform
        ? "PUBLIC"
        : "PRIVATE";
    const images = this.extractPinImagesForPayload(form.images);
    if (!images.length) {
      throw new Error("请至少上传一张图片");
    }
    const payload = {
      name,
      description: (form.description || "").trim(),
      visibility,
      groupIds,
      groups: groupIds.map((id) => ({ id })),
      images,
      shape
    };
    return payload;
  },

  refreshMarkers(options = {}) {
    const { silent = false } = options;
    if (!silent) {
      this.setData({ loading: true, error: "" });
    } else {
      this.setData({ listRefreshing: true, error: "" });
    }
    const fetchPage = () => listMarkers({ page: 0, size: 50 }, { apiBase: this.apiBase });
    let retriedWithAuth = false;
    const load = () =>
      fetchPage().catch((err) => {
        if (!retriedWithAuth && err?.message === "missing-token") {
          retriedWithAuth = true;
          return this.ensureAccessToken().then(() => fetchPage());
        }
        throw err;
      });
    return load()
      .then((page) => {
        const content = this.extractMarkerList(page);
        const normalized = content.map((item) => this.normalizeMarker(item));
        this.setData({
          markers: normalized,
          hasLoaded: true
        });
        this.applyFilters(normalized, this.data.filterStatus);
      })
      .catch((err) => {
        console.error("Failed to load markers", err);
        const message = err?.message || "加载标记失败，请稍后重试";
        this.setData({ error: message });
      })
      .finally(() => {
        this.setData({ loading: false, listRefreshing: false });
      });
  },

  onRetryTap() {
    this.refreshMarkers({ silent: false });
  },

  onRetryPinRefreshTap() {
    this.refreshPins({ silent: false, filter: this.data.activePinFilter });
  },

  onExposureTap(e = {}) {
    const val = e?.currentTarget?.dataset?.value;
    const text =
      val === undefined || val === null
        ? "--"
        : typeof val === "number" || typeof val === "string"
          ? `${val}`
          : "--";
    wx.showToast({ title: `曝光：${text}`, icon: "none" });
  },

  extractMarkerList(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    const fromDirect =
      (Array.isArray(payload.content) && payload.content) ||
      (Array.isArray(payload.records) && payload.records) ||
      (Array.isArray(payload.items) && payload.items) ||
      (Array.isArray(payload.list) && payload.list);
    if (fromDirect) return fromDirect;
    const data = payload.data;
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
      if (Array.isArray(data.content)) return data.content;
      if (Array.isArray(data.records)) return data.records;
      if (Array.isArray(data.items)) return data.items;
      if (Array.isArray(data.list)) return data.list;
    }
    return [];
  },

  normalizeMarker(raw = {}) {
    const reviewStatus = raw.reviewStatus || "PENDING";
    const statusMeta = REVIEW_STATUS_META[reviewStatus] || REVIEW_STATUS_META.PENDING;
    const isDraft = !raw.paid;
    const statusLabel = isDraft ? "草稿" : statusMeta.label;
    const statusTone = isDraft ? "draft" : statusMeta.tone;
    const disableModifyActions = !!raw.paid && reviewStatus === "PENDING";
    const download = (value) => buildFileDownloadUrl(value, { apiBase: this.apiBase });
    const images = Array.isArray(raw.images)
      ? raw.images
        .map((img, index) => ({
          fileName: img,
          url: download(img),
          id: `${raw.id || "marker"}-image-${index}`
        }))
      : [];
    const qrCodes = Array.isArray(raw.qrCodeUrls)
      ? raw.qrCodeUrls.map((item, index) => ({
        fileName: item,
        url: download(item),
        id: `${raw.id || "marker"}-qrcode-${index}`
      }))
      : [];
    const attachments = Array.isArray(raw.attachmentUrls)
      ? raw.attachmentUrls
        .map((item, index) => ({
          fileName: item,
          url: download(item),
          id: `${raw.id || "marker"}-attachment-${index}`,
          label: ATTACHMENT_FIXED_LABEL
        }))
        .filter((item) => !!item.url)
        .slice(0, ATTACHMENT_MAX_COUNT)
      : [];
    const createdAtDisplay = this.formatDateTime(raw.createdAt);
    const updatedAtDisplay = this.formatDateTime(raw.updatedAt);
    const hasUpdatedAt = !!raw.updatedAt && updatedAtDisplay !== "--";
    const timelineLabel = hasUpdatedAt ? "更新时间" : "提交时间";
    const timelineDisplay = hasUpdatedAt ? updatedAtDisplay : createdAtDisplay;
    const exposureCount =
      raw.exposureCount !== undefined && raw.exposureCount !== null
        ? Number(raw.exposureCount)
        : 0;
    const exposureDisplay = this.formatExposureDisplay(exposureCount);
    const phoneCallCount =
      raw.phoneCallCount !== undefined && raw.phoneCallCount !== null
        ? Number(raw.phoneCallCount)
        : 0;
    return {
      id: raw.id || "",
      name: raw.name || "",
      description: raw.description || "",
      location: raw.location || {},
      locationText: raw.location?.text || "",
      latitude: raw.location?.latitude,
      longitude: raw.location?.longitude,
      phone: raw.phone || "",
      images,
      qrCodes,
      attachments,
      businessLicense: raw.businessLicense
        ? {
          fileName: raw.businessLicense,
          url: download(raw.businessLicense)
        }
        : null,
      industryHonorTags: Array.isArray(raw.industryHonorTags)
        ? raw.industryHonorTags.filter((tag) => typeof tag === "string" && tag.trim())
        : [],
      videoChannelId: typeof raw.videoChannelId === "string" ? raw.videoChannelId : "",
      videoId: typeof raw.videoId === "string" ? raw.videoId : "",
      adminInfo: raw.adminInfo || {},
      reviewStatus,
      reviewStatusLabel: statusLabel,
      reviewTone: statusTone,
      paid: !!raw.paid,
      isDraft,
      paidLabel: raw.paid ? "已完成支付" : "待支付",
      paymentMethod: raw.paymentMethod || "",
      featureCode: raw.featureCode || "",
      createdAtDisplay,
      updatedAtDisplay,
      timelineLabel,
      timelineDisplay,
      exposureCount: Number.isFinite(exposureCount) ? exposureCount : 0,
      exposureDisplay: exposureDisplay.display,
      exposureFull: exposureDisplay.full,
      phoneCallCount: Number.isFinite(phoneCallCount) ? phoneCallCount : 0,
      coverImage: images.length ? images[0].url : "",
      disableModifyActions,
      raw
    };
  },

  applyFilters(markers, status) {
    const filter = status || this.data.filterStatus || "ALL";
    const list = Array.isArray(markers) ? markers : this.data.markers;
    let filtered;
    if (filter === "ALL") {
      filtered = list;
    } else if (filter === "DRAFT") {
      filtered = list.filter((marker) => !marker.paid);
    } else {
      filtered = list.filter((marker) => marker.paid && marker.reviewStatus === filter);
    }
    this.setData({
      visibleMarkers: filtered,
      filterStatus: filter
    });
  },

  formatDateTime(value) {
    if (!value) return "--";
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "--";
      const yyyy = date.getFullYear();
      const mm = `${date.getMonth() + 1}`.padStart(2, "0");
      const dd = `${date.getDate()}`.padStart(2, "0");
      const hh = `${date.getHours()}`.padStart(2, "0");
      const mi = `${date.getMinutes()}`.padStart(2, "0");
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    } catch (err) {
      return "--";
    }
  },

  onStatusTabTap(e) {
    const status = e?.currentTarget?.dataset?.status;
    if (!status) return;
    this.applyFilters(this.data.markers, status);
  },

  onMarkerCardTap(e) {
    const markerId = e?.currentTarget?.dataset?.id;
    if (!markerId) return;
    const marker = this.data.markers.find((item) => item.id === markerId);
    if (!marker) return;
    this.showMarkerActionSheet(marker);
  },

  onPinCardTap(e) {
    const pinId = e?.currentTarget?.dataset?.pinId;
    if (!pinId) return;
    const pin = (this.data.visiblePins || []).find((item) => item.id === pinId);
    if (!pin) return;
    this.showMarkerActionSheet(pin);
  },

  showMarkerDetail(marker) {
    if (!marker) return;
    this.setData({ showDetail: true, activeMarker: marker });
  },

  showMarkerActionSheet(marker) {
    if (!marker) return;
    const options =
      this.data.activeCenterTab === "MY_MARKERS"
        ? this.buildMyMarkerActionOptions(marker)
        : [];
    const primary = options.length ? options[0] : null;
    const secondary = options.length > 1 ? options.slice(1) : [];
    this.setData({
      actionSheetVisible: true,
      actionSheetMarker: marker,
      actionSheetDisableModify: this.isModifyActionLocked(marker),
      actionSheetOptions: options,
      actionSheetPrimaryOption: primary,
      actionSheetSecondaryOptions: secondary
    });
  },

  buildMyMarkerActionOptions(marker = {}) {
    const assetPaths = this.data.assetPaths || {};
    const disableModify = this.isModifyActionLocked(marker);
    const scope = `${marker.scope || ""}`.toUpperCase();
    const isPrivate = scope === "PRIVATE";
    const isPublic = scope === "PUBLIC";
    const isPending = (`${marker.reviewStatus || ""}`.toUpperCase() === "PENDING") && marker.scope === "PUBLIC";
    const firstActionType = isPublic ? "revoke" : "publish";
    const firstActionLabel = isPublic ? "撤回发布" : "发布到平台";
    const firstActionIcon = isPublic ? assetPaths.revoke : assetPaths.publish;
    const firstActionEnabled = isPublic
      ? !disableModify && !isPending
      : isPrivate && !disableModify;
    const firstActionNote = "";
    const options = [
      {
        action: firstActionType,
        label: firstActionLabel,
        icon: firstActionIcon,
        enabled: firstActionEnabled,
        note: firstActionNote
      },
      {
        action: "preview",
        label: "主页预览",
        icon: assetPaths.home,
        enabled: true
      },
      {
        action: "edit",
        label: "编辑",
        icon: "",
        enabled: !disableModify && !isPending,
        note: ""
      },
      {
        action: "delete",
        label: "删除",
        icon: assetPaths.delete,
        enabled: !disableModify && !isPending,
        note: ""
      }
    ];
    return options;
  },

  hideMarkerActionSheet() {
    this.setData({
      actionSheetVisible: false,
      actionSheetMarker: null,
      actionSheetDisableModify: false,
      actionSheetOptions: [],
      actionSheetPrimaryOption: null,
      actionSheetSecondaryOptions: []
    });
  },

  onActionSheetCancel() {
    this.hideMarkerActionSheet();
  },

  onActionSheetAction(e) {
    const action = e?.currentTarget?.dataset?.action;
    const marker = this.data.actionSheetMarker;
    if (!action) {
      this.hideMarkerActionSheet();
      return;
    }
    if (action === "cancel") {
      this.hideMarkerActionSheet();
      return;
    }
    if (!marker) {
      this.hideMarkerActionSheet();
      return;
    }
    const isMyMarkers = this.data.activeCenterTab === "MY_MARKERS";
    if (isMyMarkers) {
      this.hideMarkerActionSheet();
      this.handlePinAction(action, marker);
      return;
    }
    if ((action === "edit" || action === "delete") && this.isModifyActionLocked(marker)) {
      wx.showToast({
        title: action === "edit" ? "审核中暂不可编辑" : "审核中暂不可删除",
        icon: "none"
      });
      return;
    }
    this.hideMarkerActionSheet();
    if (action === "home") {
      this.onGoHomeTap({ currentTarget: { dataset: { id: marker.id } } });
      return;
    }
    if (action === "detail") {
      this.showMarkerDetail(marker);
      return;
    }
    if (action === "edit") {
      this.onEditMarkerTap({ currentTarget: { dataset: { id: marker.id } } });
      return;
    }
    if (action === "delete") {
      this.onDeleteMarkerTap({
        currentTarget: { dataset: { id: marker.id, name: marker.name } }
      });
    }
  },

  handlePinAction(action, marker) {
    const option = (this.data.actionSheetOptions || []).find((item) => item.action === action);
    if (option && !option.enabled) {
      if (option.note) {
        wx.showToast({ title: option.note, icon: "none" });
      }
      return;
    }
    if (action === "publish") {
      this.openPublishPlatformDialog("pin-action", marker);
      return;
    }
    if (action === "revoke") {
      this.showPinConfirm("revoke", marker);
      return;
    }
    if (action === "preview") {
      this.handlePinPreview(marker);
      return;
    }
    if (action === "edit") {
      this.onEditMarkerTap({ currentTarget: { dataset: { id: marker.id } } });
      return;
    }
    if (action === "delete") {
      this.onDeleteMarkerTap({
        currentTarget: { dataset: { id: marker.id, name: marker.name } }
      });
    }
  },

  handlePinPublish(marker = {}, options = {}) {
    const skipConfirm = options?.skipConfirm === true;
    if (!marker?.id) return;
    if (
      !skipConfirm &&
      (!this.data.pinConfirmVisible || this.data.pinConfirmAction !== "publish")
    ) {
      this.showPinConfirm("publish", marker);
      return;
    }
    if (this._pinActionPending) return;
    const startAction = () => publishPin(marker.id, { apiBase: this.apiBase });
    let retried = false;
    const run = () =>
      startAction().catch((err) => {
        if (!retried && err?.message === "missing-token") {
          retried = true;
          return this.ensureAccessToken().then(() => startAction());
        }
        throw err;
      });
    this._pinActionPending = true;
    this.setData({ actionProcessingId: marker.id || "" });
    run()
      .then(() => {
        wx.showToast({ title: "已提交发布", icon: "success" });
        this.refreshPins({ silent: true });
      })
      .catch((err) => {
        console.error("publish pin failed", err);
        wx.showToast({ title: err?.message || "发布失败", icon: "none" });
      })
      .finally(() => {
        this._pinActionPending = false;
        this.setData({ actionProcessingId: "" });
      });
  },

  handlePinRevoke(marker = {}) {
    if (!marker?.id) return;
    if (!this.data.pinConfirmVisible || this.data.pinConfirmAction !== "revoke") {
      this.showPinConfirm("revoke", marker);
      return;
    }
    if (this._pinActionPending) return;
    const startAction = () => revokePin(marker.id, { apiBase: this.apiBase });
    let retried = false;
    const run = () =>
      startAction().catch((err) => {
        if (!retried && err?.message === "missing-token") {
          retried = true;
          return this.ensureAccessToken().then(() => startAction());
        }
        throw err;
      });
    this._pinActionPending = true;
    this.setData({ actionProcessingId: marker.id || "" });
    run()
      .then(() => {
        wx.showToast({ title: "已撤回发布", icon: "success" });
        this.refreshPins({ silent: true });
      })
      .catch((err) => {
        console.error("revoke pin failed", err);
        wx.showToast({ title: err?.message || "撤回失败", icon: "none" });
      })
      .finally(() => {
        this._pinActionPending = false;
        this.setData({ actionProcessingId: "" });
      });
  },

  handlePinPreview(marker = {}) {
    if (!marker) return;
    if (!this.queuePinPreview(marker)) {
      wx.showToast({ title: "无法预览标记", icon: "none" });
    }
  },

  queuePinPreview(marker = {}) {
    const payload = this.buildPinPreviewPayload(marker);
    if (!payload) {
      wx.showToast({ title: "标记缺少位置数据", icon: "none" });
      return false;
    }
    const app = typeof getApp === "function" ? getApp() : null;
    if (!app || !app.globalData) {
      wx.showToast({ title: "无法打开地图", icon: "none" });
      return false;
    }
    app.globalData.pendingPinPreview = payload;
    const navigated = this.navigateToMapHome();
    if (!navigated) {
      app.globalData.pendingPinPreview = null;
    }
    return navigated;
  },

  showPinConfirm(action, marker = {}) {
    if (!marker?.id) return;
    const isPublish = action === "publish";
    const message = isPublish ? "确认发布到平台？" : "确认撤回发布？";
    this.setData({
      pinConfirmVisible: true,
      pinConfirmAction: action,
      pinConfirmTargetId: marker.id,
      pinConfirmMessage: message,
      pinConfirmBusy: false
    });
  },

  openPublishPlatformDialog(source = "", marker = null) {
    this.setData({
      publishPlatformDialogVisible: true,
      publishPlatformDialogSource: source,
      publishPlatformPendingMarker: marker || null
    });
  },

  onPublishPlatformCancel() {
    const source = this.data.publishPlatformDialogSource;
    this.setData({
      publishPlatformDialogVisible: false,
      publishPlatformDialogSource: "",
      publishPlatformPendingMarker: null
    });
    if (source === "pin-toggle") {
      this.setData({ "myPinForm.publishToPlatform": false });
    }
  },

  onPublishPlatformConfirm() {
    const source = this.data.publishPlatformDialogSource;
    const marker = this.data.publishPlatformPendingMarker;
    this.setData({
      publishPlatformDialogVisible: false,
      publishPlatformDialogSource: "",
      publishPlatformPendingMarker: null
    });
    if (source === "pin-toggle") {
      this.setData({ "myPinForm.publishToPlatform": true });
      return;
    }
    if (source === "pin-action" && marker) {
      this.handlePinPublish(marker, { skipConfirm: true });
    }
  },

  onPinConfirmCancel() {
    if (this.data.pinConfirmBusy) return;
    this.setData({
      pinConfirmVisible: false,
      pinConfirmAction: "",
      pinConfirmTargetId: "",
      pinConfirmMessage: "",
      pinConfirmBusy: false
    });
  },

  onPinConfirmProceed() {
    if (this.data.pinConfirmBusy) return;
    const action = this.data.pinConfirmAction;
    const markerId = this.data.pinConfirmTargetId;
    if (!action || !markerId) {
      this.onPinConfirmCancel();
      return;
    }
    const marker =
      (this.data.pins || []).find((p) => p.id === markerId) ||
      (this.data.visiblePins || []).find((p) => p.id === markerId) ||
      {};
    this.setData({ pinConfirmBusy: true });
    const after = () => {
      this.setData({
        pinConfirmVisible: false,
        pinConfirmAction: "",
        pinConfirmTargetId: "",
        pinConfirmMessage: "",
        pinConfirmBusy: false
      });
    };
    if (action === "publish") {
      this.handlePinPublish(marker);
      after();
      return;
    }
    if (action === "revoke") {
      this.handlePinRevoke(marker);
      after();
      return;
    }
    after();
  },

  buildPinPreviewPayload(marker = {}) {
    const shape = marker?.raw?.shape;
    if (!shape) return null;
    const coordinates = this.normalizePinPreviewCoordinates(shape.coordinates);
    if (!coordinates.length) return null;
    const type = `${shape.type || "POINT"}`.toUpperCase();
    const pointCategory = `${shape.pointCategory || shape.pointcategory || ""}`.toUpperCase();
    const normalizedShape = {
      type,
      coordinates,
      radius: Number(shape.radius ?? shape.radiusKm ?? 0),
      width: Number(
        shape.width ??
        shape.bufferWidth ??
        shape.bufferWidthMeters ??
        shape.pathDistanceMeters ??
        0
      ),
      pointCategory
    };
    return {
      id: marker.id || "",
      name: marker.name || "",
      shape: normalizedShape,
      location: coordinates[0],
      height: this.extractPinPreviewHeight(marker, coordinates[0]),
      zoom: 16
    };
  },

  normalizePinPreviewCoordinates(raw = []) {
    if (!Array.isArray(raw) || !raw.length) return [];
    return raw
      .map((item) => {
        if (!item) return null;
        if (Array.isArray(item) && item.length >= 2) {
          const lng = Number(item[0]);
          const lat = Number(item[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return {
            latitude: lat,
            longitude: lng,
            altitude: item[2]
          };
        }
        const lat = Number(item.latitude ?? item.lat);
        const lng = Number(item.longitude ?? item.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return null;
        }
        return {
          latitude: lat,
          longitude: lng,
          altitude: item.altitude ?? item.height ?? item.alt
        };
      })
      .filter((coord) => coord && hasValidCoordinate(coord.latitude, coord.longitude));
  },

  extractPinPreviewHeight(marker = {}, primary = {}) {
    const candidates = [
      primary.altitude,
      primary.height,
      marker.raw?.shape?.height,
      marker.raw?.shape?.altitude,
      marker.raw?.height,
      marker.raw?.altitude,
      marker.height,
      marker.altitude
    ];
    for (const candidate of candidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }
    return null;
  },

  noop() { },

  onCloseDetail() {
    this.setData({ showDetail: false, activeMarker: null });
  },

  onCreateTap() {
    if (this.data.activeCenterTab === "MY_MARKERS") {
      this.openMyPinCreate();
      return;
    }
    this.setData(
      {
        showCreate: true,
        createStep: 0,
        maxStepReached: 0,
        form: createEmptyForm(),
        tagInput: "",
        selectedPaymentMethod: PAYMENT_METHODS[0].id,
        creationSubmitting: false,
        creationError: "",
        creationResult: null,
        editingMarkerId: "",
        submitButtonText: "提交审核",
        showPaymentSection: true,
        resultStepsLocked: false
      },
      () => {
        this.ensureValidPaymentSelection();
      }
    );
  },

  openMyPinCreate() {
    this.setData({
      showMyPinCreate: true,
      myPinForm: createEmptyPinForm(),
      myPinFormConfigured: false,
      pinSubmitting: false,
      pinError: "",
      editingPinId: "",
      pinLocationDisplay: "",
      myPinSelectedGroups: []
    });
  },

  onCloseMyPinCreate() {
    if (this.data.pinSubmitting) return;
    this.setData({ showMyPinCreate: false, pinError: "" });
  },

  onPinPickerTap() {
    if (typeof wx.navigateTo !== "function") {
      wx.showToast({ title: "当前版本暂不支持", icon: "none" });
      return;
    }
    const payload = {};
    if (hasValidCoordinate(this.data.myPinForm.latitude, this.data.myPinForm.longitude)) {
      payload.latitude = this.data.myPinForm.latitude;
      payload.longitude = this.data.myPinForm.longitude;
    }
    payload.typeId = this.data.myPinForm.geometryType;
    if (Array.isArray(this.data.myPinForm.coordinateList) && this.data.myPinForm.coordinateList.length) {
      payload.coordinateList = normalizePinCoordinateList(this.data.myPinForm.coordinateList);
      payload.activeCoordIndex = Math.min(
        Math.max(Number(this.data.myPinForm.activeCoordIndex || 0), 0),
        payload.coordinateList.length - 1
      );
    }
    const width = Number(this.data.myPinForm.bufferWidth);
    if (Number.isFinite(width) && width > 0) {
      payload.bufferWidth = width;
      payload.pathBufferWidth = width;
      payload.bufferWidthMeters = width;
    }
    const radius = Number(this.data.myPinForm.radius);
    if (Number.isFinite(radius) && radius > 0) {
      payload.radius = radius;
    }
    wx.navigateTo({
      url: "/pages/markers/pin-picker/index",
      events: {
        pinSelected: (detail = {}) => this.applyPinSelection(detail)
      },
      success: (res) => {
        const channel = res?.eventChannel;
        if (channel && typeof channel.emit === "function") {
          channel.emit("initLocation", payload);
        }
      }
    });
  },

  applyPinSelection(detail = {}) {
    const cat = detail.category || "";
    const label = detail.typeLabel || detail.typeId || "通用";
    const prefix = PIN_CATEGORY_LABELS[cat] || "";
    const combinedLabel = prefix ? `${prefix}-${label}` : label;
    const geometryIcon = this.getPinTypeIcon(detail.typeId || detail.type);
    const coordinateList = normalizePinCoordinateList(detail.coordinates || detail.coordinateList || []);
    const activeCoordIndex = Math.min(
      Math.max(Number(detail.activeCoordIndex || 0), 0),
      coordinateList.length ? coordinateList.length - 1 : 0
    );
    const activeCoord = coordinateList[activeCoordIndex] || {};
    const lat = detail.latitude ?? activeCoord.latitude ?? null;
    const lng = detail.longitude ?? activeCoord.longitude ?? null;
    const bufferWidthRaw =
      detail.bufferWidth ?? detail.pathBufferWidth ?? detail.bufferWidthMeters ?? null;
    const radiusRaw = detail.radius ?? null;
    this.setData({
      "myPinForm.latitude": lat,
      "myPinForm.longitude": lng,
      "myPinForm.coordinateText": detail.coordinateText || "",
      "myPinForm.addressMain": detail.addressMain || "",
      "myPinForm.addressDetail": detail.addressDetail || "",
      "myPinForm.geometryType": detail.typeId || detail.type || "POINT_DEFAULT",
      "myPinForm.geometryCategory": cat || "POINT",
      "myPinForm.geometryLabel": combinedLabel,
      "myPinForm.geometryName": label || "通用",
      "myPinForm.geometryIcon": geometryIcon,
      "myPinForm.coordinateList": coordinateList,
      "myPinForm.activeCoordIndex": activeCoordIndex,
      "myPinForm.bufferWidth": Number.isFinite(Number(bufferWidthRaw)) ? Number(bufferWidthRaw) : null,
      "myPinForm.radius": Number.isFinite(Number(radiusRaw)) ? Number(radiusRaw) : null,
      myPinFormConfigured: isPinLocationConfigured(
        Object.assign({}, this.data.myPinForm, {
          latitude: lat,
          longitude: lng,
          coordinateList
        })
      ),
      pinLocationDisplay: ""
    });
    this.updatePinLocationDisplay();
    if (!detail.addressMain && hasValidCoordinate(lat, lng)) {
      this.reverseGeocodePinLocation(lat, lng);
    }
  },

  onPinNameInput(e) {
    this.setData({ "myPinForm.name": e?.detail?.value || "" });
  },

  onPinDescInput(e) {
    this.setData({ "myPinForm.description": e?.detail?.value || "" });
  },

  onPinWorkspaceInput(e) {
    this.setData({ "myPinForm.workspace": e?.detail?.value || "" });
  },

  onPinPublishToggle(e) {
    const publish = !!e?.detail?.value;
    if (publish) {
      // require confirmation before enabling publish to platform in creation flow
      this.setData({
        "myPinForm.publishToPlatform": false
      });
      this.openPublishPlatformDialog("pin-toggle");
      return;
    }
    this.setData({ "myPinForm.publishToPlatform": false });
  },

  onAddPinMediaTap() {
    const current = Array.isArray(this.data.myPinForm.images) ? this.data.myPinForm.images.length : 0;
    const remaining = Math.max(0, PIN_MEDIA_MAX_COUNT - current);
    if (remaining <= 0) {
      wx.showToast({ title: `最多上传${PIN_MEDIA_MAX_COUNT}个`, icon: "none" });
      return;
    }
    wx.chooseImage({
      count: remaining,
      sizeType: ["compressed"],
      success: (res) => {
        const paths = res?.tempFilePaths || [];
        if (!paths.length) return;
        this.uploadFiles("pinImages", paths);
      }
    });
  },

  onRemovePinMediaTap(e) {
    const index = e?.currentTarget?.dataset?.index;
    if (index === undefined || index === null) return;
    const list = Array.isArray(this.data.myPinForm.images) ? this.data.myPinForm.images.slice() : [];
    list.splice(index, 1);
    this.setData({ "myPinForm.images": list });
  },

  onSubmitPinForm() {
    if (this.data.pinSubmitting) return;
    const form = this.data.myPinForm || {};
    if (!form.geometryType || !form.geometryCategory) {
      wx.showToast({ title: "请先开始标记", icon: "none" });
      return;
    }
    try {
      this.buildPinShapePayload(form);
    } catch (err) {
      wx.showToast({ title: err?.message || "请完善标记信息", icon: "none" });
      return;
    }
    let payload;
    try {
      payload = this.buildPinCreatePayload(form);
    } catch (err) {
      wx.showToast({ title: err?.message || "请完善标记信息", icon: "none" });
      return;
    }
    const editingId = this.data.editingPinId;
    this.setData({ pinSubmitting: true, pinError: "" });
    const submit = () =>
      editingId
        ? updatePinApi(editingId, payload, { apiBase: this.apiBase })
        : createPinApi(payload, { apiBase: this.apiBase });
    let retriedWithAuth = false;
    const run = () =>
      submit().catch((err) => {
        if (!retriedWithAuth && err?.message === "missing-token") {
          retriedWithAuth = true;
          return this.ensureAccessToken().then(() => submit());
        }
        throw err;
      });
    run()
      .then(() => {
        this.setData({ pinSubmitting: false, showMyPinCreate: false, editingPinId: "" });
        wx.showToast({ title: editingId ? "已更新标记" : "已保存标记", icon: "success" });
        this.refreshPins({ silent: true });
      })
      .catch((err) => {
        console.error(editingId ? "更新 Pin 失败" : "创建 Pin 失败", err);
        const message = err?.message || "保存失败";
        this.setData({ pinSubmitting: false, pinError: message });
        wx.showToast({ title: message, icon: "none" });
      });
  },

  updatePinLocationDisplay() {
    const form = this.data.myPinForm || {};
    const coords = Array.isArray(form.coordinateList) ? form.coordinateList : [];
    const activeIndex = Math.min(Math.max(Number(form.activeCoordIndex || 0), 0), Math.max(coords.length - 1, 0));
    const coord = coords[activeIndex] || {};
    const lat = Number(coord.latitude ?? form.latitude);
    const lng = Number(coord.longitude ?? form.longitude);
    const alt = Number(
      coord.altitude ??
      coord.height ??
      coord.alt ??
      form.altitude
    );
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      this.setData({ pinLocationDisplay: "" });
      return;
    }
    const parts = [`${lat.toFixed(6)}, ${lng.toFixed(6)}`];
    if (Number.isFinite(alt)) {
      parts.push(`${alt.toFixed(1)}米`);
    }
    const address = (form.addressMain || form.addressDetail || "").trim();
    if (address) {
      parts.push(address);
    }
    this.setData({ pinLocationDisplay: parts.join(" · ") });
  },

  reverseGeocodePinLocation(lat, lng) {
    reverseGeocode(lat, lng)
      .then((res = {}) => {
        const addr = this.extractAddressFromReverse(res);
        if (!addr) return;
        this.setData({
          "myPinForm.addressMain": addr,
          pinLocationDisplay: this.data.pinLocationDisplay
        });
        this.updatePinLocationDisplay();
      })
      .catch((err) => {
        console.warn("pin reverse geocode failed", err);
      });
  },

  onGoHomeTap(e) {
    const markerId = e?.currentTarget?.dataset?.id;
    if (!markerId) return;
    const marker = this.data.markers.find((item) => item.id === markerId);
    if (!marker) {
      if (wx && typeof wx.showToast === "function") {
        wx.showToast({ title: "未找到标记", icon: "none" });
      }
      return;
    }
    if (!this.queueMarkerFocus(marker)) {
      return;
    }
    this.setData({ showDetail: false, activeMarker: null });
    if (this.navigateToMapHome()) {
      return;
    }
    if (wx && typeof wx.showToast === "function") {
      wx.showToast({ title: "无法打开地图", icon: "none" });
    }
  },

  navigateToMapHome() {
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    if (
      Array.isArray(pages) &&
      pages.length &&
      typeof wx !== "undefined" &&
      typeof wx.navigateBack === "function"
    ) {
      for (let i = pages.length - 2; i >= 0; i--) {
        const route = pages[i]?.route || pages[i]?.__route__ || "";
        if (route === "pages/map/map") {
          const delta = pages.length - 1 - i;
          if (delta > 0) {
            wx.navigateBack({ delta });
            return true;
          }
          return true;
        }
      }
    }
    if (typeof wx !== "undefined" && typeof wx.navigateTo === "function") {
      try {
        wx.navigateTo({ url: "/pages/map/map" });
        return true;
      } catch (err) {
        console.warn("navigateTo map failed", err);
      }
    }
    if (typeof wx !== "undefined" && typeof wx.redirectTo === "function") {
      try {
        wx.redirectTo({ url: "/pages/map/map" });
        return true;
      } catch (err) {
        console.warn("redirectTo map failed", err);
      }
    }
    if (typeof wx !== "undefined" && typeof wx.reLaunch === "function") {
      wx.reLaunch({ url: "/pages/map/map" });
      return true;
    }
    return false;
  },

  queueMarkerFocus(marker = {}) {
    const latitude = this.pickNumericValue(
      marker.latitude,
      marker.location?.latitude,
      marker.raw?.location?.latitude,
      marker.raw?.latitude
    );
    const longitude = this.pickNumericValue(
      marker.longitude,
      marker.location?.longitude,
      marker.raw?.location?.longitude,
      marker.raw?.longitude
    );
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      if (wx && typeof wx.showToast === "function") {
        wx.showToast({ title: "标记缺少位置信息", icon: "none" });
      }
      return false;
    }
    const mode = marker.reviewStatus === "APPROVED" ? "online" : "offline";
    const request = {
      markerId: marker.id,
      latitude,
      longitude,
      name: marker.name || "",
      locationText: marker.locationText || "",
      reviewStatus: marker.reviewStatus || "",
      timestamp: Date.now(),
      mode
    };
    if (mode === "offline") {
      const offlineRaw = this.buildOfflineMarkerDetailRaw(marker);
      if (!offlineRaw) {
        if (wx && typeof wx.showToast === "function") {
          wx.showToast({ title: "标记信息不完整", icon: "none" });
        }
        return false;
      }
      request.offlineRaw = offlineRaw;
      request.detailSnapshot = this.buildOfflineDetailSnapshot(marker);
      request.shareDisabled = true;
    }
    if (!this.storePendingMarkerFocus(request)) {
      if (wx && typeof wx.showToast === "function") {
        wx.showToast({ title: "无法打开地图", icon: "none" });
      }
      return false;
    }
    return true;
  },

  storePendingMarkerFocus(payload) {
    if (!payload) return false;
    const app = typeof getApp === "function" ? getApp() : null;
    if (!app || !app.globalData) return false;
    app.globalData.pendingMarkerFocus = payload;
    return true;
  },

  pickNumericValue(...candidates) {
    for (const candidate of candidates) {
      const value = Number(candidate);
      if (Number.isFinite(value)) {
        return value;
      }
    }
    return null;
  },

  buildOfflineMarkerDetailRaw(marker = {}) {
    const base = marker.raw && typeof marker.raw === "object" ? Object.assign({}, marker.raw) : {};
    const latitude = this.pickNumericValue(
      marker.latitude,
      marker.location?.latitude,
      base.location?.latitude,
      base.latitude
    );
    const longitude = this.pickNumericValue(
      marker.longitude,
      marker.location?.longitude,
      base.location?.longitude,
      base.longitude
    );
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }
    base.id = marker.id || base.id || "";
    base.name = marker.name || base.name || "";
    base.description = marker.description || base.description || "";
    base.locationText = marker.locationText || base.locationText || "";
    base.latitude = latitude;
    base.longitude = longitude;
    const location = Object.assign({}, base.location || {});
    location.text = marker.locationText || location.text || base.locationText || "";
    location.latitude = latitude;
    location.longitude = longitude;
    base.location = location;
    if (!base.phone && marker.phone) {
      base.phone = marker.phone;
    }
    if (
      (!Array.isArray(base.industryHonorTags) || !base.industryHonorTags.length) &&
      Array.isArray(marker.industryHonorTags)
    ) {
      base.industryHonorTags = marker.industryHonorTags.slice();
    }
    if (!base.images || !base.images.length) {
      base.images = this.extractFileReferences(marker.images);
    }
    if (!base.qrCodeUrls || !base.qrCodeUrls.length) {
      base.qrCodeUrls = this.extractFileReferences(marker.qrCodes);
    }
    const attachmentRefs = this.extractFileReferences(marker.attachments);
    if ((!base.attachmentUrls || !base.attachmentUrls.length) && attachmentRefs.length) {
      base.attachmentUrls = attachmentRefs.slice();
    }
    if ((!base.attachments || !base.attachments.length) && attachmentRefs.length) {
      base.attachments = attachmentRefs.slice();
    }
    if (!base.businessLicense && marker.businessLicense) {
      base.businessLicense =
        marker.businessLicense.fileName || marker.businessLicense.url || "";
    }
    return base;
  },

  buildOfflineDetailSnapshot(marker = {}) {
    const cloneList = (list = []) =>
      Array.isArray(list)
        ? list
          .map((item) => (item && typeof item === "object" ? Object.assign({}, item) : item))
          .filter(Boolean)
        : [];
    const cloneObject = (value) =>
      value && typeof value === "object" ? Object.assign({}, value) : value || null;
    return {
      id: marker.id || "",
      name: marker.name || "",
      description: marker.description || "",
      phone: marker.phone || "",
      locationText: marker.locationText || "",
      images: cloneList(marker.images),
      attachments: cloneList(marker.attachments),
      qrCodes: cloneList(marker.qrCodes),
      honors: Array.isArray(marker.industryHonorTags)
        ? marker.industryHonorTags.slice()
        : [],
      businessLicense: cloneObject(marker.businessLicense),
      adminInfo: cloneObject(marker.adminInfo),
      videoAccounts: cloneList(marker.videoAccounts),
      primaryVideoAccount: cloneObject(marker.primaryVideoAccount),
      videoChannelId: marker.videoChannelId || "",
      videoId: marker.videoId || "",
      reviewStatus: marker.reviewStatus || "",
      reviewStatusLabel: marker.reviewStatusLabel || "",
      reviewTone: marker.reviewTone || "",
      paid: !!marker.paid,
      paidLabel: marker.paidLabel || "",
      paymentMethod: marker.paymentMethod || "",
      createdAtDisplay: marker.createdAtDisplay || "",
      updatedAtDisplay: marker.updatedAtDisplay || "",
      raw: marker.raw && typeof marker.raw === "object" ? Object.assign({}, marker.raw) : null
    };
  },

  extractFileReferences(collection = []) {
    if (!Array.isArray(collection)) return [];
    return collection
      .map((item) => {
        if (!item) return "";
        if (typeof item === "string") {
          return item.trim();
        }
        if (typeof item.fileName === "string" && item.fileName.trim()) {
          return item.fileName.trim();
        }
        if (typeof item.url === "string" && item.url.trim()) {
          return item.url.trim();
        }
        return "";
      })
      .filter(Boolean);
  },

  isModifyActionLocked(marker) {
    if (!marker) return false;
    if (marker.disableModifyActions) return true;
    return !!marker.paid && marker.reviewStatus === "PENDING";
  },

  onEditMarkerTap(e) {
    const markerId = e?.currentTarget?.dataset?.id;
    if (!markerId) return;
    const marker = this.findAnyMarkerById(markerId);
    if (!marker) {
      wx.showToast({ title: "未找到标记", icon: "none" });
      return;
    }
    if (this.data.activeCenterTab === "MY_MARKERS" || marker?.raw?.shape) {
      const pinForm = this.buildPinFormFromPin(marker);
      if (!pinForm) {
        wx.showToast({ title: "标记数据不完整，无法编辑", icon: "none" });
        return;
      }
      this.setData({
        showMyPinCreate: true,
        myPinForm: pinForm,
        myPinFormConfigured: true,
        pinSubmitting: false,
        pinError: "",
        editingPinId: marker.id || "",
        myPinSelectedGroups: this.buildPinSelectedGroupsFromPin(marker)
      }, () => {
        this.updatePinLocationDisplay();
        const coord = (pinForm.coordinateList || [])[pinForm.activeCoordIndex || 0] || {};
        if (!pinForm.addressMain && hasValidCoordinate(coord.latitude, coord.longitude)) {
          this.reverseGeocodePinLocation(coord.latitude, coord.longitude);
        }
      });
      return;
    }
    if (this.isModifyActionLocked(marker)) {
      return;
    }
    const form = this.buildFormFromMarker(marker);
    const selectedPaymentMethod =
      marker.paymentMethod && marker.paymentMethod !== DRAFT_PAYMENT_METHOD
        ? marker.paymentMethod
        : PAYMENT_METHODS[0].id;
    this.setData(
      {
        showCreate: true,
        createStep: 0,
        maxStepReached: 0,
        form,
        tagInput: "",
        selectedPaymentMethod,
        creationSubmitting: false,
        creationError: "",
        creationResult: null,
        editingMarkerId: marker.id,
        submitButtonText: "保存修改",
        showPaymentSection: !marker.paid,
        resultStepsLocked: false
      },
      () => {
        this.ensureValidPaymentSelection();
      }
    );
  },

  buildFormFromMarker(marker = {}) {
    const form = createEmptyForm();
    form.name = marker.name || "";
    form.description = marker.description || "";
    form.phone = marker.phone || "";
    form.locationText = marker.locationText || "";
    form.locationLatitude = marker.latitude ?? null;
    form.locationLongitude = marker.longitude ?? null;
    form.images = Array.isArray(marker.images)
      ? marker.images.map((img) => ({
        fileName: img.fileName || "",
        url: img.url || "",
        id: img.id
      }))
      : [];
    form.businessLicense = marker.businessLicense
      ? {
        fileName: marker.businessLicense.fileName || "",
        url: marker.businessLicense.url || ""
      }
      : null;
    form.industryHonorTags = Array.isArray(marker.industryHonorTags)
      ? marker.industryHonorTags.slice()
      : [];
    form.attachmentFiles = Array.isArray(marker.attachments)
      ? marker.attachments.slice(0, ATTACHMENT_MAX_COUNT).map((item) => ({
        fileName: item.fileName || "",
        url: item.url || "",
        id: item.id,
        label: ATTACHMENT_FIXED_LABEL
      }))
      : [];
    form.qrCodeImages = Array.isArray(marker.qrCodes)
      ? marker.qrCodes.map((item) => ({
        fileName: item.fileName || "",
        url: item.url || "",
        id: item.id
      }))
      : [];
    form.videoChannelId = marker.videoChannelId || "";
    form.videoId = marker.videoId || "";
    form.adminInfo = {
      name: marker.adminInfo?.name || "",
      title: marker.adminInfo?.title || "",
      phone: marker.adminInfo?.phone || ""
    };
    return form;
  },

  onCloseCreate() {
    if (this.data.creationSubmitting) return;
    const shouldRefreshAfterClose = this.shouldRefreshMarkersAfterClose();
    if (this.shouldShowDraftExitPrompt()) {
      this.showDraftExitPrompt();
      return;
    }
    if (this.data.createStep === 0 || this.data.createStep === 3) {
      this.exitCreateFlow();
      if (shouldRefreshAfterClose) {
        this.refreshMarkers({ silent: true });
      }
      return;
    }
    wx.showModal({
      title: "退出创建",
      content: "确认退出标记创建流程？未保存内容将丢失。",
      cancelText: "继续编辑",
      confirmText: "退出",
      success: (res) => {
        if (res.confirm) {
          this.exitCreateFlow();
        }
      }
    });
  },

  shouldShowDraftExitPrompt() {
    if (!this.data.showCreate) return false;
    if (!this.data.showPaymentSection) return false;
    if (this.data.createStep === 3) return false;
    return true;
  },

  shouldRefreshMarkersAfterClose() {
    const result = this.data.creationResult;
    if (!result || result.status !== "success") {
      return false;
    }
    const marker = result.marker || {};
    if (!marker.id) {
      return false;
    }
    return !!marker.paid;
  },

  showDraftExitPrompt() {
    const nameFilled = !!(this.data.form?.name && this.data.form.name.trim());
    if (!nameFilled) {
      wx.showModal({
        title: "确认退出",
        content: "未填写名称，关闭后内容将丢失，确认退出？",
        cancelText: "继续编辑",
        confirmText: "退出",
        success: (res) => {
          if (res.confirm) {
            this.exitCreateFlow();
          }
        }
      });
      return;
    }
    wx.showModal({
      title: "保存草稿",
      content: "地图可预览(仅自己可见)\r\n可随时继续提交",
      cancelText: "继续编辑",
      confirmText: "保存草稿",
      success: (res) => {
        if (res.confirm) {
          this.saveDraftAndExit();
        }
      }
    });
  },

  saveDraftAndExit() {
    if (this.data.creationSubmitting) return;
    const previousMethod =
      this.data.selectedPaymentMethod && this.data.selectedPaymentMethod !== DRAFT_PAYMENT_METHOD
        ? this.data.selectedPaymentMethod
        : PAYMENT_METHODS[0].id;
    this.setData({ selectedPaymentMethod: DRAFT_PAYMENT_METHOD }, () => {
      this.submitMarker({ skipResultPage: true, draft: true }).then((result = {}) => {
        if (result.success) {
          wx.showToast({ title: "草稿已保存", icon: "success" });
          this.exitCreateFlow();
        } else if (previousMethod !== DRAFT_PAYMENT_METHOD) {
          this.setData({ selectedPaymentMethod: previousMethod });
        }
      });
    });
  },

  exitCreateFlow() {
    this.setData({
      showCreate: false,
      creationResult: null,
      maxStepReached: 0,
      editingMarkerId: "",
      submitButtonText: "提交审核",
      createStep: 0,
      showPaymentSection: true,
      selectedPaymentMethod: PAYMENT_METHODS[0].id,
      resultStepsLocked: false
    });
  },

  onFormInput(e) {
    const field = e?.currentTarget?.dataset?.field;
    const group = e?.currentTarget?.dataset?.group;
    const value = e?.detail?.value ?? "";
    if (!field) return;
    if (group) {
      const path = `form.${group}.${field}`;
      this.setData({ [path]: value });
    } else {
      const path = `form.${field}`;
      this.setData({ [path]: value });
    }
  },

  onTagInput(e) {
    this.setData({ tagInput: e?.detail?.value || "" });
  },

  onTagConfirm() {
    const text = (this.data.tagInput || "").trim();
    if (!text) return;
    const existing = this.data.form.industryHonorTags || [];
    if (existing.length >= INDUSTRY_HONOR_TAG_LIMIT) {
      wx.showToast({
        title: `最多添加${INDUSTRY_HONOR_TAG_LIMIT}个标签`,
        icon: "none"
      });
      return;
    }
    if (existing.includes(text)) {
      wx.showToast({ title: "标签已存在", icon: "none" });
      return;
    }
    const updated = existing.concat(text);
    this.setData({
      "form.industryHonorTags": updated,
      tagInput: ""
    });
  },

  onRemoveTag(e) {
    const index = e?.currentTarget?.dataset?.index;
    if (index === undefined) return;
    const tags = this.data.form.industryHonorTags.slice();
    tags.splice(index, 1);
    this.setData({ "form.industryHonorTags": tags });
  },

  onChooseLocation() {
    if (typeof wx.navigateTo !== "function") {
      wx.showToast({ title: "当前版本不支持选择位置", icon: "none" });
      return;
    }
    const form = this.data.form || {};
    const payload = {
      latitude: form.locationLatitude,
      longitude: form.locationLongitude,
      address: form.locationText
    };
    wx.navigateTo({
      url: "/pages/markers/location-picker/index",
      events: {
        locationPicked: (detail) => {
          if (!detail) return;
          this.setData({
            "form.locationText": detail.displayAddress || detail.address || "",
            "form.locationLatitude": detail.latitude,
            "form.locationLongitude": detail.longitude
          });
        }
      },
      success: (res) => {
        const channel = res?.eventChannel;
        if (channel && typeof channel.emit === "function") {
          channel.emit("initLocation", payload);
        }
      }
    });
  },

  onAddMediaTap(e) {
    const type = e?.currentTarget?.dataset?.type;
    if (!type) return;
    let count = 9;
    if (type === "images") {
      count = Math.max(0, 9 - this.data.form.images.length);
      if (count <= 0) {
        wx.showToast({ title: "最多上传9张图片", icon: "none" });
        return;
      }
    }
    if (type === "businessLicense" && this.data.form.businessLicense) {
      wx.showToast({ title: "仅支持上传一张营业执照", icon: "none" });
      return;
    }
    if (type === "businessLicense") {
      count = 1;
    }
    if (type === "qrCodeImages") {
      const currentCount = Array.isArray(this.data.form.qrCodeImages)
        ? this.data.form.qrCodeImages.length
        : 0;
      count = Math.max(0, QR_CODE_MAX_COUNT - currentCount);
      if (count <= 0) {
        wx.showToast({ title: `最多上传${QR_CODE_MAX_COUNT}张二维码`, icon: "none" });
        return;
      }
    }
    if (type === "attachments") {
      const currentCount = Array.isArray(this.data.form.attachmentFiles)
        ? this.data.form.attachmentFiles.length
        : 0;
      if (currentCount >= ATTACHMENT_MAX_COUNT) {
        wx.showToast({ title: "仅支持上传一个附件", icon: "none" });
        return;
      }
      const remainingCount = Math.max(0, ATTACHMENT_MAX_COUNT - currentCount);
      if (remainingCount <= 0) {
        wx.showToast({ title: "仅支持上传一个附件", icon: "none" });
        return;
      }
      const handleSuccess = (res) => {
        const files = Array.isArray(res?.tempFiles) ? res.tempFiles : [];
        let paths = files.map((file) => file.path || file.tempFilePath).filter(Boolean);
        let labels = files.map(() => ATTACHMENT_FIXED_LABEL);
        if (!paths.length) {
          const fallbackPaths = Array.isArray(res?.tempFilePaths)
            ? res.tempFilePaths.filter(Boolean)
            : [];
          if (!fallbackPaths.length) return;
          paths = fallbackPaths;
          labels = fallbackPaths.map(() => ATTACHMENT_FIXED_LABEL);
        }
        this.uploadFiles(type, paths, labels);
      };

      if (typeof wx.chooseFile === "function") {
        wx.chooseFile({
          count: remainingCount,
          success: handleSuccess
        });
        return;
      }

      if (typeof wx.chooseMessageFile === "function") {
        wx.chooseMessageFile({
          count: remainingCount,
          type: "all",
          success: handleSuccess
        });
        return;
      }

      wx.showToast({ title: "当前版本不支持附件上传", icon: "none" });
      return;
    }
    if (typeof wx.chooseImage !== "function") {
      wx.showToast({ title: "当前版本不支持图片选择", icon: "none" });
      return;
    }
    wx.chooseImage({
      count,
      sizeType: ["compressed"],
      success: (res) => {
        const paths = res?.tempFilePaths || [];
        if (!paths.length) return;
        this.uploadFiles(type, paths);
      }
    });
  },

  uploadFiles(type, tempPaths, labels = []) {
    if (!Array.isArray(tempPaths) || !tempPaths.length) return;
    wx.showLoading({ title: "上传中...", mask: true });
    const uploads = tempPaths.map((path) => uploadMarkerFile(path, { apiBase: this.apiBase }));
    Promise.all(uploads)
      .then((fileNames) => {
        const mapped = fileNames.map((fileName, index) => ({
          fileName,
          url: buildFileDownloadUrl(fileName, { apiBase: this.apiBase }),
          label: labels[index] || ""
        }));
        if (type === "images") {
          this.setData({ "form.images": this.data.form.images.concat(mapped) });
        } else if (type === "pinImages") {
          const current = Array.isArray(this.data.myPinForm.images) ? this.data.myPinForm.images : [];
          const next = current.concat(mapped).slice(0, PIN_MEDIA_MAX_COUNT);
          this.setData({ "myPinForm.images": next });
        } else if (type === "businessLicense") {
          this.setData({ "form.businessLicense": mapped[0] || null });
        } else if (type === "qrCodeImages") {
          const current = Array.isArray(this.data.form.qrCodeImages)
            ? this.data.form.qrCodeImages.slice()
            : [];
          const availableSlots = Math.max(0, QR_CODE_MAX_COUNT - current.length);
          if (!availableSlots) {
            wx.showToast({ title: `最多上传${QR_CODE_MAX_COUNT}张二维码`, icon: "none" });
            return;
          }
          const additions = mapped.slice(0, availableSlots);
          if (!additions.length) {
            return;
          }
          this.setData({ "form.qrCodeImages": current.concat(additions) });
        } else if (type === "attachments") {
          const current = Array.isArray(this.data.form.attachmentFiles)
            ? this.data.form.attachmentFiles.slice()
            : [];
          const availableSlots = Math.max(0, ATTACHMENT_MAX_COUNT - current.length);
          if (!availableSlots) {
            wx.showToast({ title: "仅支持上传一个附件", icon: "none" });
            return;
          }
          const additions = mapped
            .slice(0, availableSlots)
            .map((item) => Object.assign({}, item, { label: ATTACHMENT_FIXED_LABEL }));
          if (!additions.length) {
            return;
          }
          this.setData({
            "form.attachmentFiles": current.concat(additions)
          });
        }
      })
      .catch((err) => {
        console.error("上传文件失败", err);
        const msg = err?.message || "上传失败";
        wx.showToast({ title: msg, icon: "none" });
      })
      .finally(() => {
        wx.hideLoading();
      });
  },

  onRemoveMediaTap(e) {
    const type = e?.currentTarget?.dataset?.type;
    if (!type) return;
    if (type === "businessLicense") {
      this.setData({ "form.businessLicense": null });
      return;
    }
    const index = e?.currentTarget?.dataset?.index;
    if (index === undefined) return;
    if (type === "images") {
      const list = this.data.form.images.slice();
      list.splice(index, 1);
      this.setData({ "form.images": list });
    } else if (type === "qrCodeImages") {
      const list = this.data.form.qrCodeImages.slice();
      list.splice(index, 1);
      this.setData({ "form.qrCodeImages": list });
    } else if (type === "attachments") {
      const list = this.data.form.attachmentFiles.slice();
      list.splice(index, 1);
      this.setData({ "form.attachmentFiles": list });
    }
  },

  goToNextStep() {
    const step = this.data.createStep;
    if (step === 0 && !this.validateBasicStep()) return;
    if (step === 1 && !this.validateMediaStep()) return;
    const next = Math.min(step + 1, 3);
    const updatedMax = Math.max(this.data.maxStepReached, next);
    this.setData({ createStep: next, maxStepReached: updatedMax });
  },

  goToPrevStep() {
    const step = this.data.createStep;
    const prev = Math.max(step - 1, 0);
    this.setData({ createStep: prev });
  },

  onStepIndicatorTap(e) {
    const target = Number(e?.currentTarget?.dataset?.step);
    if (!Number.isFinite(target)) return;
    if (this.data.creationSubmitting) return;
    if (this.data.resultStepsLocked && target < 3) {
      wx.showToast({ title: "提交后无法返回", icon: "none" });
      return;
    }
    if (target === 3 && this.data.maxStepReached < 3) {
      wx.showToast({ title: "请先提交审核", icon: "none" });
      return;
    }
    const current = this.data.createStep;
    if (target === current) return;

    const highestReached = Math.max(this.data.maxStepReached, current);
    if (target > highestReached) {
      let probe = current;
      while (probe < target) {
        if (probe === 0 && !this.validateBasicStep()) {
          return;
        }
        if (probe === 1 && !this.validateMediaStep()) {
          return;
        }
        if (probe === 2 && !this.validateAdminStep()) {
          return;
        }
        probe += 1;
      }
      this.setData({
        createStep: target,
        maxStepReached: Math.max(this.data.maxStepReached, target)
      });
      return;
    }

    this.setData({ createStep: target });
  },

  validateBasicStep() {
    const form = this.data.form;
    if (!form.images.length) {
      wx.showToast({ title: "请上传图片", icon: "none" });
      return false;
    }
    if (!form.name.trim()) {
      wx.showToast({ title: "请填写标记名称", icon: "none" });
      return false;
    }
    if (!form.description.trim()) {
      wx.showToast({ title: "请填写标记简介", icon: "none" });
      return false;
    }
    if (!form.phone.trim()) {
      wx.showToast({ title: "请填写联系电话", icon: "none" });
      return false;
    }
    if (!form.locationText || form.locationLatitude === null || form.locationLongitude === null) {
      wx.showToast({ title: "请选择标记位置", icon: "none" });
      return false;
    }
    return true;
  },

  validateMediaStep() {
    const form = this.data.form;
    if (!form.businessLicense) {
      wx.showToast({ title: "请上传营业执照", icon: "none" });
      return false;
    }
    return true;
  },

  validateAdminStep() {
    const admin = this.data.form.adminInfo || {};
    if (!admin.name || !admin.name.trim()) {
      wx.showToast({ title: "请填写管理员姓名", icon: "none" });
      return false;
    }
    if (!admin.title || !admin.title.trim()) {
      wx.showToast({ title: "请填写管理员职位", icon: "none" });
      return false;
    }
    if (!admin.phone || !admin.phone.trim()) {
      wx.showToast({ title: "请填写管理员联系电话", icon: "none" });
      return false;
    }
    return true;
  },

  submitMarker(eventOrOptions) {
    const isEventArgument =
      eventOrOptions &&
      typeof eventOrOptions === "object" &&
      typeof eventOrOptions.type === "string";
    const options = isEventArgument ? {} : eventOrOptions || {};
    const skipResultPage = !!options.skipResultPage;
    const isDraftRequest = !!options.draft;
    if (this.data.creationSubmitting) {
      return Promise.resolve({ success: false, reason: "submitting" });
    }
    if (
      !isDraftRequest &&
      (!this.validateBasicStep() || !this.validateMediaStep() || !this.validateAdminStep())
    ) {
      return Promise.resolve({ success: false, reason: "validation" });
    }
    this.setData({ creationSubmitting: true, creationError: "" });
    const payload = this.buildMarkerPayload({ draft: isDraftRequest });
    const editingId = this.data.editingMarkerId;
    const requestOptions = { apiBase: this.apiBase };
    if (isDraftRequest) {
      requestOptions.query = { draft: true };
    }
    const request = editingId
      ? updateMarker(editingId, payload, requestOptions)
      : createMarker(payload, requestOptions);
    return request
      .then((marker) => {
        const normalized = this.normalizeMarker(marker);
        const finalizeSuccess = () => {
          this.applySubmittedMarkerToList(normalized, editingId);
          if (skipResultPage) {
            return { success: true, marker: normalized };
          }
          const resultTitle = editingId ? "更新成功" : "提交成功";
          const resultMessage = editingId ? "标记信息已更新。" : "提交成功，请等待审核。";
          const toastTitle = editingId ? "已保存" : "提交成功";
          this.setData({
            creationResult: {
              status: "success",
              marker: normalized,
              message: resultMessage,
              title: resultTitle
            },
            createStep: 3,
            maxStepReached: 3,
            creationError: "",
            editingMarkerId: "",
            resultStepsLocked: true
          });
          wx.showToast({ title: toastTitle, icon: "success" });
          return { success: true, marker: normalized };
        };

        if (this.shouldUseWechatPayment()) {
          return this.handleWechatPaymentFlow(marker, normalized)
            .then((status) => {
              if (status && status.paid) {
                normalized.paid = true;
                normalized.paidLabel = "已完成支付";
              }
              return finalizeSuccess();
            })
            .catch((err) =>
              this.handlePaymentFailureAfterCreation(err, { marker, normalized, editingId })
            );
        }

        if (this.shouldUseFlpPayment()) {
          return this.handleFlpPaymentFlow(marker, normalized)
            .then(() => {
              normalized.paid = true;
              normalized.paidLabel = "已完成支付";
              return finalizeSuccess();
            })
            .catch((err) =>
              this.handlePaymentFailureAfterCreation(err, { marker, normalized, editingId })
            );
        }

        return finalizeSuccess();
      })
      .catch((err) => {
        console.error(editingId ? "更新标记失败" : "创建标记失败", err);
        if (err?.skipGeneralErrorHandling) {
          return { success: false, error: err };
        }
        const fallback = editingId ? "更新失败，请稍后重试" : "创建失败，请稍后重试";
        const message = err?.displayMessage || err?.message || fallback;
        this.setData({ creationError: message });
        wx.showToast({ title: message, icon: "none" });
        return { success: false, error: err };
      })
      .finally(() => {
        this.setData({ creationSubmitting: false });
        console.log("xxxx")
      });
  },

  applySubmittedMarkerToList(normalized, editingId) {
    if (!normalized) return;
    if (editingId) {
      const updated = this.data.markers.map((item) =>
        item.id === normalized.id ? normalized : item
      );
      this.setData({ markers: updated });
      this.applyFilters(updated, this.data.filterStatus);
      if (this.data.showDetail && this.data.activeMarker?.id === normalized.id) {
        this.setData({ activeMarker: normalized });
      }
    } else {
      this.refreshMarkers({ silent: true });
    }
  },

  buildMarkerPayload(options = {}) {
    const form = this.data.form;
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      phone: form.phone.trim(),
      images: form.images.map((item) => item.fileName),
      businessLicense: form.businessLicense?.fileName || "",
      location: {
        text: form.locationText,
        latitude: form.locationLatitude,
        longitude: form.locationLongitude
      }
    };
    if (form.industryHonorTags?.length) {
      payload.industryHonorTags = form.industryHonorTags;
    }
    if (form.attachmentFiles?.length) {
      payload.attachmentUrls = form.attachmentFiles.map((item) => item.fileName);
    }
    if (form.qrCodeImages?.length) {
      payload.qrCodeUrls = form.qrCodeImages.map((item) => item.fileName);
    }
    if (form.videoChannelId && form.videoChannelId.trim()) {
      payload.videoChannelId = form.videoChannelId.trim();
    }
    if (form.videoId && form.videoId.trim()) {
      payload.videoId = form.videoId.trim();
    }
    if (form.adminInfo && (form.adminInfo.name || form.adminInfo.title || form.adminInfo.phone)) {
      payload.adminInfo = {
        name: (form.adminInfo.name || "").trim(),
        title: (form.adminInfo.title || "").trim(),
        phone: (form.adminInfo.phone || "").trim()
      };
    }
    if (this.data.showPaymentSection && this.data.selectedPaymentMethod) {
      payload.paymentMethod = this.data.selectedPaymentMethod;
    }
    return payload;
  },

  onSelectPaymentMethod(e) {
    if (!this.data.showPaymentSection) return;
    const method = e?.currentTarget?.dataset?.method || e?.detail?.value;
    if (!method) return;
    if (method === "FLP" && this.data.flpPaymentDisabled) {
      wx.showToast({ title: "FLP余额不足", icon: "none" });
      return;
    }
    this.setData({ selectedPaymentMethod: method });
  },

  shouldUseWechatPayment() {
    return (
      !!this.data.showPaymentSection && this.data.selectedPaymentMethod === WECHAT_PAYMENT_METHOD
    );
  },

  shouldUseFlpPayment() {
    return (
      !!this.data.showPaymentSection &&
      this.data.selectedPaymentMethod === "FLP" &&
      !this.data.flpPaymentDisabled
    );
  },

  isPaymentAbortError(err) {
    if (!err) return false;
    if (err.isPaymentCancelled || err.isPaymentAborted) {
      return true;
    }
    const text = `${err.displayMessage || err.message || ""}`.toLowerCase();
    return text.includes("cancel");
  },

  rollbackMarkerAfterPaymentFailure(markerId) {
    if (!markerId) return Promise.resolve();
    return deleteMarker(markerId, { apiBase: this.apiBase }).catch((cleanupErr) => {
      console.warn("Failed to rollback marker after payment failure", cleanupErr);
    });
  },

  handlePaymentFailureAfterCreation(err, context = {}) {
    const editingId = context.editingId || "";
    const markerId = context.marker?.id || context.normalized?.id || "";
    const cleanupPromise = editingId
      ? Promise.resolve()
      : this.rollbackMarkerAfterPaymentFailure(markerId);
    const shouldRewind = this.isPaymentAbortError(err);
    return cleanupPromise.then(() => {
      const patch = { resultStepsLocked: false, creationResult: null };
      if (shouldRewind) {
        patch.creationError = "";
      }
      this.setData(patch);
      if (shouldRewind) {
        const toastMessage = err?.displayMessage || err?.message || "支付已取消";
        wx.showToast({ title: toastMessage, icon: "none" });
        err.skipGeneralErrorHandling = true;
      }
      throw err;
    });
  },

  handleWechatPaymentFlow(marker = {}, normalizedMarker = {}) {
    const markerId = marker.id || normalizedMarker.id;
    if (!markerId) {
      const error = new Error("缺少标记标识，无法发起微信支付");
      error.displayMessage = "缺少标记标识，无法发起微信支付";
      return Promise.reject(error);
    }

    const amountRaw = this.data.settlementConfig?.wechatNetPrice;
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      const error = new Error("微信支付金额配置无效，请联系管理员");
      error.displayMessage = "微信支付金额配置无效，请联系管理员";
      return Promise.reject(error);
    }

    const featureCode = ensureFeatureCode(
      normalizedMarker.featureCode || marker.featureCode || ""
    );

    const payload = {
      featureCode,
      type: "MARKER",
      referenceId: markerId,
      amount
    };

    if (typeof wx.showLoading === "function") {
      wx.showLoading({ title: "正在发起支付...", mask: true });
    }

    return createWechatPrepayOrder(payload, { apiBase: this.apiBase })
      .then((prepay) => {
        if (!prepay || !prepay.orderId) {
          const error = new Error("预支付响应无效");
          error.displayMessage = "预支付响应无效";
          throw error;
        }
        return this.invokeWechatPayment(prepay).then(() => prepay.orderId);
      })
      .then((orderId) => this.pollWechatPaymentStatus(orderId, { timeoutMs: 10000, intervalMs: 1000 }))
      .finally(() => {
        if (typeof wx.hideLoading === "function") {
          wx.hideLoading();
        }
      });
  },

  handleFlpPaymentFlow(marker = {}, normalizedMarker = {}) {
    const markerId = marker.id || normalizedMarker.id;
    if (!markerId) {
      const error = new Error("缺少标记标识，无法扣除 FLP 余额");
      error.displayMessage = "缺少标记标识，无法扣除 FLP 余额";
      return Promise.reject(error);
    }

    const amountRaw = this.data.settlementConfig?.flpNetPrice;
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      const error = new Error("FLP 支付金额配置无效，请联系管理员");
      error.displayMessage = "FLP 支付金额配置无效，请联系管理员";
      return Promise.reject(error);
    }

    const featureCode = ensureFeatureCode(
      normalizedMarker.featureCode || marker.featureCode || ""
    );

    const payload = {
      featureCode,
      type: "MARKER",
      referenceId: markerId,
      amount,
      reason: this.data.editingMarkerId ? "标记更新支付认证费" : "标记创建支付认证费"
    };

    if (typeof wx.showLoading === "function") {
      wx.showLoading({ title: "正在扣除 FLP...", mask: true });
    }

    return payWithFlp(payload, { apiBase: this.apiBase })
      .then((response) => {
        if (
          response &&
          typeof response.remainingBalance === "number" &&
          Number.isFinite(response.remainingBalance)
        ) {
          this.applyFlpBalanceChange(response.remainingBalance);
        } else {
          this.refreshProfileFromRemote();
        }
        return response;
      })
      .finally(() => {
        if (typeof wx.hideLoading === "function") {
          wx.hideLoading();
        }
      });
  },

  invokeWechatPayment(prepay = {}) {
    return new Promise((resolve, reject) => {
      if (!prepay) {
        const error = new Error("缺少微信支付参数");
        error.displayMessage = "缺少微信支付参数";
        reject(error);
        return;
      }
      if (typeof wx === "undefined" || typeof wx.requestPayment !== "function") {
        const error = new Error("当前环境不支持微信支付");
        error.displayMessage = "当前环境不支持微信支付";
        reject(error);
        return;
      }
      const timeStamp = `${prepay.timeStamp || prepay.timestamp || ""}`;
      const nonceStr = prepay.nonceStr || "";
      const packageValue = prepay.packageValue || prepay.package || "";
      const signType = prepay.signType || "RSA";
      const paySign = prepay.paySign || "";
      if (!timeStamp || !nonceStr || !packageValue || !paySign) {
        const error = new Error("微信支付参数不完整");
        error.displayMessage = "微信支付参数不完整";
        reject(error);
        return;
      }
      wx.requestPayment({
        timeStamp,
        nonceStr,
        package: packageValue,
        signType,
        paySign,
        success: () => {
          resolve();
        },
        fail: (err) => {
          const message = err?.errMsg || "微信支付失败";
          const cancelled = /cancel/i.test(message);
          const normalizedMessage = cancelled ? "已取消微信支付" : message;
          const error = new Error(normalizedMessage);
          error.displayMessage = normalizedMessage;
          if (cancelled) {
            error.isPaymentCancelled = true;
            error.isPaymentAborted = true;
          }
          reject(error);
        }
      });
    });
  },

  pollWechatPaymentStatus(orderId, options = {}) {
    if (!orderId) {
      const error = new Error("缺少支付订单标识");
      error.displayMessage = "缺少支付订单标识";
      return Promise.reject(error);
    }
    const timeoutMs = Math.max(Number(options.timeoutMs) || 0, 0) || 10000;
    const intervalMs = Math.max(Number(options.intervalMs) || 0, 0) || 1000;
    const deadline = Date.now() + timeoutMs;

    const attempt = () => {
      return fetchWechatPaymentStatus(orderId, { apiBase: this.apiBase }).then((status) => {
        if (status?.paid) {
          return status;
        }
        if (Date.now() >= deadline) {
          const error = new Error("支付结果确认超时，请稍后查看支付状态");
          error.displayMessage = "支付结果确认超时，请稍后查看支付状态";
          throw error;
        }
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            attempt().then(resolve).catch(reject);
          }, intervalMs);
        });
      });
    };

    return attempt();
  },

  onDeleteMarkerTap(e) {
    const markerId = e?.currentTarget?.dataset?.id;
    const markerName = (e?.currentTarget?.dataset?.name || "").trim();
    if (!markerId) return;
    const marker = this.findAnyMarkerById(markerId);
    if (!marker) {
      wx.showToast({ title: "未找到标记", icon: "none" });
      return;
    }
    if (this.isModifyActionLocked(marker)) {
      return;
    }
    const confirmName = markerName || (marker.name || "").trim();
    if (!confirmName) {
      wx.showToast({ title: "请先为标记命名再删除", icon: "none" });
      return;
    }
    this.setData({
      deleteDialogVisible: true,
      deleteDialogMarkerId: marker.id,
      deleteDialogMarkerName: confirmName,
      deleteDialogInput: "",
      deleteDialogError: ""
    });
  },

  onDeleteDialogInput(e) {
    const value = e?.detail?.value || "";
    this.setData({ deleteDialogInput: value, deleteDialogError: "" });
  },

  onDeleteDialogCancel() {
    this.hideDeleteDialog();
  },

  onDeleteDialogConfirm() {
    const markerId = this.data.deleteDialogMarkerId;
    const expected = (this.data.deleteDialogMarkerName || "").trim();
    const input = (this.data.deleteDialogInput || "").trim();
    if (!markerId) {
      this.hideDeleteDialog();
      return;
    }
    if (!expected) {
      this.setData({ deleteDialogError: "标记缺少名称，无法确认" });
      return;
    }
    if (input !== expected) {
      this.setData({ deleteDialogError: "输入名称与标记名不匹配" });
      return;
    }
    this.hideDeleteDialog();
    this.performDelete(markerId);
  },

  hideDeleteDialog() {
    this.setData({
      deleteDialogVisible: false,
      deleteDialogInput: "",
      deleteDialogMarkerId: "",
      deleteDialogMarkerName: "",
      deleteDialogError: ""
    });
  },

  performDelete(markerId) {
    if (!markerId) return;
    const isPin = this.data.activeCenterTab === "MY_MARKERS" || !!this.findPinById(markerId);
    if (isPin) {
      this.performDeletePin(markerId);
    } else {
      this.performDeleteMarker(markerId);
    }
  },

  performDeletePin(markerId) {
    if (!markerId) return;
    this.setData({ deletingId: markerId });
    const request = () => deletePinApi(markerId, { apiBase: this.apiBase });
    let retriedWithAuth = false;
    request()
      .catch((err) => {
        if (!retriedWithAuth && err?.message === "missing-token") {
          retriedWithAuth = true;
          return this.ensureAccessToken().then(() => request());
        }
        throw err;
      })
      .then(() => {
        wx.showToast({ title: "已删除", icon: "success" });
        const filterPins = (list = []) => list.filter((item) => item.id !== markerId);
        this.setData({
          pins: filterPins(this.data.pins),
          visiblePins: filterPins(this.data.visiblePins),
          deletingId: ""
        });
        if (this.data.showDetail && this.data.activeMarker?.id === markerId) {
          this.setData({ showDetail: false, activeMarker: null });
        }
      })
      .catch((err) => {
        console.error("删除 Pin 失败", err);
        const message = err?.message || "删除失败，请稍后重试";
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        this.setData({ deletingId: "" });
      });
  },

  performDeleteMarker(markerId) {
    if (!markerId) return;
    this.setData({ deletingId: markerId });
    deleteMarker(markerId, { apiBase: this.apiBase })
      .then(() => {
        wx.showToast({ title: "已删除", icon: "success" });
        const remaining = this.data.markers.filter((item) => item.id !== markerId);
        this.setData({ markers: remaining, deletingId: "" });
        this.applyFilters(remaining, this.data.filterStatus);
        if (this.data.showDetail && this.data.activeMarker?.id === markerId) {
          this.setData({ showDetail: false, activeMarker: null });
        }
      })
      .catch((err) => {
        console.error("删除标记失败", err);
        const message = err?.message || "删除失败，请稍后重试";
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        this.setData({ deletingId: "" });
      });
  }
});
