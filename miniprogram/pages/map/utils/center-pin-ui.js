const {
  gcj02ToWgs84,
  gcj02ToBd09,
  gcj02ToCgcs2000
} = require("../../../utils/coords");
const { hasValidCoordinate } = require("./map-shared");
const {
  COORDINATE_SYSTEM_OPTIONS,
  resolveCoordinateSystemDisplayLabel
} = require("./coordinate-system");

const formatCoordinateParts = (lat, lng) => {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
  const latText = latNum.toFixed(6);
  const lngText = lngNum.toFixed(6);
  return { lngText, latText };
};

const formatCoordinateDisplayParts = (lat, lng) => {
  const parts = formatCoordinateParts(lat, lng);
  if (!parts) return null;
  const latNum = Number(lat);
  const lngNum = Number(lng);
  return {
    lngText: `${parts.lngText}°${lngNum >= 0 ? "E" : "W"}`,
    latText: `${parts.latText}°${latNum >= 0 ? "N" : "S"}`
  };
};

const formatDmsUnit = (value) => {
  const abs = Math.abs(Number(value) || 0);
  const degree = Math.floor(abs);
  const minuteFloat = (abs - degree) * 60;
  const minute = Math.floor(minuteFloat);
  const second = (minuteFloat - minute) * 60;
  const secondText = Number(second.toFixed(2)).toString();
  return `${degree}°${minute}'${secondText}"`;
};

const formatCoordinateDms = (value, axis) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const direction =
    axis === "lng"
      ? (numeric >= 0 ? "东经" : "西经")
      : (numeric >= 0 ? "北纬" : "南纬");
  return `${direction}${formatDmsUnit(numeric)}`;
};

const normalizeAddressText = (value) => {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
};

const COORDINATE_SYSTEM_CLIPBOARD_LABEL_MAP = {
  gcj02: "GCJ-02",
  bd09: "BD09",
  wgs84: "WGS84",
  cgcs2000: "CGCS2000"
};

const normalizeCoordinateSystem = (value) => {
  const raw = `${value || ""}`.toLowerCase();
  return COORDINATE_SYSTEM_OPTIONS.some((item) => item.value === raw) ? raw : "gcj02";
};

const resolveCoordinateSystemLabel = (coordinateSystem) =>
  COORDINATE_SYSTEM_CLIPBOARD_LABEL_MAP[normalizeCoordinateSystem(coordinateSystem)] || "GCJ-02";

const convertCoordinateFromGcj02 = (lng, lat, coordinateSystem = "gcj02") => {
  const baseLng = Number(lng);
  const baseLat = Number(lat);
  if (!Number.isFinite(baseLng) || !Number.isFinite(baseLat)) return null;
  const normalized = normalizeCoordinateSystem(coordinateSystem);
  let converted = { lng: baseLng, lat: baseLat };
  if (normalized === "wgs84") {
    converted = gcj02ToWgs84(baseLng, baseLat);
  } else if (normalized === "bd09") {
    converted = gcj02ToBd09(baseLng, baseLat);
  } else if (normalized === "cgcs2000") {
    converted = gcj02ToCgcs2000(baseLng, baseLat);
  }
  const outLng = Number(converted?.lng);
  const outLat = Number(converted?.lat);
  if (!Number.isFinite(outLng) || !Number.isFinite(outLat)) {
    return { lng: baseLng, lat: baseLat };
  }
  return { lng: outLng, lat: outLat };
};

const buildCoordinateClipboardText = ({
  lat,
  lng,
  coordinateSystem = "gcj02",
  address = ""
} = {}) => {
  const decimal = formatCoordinateParts(lat, lng);
  if (!decimal) return "";
  const lngDms = formatCoordinateDms(lng, "lng");
  const latDms = formatCoordinateDms(lat, "lat");
  const normalizedAddress = normalizeAddressText(address);
  const lines = [
    `坐标系：${resolveCoordinateSystemLabel(coordinateSystem)}`,
    `经度(十进制)：${decimal.lngText}`,
    `纬度(十进制)：${decimal.latText}`,
    `经度(时分秒)：${lngDms || "-"}`,
    `纬度(时分秒)：${latDms || "-"}`,
    `详细地址：${normalizedAddress || "未获取到地址"}`
  ];
  return lines.join("\n");
};

function updateCenterPinIndicator(page, centerOverride) {
  const center = centerOverride || page._centerOverride || page.data.center;
  if (!center || !hasValidCoordinate(center.latitude, center.longitude)) {
    page.setData({
      centerPinTitle: "",
      centerCoordinateLatText: "",
      centerCoordinateLngText: "",
      centerCoordinateLatValue: null,
      centerCoordinateLngValue: null,
      centerElevationText: "",
      searchLinkCenter: null,
      centerPinLinkActive: false,
      centerPinLinkTipText: "",
      cityReportCenter: null
    });
    return;
  }
  let displayLat = Number(center.latitude);
  let displayLng = Number(center.longitude);
  const converted = convertCoordinateFromGcj02(
    Number(center.longitude),
    Number(center.latitude),
    page.data.coordinateSystem
  );
  if (converted && hasValidCoordinate(converted.lat, converted.lng)) {
    displayLat = converted.lat;
    displayLng = converted.lng;
  }
  const pin = page.findPinContainingPoint(center);
  const coord = formatCoordinateDisplayParts(displayLat, displayLng);
  const normalizedCenter = {
    latitude: Number(center.latitude),
    longitude: Number(center.longitude)
  };
  const linkState = page.buildCenterPinLinkState(normalizedCenter, {
    target: page.data.searchLinkTarget,
    visible: page.data.searchLinkVisible,
    owner: page._searchLinkOwner
  });
  page.setData({
    centerPinTitle: pin ? pin.name || "" : "",
    centerCoordinateLngText: coord ? coord.lngText : "",
    centerCoordinateLatText: coord ? coord.latText : "",
    centerCoordinateLngValue: Number.isFinite(displayLng) ? displayLng : null,
    centerCoordinateLatValue: Number.isFinite(displayLat) ? displayLat : null,
    searchLinkCenter: normalizedCenter,
    cityReportCenter: normalizedCenter,
    ...linkState
  }, () => {
    if (
      page.data.searchLinkVisible === true &&
      hasValidCoordinate(page.data.searchLinkTarget?.latitude, page.data.searchLinkTarget?.longitude) &&
      typeof page.requestSearchLinkElevationDiff === "function"
    ) {
      page.requestSearchLinkElevationDiff(page.data.searchLinkTarget, {
        center: normalizedCenter
      });
    }
  });
}

function onCenterCoordinateTap(page) {
  const center = page._centerOverride || page.data.center;
  const hasCenter = hasValidCoordinate(center?.latitude, center?.longitude);
  let displayLat = hasCenter ? Number(center.latitude) : Number(page.data.centerCoordinateLatValue);
  let displayLng = hasCenter ? Number(center.longitude) : Number(page.data.centerCoordinateLngValue);

  if (hasCenter) {
    const converted = convertCoordinateFromGcj02(
      Number(center.longitude),
      Number(center.latitude),
      page.data.coordinateSystem
    );
    if (converted && hasValidCoordinate(converted.lat, converted.lng)) {
      displayLat = converted.lat;
      displayLng = converted.lng;
    }
  }

  if (!Number.isFinite(displayLat) || !Number.isFinite(displayLng)) return;

  const showCopyLoading = !page._isIOS;
  if (showCopyLoading) {
    wx.showLoading({ title: "经纬度解析中", mask: false });
  }

  const copyResolvedText = (address = "") => {
    const text = buildCoordinateClipboardText({
      lat: displayLat,
      lng: displayLng,
      coordinateSystem: page.data.coordinateSystem,
      address
    });
    if (!text) {
      if (showCopyLoading) {
        wx.hideLoading();
      }
      wx.showToast({ title: "复制失败", icon: "none" });
      return;
    }
    let copied = false;
    wx.setClipboardData({
      data: text,
      success: () => {
        copied = true;
      },
      fail: (err) => {
        console.error("复制经纬度失败", err);
        if (showCopyLoading) {
          wx.hideLoading();
        }
        wx.showToast({ title: "复制失败", icon: "none" });
      },
      complete: () => {
        if (showCopyLoading) {
          wx.hideLoading();
        }
        if (copied && !page._isIOS) {
          setTimeout(() => {
            wx.showToast({ title: "经纬度已复制", icon: "success", duration: 1500 });
          }, 120);
        }
      }
    });
  };

  if (!hasCenter) {
    copyResolvedText("");
    return;
  }

  page.requestPinAddress(Number(center.latitude), Number(center.longitude))
    .then((address) => copyResolvedText(address || ""))
    .catch((err) => {
      console.warn("center reverse geocode failed", err);
      copyResolvedText("");
    });
}

function onCoordinateSystemToggle(page) {
  if (page.data.coordinateSystemSheetVisible) return;
  page.setData({ coordinateSystemSheetVisible: true });
  if (page.getAuthToken()) {
    page.loadMapGuideConfigs().catch((err) => {
      console.warn("loadMapGuideConfigs onCoordinateSystemToggle failed", err);
    });
  }
}

function onCoordinateSystemSheetTap() {}

function onCoordinateSystemSheetMaskTap(page) {
  if (!page.data.coordinateSystemSheetVisible) return;
  page.setData({ coordinateSystemSheetVisible: false });
}

function onCoordinateSystemOptionTap(page, event) {
  const next = normalizeCoordinateSystem(event?.currentTarget?.dataset?.value || event?.detail?.value);
  const changed = next !== page.data.coordinateSystem;
  const updates = {
    coordinateSystemSheetVisible: false
  };
  if (changed) {
    updates.coordinateSystem = next;
    updates.coordinateSystemLabel = resolveCoordinateSystemDisplayLabel(next);
  }
  page.setData(updates, () => {
    if (changed) {
      page.updateCenterPinIndicator();
    }
  });
}

function shouldDismissCenterPinWelcomeBubbleOnRegionChange(cause = "") {
  const normalized = `${cause || ""}`.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "drag" ||
    normalized === "gesture" ||
    normalized === "scale" ||
    normalized === "rotate" ||
    normalized === "skew" ||
    normalized === "overlook"
  );
}

function dismissCenterPinWelcomeBubble(page) {
  const nextToken = (Number(page.data.centerPinWelcomeBubbleDismissToken) || 0) + 1;
  page.setData({ centerPinWelcomeBubbleDismissToken: nextToken });
}

function buildStealthModeSnapshot(page) {
  return {
    layerPanelVisible: !!page.data.layerPanelVisible,
    coordinateSystemSheetVisible: !!page.data.coordinateSystemSheetVisible
  };
}

function enterStealthMode(page) {
  if (page.data.stealthModeActive) return;
  page._stealthModeSnapshot = buildStealthModeSnapshot(page);
  if (page._layerPanelCloseTimer) {
    clearTimeout(page._layerPanelCloseTimer);
    page._layerPanelCloseTimer = null;
  }
  page.setData({
    stealthModeActive: true,
    layerPanelVisible: false,
    layerPanelClosing: false,
    coordinateSystemSheetVisible: false,
    cityReportDialogVisible: false,
    searchCoordinateTipsVisible: false
  });
}

function exitStealthMode(page) {
  if (!page.data.stealthModeActive) return;
  const snapshot = page._stealthModeSnapshot || {};
  page._stealthModeSnapshot = null;
  page.setData({
    stealthModeActive: false,
    layerPanelVisible: !!snapshot.layerPanelVisible,
    layerPanelClosing: false,
    coordinateSystemSheetVisible: !!snapshot.coordinateSystemSheetVisible
  });
}

module.exports = {
  updateCenterPinIndicator,
  onCenterCoordinateTap,
  onCoordinateSystemToggle,
  onCoordinateSystemSheetTap,
  onCoordinateSystemSheetMaskTap,
  onCoordinateSystemOptionTap,
  shouldDismissCenterPinWelcomeBubbleOnRegionChange,
  dismissCenterPinWelcomeBubble,
  buildStealthModeSnapshot,
  enterStealthMode,
  exitStealthMode
};
