const {
  DEFAULT_AVATAR_PATH,
  fetchUserProfile,
  normalizeProfileData,
  loadStoredProfile,
  persistProfileLocally,
  resolveApiBase,
  prepareAvatarForUpload,
  uploadAvatarFile,
  updateUserProfile
} = require("../../utils/profile");

Page({
  data: {
    loading: true,
    error: "",
    profile: null,
    defaultAvatar: DEFAULT_AVATAR_PATH,
    activeTab: "profile",
    customerServiceSessionFrom: "profile-customer-service",
    nicknameEditing: false,
    nicknameInput: "",
    nicknameSaving: false
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
      error: "",
      customerServiceSessionFrom: this.composeCustomerServiceSessionFrom(normalized),
      nicknameInput: normalized.nickname
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
        console.log("remoteProfile:", remoteProfile);
        this._storedProfileCache = persistProfileLocally({
          nickname: normalized.nickname,
          avatarUrl: normalized.avatarFileName || normalized.avatarUrl,
          featureCode: normalized.featureCode,
          flpValue: normalized.flpValue
        });
        this.setData({
          profile: normalized,
          loading: false,
          error: "",
          customerServiceSessionFrom: this.composeCustomerServiceSessionFrom(normalized),
          nicknameInput: this.data.nicknameEditing ? this.data.nicknameInput : normalized.nickname
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
    // legacy fallback: still allow manual navigate if needed in future
    this.startNicknameEdit();
  },

  onChooseAvatar(e) {
    const avatarUrl = e?.detail?.avatarUrl;
    if (!avatarUrl) return;
    this.handleAvatarSelection(avatarUrl);
  },

  handleAvatarSelection(tempPath) {
    if (!tempPath) return;
    const showLoading = typeof wx.showLoading === "function";
    const hideLoading = typeof wx.hideLoading === "function" ? () => wx.hideLoading() : () => { };
    if (showLoading) wx.showLoading({ title: "上传中...", mask: true });
    const apiBase = resolveApiBase();
    prepareAvatarForUpload(tempPath)
      .then((filePath) => uploadAvatarFile(filePath, { apiBase }))
      .then((fileName) =>
        updateUserProfile({ avatarUrl: fileName }, { apiBase })
          .then((remote) => ({ remote, fileName }))
          .catch((err) => {
            const wrapped = err || new Error("update-avatar-failed");
            wrapped._uploadedFileName = fileName;
            throw wrapped;
          })
      )
      .then(({ remote, fileName }) => {
        hideLoading();
        this.handleProfileUpdateResult(remote, { avatarFileName: fileName });
        wx.showToast({ title: "头像已更新", icon: "success" });
      })
      .catch((err) => {
        hideLoading();
        if (err && err.errMsg && err.errMsg.includes("cancel")) {
          return;
        }
        if (err && err.message === "missing-token") {
          wx.showToast({ title: "请先登录后再试", icon: "none" });
          return;
        }
        console.warn("更新头像失败", err);
        wx.showToast({ title: "更新失败，请稍后重试", icon: "none" });
      });
  },

  startNicknameEdit() {
    if (this.data.nicknameSaving) return;
    const nickname = this.data.profile?.nickname || "";
    this.setData({
      nicknameEditing: true,
      nicknameInput: nickname
    });
  },

  onNicknameInputChange(e) {
    this.setData({ nicknameInput: e?.detail?.value || "" });
  },

  onNicknameInputConfirm(e) {
    const value = e?.detail?.value ?? this.data.nicknameInput;
    this.saveNicknameInline(value);
  },

  onNicknameInputBlur(e) {
    const value = e?.detail?.value ?? this.data.nicknameInput;
    this.saveNicknameInline(value);
  },

  saveNicknameInline(nickname) {
    const trimmed = (nickname || "").trim();
    if (!this.data.nicknameEditing) return;
    if (this.data.nicknameSaving) return;
    const current = this.data.profile?.nickname || "";
    if (!trimmed) {
      wx.showToast({ title: "昵称不能为空", icon: "none" });
      this.setData({
        nicknameEditing: false,
        nicknameInput: current
      });
      return;
    }
    if (trimmed === current) {
      this.setData({
        nicknameEditing: false,
        nicknameInput: current
      });
      return;
    }
    this.setData({ nicknameSaving: true });
    const apiBase = resolveApiBase();
    updateUserProfile({ username: trimmed }, { apiBase })
      .then((remote) => {
        this.handleProfileUpdateResult(remote, { nickname: trimmed });
        wx.showToast({ title: "昵称已更新", icon: "success" });
        this.setData({
          nicknameEditing: false,
          nicknameInput: trimmed
        });
      })
      .catch((err) => {
        console.warn("更新昵称失败", err);
        const message =
          err?.message === "missing-token"
            ? "请先登录后再试"
            : err?.displayMessage || err?.message || "更新失败，请稍后重试";
        wx.showToast({ title: message, icon: "none" });
        this.setData({
          nicknameEditing: false,
          nicknameInput: current
        });
      })
      .finally(() => {
        this.setData({ nicknameSaving: false });
      });
  },

  syncNicknameWithWechat(nickname) {
    const trimmed = (nickname || "").trim();
    if (!trimmed) {
      return Promise.reject(new Error("empty-nickname"));
    }
    const apiBase = resolveApiBase();
    const showLoading = typeof wx.showLoading === "function";
    const hideLoading = typeof wx.hideLoading === "function" ? () => wx.hideLoading() : () => { };
    if (showLoading) wx.showLoading({ title: "同步中...", mask: true });
    return updateUserProfile({ username: trimmed }, { apiBase })
      .then((remote) => {
        hideLoading();
        this.handleProfileUpdateResult(remote, { nickname: trimmed });
        wx.showToast({ title: "昵称已同步", icon: "success" });
        return remote;
      })
      .catch((err) => {
        hideLoading();
        throw err || new Error("nickname-sync-failed");
      });
  },

  handleProfileUpdateResult(rawProfile = {}, fallbackChanges = {}) {
    const current = this.data.profile || {};
    const stored = this._storedProfileCache || {};
    const merged = Object.assign(
      {},
      stored,
      current,
      fallbackChanges,
      rawProfile || {}
    );
    if (!merged.featureCode) {
      merged.featureCode = current.featureCode || stored.featureCode || "";
    }
    if (merged.flpValue === undefined || merged.flpValue === null) {
      const fallbackFlp =
        current.flpValue !== undefined && current.flpValue !== null
          ? current.flpValue
          : stored.flpValue;
      if (fallbackFlp !== undefined) merged.flpValue = fallbackFlp;
    }
    const persisted = persistProfileLocally({
      nickname: merged.nickname || current.nickname || "",
      avatarUrl: merged.avatarFileName || merged.avatarUrl || current.avatarFileName || "",
      featureCode: merged.featureCode,
      flpValue: merged.flpValue
    });
    this._storedProfileCache = persisted;
    const normalized = normalizeProfileData(merged, {
      storedProfile: persisted,
      apiBase: resolveApiBase()
    });
    this.setData({
      profile: normalized,
      customerServiceSessionFrom: this.composeCustomerServiceSessionFrom(normalized),
      nicknameInput: this.data.nicknameEditing ? this.data.nicknameInput : normalized.nickname
    });
    return normalized;
  },

  composeCustomerServiceSessionFrom(profile = {}) {
    const payload = {
      source: "profile-customer-service",
      featureCode: profile.featureCode || "",
      nickname: profile.nickname || ""
    };
    try {
      return JSON.stringify(payload);
    } catch (err) {
      console.warn("Failed to stringify session-from payload", err);
      return "profile-customer-service";
    }
  },

  onCustomerServiceContact(event) {
    console.log("Customer service contact event", event);
  },

  onFlpCardTap() {
    if (typeof wx.navigateTo !== "function") {
      wx.showToast({ title: "当前版本暂不支持", icon: "none" });
      return;
    }
    const balance = this.data.profile?.flpDisplay || "0.00";
    const query = encodeURIComponent(balance);
    wx.navigateTo({ url: `/pages/profile/flp/index?balance=${query}` });
  },

  onListItemTap(e) {
    const action = e.currentTarget?.dataset?.action;
    if (action === "markers") {
      if (typeof wx.navigateTo !== "function") {
        wx.showToast({ title: "��ǰ�汾�ݲ�֧��", icon: "none" });
        return;
      }
      wx.navigateTo({ url: "/pages/markers/index" });
      return;
    }
    if (action === "open-platform") {
      if (typeof wx.navigateTo !== "function") {
        wx.showToast({ title: "当前版本暂不支持", icon: "none" });
        return;
      }
      wx.navigateTo({ url: "/pages/profile/open-platform/index" });
      return;
    }

    wx.showToast({ title: "敬请期待", icon: "none" });

  },

  onChatButtonTap() {
    wx.showToast({ title: "您暂未获得低空智能体（Agent）体验特权", icon: "none" });
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
