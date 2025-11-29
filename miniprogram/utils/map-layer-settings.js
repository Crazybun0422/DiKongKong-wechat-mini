const { authorizedRequest, resolveApiBase, getAuthToken } = require("./profile");

function ensureApiBase(options = {}) {
  if (options.apiBase) return options.apiBase;
  return resolveApiBase();
}

function fetchMapLayerSettings(options = {}) {
  const apiBase = ensureApiBase(options);
  const token = options.token || getAuthToken();
  return authorizedRequest({
    apiBase,
    token,
    path: "/api/map-layer-settings",
    method: "GET"
  }).then((res = {}) => res.data || {});
}

function updateMapLayerSettings(payload = {}, options = {}) {
  const apiBase = ensureApiBase(options);
  const token = options.token || getAuthToken();
  return authorizedRequest({
    apiBase,
    token,
    path: "/api/map-layer-settings",
    method: "PUT",
    data: payload
  }).then((res = {}) => res.data || {});
}

module.exports = {
  fetchMapLayerSettings,
  updateMapLayerSettings
};
