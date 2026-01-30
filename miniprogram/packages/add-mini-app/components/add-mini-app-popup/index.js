const DEFAULT_CAPSULE_WIDTH = 87;
const DEFAULT_CAPSULE_HEIGHT = 32;
const POPUP_SPACING_RPX = 20;
const HOLE_PADDING = 6;
const SAFE_MARGIN = 12;

const getWindowMetrics = () => {
  let windowInfo = {};
  let deviceInfo = {};
  if (typeof wx !== "undefined") {
    if (typeof wx.getWindowInfo === "function") {
      try {
        windowInfo = wx.getWindowInfo() || {};
      } catch (err) {
        windowInfo = {};
      }
    }
    if (typeof wx.getDeviceInfo === "function") {
      try {
        deviceInfo = wx.getDeviceInfo() || {};
      } catch (err) {
        deviceInfo = {};
      }
    }
  }
  const windowWidth = Number(windowInfo.windowWidth) || 375;
  const windowHeight = Number(windowInfo.windowHeight) || 667;
  const statusBarHeight = Number(windowInfo.statusBarHeight || deviceInfo.statusBarHeight) || 0;
  return {
    windowWidth,
    windowHeight,
    statusBarHeight
  };
};

const getMenuButtonRect = (metrics) => {
  if (typeof wx !== "undefined" && typeof wx.getMenuButtonBoundingClientRect === "function") {
    try {
      const rect = wx.getMenuButtonBoundingClientRect();
      if (rect && rect.width && rect.height) {
        return rect;
      }
    } catch (err) {
      // fallback below
    }
  }
  const width = DEFAULT_CAPSULE_WIDTH;
  const height = DEFAULT_CAPSULE_HEIGHT;
  const right = metrics.windowWidth - SAFE_MARGIN;
  const left = Math.max(0, right - width);
  const top = metrics.statusBarHeight + 6;
  const bottom = top + height;
  return {
    width,
    height,
    top,
    bottom,
    left,
    right
  };
};

const buildLayout = () => {
  const metrics = getWindowMetrics();
  const rect = getMenuButtonRect(metrics);
  const left = Math.max(0, rect.left - HOLE_PADDING);
  const top = Math.max(0, rect.top - HOLE_PADDING);
  const right = Math.min(metrics.windowWidth, rect.right + HOLE_PADDING);
  const bottom = Math.min(metrics.windowHeight, rect.bottom + HOLE_PADDING);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const rpxToPx = metrics.windowWidth / 750;
  const popupTop = Math.max(0, bottom + POPUP_SPACING_RPX * rpxToPx);
  return {
    mask: {
      top,
      left,
      width,
      height,
      radius: height / 2,
      rightLeft: right,
      bottomTop: bottom
    },
    popupTop
  };
};

Component({
  data: {
    visible: false,
    mask: {
      top: 0,
      left: 0,
      width: 0,
      height: 0,
      rightLeft: 0,
      bottomTop: 0
    },
    popupTop: 0
  },
  methods: {
    noop() {},
    open() {
      if (this.data.visible) return;
      const layout = buildLayout();
      this.setData({
        visible: true,
        mask: layout.mask,
        popupTop: layout.popupTop
      }, () => {
        this.triggerEvent("statechange", { popupVisible: true, blockMap: true });
      });
    },
    close() {
      if (!this.data.visible) return;
      this.setData({ visible: false }, () => {
        this.triggerEvent("statechange", { popupVisible: false, blockMap: false });
      });
    },
    onMaskTap() {
      if (!this.data.visible) return;
      this.close();
      this.triggerEvent("close");
    },
    onHoleTap() {
      if (!this.data.visible) return;
      this.close();
      this.triggerEvent("close");
    },
    onPopupTap() {}
  }
});
