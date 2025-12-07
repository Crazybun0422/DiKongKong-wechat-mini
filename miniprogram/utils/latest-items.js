const { authorizedRequest, resolveApiBase, getAuthToken } = require("./profile");

function normalizeVersion(v) {
  if (v === undefined || v === null) return "";
  return `${v}`.trim();
}

function fetchLatestItemVersion(options = {}) {
  const apiBase = resolveApiBase(options.apiBase);
  const token = options.token || getAuthToken();
  const itemId = options.itemId || "";
  const version = normalizeVersion(options.version);
  if (!apiBase) return Promise.reject(new Error("missing-api-base"));
  if (!token) return Promise.reject(new Error("missing-token"));
  if (!itemId) return Promise.reject(new Error("missing-item-id"));
  if (!version) return Promise.reject(new Error("missing-version"));
  return authorizedRequest({
    apiBase,
    token,
    path: `/api/latest-items?itemId=${encodeURIComponent(itemId)}&version=${encodeURIComponent(version)}`,
    method: "GET"
  }).then((body = {}) => {
    const data = body?.data || {};
    return {
      itemId: data.itemId || itemId,
      version: normalizeVersion(data.version || version)
    };
  });
}

function updateLatestItemVersion(options = {}) {
  const apiBase = resolveApiBase(options.apiBase);
  const token = options.token || getAuthToken();
  const itemId = options.itemId || "";
  const version = normalizeVersion(options.version);
  if (!apiBase) return Promise.reject(new Error("missing-api-base"));
  if (!token) return Promise.reject(new Error("missing-token"));
  if (!itemId) return Promise.reject(new Error("missing-item-id"));
  if (!version) return Promise.reject(new Error("missing-version"));
  return authorizedRequest({
    apiBase,
    token,
    path: "/api/latest-items",
    method: "PUT",
    data: { itemId, version }
  }).then((body = {}) => {
    const data = body?.data || {};
    return {
      itemId: data.itemId || itemId,
      version: normalizeVersion(data.version || version)
    };
  });
}

module.exports = {
  fetchLatestItemVersion,
  updateLatestItemVersion,
  normalizeVersion
};
