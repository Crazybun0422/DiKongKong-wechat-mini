const LONGPRESS_DONE_STORAGE_KEY = "compass_center_pin_longpress_done_v1";

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
    sheetTitle: {
      type: String,
      value: "中心点操作开发中"
    },
    sheetDesc: {
      type: String,
      value: "详细功能开发中,敬请期待"
    },
    closeText: {
      type: String,
      value: "知道了"
    }
  },

  data: {
    triggered: false,
    sheetVisible: false,
    sheetClosing: false,
    showWelcomeBubble: false
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

    onCloseTap() {
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
