const {
  authorizedRequest,
  resolveApiBase,
  getAuthToken
} = require("./profile");

function buildFileDownloadUrl(fileName, options = {}) {
  if (!fileName) return "";
  if (typeof fileName === "string") {
    const trimmed = fileName.trim();
    if (!trimmed) return "";
    if (/^https?:\/\//.test(trimmed) || trimmed.startsWith("wxfile://")) {
      return trimmed;
    }
    const base = resolveApiBase(options.apiBase);
    if (!base) return trimmed;
    return `${base}/api/files/download/${encodeURIComponent(trimmed)}`;
  }
  return "";
}

function listMarkers(params = {}, options = {}) {
  const query = [];
  if (params.page !== undefined && params.page !== null) {
    const page = Number(params.page);
    if (Number.isFinite(page) && page >= 0) {
      query.push(`page=${page}`);
    }
  }
  if (params.size !== undefined && params.size !== null) {
    const size = Number(params.size);
    if (Number.isFinite(size) && size > 0) {
      query.push(`size=${size}`);
    }
  }
  const qs = query.length ? `?${query.join("&")}` : "";
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/markers${qs}`,
    method: "GET"
  }).then((body = {}) => body.data || {});
}

function createMarker(payload = {}, options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/markers",
    method: "POST",
    data: payload
  }).then((body = {}) => body.data || {});
}

function updateMarker(markerId, payload = {}, options = {}) {
  if (!markerId) return Promise.reject(new Error("missing-marker-id"));
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/markers/${encodeURIComponent(markerId)}`,
    method: "PUT",
    data: payload
  }).then((body = {}) => body.data || {});
}

function deleteMarker(markerId, options = {}) {
  if (!markerId) return Promise.reject(new Error("missing-marker-id"));
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/markers/${encodeURIComponent(markerId)}`,
    method: "DELETE"
  }).then((body = {}) => body.data || {});
}

function uploadMarkerFile(filePath, options = {}) {
  return new Promise((resolve, reject) => {
    if (!filePath) {
      reject(new Error("missing-file-path"));
      return;
    }
    const base = resolveApiBase(options.apiBase);
    if (!base) {
      reject(new Error("missing-api-base"));
      return;
    }
    const token = options.token || getAuthToken();
    wx.uploadFile({
      url: `${base}/api/files/upload`,
      filePath,
      name: "file",
      header: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : {},
      success: (res) => {
        try {
          const body = JSON.parse(res?.data || "{}");
          if (body && body.data) {
            if (typeof body.data === "string" && body.data.trim()) {
              resolve(body.data.trim());
              return;
            }
            if (body.data.fileName) {
              resolve(`${body.data.fileName}`.trim());
              return;
            }
            if (body.data.objectName) {
              resolve(`${body.data.objectName}`.trim());
              return;
            }
          }
        } catch (err) {
          console.warn("解析上传响应失败", err);
        }
        reject(new Error("upload-marker-file-failed"));
      },
      fail: (err) => reject(err)
    });
  });
}

module.exports = {
  listMarkers,
  createMarker,
  updateMarker,
  deleteMarker,
  uploadMarkerFile,
  buildFileDownloadUrl
};
