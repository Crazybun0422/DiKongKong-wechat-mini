const PREFLIGHT_GLOW_DURATION_MS = 9600;
const PREFLIGHT_GLOW_FRAME_MS = 33;
const PREFLIGHT_GLOW_SEGMENT_RPX = 22;
const PREFLIGHT_ENTRY_CANVAS_INSET_RPX = 0;
const PREFLIGHT_ENTRY_BORDER_WIDTH_RPX = 1;
const PREFLIGHT_GLOW_DISABLED = true;

function getWindowMetrics() {
  try {
    if (typeof wx.getWindowInfo === "function") {
      return wx.getWindowInfo();
    }
  } catch (error) {}
  try {
    return wx.getSystemInfoSync();
  } catch (error) {
    return { windowWidth: 375, pixelRatio: 1 };
  }
}

function rpxToPx(value) {
  const metrics = getWindowMetrics();
  const width = Number(metrics.windowWidth) || 375;
  return value * width / 750;
}

function isIOSDevice() {
  try {
    const info = wx.getSystemInfoSync();
    const system = `${info.system || ""}`.toLowerCase();
    const platform = `${info.platform || ""}`.toLowerCase();
    return platform === "ios" || system.includes("ios");
  } catch (error) {
    return false;
  }
}

function wrapPathLength(value, total) {
  if (!(total > 0)) {
    return 0;
  }
  let normalized = value % total;
  if (normalized < 0) {
    normalized += total;
  }
  return normalized;
}

function buildRoundedRectPath(ctx, x, y, width, height, radius) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.arc(x + width - safeRadius, y + safeRadius, safeRadius, -Math.PI / 2, 0);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.arc(x + width - safeRadius, y + height - safeRadius, safeRadius, 0, Math.PI / 2);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.arc(x + safeRadius, y + height - safeRadius, safeRadius, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + safeRadius);
  ctx.arc(x + safeRadius, y + safeRadius, safeRadius, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

function getRoundedRectPointByLength(x, y, width, height, radius, rawLength) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  const topLength = Math.max(width - safeRadius * 2, 0);
  const rightLength = Math.max(height - safeRadius * 2, 0);
  const arcLength = Math.PI * safeRadius / 2;
  const totalLength = topLength * 2 + rightLength * 2 + arcLength * 4;
  let length = wrapPathLength(rawLength, totalLength);

  if (length <= topLength) {
    return { x: x + safeRadius + length, y };
  }
  length -= topLength;

  if (length <= arcLength) {
    const angle = -Math.PI / 2 + length / safeRadius;
    return {
      x: x + width - safeRadius + Math.cos(angle) * safeRadius,
      y: y + safeRadius + Math.sin(angle) * safeRadius
    };
  }
  length -= arcLength;

  if (length <= rightLength) {
    return { x: x + width, y: y + safeRadius + length };
  }
  length -= rightLength;

  if (length <= arcLength) {
    const angle = length / safeRadius;
    return {
      x: x + width - safeRadius + Math.cos(angle) * safeRadius,
      y: y + height - safeRadius + Math.sin(angle) * safeRadius
    };
  }
  length -= arcLength;

  if (length <= topLength) {
    return { x: x + width - safeRadius - length, y: y + height };
  }
  length -= topLength;

  if (length <= arcLength) {
    const angle = Math.PI / 2 + length / safeRadius;
    return {
      x: x + safeRadius + Math.cos(angle) * safeRadius,
      y: y + height - safeRadius + Math.sin(angle) * safeRadius
    };
  }
  length -= arcLength;

  if (length <= rightLength) {
    return { x, y: y + height - safeRadius - length };
  }
  length -= rightLength;

  const angle = Math.PI + length / safeRadius;
  return {
    x: x + safeRadius + Math.cos(angle) * safeRadius,
    y: y + safeRadius + Math.sin(angle) * safeRadius
  };
}

function drawPreflightGlow(ctx, width, height, elapsedMs) {
  if (!ctx || !(width > 0) || !(height > 0)) {
    return;
  }

  const borderWidth = rpxToPx(PREFLIGHT_ENTRY_BORDER_WIDTH_RPX);
  const x = borderWidth / 2;
  const y = borderWidth / 2;
  const glowWidth = Math.max(width - borderWidth, 1);
  const glowHeight = Math.max(height - borderWidth, 1);
  const radius = glowHeight / 2;
  const topLength = Math.max(glowWidth - radius * 2, 0);
  const sideLength = Math.max(glowHeight - radius * 2, 0);
  const arcLength = Math.PI * radius / 2;
  const totalLength = topLength * 2 + sideLength * 2 + arcLength * 4;

  if (!(totalLength > 0)) {
    return;
  }

  const segmentLength = Math.min(rpxToPx(PREFLIGHT_GLOW_SEGMENT_RPX), totalLength * 0.14);
  const centerLength = wrapPathLength(totalLength * (elapsedMs % PREFLIGHT_GLOW_DURATION_MS) / PREFLIGHT_GLOW_DURATION_MS, totalLength);
  const startLength = centerLength - segmentLength / 2;
  const sampleCount = 52;

  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";

  ctx.save();
  buildRoundedRectPath(ctx, x, y, glowWidth, glowHeight, radius);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = borderWidth;
  ctx.shadowBlur = 0;
  ctx.stroke();
  ctx.restore();

  for (let index = 0; index < sampleCount - 1; index += 1) {
    const startRatio = index / (sampleCount - 1);
    const endRatio = (index + 1) / (sampleCount - 1);
    const pointA = getRoundedRectPointByLength(x, y, glowWidth, glowHeight, radius, startLength + segmentLength * startRatio);
    const pointB = getRoundedRectPointByLength(x, y, glowWidth, glowHeight, radius, startLength + segmentLength * endRatio);
    const centerRatio = (startRatio + endRatio) / 2;
    const intensity = Math.max(0, 1 - Math.abs(centerRatio - 0.5) / 0.5);
    const alpha = 0.2 + Math.pow(intensity, 1.22) * 0.8;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pointA.x, pointA.y);
    ctx.lineTo(pointB.x, pointB.y);
    ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.shadowColor = "rgba(255, 255, 255, 0)";
    ctx.shadowBlur = 0;
    ctx.lineWidth = borderWidth;
    ctx.stroke();
    ctx.restore();
  }
}

Component({
  data: {
    preflightGlowCanvasStyle: "",
    searchFieldFocused: false,
    isIOS: false
  },

  options: {
    styleIsolation: "shared"
  },

  lifetimes: {
    ready() {
      this.setData({ isIOS: isIOSDevice() });
      // 光轨逻辑保留，当前仅停用，不执行初始化
      // this.schedulePreflightGlowInit();
    },

    detached() {
      this.stopPreflightGlow();
    }
  },

  pageLifetimes: {
    show() {
      // 光轨逻辑保留，当前仅停用，不执行初始化
      // this.schedulePreflightGlowInit();
    },

    hide() {
      this.stopPreflightGlow();
    }
  },

  properties: {
    stealthModeActive: { type: Boolean, value: false },
    topPx: { type: Number, value: 0 },
    leftPx: { type: Number, value: 0 },
    uiScaleStyle: { type: String, value: "" },
    dronePickerLabel: { type: String, value: "" },
    temporaryNoFlyZoneInfo: { type: Object, value: null },
    temporaryNoFlyTone: { type: String, value: "" },
    temporaryNoFlyText: { type: String, value: "" },
    uomLoading: { type: Boolean, value: false },
    uomTone: { type: String, value: "" },
    uomStatus: { type: String, value: "" },
    djiTone: { type: String, value: "" },
    djiColor: { type: String, value: "" },
    djiStatus: { type: String, value: "" },
    djiStatusExtra: { type: String, value: "" },
    centerPinTitle: { type: String, value: "" },
    keyword: { type: String, value: "" },
    searchSuggestions: { type: Array, value: [] },
    searchSuggestLoading: { type: Boolean, value: false },
    searchSuggestError: { type: String, value: "" },
    cityReportCenter: { type: Object, value: null },
    cityReportActive: { type: Boolean, value: false },
    cityReportDialogVisible: { type: Boolean, value: false },
    cityReportDialogText: { type: String, value: "" }
  },

  observers: {
    stealthModeActive(value) {
      if (PREFLIGHT_GLOW_DISABLED) {
        return;
      }
      if (value) {
        this.stopPreflightGlow();
        return;
      }
      this.schedulePreflightGlowInit();
    },

    "uiScaleStyle, leftPx, topPx"() {
      if (PREFLIGHT_GLOW_DISABLED || this.properties.stealthModeActive) {
        return;
      }
      this.schedulePreflightGlowInit();
    }
  },

  methods: {
    schedulePreflightGlowInit() {
      if (PREFLIGHT_GLOW_DISABLED || this.properties.stealthModeActive) {
        return;
      }
      clearTimeout(this._preflightGlowInitTimer);
      this._preflightGlowInitTimer = setTimeout(() => {
        this.initPreflightGlowCanvas();
      }, 80);
    },

    initPreflightGlowCanvas() {
      if (PREFLIGHT_GLOW_DISABLED || this.properties.stealthModeActive) {
        return;
      }

      const query = wx.createSelectorQuery().in(this);
      query.select(".preflight-entry").fields({
        rect: true,
        size: true
      });
      query.exec((results = []) => {
        const entryRect = Array.isArray(results) ? results[0] : null;
        if (!entryRect) {
          return;
        }
        const measuredWidth = Math.max(
          Number(entryRect.width) || 0,
          Number(entryRect.right) - Number(entryRect.left) || 0
        );
        const measuredHeight = Math.max(
          Number(entryRect.height) || 0,
          Number(entryRect.bottom) - Number(entryRect.top) || 0
        );
        if (!(measuredWidth > 0) || !(measuredHeight > 0)) {
          return;
        }

        this.stopPreflightGlow();

        const insetPx = rpxToPx(PREFLIGHT_ENTRY_CANVAS_INSET_RPX);
        const localWidth = Math.max(measuredWidth, 1);
        const localHeight = Math.max(measuredHeight, 1);
        const cssWidth = Math.max(localWidth - insetPx * 2, 1);
        const cssHeight = Math.max(localHeight - insetPx * 2, 1);
        const style = `left:${insetPx}px;top:${insetPx}px;width:${cssWidth}px;height:${cssHeight}px;`;

        this.setData({ preflightGlowCanvasStyle: style }, () => {
          this.bindPreflightGlowCanvas(cssWidth, cssHeight);
        });
      });
    },

    bindPreflightGlowCanvas(cssWidth, cssHeight) {
      if (PREFLIGHT_GLOW_DISABLED) {
        return;
      }
      const query = wx.createSelectorQuery().in(this);
      query.select("#preflightEntryGlowCanvas").fields({ node: true });
      query.exec((results = []) => {
        const canvasResult = Array.isArray(results) ? results[0] : null;
        if (!canvasResult || !canvasResult.node) {
          return;
        }

        const metrics = getWindowMetrics();
        const dpr = Math.max(Number(metrics.pixelRatio) || 1, 1);
        const canvas = canvasResult.node;
        const ctx = canvas.getContext("2d");

        canvas.width = Math.max(Math.round(cssWidth * dpr), 1);
        canvas.height = Math.max(Math.round(cssHeight * dpr), 1);
        ctx.scale(dpr, dpr);

        this._preflightGlowCanvas = canvas;
        this._preflightGlowCtx = ctx;
        this._preflightGlowWidth = cssWidth;
        this._preflightGlowHeight = cssHeight;
        this._preflightGlowStartedAt = Date.now();

        this.startPreflightGlowLoop();
      });
    },

    startPreflightGlowLoop() {
      if (PREFLIGHT_GLOW_DISABLED) {
        return;
      }
      this.stopPreflightGlowLoop();
      const renderFrame = () => {
        if (!this._preflightGlowCtx) {
          return;
        }
        const elapsed = Date.now() - (this._preflightGlowStartedAt || Date.now());
        drawPreflightGlow(this._preflightGlowCtx, this._preflightGlowWidth, this._preflightGlowHeight, elapsed);
        this._preflightGlowTimer = setTimeout(renderFrame, PREFLIGHT_GLOW_FRAME_MS);
      };
      renderFrame();
    },

    stopPreflightGlowLoop() {
      if (this._preflightGlowTimer) {
        clearTimeout(this._preflightGlowTimer);
        this._preflightGlowTimer = null;
      }
    },

    stopPreflightGlow() {
      clearTimeout(this._preflightGlowInitTimer);
      this._preflightGlowInitTimer = null;
      this.stopPreflightGlowLoop();
      if (this._preflightGlowCtx) {
        this._preflightGlowCtx.clearRect(0, 0, this._preflightGlowWidth || 0, this._preflightGlowHeight || 0);
      }
      this._preflightGlowCanvas = null;
      this._preflightGlowCtx = null;
      this._preflightGlowWidth = 0;
      this._preflightGlowHeight = 0;
      this._preflightGlowStartedAt = 0;
      this.setData({ preflightGlowCanvasStyle: "" });
    },

    onPreflightEntryTap() {
      this.triggerEvent("preflightentrytap");
    },

    onOpenDronePickerTap() {
      this.triggerEvent("opendronepicker");
    },

    onTemporaryNoticeEntryTap() {
      this.triggerEvent("temporarynoticeentrytap");
    },

    onTemporaryZoneLinkTap(event = {}) {
      const dataset = event.currentTarget?.dataset || {};
      this.triggerEvent("temporaryzonelinktap", {
        path: dataset.path || "",
        link: dataset.link || ""
      });
    },

    onCenterPinIndicatorTap() {
      this.triggerEvent("centerpinindicatortap");
    },

    onKeywordInput(event = {}) {
      this.triggerEvent("keywordinput", event.detail || {});
    },

    onSearchFocus() {
      this.setData({ searchFieldFocused: true });
    },

    onSearchBlur() {
      this.setData({ searchFieldFocused: false });
    },

    onSearchConfirm(event = {}) {
      this.triggerEvent("searchconfirm", event.detail || {});
    },

    onSearchTap() {
      this.triggerEvent("searchtap");
    },

    onSearchCoordinateTipsTap() {
      this.triggerEvent("searchcoordinatetipstap");
    },

    onSuggestionTap(event = {}) {
      const index = Number(event.currentTarget?.dataset?.index);
      this.triggerEvent("suggestiontap", { index });
    },

    onCityReportStateChange(event = {}) {
      this.triggerEvent("cityreportstatechange", event.detail || {});
    },

    onCityReportDialogChange(event = {}) {
      this.triggerEvent("cityreportdialogchange", event.detail || {});
    },

    onCityReportDialogClose() {
      this.triggerEvent("cityreportdialogclose");
    },

    closeCityReportDialog() {
      const host = this.selectComponent("#city-report-h5-entry");
      if (host && typeof host.closeDialog === "function") {
        host.closeDialog();
      }
    }
  }
});
