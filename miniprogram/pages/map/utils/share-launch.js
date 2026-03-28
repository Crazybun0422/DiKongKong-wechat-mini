const { fetchMarkerDetail, buildFileDownloadUrl } = require("../../../utils/markers");
const { fetchPinDetail } = require("../../../utils/pins");
const { haversineMeters, wgs84ToGcj02 } = require("../../../utils/coords");
const {
  appendInviteCodeToPath,
  appendInviteCodeToQuery,
  getShareInviteCode: getShareInviteCodeUtil
} = require("../../../utils/share");
const { clampMapScale, hasValidCoordinate } = require("./map-shared");
const {
  decodeParamValue,
  isTruthyFlag,
  parseSceneParams,
  normalizeLaunchCenterShareOptions
} = require("./launch-shared");

const PENDING_INVITE_CODE_STORAGE_KEY = "pendingInviteCode";
const CENTER_SHARE_LOCK_DURATION_MS = 10000;
const CENTER_SHARE_LOCK_MAX_DRIFT_METERS = 2000;
const CENTER_SHARE_LOCK_ALIGN_DELAY_MS = 120;


const normalizeLaunchMarkerOptions = (options = {}) => {
  const normalized = {
    markerId: "",
    delayUntilPermission: false
  };
  if (!options || typeof options !== "object") {
    return normalized;
  }
  const candidateKeys = ["mId", "markerId", "markerID", "markId", "markID", "id"];
  for (const key of candidateKeys) {
    if (options[key] !== undefined && options[key] !== null) {
      const decoded = decodeParamValue(options[key]);
      if (decoded) {
        normalized.markerId = decoded;
        break;
      }
    }
  }
  const shareFlag = options.fs ?? options.fromShare ?? options.share ?? options.source;
  if (isTruthyFlag(shareFlag)) {
    normalized.delayUntilPermission = true;
  }
  const sceneParams = parseSceneParams(options.scene);
  const sceneMarkerId =
    sceneParams.mId ||
    sceneParams.markerId ||
    sceneParams.markerID ||
    sceneParams.markId ||
    sceneParams.markID;
  if (!normalized.markerId && sceneMarkerId) {
    normalized.markerId = decodeParamValue(sceneMarkerId);
  }
  if (!normalized.delayUntilPermission && sceneParams.fs) {
    normalized.delayUntilPermission = isTruthyFlag(sceneParams.fs);
  } else if (!normalized.delayUntilPermission && sceneParams.fromShare) {
    normalized.delayUntilPermission = isTruthyFlag(sceneParams.fromShare);
  } else if (!normalized.delayUntilPermission && sceneParams.share) {
    normalized.delayUntilPermission = isTruthyFlag(sceneParams.share);
  }
  if (typeof options.q === "string" && options.q.trim()) {
    const decoded = decodeParamValue(options.q);
    const queryIndex = decoded.indexOf("?");
    const queryString = queryIndex >= 0 ? decoded.slice(queryIndex + 1) : decoded;
    const qParams = parseSceneParams(queryString);
    const qMarkerId =
      qParams.mId ||
      qParams.markerId ||
      qParams.markerID ||
      qParams.markId ||
      qParams.markID;
    if (!normalized.markerId && qMarkerId) {
      normalized.markerId = decodeParamValue(qMarkerId);
    }
    if (!normalized.delayUntilPermission && qParams.fs) {
      normalized.delayUntilPermission = isTruthyFlag(qParams.fs);
    } else if (!normalized.delayUntilPermission && qParams.fromShare) {
      normalized.delayUntilPermission = isTruthyFlag(qParams.fromShare);
    } else if (!normalized.delayUntilPermission && qParams.share) {
      normalized.delayUntilPermission = isTruthyFlag(qParams.share);
    }
  }
  return normalized;
};

const normalizeLaunchPinOptions = (options = {}) => {
  const normalized = {
    pinId: "",
    delayUntilPermission: false
  };
  if (!options || typeof options !== "object") {
    return normalized;
  }
  const candidateKeys = ["pId", "pinId", "pinID", "id"];
  for (const key of candidateKeys) {
    if (options[key] !== undefined && options[key] !== null) {
      const decoded = decodeParamValue(options[key]);
      if (decoded) {
        normalized.pinId = decoded;
        break;
      }
    }
  }
  const shareFlag = options.fs ?? options.fromShare ?? options.share ?? options.source;
  if (isTruthyFlag(shareFlag)) {
    normalized.delayUntilPermission = true;
  }
  const sceneParams = parseSceneParams(options.scene);
  const scenePinId = sceneParams.pId || sceneParams.pinId || sceneParams.pinID;
  if (!normalized.pinId && scenePinId) {
    normalized.pinId = decodeParamValue(scenePinId);
  }
  if (!normalized.delayUntilPermission && sceneParams.fs) {
    normalized.delayUntilPermission = isTruthyFlag(sceneParams.fs);
  } else if (!normalized.delayUntilPermission && sceneParams.fromShare) {
    normalized.delayUntilPermission = isTruthyFlag(sceneParams.fromShare);
  } else if (!normalized.delayUntilPermission && sceneParams.share) {
    normalized.delayUntilPermission = isTruthyFlag(sceneParams.share);
  }
  if (typeof options.q === "string" && options.q.trim()) {
    const decoded = decodeParamValue(options.q);
    const queryIndex = decoded.indexOf("?");
    const queryString = queryIndex >= 0 ? decoded.slice(queryIndex + 1) : decoded;
    const qParams = parseSceneParams(queryString);
    const qPinId = qParams.pId || qParams.pinId || qParams.pinID;
    if (!normalized.pinId && qPinId) {
      normalized.pinId = decodeParamValue(qPinId);
    }
    if (!normalized.delayUntilPermission && qParams.fs) {
      normalized.delayUntilPermission = isTruthyFlag(qParams.fs);
    } else if (!normalized.delayUntilPermission && qParams.fromShare) {
      normalized.delayUntilPermission = isTruthyFlag(qParams.fromShare);
    } else if (!normalized.delayUntilPermission && qParams.share) {
      normalized.delayUntilPermission = isTruthyFlag(qParams.share);
    }
  }
  return normalized;
};

const extractInviteCodeFromOptions = (options = {}) => {
  const readInviteFromObject = (source) => {
    if (!source || typeof source !== "object") return "";
    const candidate = source.ic ?? source.inviteCode ?? source.invitationCode;
    if (candidate === undefined || candidate === null) return "";
    return decodeParamValue(candidate);
  };
  if (!options || typeof options !== "object") {
    return "";
  }
  const direct = readInviteFromObject(options);
  if (direct) return direct;
  if (options.query) {
    const fromQuery = readInviteFromObject(options.query);
    if (fromQuery) return fromQuery;
  }
  const sceneParams = parseSceneParams(options.scene);
  const fromScene = readInviteFromObject(sceneParams);
  if (fromScene) return fromScene;
  if (typeof options.q === "string" && options.q.trim()) {
    const decoded = decodeParamValue(options.q);
    const queryIndex = decoded.indexOf("?");
    const queryString = queryIndex >= 0 ? decoded.slice(queryIndex + 1) : decoded;
    const qParams = parseSceneParams(queryString);
    const fromQ = readInviteFromObject(qParams);
    if (fromQ) return fromQ;
  }
  return "";
};

const formatNearbyMarkerLabel = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const chars = Array.from(trimmed);
  if (chars.length <= 7) {
    return chars.join("");
  }
  return `${chars.slice(0, 6).join("")}…`;
};

const buildMarkerNameCallout = (content, overrides = {}) => {
  if (!content) {
    return null;
  }
  return Object.assign(
    {
      content,
      color: "#111827",
      fontSize: 12,
      fontWeight: "bold",
      display: "ALWAYS",
      borderRadius: 5,
      padding: 6,
      borderColor: "#111827",
      borderWidth: 0.4
    },
    overrides
  );
};

const cloneMarkerDetail = (detail = {}) => {
  if (!detail || typeof detail !== "object") {
    return {};
  }
  const cloneArray = (value) => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item) => (item && typeof item === "object" ? Object.assign({}, item) : item));
  };
  const cloned = Object.assign({}, detail);
  cloned.images = cloneArray(detail.images);
  cloned.honors = Array.isArray(detail.honors) ? detail.honors.slice() : [];
  cloned.attachments = cloneArray(detail.attachments);
  cloned.qrCodes = cloneArray(detail.qrCodes);
  cloned.videoAccounts = cloneArray(detail.videoAccounts);
  if (detail.primaryVideoAccount && typeof detail.primaryVideoAccount === "object") {
    cloned.primaryVideoAccount = Object.assign({}, detail.primaryVideoAccount);
  } else if (!detail.primaryVideoAccount) {
    cloned.primaryVideoAccount = null;
  }
  return cloned;
};

function takePendingMarkerFocus(page) {
  const app = typeof getApp === "function" ? getApp() : null;
  if (!app || !app.globalData) return null;
  const payload = app.globalData.pendingMarkerFocus;
  if (payload) {
    app.globalData.pendingMarkerFocus = null;
    return payload;
  }
  return null;
}

function consumePendingMarkerFocus(page, options = {}) {
  const request = takePendingMarkerFocus(page);
  if (!request) return;
  if (request.mode === "offline" || request.offlineRaw) {
    focusOfflineMarker(page, request);
    return;
  }
  focusOnlineMarker(page, request);
}

function consumePendingPinPreview(page) {
  const app = typeof getApp === "function" ? getApp() : null;
  if (!app || !app.globalData) return;
  const preview = app.globalData.pendingPinPreview;
  if (!preview) return;
  app.globalData.pendingPinPreview = null;
  page.applyPinPreview(preview);
}

function captureInviteCode(page, options = {}) {
  const inviteCode = extractInviteCodeFromOptions(options);
  if (!inviteCode) {
    return;
  }
  const app = typeof getApp === "function" ? getApp() : null;
  if (app && typeof app.setPendingInviteCode === "function") {
    app.setPendingInviteCode(inviteCode);
    return;
  }
  if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
    try {
      wx.setStorageSync(PENDING_INVITE_CODE_STORAGE_KEY, inviteCode);
    } catch (err) {
      console.warn("Failed to cache invite code locally", err);
    }
  }
}

function initializeCenterShareLaunch(page, options = {}) {
  const normalized = normalizeLaunchCenterShareOptions(options);
  if (!normalized.active) {
    page._shareCenterLaunch = null;
    return false;
  }
  page._shareCenterLaunch = normalized;
  return true;
}

function applyCenterShareLaunch(page) {
  const launch = page._shareCenterLaunch;
  if (!launch || !launch.active) return false;
  const latitude = Number(launch.latitude);
  const longitude = Number(launch.longitude);
  if (!hasValidCoordinate(latitude, longitude)) {
    page._shareCenterLaunch = null;
    return false;
  }
  page.centerOnPoint(
    { latitude, longitude },
    clampMapScale(launch.scale || 15),
    true
  );
  page._centerShareLaunchLock = {
    latitude,
    longitude,
    scale: clampMapScale(launch.scale || 15),
    expiresAt: Date.now() + CENTER_SHARE_LOCK_DURATION_MS
  };
  scheduleCenterShareLaunchLockAlign(page, CENTER_SHARE_LOCK_ALIGN_DELAY_MS);
  page._shareCenterLaunch = null;
  return true;
}

function scheduleCenterShareLaunchLockAlign(page, delay = 0) {
  const lock = page._centerShareLaunchLock;
  if (!lock) return;
  if (page._centerShareLaunchLockTimer) {
    clearTimeout(page._centerShareLaunchLockTimer);
    page._centerShareLaunchLockTimer = null;
  }
  const wait = Math.max(0, Number(delay) || 0);
  page._centerShareLaunchLockTimer = setTimeout(() => {
    page._centerShareLaunchLockTimer = null;
    const latestLock = page._centerShareLaunchLock;
    if (!latestLock) return;
    if (Date.now() > Number(latestLock.expiresAt || 0)) {
      page._centerShareLaunchLock = null;
      return;
    }
    const point = {
      latitude: Number(latestLock.latitude),
      longitude: Number(latestLock.longitude)
    };
    if (!hasValidCoordinate(point.latitude, point.longitude)) {
      page._centerShareLaunchLock = null;
      return;
    }
    const targetScale = clampMapScale(latestLock.scale || page.data.scale || DEFAULT_MAP_SCALE);
    page.setData({ center: point, scale: targetScale }, () => {
      if (page.mapCtx && typeof page.mapCtx.moveToLocation === "function") {
        page.mapCtx.moveToLocation({
          latitude: point.latitude,
          longitude: point.longitude
        });
      }
    });
  }, wait);
}

function shouldIgnoreCenterShareLaunchSync(page, targetCenter, cause = "") {
  const lock = page._centerShareLaunchLock;
  if (!lock) return false;
  if (Date.now() > Number(lock.expiresAt || 0)) {
    page._centerShareLaunchLock = null;
    if (page._centerShareLaunchLockTimer) {
      clearTimeout(page._centerShareLaunchLockTimer);
      page._centerShareLaunchLockTimer = null;
    }
    return false;
  }
  const normalizedCause = `${cause || ""}`.toLowerCase();
  if (
    normalizedCause === "drag" ||
    normalizedCause === "gesture" ||
    normalizedCause === "scale" ||
    normalizedCause === "rotate" ||
    normalizedCause === "skew" ||
    normalizedCause === "overlook"
  ) {
    page._centerShareLaunchLock = null;
    if (page._centerShareLaunchLockTimer) {
      clearTimeout(page._centerShareLaunchLockTimer);
      page._centerShareLaunchLockTimer = null;
    }
    return false;
  }
  if (
    !targetCenter ||
    !hasValidCoordinate(targetCenter.latitude, targetCenter.longitude)
  ) {
    return true;
  }
  const driftMeters = haversineMeters(
    lock.latitude,
    lock.longitude,
    targetCenter.latitude,
    targetCenter.longitude
  );
  if (
    Number.isFinite(driftMeters) &&
    driftMeters <= CENTER_SHARE_LOCK_MAX_DRIFT_METERS
  ) {
    page._centerShareLaunchLock = null;
    if (page._centerShareLaunchLockTimer) {
      clearTimeout(page._centerShareLaunchLockTimer);
      page._centerShareLaunchLockTimer = null;
    }
    return false;
  }
  scheduleCenterShareLaunchLockAlign(page, 60);
  return true;
}

function prepareCenterActionShare(page) {
  const center = page._centerOverride || page.data.center;
  if (!center || !hasValidCoordinate(center.latitude, center.longitude)) {
    page._pendingCenterActionShare = null;
    return null;
  }
  const latitude = Number(center.latitude);
  const longitude = Number(center.longitude);
  const fallbackAddress = `${page.data.centerPinTitle || ""}`.trim();
  const payload = {
    createdAt: Date.now(),
    latitude,
    longitude,
    address: fallbackAddress
  };
  if (page._pendingCenterActionShareTimer) {
    clearTimeout(page._pendingCenterActionShareTimer);
    page._pendingCenterActionShareTimer = null;
  }
  page._pendingCenterActionShare = payload;
  page._pendingCenterActionShareTimer = setTimeout(() => {
    if (page._pendingCenterActionShare === payload) {
      page._pendingCenterActionShare = null;
    }
    page._pendingCenterActionShareTimer = null;
  }, 20 * 1000);
  page.requestPinAddress(latitude, longitude)
    .then((address) => {
      if (page._pendingCenterActionShare !== payload) return;
      const resolved = `${address || ""}`.trim();
      if (resolved) {
        payload.address = resolved;
      }
    })
    .catch((err) => {
      console.warn("prepareCenterActionShare reverse geocode failed", err);
    });
  return payload;
}

function buildCenterActionSharePayload(page, payload = {}) {
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  if (!hasValidCoordinate(latitude, longitude)) return null;
  const latText = latitude.toFixed(6);
  const lngText = longitude.toFixed(6);
  const title = "风里雨里我在这里等你~";
  const queryBase = `fs=1&cs=1&clat=${encodeURIComponent(latText)}&clng=${encodeURIComponent(lngText)}`;
  return {
    title,
    queryBase
  };
}

function buildCurrentCenterSharePayload(page) {
  const center = page._centerOverride || page.data.center;
  if (!center || !hasValidCoordinate(center.latitude, center.longitude)) {
    return null;
  }
  return buildCenterActionSharePayload(page, {
    latitude: Number(center.latitude),
    longitude: Number(center.longitude)
  });
}

function consumeCenterActionSharePayload(page) {
  const payload = page._pendingCenterActionShare;
  if (!payload) return null;
  clearPendingCenterActionShare(page);
  const age = Date.now() - Number(payload.createdAt || 0);
  if (!Number.isFinite(age) || age > 60 * 1000) {
    return null;
  }
  return buildCenterActionSharePayload(page, payload);
}

function clearPendingCenterActionShare(page) {
  if (page._pendingCenterActionShareTimer) {
    clearTimeout(page._pendingCenterActionShareTimer);
    page._pendingCenterActionShareTimer = null;
  }
  page._pendingCenterActionShare = null;
}

function initializeShareLaunch(page, options = {}) {
  page._shareLaunchMarkerId = "";
  page._shareLaunchWaitForPermission = false;
  page._shareLaunchPermissionSettled = true;
  page._shareLaunchHandled = false;
  page._shareLaunchDetail = null;
  page._shareLaunchError = null;
  page._shareMarkerFetchPromise = null;
  page._shareMarkerFetchSeq = 0;
  page._shareLaunchNeedAuthRetry = false;
  page._shareLaunchAuthPromise = null;
  const normalized = normalizeLaunchMarkerOptions(options);
  if (!normalized.markerId) {
    return;
  }
  page._shareLaunchMarkerId = normalized.markerId;
  page._shareLaunchWaitForPermission = !!normalized.delayUntilPermission;
  page._shareLaunchPermissionSettled = !page._shareLaunchWaitForPermission;
  fetchShareMarkerDetailById(page, normalized.markerId);
}

function fetchShareMarkerDetailById(page, markerId, options = {}) {
  const id = `${markerId || ""}`.trim();
  if (!id) {
    return;
  }
  const allowRetry = options.allowRetry !== false;
  page._shareMarkerFetchSeq = (page._shareMarkerFetchSeq || 0) + 1;
  const seq = page._shareMarkerFetchSeq;
  const request = fetchMarkerDetail(id, {
    apiBase: page.getApiBase(),
    token: page.getAuthToken()
  });
  page._shareMarkerFetchPromise = request;
  request
    .then((detail) => {
      if (page._shareMarkerFetchPromise !== request || page._shareMarkerFetchSeq !== seq) {
        return;
      }
      page._shareMarkerFetchPromise = null;
      page._shareLaunchDetail = detail;
      page._shareLaunchError = null;
      page._shareLaunchNeedAuthRetry = false;
      tryActivateShareMarker(page);
    })
    .catch((err) => {
      if (page._shareMarkerFetchPromise !== request || page._shareMarkerFetchSeq !== seq) {
        return;
      }
      page._shareMarkerFetchPromise = null;
      if (allowRetry && err && err.message === "missing-token") {
        page._shareLaunchNeedAuthRetry = true;
        page._shareLaunchDetail = null;
        page._shareLaunchError = null;
        if (page._shareLaunchPermissionSettled) {
          retryShareMarkerDetailAfterAuth(page);
        }
        return;
      }
      page._shareLaunchDetail = null;
      page._shareLaunchError = err || new Error("marker-detail-failed");
      tryActivateShareMarker(page);
    });
}

function markSharePermissionAttempted(page) {
  if (page._shareLaunchMarkerId && page._shareLaunchWaitForPermission && !page._shareLaunchPermissionSettled) {
    page._shareLaunchPermissionSettled = true;
    if (page._shareLaunchNeedAuthRetry) {
      retryShareMarkerDetailAfterAuth(page);
    } else {
      tryActivateShareMarker(page);
    }
  }
  if (page._sharePinLaunchId && page._sharePinWaitForPermission && !page._sharePinPermissionSettled) {
    page._sharePinPermissionSettled = true;
    if (page._sharePinNeedAuthRetry) {
      retrySharePinDetailAfterAuth(page);
    } else {
      tryActivateSharePin(page);
    }
  }
}

function retryShareMarkerDetailAfterAuth(page) {
  if (!page._shareLaunchMarkerId) {
    tryActivateShareMarker(page);
    return;
  }
  const fetchAfterAuth = () => {
    if (!page._shareLaunchMarkerId || page._shareLaunchHandled) {
      tryActivateShareMarker(page);
      return;
    }
    page._shareLaunchNeedAuthRetry = false;
    fetchShareMarkerDetailById(page, page._shareLaunchMarkerId, { allowRetry: false });
  };
  if (page.hasAccessToken()) {
    fetchAfterAuth();
    return;
  }
  if (page._shareLaunchAuthPromise) {
    return;
  }
  page._shareLaunchAuthPromise = page.ensureProfileAuthenticated()
    .then(() => {
      fetchAfterAuth();
    })
    .catch((err) => {
      page._shareLaunchError = err || new Error("login-failed");
      tryActivateShareMarker(page);
    })
    .finally(() => {
      page._shareLaunchAuthPromise = null;
    });
}

function tryActivateShareMarker(page) {
  if (!page._shareLaunchMarkerId || page._shareLaunchHandled) {
    return;
  }
  if (!page._shareLaunchPermissionSettled) {
    return;
  }
  if (page._shareLaunchDetail) {
    const success = activateShareMarkerDetail(page, page._shareLaunchDetail);
    page._shareLaunchHandled = true;
    page._shareLaunchDetail = null;
    page._shareLaunchMarkerId = "";
    if (!success) {
      return;
    }
    return;
  }
  if (page._shareLaunchError) {
    handleShareMarkerError(page, page._shareLaunchError);
    page._shareLaunchHandled = true;
    page._shareLaunchMarkerId = "";
    page._shareLaunchError = null;
  }
}

function handleShareMarkerError(page, err) {
  const message =
    err && err.message === "missing-token"
      ? "请先登录后再查看商户详情"
      : "加载商户详情失败，请稍后重试";
  wx.showToast({ title: message, icon: "none" });
}

function activateShareMarkerDetail(page, rawDetail) {
  const marker = buildShareMarkerFromDetail(page, rawDetail);
  if (!marker) {
    wx.showToast({ title: "商户信息不完整", icon: "none" });
    return false;
  }
  const detail = marker?.extData?.detail || {};
  const isApproved = page.isDetailApproved(detail);
  if (!isApproved) {
    page._manualMarkers = [marker];
    page.syncAllMarkers();
  } else if (Array.isArray(page._manualMarkers) && page._manualMarkers.length) {
    page._manualMarkers = [];
    page.syncAllMarkers();
  }
  page.centerOnPoint(
    { latitude: marker.latitude, longitude: marker.longitude },
    clampMapScale(16)
  );
  if (isApproved) {
    page.scheduleFetchMarkers(0, {
      force: true,
      center: { latitude: marker.latitude, longitude: marker.longitude },
      scale: page.data.scale
    });
  }
  page.openMarkerPage(detail);
  return true;
}

function buildShareMarkerFromDetail(page, rawDetail = {}) {
  if (!rawDetail) {
    return null;
  }
  const detail = page.composeMarkerDetail(rawDetail, {}, {
    source: "share",
    id: rawDetail.id,
    name: rawDetail.name,
    locationText: rawDetail.locationText
  });
  const latitude = Number(detail.latitude);
  const longitude = Number(detail.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const gcj = wgs84ToGcj02(longitude, latitude);
  const latitudeGcj = Number.isFinite(gcj?.lat) ? gcj.lat : latitude;
  const longitudeGcj = Number.isFinite(gcj?.lng) ? gcj.lng : longitude;
  const markerName = detail.name || "商户位置";
  const markerId = detail.markerId || detail.id || rawDetail.id || `share-${Date.now()}`;
  const marker = {
    id: markerId,
    latitude: latitudeGcj,
    longitude: longitudeGcj,
    title: markerName,
    iconPath: "/assets/drone.png",
    width: 44,
    height: 44,
    extData: {
      source: "share",
      raw: rawDetail,
      detail: cloneMarkerDetail(detail)
    }
  };
  const calloutContent = formatNearbyMarkerLabel(markerName);
  if (calloutContent) {
    marker.callout = buildMarkerNameCallout(calloutContent);
  }
  return marker;
}

function initializePinShareLaunch(page, options = {}) {
  page._sharePinLaunchId = "";
  page._sharePinWaitForPermission = false;
  page._sharePinPermissionSettled = true;
  page._sharePinHandled = false;
  page._sharePinDetail = null;
  page._sharePinError = null;
  page._sharePinFetchPromise = null;
  page._sharePinFetchSeq = 0;
  page._sharePinNeedAuthRetry = false;
  page._sharePinAuthPromise = null;
  const normalized = normalizeLaunchPinOptions(options);
  if (!normalized.pinId) {
    return;
  }
  page._sharePinLaunchId = normalized.pinId;
  page._sharePinWaitForPermission = !!normalized.delayUntilPermission;
  page._sharePinPermissionSettled = !page._sharePinWaitForPermission;
  fetchSharePinDetailById(page, normalized.pinId);
}

function fetchSharePinDetailById(page, pinId, options = {}) {
  const id = `${pinId || ""}`.trim();
  if (!id) {
    return;
  }
  const allowRetry = options.allowRetry !== false;
  page._sharePinFetchSeq = (page._sharePinFetchSeq || 0) + 1;
  const seq = page._sharePinFetchSeq;
  const request = fetchPinDetail(id, {
    apiBase: page.getApiBase(),
    token: page.getAuthToken()
  });
  page._sharePinFetchPromise = request;
  request
    .then((detail) => {
      if (page._sharePinFetchPromise !== request || page._sharePinFetchSeq !== seq) {
        return;
      }
      page._sharePinFetchPromise = null;
      page._sharePinDetail = detail;
      page._sharePinError = null;
      page._sharePinNeedAuthRetry = false;
      tryActivateSharePin(page);
    })
    .catch((err) => {
      if (page._sharePinFetchPromise !== request || page._sharePinFetchSeq !== seq) {
        return;
      }
      page._sharePinFetchPromise = null;
      if (allowRetry && err && err.message === "missing-token") {
        page._sharePinNeedAuthRetry = true;
        page._sharePinDetail = null;
        page._sharePinError = null;
        if (page._sharePinPermissionSettled) {
          retrySharePinDetailAfterAuth(page);
        }
        return;
      }
      page._sharePinDetail = null;
      page._sharePinError = err || new Error("pin-detail-failed");
      tryActivateSharePin(page);
    });
}

function retrySharePinDetailAfterAuth(page) {
  if (!page._sharePinLaunchId) {
    tryActivateSharePin(page);
    return;
  }
  const fetchAfterAuth = () => {
    if (!page._sharePinLaunchId || page._sharePinHandled) {
      tryActivateSharePin(page);
      return;
    }
    page._sharePinNeedAuthRetry = false;
    fetchSharePinDetailById(page, page._sharePinLaunchId, { allowRetry: false });
  };
  if (page.hasAccessToken()) {
    fetchAfterAuth();
    return;
  }
  if (page._sharePinAuthPromise) {
    return;
  }
  page._sharePinAuthPromise = page.ensureProfileAuthenticated()
    .then(() => {
      fetchAfterAuth();
    })
    .catch((err) => {
      page._sharePinError = err || new Error("login-failed");
      tryActivateSharePin(page);
    })
    .finally(() => {
      page._sharePinAuthPromise = null;
    });
}

function tryActivateSharePin(page) {
  if (!page._sharePinLaunchId || page._sharePinHandled) {
    return;
  }
  if (!page._sharePinPermissionSettled) {
    return;
  }
  if (page._sharePinDetail) {
    const success = activateSharePinDetail(page, page._sharePinDetail);
    page._sharePinHandled = true;
    page._sharePinDetail = null;
    page._sharePinLaunchId = "";
    if (!success) {
      return;
    }
    return;
  }
  if (page._sharePinError) {
    handleSharePinError(page, page._sharePinError);
    page._sharePinHandled = true;
    page._sharePinLaunchId = "";
    page._sharePinError = null;
  }
}

function handleSharePinError(page, err) {
  const message =
    err && err.message === "missing-token"
      ? "请先登录后查看标记信息"
      : "加载标记信息失败，请稍后再试";
  wx.showToast({ title: message, icon: "none" });
}

function activateSharePinDetail(page, rawDetail) {
  const marker = buildSharePinFromDetail(page, rawDetail);
  if (!marker) {
    wx.showToast({ title: "标记信息异常", icon: "none" });
    return false;
  }
  const detail = marker?.extData?.detail || {};
  page.isDetailSharable(detail);
  page._previewPolygons = [];
  page._previewCircles = [];
  page.updateOverlayGraphics();
  page.centerOnPoint(
    { latitude: marker.latitude, longitude: marker.longitude },
    clampMapScale(16)
  );
  page.openMarkerPage(detail);
  return true;
}

function buildSharePinFromDetail(page, rawDetail = {}) {
  if (!rawDetail) {
    return null;
  }
  const detail = page.buildPinDetailFromPin(rawDetail);
  if (!detail) {
    return null;
  }
  const latitude = Number(detail.latitude);
  const longitude = Number(detail.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const markerName = detail.name || "空标记";
  const markerId = detail.markerId || detail.id || rawDetail.id || `pin-share-${Date.now()}`;
  const previewMarker =
    page.buildPinPreviewMarker({
      id: markerId,
      name: markerName,
      location: { latitude, longitude },
      shape: rawDetail.shape || detail.raw?.shape,
      height: rawDetail.height || rawDetail.altitude || detail.height
    }) || {};
  const marker = Object.assign(
    {
      id: markerId,
      latitude,
      longitude,
      iconPath: "/assets/default.png",
      width: 32,
      height: 32
    },
    previewMarker
  );
  marker.latitude = Number.isFinite(marker.latitude) ? marker.latitude : latitude;
  marker.longitude = Number.isFinite(marker.longitude) ? marker.longitude : longitude;
  if (!marker.callout || !marker.callout.content) {
    const calloutContent = formatNearbyMarkerLabel(markerName);
    if (calloutContent) {
      marker.callout = buildMarkerNameCallout(calloutContent);
    }
  }
  marker.extData = Object.assign({}, marker.extData, {
    source: "pin-share",
    raw: rawDetail,
    detail: cloneMarkerDetail(detail)
  });
  return marker;
}

function focusOnlineMarker(page, request = {}) {
  const latitude = Number(request.latitude);
  const longitude = Number(request.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return;
  }
  page.clearManualMarkers();
  const gcj = wgs84ToGcj02(longitude, latitude);
  const target = {
    latitude: Number.isFinite(gcj?.lat) ? gcj.lat : latitude,
    longitude: Number.isFinite(gcj?.lng) ? gcj.lng : longitude
  };
  page.centerOnPoint(target, clampMapScale(request.scale || 15));
}

function focusOfflineMarker(page, request = {}) {
  const latitude = Number(request.latitude);
  const longitude = Number(request.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    wx.showToast({ title: "标记缺少位置信息", icon: "none" });
    return;
  }
  const rawDetail =
    request.offlineRaw && typeof request.offlineRaw === "object"
      ? Object.assign({}, request.offlineRaw)
      : {};
  const detail = page.composeMarkerDetail(rawDetail, {}, {
    source: "offline",
    id: request.markerId,
    name: request.name,
    locationText: request.locationText,
    latitude,
    longitude
  });
  page.applyOfflineSnapshot(detail, request.detailSnapshot);
  detail.shareDisabled = request.shareDisabled !== false;
  if (request.reviewStatus) {
    detail.reviewStatus = request.reviewStatus;
  }
  const gcj = wgs84ToGcj02(longitude, latitude);
  const latitudeGcj = Number.isFinite(gcj?.lat) ? gcj.lat : latitude;
  const longitudeGcj = Number.isFinite(gcj?.lng) ? gcj.lng : longitude;
  const markerId = detail.markerId || request.markerId || `offline-${Date.now()}`;
  const markerName = detail.name || request.name || "离线标记";
  const marker = {
    id: markerId,
    latitude: latitudeGcj,
    longitude: longitudeGcj,
    title: markerName,
    iconPath: "/assets/drone-offline.png",
    width: 44,
    height: 44,
    extData: {
      source: "offline",
      raw: rawDetail,
      detail: cloneMarkerDetail(detail)
    }
  };
  const calloutContent = formatNearbyMarkerLabel(markerName);
  if (calloutContent) {
    marker.callout = buildMarkerNameCallout(calloutContent);
  }
  page._manualMarkers = [marker];
  page.syncAllMarkers();
  page.centerOnPoint(
    { latitude: latitudeGcj, longitude: longitudeGcj },
    clampMapScale(request.scale || 15)
  );
  page.openMarkerDetail(marker);
}

function applyOfflineSnapshot(detail, snapshot = {}) {
  if (!detail || !snapshot || typeof snapshot !== "object") {
    return;
  }
  const resolveUrl = (item) => {
    if (!item) return "";
    if (typeof item === "string") {
      return item.trim();
    }
    if (typeof item.url === "string" && item.url.trim()) {
      return item.url.trim();
    }
    if (typeof item.fileName === "string" && item.fileName.trim()) {
      return item.fileName.trim();
    }
    return "";
  };
  if ((!detail.images || !detail.images.length) && Array.isArray(snapshot.images)) {
    detail.images = snapshot.images
      .map((item, index) => {
        const url = resolveUrl(item);
        if (!url) return null;
        return {
          id: (item && item.id) || `${detail.markerId || "offline"}-image-${index}`,
          url,
          fileName: (item && item.fileName) || url
        };
      })
      .filter(Boolean);
  }
  if ((!detail.attachments || !detail.attachments.length) && Array.isArray(snapshot.attachments)) {
    detail.attachments = snapshot.attachments
      .map((item, index) => {
        const url = resolveUrl(item);
        if (!url) return null;
        const displayName =
          (item && (item.displayName || item.name || item.fileName)) ||
          url.split("/").pop() ||
          "附件";
        return {
          id: (item && item.id) || `${detail.markerId || "offline"}-attachment-${index}`,
          url,
          displayName,
          fileName: (item && (item.fileName || item.name)) || displayName
        };
      })
      .filter(Boolean);
  }
  if ((!detail.qrCodes || !detail.qrCodes.length) && Array.isArray(snapshot.qrCodes)) {
    detail.qrCodes = snapshot.qrCodes
      .map((item, index) => {
        const url = resolveUrl(item);
        if (!url) return null;
        return {
          id: (item && item.id) || `${detail.markerId || "offline"}-qr-${index}`,
          url,
          fileName: (item && (item.fileName || item.name)) || ""
        };
      })
      .filter(Boolean);
  }
  if ((!detail.honors || !detail.honors.length) && Array.isArray(snapshot.honors)) {
    detail.honors = snapshot.honors.slice();
  }
  if (!detail.description && snapshot.description) {
    detail.description = snapshot.description;
  }
  if (!detail.phone && snapshot.phone) {
    detail.phone = snapshot.phone;
  }
  if (!detail.locationText && snapshot.locationText) {
    detail.locationText = snapshot.locationText;
  }
  if (!detail.name && snapshot.name) {
    detail.name = snapshot.name;
  }
}

function getShareInviteCodeValue() {
  if (typeof getShareInviteCodeUtil !== "function") {
    return "";
  }
  try {
    return getShareInviteCodeUtil();
  } catch (err) {
    console.warn("getShareInviteCodeValue failed", err);
    return "";
  }
}

function onShareAppMessage(page, event = {}) {
  const posterUrl = buildFileDownloadUrl("main-page.png", { apiBase: page.getApiBase() });
  const isCenterPinShareButton =
    event?.from === "button" &&
    !page.data.markerPageVisible &&
    !page.data.markerDetailVisible;
  const centerShare = isCenterPinShareButton
    ? page.buildCurrentCenterSharePayload()
    : page.consumeCenterActionSharePayload();
  if (isCenterPinShareButton) {
    page.clearPendingCenterActionShare();
  }
  if (centerShare && centerShare.queryBase) {
    return {
      title: centerShare.title,
      path: appendInviteCodeToPath(`/pages/map/map?${centerShare.queryBase}`),
      imageUrl: posterUrl
    };
  }
  const detail = page._lastMarkerDetail;
  const inviteCode = getShareInviteCodeValue();
  const fallback = {
    title: "与uom、大疆100%同步的低空地图，来一起探索~",
    path: appendInviteCodeToPath("/pages/map/map", { inviteCode }),
    imageUrl: posterUrl
  };
  if (!detail) {
    return fallback;
  }
  if (!page.isDetailSharable(detail)) {
    page.showShareBlockedToast();
    return fallback;
  }
  const rawDetail = detail?.raw || {};
  const isPinDetail = page.isPinDetail(detail);
  const targetValue = isPinDetail
    ? (rawDetail.pinIdNew ?? detail.pinIdNew ?? detail.markerId ?? detail.id ?? rawDetail.id ?? "")
    : (rawDetail.markIdNew ?? detail.markIdNew ?? detail.markerId ?? detail.id ?? rawDetail.id ?? "");
  const targetId = targetValue !== undefined && targetValue !== null ? `${targetValue}` : "";
  if (!targetId) {
    return fallback;
  }
  if (isPinDetail) {
    return {
      title: detail.name,
      path: appendInviteCodeToPath(
        `/pages/map/map?fs=1&pId=${encodeURIComponent(targetId)}`,
        { inviteCode }
      )
    };
  }
  return {
    title: detail.name,
    path: appendInviteCodeToPath(
      `/pages/map/map?fs=1&mId=${encodeURIComponent(targetId)}`,
      { inviteCode }
    )
  };
}

function onShareTimeline(page) {
  const centerShare = page.consumeCenterActionSharePayload();
  if (centerShare && centerShare.queryBase) {
    return {
      title: centerShare.title,
      query: appendInviteCodeToQuery(centerShare.queryBase)
    };
  }
  const detail = page._lastMarkerDetail;
  const inviteCode = getShareInviteCodeValue();
  const fallback = {
    title: "uom、大疆100%同步且可视化，还有低空智能体~",
    query: appendInviteCodeToQuery("", { inviteCode })
  };
  if (!detail) {
    return fallback;
  }
  if (!page.isDetailSharable(detail)) {
    page.showShareBlockedToast();
    return fallback;
  }
  const rawDetail = detail?.raw || {};
  const isPinDetail = page.isPinDetail(detail);
  const targetValue = isPinDetail
    ? (rawDetail.pinIdNew ?? detail.pinIdNew ?? detail.markerId ?? detail.id ?? rawDetail.id ?? "")
    : (rawDetail.markIdNew ?? detail.markIdNew ?? detail.markerId ?? detail.id ?? rawDetail.id ?? "");
  const targetId = targetValue !== undefined && targetValue !== null ? `${targetValue}` : "";
  if (!targetId) {
    return fallback;
  }
  const queryBase = isPinDetail
    ? `pId=${encodeURIComponent(targetId)}&fs=1`
    : `mId=${encodeURIComponent(targetId)}&fs=1`;
  return {
    title: fallback.title,
    query: appendInviteCodeToQuery(queryBase, { inviteCode })
  };
}

module.exports = {
  takePendingMarkerFocus,
  consumePendingMarkerFocus,
  consumePendingPinPreview,
  captureInviteCode,
  initializeCenterShareLaunch,
  applyCenterShareLaunch,
  scheduleCenterShareLaunchLockAlign,
  shouldIgnoreCenterShareLaunchSync,
  prepareCenterActionShare,
  buildCenterActionSharePayload,
  buildCurrentCenterSharePayload,
  consumeCenterActionSharePayload,
  clearPendingCenterActionShare,
  initializeShareLaunch,
  fetchShareMarkerDetailById,
  markSharePermissionAttempted,
  retryShareMarkerDetailAfterAuth,
  tryActivateShareMarker,
  handleShareMarkerError,
  activateShareMarkerDetail,
  buildShareMarkerFromDetail,
  initializePinShareLaunch,
  fetchSharePinDetailById,
  retrySharePinDetailAfterAuth,
  tryActivateSharePin,
  handleSharePinError,
  activateSharePinDetail,
  buildSharePinFromDetail,
  focusOnlineMarker,
  focusOfflineMarker,
  applyOfflineSnapshot,
  getShareInviteCodeValue,
  onShareAppMessage,
  onShareTimeline
};
