const { resolveApiBase } = require("./profile");
const { resolveAssetUrl } = require("./open-platform");

const GUIDE_URLS_PATH = "/api/config/guide-urls";

function resolveGuideAssetBase(explicitBase) {
  if (explicitBase) return explicitBase;
  try {
    const app = typeof getApp === "function" ? getApp() : null;
    const base = app?.globalData?.guideAssetBase;
    if (typeof base === "string" && base.trim()) {
      return base.trim();
    }
  } catch (err) {
    console.warn("resolveGuideAssetBase failed", err);
  }
  return resolveApiBase();
}

function normalizeGuideUrls(payload = {}, options = {}) {
  const apiBase = resolveApiBase(options.apiBase);
  const guideAssetBase = resolveGuideAssetBase(options.guideAssetBase);
  const rawUrls = Array.isArray(payload.urls) ? payload.urls : [];
  const legacyTitle = typeof payload.title === "string" ? payload.title.trim() : "";
  const items = rawUrls
    .map((item) => {
      if (typeof item === "string") {
        return { url: item.trim(), title: "" };
      }
      if (item && typeof item === "object") {
        const url = typeof item.url === "string" ? item.url.trim() : "";
        const title = typeof item.title === "string" ? item.title.trim() : "";
        return { url, title };
      }
      return { url: "", title: "" };
    })
    .filter((item) => item.url)
    .map((item) => ({
      ...item,
      title: item.title || legacyTitle,
      url: resolveAssetUrl(item.url, { apiBase: guideAssetBase || apiBase })
    }))
    .filter((item) => item.url);
  return { title: legacyTitle, items };
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
          resolve(
            normalizeGuideUrls(res.data?.data || {}, {
              apiBase: base,
              guideAssetBase: resolveGuideAssetBase(options.guideAssetBase)
            })
          );
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
  normalizeGuideUrls,
  resolveGuideAssetBase
};
