const {
  authorizedRequest,
  buildAvatarDownloadUrl,
  getAuthToken,
  resolveApiBase
} = require("./profile");

const USER_CREDENTIAL_TYPES = {
  THEORY: "OPERATION_THEORY_CERT",
  CAAC: "CAAC_LICENSE",
  OPERATION: "OPERATION_CERT",
  INSURANCE: "AIRCRAFT_INSURANCE"
};

const USER_CREDENTIAL_META = {
  [USER_CREDENTIAL_TYPES.THEORY]: {
    key: "theory",
    title: "操控理论合格证",
    fullTitle: "操控理论合格证",
    uploadLabel: "上传操控理论合格证",
    guideTitle: "考取操控理论合格证",
    guideSubtitle: "UOM官方提供的免费证书",
    richTextKey: "theoryCertificate"
  },
  [USER_CREDENTIAL_TYPES.CAAC]: {
    key: "caac",
    title: "CAAC执照",
    fullTitle: "民用无人驾驶航空器操控员执照",
    uploadLabel: "上传CAAC执照",
    guideTitle: "CAAC执照报名补贴",
    guideSubtitle: "联合上百家培训机构提供考证补贴",
    richTextKey: "caacLicenseRegistrationSubsidy"
  },
  [USER_CREDENTIAL_TYPES.OPERATION]: {
    key: "operation",
    title: "运营合格证",
    fullTitle: "民用无人驾驶航空器运营合格证",
    uploadLabel: "上传运营合格证",
    guideTitle: "办理运营合格证",
    guideSubtitle: "企业合法开展无人机商业运营的必备",
    richTextKey: "operationCertificate"
  },
  [USER_CREDENTIAL_TYPES.INSURANCE]: {
    key: "insurance",
    title: "爱机保险",
    fullTitle: "爱机保险",
    uploadLabel: "上传保单",
    guideTitle: "为爱机领取保险额度",
    guideSubtitle: "适配主流航拍设备的全面保障方案",
    richTextKey: "insuranceCoverage"
  }
};

function inferFileKind(value = "") {
  const text = `${value || ""}`.trim().toLowerCase();
  if (!text) return "unknown";
  if (/\.pdf(?:$|\?)/.test(text)) return "pdf";
  if (/\.(png|jpg|jpeg|webp|bmp|gif|heic|heif)(?:$|\?)/.test(text)) return "image";
  return "unknown";
}

function normalizeCredentialItem(item = {}, type = "") {
  const meta = USER_CREDENTIAL_META[type] || {};
  const objectName = item.objectName || item.fileName || "";
  const location = item.location || "";
  const originalFilename = item.originalFilename || "";
  const fileName = originalFilename || objectName || location || "";
  return {
    type: item.type || type,
    key: meta.key || type,
    title: meta.title || item.displayName || "",
    fullTitle: meta.fullTitle || meta.title || item.displayName || "",
    displayName: item.displayName || meta.title || "",
    objectName,
    location,
    originalFilename,
    fileName,
    updatedAt: item.updatedAt || "",
    richTextKey: meta.richTextKey || "",
    guideTitle: meta.guideTitle || "",
    guideSubtitle: meta.guideSubtitle || "",
    uploadLabel: meta.uploadLabel || "上传文件",
    bound: !!(objectName || location),
    fileKind: inferFileKind(originalFilename || objectName || location),
    publicUrl: objectName ? buildAvatarDownloadUrl(objectName) : ""
  };
}

function fetchUserCredentials(options = {}) {
  return authorizedRequest({
    apiBase: resolveApiBase(options.apiBase),
    token: options.token,
    path: "/api/user/credentials",
    method: "GET"
  }).then((body = {}) => {
    const rawMap = body?.data || {};
    const result = {};
    Object.keys(USER_CREDENTIAL_META).forEach((type) => {
      result[type] = normalizeCredentialItem(rawMap[type] || {}, type);
    });
    return result;
  });
}

function uploadUserCredential(type, filePath, options = {}) {
  const apiBase = resolveApiBase(options.apiBase);
  const token = options.token || getAuthToken();
  if (!apiBase) return Promise.reject(new Error("missing-api-base"));
  if (!token) return Promise.reject(new Error("missing-token"));
  if (!type) return Promise.reject(new Error("missing-credential-type"));
  if (!filePath) return Promise.reject(new Error("missing-file-path"));
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${apiBase}/api/user/credentials/upload`,
      filePath,
      name: "file",
      formData: { type },
      header: {
        Authorization: `Bearer ${token}`
      },
      success: (res) => {
        try {
          const body = JSON.parse(res?.data || "{}");
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(normalizeCredentialItem(body?.data || {}, type));
            return;
          }
          reject(new Error(body?.message || `status-${res?.statusCode || 0}`));
        } catch (err) {
          reject(err);
        }
      },
      fail: (err) => reject(err)
    });
  });
}

function downloadUserCredentialFile(item = {}, options = {}) {
  const apiBase = resolveApiBase(options.apiBase);
  const token = options.token || getAuthToken();
  const objectName = item?.objectName || "";
  if (!apiBase) return Promise.reject(new Error("missing-api-base"));
  if (!token) return Promise.reject(new Error("missing-token"));
  if (!objectName) return Promise.reject(new Error("missing-object-name"));
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${apiBase}/api/private/files/download/${encodeURIComponent(objectName)}`,
      header: {
        Authorization: `Bearer ${token}`
      },
      success: (res) => {
        if (Number(res?.statusCode) >= 200 && Number(res?.statusCode) < 300 && res?.tempFilePath) {
          resolve(res.tempFilePath);
          return;
        }
        reject(new Error(`status-${res?.statusCode || 0}`));
      },
      fail: (err) => reject(err)
    });
  });
}

function deleteUserCredential(type, options = {}) {
  if (!type) return Promise.reject(new Error("missing-credential-type"));
  const query = `type=${encodeURIComponent(type)}`;
  return authorizedRequest({
    apiBase: resolveApiBase(options.apiBase),
    token: options.token,
    path: `/api/user/credentials/item?${query}`,
    method: "DELETE"
  }).then((body = {}) => body?.data || {});
}

module.exports = {
  USER_CREDENTIAL_TYPES,
  USER_CREDENTIAL_META,
  inferFileKind,
  normalizeCredentialItem,
  fetchUserCredentials,
  uploadUserCredential,
  downloadUserCredentialFile,
  deleteUserCredential
};
