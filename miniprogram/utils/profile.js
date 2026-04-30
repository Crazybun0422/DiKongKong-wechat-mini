const DEFAULT_AVATAR_PATH = "/assets/default-avatar.png";
const USER_PROFILE_STORAGE_KEY = "userProfile";
const FEATURE_CODE_STORAGE_KEY = "userFeatureCode";
const DEFAULT_NICKNAME = "低空用户";
const FEATURE_CODE_LENGTH = 6;
const FEATURE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function getAppInstance() {
  try {
    return getApp ? getApp() : null;
  } catch (err) {
    console.warn("getApp failed", err);
    return null;
  }
}

function resolveApiBase(explicitBase) {
  if (explicitBase) return explicitBase;
  const app = getAppInstance();
  return app && app.globalData && app.globalData.apiBase ? app.globalData.apiBase : "";
}

function getAuthToken() {
  const app = getAppInstance();
  return app && app.globalData ? app.globalData.token : "";
}

function extractAvatarFileName(value) {
  if (!value) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractAvatarFileName(item);
      if (extracted) return extracted;
    }
    return "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const withoutFragment = trimmed.split("#")[0];
    const withoutQuery = withoutFragment.split("?")[0];
    const parts = withoutQuery.split(/[/\\]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : withoutQuery;
  }
  if (typeof value === "object") {
    const candidate =
      value.fileName ||
      value.filename ||
      value.objectName ||
      value.name ||
      value.location ||
      value.path ||
      (typeof value.url === "string" ? value.url : "");
    if (candidate) return extractAvatarFileName(candidate);
  }
  return "";
}

function buildAvatarDownloadUrl(value, options = {}) {
  if (!value) return DEFAULT_AVATAR_PATH;
  if (typeof value === "string" && (/^https?:\/\//.test(value) || value.startsWith("wxfile://"))) {
    return value;
  }
  const base = resolveApiBase(options.apiBase);
  if (!base) return value;
  return `${base}/api/files/download/${encodeURIComponent(value)}`;
}

function prepareAvatarForUpload(src) {
  const source = src || DEFAULT_AVATAR_PATH;
  return new Promise((resolve, reject) => {
    if (!source || typeof source !== "string") {
      reject(new Error("invalid-avatar-source"));
      return;
    }
    const userDataPath = (typeof wx !== "undefined" && wx.env && wx.env.USER_DATA_PATH) || "";
    if (source.startsWith("wxfile://") || (userDataPath && source.startsWith(userDataPath))) {
      resolve(source);
      return;
    }
    if (/^https?:\/\//.test(source)) {
      wx.downloadFile({
        url: source,
        success: (res) => {
          if (res && res.tempFilePath) {
            resolve(res.tempFilePath);
          } else {
            reject(new Error("download-avatar-empty"));
          }
        },
        fail: (err) => reject(err)
      });
      return;
    }
    wx.getImageInfo({
      src: source,
      success: (info) => {
        if (info && info.path) {
          resolve(info.path);
        } else {
          reject(new Error("image-info-missing"));
        }
      },
      fail: (err) => reject(err)
    });
  });
}

function uploadAvatarFile(filePath, options = {}) {
  const base = resolveApiBase(options.apiBase);
  if (!base) return Promise.reject(new Error("missing-api-base"));
  const token = options.token || getAuthToken();
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${base}/api/files/upload`,
      filePath,
      name: "file",
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success: (res) => {
        try {
          const body = JSON.parse(res?.data || "{}");
          if (body && body.data) {
            const extracted = extractAvatarFileName(body.data);
            if (extracted) {
              resolve(extracted);
              return;
            }
            if (typeof body.data === "string" && body.data.trim()) {
              const fallback = extractAvatarFileName(body.data.trim());
              if (fallback) {
                resolve(fallback);
                return;
              }
              resolve(body.data.trim());
              return;
            }
          }
        } catch (err) {
          console.warn("解析上传响应失败", err);
        }
        reject(new Error("upload-avatar-failed"));
      },
      fail: (err) => reject(err)
    });
  });
}

function createAuthorizedRequestError(reason, detail = {}) {
  const message = typeof reason === "string" ? reason : JSON.stringify(reason || {});
  const error = new Error(message || "request-failed");
  error.statusCode = detail.statusCode || 0;
  error.errMsg = detail.errMsg || "";
  error.method = detail.method || "";
  error.path = detail.path || "";
  error.url = detail.url || "";
  error.response = detail.response;
  error.rawError = detail.rawError;
  return error;
}

function authorizedRequest(options) {
  return new Promise((resolve, reject) => {
    const base = resolveApiBase(options.apiBase);
    const path = options.path || "";
    const method = options.method || "GET";
    const url = `${base}${path}`;

    if (!base) {
      reject(new Error("missing-api-base"));
      return;
    }

    const token = options.token || getAuthToken();

    if (!token) {
      reject(new Error("missing-token"));
      return;
    }
    wx.request({
      url,
      method,
      data: options.data || null,
      header: Object.assign(
        {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`
        },
        options.header || {}
      ),
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          const reason = res.data?.message || res.errMsg || `status-${res.statusCode}`;
          reject(
            createAuthorizedRequestError(reason, {
              statusCode: res.statusCode,
              errMsg: res.errMsg,
              method,
              path,
              url,
              response: res.data
            })
          );
        }
      },
      fail: (err) =>
        reject(
          createAuthorizedRequestError(err?.errMsg || "request-failed", {
            errMsg: err?.errMsg,
            method,
            path,
            url,
            rawError: err
          })
        )
    });
  });
}

function fetchUserProfile(options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/user/profile",
    method: "GET"
  }).then((body) => body?.data || {});
}

function updateUserProfile(payload = {}, options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/user/profile",
    method: "PUT",
    data: payload
  }).then((body) => body?.data || {});
}

function fetchLocationReportingEnabled(options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/user/profile/kv/location-reporting",
    method: "GET"
  }).then((body = {}) => body?.data || {});
}

function updateLocationReportingEnabled(enabled, options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/user/profile/kv/location-reporting",
    method: "PUT",
    data: { enabled: !!enabled }
  }).then((body = {}) => body?.data || {});
}

function uploadUserLocation(payload = {}, options = {}) {
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  if (!isFinite(latitude) || !isFinite(longitude)) {
    return Promise.reject(new Error("invalid-location"));
  }
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/user/location",
    method: "POST",
    data: { latitude, longitude }
  }).then((body = {}) => body?.data || {});
}

function fetchNearbyUsers(params = {}, options = {}) {
  const latitude = Number(params.latitude);
  const longitude = Number(params.longitude);
  const radiusInKilometers = Number(params.radiusInKilometers);
  if (!isFinite(latitude) || !isFinite(longitude) || !isFinite(radiusInKilometers)) {
    return Promise.reject(new Error("invalid-nearby-user-params"));
  }
  const query = [
    `latitude=${encodeURIComponent(latitude)}`,
    `longitude=${encodeURIComponent(longitude)}`,
    `radiusInKilometers=${encodeURIComponent(radiusInKilometers)}`
  ].join("&");
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/user/nearby?${query}`,
    method: "GET"
  }).then((body = {}) => body?.data || []);
}

function normalizeProfileData(raw = {}, options = {}) {
  const stored = options.storedProfile || {};
  const fallbackName =
    (stored.nickname || stored.nickName || stored.username || "").trim();
  const nickname =
    (raw.nickname || raw.nickName || raw.username || "").trim() ||
    fallbackName ||
    DEFAULT_NICKNAME;
  const featureCandidates = [
    raw.featureCode,
    raw.loginSeq,
    raw.userId,
    stored.featureCode,
    stored.loginSeq,
    stored.userId,
    stored.username
  ];
  let featureCode = "";
  for (const candidate of featureCandidates) {
    if (candidate === undefined || candidate === null) continue;
    const text = `${candidate}`.trim();
    if (text) {
      featureCode = text;
      break;
    }
  }
  featureCode = ensureFeatureCode(featureCode);
  const avatarCandidate =
    raw.avatarFileName ||
    raw.avatarUrl ||
    raw.avatar ||
    stored.avatarFileName ||
    stored.avatarUrl ||
    "";
  const avatarFileName = extractAvatarFileName(avatarCandidate);
  let displayAvatar = DEFAULT_AVATAR_PATH;
  if (avatarFileName) {
    displayAvatar = buildAvatarDownloadUrl(avatarFileName, options);
  } else if (typeof avatarCandidate === "string" && /^https?:\/\//.test(avatarCandidate)) {
    displayAvatar = avatarCandidate;
  }
  const flpRaw = raw.flp ?? raw.FLP ?? raw.flpBalance ?? stored.flpValue ?? stored.flp;
  let flpValue = null;
  if (typeof flpRaw === "number" && isFinite(flpRaw)) {
    flpValue = flpRaw;
  } else if (typeof flpRaw === "string" && flpRaw.trim()) {
    const parsed = Number(flpRaw.trim());
    if (isFinite(parsed)) flpValue = parsed;
  }
  const inviteCode = normalizeInviteCodeValue(raw.inviteCode || stored.inviteCode || "");
  const vip = normalizeBooleanFlag(
    raw.vip ??
    raw.member ??
    raw.membership ??
    raw.isMember ??
    stored.vip ??
    stored.member
  );
  const memberExpireDate = normalizeInviteCodeValue(
    raw.memberExpireDate ||
    raw.membershipExpireDate ||
    raw.vipExpireDate ||
    stored.memberExpireDate ||
    stored.membershipExpireDate ||
    ""
  );
  const checkinQuota = normalizeCheckinQuota(raw.checkinQuota || stored.checkinQuota || {});
  const selectedVoicePackDirectoryName = normalizeInviteCodeValue(
    raw.selectedVoicePackDirectoryName ||
    raw.voicePackDirectoryName ||
    raw.voicePack ||
    stored.selectedVoicePackDirectoryName ||
    stored.voicePackDirectoryName ||
    ""
  );
  return {
    nickname,
    featureCode,
    avatarFileName: avatarFileName || "",
    avatarUrl: displayAvatar,
    flpValue,
    inviteCode,
    vip,
    member: vip,
    memberExpireDate,
    selectedVoicePackDirectoryName,
    checkinQuota,
    flpDisplay: typeof flpValue === "number" && isFinite(flpValue) ? flpValue.toFixed(2) : "--"
  };
}

function generateFeatureCode(length = FEATURE_CODE_LENGTH) {
  const alphabet = FEATURE_CODE_ALPHABET;
  if (!alphabet || !alphabet.length) return "";
  let attempt = "";
  let loops = 0;
  const maxLoops = 12;
  while (loops < maxLoops) {
    let candidate = "";
    for (let i = 0; i < length; i += 1) {
      const idx = Math.floor(Math.random() * alphabet.length);
      candidate += alphabet.charAt(idx);
    }
    if (/[A-Z]/.test(candidate) && /\d/.test(candidate)) {
      attempt = candidate;
      break;
    }
    attempt = candidate;
    loops += 1;
  }
  return attempt;
}

function readFeatureCodeFromStorage() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
    return "";
  }
  try {
    const cached = wx.getStorageSync(FEATURE_CODE_STORAGE_KEY);
    if (typeof cached === "string" && cached.trim()) {
      return cached.trim();
    }
  } catch (err) {
    console.warn("读取低空号缓存失败", err);
  }
  return "";
}

function persistFeatureCode(value) {
  const code = typeof value === "string" ? value.trim() : `${value || ""}`.trim();
  if (!code) return;
  const app = getAppInstance();
  if (app && app.globalData) {
    app.globalData.userFeatureCode = code;
  }
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") {
    return;
  }
  try {
    wx.setStorageSync(FEATURE_CODE_STORAGE_KEY, code);
  } catch (err) {
    console.warn("缓存低空号失败", err);
  }
}

function ensureFeatureCode(value) {
  const direct = typeof value === "string" ? value.trim() : `${value || ""}`.trim();
  if (direct) {
    persistFeatureCode(direct);
    return direct;
  }
  const app = getAppInstance();
  const fromGlobal = app && app.globalData ? `${app.globalData.userFeatureCode || ""}`.trim() : "";
  if (fromGlobal) return fromGlobal;
  const cached = readFeatureCodeFromStorage();
  if (cached) return cached;
  const generated = generateFeatureCode();
  persistFeatureCode(generated);
  return generated;
}

function normalizeInviteCodeValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  return `${value}`.trim();
}

function normalizeBooleanFlag(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    const numeric = Number(normalized);
    if (isFinite(numeric)) return numeric > 0;
    return ["true", "yes", "y", "vip", "svip", "member"].includes(normalized);
  }
  return !!value;
}

function normalizeCheckinQuota(raw = {}) {
  const remainingMakeupCount = Number(raw.remainingMakeupCount);
  const remainingAssistCount = Number(raw.remainingAssistCount);
  return {
    remainingMakeupCount: isFinite(remainingMakeupCount) ? remainingMakeupCount : 0,
    remainingAssistCount: isFinite(remainingAssistCount) ? remainingAssistCount : 0
  };
}

function readStoredProfileObject() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
    return {};
  }
  try {
    const cached = wx.getStorageSync(USER_PROFILE_STORAGE_KEY);
    if (cached && typeof cached === "object") {
      return cached;
    }
  } catch (err) {
    console.warn("读取用户资料缓存失败", err);
  }
  return {};
}

function persistProfileLocally(profile = {}) {
  const existing = readStoredProfileObject();
  const nicknameCandidate = (
    profile.nickname ||
    profile.nickName ||
    existing.nickname ||
    existing.nickName ||
    ""
  ).trim();
  const nickname = nicknameCandidate || DEFAULT_NICKNAME;
  const avatarUrl = profile.avatarUrl || existing.avatarUrl || "";
  const featureCode = ensureFeatureCode(
    profile.featureCode ||
    profile.loginSeq ||
    profile.userId ||
    existing.featureCode ||
    existing.userFeatureCode ||
    ""
  );
  let flpValue = profile.flpValue;
  if (flpValue === undefined) flpValue = existing.flpValue;
  if (typeof flpValue !== "number" || !isFinite(flpValue)) {
    flpValue = null;
  }
  const inviteCode =
    normalizeInviteCodeValue(profile.inviteCode) || normalizeInviteCodeValue(existing.inviteCode);
  const vip = normalizeBooleanFlag(profile.vip ?? existing.vip);
  const memberExpireDate = normalizeInviteCodeValue(
    profile.memberExpireDate ||
    profile.membershipExpireDate ||
    profile.vipExpireDate ||
    existing.memberExpireDate ||
    existing.membershipExpireDate ||
    ""
  );
  const checkinQuota = normalizeCheckinQuota(profile.checkinQuota || existing.checkinQuota || {});
  const selectedVoicePackDirectoryName = normalizeInviteCodeValue(
    profile.selectedVoicePackDirectoryName ||
    profile.voicePackDirectoryName ||
    profile.voicePack ||
    existing.selectedVoicePackDirectoryName ||
    existing.voicePackDirectoryName ||
    ""
  );

  const payload = {
    nickname,
    avatarUrl,
    featureCode,
    flpValue,
    inviteCode,
    vip,
    member: vip,
    memberExpireDate,
    selectedVoicePackDirectoryName,
    checkinQuota
  };

  const app = getAppInstance();
  if (app && app.globalData) {
    app.globalData.userProfile = { nickName: nickname, avatarUrl };
    app.globalData.userFeatureCode = featureCode;
    app.globalData.userInviteCode = inviteCode;
    app.globalData.userVip = vip;
    app.globalData.userMemberExpireDate = memberExpireDate;
    app.globalData.userCheckinQuota = checkinQuota;
    app.globalData.userSelectedVoicePackDirectoryName = selectedVoicePackDirectoryName;
    if (flpValue !== null) app.globalData.userFlp = flpValue;
  }

  if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
    try {
      wx.setStorageSync(USER_PROFILE_STORAGE_KEY, payload);
    } catch (err) {
      console.warn("缓存用户资料失败", err);
    }
  }
  persistFeatureCode(featureCode);
  return payload;
}

function loadStoredProfile() {
  const app = getAppInstance();
  const fromGlobal = app && app.globalData && app.globalData.userProfile;
  const nicknameFromGlobal = (fromGlobal && (fromGlobal.nickName || fromGlobal.nickname || "") || "").trim();
  const avatarFromGlobal = (fromGlobal && fromGlobal.avatarUrl) || "";
  const featureFromGlobal = app && app.globalData ? app.globalData.userFeatureCode || "" : "";
  const flpFromGlobal = app && app.globalData ? app.globalData.userFlp : null;
  const inviteFromGlobal = app && app.globalData ? app.globalData.userInviteCode || "" : "";
  const vipFromGlobal = app && app.globalData ? app.globalData.userVip : false;
  const memberExpireDateFromGlobal = app && app.globalData ? app.globalData.userMemberExpireDate || "" : "";
  const selectedVoicePackFromGlobal =
    app && app.globalData ? app.globalData.userSelectedVoicePackDirectoryName || "" : "";
  if (nicknameFromGlobal || avatarFromGlobal || featureFromGlobal) {
    const featureCode = ensureFeatureCode(featureFromGlobal);
    const inviteCode = normalizeInviteCodeValue(inviteFromGlobal);
    const vip = normalizeBooleanFlag(vipFromGlobal);
    return {
      nickname: nicknameFromGlobal || DEFAULT_NICKNAME,
      avatarUrl: avatarFromGlobal || "",
      featureCode,
      flpValue: typeof flpFromGlobal === "number" && isFinite(flpFromGlobal) ? flpFromGlobal : null,
      inviteCode,
      vip,
      member: vip,
      memberExpireDate: normalizeInviteCodeValue(memberExpireDateFromGlobal),
      selectedVoicePackDirectoryName: normalizeInviteCodeValue(selectedVoicePackFromGlobal),
      checkinQuota: normalizeCheckinQuota(app?.globalData?.userCheckinQuota || {})
    };
  }

  const cached = readStoredProfileObject();
  if (cached && Object.keys(cached).length) {
    const nicknameCandidate = (cached.nickname || cached.nickName || "").trim();
    const avatarUrl = cached.avatarUrl || "";
    let flpValue = cached.flpValue;
    if (typeof flpValue !== "number" || !isFinite(flpValue)) {
      flpValue = null;
    }
    const featureCode = ensureFeatureCode(cached.featureCode || cached.userFeatureCode || "");
    const inviteCode = normalizeInviteCodeValue(cached.inviteCode);
    const vip = normalizeBooleanFlag(cached.vip ?? cached.member);
    const memberExpireDate = normalizeInviteCodeValue(
      cached.memberExpireDate || cached.membershipExpireDate || cached.vipExpireDate || ""
    );
    const selectedVoicePackDirectoryName = normalizeInviteCodeValue(
      cached.selectedVoicePackDirectoryName || cached.voicePackDirectoryName || cached.voicePack || ""
    );
    const checkinQuota = normalizeCheckinQuota(cached.checkinQuota || {});
    if (app && app.globalData) {
      app.globalData.userProfile = { nickName: nicknameCandidate || DEFAULT_NICKNAME, avatarUrl };
      app.globalData.userFeatureCode = featureCode;
      app.globalData.userInviteCode = inviteCode;
      app.globalData.userVip = vip;
      app.globalData.userMemberExpireDate = memberExpireDate;
      app.globalData.userCheckinQuota = checkinQuota;
      app.globalData.userSelectedVoicePackDirectoryName = selectedVoicePackDirectoryName;
      if (flpValue !== null) app.globalData.userFlp = flpValue;
    }
    return {
      nickname: nicknameCandidate || DEFAULT_NICKNAME,
      avatarUrl,
      featureCode,
      flpValue,
      inviteCode,
      vip,
      member: vip,
      memberExpireDate,
      selectedVoicePackDirectoryName,
      checkinQuota
    };
  }

  const featureCode = ensureFeatureCode("");
  return {
    nickname: DEFAULT_NICKNAME,
    avatarUrl: DEFAULT_AVATAR_PATH,
    featureCode,
    flpValue: null,
    inviteCode: "",
    vip: false,
    member: false,
    memberExpireDate: "",
    selectedVoicePackDirectoryName: "",
    checkinQuota: normalizeCheckinQuota()
  };
}

function hasStoredProfile() {
  const app = getAppInstance();
  const fromGlobal = app && app.globalData && app.globalData.userProfile;
  if (fromGlobal) {
    const nickname = (fromGlobal.nickName || fromGlobal.nickname || "").trim();
    const avatarUrl = fromGlobal.avatarUrl || "";
    if (nickname || avatarUrl) return true;
  }
  const cached = readStoredProfileObject();
  if (cached && Object.keys(cached).length) {
    const nickname = (cached.nickname || cached.nickName || "").trim();
    const avatarUrl = cached.avatarUrl || "";
    if (nickname || avatarUrl) return true;
  }
  return false;
}

module.exports = {
  DEFAULT_AVATAR_PATH,
  extractAvatarFileName,
  buildAvatarDownloadUrl,
  prepareAvatarForUpload,
  uploadAvatarFile,
  fetchUserProfile,
  updateUserProfile,
  fetchLocationReportingEnabled,
  updateLocationReportingEnabled,
  uploadUserLocation,
  fetchNearbyUsers,
  normalizeProfileData,
  resolveApiBase,
  getAuthToken,
  authorizedRequest,
  generateFeatureCode,
  ensureFeatureCode,
  persistProfileLocally,
  loadStoredProfile,
  hasStoredProfile,
  USER_PROFILE_STORAGE_KEY,
  FEATURE_CODE_STORAGE_KEY,
  DEFAULT_NICKNAME
};
