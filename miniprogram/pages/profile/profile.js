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
        console.log("remoteProfile:",remoteProfile);
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
    if (typeof wx.showActionSheet !== "function") {
      wx.showToast({ title: "当前版本暂不支持编辑", icon: "none" });
      return;
    }
    wx.showActionSheet({
      itemList: ["更换头像", "编辑昵称"],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.onChangeAvatarTap();
        } else if (res.tapIndex === 1) {
          this.onEditNicknameTap();
        }
      }
    });
  },

  onChangeAvatarTap() {
    if (typeof wx.showActionSheet !== "function") {
      this.chooseAvatarFromSource(["album"]);
      return;
    }
    wx.showActionSheet({
      itemList: ["拍照", "从相册选择"],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.chooseAvatarFromSource(["camera"]);
        } else if (res.tapIndex === 1) {
          this.chooseAvatarFromSource(["album"]);
        }
      }
    });
  },

  chooseAvatarFromSource(sourceType) {
    if (typeof wx.chooseImage !== "function") {
      wx.showToast({ title: "选择头像失败", icon: "none" });
      return;
    }
    wx.chooseImage({
      count: 1,
      sizeType: ["compressed"],
      sourceType,
      success: (res) => {
        const path = res?.tempFilePaths && res.tempFilePaths[0];
        if (!path) {
          wx.showToast({ title: "未选择图片", icon: "none" });
          return;
        }
        this.handleAvatarSelection(path);
      },
      fail: (err) => {
        if (err && typeof err.errMsg === "string" && err.errMsg.includes("cancel")) {
          return;
        }
        wx.showToast({ title: "选择失败", icon: "none" });
      }
    });
  },

  handleAvatarSelection(tempPath) {
    if (!tempPath) return;
    const showLoading = typeof wx.showLoading === "function";
    const hideLoading = typeof wx.hideLoading === "function" ? () => wx.hideLoading() : () => {};
    if (showLoading) wx.showLoading({ title: "上传中...", mask: true });
    const apiBase = resolveApiBase();
    prepareAvatarForUpload(tempPath)
      .then((filePath) => uploadAvatarFile(filePath, { apiBase }))
      .then((fileName) =>
        updateUserProfile({ avatarFileName: fileName }, { apiBase })
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

  onEditNicknameTap() {
    const nickname = this.data.profile?.nickname || "";
    if (typeof wx.navigateTo !== "function") {
      wx.showToast({ title: "当前版本暂不支持编辑", icon: "none" });
      return;
    }
    wx.navigateTo({
      url: `/pages/profile/edit/index?nickname=${encodeURIComponent(nickname)}`,
      events: {
        profileUpdated: (payload) => {
          if (payload && payload.profile) {
            this.handleProfileUpdateResult(payload.profile, {});
          }
        }
      },
      success: (res) => {
        if (res.eventChannel && typeof res.eventChannel.emit === "function") {
          res.eventChannel.emit("initProfile", {
            profile: this.data.profile
          });
        }
      }
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
    this.setData({ profile: normalized });
    return normalized;
  },

  onFlpCardTap() {
    wx.showToast({ title: "敬请期待", icon: "none" });
  },

  onListItemTap(e) {
    const action = e.currentTarget?.dataset?.action;
    if (action === "customer-service") {
      wx.showToast({ title: "�ͷ����ܼ�������", icon: "none" });
      return;
    }
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
