const { authorizedRequest } = require("./profile");

function payWithFlp(payload = {}, options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/flp/pay",
    method: "POST",
    data: payload
  }).then((body) => body?.data || {});
}

module.exports = {
  payWithFlp
};
