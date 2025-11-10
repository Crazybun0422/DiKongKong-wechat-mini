const { authorizedRequest, resolveApiBase, getAuthToken } = require("./profile");

function ensureApiBase(options = {}) {
  if (options.apiBase) return options.apiBase;
  return resolveApiBase();
}

function requestWeappQrcode(payload = {}, options = {}) {
  return authorizedRequest({
    apiBase: ensureApiBase(options),
    token: options.token || getAuthToken(),
    path: "/api/weapp/qrcode",
    method: "POST",
    data: payload
  }).then((body = {}) => body.data || {});
}

module.exports = {
  requestWeappQrcode
};
