const DRONES_API_URL = "https://flysafe-api.dji.com/dji/drones";

function normalizeDroneList(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      const slug = typeof item?.slug === "string" ? item.slug.trim() : "";
      if (!name || !slug) return null;
      return { name, slug };
    })
    .filter(Boolean);
}

function fetchDrones() {
  return new Promise((resolve) => {
    if (typeof wx === "undefined" || typeof wx.request !== "function") {
      resolve([]);
      return;
    }
    wx.request({
      url: DRONES_API_URL,
      method: "GET",
      success: (res) => {
        const payload = res?.data || {};
        const list = normalizeDroneList(payload?.drones || []);
        resolve(list);
      },
      fail: () => resolve([])
    });
  });
}

module.exports = {
  fetchDrones
};
