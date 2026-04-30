const { authorizedRequest, getAuthToken, resolveApiBase } = require("./profile");

const MEMBER_CYCLES = {
  MONTHLY: "MONTHLY",
  YEARLY: "YEARLY"
};

const MEMBER_PAYMENT_MODES = {
  WECHAT: "WECHAT",
  FLP: "FLP"
};

function requestPublicJson(path, options = {}) {
  return new Promise((resolve, reject) => {
    const base = resolveApiBase(options.apiBase);
    if (!base) {
      reject(new Error("missing-api-base"));
      return;
    }
    wx.request({
      url: `${base}${path}`,
      method: options.method || "GET",
      data: options.data || null,
      header: Object.assign({ "content-type": "application/json" }, options.header || {}),
      success: (res = {}) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data?.data || {});
          return;
        }
        reject(new Error(res.data?.message || res.errMsg || `status-${res.statusCode || 0}`));
      },
      fail: (err) => reject(err)
    });
  });
}

function normalizeMemberRechargeConfig(raw = {}) {
  const fields = [
    "yearlyWechatNetPrice",
    "yearlyWechatListPrice",
    "yearlyFlpNetPrice",
    "yearlyFlpListPrice",
    "monthlyWechatNetPrice",
    "monthlyWechatListPrice",
    "monthlyFlpNetPrice",
    "monthlyFlpListPrice"
  ];
  const config = {};
  fields.forEach((key) => {
    const value = Number(raw[key]);
    config[key] = isFinite(value) ? value : 0;
  });
  config.updatedAt = raw.updatedAt || "";
  return config;
}

function fetchMemberRechargeConfig(options = {}) {
  return requestPublicJson("/api/config/member-recharge", options)
    .then((data = {}) => normalizeMemberRechargeConfig(data));
}

function updateMemberRechargeConfig(config = {}, options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token || getAuthToken(),
    path: "/api/config/member-recharge",
    method: "PUT",
    data: config
  }).then((body = {}) => normalizeMemberRechargeConfig(body?.data || {}));
}

function rechargeMember(payload = {}, options = {}) {
  const cycle = `${payload.cycle || ""}`.trim().toUpperCase();
  const paymentMode = `${payload.paymentMode || ""}`.trim().toUpperCase();
  if (!cycle) return Promise.reject(new Error("missing-member-cycle"));
  if (!paymentMode) return Promise.reject(new Error("missing-member-payment-mode"));
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token || getAuthToken(),
    path: "/api/user/member/recharge",
    method: "POST",
    data: { cycle, paymentMode }
  }).then((body = {}) => body?.data || {});
}

module.exports = {
  MEMBER_CYCLES,
  MEMBER_PAYMENT_MODES,
  normalizeMemberRechargeConfig,
  fetchMemberRechargeConfig,
  updateMemberRechargeConfig,
  rechargeMember
};
