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

function authorizedRequest(options) {
  return new Promise((resolve, reject) => {
    const base = resolveApiBase(options.apiBase);
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
      url: `${base}${options.path}`,
      method: options.method || "GET",
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
          reject(new Error(typeof reason === "string" ? reason : JSON.stringify(reason)));
        }
      },
      fail: (err) => reject(err)
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
  return {
    nickname,
    featureCode,
    avatarFileName: avatarFileName || "",
    avatarUrl: displayAvatar,
    flpValue,
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

  const payload = {
    nickname,
    avatarUrl,
    featureCode,
    flpValue
  };

  const app = getAppInstance();
  if (app && app.globalData) {
    app.globalData.userProfile = { nickName: nickname, avatarUrl };
    app.globalData.userFeatureCode = featureCode;
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
  if (nicknameFromGlobal || avatarFromGlobal || featureFromGlobal) {
    const featureCode = ensureFeatureCode(featureFromGlobal);
    return {
      nickname: nicknameFromGlobal || DEFAULT_NICKNAME,
      avatarUrl: avatarFromGlobal || "",
      featureCode,
      flpValue: typeof flpFromGlobal === "number" && isFinite(flpFromGlobal) ? flpFromGlobal : null
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
    if (app && app.globalData) {
      app.globalData.userProfile = { nickName: nicknameCandidate || DEFAULT_NICKNAME, avatarUrl };
      app.globalData.userFeatureCode = featureCode;
      if (flpValue !== null) app.globalData.userFlp = flpValue;
    }
    return {
      nickname: nicknameCandidate || DEFAULT_NICKNAME,
      avatarUrl,
      featureCode,
      flpValue
    };
  }

  const featureCode = ensureFeatureCode("");
  return {
    nickname: DEFAULT_NICKNAME,
    avatarUrl: DEFAULT_AVATAR_PATH,
    featureCode,
    flpValue: null
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
