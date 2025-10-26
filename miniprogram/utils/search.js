const { QQMAP_KEY } = require("./config");
const { wgs84ToGcj02 } = require("./coords");

function searchPlaces(keyword, location) {
  return new Promise((resolve, reject) => {
    if (!keyword || !keyword.trim()) {
      resolve([]);
      return;
    }
    if (!QQMAP_KEY) {
      reject(
        new Error("Missing Tencent Map key. Set QQMAP_KEY in utils/config.js.")
      );
      return;
    }
    const params = {
      key: QQMAP_KEY,
      keyword: keyword.trim(),
      region: "nationwide",
      page_size: 20,
      policy: 1
    };
    if (location && isFinite(location.latitude) && isFinite(location.longitude)) {
      const gcj = wgs84ToGcj02(location.longitude, location.latitude);
      params.location = `${gcj.lat},${gcj.lng}`;
    }
    wx.request({
      url: "https://apis.map.qq.com/ws/place/v1/suggestion",
      data: params,
      method: "GET",
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const list = res.data?.data || [];
          resolve(list);
        } else {
          reject(
            new Error(
              `Search failed: ${res.statusCode} ${res.errMsg || ""}`
            )
          );
        }
      },
      fail(err) {
        reject(err);
      }
    });
  });
}

module.exports = {
  searchPlaces
};
