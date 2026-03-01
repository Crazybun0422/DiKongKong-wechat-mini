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
    actionItems: LONGPRESS_ACTION_ITEMS
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
      this.closeSheet();
    },

    onActionTap(event = {}) {
      const action = `${event?.currentTarget?.dataset?.action || ""}`.trim();
      if (!action) return;
      this.triggerEvent("action", { action });
      this.closeSheet();
    },

    onSheetTap() {},

    noop() {},

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
