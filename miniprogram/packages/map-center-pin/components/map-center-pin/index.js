const {
  fetchEasterEggResourceConfig,
  readStoredEasterEggResourceLocalCache,
  hasValidEasterEggResourceLocalCache,
  startLatestEasterEggResourceDownload,
  cacheEasterEggResourceDownload
} = require("../../../../utils/easter-egg-resource");
const LONGPRESS_ACTION_ITEMS = [
  { id: "quickMark", label: "标记该处", icon: "/packages/map-center-pin/assets/quick-pin.png" },
  { id: "share", label: "分享位置", icon: "/packages/map-center-pin/assets/share-location.png" },
  { id: "navigate", label: "导航到此处", icon: "/packages/map-center-pin/assets/navigate.png" },
  { id: "askAgent", label: "问问智能体", icon: "/packages/map-center-pin/assets/ask-ai.png" },
  { id: "bindMyLocation", label: "地标绑定", icon: "/packages/map-center-pin/assets/bind-my-location.png" },
  { id: "afeiAdventure", label: "阿飞历险记", icon: "/packages/map-center-pin/assets/afei-adventure.png" }
];

Component({
  properties: {
    topOffsetPx: {
      type: Number,
      value: 0
    },
    satellite: {
      type: Boolean,
      value: false
    },
    longPressGuideNodes: {
      type: String,
      value: ""
    },
    followActive: {
      type: Boolean,
      value: false
    },
    followTipText: {
      type: String,
      value: "长按解除绑定状态~"
    },
    welcomeBubbleDismissToken: {
      type: Number,
      value: 0,
      observer: "onWelcomeBubbleDismissTokenChange"
    }
  },

  data: {
    triggered: false,
    sheetVisible: false,
    sheetClosing: false,
    showWelcomeBubble: false,
    actionItems: LONGPRESS_ACTION_ITEMS,
    afeiPreparing: false,
    afeiProgressPercent: 0
  },

  lifetimes: {
    attached() {
      this._lastWelcomeBubbleDismissToken = Number(this.properties.welcomeBubbleDismissToken) || 0;
      this.showWelcomeBubble();
    },

    detached() {
      if (this._triggerTimer) {
        clearTimeout(this._triggerTimer);
        this._triggerTimer = null;
      }
      if (this._closeTimer) {
        clearTimeout(this._closeTimer);
        this._closeTimer = null;
      }
      this.abortAfeiPreparation({ silent: true, closeSheet: false });
    }
  },

  pageLifetimes: {
    show() {
      this.showWelcomeBubble();
    }
  },

  methods: {
    showWelcomeBubble() {
      if (this.data.showWelcomeBubble) return;
      this.setData({ showWelcomeBubble: true });
    },

    hideWelcomeBubble() {
      if (!this.data.showWelcomeBubble) return;
      this.setData({ showWelcomeBubble: false });
    },

    onWelcomeBubbleDismissTokenChange(token) {
      const currentToken = Number(token) || 0;
      const previousToken = Number(this._lastWelcomeBubbleDismissToken) || 0;
      this._lastWelcomeBubbleDismissToken = currentToken;
      if (currentToken <= previousToken) return;
      this.hideWelcomeBubble();
    },

    onTap() {
      if (this.data.sheetVisible || this.data.sheetClosing) return;
      this.triggerEvent("tap");
    },

    triggerLongPressHaptic() {
      if (typeof wx === "undefined") return;
      let platform = "";
      if (typeof wx.getSystemInfoSync === "function") {
        try {
          const info = wx.getSystemInfoSync() || {};
          platform = `${info.platform || ""}`.toLowerCase();
        } catch (err) {}
      }
      const vibrateLongFirst = () => {
        if (typeof wx.vibrateLong === "function") {
          try {
            wx.vibrateLong({
              fail: () => {
                if (typeof wx.vibrateShort === "function") {
                  try {
                    wx.vibrateShort();
                  } catch (innerErr) {}
                }
              }
            });
            return true;
          } catch (err) {}
        }
        return false;
      };
      if (platform.includes("android")) {
        if (vibrateLongFirst()) return;
      }
      if (typeof wx.vibrateShort === "function") {
        try {
          wx.vibrateShort({
            type: "light",
            fail: () => {
              if (!vibrateLongFirst()) {
                try {
                  wx.vibrateShort();
                } catch (innerErr) {}
              }
            }
          });
          return;
        } catch (err) {}
      }
      vibrateLongFirst();
    },

    onLongPress() {
      if (this.data.sheetVisible || this.data.sheetClosing) return;
      if (this.properties.followActive) {
        this.hideWelcomeBubble();
        this.setData({ triggered: true });
        this.triggerLongPressHaptic();
        if (this._triggerTimer) {
          clearTimeout(this._triggerTimer);
        }
        this._triggerTimer = setTimeout(() => {
          this._triggerTimer = null;
          this.setData({ triggered: false });
        }, 280);
        this.triggerEvent("longpress", { unbindFollow: true });
        return;
      }
      this.hideWelcomeBubble();
      this.setData({
        triggered: true,
        sheetVisible: true
      });
      this.triggerLongPressHaptic();
      if (this._triggerTimer) {
        clearTimeout(this._triggerTimer);
      }
      this._triggerTimer = setTimeout(() => {
        this._triggerTimer = null;
        this.setData({ triggered: false });
      }, 280);
      this.triggerEvent("longpress");
    },

    onMaskTap() {
      if (this.data.afeiPreparing) {
        this.confirmCloseSheetDuringAfeiPreparation();
        return;
      }
      this.closeSheet();
    },

    onActionTap(event = {}) {
      const action = `${event?.currentTarget?.dataset?.action || ""}`.trim();
      if (!action) return;
      if (action === "afeiAdventure") {
        this.onAfeiAdventureTap();
        return;
      }
      if (this.data.afeiPreparing) {
        wx.showToast({ title: "阿飞历险记正在准备中", icon: "none" });
        return;
      }
      this.triggerEvent("action", { action });
      this.closeSheet();
    },

    onSheetTap() {},

    noop() {},

    onAfeiAdventureTap() {
      if (this.data.afeiPreparing) {
        wx.showToast({ title: "阿飞历险记正在准备中", icon: "none" });
        return;
      }
      this.startAfeiPreparation();
    },

    startAfeiPreparation() {
      this._afeiAbortByUser = false;
      this.updateAfeiPreparationProgress(1);
      this.setData({ afeiPreparing: true });

      let latestConfig = null;
      fetchEasterEggResourceConfig()
        .then((config) => {
          if (this._afeiAbortByUser) {
            throw new Error("download-aborted");
          }
          latestConfig = config;
          if (!config || !config.fileName || !config.version) {
            throw new Error("missing-easter-egg-config");
          }
          const localCache = readStoredEasterEggResourceLocalCache();
          return hasValidEasterEggResourceLocalCache(localCache).then((isValid) => ({ localCache, isValid }));
        })
        .then(({ localCache, isValid }) => {
          if (this._afeiAbortByUser) {
            throw new Error("download-aborted");
          }
          if (isValid && localCache && localCache.version === latestConfig.version) {
            this.updateAfeiPreparationProgress(100);
            wx.showToast({ title: "阿飞历险记已准备就绪", icon: "none" });
            return null;
          }
          const controller = startLatestEasterEggResourceDownload({
            fileName: latestConfig.fileName,
            version: latestConfig.version,
            segmentCount: 20,
            onProgress: (progress) => {
              this.updateAfeiPreparationProgress(progress);
            }
          });
          this._afeiDownloadController = controller;
          return controller.promise;
        })
        .then((downloadResult) => {
          if (this._afeiAbortByUser) {
            throw new Error("download-aborted");
          }
          if (!downloadResult || !downloadResult.tempFilePath || !latestConfig) {
            return null;
          }
          return cacheEasterEggResourceDownload({
            tempFilePath: downloadResult.tempFilePath,
            fileName: latestConfig.fileName,
            version: latestConfig.version
          });
        })
        .then((cachedResult) => {
          if (!cachedResult) return;
          this.updateAfeiPreparationProgress(100);
          wx.showToast({ title: "阿飞历险记准备完成", icon: "none" });
        })
        .catch((err) => {
          const message = `${err?.message || err?.errMsg || ""}`.trim();
          if (message === "download-aborted" || this._afeiAbortByUser) {
            return;
          }
          if (message === "missing-token") {
            wx.showToast({ title: "请先登录后再试", icon: "none" });
            return;
          }
          const lower = message.toLowerCase();
          if (lower.includes("storage limit") || lower.includes("maximum size of the file storage")) {
            wx.showToast({ title: "本地存储空间不足，请清理后重试", icon: "none" });
            return;
          }
          wx.showToast({ title: "阿飞历险记准备失败", icon: "none" });
          console.warn("afei preparation failed", err);
        })
        .finally(() => {
          this.cleanupAfeiPreparationInternals();
          if (this.data.afeiPreparing || this.data.afeiProgressPercent !== 0) {
            this.setData({
              afeiPreparing: false,
              afeiProgressPercent: 0
            });
          }
        });
    },

    cleanupAfeiPreparationInternals() {
      this._afeiDownloadController = null;
    },

    updateAfeiPreparationProgress(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      const bounded = Math.max(0, Math.min(100, Math.round(numeric)));
      const current = Number(this.data.afeiProgressPercent) || 0;
      const next = Math.max(current, bounded);
      if (next === current) return;
      this.setData({ afeiProgressPercent: next });
    },

    confirmCloseSheetDuringAfeiPreparation() {
      wx.showModal({
        title: "提示",
        content: "阿飞历险记正在准备中，直接关闭？",
        confirmText: "是",
        cancelText: "否",
        success: (res = {}) => {
          if (!res.confirm) return;
          this.abortAfeiPreparation({ closeSheet: true });
        }
      });
    },

    abortAfeiPreparation(options = {}) {
      const { closeSheet = false, silent = false } = options;
      this._afeiAbortByUser = true;
      const controller = this._afeiDownloadController;
      this._afeiDownloadController = null;
      if (controller && typeof controller.abort === "function") {
        controller.abort();
      }
      const finalize = () => {
        if (!silent && closeSheet) {
          this.closeSheet();
        } else if (closeSheet) {
          this.closeSheet();
        }
      };
      if (this.data.afeiPreparing || this.data.afeiProgressPercent) {
        this.setData(
          {
            afeiPreparing: false,
            afeiProgressPercent: 0
          },
          finalize
        );
      } else {
        finalize();
      }
    },

    closeSheet() {
      if (!this.data.sheetVisible || this.data.sheetClosing) return;
      this.setData({ sheetClosing: true });
      if (this._closeTimer) {
        clearTimeout(this._closeTimer);
      }
      this._closeTimer = setTimeout(() => {
        this._closeTimer = null;
        this.setData({
          sheetVisible: false,
          sheetClosing: false
        });
        this.triggerEvent("close");
      }, 220);
    }
  }
});
