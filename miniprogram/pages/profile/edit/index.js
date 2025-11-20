const {
  DEFAULT_AVATAR_PATH,
  normalizeProfileData,
  persistProfileLocally,
  loadStoredProfile,
  resolveApiBase,
  updateUserProfile,
  prepareAvatarForUpload,
  uploadAvatarFile
} = require("../../../utils/profile");

Page({
  data: {
    nickname: "",
    maxLength: 20,
    saving: false,
    avatarPreview: DEFAULT_AVATAR_PATH,
    defaultAvatar: DEFAULT_AVATAR_PATH
  },

  onLoad(options) {
    this._storedProfile = loadStoredProfile() || {};
    this._profileFromParent = null;
    this._hasInitialNickname = false;
    this._avatarTempPath = "";
    const eventChannel = this.getOpenerEventChannel ? this.getOpenerEventChannel() : null;
    if (eventChannel && typeof eventChannel.on === "function") {
      eventChannel.on("initProfile", (payload) => {
        if (payload && payload.profile) {
          this._profileFromParent = payload.profile;
          if (!this._hasInitialNickname) {
            this.setData({ nickname: payload.profile.nickname || "" });
            this._hasInitialNickname = true;
          }
          if (payload.profile.avatarUrl) {
            this.setData({ avatarPreview: payload.profile.avatarUrl });
          }
        }
      });
    }

    const passedNickname = options?.nickname ? decodeURIComponent(options.nickname) : "";
    const fallbackNickname =
      passedNickname || this._storedProfile.nickname || this._profileFromParent?.nickname || "";
    if (fallbackNickname) {
      this.setData({ nickname: fallbackNickname });
      this._hasInitialNickname = true;
    }
    const initialAvatar =
      this._profileFromParent?.avatarUrl ||
      this._storedProfile.avatarUrl ||
      DEFAULT_AVATAR_PATH;
    this.setData({ avatarPreview: initialAvatar || DEFAULT_AVATAR_PATH });
  },

  onNicknameInput(e) {
    this.setData({ nickname: (e.detail?.value || "").trimStart() });
  },

  onChooseAvatar(e) {
    const avatarUrl = e?.detail?.avatarUrl;
    if (!avatarUrl) return;
    this._avatarTempPath = avatarUrl;
    this.setData({ avatarPreview: avatarUrl });
  },

  onSubmit(e) {
    const nicknameValue = e?.detail?.value?.nickname;
    this.saveProfile(nicknameValue);
  },

  saveProfile(submittedNickname) {
    if (this.data.saving) return;
    const nickname = (submittedNickname || this.data.nickname || "").trim();
    if (!nickname) {
      wx.showToast({ title: "请填写昵称", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    const apiBase = resolveApiBase();
    const showLoading = typeof wx.showLoading === "function";
    const hideLoading = typeof wx.hideLoading === "function" ? () => wx.hideLoading() : () => {};
    if (showLoading) wx.showLoading({ title: "保存中...", mask: true });

    const uploadAvatarIfNeeded = () => {
      if (!this._avatarTempPath) return Promise.resolve(null);
      return prepareAvatarForUpload(this._avatarTempPath).then((filePath) =>
        uploadAvatarFile(filePath, { apiBase })
      );
    };

    uploadAvatarIfNeeded()
      .then((uploadedFileName) =>
        updateUserProfile(
          Object.assign(
            { username: nickname },
            uploadedFileName ? { avatarUrl: uploadedFileName } : {}
          ),
          { apiBase }
        ).then((remote) => ({ remote, uploadedFileName }))
      )
      .then(({ remote, uploadedFileName }) => {
        const baseProfile = Object.assign(
          {},
          this._storedProfile,
          this._profileFromParent || {},
          remote || {},
          {
            nickname,
            avatarFileName: uploadedFileName || remote?.avatarFileName || remote?.avatarUrl
          }
        );
        const persisted = persistProfileLocally({
          nickname: baseProfile.nickname,
          avatarUrl: baseProfile.avatarFileName || baseProfile.avatarUrl || "",
          featureCode:
            baseProfile.featureCode ||
            this._storedProfile.featureCode ||
            this._profileFromParent?.featureCode ||
            "",
          flpValue:
            baseProfile.flpValue ??
            this._storedProfile.flpValue ??
            this._profileFromParent?.flpValue ??
            null
        });
        this._storedProfile = persisted;
        const normalized = normalizeProfileData(baseProfile, {
          storedProfile: persisted,
          apiBase
        });
        const eventChannel = this.getOpenerEventChannel ? this.getOpenerEventChannel() : null;
        if (eventChannel && typeof eventChannel.emit === "function") {
          eventChannel.emit("profileUpdated", { profile: normalized });
        }
        hideLoading();
        wx.showToast({ title: "保存成功", icon: "success" });
        this._avatarTempPath = "";
        this.setData({
          nickname: normalized.nickname,
          avatarPreview: normalized.avatarUrl || DEFAULT_AVATAR_PATH
        });
        setTimeout(() => {
          wx.navigateBack();
        }, 400);
      })
      .catch((err) => {
        hideLoading();
        console.warn("保存资料失败", err);
        let message = "保存失败，请稍后重试";
        if (err?.message === "missing-token") {
          message = "请先登录后再试";
        }
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        this.setData({ saving: false });
      });
  }
});
