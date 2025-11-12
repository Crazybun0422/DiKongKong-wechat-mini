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
const { payWithFlp } = require("../../utils/flp");

const STATIC_ASSETS = {
  add: "/assets/add.png",
  exposure: "/assets/exposure.png",
  telephone: "/assets/telephone.png",
  defaultCover: "/assets/no-image.png"
};

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

Page({
  data: {
    loading: false,
    listRefreshing: false,
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
    deletingId: "",
    hasLoaded: false,
    editingMarkerId: "",
    assetPaths: STATIC_ASSETS,
    defaultCoverImage: STATIC_ASSETS.defaultCover,
    submitButtonText: "提交审核",
    showPaymentSection: true,
    resultStepsLocked: false,
    qrCodeMaxCount: QR_CODE_MAX_COUNT
  },

  onLoad(options = {}) {
    this.apiBase = resolveApiBase();
    this.initializeProfileInfo();
    this.ensureAccessToken()
      .catch((err) => {
        console.warn("ensureAccessToken failed before loading markers", err);
      })
      .finally(() => {
        this.refreshMarkers({ initial: true });
      });
    this.fetchSettlementConfig();
    if (options.create === "1") {
      this.onCreateTap();
    }
  },

  onShow() {
    if (this.data.hasLoaded || this.data.loading) {
      return;
    }
    this.ensureAccessToken()
      .catch((err) => {
        console.warn("ensureAccessToken failed on show", err);
      })
      .finally(() => {
        this.refreshMarkers({ initial: true });
      });
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
          flpValue: normalized.flpValue
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
    this.updateFlpPaymentState(balance);
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

  onPullDownRefresh() {
    this.refreshMarkers({ silent: true }).finally(() => {
      if (typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
    });
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

  showMarkerDetail(marker) {
    if (!marker) return;
    this.setData({ showDetail: true, activeMarker: marker });
  },

  showMarkerActionSheet(marker) {
    if (!marker) return;
    this.setData({
      actionSheetVisible: true,
      actionSheetMarker: marker,
      actionSheetDisableModify: this.isModifyActionLocked(marker)
    });
  },

  hideMarkerActionSheet() {
    this.setData({
      actionSheetVisible: false,
      actionSheetMarker: null,
      actionSheetDisableModify: false
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

  noop() { },

  onCloseDetail() {
    this.setData({ showDetail: false, activeMarker: null });
  },

  onCreateTap() {
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
    const marker = this.data.markers.find((item) => item.id === markerId);
    if (!marker) {
      wx.showToast({ title: "未找到标记", icon: "none" });
      return;
    }
    if (this.isModifyActionLocked(marker)) {
      wx.showToast({ title: "审核中暂不可编辑", icon: "none" });
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
    const marker = this.data.markers.find((item) => item.id === markerId);
    if (!marker) {
      wx.showToast({ title: "未找到标记", icon: "none" });
      return;
    }
    if (this.isModifyActionLocked(marker)) {
      wx.showToast({ title: "审核中暂不可删除", icon: "none" });
      return;
    }
    const confirmName = markerName || (marker.name || "").trim();
    const promptName = confirmName || "标记名称";
    wx.showModal({
      title: "删除标记",
      content: `请输入“${promptName}”确认删除。`,
      editable: true,
      placeholderText: promptName,
      confirmText: "删除",
      confirmColor: "#ff3b30",
      success: (res) => {
        if (res.confirm) {
          const input = (res.content || "").trim();
          if (confirmName && input !== confirmName) {
            wx.showToast({ title: "输入名称不匹配", icon: "none" });
            return;
          }
          if (!confirmName && !input) {
            wx.showToast({ title: "请输入确认名称", icon: "none" });
            return;
          }
          this.performDelete(markerId);
        }
      }
    });
  },

  performDelete(markerId) {
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
