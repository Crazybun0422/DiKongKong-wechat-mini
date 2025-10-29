const {
  normalizeProfileData,
  persistProfileLocally,
  loadStoredProfile,
  resolveApiBase,
  updateUserProfile
} = require("../../../utils/profile");

Page({
  data: {
    nickname: "",
    maxLength: 20,
    saving: false
  },

  onLoad(options) {
    this._storedProfile = loadStoredProfile() || {};
    this._profileFromParent = null;
    this._hasInitialNickname = false;
    const eventChannel = this.getOpenerEventChannel ? this.getOpenerEventChannel() : null;
    if (eventChannel && typeof eventChannel.on === "function") {
      eventChannel.on("initProfile", (payload) => {
        if (payload && payload.profile) {
          this._profileFromParent = payload.profile;
          if (!this._hasInitialNickname) {
            this.setData({ nickname: payload.profile.nickname || "" });
            this._hasInitialNickname = true;
          }
        }
      });
    }

    const passedNickname = options && options.nickname ? decodeURIComponent(options.nickname) : "";
    if (passedNickname) {
      this.setData({ nickname: passedNickname });
      this._hasInitialNickname = true;
    } else if (this._storedProfile.nickname) {
      this.setData({ nickname: this._storedProfile.nickname });
      this._hasInitialNickname = true;
    }
  },

  onNicknameInput(e) {
    this.setData({ nickname: (e.detail && e.detail.value) || "" });
  },

  onSaveTap() {
    this.saveNickname();
  },

  saveNickname() {
    if (this.data.saving) return;
    const nickname = (this.data.nickname || "").trim();
    if (!nickname) {
      wx.showToast({ title: "请输入昵称", icon: "none" });
      return;
    }

    this.setData({ saving: true });
    const apiBase = resolveApiBase();
    const showLoading = typeof wx.showLoading === "function";
    const hideLoading = typeof wx.hideLoading === "function" ? () => wx.hideLoading() : () => {};
    if (showLoading) wx.showLoading({ title: "保存中...", mask: true });

    updateUserProfile({ nickname }, { apiBase })
      .then((remote) => {
        const baseProfile = Object.assign(
          {},
          {
            featureCode:
              this._storedProfile.featureCode ||
              (this._profileFromParent ? this._profileFromParent.featureCode : ""),
            flpValue:
              this._storedProfile.flpValue !== undefined
                ? this._storedProfile.flpValue
                : this._profileFromParent
                ? this._profileFromParent.flpValue
                : null
          },
          this._storedProfile,
          this._profileFromParent || {},
          remote || {},
          { nickname }
        );

        const persisted = persistProfileLocally({
          nickname: baseProfile.nickname,
          avatarUrl: baseProfile.avatarFileName || baseProfile.avatarUrl || "",
          featureCode: baseProfile.featureCode,
          flpValue: baseProfile.flpValue
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
        setTimeout(() => {
          wx.navigateBack();
        }, 300);
      })
      .catch((err) => {
        hideLoading();
        console.warn("保存昵称失败", err);
        let message = "保存失败，请稍后重试";
        if (err && err.message === "missing-token") {
          message = "请先登录后再试";
        }
        wx.showToast({ title: message, icon: "none" });
      })
      .finally(() => {
        this.setData({ saving: false });
      });
  }
});
