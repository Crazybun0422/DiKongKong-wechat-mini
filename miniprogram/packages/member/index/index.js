const {
  fetchUserProfile,
  loadStoredProfile,
  normalizeProfileData,
  persistProfileLocally,
  resolveApiBase
} = require("../../../utils/profile");
const { fetchBackgroundImagePackVersion, downloadBackgroundImagePack } = require("../../../utils/file-packs");
const {
  fetchMapLayerSettings,
  updateMapLayerSettings
} = require("../../../utils/map-layer-settings");
const {
  clearSelectedVoicePack,
  getSelectedVoicePackDirectoryName,
  isMembershipActive,
  playVoicePackFile,
  prepareVoicePackCatalog,
  setActiveVoicePack,
  setVoicePackAudioEndedHandler,
  stopVoicePackAudio,
  updateSelectedVoicePack
} = require("../../../utils/voice-pack");

const MAP_LAYER_VOICE_PACK_KEYS = [
  "selectedVoicePackDirectoryName",
  "voicePackDirectoryName",
  "voicePack",
  "selectedVoicePack"
];

function normalizeVoicePackDirectoryName(value) {
  if (value === undefined || value === null) return "";
  return `${value}`.trim();
}

function resolveMapLayerVoicePackDirectoryName(settings = {}) {
  const extraConfig =
    settings && typeof settings.extraConfig === "object" && settings.extraConfig
      ? settings.extraConfig
      : {};
  for (let i = 0; i < MAP_LAYER_VOICE_PACK_KEYS.length; i += 1) {
    const key = MAP_LAYER_VOICE_PACK_KEYS[i];
    if (Object.prototype.hasOwnProperty.call(extraConfig, key)) {
      return {
        hasValue: true,
        directoryName: normalizeVoicePackDirectoryName(extraConfig[key])
      };
    }
  }
  return { hasValue: false, directoryName: "" };
}

const BACKGROUND_PACK_CACHE_KEY = "memberBackgroundImagePackCache";
const BACKGROUND_EXTRACT_DIR_NAME = "member-background-images";

const MAIN_TABS = [
  { id: "privilege", label: "功能特权" },
  { id: "dress", label: "个性装扮" },
  { id: "benefit", label: "会员福利" }
];

const DRESS_TABS = [
  { id: "avatar", label: "头像挂件" },
  { id: "location", label: "定位图标" },
  { id: "voice", label: "语音包" }
];

const FEATURE_ITEMS = [
  { id: "adFree", title: "免广告", imageIndex: 1 },
  { id: "aircraft", title: "解锁机型", imageIndex: 2 },
  { id: "satellite", title: "卫星图层", imageIndex: 3 },
  { id: "kml", title: "KML导入导出", imageIndex: 4 },
  { id: "video", title: "高清视频", imageIndex: 5 },
  { id: "priority", title: "会员优先", imageIndex: 6 }
];

function getFileSystemManager() {
  if (typeof wx === "undefined" || typeof wx.getFileSystemManager !== "function") return null;
  try {
    return wx.getFileSystemManager();
  } catch (err) {
    return null;
  }
}

function getUserDataPath() {
  return (typeof wx !== "undefined" && wx.env && wx.env.USER_DATA_PATH) || "";
}

function promisifyFsCall(method, options = {}) {
  const fs = getFileSystemManager();
  if (!fs || typeof fs[method] !== "function") {
    return Promise.reject(new Error(`fs-${method}-unsupported`));
  }
  return new Promise((resolve, reject) => {
    fs[method](Object.assign({}, options, {
      success: (res) => resolve(res || {}),
      fail: (err) => reject(err || new Error(`fs-${method}-failed`))
    }));
  });
}

function fileExists(path) {
  const fs = getFileSystemManager();
  if (!path || !fs) return Promise.resolve(false);
  if (typeof fs.access === "function") {
    return promisifyFsCall("access", { path }).then(() => true).catch(() => false);
  }
  if (typeof fs.accessSync === "function") {
    try {
      fs.accessSync(path);
      return Promise.resolve(true);
    } catch (err) {
      return Promise.resolve(false);
    }
  }
  return Promise.resolve(false);
}

function ensureDir(dirPath) {
  if (!dirPath) return Promise.reject(new Error("missing-dir-path"));
  return promisifyFsCall("mkdir", { dirPath, recursive: true }).catch((err) => {
    const message = `${err?.errMsg || err?.message || ""}`;
    if (message.includes("file already exists")) return null;
    throw err;
  });
}

function removeDir(dirPath) {
  if (!dirPath) return Promise.resolve();
  return fileExists(dirPath).then((exists) => {
    if (!exists) return null;
    return promisifyFsCall("rmdir", { dirPath, recursive: true }).catch(() => null);
  });
}

function saveTempFile(tempFilePath) {
  if (!tempFilePath || typeof wx === "undefined" || typeof wx.saveFile !== "function") {
    return Promise.reject(new Error("save-file-unsupported"));
  }
  return new Promise((resolve, reject) => {
    wx.saveFile({
      tempFilePath,
      success: (res = {}) => resolve(res.savedFilePath || tempFilePath),
      fail: (err) => reject(err)
    });
  });
}

function unzipArchive(zipFilePath, targetPath) {
  if (!zipFilePath || !targetPath) return Promise.reject(new Error("missing-unzip-path"));
  return promisifyFsCall("unzip", { zipFilePath, targetPath });
}

function readStoredPackCache() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return {};
  try {
    return wx.getStorageSync(BACKGROUND_PACK_CACHE_KEY) || {};
  } catch (err) {
    return {};
  }
}

function writeStoredPackCache(cache = {}) {
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") return;
  try {
    wx.setStorageSync(BACKGROUND_PACK_CACHE_KEY, cache);
  } catch (err) {
    console.warn("save member background cache failed", err);
  }
}

function findImageInDirectory(rootPath, imageIndex) {
  const fs = getFileSystemManager();
  const target = `${imageIndex}`;
  const allowed = [".png", ".jpg", ".jpeg", ".webp"];
  if (!fs || typeof fs.readdirSync !== "function") {
    return "";
  }
  const visit = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir) || [];
    } catch (err) {
      return "";
    }
    for (let i = 0; i < entries.length; i += 1) {
      const name = entries[i];
      const fullPath = `${dir}/${name}`;
      let stat = null;
      try {
        stat = typeof fs.statSync === "function" ? fs.statSync(fullPath) : null;
      } catch (err) {
        stat = null;
      }
      if (stat && typeof stat.isDirectory === "function" && stat.isDirectory()) {
        const found = visit(fullPath);
        if (found) return found;
        continue;
      }
      const dotIndex = name.lastIndexOf(".");
      const base = dotIndex >= 0 ? name.slice(0, dotIndex) : name;
      const ext = dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : "";
      if (base === target && allowed.includes(ext)) return fullPath;
    }
    return "";
  };
  return visit(rootPath);
}

Page({
  data: {
    loading: true,
    loadingText: "会员资源准备中...",
    activeMainTab: "privilege",
    activeDressTab: "avatar",
    activeFeatureTab: "adFree",
    mainTabs: MAIN_TABS,
    dressTabs: DRESS_TABS,
    featureItems: FEATURE_ITEMS,
    activeFeatureItem: FEATURE_ITEMS[0],
    profile: {},
    nickname: "大友班长呀",
    avatarUrl: "/assets/default-avatar.png",
    isVip: false,
    memberExpireDateText: "暂未获得",
    actionText: "优惠开通",
    rechargePopupVisible: false,
    selectedVoicePackDirectoryName: "",
    clearingVoicePack: false,
    voicePackLoading: false,
    voicePackError: "",
    voicePacks: [],
    playingVoiceKey: "",
    backgroundImages: {},
    assets: {
      loading: "/assets/af-loading.png",
      defaultAvatar: "/assets/default-avatar.png",
      emptyBenefits: "/assets/vip/empty-vip-benefits.png",
      vipUser: "/assets/vip/vip-user.png",
      defaultPosition: "/assets/vip/default-position.png",
      vipPosition: "/assets/vip/vip-position.png",
      pPoint: "/assets/p-point.png",
      position: "/assets/position.png",
      voicePlay: "/assets/vip/voice-play.png",
      voicePause: "/assets/vip/voice-pause.png",
      drone1: "/assets/vip/drone-1.png",
      drone2: "/assets/vip/drone-2.png",
      bamboo1: "/assets/vip/bamboo-copter-1.png",
      bamboo2: "/assets/vip/bamboo-copter-2.png"
    }
  },

  onLoad() {
    setVoicePackAudioEndedHandler(() => {
      if (this.data.playingVoiceKey) {
        this.setData({ playingVoiceKey: "" });
      }
    });
    this.initPage();
  },

  onUnload() {
    setVoicePackAudioEndedHandler(null);
    stopVoicePackAudio();
  },

  initPage() {
    this.setData({ loading: true, loadingText: "会员资源准备中..." });
    Promise.all([
      this.loadProfile(),
      this.prepareBackgroundPack()
    ])
      .catch((err) => {
        console.warn("member page init failed", err);
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  loadProfile() {
    const stored = loadStoredProfile() || {};
    const initialProfile = normalizeProfileData(stored, {
      storedProfile: stored,
      apiBase: resolveApiBase()
    });
    this.applyProfile(initialProfile);
    return fetchUserProfile()
      .then((remote) => {
        const profile = normalizeProfileData(remote, {
          storedProfile: stored,
          apiBase: resolveApiBase()
        });
        this.applyProfile(profile);
        return this.syncSelectedVoicePackFromMapLayer();
      })
      .catch((err) => {
        if (err?.message !== "missing-token") {
          console.warn("load member profile failed", err);
        }
      });
  },

  applyProfile(profile = {}) {
    const isVip = isMembershipActive(profile);
    const expireText = isVip && profile.memberExpireDate
      ? `${this.formatExpireDate(profile.memberExpireDate)}到期`
      : "暂未获得";
    this.setData({
      profile,
      nickname: profile.nickname || "大友班长呀",
      avatarUrl: profile.avatarUrl || this.data.assets.defaultAvatar,
      isVip,
      selectedVoicePackDirectoryName: getSelectedVoicePackDirectoryName(profile),
      memberExpireDateText: expireText,
      actionText: isVip ? "优惠续费" : "优惠开通"
    });
  },

  syncSelectedVoicePackFromMapLayer() {
    const apiBase = resolveApiBase();
    return fetchMapLayerSettings({ apiBase })
      .then((settings = {}) => {
        const resolved = resolveMapLayerVoicePackDirectoryName(settings);
        if (!resolved.hasValue) return null;
        const directoryName = resolved.directoryName;
        const profile = Object.assign({}, this.data.profile || {}, {
          selectedVoicePackDirectoryName: directoryName,
          voicePackDirectoryName: directoryName,
          voicePack: directoryName
        });
        this.setData({
          selectedVoicePackDirectoryName: directoryName,
          profile
        });
        if (this.data.voicePacks && this.data.voicePacks.length) {
          this.applySelectedVoicePackToList(directoryName);
        }
        persistProfileLocally(profile);
        return directoryName;
      })
      .catch((err) => {
        console.warn("sync member voice pack from map layer failed", err);
        return null;
      });
  },

  formatExpireDate(value = "") {
    const text = `${value || ""}`.trim();
    if (!text) return "";
    const date = text.slice(0, 10);
    const parts = date.split("-");
    if (parts.length === 3) return `${parts[0]}.${parts[1]}.${parts[2]}`;
    return text.replace(/-/g, ".");
  },

  prepareBackgroundPack() {
    const root = getUserDataPath();
    const fs = getFileSystemManager();
    if (!root || !fs) return Promise.resolve();
    return fetchBackgroundImagePackVersion()
      .then((versionInfo = {}) => {
        const fileName = versionInfo.fileName || "";
        const version = versionInfo.version || "";
        if (!fileName) throw new Error("missing-background-pack-file");
        return this.resolveBackgroundZip(fileName, version)
          .then((zipPath) => {
            const targetPath = `${root}/${BACKGROUND_EXTRACT_DIR_NAME}`;
            return removeDir(targetPath)
              .then(() => ensureDir(targetPath))
              .then(() => unzipArchive(zipPath, targetPath))
              .then(() => this.resolveBackgroundImages(targetPath));
          });
      })
      .catch((err) => {
        console.warn("prepare member background pack failed", err);
      });
  },

  resolveBackgroundZip(fileName, version) {
    const cache = readStoredPackCache();
    const cachedZip = cache.fileName === fileName && cache.version === version ? cache.zipPath : "";
    return fileExists(cachedZip)
      .then((exists) => {
        if (exists) return cachedZip;
        this.setData({ loadingText: "会员背景下载中..." });
        return downloadBackgroundImagePack(fileName)
          .then((tempPath) => saveTempFile(tempPath))
          .then((zipPath) => {
            writeStoredPackCache({ fileName, version, zipPath });
            return zipPath;
          });
      });
  },

  resolveBackgroundImages(targetPath) {
    const images = {};
    FEATURE_ITEMS.forEach((item) => {
      const found = findImageInDirectory(targetPath, item.imageIndex);
      images[item.imageIndex] = found || `${targetPath}/${item.imageIndex}.png`;
    });
    const featureItems = FEATURE_ITEMS.map((item) =>
      Object.assign({}, item, { image: images[item.imageIndex] || "" })
    );
    const activeFeatureItem =
      featureItems.find((item) => item.id === this.data.activeFeatureTab) ||
      featureItems[0] ||
      FEATURE_ITEMS[0];
    this.setData({ backgroundImages: images, featureItems, activeFeatureItem });
  },

  onBackTap() {
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    if (pages.length > 1 && typeof wx.navigateBack === "function") {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          if (typeof wx.redirectTo === "function") {
            wx.redirectTo({ url: "/pages/profile/profile" });
          }
        }
      });
      return;
    }
    if (typeof wx.redirectTo === "function") {
      wx.redirectTo({ url: "/pages/profile/profile" });
    }
  },

  onMainTabTap(e) {
    const id = e.currentTarget?.dataset?.id || "";
    if (!id || id === this.data.activeMainTab) return;
    this.setData({ activeMainTab: id });
  },

  onDressTabTap(e) {
    const id = e.currentTarget?.dataset?.id || "";
    if (!id || id === this.data.activeDressTab) return;
    this.setData({ activeDressTab: id });
    if (id === "voice") {
      this.loadVoicePacks();
    }
  },

  onFeatureTabTap(e) {
    const id = e.currentTarget?.dataset?.id || "";
    if (!id || id === this.data.activeFeatureTab) return;
    const activeFeatureItem =
      this.data.featureItems.find((item) => item.id === id) ||
      FEATURE_ITEMS.find((item) => item.id === id) ||
      this.data.activeFeatureItem;
    this.setData({ activeFeatureTab: id, activeFeatureItem });
  },

  onRechargeTap() {
    this.setData({ rechargePopupVisible: true });
  },

  onRechargePopupClose() {
    this.setData({ rechargePopupVisible: false });
  },

  onRechargeSuccess(e) {
    const profile = e?.detail?.profile;
    if (profile) {
      this.applyProfile(profile);
      return;
    }
    this.loadProfile();
  },

  loadVoicePacks() {
    if (this._voicePackLoadingPromise) return this._voicePackLoadingPromise;
    this.setData({ voicePackLoading: true, voicePackError: "" });
    this._voicePackLoadingPromise = this.syncSelectedVoicePackFromMapLayer()
      .then(() => prepareVoicePackCatalog())
      .then((catalog = {}) => {
        const selected = this.data.selectedVoicePackDirectoryName;
        const voicePacks = (catalog.packages || []).map((item) =>
          Object.assign({}, item, {
            files: (item.files || []).map((file) =>
              Object.assign({}, file, {
                directoryName: item.directoryName,
                voiceKey: `${item.directoryName}:${file.name}`
              })
            ),
            selected: !!selected && item.directoryName === selected
          })
        );
        this.setData({ voicePacks });
      })
      .catch((err) => {
        console.warn("load voice packs failed", err);
        this.setData({ voicePackError: "语音包加载失败" });
      })
      .finally(() => {
        this._voicePackLoadingPromise = null;
        this.setData({ voicePackLoading: false });
      });
    return this._voicePackLoadingPromise;
  },

  findVoicePack(directoryName = "") {
    return (this.data.voicePacks || []).find((item) => item.directoryName === directoryName) || null;
  },

  applySelectedVoicePackToList(directoryName = "") {
    const selected = normalizeVoicePackDirectoryName(directoryName);
    const voicePacks = (this.data.voicePacks || []).map((item) =>
      Object.assign({}, item, { selected: !!selected && item.directoryName === selected })
    );
    this.setData({ voicePacks });
  },

  updateVoicePackMapLayerSetting(directoryName = "") {
    const apiBase = resolveApiBase();
    return fetchMapLayerSettings({ apiBase })
      .catch((err) => {
        console.warn("fetch map layer settings before updating voice pack failed", err);
        return {};
      })
      .then((settings = {}) => {
        const existing =
          settings && typeof settings.extraConfig === "object" && settings.extraConfig
            ? settings.extraConfig
            : {};
        const extraConfig = Object.assign({}, existing);
        const nextValue = normalizeVoicePackDirectoryName(directoryName);
        MAP_LAYER_VOICE_PACK_KEYS.forEach((key) => {
          extraConfig[key] = nextValue;
        });
        return updateMapLayerSettings({ extraConfig }, { apiBase });
      });
  },

  onVoicePreviewTap(e) {
    const directoryName = e.currentTarget?.dataset?.directory || "";
    const fileName = e.currentTarget?.dataset?.file || "";
    const voiceKey = e.currentTarget?.dataset?.key || `${directoryName}:${fileName}`;
    if (!directoryName || !fileName) {
      console.warn("voice preview missing dataset", e.currentTarget?.dataset || {});
      wx.showToast({ title: "音频暂不可用", icon: "none" });
      return;
    }
    if (this.data.playingVoiceKey === voiceKey) {
      stopVoicePackAudio();
      this.setData({ playingVoiceKey: "" });
      return;
    }
    const pack = this.findVoicePack(directoryName);
    if (!playVoicePackFile(pack, fileName)) {
      wx.showToast({ title: "音频暂不可用", icon: "none" });
      this.setData({ playingVoiceKey: "" });
      return;
    }
    this.setData({ playingVoiceKey: voiceKey });
  },

  onVoicePackUseTap(e) {
    const directoryName = e.currentTarget?.dataset?.directory || "";
    const pack = this.findVoicePack(directoryName);
    if (!pack) return;
    if (!this.data.isVip) {
      wx.showToast({ title: "会员可使用语音包", icon: "none" });
      return;
    }
    if (directoryName === this.data.selectedVoicePackDirectoryName) return;
    Promise.allSettled([
      updateSelectedVoicePack(directoryName),
      this.updateVoicePackMapLayerSetting(directoryName)
    ])
      .then((results) => {
        const mapLayerResult = results[1];
        if (mapLayerResult.status === "rejected") {
          throw mapLayerResult.reason || new Error("update-map-layer-voice-pack-failed");
        }
        this.applySelectedVoicePackToList(directoryName);
        this.setData({
          selectedVoicePackDirectoryName: directoryName,
          profile: Object.assign({}, this.data.profile || {}, {
            selectedVoicePackDirectoryName: directoryName,
            voicePackDirectoryName: directoryName,
            voicePack: directoryName
          })
        });
        persistProfileLocally(Object.assign({}, this.data.profile || {}, {
          selectedVoicePackDirectoryName: directoryName,
          voicePackDirectoryName: directoryName,
          voicePack: directoryName
        }));
        setActiveVoicePack(pack);
        wx.showToast({ title: "已启用", icon: "success" });
      })
      .catch((err) => {
        console.warn("set voice pack failed", err);
        wx.showToast({ title: "设置失败", icon: "none" });
      });
  },

  onClearVoicePacksTap() {
    if (this.data.clearingVoicePack) return;
    this.setData({ clearingVoicePack: true });
    const apiBase = resolveApiBase();
    Promise.allSettled([
      clearSelectedVoicePack({ apiBase }),
      this.updateVoicePackMapLayerSetting("")
    ])
      .then((results) => {
        const profileResult = results[0];
        const mapLayerResult = results[1];
        if (profileResult.status === "rejected") {
          throw profileResult.reason || new Error("clear-profile-voice-pack-failed");
        }
        if (mapLayerResult.status === "rejected") {
          throw mapLayerResult.reason || new Error("clear-map-layer-voice-pack-failed");
        }
        stopVoicePackAudio();
        setActiveVoicePack(null);
        const profile = Object.assign({}, this.data.profile || {}, {
          selectedVoicePackDirectoryName: "",
          voicePackDirectoryName: "",
          voicePack: ""
        });
        this.applySelectedVoicePackToList("");
        this.setData({
          selectedVoicePackDirectoryName: "",
          playingVoiceKey: "",
          profile
        });
        persistProfileLocally(profile);
        wx.showToast({ title: "已清空", icon: "success" });
      })
      .catch((err) => {
        console.warn("clear voice pack failed", err);
        wx.showToast({ title: "清空失败", icon: "none" });
      })
      .finally(() => {
        this.setData({ clearingVoicePack: false });
      });
  },

  onVoicePackClearPlaceholderTap() {
    return this.onClearVoicePacksTap();
  }
});
