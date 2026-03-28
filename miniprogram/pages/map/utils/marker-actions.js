const { like, unlike, fetchLikeCount, fetchLikeStatus } = require("../../../utils/likes");
const {
  incrementMarkerPhoneCall,
  incrementMarkerExposure
} = require("../../../utils/markers");
const { incrementPinExposure } = require("../../../utils/pins");

const MARKER_EXPOSURE_CACHE_TTL = 5 * 60 * 1000;

function formatLikeCountDisplay(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return "0";
  if (num >= 1000) {
    const k = num / 1000;
    return `${Math.round(k * 10) / 10}k`;
  }
  return `${Math.floor(num)}`;
}

function resolveEventDataset(event = {}) {
  const currentTargetDataset = event?.currentTarget?.dataset;
  if (
    currentTargetDataset &&
    typeof currentTargetDataset === "object" &&
    Object.keys(currentTargetDataset).length
  ) {
    return currentTargetDataset;
  }
  const detailDataset = event?.detail?.dataset;
  if (
    detailDataset &&
    typeof detailDataset === "object" &&
    Object.keys(detailDataset).length
  ) {
    return detailDataset;
  }
  return {};
}

function resolveLikeEventPageFlag(event = {}) {
  if (event?.currentTarget?.dataset?.page !== undefined) {
    return event.currentTarget.dataset.page;
  }
  return event?.detail?.page;
}

function resolveLikeCountFromEvent(event = {}) {
  const detailCount = Number(event?.detail?.count);
  if (Number.isFinite(detailCount)) {
    return detailCount;
  }
  return Number(resolveEventDataset(event).count);
}

function makePhoneCall(page, phone, options = {}) {
  const value = typeof phone === "string" ? phone.trim() : `${phone || ""}`.trim();
  const markerIdRaw = options.markerId !== undefined && options.markerId !== null ? `${options.markerId}` : "";
  const markerId = markerIdRaw.trim();
  if (!value) {
    wx.showToast({ title: "暂无联系电话", icon: "none" });
    return;
  }
  if (typeof wx?.makePhoneCall === "function") {
    wx.makePhoneCall({
      phoneNumber: value,
      success: () => {
        if (markerId) {
          incrementMarkerPhoneCallCount(page, markerId);
        }
      }
    });
    return;
  }
  if (typeof wx?.setClipboardData === "function") {
    wx.setClipboardData({
      data: value,
      success: () => {
        wx.showToast({ title: "号码已复制", icon: "none" });
      }
    });
    return;
  }
  wx.showToast({ title: "请手动拨打", icon: "none" });
}

function openCallSheet(page, options = {}) {
  const phoneValue =
    typeof options.phone === "string"
      ? options.phone.trim()
      : `${options.phone || ""}`.trim();
  if (!phoneValue) {
    wx.showToast({ title: "暂无联系电话", icon: "none" });
    return;
  }
  const markerId =
    options.markerId !== undefined && options.markerId !== null
      ? `${options.markerId}`.trim()
      : "";
  const markerName = typeof options.name === "string" ? options.name : "";
  page.setData({
    callSheetVisible: true,
    callSheetPhone: phoneValue,
    callSheetMarkerId: markerId,
    callSheetMarkerName: markerName
  });
}

function hideCallSheet(page) {
  if (!page.data.callSheetVisible) {
    return;
  }
  page.setData({
    callSheetVisible: false,
    callSheetPhone: "",
    callSheetMarkerId: "",
    callSheetMarkerName: ""
  });
}

function onCallSheetConfirm(page) {
  const phone = page.data.callSheetPhone || "";
  const markerId = page.data.callSheetMarkerId || "";
  hideCallSheet(page);
  makePhoneCall(page, phone, { markerId });
}

function onCallSheetCancel(page) {
  hideCallSheet(page);
}

function onCallSheetMaskTap(page) {
  hideCallSheet(page);
}

function incrementMarkerPhoneCallCount(page, markerId) {
  if (!markerId) {
    return;
  }
  incrementMarkerPhoneCall(markerId, {
    apiBase: page.getApiBase(),
    token: page.getAuthToken()
  }).catch((err) => {
    console.warn("Increment marker phone call failed", err);
  });
}

function incrementMarkerExposureCount(page, markerId) {
  if (!markerId) {
    return;
  }
  incrementMarkerExposure(markerId, {
    apiBase: page.getApiBase(),
    token: page.getAuthToken()
  }).catch((err) => {
    console.warn("Increment marker exposure failed", err);
  });
}

function incrementPinExposureCount(page, pinId) {
  if (!pinId) {
    return;
  }
  incrementPinExposure(pinId, {
    apiBase: page.getApiBase(),
    token: page.getAuthToken()
  }).catch((err) => {
    console.warn("Increment pin exposure failed", err);
  });
}

function pruneMarkerExposureCache(page, now = Date.now()) {
  if (!page._markerExposureCache || typeof page._markerExposureCache.forEach !== "function") {
    return;
  }
  const threshold = now - MARKER_EXPOSURE_CACHE_TTL;
  const staleKeys = [];
  page._markerExposureCache.forEach((timestamp, key) => {
    if (!Number.isFinite(timestamp) || timestamp < threshold) {
      staleKeys.push(key);
    }
  });
  staleKeys.forEach((key) => page._markerExposureCache.delete(key));
}

function prunePinExposureCache(page, now = Date.now()) {
  if (!page._pinExposureCache || typeof page._pinExposureCache.forEach !== "function") {
    return;
  }
  const threshold = now - MARKER_EXPOSURE_CACHE_TTL;
  const staleKeys = [];
  page._pinExposureCache.forEach((timestamp, key) => {
    if (!Number.isFinite(timestamp) || timestamp < threshold) {
      staleKeys.push(key);
    }
  });
  staleKeys.forEach((key) => page._pinExposureCache.delete(key));
}

function trackMarkerExposure(page, markers) {
  if (!Array.isArray(markers) || !markers.length) {
    return;
  }
  if (!page._markerExposureCache) {
    page._markerExposureCache = new Map();
  }
  const now = Date.now();
  pruneMarkerExposureCache(page, now);
  markers.forEach((marker) => {
    const detail = page.resolveMarkerDetail(marker);
    const markerId = page.resolveMarkerNewId(detail, marker);
    if (!markerId || markerId.startsWith("nearby-")) {
      return;
    }
    const lastExposure = page._markerExposureCache.get(markerId);
    if (Number.isFinite(lastExposure) && now - lastExposure < MARKER_EXPOSURE_CACHE_TTL) {
      return;
    }
    page._markerExposureCache.set(markerId, now);
    incrementMarkerExposureCount(page, markerId);
  });
}

function trackPinExposure(page, markers) {
  if (!Array.isArray(markers) || !markers.length) {
    return;
  }
  if (!page._pinExposureCache) {
    page._pinExposureCache = new Map();
  }
  const now = Date.now();
  prunePinExposureCache(page, now);
  markers.forEach((marker) => {
    const src = `${marker?.extData?.source || marker?.source || ""}`.toLowerCase();
    if (!src.includes("pin")) return;
    const shapeType = `${marker?.extData?.raw?.shape?.type || marker?.shape?.type || ""}`.toUpperCase();
    if (shapeType && shapeType !== "POINT") return;
    const candidateId =
      marker?.extData?.raw?.id ||
      marker?.id ||
      marker?.markerId ||
      marker?.markerID ||
      "";
    const pinId = typeof candidateId === "string" ? candidateId.trim() : `${candidateId || ""}`.trim();
    if (!pinId || pinId.startsWith("nearby-")) return;
    const last = page._pinExposureCache.get(pinId);
    if (Number.isFinite(last) && now - last < MARKER_EXPOSURE_CACHE_TTL) {
      return;
    }
    page._pinExposureCache.set(pinId, now);
    incrementPinExposureCount(page, pinId);
  });
}

function openMarkerLocation(page, detail, overrides = {}) {
  const latitude = Number(overrides.latitude ?? detail?.latitude);
  const longitude = Number(overrides.longitude ?? detail?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    wx.showToast({ title: "暂无定位信息", icon: "none" });
    return;
  }
  const name = overrides.name || detail?.name || "商户位置";
  const address = overrides.address || detail?.locationText || "";
  if (typeof wx?.openLocation === "function") {
    wx.openLocation({
      latitude,
      longitude,
      name,
      address
    });
    return;
  }
  wx.showToast({ title: "当前环境不支持导航", icon: "none" });
}

function resolveLikeTargetType(target = {}) {
  const source = (target?.extData?.source || target?.source || "").toLowerCase();
  const raw = target?.extData?.raw || target.raw || {};
  if (source.includes("pin") || raw.shape || (target?.shape && target.shape.coordinates)) {
    return "PIN";
  }
  return "MARKER";
}

function resolveDeepRaw(raw = {}) {
  let current = raw;
  const seen = new Set();
  while (
    current &&
    typeof current === "object" &&
    current.raw &&
    typeof current.raw === "object" &&
    !seen.has(current.raw)
  ) {
    seen.add(current.raw);
    current = current.raw;
  }
  return current && typeof current === "object" ? current : {};
}

function resolveMarkerNewId(page, detail = {}, marker = {}) {
  const rawSource = resolveDeepRaw(detail.raw || marker?.extData?.raw || marker?.raw || {});
  const extDetail = marker?.extData?.detail || {};
  const value =
    rawSource.markIdNew ??
    detail.markIdNew ??
    marker.markIdNew ??
    extDetail.markIdNew ??
    "";
  return value ? `${value}`.trim() : "";
}

function resolveLikeTargetId(page, detail = {}, marker = {}, type = "") {
  const rawSource = page.resolveDeepRaw(detail.raw || marker?.extData?.raw || marker?.raw || {});
  const extDetail = marker?.extData?.detail || {};
  const isPin = type === "PIN";
  const preferred = isPin
    ? (
      rawSource.pinIdNew ??
      detail.pinIdNew ??
      marker.pinIdNew ??
      extDetail.pinIdNew
    )
    : (
      rawSource.markIdNew ??
      detail.markIdNew ??
      marker.markIdNew ??
      extDetail.markIdNew
    );
  const chosen = preferred !== undefined && preferred !== null ? preferred : "";
  return chosen ? `${chosen}`.trim() : "";
}

function applyLikeState(page, prefix, payload = {}) {
  const count = Number(payload.count);
  const liked = !!payload.liked;
  const type = payload.type || "";
  const id = payload.id || "";
  const updates = {};
  updates[`${prefix}LikeCount`] = Number.isFinite(count) && count >= 0 ? count : 0;
  updates[`${prefix}Liked`] = liked;
  updates[`${prefix}LikeTargetType`] = type;
  updates[`${prefix}LikeTargetId`] = id;
  updates[`${prefix}LikeCountDisplay`] = formatLikeCountDisplay(updates[`${prefix}LikeCount`]);
  page.setData(updates);
}

function loadMarkerLikeInfo(page, options = {}) {
  const detail = options.detail || {};
  const marker = options.target || {};
  const forPage = !!options.forPage;
  const prefix = forPage ? "markerPage" : "marker";
  const type = resolveLikeTargetType(marker || detail);
  const id = resolveLikeTargetId(page, detail, marker, type);
  if (!type || !id) {
    applyLikeState(page, prefix, { count: 0, liked: false, type: "", id: "" });
    return;
  }
  applyLikeState(page, prefix, { count: 0, liked: false, type, id });
  const apiBase = page.getApiBase();
  fetchLikeCount(type, id, { apiBase })
    .then((data) => {
      applyLikeState(page, prefix, {
        count: data.likeCount || 0,
        liked: page.data[`${prefix}Liked`],
        type,
        id
      });
    })
    .catch((err) => {
      console.warn("fetchLikeCount failed", err);
    });
  fetchLikeStatus(type, id, { apiBase, token: page.getAuthToken() })
    .then((data) => {
      applyLikeState(page, prefix, {
        count: page.data[`${prefix}LikeCount`],
        liked: !!data.liked,
        type,
        id
      });
    })
    .catch((err) => {
      if (err?.message === "missing-token") {
        applyLikeState(page, prefix, {
          count: page.data[`${prefix}LikeCount`],
          liked: false,
          type,
          id
        });
        return;
      }
      console.warn("fetchLikeStatus failed", err);
    });
}

function cancelLikeHold(page, prefix, resetAnim = true) {
  if (page._likeHoldTimers && page._likeHoldTimers[prefix]) {
    clearTimeout(page._likeHoldTimers[prefix]);
    page._likeHoldTimers[prefix] = null;
  }
  if (page._likeHoldFired) {
    page._likeHoldFired[prefix] = false;
  }
  if (resetAnim) {
    const updates = {};
    updates[`${prefix}LikeAnimating`] = false;
    updates[`${prefix}LikeHoldLabel`] = "";
    updates[`${prefix}LikeLabelType`] = "";
    page.setData(updates);
  }
}

function onMarkerLikeTouchStart(page, event) {
  const pageFlag = resolveLikeEventPageFlag(event);
  const forPage = pageFlag === true || pageFlag === "true";
  const prefix = forPage ? "markerPage" : "marker";
  const type = page.data[`${prefix}LikeTargetType`];
  const id = page.data[`${prefix}LikeTargetId`];
  if (!type || !id) {
    wx.showToast({ title: "无法点赞", icon: "none" });
    return;
  }
  cancelLikeHold(page, prefix, false);
  page.setData({
    [`${prefix}LikeAnimating`]: true,
    [`${prefix}LikeResultLabel`]: ""
  });
  page._likeHoldFired[prefix] = false;
  const liked = page.data[`${prefix}Liked`];
  const currentCount = Number(page.data[`${prefix}LikeCount`]) || 0;
  const apiBase = page.getApiBase();
  const doToggle = () =>
    liked
      ? unlike(type, id, { apiBase, token: page.getAuthToken() })
      : like(type, id, { apiBase, token: page.getAuthToken() });
  page._likeHoldTimers[prefix] = setTimeout(() => {
    page._likeHoldFired[prefix] = true;
    doToggle()
      .catch((err) => {
        if (err?.message === "missing-token") {
          return page.ensureAccessToken().then(() => doToggle());
        }
        throw err;
      })
      .then(() => {
        const delta = liked ? -1 : 1;
        const nextCount = Math.max(0, currentCount + delta);
        applyLikeState(page, prefix, {
          count: nextCount,
          liked: !liked,
          type,
          id
        });
        const label = liked ? "取消赞" : "点赞+1";
        page.setData({
          [`${prefix}LikeResultLabel`]: label
        });
        setTimeout(() => {
          page.setData({
            [`${prefix}LikeResultLabel`]: ""
          });
        }, 3000);
      })
      .catch((err) => {
        console.warn("like toggle failed", err);
      })
      .finally(() => {
        const done = {};
        done[`${prefix}LikeAnimating`] = false;
        page.setData(done);
        page._likeHoldTimers[prefix] = null;
      });
  }, 10);
}

function onMarkerLikeTouchEnd(page, event) {
  const pageFlag = resolveLikeEventPageFlag(event);
  const forPage = pageFlag === true || pageFlag === "true";
  const prefix = forPage ? "markerPage" : "marker";
  if (!page._likeHoldFired[prefix]) {
    cancelLikeHold(page, prefix, true);
  }
}

function onLikeCountTap(page, event) {
  const count = resolveLikeCountFromEvent(event);
  if (!Number.isFinite(count)) return;
}

module.exports = {
  makePhoneCall,
  openCallSheet,
  hideCallSheet,
  onCallSheetConfirm,
  onCallSheetCancel,
  onCallSheetMaskTap,
  incrementMarkerPhoneCallCount,
  incrementMarkerExposureCount,
  incrementPinExposureCount,
  pruneMarkerExposureCache,
  prunePinExposureCache,
  trackMarkerExposure,
  trackPinExposure,
  openMarkerLocation,
  resolveDeepRaw,
  resolveMarkerNewId,
  resolveLikeTargetType,
  resolveLikeTargetId,
  applyLikeState,
  loadMarkerLikeInfo,
  cancelLikeHold,
  onMarkerLikeTouchStart,
  onMarkerLikeTouchEnd,
  onLikeCountTap
};
