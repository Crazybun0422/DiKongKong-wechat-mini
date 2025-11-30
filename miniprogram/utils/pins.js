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
  incrementPinExposure
};
