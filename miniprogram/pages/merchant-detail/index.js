const { normalizeMarkerDetail } = require("../../utils/marker-detail");
const { fetchMarkerDetail } = require("../../utils/markers");
const {
  handleAttachmentTap,
  handleVideoTap,
  makePhoneCall
} = require("./actions");

Page({
  data: {
    loading: true,
    error: "",
    detail: null,
    currentImage: 0,
    markerId: ""
  },

  onLoad(options = {}) {
    this._apiBase = this.getApiBase();
    this._markerId = options.markerId ? decodeURIComponent(options.markerId) : "";
    this._pendingFetch = null;
    this._detailResolved = false;

    const eventChannel = this.getOpenerEventChannel ? this.getOpenerEventChannel() : null;
    if (eventChannel && typeof eventChannel.on === "function") {
      eventChannel.on("markerDetail", (payload) => {
        if (payload && !this._detailResolved) {
          this.applyDetail(payload);
        }
      });
    }

    if (this._markerId) {
      this.fetchDetailById(this._markerId);
    } else if (!this._detailResolved) {
      this.setData({ loading: false, error: "未找到商户信息" });
    }
  },

  onUnload() {
    if (this._pendingFetch && typeof this._pendingFetch.abort === "function") {
      this._pendingFetch.abort();
    }
    this._pendingFetch = null;
  },

  getAppInstance() {
    try {
      return getApp ? getApp() : null;
    } catch (err) {
      console.warn("getApp failed", err);
      return null;
    }
  },

  getApiBase() {
    const app = this.getAppInstance();
    return (app && app.globalData && app.globalData.apiBase) || "";
  },

  getAuthToken() {
    const app = this.getAppInstance();
    return (app && app.globalData && app.globalData.token) || "";
  },

  applyDetail(input) {
    if (!input) {
      this.setData({ loading: false, error: "未找到商户信息", detail: null });
      return;
    }
    const normalized = input.images && input.attachments
      ? input
      : normalizeMarkerDetail(input.raw || input, { apiBase: this._apiBase });
    const markerId = normalized.id || this._markerId || "";
    this._detailResolved = true;
    this._markerId = markerId;
    this.setData({
      detail: normalized,
      loading: false,
      error: "",
      currentImage: 0,
      markerId
    });
    if (normalized.name && typeof wx?.setNavigationBarTitle === "function") {
      wx.setNavigationBarTitle({ title: normalized.name });
    }
  },

  fetchDetailById(markerId) {
    const id = markerId || this._markerId;
    if (!id) {
      this.setData({ loading: false, error: "未找到商户信息" });
      return;
    }
    if (this._pendingFetch) {
      return;
    }
    this.setData({ loading: true, error: "" });
    this._pendingFetch = fetchMarkerDetail(id, {
      apiBase: this._apiBase,
      token: this.getAuthToken()
    })
      .then((detail) => {
        this._pendingFetch = null;
        this.applyDetail(detail);
      })
      .catch((err) => {
        console.warn("fetch marker detail failed", err);
        this._pendingFetch = null;
        const message = err?.message === "missing-token" ? "请先登录后再查看商户详情" : "加载商户详情失败，请稍后重试";
        this.setData({ loading: false, error: message, detail: null });
      });
  },

  onRetry() {
    if (this._markerId) {
      this.fetchDetailById(this._markerId);
    }
  },

  onSwiperChange(event) {
    const current = Number(event?.detail?.current);
    if (Number.isFinite(current)) {
      this.setData({ currentImage: current });
    }
  },

  onAttachmentTap(event) {
    handleAttachmentTap(event?.currentTarget?.dataset || {});
  },

  onVideoTap(event) {
    handleVideoTap(event?.currentTarget?.dataset || {});
  },

  onCallPhone(event) {
    makePhoneCall(event?.currentTarget?.dataset?.phone);
  },

  openMarkerLocation(detail, overrides = {}) {
    const latitude = Number(overrides.latitude ?? detail?.latitude);
    const longitude = Number(overrides.longitude ?? detail?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      if (typeof wx?.showToast === "function") {
        wx.showToast({ title: "暂无定位信息", icon: "none" });
      }
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
    if (typeof wx?.showToast === "function") {
      wx.showToast({ title: "当前环境不支持导航", icon: "none" });
    }
  },

  onNavigateTap(event) {
    const detail = this.data.detail;
    if (!detail) return;
    const dataset = event?.currentTarget?.dataset || {};
    this.openMarkerLocation(detail, dataset);
  },

  onShareAppMessage() {
    const detail = this.data.detail;
    if (detail) {
      return {
        title: detail.name || "附近商户",
        path: `/pages/merchant-detail/index?markerId=${encodeURIComponent(detail.id || "")}`
      };
    }
    return {
      title: "附近商户",
      path: "/pages/map/map"
    };
  }
});
