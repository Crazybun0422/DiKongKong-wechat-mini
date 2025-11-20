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

function fetchFlpLogs(params = {}, options = {}) {
  const query = [];
  if (params.page !== undefined && params.page !== null) {
    const page = Number(params.page);
    if (Number.isFinite(page) && page >= 0) {
      query.push(`page=${Math.floor(page)}`);
    }
  }
  if (params.size !== undefined && params.size !== null) {
    const size = Number(params.size);
    if (Number.isFinite(size) && size > 0) {
      query.push(`size=${Math.floor(size)}`);
    }
  }
  const featureCode =
    typeof params.featureCode === "string" ? params.featureCode.trim() : "";
  if (featureCode) {
    query.push(`featureCode=${encodeURIComponent(featureCode)}`);
  }
  const qs = query.length ? `?${query.join("&")}` : "";
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/flp/logs${qs}`,
    method: "GET"
  }).then((body = {}) => body.data || {});
}

module.exports = {
  payWithFlp,
  fetchFlpLogs
};
