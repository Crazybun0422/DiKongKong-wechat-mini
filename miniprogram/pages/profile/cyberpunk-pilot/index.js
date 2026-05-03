const {
  loadStoredProfile,
  normalizeProfileData,
  persistProfileLocally,
  prepareAvatarForUpload,
  resolveApiBase,
  updateUserProfile,
  uploadAvatarFile
} = require("../../../utils/profile");
const {
  fetchMapLayerSettings,
  updateMapLayerSettings
} = require("../../../utils/map-layer-settings");
const { isMembershipActive } = require("../../../utils/voice-pack");
const { prepareCyberAvatarCatalog } = require("../../../utils/cyber-avatar-pack");

const MAP_LAYER_EXTRA_CONFIG_CYBER_PILOT_CHARACTER_ID_KEY = "selectedCyberPilotCharacterId";

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
    appliedCharacterId: "",
    stripScrollIntoView: "",
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
    this._appliedCharacterId = "";
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
    Promise.all([
      prepareCyberAvatarCatalog({ apiBase }),
      this.loadAppliedCharacterIdFromMapLayer()
    ])
      .then(([catalog = {}, appliedCharacterId = ""]) => {
        const characters = Array.isArray(catalog.characters) ? catalog.characters : [];
        if (!characters.length) throw new Error("empty-cyber-avatar-catalog");
        const selectedCharacterId = this.resolveInitialCharacterId(characters, appliedCharacterId);
        const selectedCharacter =
          characters.find((item) => item.id === selectedCharacterId) || characters[0];
        logCyberPilot("catalog-ready", {
          characterCount: characters.length,
          selectedCharacterId: selectedCharacter.id,
          appliedCharacterId
        });
        this.setData({
          loading: false,
          error: "",
          characters,
          selectedCharacterId: selectedCharacter.id,
          selectedCharacter,
          appliedCharacterId,
          stripScrollIntoView: "",
          confirmVisible: selectedCharacter.id !== appliedCharacterId
        }, () => {
          this.syncStripScrollPosition(selectedCharacter.id);
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

  resolveInitialCharacterId(characters = [], appliedCharacterId = "") {
    const applied = `${appliedCharacterId || ""}`.trim();
    if (applied && characters.some((item) => item.id === applied)) {
      return applied;
    }
    return (characters[0] && characters[0].id) || "";
  },

  buildCharacterAnchorId(characterId = "") {
    const text = `${characterId || ""}`.trim();
    return text ? `cyber-avatar-${text}` : "";
  },

  syncStripScrollPosition(characterId = "") {
    const anchorId = this.buildCharacterAnchorId(characterId);
    if (!anchorId) return;
    this.setData({ stripScrollIntoView: "" }, () => {
      if (typeof wx !== "undefined" && typeof wx.nextTick === "function") {
        wx.nextTick(() => {
          this.setData({ stripScrollIntoView: anchorId });
        });
        return;
      }
      this.setData({ stripScrollIntoView: anchorId });
    });
  },

  loadAppliedCharacterIdFromMapLayer() {
    const apiBase = resolveApiBase();
    return fetchMapLayerSettings({ apiBase })
      .then((settings = {}) => {
        this._mapLayerSettings = settings;
        const extraConfig =
          settings && typeof settings.extraConfig === "object" && settings.extraConfig
            ? settings.extraConfig
            : {};
        const appliedCharacterId = `${extraConfig[MAP_LAYER_EXTRA_CONFIG_CYBER_PILOT_CHARACTER_ID_KEY] || ""}`.trim();
        this._appliedCharacterId = appliedCharacterId;
        return appliedCharacterId;
      })
      .catch((err) => {
        console.warn("load cyber pilot map layer setting failed", err);
        this._mapLayerSettings = null;
        this._appliedCharacterId = "";
        return "";
      });
  },

  persistAppliedCharacterIdToMapLayer(characterId = "") {
    const apiBase = resolveApiBase();
    const currentSettings =
      this._mapLayerSettings && typeof this._mapLayerSettings === "object"
        ? this._mapLayerSettings
        : {};
    const existingExtraConfig =
      currentSettings.extraConfig && typeof currentSettings.extraConfig === "object"
        ? currentSettings.extraConfig
        : {};
    const nextCharacterId = `${characterId || ""}`.trim();
    const extraConfig = Object.assign({}, existingExtraConfig, {
      [MAP_LAYER_EXTRA_CONFIG_CYBER_PILOT_CHARACTER_ID_KEY]: nextCharacterId || null
    });
    return updateMapLayerSettings({ extraConfig }, { apiBase })
      .then((settings = {}) => {
        this._mapLayerSettings = settings && typeof settings === "object"
          ? settings
          : Object.assign({}, currentSettings, { extraConfig });
        this._appliedCharacterId = nextCharacterId;
        return nextCharacterId;
      });
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
      confirmVisible: characterId !== this.data.appliedCharacterId
    }, () => {
      this.syncStripScrollPosition(characterId);
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
      .then(({ remote, fileName }) =>
        this.persistAppliedCharacterIdToMapLayer(selectedCharacter.id)
          .then(() => ({ remote, fileName }))
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
        const eventChannel = this.getOpenerEventChannel ? this.getOpenerEventChannel() : null;
        if (eventChannel && typeof eventChannel.emit === "function") {
          eventChannel.emit("profileUpdated", { profile });
        }
        this.setData({
          profile,
          isVip: isMembershipActive(profile),
          appliedCharacterId: selectedCharacter.id,
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
