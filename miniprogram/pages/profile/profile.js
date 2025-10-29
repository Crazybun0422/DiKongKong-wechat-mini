const {
  DEFAULT_AVATAR_PATH,
  fetchUserProfile,
  normalizeProfileData,
  loadStoredProfile,
  persistProfileLocally,
  resolveApiBase
} = require("../../utils/profile");

Page({
  data: {
    loading: true,
    error: "",
    profile: null,
    defaultAvatar: DEFAULT_AVATAR_PATH,
    activeTab: "profile"
  },

  onLoad() {
    this._storedProfileCache = loadStoredProfile() || {};
    const normalized = normalizeProfileData(this._storedProfileCache, {
      storedProfile: this._storedProfileCache,
      apiBase: resolveApiBase()
    });
    this.setData({
      profile: normalized,
      loading: true,
      error: ""
    });
    this.reloadProfile();
  },

  onShow() {
    if (this.data.activeTab !== "profile") {
      this.setData({ activeTab: "profile" });
    }
  },

  onPullDownRefresh() {
    this.reloadProfile({ fromPullDown: true });
  },

  reloadProfile(options = {}) {
    const { fromPullDown = false } = options;
    if (!fromPullDown) {
      this.setData({ loading: true, error: "" });
    } else {
      this.setData({ error: "" });
    }
    fetchUserProfile()
      .then((remoteProfile) => {
        const normalized = normalizeProfileData(remoteProfile, {
          storedProfile: this._storedProfileCache,
          apiBase: resolveApiBase()
        });
        this._storedProfileCache = persistProfileLocally({
          nickname: normalized.nickname,
          avatarUrl: normalized.avatarFileName || normalized.avatarUrl,
          featureCode: normalized.featureCode,
          flpValue: normalized.flpValue
        });
        this.setData({
          profile: normalized,
          loading: false,
          error: ""
        });
      })
      .catch((err) => {
        const message = err?.message || "加载失败，请稍后重试";
        let display = message;
        if (message === "missing-token") {
          display = "未登录，暂时无法获取个人资料";
        }
        this.setData({ error: display, loading: false });
      })
      .finally(() => {
        if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh();
        }
      });
  },

  onRetryTap() {
    this.reloadProfile();
  },

  onCopyFeatureCode() {
    const code = this.data.profile?.featureCode || "";
    if (!code) {
      wx.showToast({ title: "暂无可复制的低空号", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: code,
      success: () => {
        wx.showToast({ title: "已复制", icon: "success" });
      },
      fail: () => {
        wx.showToast({ title: "复制失败", icon: "none" });
      }
    });
  },

  onEditProfileTap() {
    wx.showToast({ title: "头像昵称编辑即将开放", icon: "none" });
  },

  onFlpCardTap() {
    wx.showToast({ title: "敬请期待", icon: "none" });
  },

  onListItemTap(e) {
    const action = e.currentTarget?.dataset?.action;
    if (action === "customer-service") {
      wx.showToast({ title: "客服功能即将开放", icon: "none" });
      return;
    }
    if (action === "markers") {
      wx.showToast({ title: "标记功能开发中", icon: "none" });
      return;
    }
    wx.showToast({ title: "敬请期待", icon: "none" });
  },

  onChatButtonTap() {
    wx.showToast({ title: "聊天功能开发中", icon: "none" });
  },

  onMenuHomeTap() {
    if (this.data.activeTab !== "home") {
      this.setData({ activeTab: "home" });
    }
    if (typeof wx.navigateBack === "function") {
      wx.navigateBack({ delta: 1 });
    }
  },

  onMenuProfileTap() {
    if (this.data.activeTab !== "profile") {
      this.setData({ activeTab: "profile" });
    }
    wx.showToast({ title: "当前已在我的页面", icon: "none" });
  }
});
