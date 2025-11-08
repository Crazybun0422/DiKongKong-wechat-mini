const { normalizeMarkerDetail } = require("../../utils/marker-detail");
const { fetchMarkerDetail, incrementMarkerPhoneCall } = require("../../utils/markers");

Page({
  data: {
    loading: true,
    error: "",
    detail: null,
    currentImage: 0,
    markerId: "",
    shareEnabled: true,
    pageEntering: true,
    pageClosing: false
  },

  onLoad(options = {}) {
    this._apiBase = this.getApiBase();
    this._markerId = options.markerId ? decodeURIComponent(options.markerId) : "";
    this._pendingFetch = null;
    this._detailResolved = false;
    this._detailTouch = null;
    this._detailScrollTop = 0;
    this._closingDetail = false;
    this._enterTimer = null;
    this._closeTimer = null;
    this.setData({ pageEntering: true, pageClosing: false });
    this.scheduleEnterAnimation();

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
      try {
        this._pendingFetch.abort();
      } catch (err) {
        console.warn("abort pending fetch failed", err);
      }
    }
    this._pendingFetch = null;
    if (this._enterTimer) {
      clearTimeout(this._enterTimer);
      this._enterTimer = null;
    }
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
  },

  getAppInstance() {
    try {
      return typeof getApp === "function" ? getApp() : null;
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

  scheduleEnterAnimation() {
    if (this._enterTimer) {
      clearTimeout(this._enterTimer);
      this._enterTimer = null;
    }
    this._enterTimer = setTimeout(() => {
      this._enterTimer = null;
      this.setData({ pageEntering: false });
    }, 30);
  },

  applyDetail(input) {
    if (!input) {
      this.setData({ loading: false, error: "未找到商户信息", detail: null });
      return;
    }
    const normalized =
      input.images && input.attachments
        ? input
        : normalizeMarkerDetail(input.raw || input, { apiBase: this._apiBase });
    const markerId = normalized.id || this._markerId || "";
    this.ensureDetailLocation(normalized, input.raw || input);
    this._detailResolved = true;
    this._markerId = markerId;
    this._detailScrollTop = 0;
    this.setData({
      detail: normalized,
      loading: false,
      error: "",
      currentImage: 0,
      markerId,
      shareEnabled: this.isDetailSharable(normalized)
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
    const request = fetchMarkerDetail(id, {
      apiBase: this._apiBase,
      token: this.getAuthToken()
    });
    this._pendingFetch = request;
    request
      .then((detail) => {
        if (this._pendingFetch === request) {
          this._pendingFetch = null;
        }
        this.applyDetail(detail);
      })
      .catch((err) => {
        console.warn("fetch marker detail failed", err);
        if (this._pendingFetch === request) {
          this._pendingFetch = null;
        }
        const message = err?.message === "missing-token"
          ? "请先登录后再查看商户详情"
          : "加载商户详情失败，请稍后重试";
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

  onVideoTap(event) {
    const dataset = event?.currentTarget?.dataset || {};
    const url = dataset.url || "";
    const finderUserName = dataset.finder || "";
    const activityId = dataset.activity || "";

    const proceed = () => {
      if (finderUserName && activityId && typeof wx?.openChannelsActivity === "function") {
        wx.openChannelsActivity({
          finderUserName,
          feedId: activityId,
          success: (res) => console.log("open channels activity", res),
          fail: (err) => console.warn("open channels activity fail", err)
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
            success: () => wx.showToast({ title: "链接已复制", icon: "none" }),
            fail: () => wx.showToast({ title: "复制失败", icon: "none" })
          });
        } else {
          wx.showToast({ title: "请复制链接访问", icon: "none" });
        }
        return;
      }
      wx.showToast({ title: "暂无可跳转的视频内容", icon: "none" });
    };

    if (typeof wx?.showModal === "function") {
      wx.showModal({
        title: "打开视频号",
        content: "是否前往查看该商户的视频号内容？",
        confirmText: "前往",
        cancelText: "取消",
        success: (res) => {
          if (res?.confirm) {
            proceed();
          }
        }
      });
      return;
    }

    proceed();
  },

  onCallPhone(event) {
    const dataset = event?.currentTarget?.dataset || {};
    const phone = dataset.phone || this.data.detail?.phone || "";
    const markerId =
      dataset.markerId ||
      this.data.detail?.markerId ||
      this.data.detail?.id ||
      this.data.markerId ||
      "";
    const name = this.data.detail?.name || "";
    this.makePhoneCall(phone, { markerId, name });
  },

  onNavigateTap(event) {
    const detail = this.data.detail;
    if (!detail) return;
    const dataset = event?.currentTarget?.dataset || {};
    this.openMarkerLocation(detail, dataset);
  },

  onDetailScroll(event) {
    const top = Number(event?.detail?.scrollTop);
    this._detailScrollTop = Number.isFinite(top) ? top : 0;
  },

  onDetailTouchStart(event) {
    const touch = event?.touches?.[0];
    if (!touch) return;
    this._detailTouch = {
      startY: touch.clientY,
      lastY: touch.clientY,
      deltaY: 0,
      startTime: Date.now()
    };
  },

  onDetailTouchMove(event) {
    if (!this._detailTouch) return;
    const touch = event?.touches?.[0];
    if (!touch) return;
    const deltaY = touch.clientY - this._detailTouch.startY;
    this._detailTouch.lastY = touch.clientY;
    this._detailTouch.deltaY = deltaY;
  },

  onDetailTouchEnd() {
    const info = this._detailTouch;
    this._detailTouch = null;
    if (!info) return;
    const deltaY = info.deltaY || 0;
    const duration = Date.now() - info.startTime;
    if (
      this._detailScrollTop <= 12 &&
      ((deltaY >= 90 && duration <= 700) || deltaY >= 160)
    ) {
      this.closeDetailPage();
    }
  },

  onDetailTouchCancel() {
    this._detailTouch = null;
  },

  closeDetailPage() {
    if (this._closingDetail) return;
    this._closingDetail = true;
    this.setData({ pageClosing: true });
    const finalize = () => {
      this._closingDetail = false;
      this.setData({ pageClosing: false });
    };
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
    const performNavigate = () => {
      if (typeof wx?.navigateBack === "function") {
        wx.navigateBack({
          delta: 1,
          animationType: "slide-out-bottom",
          animationDuration: 240,
          complete: finalize
        });
        return;
      }
      finalize();
    };
    this._closeTimer = setTimeout(() => {
      this._closeTimer = null;
      performNavigate();
    }, 220);
  },

  onShareDisabledTap() {
    this.showShareBlockedToast();
  },

  onShareAppMessage() {
    const fallback = {
      title: "附近商户",
      path: "/pages/map/map"
    };
    const detail = this.data.detail;
    if (!detail) {
      return fallback;
    }
    if (!this.isDetailSharable(detail)) {
      this.showShareBlockedToast();
      return fallback;
    }
    const markerId = detail.id || detail.markerId || this.data.markerId || "";
    if (!markerId) {
      return fallback;
    }
    return {
      title: detail.name || fallback.title,
      path: `/pages/merchant-detail/index?markerId=${encodeURIComponent(markerId)}`
    };
  },

  openMarkerLocation(detail, overrides = {}) {
    const latitude = Number(overrides.latitude ?? detail?.latitude);
    const longitude = Number(overrides.longitude ?? detail?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      wx.showToast({ title: "缺少位置信息", icon: "none" });
      return;
    }
    const name = overrides.name || detail?.name || "商户位置";
    const address = overrides.address || detail?.locationText || "";
    if (typeof wx?.openLocation === "function") {
      wx.openLocation({ latitude, longitude, name, address });
      return;
    }
    wx.showToast({ title: "当前环境不支持打开位置", icon: "none" });
  },

  makePhoneCall(phone, options = {}) {
    const value = typeof phone === "string" ? phone.trim() : `${phone || ""}`.trim();
    const markerId = options.markerId ? `${options.markerId}`.trim() : "";
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
        success: () => wx.showToast({ title: "号码已复制", icon: "none" })
      });
      return;
    }
    wx.showToast({ title: value, icon: "none" });
  },

  incrementMarkerPhoneCallCount(markerId) {
    if (!markerId) {
      return;
    }
    incrementMarkerPhoneCall(markerId, {
      apiBase: this._apiBase,
      token: this.getAuthToken()
    }).catch((err) => {
      console.warn("increment phone call failed", err);
    });
  },

  isDetailSharable(detail) {
    if (!detail || detail.shareDisabled) {
      return false;
    }
    const status = `${detail.reviewStatus || detail.raw?.reviewStatus || ""}`
      .trim()
      .toUpperCase();
    return status === "APPROVED";
  },

  showShareBlockedToast() {
    if (typeof wx?.showToast === "function") {
      wx.showToast({ title: "未通过审核无法分享", icon: "none" });
    }
  },

  ensureDetailLocation(detail = {}, raw = {}) {
    const pickNumericValue = (...candidates) => {
      for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value)) {
          return value;
        }
      }
      return null;
    };
    if (!Number.isFinite(Number(detail.latitude))) {
      const lat = pickNumericValue(
        detail.latitude,
        raw?.latitude,
        raw?.lat,
        raw?.location?.latitude,
        raw?.location?.lat
      );
      if (Number.isFinite(lat)) {
        detail.latitude = lat;
      }
    }
    if (!Number.isFinite(Number(detail.longitude))) {
      const lng = pickNumericValue(
        detail.longitude,
        raw?.longitude,
        raw?.lng,
        raw?.location?.longitude,
        raw?.location?.lng
      );
      if (Number.isFinite(lng)) {
        detail.longitude = lng;
      }
    }
    if (!detail.locationText) {
      const fallbackLocationText =
        raw?.locationText ||
        raw?.address ||
        raw?.location?.text ||
        "";
      if (fallbackLocationText) {
        detail.locationText = fallbackLocationText;
      }
    }
  }
});

