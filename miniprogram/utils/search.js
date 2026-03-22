const { resolveMapKey } = require("./map-key");
const { wgs84ToGcj02 } = require("./coords");

function searchPlaces(keyword, location) {
  return new Promise((resolve, reject) => {
    if (!keyword || !keyword.trim()) {
      resolve([]);
      return;
    }
    resolveMapKey()
      .then((mapKey) => {
        if (!mapKey) {
          reject(new Error("Missing Tencent Map key."));
          return;
        }
        const params = {
          key: mapKey,
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
              const payload = res.data || {};
              if (payload.status !== 0) {
                reject(new Error(payload.message || `Tencent map status ${payload.status}`));
                return;
              }
              const list = payload.data || [];
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
      })
      .catch(reject);
  });
}

module.exports = {
  searchPlaces
};
