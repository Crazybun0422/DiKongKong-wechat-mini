const { reverseGeocode } = require("../../../../utils/geocoder");
const { buildCityReportWebviewPath, getCityReportConfig } = require("../../../../utils/city-report");

const CITY_MATCHERS = [
  {
    key: "shanghai",
    adcodePrefix: "310",
    cityNames: ["上海"],
    provinceNames: ["上海"]
  },
  {
    key: "nanchang",
    adcodePrefix: "3601",
    cityNames: ["南昌"],
    provinceNames: ["江西"]
  }
];

const RESOLVE_DEBOUNCE_MS = 450;
const MIN_MOVED_METERS = 300;

const normalizeName = (value) =>
  typeof value === "string" ? value.replace(/\s+/g, "").replace(/市$/, "") : "";

const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const toRad = (v) => (Number(v) * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const resolveCityKey = (adInfo = {}) => {
  const adcode = `${adInfo.adcode || ""}`;
  const city = normalizeName(adInfo.city);
  const province = normalizeName(adInfo.province);
  for (const matcher of CITY_MATCHERS) {
    if (matcher.adcodePrefix && adcode.startsWith(matcher.adcodePrefix)) {
      return matcher.key;
    }
    if (city && matcher.cityNames?.includes(city)) return matcher.key;
    if (province && matcher.provinceNames?.includes(province)) return matcher.key;
  }
  return "";
};

Component({
  properties: {
    center: {
      type: Object,
      value: null
    },
    active: {
      type: Boolean,
      value: true
    }
  },
  data: {
    visible: false,
    cityKey: "",
    jumpLabel: "",
    appId: "",
    appPath: ""
  },
  observers: {
    "center.latitude, center.longitude, active": function (lat, lng, active) {
      if (!active) return;
      const next = {
        latitude: Number(lat),
        longitude: Number(lng)
      };
      if (!Number.isFinite(next.latitude) || !Number.isFinite(next.longitude)) return;
      this.scheduleResolve(next);
    }
  },
  lifetimes: {
    detached() {
      if (this._resolveTimer) {
        clearTimeout(this._resolveTimer);
        this._resolveTimer = null;
      }
    }
  },
  methods: {
    scheduleResolve(center) {
      if (!center) return;
      if (this._lastCenter) {
        const dist = haversineMeters(
          this._lastCenter.latitude,
          this._lastCenter.longitude,
          center.latitude,
          center.longitude
        );
        if (Number.isFinite(dist) && dist < MIN_MOVED_METERS) return;
      }
      this._pendingCenter = center;
      if (this._resolveTimer) clearTimeout(this._resolveTimer);
      this._resolveTimer = setTimeout(() => {
        this._resolveTimer = null;
        this.resolveCityFromCenter(this._pendingCenter);
      }, RESOLVE_DEBOUNCE_MS);
    },

    resolveCityFromCenter(center) {
      if (!center) return;
      const token = (this._resolveToken || 0) + 1;
      this._resolveToken = token;
      reverseGeocode(center.latitude, center.longitude)
        .then((res = {}) => {
          if (this._resolveToken !== token) return;
          this._lastCenter = center;
          const key = resolveCityKey(res.ad_info || {});
          this.applyCityKey(key);
        })
        .catch(() => {
          if (this._resolveToken !== token) return;
          if (!this.data.cityKey) {
            this.setData({ visible: false, cityKey: "" });
          }
        });
    },

    applyCityKey(key) {
      console.log("applyCityKey", key);
      const config = getCityReportConfig(key);
      if (!config) {
        this.setData({ visible: false, cityKey: "" });
        return;
      }
      this._activeConfig = config;
      this.setData({
        visible: true,
        cityKey: key,
        jumpLabel: config.label || "",
        appId: config.appId || "",
        appPath: config.path || ""
      });
    },

    onJumpTap() {
      const config = this._activeConfig || getCityReportConfig(this.data.cityKey);
      if (!config || !config.appId) {
        wx.showToast({ title: "跳转配置缺失", icon: "none" });
        return;
      }
      wx.navigateToMiniProgram({
        appId: config.appId,
        path: config.path || "",
        envVersion: "release"
      });
    },

    onTipTap() {
      const key = this.data.cityKey;
      if (!key) {
        wx.showToast({ title: "链接不可用", icon: "none" });
        return;
      }
      console.log("onTipTap", key);
      const target = buildCityReportWebviewPath({ city: key });
      console.log("onTipTap target", target);
      if (!target) {
        wx.showToast({ title: "链接不可用", icon: "none" });
        return;
      }
      wx.navigateTo({ url: target });
    }
  }
});