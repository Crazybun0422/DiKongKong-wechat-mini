const { authorizedRequest, resolveApiBase, getAuthToken } = require("./profile");

const COORDINATE_SYSTEM_DESCRIPTION_PATH = "/api/config/coordinate-system-description";
const COORDINATE_LONG_PRESS_GUIDE_PATH = "/api/config/coordinate-long-press-guide";

function appendNoCacheQuery(path = "") {
  const separator = path.includes("?") ? "&" : "?";
  const nonce = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
  return `${path}${separator}_rt=${nonce}`;
}

function fetchRichTextConfig(path, options = {}) {
  const apiBase = resolveApiBase(options.apiBase);
  const token = options.token || getAuthToken();
  const noCache = options.noCache !== false;
  const requestPath = noCache ? appendNoCacheQuery(path) : path;
  const noCacheHeaders = noCache
    ? {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0"
    }
    : {};
  return authorizedRequest({
    apiBase,
    token,
    path: requestPath,
    method: "GET",
    header: Object.assign({}, options.header || {}, noCacheHeaders)
  }).then((body = {}) => body.data || {});
}

function fetchCoordinateSystemDescription(options = {}) {
  return fetchRichTextConfig(COORDINATE_SYSTEM_DESCRIPTION_PATH, options);
}

function fetchCoordinateLongPressGuide(options = {}) {
  return fetchRichTextConfig(COORDINATE_LONG_PRESS_GUIDE_PATH, options);
}

module.exports = {
  fetchCoordinateSystemDescription,
  fetchCoordinateLongPressGuide
};
