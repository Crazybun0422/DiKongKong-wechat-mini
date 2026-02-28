const LONGPRESS_DONE_STORAGE_KEY = "compass_center_pin_longpress_done_v1";
const LONGPRESS_ACTION_ITEMS = [
  { id: "quickMark", label: "标记该处", icon: "/packages/map-center-pin/assets/quick-pin.png" },
  { id: "share", label: "分享", icon: "/packages/map-center-pin/assets/share-location.png" },
  { id: "navigate", label: "导航到此处", icon: "/packages/map-center-pin/assets/navigate.png" },
  { id: "askAgent", label: "问问智能体", icon: "/packages/map-center-pin/assets/ask-ai.png" },
  { id: "bindMyLocation", label: "地标绑定", icon: "/packages/map-center-pin/assets/bind-my-location.png" }
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
      this.tryShowWelcomeBubble();
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

  methods: {
    tryShowWelcomeBubble() {
      let hasLongPressed = false;
      try {
        hasLongPressed = !!wx.getStorageSync(LONGPRESS_DONE_STORAGE_KEY);
      } catch (err) {}

      if (hasLongPressed) return;
      this.setData({ showWelcomeBubble: true });
    },

    markWelcomeBubbleDone() {
      try {
        wx.setStorageSync(LONGPRESS_DONE_STORAGE_KEY, 1);
      } catch (err) {}
      this.setData({ showWelcomeBubble: false });
    },

    onTap() {
      if (this.data.sheetVisible || this.data.sheetClosing) return;
      this.triggerEvent("tap");
    },

    onLongPress() {
      if (this.data.sheetVisible || this.data.sheetClosing) return;
      this.markWelcomeBubbleDone();
      this.setData({
        triggered: true,
        sheetVisible: true
      });
      if (typeof wx.vibrateShort === "function") {
        try {
          wx.vibrateShort({ type: "light" });
        } catch (err) {}
      }
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
