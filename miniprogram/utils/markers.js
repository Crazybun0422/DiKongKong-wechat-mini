const {
  authorizedRequest,
  resolveApiBase,
  getAuthToken
} = require("./profile");

function extractUploadedFileName(value) {
  if (!value) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractUploadedFileName(item);
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
    if (candidate) return extractUploadedFileName(candidate);
  }
  return "";
}

function buildFileDownloadUrl(fileName, options = {}) {
  if (!fileName) return "";
  if (typeof fileName === "string") {
    const trimmed = fileName.trim();
    if (!trimmed) return "";
    if (/^https?:\/\//.test(trimmed) || trimmed.startsWith("wxfile://")) {
      return trimmed;
    }
    const normalizedAssetsPath = trimmed.replace(/^\.\//, "");
    if (/^\/?assets\//.test(normalizedAssetsPath)) {
      return normalizedAssetsPath.startsWith("/")
        ? normalizedAssetsPath
        : `/${normalizedAssetsPath}`;
    }
    const base = resolveApiBase(options.apiBase);
    if (!base) return trimmed;
    return `${base}/api/files/download/${encodeURIComponent(trimmed)}`;
  }
  return "";
}

function requestMarkerResource(options = {}) {
  return new Promise((resolve, reject) => {
    const base = resolveApiBase(options.apiBase);
    if (!base) {
      reject(new Error("missing-api-base"));
      return;
    }
    const header = Object.assign(
      {
        "content-type": "application/json"
      },
      options.header || {}
    );
    const token = options.token || getAuthToken();
    if (token) {
      header.Authorization = `Bearer ${token}`;
    }
    wx.request({
      url: `${base}${options.path}`,
      method: options.method || "GET",
      data: options.data || null,
      header,
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

function postMarkerMetric(markerId, metricPath, options = {}) {
  if (markerId === undefined || markerId === null) {
    return Promise.reject(new Error("missing-marker-id"));
  }
  const id = `${markerId}`.trim();
  if (!id) {
    return Promise.reject(new Error("missing-marker-id"));
  }
  if (!metricPath) {
    return Promise.reject(new Error("missing-metric-path"));
  }
  const base = resolveApiBase(options.apiBase);
  if (!base) {
    return Promise.reject(new Error("missing-api-base"));
  }
  const header = { "content-type": "application/json" };
  const token = options.token || getAuthToken();
  if (token) {
    header.Authorization = `Bearer ${token}`;
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${base}/api/markers/${encodeURIComponent(id)}/${metricPath}`,
      method: "POST",
      header,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data?.data || {});
        } else {
          const reason = res.data?.message || res.errMsg || `status-${res.statusCode}`;
          reject(new Error(typeof reason === "string" ? reason : JSON.stringify(reason)));
        }
      },
      fail: (err) => reject(err)
    });
  });
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

function fetchNearbyMarkers(params = {}, options = {}) {
  const query = [];
  const latitude = Number(params.latitude);
  const longitude = Number(params.longitude);
  const radius = Number(params.radiusInKilometers);
  if (Number.isFinite(latitude)) {
    query.push(`latitude=${encodeURIComponent(latitude.toFixed(6))}`);
  }
  if (Number.isFinite(longitude)) {
    query.push(`longitude=${encodeURIComponent(longitude.toFixed(6))}`);
  }
  if (Number.isFinite(radius) && radius >= 0) {
    query.push(`radiusInKilometers=${encodeURIComponent(radius.toFixed(3))}`);
  }
  const qs = query.length ? `?${query.join("&")}` : "";
  return requestMarkerResource({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/markers/nearby${qs}`,
    method: "GET"
  }).then((body = {}) => body.data || []);
}

function fetchMarkerDetail(markerId, options = {}) {
  if (markerId === undefined || markerId === null) {
    return Promise.reject(new Error("missing-marker-id"));
  }
  const id = `${markerId}`;
  if (!id) {
    return Promise.reject(new Error("missing-marker-id"));
  }
  return requestMarkerResource({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/markers/${encodeURIComponent(id)}`,
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
            const extracted = extractUploadedFileName(body.data);
            if (extracted) {
              resolve(extracted);
              return;
            }
            if (typeof body.data === "string" && body.data.trim()) {
              const fallback = extractUploadedFileName(body.data.trim());
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
        reject(new Error("upload-marker-file-failed"));
      },
      fail: (err) => reject(err)
    });
  });
}

function fetchMapSettlementConfig(options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/config/map-settlement",
    method: "GET"
  }).then((body = {}) => body.data || {});
}

function fetchOpenPlatformContent(options = {}) {
  return new Promise((resolve, reject) => {
    const base = resolveApiBase(options.apiBase);
    if (!base) {
      reject(new Error("missing-api-base"));
      return;
    }
    const header = { "content-type": "application/json" };
    const token = options.token || getAuthToken();
    if (token) {
      header.Authorization = `Bearer ${token}`;
    }
    wx.request({
      url: `${base}/api/config/open-platform-copy`,
      method: "GET",
      header,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data?.data || {});
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error("missing-token"));
        } else {
          const reason = res.data?.message || res.errMsg || `status-${res.statusCode}`;
          reject(new Error(typeof reason === "string" ? reason : JSON.stringify(reason)));
        }
      },
      fail: (err) => reject(err)
    });
  });
}

function incrementMarkerExposure(markerId, options = {}) {
  return postMarkerMetric(markerId, "exposure", options);
}

function incrementMarkerPhoneCall(markerId, options = {}) {
  return postMarkerMetric(markerId, "phone-call", options);
}

module.exports = {
  listMarkers,
  fetchNearbyMarkers,
  fetchMarkerDetail,
  createMarker,
  updateMarker,
  deleteMarker,
  uploadMarkerFile,
  buildFileDownloadUrl,
  fetchMapSettlementConfig,
  fetchOpenPlatformContent,
  incrementMarkerExposure,
  incrementMarkerPhoneCall
};
