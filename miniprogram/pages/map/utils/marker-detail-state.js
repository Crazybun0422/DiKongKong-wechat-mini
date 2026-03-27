const { resolveCertifiedState } = require("../../../utils/marker-detail");
const { gcj02ToWgs84 } = require("../../../utils/coords");
const { formatDistanceText, computeGreatCircleDistance } = require("../../../utils/distance");

const MARKER_CERTIFICATION_SHEET_CLOSE_DURATION = 220;
const MARKER_PAGE_SCROLL_TOP_THRESHOLD = 36;
const MARKER_PAGE_CLOSE_FAST_DISTANCE = 50;
const MARKER_PAGE_CLOSE_FAST_DURATION = 600;
const MARKER_PAGE_CLOSE_DISTANCE = 90;
const ATTACHMENT_DISPLAY_LABEL = "企业产品和业务介绍";

function buildBadgeTitleParts(title, fallback = "") {
  const displayText = typeof title === "string" && title ? title : fallback;
  const chars = Array.from(displayText || "");
  const tail = chars.length ? chars.pop() : "";
  return {
    titleDisplayText: displayText,
    titlePrefixText: chars.join(""),
    titleTailText: tail
  };
}

const cloneMarkerDetail = (detail = {}) => {
  if (!detail || typeof detail !== "object") {
    return {};
  }
  const cloneArray = (value) => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item) => (item && typeof item === "object" ? { ...item } : item));
  };
  const cloned = { ...detail };
  cloned.images = cloneArray(detail.images);
  cloned.honors = Array.isArray(detail.honors) ? [...detail.honors] : [];
  cloned.attachments = cloneArray(detail.attachments);
  cloned.qrCodes = cloneArray(detail.qrCodes);
  cloned.videoAccounts = cloneArray(detail.videoAccounts);
  if (detail.primaryVideoAccount && typeof detail.primaryVideoAccount === "object") {
    cloned.primaryVideoAccount = { ...detail.primaryVideoAccount };
  } else if (!detail.primaryVideoAccount) {
    cloned.primaryVideoAccount = null;
  }
  return cloned;
};

const resolveEventDataset = (event = {}) => {
  const detailDataset = event?.detail?.dataset;
  if (detailDataset && typeof detailDataset === "object") {
    return detailDataset;
  }
  const currentTargetDataset = event?.currentTarget?.dataset;
  if (currentTargetDataset && typeof currentTargetDataset === "object") {
    return currentTargetDataset;
  }
  const targetDataset = event?.target?.dataset;
  if (targetDataset && typeof targetDataset === "object") {
    return targetDataset;
  }
  return {};
};

const resolveEventTouches = (event = {}) => {
  if (Array.isArray(event?.detail?.touches) && event.detail.touches.length) {
    return event.detail.touches;
  }
  if (Array.isArray(event?.touches) && event.touches.length) {
    return event.touches;
  }
  return [];
};

const isTruthyFlag = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return ["1", "true", "yes", "y", "on", "share"].includes(normalized);
  }
  return false;
};

function openMarkerDetail(page, marker) {
  if (!marker) return;
  const isPin = `${marker?.extData?.source || marker?.source || ""}`.toLowerCase().includes("pin");
  const pinRaw = marker?.extData?.raw || marker?.raw || null;
  const pinDetail = isPin ? page.buildPinDetailFromPin(pinRaw || marker) : null;
  const detail = pinDetail || page.resolveMarkerDetail(marker);
  console.log("openMarkerDetail", marker, detail);
  if (!detail) {
    wx.showToast({ title: "未找到商户信息", icon: "none" });
    return;
  }

  const viewDetail = applyMarkerCertificationState(page, cloneMarkerDetail(detail));
  page._lastMarkerDetail = viewDetail;
  if (page._markerDetailCloseTimer) {
    clearTimeout(page._markerDetailCloseTimer);
    page._markerDetailCloseTimer = null;
  }
  if (page._markerDetailExpandTimer) {
    clearTimeout(page._markerDetailExpandTimer);
    page._markerDetailExpandTimer = null;
  }
  page._markerDetailExpandLock = false;
  console.log("Displaying marker detail", viewDetail);
  hideMarkerCertificationSheet(page, true);
  page.setData({
    markerDetailVisible: true,
    markerDetailClosing: false,
    markerDetailExpanding: false,
    detailCard: viewDetail,
    markerDetailAllowExpand: true,
    markerDetailCurrentImage: 0,
    markerDetailVideoLoading: isVideoMediaItem(getDetailMediaList(viewDetail)[0])
  });
  page.loadMarkerLikeInfo({ detail: viewDetail, target: marker });
  if (isPin) {
    page.ensurePinAddress(viewDetail);
    page.ensurePlayablePinDetailMedia(viewDetail, { forDetailCard: true });
  }
}

function onMarkerTap(page, event) {
  const markerId = event?.detail?.markerId;
  page._mapTapSuppressUntil = Date.now() + 300;
  const marker = page.findMarkerById(markerId);
  if (!marker) return;
  if (page.isMapTapTargetMarker && page.isMapTapTargetMarker(marker)) return;
  if (typeof page.applySearchSelectionFromMarker === "function") {
    page.applySearchSelectionFromMarker(marker, {
      keyword: marker?.title || marker?.name || page.data.keyword
    });
  }
  const src = `${marker?.extData?.source || marker.source || ""}`.toLowerCase();
  if (src.includes("pin")) {
    const shapeType = `${marker?.extData?.raw?.shape?.type || marker?.shape?.type || ""}`.toUpperCase();
    if (shapeType && shapeType !== "POINT") return;
  }
  openMarkerDetail(page, marker);
}

function onMarkerCalloutTap(page, event) {
  const markerId = event?.detail?.markerId;
  page._mapTapSuppressUntil = Date.now() + 300;
  const marker = page.findMarkerById(markerId);
  if (!marker) return;
  if (page.isMapTapTargetMarker && page.isMapTapTargetMarker(marker)) return;
  if (typeof page.applySearchSelectionFromMarker === "function") {
    page.applySearchSelectionFromMarker(marker, {
      keyword: marker?.title || marker?.name || page.data.keyword
    });
  }
  const src = `${marker?.extData?.source || marker.source || ""}`.toLowerCase();
  if (src.includes("pin")) {
    const shapeType = `${marker?.extData?.raw?.shape?.type || marker?.shape?.type || ""}`.toUpperCase();
    if (shapeType && shapeType !== "POINT") return;
  }
  openMarkerDetail(page, marker);
}

function closeMarkerDetail(page, immediate = false) {
  if (!page.data.markerDetailVisible) return;
  if (page._markerDetailCloseTimer) {
    clearTimeout(page._markerDetailCloseTimer);
    page._markerDetailCloseTimer = null;
  }
  if (page._markerDetailExpandTimer) {
    clearTimeout(page._markerDetailExpandTimer);
    page._markerDetailExpandTimer = null;
  }
  page._markerDetailExpandLock = false;
  if (immediate) {
    hideMarkerCertificationSheet(page, true);
    page.setData({
      markerDetailVisible: false,
      markerDetailClosing: false,
      markerDetailExpanding: false,
      detailCard: null
    });
    return;
  }
  hideMarkerCertificationSheet(page, true);
  page.setData({ markerDetailClosing: true });
  page._markerDetailCloseTimer = setTimeout(() => {
    page._markerDetailCloseTimer = null;
    page.setData({
      markerDetailVisible: false,
      markerDetailClosing: false,
      markerDetailExpanding: false,
      detailCard: null
    });
  }, 200);
}

function onMarkerDetailMaskTap(page) {
  closeMarkerDetail(page);
}

function onCreatorNameTap() {
  wx.showToast({
    title: "后续支持发布者信息哦~敬请期待！",
    icon: "none"
  });
}

function onMarkerDetailMaskTouchMove() {
  // Stop marker detail gestures from reaching the map beneath
}

function onMarkerDetailCloseTap(page) {
  closeMarkerDetail(page);
}

function onMarkerDetailMoreTap(page) {
  triggerMarkerDetailExpand(page);
}

function triggerMarkerDetailExpand(page) {
  const detail = page.data.detailCard;
  if (!detail) return;
  if (page.data.markerDetailExpanding) return;
  if (page._markerDetailExpandLock) return;
  if (page._markerDetailExpandTimer) {
    clearTimeout(page._markerDetailExpandTimer);
    page._markerDetailExpandTimer = null;
  }
  page._markerDetailExpandLock = true;
  page.setData({ markerDetailExpanding: true });
  page._markerDetailExpandTimer = setTimeout(() => {
    page._markerDetailExpandTimer = null;
    page._markerDetailExpandLock = false;
    const currentDetail = page.data.detailCard || detail;
    if (!currentDetail) {
      page.setData({ markerDetailExpanding: false });
      return;
    }
    const restored = cloneMarkerDetail(currentDetail);
    page._lastMarkerDetail = restored;
    openMarkerPage(page, restored);
    page.setData({ markerDetailExpanding: false });
  }, 220);
}

function onMarkerDetailTouchStart(page, event) {
  if (!page.data.markerDetailAllowExpand) return;
  const touch = resolveEventTouches(event)[0];
  if (!touch) return;
  page._markerDetailTouch = {
    startY: touch.clientY,
    lastY: touch.clientY,
    deltaY: 0,
    startTime: Date.now()
  };
}

function onMarkerDetailTouchMove(page, event) {
  if (!page.data.markerDetailAllowExpand) return;
  if (!page._markerDetailTouch) return;
  const touch = resolveEventTouches(event)[0];
  if (!touch) return;
  const deltaY = touch.clientY - page._markerDetailTouch.startY;
  page._markerDetailTouch.lastY = touch.clientY;
  page._markerDetailTouch.deltaY = deltaY;
}

function onMarkerDetailTouchEnd(page) {
  if (!page.data.markerDetailAllowExpand) return;
  const info = page._markerDetailTouch;
  page._markerDetailTouch = null;
  if (!info) return;
  const deltaY = info.deltaY || 0;
  const duration = Date.now() - info.startTime;
  if ((deltaY <= -80 && duration <= 600) || deltaY <= -140) {
    triggerMarkerDetailExpand(page);
  }
}

function onMarkerDetailTouchCancel(page) {
  if (!page.data.markerDetailAllowExpand) return;
  page._markerDetailTouch = null;
}

function onMarkerDetailSwiperChange(page, event) {
  const idx = Number(event?.detail?.current);
  if (Number.isFinite(idx)) {
    const media = getDetailMediaList(page.data.detailCard || {});
    page.setData({
      markerDetailCurrentImage: idx,
      markerDetailVideoLoading: isVideoMediaItem(media[idx])
    });
  }
}

function isCurrentMarkerDetailVideoEvent(page, event = {}) {
  const index = Number(resolveEventDataset(event).index);
  return Number.isFinite(index) && index === page.data.markerDetailCurrentImage;
}

function onMarkerDetailVideoWaiting(page, event = {}) {
  if (!isCurrentMarkerDetailVideoEvent(page, event)) {
    return;
  }
  if (!page.data.markerDetailVideoLoading) {
    page.setData({ markerDetailVideoLoading: true });
  }
}

function onMarkerDetailVideoReady(page, event = {}) {
  if (!isCurrentMarkerDetailVideoEvent(page, event)) {
    return;
  }
  if (page.data.markerDetailVideoLoading) {
    page.setData({ markerDetailVideoLoading: false });
  }
}

function openMapInlineVideoFullscreen(page, options = {}) {
  const url = typeof options.url === "string" ? options.url.trim() : "";
  if (!url) return;
  const poster = typeof options.poster === "string" ? options.poster.trim() : "";
  const videoId = typeof options.videoId === "string" ? options.videoId.trim() : "";
  if (typeof wx.previewMedia === "function") {
    wx.previewMedia({
      sources: [{
        url,
        type: "video",
        poster
      }],
      current: 0,
      showmenu: true
    });
    return;
  }
  if (videoId && typeof wx.createVideoContext === "function") {
    const ctx = wx.createVideoContext(videoId, page);
    if (ctx && typeof ctx.play === "function") {
      ctx.play();
    }
    if (ctx && typeof ctx.requestFullScreen === "function") {
      ctx.requestFullScreen({ direction: 0 });
    }
  }
}

function playMapInlineVideo(page, videoId = "") {
  const resolvedVideoId = typeof videoId === "string" ? videoId.trim() : "";
  if (!resolvedVideoId || typeof wx.createVideoContext !== "function") {
    return;
  }
  const ctx = wx.createVideoContext(resolvedVideoId, page);
  if (ctx && typeof ctx.play === "function") {
    ctx.play();
  }
}

function onMapInlineVideoTap(page, event = {}) {
  const activeDetail = page.data.markerPageVisible
    ? page.data.markerPageDetail
    : page.data.detailCard;
  const dataset = resolveEventDataset(event);
  const videoId = dataset.videoId || "";
  if (isPinDetail(page, activeDetail)) {
    playMapInlineVideo(page, videoId);
    return;
  }
  openMapInlineVideoFullscreen(page, {
    url: dataset.url || "",
    poster: dataset.poster || "",
    videoId
  });
}

function isMarkerCertified(page, detail = {}) {
  if (!detail || typeof detail !== "object") {
    return false;
  }
  if (isTruthyFlag(detail.isCertified) || isTruthyFlag(detail.paid)) {
    return true;
  }
  return resolveCertifiedState(detail.raw || {});
}

function applyMarkerCertificationState(page, detail = {}) {
  if (!detail || typeof detail !== "object") {
    return detail;
  }
  const isCertified = isMarkerCertified(page, detail);
  const titleParts = buildBadgeTitleParts(detail.name, "未命名商户");
  detail.isCertified = isCertified;
  detail.titleDisplayText = titleParts.titleDisplayText;
  detail.titlePrefixText = titleParts.titlePrefixText;
  detail.titleTailText = titleParts.titleTailText;
  if (isCertified && detail.paid === undefined) {
    detail.paid = true;
  }
  return detail;
}

function getDetailMediaList(detail = {}) {
  if (Array.isArray(detail?.mediaItems) && detail.mediaItems.length) {
    return detail.mediaItems;
  }
  if (Array.isArray(detail?.images) && detail.images.length) {
    return detail.images;
  }
  return [];
}

function isVideoMediaItem(item = {}) {
  return `${item?.type || ""}`.toLowerCase() === "video";
}

function onMarkerCertificationBadgeTap(page) {
  const detail = page.data.markerPageDetail || page.data.detailCard || page._lastMarkerDetail;
  if (!isMarkerCertified(page, detail)) {
    return;
  }
  if (page._markerCertificationSheetCloseTimer) {
    clearTimeout(page._markerCertificationSheetCloseTimer);
    page._markerCertificationSheetCloseTimer = null;
  }
  page.setData({
    markerCertificationSheetVisible: true,
    markerCertificationSheetClosing: false
  });
}

function hideMarkerCertificationSheet(page, immediate = false) {
  if (!page.data.markerCertificationSheetVisible) {
    return;
  }
  if (page._markerCertificationSheetCloseTimer) {
    clearTimeout(page._markerCertificationSheetCloseTimer);
    page._markerCertificationSheetCloseTimer = null;
  }
  if (immediate) {
    page.setData({
      markerCertificationSheetVisible: false,
      markerCertificationSheetClosing: false
    });
    return;
  }
  page.setData({ markerCertificationSheetClosing: true });
  page._markerCertificationSheetCloseTimer = setTimeout(() => {
    page._markerCertificationSheetCloseTimer = null;
    page.setData({
      markerCertificationSheetVisible: false,
      markerCertificationSheetClosing: false
    });
  }, MARKER_CERTIFICATION_SHEET_CLOSE_DURATION);
}

function onMarkerCertificationSheetMaskTap(page) {
  hideMarkerCertificationSheet(page);
}

function onMarkerDetailCallTap(page, event) {
  const dataset = resolveEventDataset(event);
  const phone = dataset.phone || page.data.detailCard?.phone || "";
  const detail = page.data.detailCard || {};
  const markerId = page.resolveMarkerNewId(detail);
  const name = detail?.name || "";
  page.openCallSheet({ phone, markerId, name });
}

function onMarkerDetailNavigateTap(page, event) {
  const detail = page.data.detailCard;
  if (!detail) return;
  const dataset = resolveEventDataset(event);
  page.openMarkerLocation(detail, dataset);
}

function openMarkerPage(page, detail) {
  if (!detail) return;
  if (page._markerPageCloseTimer) {
    clearTimeout(page._markerPageCloseTimer);
    page._markerPageCloseTimer = null;
  }
  if (page._restoreMarkerDetailTimer) {
    clearTimeout(page._restoreMarkerDetailTimer);
    page._restoreMarkerDetailTimer = null;
  }
  const pageDetail = applyMarkerCertificationState(page, cloneMarkerDetail(detail));
  normalizeMarkerPageDetail(pageDetail);
  page._lastMarkerDetail = pageDetail;
  const pin = isPinDetail(page, pageDetail);
  const distanceText = buildMarkerDistanceText(page, pageDetail);
  page.setData({
    markerPageVisible: true,
    markerPageClosing: false,
    markerPageDetail: pageDetail,
    markerPageCurrentImage: 0,
    markerPageVideoLoading: isVideoMediaItem(getDetailMediaList(pageDetail)[0]),
    markerPageShareEnabled: isDetailSharable(page, pageDetail),
    markerPageIsPin: pin,
    markerPageDistanceText: distanceText
  });
  page.loadMarkerLikeInfo({ detail: pageDetail, target: detail, forPage: true });
  if (pin) {
    page.ensurePlayablePinDetailMedia(pageDetail, { forPage: true });
  }
  page._markerPageScrollTop = 0;
  page._markerPageTouch = null;
  closeMarkerDetail(page, true);
}

function onMarkerPosterTap(page) {
  const detail = page.data.markerPageDetail || page._lastMarkerDetail;
  if (!detail) return;
  const raw = detail.raw || {};
  const targetValue = raw.markIdNew ?? detail.markIdNew ?? detail.markerId ?? detail.id ?? raw.id ?? "";
  const markerId = targetValue !== undefined && targetValue !== null ? `${targetValue}`.trim() : "";
  if (!markerId) {
    wx.showToast({ title: "暂无可用商户", icon: "none" });
    return;
  }
  wx.navigateTo({
    url: `/pages/markers/merchant-poster/index?mId=${encodeURIComponent(markerId)}`
  });
}

function refreshMarkerPageDistance(page) {
  if (!page.data.markerPageVisible || !page.data.markerPageDetail) {
    return;
  }
  const distanceText = buildMarkerDistanceText(page, page.data.markerPageDetail);
  if (distanceText === page.data.markerPageDistanceText) {
    return;
  }
  page.setData({ markerPageDistanceText: distanceText });
}

function buildMarkerDistanceText(page, detail) {
  const distance = computeMarkerDistance(page, detail);
  if (!Number.isFinite(distance) || distance < 0) {
    return "";
  }
  return formatDistanceText(distance);
}

function normalizeMarkerPageDetail(detail = {}) {
  if (!detail || typeof detail !== "object") {
    return;
  }
  if (Array.isArray(detail.attachments) && detail.attachments.length) {
    const first = detail.attachments.find((item) => item && (item.url || item.fileName));
    if (first) {
      const normalized = Object.assign({}, first);
      normalized.displayName = ATTACHMENT_DISPLAY_LABEL;
      normalized.shortName = ATTACHMENT_DISPLAY_LABEL;
      if (!normalized.url && typeof normalized.fileName === "string" && normalized.fileName.trim()) {
        normalized.url = normalized.fileName.trim();
      }
      detail.attachments = [normalized];
      return;
    }
  }
  detail.attachments = [];
}

function computeMarkerDistance(page, detail) {
  if (!detail) return NaN;
  const markerLat = Number(detail.latitude);
  const markerLng = Number(detail.longitude);
  if (!Number.isFinite(markerLat) || !Number.isFinite(markerLng)) {
    return NaN;
  }
  const location = page._lastKnownLocation;
  const userLat = Number(location?.latitude);
  const userLng = Number(location?.longitude);
  if (!Number.isFinite(userLat) || !Number.isFinite(userLng)) {
    return NaN;
  }
  const userWgs = gcj02ToWgs84(userLng, userLat);
  const userLatWgs = Number.isFinite(userWgs?.lat) ? userWgs.lat : userLat;
  const userLngWgs = Number.isFinite(userWgs?.lng) ? userWgs.lng : userLng;
  const meters = computeGreatCircleDistance(
    { latitude: markerLat, longitude: markerLng },
    { latitude: userLatWgs, longitude: userLngWgs }
  );
  return Number.isFinite(meters) ? meters : NaN;
}

function closeMarkerPage(page, options = {}) {
  const { restoreDetail = true } = options || {};
  if (!page.data.markerPageVisible) return;
  hideMarkerCertificationSheet(page, true);
  if (page._markerPageCloseTimer) {
    clearTimeout(page._markerPageCloseTimer);
    page._markerPageCloseTimer = null;
  }
  const finalize = () => {
    page._markerPageCloseTimer = null;
    page.setData({
      markerPageVisible: false,
      markerPageClosing: false,
      markerPageDetail: null,
      markerPageCurrentImage: 0,
      markerPageShareEnabled: true,
      markerPageDistanceText: ""
    });
    page._markerPageTouch = null;
    page._markerPageScrollTop = 0;
    if (restoreDetail) {
      page.scheduleRestoreMarkerDetail(80);
    }
  };
  page.setData({ markerPageClosing: true });
  page._markerPageCloseTimer = setTimeout(finalize, 240);
}

function onMarkerPageMaskTap(page) {
  closeMarkerPage(page);
}

function onMarkerPageSwiperChange(page, event) {
  const current = Number(event?.detail?.current);
  if (Number.isFinite(current)) {
    const media = getDetailMediaList(page.data.markerPageDetail || {});
    page.setData({
      markerPageCurrentImage: current,
      markerPageVideoLoading: isVideoMediaItem(media[current])
    });
  }
}

function isCurrentMarkerPageVideoEvent(page, event = {}) {
  const index = Number(resolveEventDataset(event).index);
  return Number.isFinite(index) && index === page.data.markerPageCurrentImage;
}

function onMarkerPageVideoWaiting(page, event = {}) {
  if (!isCurrentMarkerPageVideoEvent(page, event)) {
    return;
  }
  if (!page.data.markerPageVideoLoading) {
    page.setData({ markerPageVideoLoading: true });
  }
}

function onMarkerPageVideoReady(page, event = {}) {
  if (!isCurrentMarkerPageVideoEvent(page, event)) {
    return;
  }
  if (page.data.markerPageVideoLoading) {
    page.setData({ markerPageVideoLoading: false });
  }
}

function onMarkerPageScroll(page, event) {
  const top = Number(event?.detail?.scrollTop);
  if (Number.isFinite(top)) {
    page._markerPageScrollTop = Math.max(0, top);
    return;
  }
  page._markerPageScrollTop = 0;
}

function onMarkerPageTouchStart(page, event) {
  const touch = resolveEventTouches(event)[0];
  if (!touch) return;
  const canClose = (page._markerPageScrollTop || 0) <= MARKER_PAGE_SCROLL_TOP_THRESHOLD;
  page._markerPageTouch = {
    startY: touch.clientY,
    lastY: touch.clientY,
    deltaY: 0,
    startTime: Date.now(),
    canClose
  };
}

function onMarkerPageTouchMove(page, event) {
  if (!page._markerPageTouch) return;
  const touch = resolveEventTouches(event)[0];
  if (!touch) return;
  const deltaY = touch.clientY - page._markerPageTouch.startY;
  if (
    !page._markerPageTouch.canClose &&
    (page._markerPageScrollTop || 0) <= MARKER_PAGE_SCROLL_TOP_THRESHOLD &&
    deltaY >= 0
  ) {
    page._markerPageTouch.canClose = true;
    page._markerPageTouch.startY = touch.clientY;
    page._markerPageTouch.deltaY = 0;
    page._markerPageTouch.startTime = Date.now();
  }
  page._markerPageTouch.lastY = touch.clientY;
  page._markerPageTouch.deltaY = deltaY;
}

function onMarkerPageTouchEnd(page) {
  const info = page._markerPageTouch;
  page._markerPageTouch = null;
  if (!info) return;
  if (!info.canClose) {
    return;
  }
  const deltaY = info.deltaY || 0;
  const duration = Date.now() - info.startTime;
  const fastSwipe =
    deltaY >= MARKER_PAGE_CLOSE_FAST_DISTANCE && duration <= MARKER_PAGE_CLOSE_FAST_DURATION;
  const longSwipe = deltaY >= MARKER_PAGE_CLOSE_DISTANCE;
  if (
    page._markerPageScrollTop <= MARKER_PAGE_SCROLL_TOP_THRESHOLD &&
    (fastSwipe || longSwipe)
  ) {
    closeMarkerPage(page);
  }
}

function onMarkerPageTouchCancel(page) {
  page._markerPageTouch = null;
}

function onMarkerPageAttachmentTap(page, event) {
  const url = resolveEventDataset(event).url;
  if (!url) {
    wx.showToast({ title: "附件不可用", icon: "none" });
    return;
  }
  wx.showLoading({ title: "下载中...", mask: true });
  wx.downloadFile({
    url,
    success: (res) => {
      const statusCode = Number(res?.statusCode);
      const filePath = res?.tempFilePath;
      if (statusCode === 200 && filePath) {
        if (typeof wx.openDocument === "function") {
          wx.openDocument({
            filePath,
            showMenu: true,
            success: () => wx.hideLoading(),
            fail: () => {
              wx.hideLoading();
              wx.showToast({ title: "打开失败", icon: "none" });
            }
          });
          return;
        }
        wx.hideLoading();
        wx.showToast({ title: "已下载", icon: "success" });
        return;
      }
      wx.hideLoading();
      wx.showToast({ title: "下载失败", icon: "none" });
    },
    fail: () => {
      wx.hideLoading();
      wx.showToast({ title: "下载失败", icon: "none" });
    }
  });
}

function onMarkerPageVideoTap(page, event) {
  const dataset = resolveEventDataset(event);
  const url = dataset.url || "";
  const finderUserName = dataset.finder || "";
  const activityId = dataset.activity || "";

  const proceed = () => {
    if (finderUserName && activityId && typeof wx?.openChannelsActivity === "function") {
      console.log("here is wx.openChannelsActivity", finderUserName, activityId);
      wx.openChannelsActivity({
        finderUserName,
        feedId: activityId,
        success: (res) => console.log("open ok", res),
        fail: (err) => {
          console.warn("open fail", err);
        },
        complete: (res) => console.log("open complete", res)
      });
      return;
    }
    if (finderUserName && typeof wx?.openChannelsUserProfile === "function") {
      wx.openChannelsUserProfile({ finderUserName });
      return;
    }
    if (activityId && typeof wx?.openChannelsActivity === "function") {
      wx.openChannelsActivity({ activityId });
      return;
    }
    if (url && /^https?:\/\//.test(url)) {
      if (/^https?:\/\/mp\.weixin\.qq\.com\//.test(url) && typeof wx?.navigateTo === "function") {
        wx.navigateTo({ url: `/pages/webview/index?url=${encodeURIComponent(url)}` });
        return;
      }
      if (typeof wx?.setClipboardData === "function") {
        wx.setClipboardData({
          data: url,
          success: () => {
            wx.showToast({ title: "链接已复制", icon: "none" });
          },
          fail: () => {
            wx.showToast({ title: "复制失败", icon: "none" });
          }
        });
      } else {
        wx.showToast({ title: "请复制链接访问", icon: "none" });
      }
      return;
    }
    wx.showToast({ title: "视频不可用", icon: "none" });
  };
  proceed();
}

function onMarkerPageCallTap(page, event) {
  const dataset = resolveEventDataset(event);
  const phone = dataset.phone || page.data.markerPageDetail?.phone || "";
  const detail = page.data.markerPageDetail || {};
  const markerId = page.resolveMarkerNewId(detail);
  const name = detail?.name || "";
  page.openCallSheet({ phone, markerId, name });
}

function onMarkerPageNavigateTap(page, event) {
  const detail = page.data.markerPageDetail;
  if (!detail) return;
  const dataset = resolveEventDataset(event);
  page.openMarkerLocation(detail, dataset);
}

function getDetailReviewStatus(detail) {
  if (!detail) return "";
  return `${detail.reviewStatus || detail.raw?.reviewStatus || detail.raw?.status || ""}`.trim().toUpperCase();
}

function isDetailApproved(page, detail) {
  const status = getDetailReviewStatus(detail);
  if (!status) return false;
  if (status === "APPROVED") return true;
  return status.startsWith("APPROVED");
}

function isPinDetail(page, detail) {
  const source = `${detail?.source || detail?.raw?.source || ""}`.toLowerCase();
  if (source.includes("pin")) return true;
  if (detail?.raw && typeof detail.raw === "object" && detail.raw.shape) return true;
  return false;
}

function isDetailSharable(page, detail) {
  if (!detail || detail.shareDisabled) {
    return false;
  }
  return isDetailApproved(page, detail);
}

function showShareBlockedToast() {
  if (typeof wx?.showToast === "function") {
    wx.showToast({ title: "审核通过后才能分享", icon: "none" });
  }
}

function onMarkerPageShareDisabledTap() {
  showShareBlockedToast();
}

module.exports = {
  openMarkerDetail,
  onMarkerTap,
  onMarkerCalloutTap,
  closeMarkerDetail,
  onMarkerDetailMaskTap,
  onCreatorNameTap,
  onMarkerDetailMaskTouchMove,
  onMarkerDetailCloseTap,
  onMarkerDetailMoreTap,
  triggerMarkerDetailExpand,
  onMarkerDetailTouchStart,
  onMarkerDetailTouchMove,
  onMarkerDetailTouchEnd,
  onMarkerDetailTouchCancel,
  onMarkerDetailSwiperChange,
  isCurrentMarkerDetailVideoEvent,
  onMarkerDetailVideoWaiting,
  onMarkerDetailVideoReady,
  openMapInlineVideoFullscreen,
  playMapInlineVideo,
  onMapInlineVideoTap,
  isMarkerCertified,
  applyMarkerCertificationState,
  getDetailMediaList,
  isVideoMediaItem,
  onMarkerCertificationBadgeTap,
  hideMarkerCertificationSheet,
  onMarkerCertificationSheetMaskTap,
  onMarkerDetailCallTap,
  onMarkerDetailNavigateTap,
  openMarkerPage,
  onMarkerPosterTap,
  refreshMarkerPageDistance,
  buildMarkerDistanceText,
  normalizeMarkerPageDetail,
  computeMarkerDistance,
  closeMarkerPage,
  onMarkerPageMaskTap,
  onMarkerPageSwiperChange,
  isCurrentMarkerPageVideoEvent,
  onMarkerPageVideoWaiting,
  onMarkerPageVideoReady,
  onMarkerPageScroll,
  onMarkerPageTouchStart,
  onMarkerPageTouchMove,
  onMarkerPageTouchEnd,
  onMarkerPageTouchCancel,
  onMarkerPageAttachmentTap,
  onMarkerPageVideoTap,
  onMarkerPageCallTap,
  onMarkerPageNavigateTap,
  getDetailReviewStatus,
  isDetailApproved,
  isPinDetail,
  isDetailSharable,
  showShareBlockedToast,
  onMarkerPageShareDisabledTap
};
