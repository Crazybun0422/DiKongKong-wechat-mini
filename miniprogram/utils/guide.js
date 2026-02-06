const { resolveApiBase } = require("./profile");
const { resolveAssetUrl } = require("./open-platform");

const GUIDE_URLS_PATH = "/api/config/guide-urls";

function normalizeGuideUrls(payload = {}, options = {}) {
  const apiBase = resolveApiBase(options.apiBase);
  const rawUrls = Array.isArray(payload.urls) ? payload.urls : [];
  const urls = rawUrls
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .map((url) => resolveAssetUrl(url, { apiBase }))
    .filter(Boolean);
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  return { title, urls };
}

function fetchGuideUrls(options = {}) {
  const base = resolveApiBase(options.apiBase);
  if (!base) {
    return Promise.reject(new Error("missing-api-base"));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${base}${GUIDE_URLS_PATH}`,
      method: "GET",
      header: { "content-type": "application/json" },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(normalizeGuideUrls(res.data?.data || {}, { apiBase: base }));
        } else {
          const reason = res.data?.message || res.errMsg || `status-${res.statusCode}`;
          reject(new Error(typeof reason === "string" ? reason : JSON.stringify(reason)));
        }
      },
      fail: (err) => reject(err)
    });
  });
}

module.exports = {
  fetchGuideUrls,
  normalizeGuideUrls
};
