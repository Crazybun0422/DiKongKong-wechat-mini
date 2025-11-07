const { normalizeMarkerDetail } = require("../../utils/marker-detail");
const { fetchMarkerDetail } = require("../../utils/markers");

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
        wx.openChannelsActivity({ finderUserName, feedId:activityId });
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
    const phone = event?.currentTarget?.dataset?.phone;
    if (!phone) {
      return;
    }
    if (typeof wx?.makePhoneCall === "function") {
      wx.makePhoneCall({ phoneNumber: phone });
    } else {
      wx.showToast({ title: phone, icon: "none" });
    }
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
