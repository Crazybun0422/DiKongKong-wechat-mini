const { authorizedRequest, resolveApiBase } = require("./profile");

function fetchPinVideoUploadFlpLimit(options = {}) {
  return authorizedRequest({
    apiBase: resolveApiBase(options.apiBase),
    token: options.token,
    path: "/api/config/pin-video-upload-flp-limit",
    method: "GET"
  }).then((body = {}) => body?.data || {});
}

module.exports = {
  fetchPinVideoUploadFlpLimit
};
