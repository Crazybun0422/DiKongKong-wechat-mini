const { QQMAP_KEY } = require("./config");

function reverseGeocode(lat, lng) {
  return new Promise((resolve, reject) => {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      reject(new Error("Invalid coordinates for reverse geocoding."));
      return;
    }
    if (!QQMAP_KEY) {
      reject(new Error("Missing Tencent Map key. Set QQMAP_KEY in utils/config.js."));
      return;
    }

    wx.request({
      url: "https://apis.map.qq.com/ws/geocoder/v1/",
      method: "GET",
      data: {
        key: QQMAP_KEY,
        location: `${latitude},${longitude}`,
        get_poi: 0
      },
      success(res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Reverse geocoding HTTP ${res.statusCode}`));
          return;
        }
        const payload = res.data || {};
        if (payload.status !== 0) {
          reject(new Error(payload.message || "Reverse geocoding failed."));
          return;
        }
        resolve(payload.result || {});
      },
      fail(err) {
        reject(err);
      }
    });
  });
}

module.exports = {
  reverseGeocode
};
