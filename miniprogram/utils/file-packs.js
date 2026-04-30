const { authorizedRequest, getAuthToken, resolveApiBase } = require("./profile");

const FILE_PACK_TYPES = {
  AVATAR: "avatar",
  VOICE: "voice",
  BACKGROUND_IMAGE: "backgroundImage"
};

const FILE_PACK_CONFIG = {
  [FILE_PACK_TYPES.AVATAR]: {
    basePath: "/api/avatar-packs",
    versionRequiredOnUpload: false
  },
  [FILE_PACK_TYPES.VOICE]: {
    basePath: "/api/voice-packs",
    versionRequiredOnUpload: true
  },
  [FILE_PACK_TYPES.BACKGROUND_IMAGE]: {
    basePath: "/api/background-image-packs",
    versionRequiredOnUpload: true
  }
};

function resolvePackConfig(packType) {
  const key = `${packType || ""}`.trim();
  const config = FILE_PACK_CONFIG[key];
  if (!config) throw new Error("invalid-file-pack-type");
  return config;
}

function normalizePackVersion(raw = {}) {
  return {
    fileName: raw.fileName || raw.objectName || "",
    version: raw.version || ""
  };
}

function parseUploadResponse(res = {}) {
  let body = {};
  try {
    body = JSON.parse(res?.data || "{}");
  } catch (err) {
    throw err;
  }
  if (res.statusCode >= 200 && res.statusCode < 300) {
    return body?.data || {};
  }
  throw new Error(body?.message || res.errMsg || `status-${res.statusCode || 0}`);
}

function fetchFilePackVersion(packType, options = {}) {
  const config = resolvePackConfig(packType);
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token || getAuthToken(),
    path: `${config.basePath}/version`,
    method: "GET"
  }).then((body = {}) => normalizePackVersion(body?.data || {}));
}

function uploadFilePack(packType, filePath, options = {}) {
  const config = resolvePackConfig(packType);
  const apiBase = resolveApiBase(options.apiBase);
  const token = options.token || getAuthToken();
  const version = `${options.version || ""}`.trim();
  if (!apiBase) return Promise.reject(new Error("missing-api-base"));
  if (!token) return Promise.reject(new Error("missing-token"));
  if (!filePath) return Promise.reject(new Error("missing-file-path"));
  if (config.versionRequiredOnUpload && !version) {
    return Promise.reject(new Error("missing-pack-version"));
  }
  const formData = Object.assign({}, options.formData || {});
  if (version) formData.version = version;
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${apiBase}${config.basePath}/upload`,
      filePath,
      name: "file",
      formData,
      header: Object.assign({ Authorization: `Bearer ${token}` }, options.header || {}),
      success: (res) => {
        try {
          resolve(parseUploadResponse(res));
        } catch (err) {
          reject(err);
        }
      },
      fail: (err) => reject(err)
    });
  });
}

function downloadFilePack(packType, objectName, options = {}) {
  const config = resolvePackConfig(packType);
  const apiBase = resolveApiBase(options.apiBase);
  const token = options.token || getAuthToken();
  const normalizedObjectName = `${objectName || ""}`.trim();
  if (!apiBase) return Promise.reject(new Error("missing-api-base"));
  if (!token) return Promise.reject(new Error("missing-token"));
  if (!normalizedObjectName) return Promise.reject(new Error("missing-object-name"));
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${apiBase}${config.basePath}/download/${encodeURIComponent(normalizedObjectName)}`,
      header: Object.assign({ Authorization: `Bearer ${token}` }, options.header || {}),
      success: (res = {}) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res.tempFilePath);
          return;
        }
        reject(new Error(res.errMsg || `status-${res.statusCode || 0}`));
      },
      fail: (err) => reject(err)
    });
  });
}

const fetchAvatarPackVersion = (options = {}) =>
  fetchFilePackVersion(FILE_PACK_TYPES.AVATAR, options);
const uploadAvatarPack = (filePath, options = {}) =>
  uploadFilePack(FILE_PACK_TYPES.AVATAR, filePath, options);
const downloadAvatarPack = (objectName, options = {}) =>
  downloadFilePack(FILE_PACK_TYPES.AVATAR, objectName, options);

const fetchVoicePackVersion = (options = {}) =>
  fetchFilePackVersion(FILE_PACK_TYPES.VOICE, options);
const uploadVoicePack = (filePath, options = {}) =>
  uploadFilePack(FILE_PACK_TYPES.VOICE, filePath, options);
const downloadVoicePack = (objectName, options = {}) =>
  downloadFilePack(FILE_PACK_TYPES.VOICE, objectName, options);

const fetchBackgroundImagePackVersion = (options = {}) =>
  fetchFilePackVersion(FILE_PACK_TYPES.BACKGROUND_IMAGE, options);
const uploadBackgroundImagePack = (filePath, options = {}) =>
  uploadFilePack(FILE_PACK_TYPES.BACKGROUND_IMAGE, filePath, options);
const downloadBackgroundImagePack = (objectName, options = {}) =>
  downloadFilePack(FILE_PACK_TYPES.BACKGROUND_IMAGE, objectName, options);

module.exports = {
  FILE_PACK_TYPES,
  normalizePackVersion,
  fetchFilePackVersion,
  uploadFilePack,
  downloadFilePack,
  fetchAvatarPackVersion,
  uploadAvatarPack,
  downloadAvatarPack,
  fetchVoicePackVersion,
  uploadVoicePack,
  downloadVoicePack,
  fetchBackgroundImagePackVersion,
  uploadBackgroundImagePack,
  downloadBackgroundImagePack
};
