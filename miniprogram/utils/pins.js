const { authorizedRequest } = require("./profile");

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

module.exports = {
  listMyPins,
  createPin,
  updatePinGroups
};
