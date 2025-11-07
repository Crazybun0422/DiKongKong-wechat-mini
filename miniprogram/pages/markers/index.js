const {
  listMarkers,
  createMarker,
  updateMarker,
  deleteMarker,
  uploadMarkerFile,
  buildFileDownloadUrl,
  fetchMapSettlementConfig
} = require("../../utils/markers");
const { resolveApiBase } = require("../../utils/profile");

const STATIC_ASSETS = {
  add: "/assets/add.png",
  exposure: "/assets/exposure.png",
  telephone: "/assets/telephone.png",
  home: "/assets/home.png",
  modify: "/assets/modify.png",
  delete: "/assets/delete.png",
  defaultCover: "/assets/dashboard.png"
};

const STATUS_TABS = [
  { id: "ALL", label: "全部" },
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
  { label: "支付提交" },
  { label: "提交结果" }
];

const PAYMENT_METHODS = [
  { id: "WECHAT", label: "微信支付" },
  { id: "FLP", label: "FLP余额抵扣（余额不足）" },
  { id: "NONE", label: "暂不支付", note: "用于测试效果" }
];

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
    paymentMethods: PAYMENT_METHODS,
    selectedPaymentMethod: PAYMENT_METHODS[0].id,
    settlementConfig: null,
    wechatPriceDisplay: "",
    wechatListPriceDisplay: "",
    flpPriceDisplay: "",
    flpListPriceDisplay: "",
    creationSubmitting: false,
    creationError: "",
    creationResult: null,
    showDetail: false,
    activeMarker: null,
    deletingId: "",
    hasLoaded: false,
    editingMarkerId: "",
    assetPaths: STATIC_ASSETS,
    defaultCoverImage: STATIC_ASSETS.defaultCover,
    submitButtonText: "提交审核",
    showPaymentSection: true
  },

  onLoad() {
    this.apiBase = resolveApiBase();
    this.refreshMarkers({ initial: true });
    this.fetchSettlementConfig();
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
    this.setData({
      settlementConfig: config,
      wechatPriceDisplay: wechatNet,
      wechatListPriceDisplay: wechatList,
      flpPriceDisplay: flpNet,
      flpListPriceDisplay: flpList
    });
  },

  formatPriceValue(value, prefix = "") {
    if (value === undefined || value === null || value === "") return "";
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    const formatted = number.toFixed(2).replace(/\.00$/, "");
    return `${prefix}${formatted}`;
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
    return listMarkers({ page: 0, size: 50 }, { apiBase: this.apiBase })
      .then((page) => {
        const content = Array.isArray(page.content) ? page.content : [];
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

  normalizeMarker(raw = {}) {
    const statusMeta = REVIEW_STATUS_META[raw.reviewStatus] || REVIEW_STATUS_META.PENDING;
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
      ? raw.attachmentUrls.map((item, index) => ({
          fileName: item,
          url: download(item),
          id: `${raw.id || "marker"}-attachment-${index}`
        }))
      : [];
    const createdAtDisplay = this.formatDateTime(raw.createdAt);
    const updatedAtDisplay = this.formatDateTime(raw.updatedAt);
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
      reviewStatus: raw.reviewStatus || "PENDING",
      reviewStatusLabel: statusMeta.label,
      reviewTone: statusMeta.tone,
      paid: !!raw.paid,
      paidLabel: raw.paid ? "已完成支付" : "待支付",
      paymentMethod: raw.paymentMethod || "",
      featureCode: raw.featureCode || "",
      createdAtDisplay,
      updatedAtDisplay,
      exposureCount: Number.isFinite(exposureCount) ? exposureCount : 0,
      phoneCallCount: Number.isFinite(phoneCallCount) ? phoneCallCount : 0,
      coverImage: images.length ? images[0].url : ""
    };
  },

  applyFilters(markers, status) {
    const filter = status || this.data.filterStatus || "ALL";
    const list = Array.isArray(markers) ? markers : this.data.markers;
    const filtered =
      filter === "ALL" ? list : list.filter((marker) => marker.reviewStatus === filter);
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
    this.setData({ showDetail: true, activeMarker: marker });
  },

  onCloseDetail() {
    this.setData({ showDetail: false, activeMarker: null });
  },

  onCreateTap() {
    this.setData({
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
      showPaymentSection: true
    });
  },

  onGoHomeTap() {
    if (typeof wx.switchTab === "function") {
      wx.switchTab({ url: "/pages/map/map" });
      return;
    }
    if (typeof wx.navigateTo === "function") {
      wx.navigateTo({ url: "/pages/map/map" });
    }
  },

  onEditMarkerTap(e) {
    const markerId = e?.currentTarget?.dataset?.id;
    if (!markerId) return;
    const marker = this.data.markers.find((item) => item.id === markerId);
    if (!marker) {
      wx.showToast({ title: "未找到标记", icon: "none" });
      return;
    }
    const form = this.buildFormFromMarker(marker);
    const selectedPaymentMethod = marker.paymentMethod || PAYMENT_METHODS[0].id;
    this.setData({
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
      showPaymentSection: !marker.paid
    });
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
      ? marker.attachments.map((item) => ({
          fileName: item.fileName || "",
          url: item.url || "",
          id: item.id
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
    if (this.data.createStep === 0 || this.data.createStep === 3) {
      this.setData({
        showCreate: false,
        creationResult: null,
        maxStepReached: 0,
        editingMarkerId: "",
        submitButtonText: "提交审核"
      });
      return;
    }
    wx.showModal({
      title: "退出创建",
      content: "确认退出标记创建流程？未保存内容将丢失。",
      cancelText: "继续编辑",
      confirmText: "退出",
      success: (res) => {
        if (res.confirm) {
          this.setData({
            showCreate: false,
            creationResult: null,
            maxStepReached: 0,
            editingMarkerId: "",
            submitButtonText: "提交审核"
          });
        }
      }
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
      count = Math.max(0, 6 - this.data.form.qrCodeImages.length);
      if (count <= 0) {
        wx.showToast({ title: "最多上传6张二维码", icon: "none" });
        return;
      }
    }
    if (type === "attachments") {
      const remainingCount = Math.max(1, 5 - this.data.form.attachmentFiles.length);
      const handleSuccess = (res) => {
        const files = Array.isArray(res?.tempFiles) ? res.tempFiles : [];
        let paths = files.map((file) => file.path || file.tempFilePath).filter(Boolean);
        let labels = files.map((file) => file.name || "附件");
        if (!paths.length) {
          const fallbackPaths = Array.isArray(res?.tempFilePaths)
            ? res.tempFilePaths.filter(Boolean)
            : [];
          if (!fallbackPaths.length) return;
          paths = fallbackPaths;
          labels = fallbackPaths.map(() => "附件");
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
          this.setData({ "form.qrCodeImages": this.data.form.qrCodeImages.concat(mapped) });
        } else if (type === "attachments") {
          this.setData({
            "form.attachmentFiles": this.data.form.attachmentFiles.concat(mapped)
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
    if (!admin.phone || !admin.phone.trim()) {
      wx.showToast({ title: "请填写管理员联系电话", icon: "none" });
      return false;
    }
    return true;
  },

  submitMarker() {
    if (this.data.creationSubmitting) return;
    if (!this.validateBasicStep() || !this.validateMediaStep() || !this.validateAdminStep())
      return;
    this.setData({ creationSubmitting: true, creationError: "" });
    const payload = this.buildMarkerPayload();
    const editingId = this.data.editingMarkerId;
    const request = editingId
      ? updateMarker(editingId, payload, { apiBase: this.apiBase })
      : createMarker(payload, { apiBase: this.apiBase });
    request
      .then((marker) => {
        const normalized = this.normalizeMarker(marker);
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
          editingMarkerId: ""
        });
        wx.showToast({ title: toastTitle, icon: "success" });
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
      })
      .catch((err) => {
        console.error(editingId ? "更新标记失败" : "创建标记失败", err);
        const fallback = editingId ? "更新失败，请稍后重试" : "创建失败，请稍后重试";
        const message = err?.message || fallback;
        this.setData({ creationError: message });
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        this.setData({ creationSubmitting: false });
      });
  },

  buildMarkerPayload() {
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
    this.setData({ selectedPaymentMethod: method });
  },

  onDeleteMarkerTap(e) {
    const markerId = e?.currentTarget?.dataset?.id;
    const markerName = (e?.currentTarget?.dataset?.name || "").trim();
    if (!markerId) return;
    const promptName = markerName || "标记名称";
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
          if (markerName && input !== markerName) {
            wx.showToast({ title: "输入名称不匹配", icon: "none" });
            return;
          }
          if (!markerName && !input) {
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
