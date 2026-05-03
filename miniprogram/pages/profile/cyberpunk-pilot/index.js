const {
  loadStoredProfile,
  normalizeProfileData,
  persistProfileLocally,
  prepareAvatarForUpload,
  resolveApiBase,
  updateUserProfile,
  uploadAvatarFile
} = require("../../../utils/profile");
const { isMembershipActive } = require("../../../utils/voice-pack");
const { prepareCyberAvatarCatalog } = require("../../../utils/cyber-avatar-pack");

function extractFileName(value = "") {
  const text = `${value || ""}`.trim();
  if (!text) return "";
  const withoutFragment = text.split("#")[0];
  const withoutQuery = withoutFragment.split("?")[0];
  const parts = withoutQuery.split(/[/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : withoutQuery;
}

function logCyberPilot(event, detail = {}) {
  try {
    console.log("[cyber-pilot-page]", event, detail);
  } catch (err) {}
}

Page({
  data: {
    loading: true,
    loadingText: "飞手形象加载中...",
    error: "",
    submitting: false,
    profile: {},
    isVip: false,
    characters: [],
    selectedCharacterId: "",
    selectedCharacter: null,
    confirmVisible: false,
    vipGatePopupVisible: false,
    assets: {
      vipUser: "/assets/vip/vip-user.png"
    }
  },

  onLoad() {
    this.bootstrap();
  },

  bootstrap() {
    const stored = loadStoredProfile() || {};
    const apiBase = resolveApiBase();
    const profile = normalizeProfileData(stored, {
      storedProfile: stored,
      apiBase
    });
    const isVip = isMembershipActive(profile);
    this._storedProfileCache = stored;
    this._currentAvatarFileName = extractFileName(profile.avatarFileName || profile.avatarUrl || "");
    logCyberPilot("bootstrap", {
      currentAvatarFileName: this._currentAvatarFileName,
      isVip,
      apiBase
    });
    this.setData({
      loading: true,
      loadingText: "飞手形象加载中...",
      error: "",
      submitting: false,
      profile,
      isVip
    });
    prepareCyberAvatarCatalog({ apiBase })
      .then((catalog = {}) => {
        const characters = Array.isArray(catalog.characters) ? catalog.characters : [];
        if (!characters.length) throw new Error("empty-cyber-avatar-catalog");
        const selectedCharacterId = this.resolveInitialCharacterId(characters);
        const selectedCharacter =
          characters.find((item) => item.id === selectedCharacterId) || characters[0];
        logCyberPilot("catalog-ready", {
          characterCount: characters.length,
          selectedCharacterId: selectedCharacter.id
        });
        this.setData({
          loading: false,
          error: "",
          characters,
          selectedCharacterId: selectedCharacter.id,
          selectedCharacter,
          confirmVisible: false
        });
      })
      .catch((err) => {
        console.warn("prepare cyber avatar catalog failed", err);
        logCyberPilot("catalog-failed", { err });
        this.setData({
          loading: false,
          error: "飞手形象加载失败"
        });
      });
  },

  resolveInitialCharacterId(characters = []) {
    const currentFileName = `${this._currentAvatarFileName || ""}`.toLowerCase();
    const matched = characters.find((item) =>
      extractFileName(item.avatarPath).toLowerCase() === currentFileName
    );
    return (matched && matched.id) || (characters[0] && characters[0].id) || "";
  },

  onBackTap() {
    if (typeof wx.navigateBack === "function") {
      wx.navigateBack();
      return;
    }
    wx.redirectTo({ url: "/pages/profile/profile" });
  },

  onRetryTap() {
    this.bootstrap();
  },

  onCharacterTap(e) {
    const characterId = e.currentTarget?.dataset?.id || "";
    if (!characterId) return;
    const characters = Array.isArray(this.data.characters) ? this.data.characters : [];
    const selectedCharacter = characters.find((item) => item.id === characterId);
    if (!selectedCharacter) return;
    this.setData({
      selectedCharacterId: characterId,
      selectedCharacter,
      confirmVisible: true
    });
  },

  onConfirmTap() {
    if (this.data.submitting) return;
    const selectedCharacter = this.data.selectedCharacter;
    if (!selectedCharacter || !selectedCharacter.avatarPath) return;
    if (!this.data.isVip) {
      this.setData({ vipGatePopupVisible: true });
      return;
    }
    const apiBase = resolveApiBase();
    logCyberPilot("apply-avatar:start", {
      selectedCharacterId: selectedCharacter.id,
      avatarPath: selectedCharacter.avatarPath
    });
    this.setData({ submitting: true });
    if (typeof wx.showLoading === "function") {
      wx.showLoading({ title: "应用中...", mask: true });
    }
    prepareAvatarForUpload(selectedCharacter.avatarPath)
      .then((filePath) => {
        logCyberPilot("apply-avatar:prepared", {
          selectedCharacterId: selectedCharacter.id,
          filePath
        });
        return uploadAvatarFile(filePath, { apiBase });
      })
      .then((fileName) =>
        updateUserProfile({ avatarUrl: fileName }, { apiBase })
          .then((remote) => ({ remote, fileName }))
      )
      .then(({ remote, fileName }) => {
        logCyberPilot("apply-avatar:uploaded", {
          selectedCharacterId: selectedCharacter.id,
          fileName
        });
        const current = this.data.profile || {};
        const merged = Object.assign({}, this._storedProfileCache || {}, current, remote || {}, {
          avatarUrl: fileName,
          avatarFileName: fileName
        });
        const persisted = persistProfileLocally({
          nickname: merged.nickname || current.nickname || "",
          avatarUrl: fileName,
          featureCode: merged.featureCode || current.featureCode || "",
          flpValue: merged.flpValue,
          inviteCode: merged.inviteCode || current.inviteCode || "",
          vip: merged.vip ?? merged.member ?? current.vip ?? false,
          memberExpireDate: merged.memberExpireDate || current.memberExpireDate || "",
          selectedVoicePackDirectoryName:
            merged.selectedVoicePackDirectoryName || current.selectedVoicePackDirectoryName || "",
          checkinQuota: merged.checkinQuota || current.checkinQuota || {}
        });
        this._storedProfileCache = persisted;
        this._currentAvatarFileName = fileName;
        const profile = normalizeProfileData(merged, {
          storedProfile: persisted,
          apiBase
        });
        this.setData({
          profile,
          isVip: isMembershipActive(profile),
          confirmVisible: false
        });
        wx.showToast({ title: "头像已更新", icon: "success" });
      })
      .catch((err) => {
        console.warn("apply cyber avatar failed", err);
        wx.showToast({ title: "设置失败", icon: "none" });
      })
      .finally(() => {
        if (typeof wx.hideLoading === "function") wx.hideLoading();
        this.setData({ submitting: false });
      });
  },

  onVipGatePopupClose() {
    this.setData({ vipGatePopupVisible: false });
  },

  onVipGatePopupConfirm() {
    this.setData({ vipGatePopupVisible: false });
    if (typeof wx.navigateTo !== "function") {
      wx.showToast({ title: "当前版本暂不支持", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/packages/member/index/index" });
  }
});
