const { authorizedRequest } = require("./profile");

function createWechatPrepayOrder(payload = {}, options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/payments/wechat/prepay",
    method: "POST",
    data: payload
  }).then((body = {}) => body.data || {});
}

function fetchWechatPaymentStatus(orderId, options = {}) {
  if (!orderId) {
    return Promise.reject(new Error("missing-order-id"));
  }
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/payments/wechat/status/${encodeURIComponent(orderId)}`,
    method: "GET"
  }).then((body = {}) => body.data || {});
}

module.exports = {
  createWechatPrepayOrder,
  fetchWechatPaymentStatus
};

