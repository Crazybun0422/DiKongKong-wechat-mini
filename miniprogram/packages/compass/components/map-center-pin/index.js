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
      value: "中心点操作"
    },
    sheetDesc: {
      type: String,
      value: "已识别长按手势，底部弹框已唤起。"
    },
    closeText: {
      type: String,
      value: "知道了"
    }
  },

  data: {
    triggered: false,
    sheetVisible: false,
    sheetClosing: false
  },

  lifetimes: {
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
    onLongPress() {
      if (this.data.sheetVisible || this.data.sheetClosing) return;
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
