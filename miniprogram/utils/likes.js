const { authorizedRequest, resolveApiBase, getAuthToken } = require("./profile");

function ensureBase(options = {}) {
  return resolveApiBase(options.apiBase);
}

function like(targetType, targetId, options = {}) {
  const base = ensureBase(options);
  if (!base) return Promise.reject(new Error("missing-api-base"));
  const token = options.token || getAuthToken();
  if (!token) return Promise.reject(new Error("missing-token"));
  return authorizedRequest({
    apiBase: base,
    token,
    path: "/api/likes",
    method: "POST",
    data: { targetType, targetId }
  }).then((body = {}) => body.data || {});
}

function unlike(targetType, targetId, options = {}) {
  const base = ensureBase(options);
  if (!base) return Promise.reject(new Error("missing-api-base"));
  const token = options.token || getAuthToken();
  if (!token) return Promise.reject(new Error("missing-token"));
  return authorizedRequest({
    apiBase: base,
    token,
    path: "/api/likes",
    method: "DELETE",
    data: { targetType, targetId }
  }).then((body = {}) => body.data || {});
}

function fetchLikeCount(targetType, targetId, options = {}) {
  const base = ensureBase(options);
  if (!base) return Promise.reject(new Error("missing-api-base"));
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${base}/api/likes/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`,
      method: "GET",
      header: { "content-type": "application/json" },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data?.data || {});
        } else {
          const reason = res.data?.message || res.errMsg || `status-${res.statusCode}`;
          reject(new Error(typeof reason === "string" ? reason : JSON.stringify(reason)));
        }
      },
      fail: (err) => reject(err)
    });
  });
}

function fetchLikeStatus(targetType, targetId, options = {}) {
  const base = ensureBase(options);
  if (!base) return Promise.reject(new Error("missing-api-base"));
  const token = options.token || getAuthToken();
  if (!token) return Promise.reject(new Error("missing-token"));
  return authorizedRequest({
    apiBase: base,
    token,
    path: `/api/likes/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}/me`,
    method: "GET"
  }).then((body = {}) => body.data || {});
}

module.exports = {
  like,
  unlike,
  fetchLikeCount,
  fetchLikeStatus
};
