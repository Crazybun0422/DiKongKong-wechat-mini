const { authorizedRequest, resolveApiBase, getAuthToken } = require("./profile");

function appendQueryParams(path, query = {}) {
  if (!query || typeof query !== "object") {
    return path;
  }
  const parts = Object.keys(query)
    .map((key) => {
      const value = query[key];
      if (value === undefined || value === null) {
        return "";
      }
      let normalizedValue;
      if (typeof value === "boolean") {
        normalizedValue = value ? "true" : "false";
      } else if (typeof value === "number") {
        if (!Number.isFinite(value)) {
          return "";
        }
        normalizedValue = value.toString();
      } else {
        normalizedValue = `${value}`.trim();
        if (!normalizedValue) {
          return "";
        }
      }
      return `${encodeURIComponent(key)}=${encodeURIComponent(normalizedValue)}`;
    })
    .filter(Boolean);
  if (!parts.length) {
    return path;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${parts.join("&")}`;
}

function listMyPins(params = {}, options = {}) {
  const query = {};
  if (params.page !== undefined && params.page !== null) {
    const page = Number(params.page);
    if (Number.isFinite(page) && page >= 0) {
      query.page = page;
    }
  }
  if (params.size !== undefined && params.size !== null) {
    const size = Number(params.size);
    if (Number.isFinite(size) && size > 0) {
      query.size = size;
    }
  }
  if (params.visibility) {
    query.visibility = params.visibility;
  }
  const path = appendQueryParams("/api/pins/mine", query);
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path,
    method: "GET"
  }).then((body = {}) => body.data || {});
}

function createPin(payload = {}, options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/pins",
    method: "POST",
    data: payload
  }).then((body = {}) => body.data || {});
}

function updatePin(pinId, payload = {}, options = {}) {
  const id = `${pinId || ""}`.trim();
  if (!id) {
    return Promise.reject(new Error("缺少标记ID"));
  }
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/pins/${encodeURIComponent(id)}`,
    method: "PUT",
    data: payload
  }).then((body = {}) => body.data || {});
}

function deletePin(pinId, options = {}) {
  const id = `${pinId || ""}`.trim();
  if (!id) {
    return Promise.reject(new Error("缺少标记ID"));
  }
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/pins/${encodeURIComponent(id)}`,
    method: "DELETE"
  }).then((body = {}) => body.data || {});
}

function updatePinGroups(pinId, payload = {}, options = {}) {
  const id = `${pinId || ""}`.trim();
  if (!id) {
    return Promise.reject(new Error("缺少标记ID"));
  }
  const groupIds = Array.isArray(payload.groupIds) ? payload.groupIds.filter(Boolean) : [];
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/pins/${encodeURIComponent(id)}/groups`,
    method: "PUT",
    data: { groupIds }
  }).then((body = {}) => body.data || {});
}

function performPinAction(pinId, actionPath, options = {}) {
  const id = `${pinId || ""}`.trim();
  if (!id) {
    return Promise.reject(new Error("missing-pin-id"));
  }
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/pins/${encodeURIComponent(id)}${actionPath}`,
    method: "POST"
  }).then((body = {}) => body.data || {});
}

function publishPin(pinId, options = {}) {
  return performPinAction(pinId, "/publish", options);
}

function revokePin(pinId, options = {}) {
  return performPinAction(pinId, "/revoke", options);
}

function fetchPinDetail(pinId, options = {}) {
  const id = `${pinId || ""}`.trim();
  if (!id) {
    return Promise.reject(new Error("missing-pin-id"));
  }
  return requestPinResource({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/pins/${encodeURIComponent(id)}`,
    method: "GET"
  }).then((body = {}) => body.data || {});
}

function requestPinResource(options = {}) {
  return new Promise((resolve, reject) => {
    const base = resolveApiBase(options.apiBase);
    if (!base) {
      reject(new Error("missing-api-base"));
      return;
    }
    const header = Object.assign({ "content-type": "application/json" }, options.header || {});
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

function fetchNearbyPins(params = {}, options = {}) {
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
  return requestPinResource({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/pins/nearby${qs}`,
    method: "GET"
  }).then((body = {}) => body.data || []);
}

function searchPins(keyword, options = {}) {
  const text = typeof keyword === "string" ? keyword.trim() : "";
  if (!text) {
    return Promise.resolve([]);
  }
  const query = [`keyword=${encodeURIComponent(text)}`];
  const limit = Number(options.limit);
  if (Number.isFinite(limit) && limit > 0) {
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 50));
    query.push(`limit=${safeLimit}`);
  }
  const qs = query.length ? `?${query.join("&")}` : "";
  return requestPinResource({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/pins/search${qs}`,
    method: "GET"
  }).then((body = {}) => body.data || []);
}

function incrementPinExposure(pinId, options = {}) {
  const id = `${pinId || ""}`.trim();
  if (!id) {
    return Promise.reject(new Error("missing-pin-id"));
  }
  return requestPinResource({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/pins/${encodeURIComponent(id)}/exposure`,
    method: "POST"
  }).then((body = {}) => body.data || {});
}

function resolveUploadFileName(path = "") {
  const raw = `${path || ""}`;
  if (!raw) return "";
  const parts = raw.split(/[\\/]/);
  return parts[parts.length - 1] || raw;
}

function normalizeImportFiles(input) {
  const rawList = Array.isArray(input) ? input : [input];
  return rawList
    .map((item) => {
      if (!item) return null;
      if (typeof item === "string") {
        const path = item.trim();
        if (!path) return null;
        return { path, name: resolveUploadFileName(path) || path };
      }
      if (typeof item === "object") {
        const path = `${item.path || item.filePath || item.tempFilePath || ""}`.trim();
        if (!path) return null;
        const name = `${item.name || item.fileName || resolveUploadFileName(path) || path}`.trim();
        return { path, name: name || path };
      }
      return null;
    })
    .filter(Boolean);
}

function mergeImportResults(results = []) {
  const merged = { importedCount: 0, pins: [] };
  results.forEach((item) => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item.pins)) {
      merged.pins.push(...item.pins);
    }
    const count = Number(item.importedCount ?? item.count ?? (Array.isArray(item.pins) ? item.pins.length : 0));
    if (Number.isFinite(count)) {
      merged.importedCount += count;
    }
  });
  if (!merged.pins.length) {
    delete merged.pins;
  }
  return merged;
}

function importPinKmlKmz(fileInput, options = {}) {
  return new Promise((resolve, reject) => {
    const files = normalizeImportFiles(fileInput);
    if (!files.length) {
      reject(new Error("missing-file-path"));
      return;
    }
    const base = resolveApiBase(options.apiBase);
    if (!base) {
      reject(new Error("missing-api-base"));
      return;
    }
    const token = options.token || getAuthToken();
    const formData = {};
    if (options.visibility) {
      formData.visibility = options.visibility;
    }
    const url = `${base}/api/pins/import/kml-kmz`;
    console.info("importPinKmlKmz upload start", { url, count: files.length });
    const header = token ? { Authorization: `Bearer ${token}` } : {};

    const handleSuccess = (res, resolveUpload, rejectUpload) => {
      let body = {};
      try {
        body = JSON.parse(res?.data || "{}");
      } catch (err) {
        body = {};
      }
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolveUpload(body?.data || {});
        return;
      }
      if (res.statusCode === 401 || res.statusCode === 403) {
        rejectUpload(new Error("missing-token"));
        return;
      }
      const reason = body?.message || res.errMsg || `status-${res.statusCode}`;
      rejectUpload(new Error(typeof reason === "string" ? reason : JSON.stringify(reason)));
    };

    const uploadBatch = (batchFiles = []) =>
      new Promise((resolveUpload, rejectUpload) => {
        const uploadOptions = {
          url,
          method: "POST",
          formData,
          header,
          success: (res) => handleSuccess(res, resolveUpload, rejectUpload),
          fail: (err) => rejectUpload(err)
        };
        if (batchFiles.length <= 1) {
          uploadOptions.filePath = batchFiles[0].path;
          uploadOptions.name = "files";
        } else {
          uploadOptions.files = batchFiles.map((file) => ({
            name: "files",
            filePath: file.path,
            fileName: file.name || resolveUploadFileName(file.path)
          }));
        }
        wx.uploadFile(uploadOptions);
      });

    const uploadSequential = () => {
      const results = [];
      return files
        .reduce(
          (prev, file) =>
            prev.then(() =>
              uploadBatch([file]).then((data) => {
                results.push(data);
              })
            ),
          Promise.resolve()
        )
        .then(() => mergeImportResults(results));
    };

    const shouldFallbackToSequential = (err) => {
      if (!err) return false;
      const message = `${err?.errMsg || err?.message || ""}`.toLowerCase();
      return message.includes("filepath") || message.includes("file path") || message.includes("parameter");
    };

    const attempt = () => {
      if (files.length <= 1) {
        return uploadBatch(files);
      }
      return uploadBatch(files).catch((err) => {
        if (shouldFallbackToSequential(err)) {
          return uploadSequential();
        }
        throw err;
      });
    };

    attempt().then(resolve).catch(reject);
  });
}

function exportPinKmlKmz(pinId, options = {}) {
  const id = `${pinId || ""}`.trim();
  if (!id) {
    return Promise.reject(new Error("missing-pin-id"));
  }
  return new Promise((resolve, reject) => {
    const base = resolveApiBase(options.apiBase);
    if (!base) {
      reject(new Error("missing-api-base"));
      return;
    }
    const token = options.token || getAuthToken();
    const header = Object.assign({}, options.header || {});
    if (token) {
      header.Authorization = `Bearer ${token}`;
    }
    const url = `${base}/api/pins/${encodeURIComponent(id)}/export/kml-kmz`;
    wx.downloadFile({
      url,
      header,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve({
            tempFilePath: res.tempFilePath,
            header: res.header || {}
          });
          return;
        }
        if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error("missing-token"));
          return;
        }
        const reason = res.errMsg || `status-${res.statusCode}`;
        reject(new Error(reason));
      },
      fail: (err) => reject(err)
    });
  });
}

module.exports = {
  listMyPins,
  createPin,
  updatePin,
  deletePin,
  updatePinGroups,
  publishPin,
  revokePin,
  searchPins,
  fetchNearbyPins,
  incrementPinExposure,
  fetchPinDetail,
  importPinKmlKmz,
  exportPinKmlKmz
};
