const { reverseGeocode } = require("../../../utils/geocoder");
const { gcj02ToWgs84, wgs84ToGcj02 } = require("../../../utils/coords");

const DEFAULT_CENTER = {
  latitude: 39.9042,
  longitude: 116.4074,
  scale: 16
};

function normalizeCoord(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Number(num.toFixed(6));
}

Page({
  data: {
    latitude: DEFAULT_CENTER.latitude,
    longitude: DEFAULT_CENTER.longitude,
    scale: DEFAULT_CENTER.scale,
    showUserLocation: true,
    addressMain: "",
    addressDetail: "",
    addressError: "",
    addressLoading: true,
    hasLocation: false,
    selectedLatitude: null,
    selectedLongitude: null,
    canConfirm: false
  },

  onLoad() {
    this.mapCtx = null;
    this._ready = false;
    this._eventChannel = null;
    this._initialPayload = null;
    this._reverseTimer = null;
    this._reverseToken = 0;
    this._currentGcj = null;
    this._reverseDebounceDelay = 450;
    this._reverseMinInterval = 1200;
    this._lastReverseExecutedAt = 0;
    this._lastReverseLocationKey = "";
    this._pendingReverseLocationKey = "";

    if (typeof this.getOpenerEventChannel === "function") {
      const channel = this.getOpenerEventChannel();
      this._eventChannel = channel;
      if (channel && typeof channel.on === "function") {
        channel.on("initLocation", (payload) => {
          this._initialPayload = payload || null;
          if (this._ready) {
            this.applyInitialPayload(payload);
          }
        });
      }
    }
  },

  onReady() {
    this.mapCtx = wx.createMapContext("picker-map", this);
    this._ready = true;
    if (!this.applyInitialPayload(this._initialPayload)) {
      this.requestCurrentLocation();
    }
  },

  onUnload() {
    if (this._reverseTimer) {
      clearTimeout(this._reverseTimer);
      this._reverseTimer = null;
    }
    if (this._eventChannel && typeof this._eventChannel.off === "function") {
      this._eventChannel.off("initLocation");
    }
    this._eventChannel = null;
  },

  applyInitialPayload(payload) {
    if (!payload) return false;
    const rawLat = Number(payload.latitude);
    const rawLng = Number(payload.longitude);
    const address = payload.address || "";
    if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) {
      if (address) {
        const nextData = {
          addressMain: address,
          addressDetail: address,
          addressError: "",
          addressLoading: false
        };
        nextData.canConfirm = this.computeCanConfirm(nextData);
        this.setData(nextData);
      }
      return false;
    }
    const gcj = wgs84ToGcj02(rawLng, rawLat);
    this.handleCenterChange(gcj.lat, gcj.lng, {
      updateMapCenter: true,
      skipReverse: !!address,
      presetAddress: address,
      immediateReverse: !address
    });
    return true;
  },

  requestCurrentLocation() {
    if (typeof wx.getLocation !== "function") {
      this.handleCenterChange(DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude, {
        updateMapCenter: true,
        immediateReverse: true
      });
      return;
    }
    wx.getLocation({
      type: "gcj02",
      success: (res) => {
        this.handleCenterChange(res.latitude, res.longitude, {
          updateMapCenter: true,
          immediateReverse: true
        });
      },
      fail: () => {
        wx.showToast({ title: "定位失败，请手动选择", icon: "none" });
        this.handleCenterChange(DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude, {
          updateMapCenter: true,
          immediateReverse: true
        });
      }
    });
  },

  handleCenterChange(gcjLat, gcjLng, options = {}) {
    const {
      updateMapCenter = false,
      skipReverse = false,
      immediateReverse = false,
      presetAddress = ""
    } = options;
    const latitude = normalizeCoord(gcjLat);
    const longitude = normalizeCoord(gcjLng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }
    const wgs = gcj02ToWgs84(longitude, latitude);
    const selectedLatitude = normalizeCoord(wgs.lat);
    const selectedLongitude = normalizeCoord(wgs.lng);
    this._currentGcj = { latitude, longitude };
    const locationKey = `${latitude},${longitude}`;
    const isSameLocation = locationKey === this._lastReverseLocationKey;

    const nextData = {
      selectedLatitude,
      selectedLongitude,
      hasLocation: true
    };
    if (updateMapCenter) {
      nextData.latitude = latitude;
      nextData.longitude = longitude;
    }

    const shouldReverse = !skipReverse && !isSameLocation;

    if (presetAddress) {
      nextData.addressMain = presetAddress;
      nextData.addressDetail = presetAddress;
      nextData.addressError = "";
      nextData.addressLoading = false;
      this._lastReverseLocationKey = locationKey;
    } else if (shouldReverse) {
      nextData.addressMain = "";
      nextData.addressDetail = "";
      nextData.addressError = "";
      nextData.addressLoading = true;
    }
    nextData.canConfirm = this.computeCanConfirm(nextData);
    this.setData(nextData);

    if (shouldReverse) {
      this.scheduleReverseGeocode(latitude, longitude, {
        immediate: immediateReverse,
        locationKey
      });
    }
  },

  onRegionChange(e) {
    if (e?.type !== "end") return;
    if (e?.causedBy && e.causedBy !== "drag" && e.causedBy !== "scale") return;
    this.fetchCenterLocation();
  },

  fetchCenterLocation() {
    if (!this.mapCtx || typeof this.mapCtx.getCenterLocation !== "function") return;
    this.mapCtx.getCenterLocation({
      type: "gcj02",
      success: (res) => {
        this.handleCenterChange(res.latitude, res.longitude);
      }
    });
  },

  scheduleReverseGeocode(lat, lng, options = {}) {
    const { immediate = false, locationKey = "" } = options;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (this._reverseTimer) {
      clearTimeout(this._reverseTimer);
      this._reverseTimer = null;
    }
    const token = Date.now();
    this._reverseToken = token;
    const key = locationKey || `${normalizeCoord(lat)},${normalizeCoord(lng)}`;
    this._pendingReverseLocationKey = key;
    const execute = () => {
      this._reverseTimer = null;
      this._lastReverseExecutedAt = Date.now();
      this._lastReverseLocationKey = this._pendingReverseLocationKey || key;
      reverseGeocode(lat, lng)
        .then((result) => {
          if (this._reverseToken !== token) return;
          const formatted = result.formatted_addresses || {};
          const recommend = formatted.recommend || "";
          const rough = formatted.rough || "";
          const fallbackAddress = result.address || "";
          const main = recommend || fallbackAddress || rough;
          let detail = rough;
          if (!detail || detail === main) {
            detail = fallbackAddress || recommend || "";
          }
          const nextData = {
            addressMain: main,
            addressDetail: detail,
            addressError: "",
            addressLoading: false
          };
          nextData.canConfirm = this.computeCanConfirm(nextData);
          this.setData(nextData);
        })
        .catch((err) => {
          if (this._reverseToken !== token) return;
          let message = err?.message || "无法获取地址，请稍后重试";
          if (message.includes("请求量已达到上限")) {
            message = "地址解析频率过快，请稍后重试";
          }
          const latText = Number.isFinite(this.data.selectedLatitude) ? this.data.selectedLatitude.toFixed(6) : "";
          const lngText = Number.isFinite(this.data.selectedLongitude) ? this.data.selectedLongitude.toFixed(6) : "";
          const coordinateFallback =
            latText && lngText ? `${latText}, ${lngText}` : "已获取坐标";
          const nextData = {
            addressMain: coordinateFallback,
            addressDetail: "无法获取详细地址，请检查网络后重试。",
            addressError: message,
            addressLoading: false
          };
          nextData.canConfirm = this.computeCanConfirm(nextData);
          this.setData(nextData);
          wx.showToast({ title: message, icon: "none" });
        });
    };

    const now = Date.now();
    const sinceLast = now - (this._lastReverseExecutedAt || 0);
    const throttleDelay = this._reverseMinInterval
      ? Math.max(0, this._reverseMinInterval - sinceLast)
      : 0;
    const baseDelay = immediate ? 0 : this._reverseDebounceDelay;
    const wait = Math.max(baseDelay, throttleDelay);

    if (wait <= 0) {
      execute();
    } else {
      this._reverseTimer = setTimeout(execute, wait);
    }
  },

  computeCanConfirm(overrides = {}) {
    const merged = Object.assign({}, this.data, overrides);
    const hasLocation = !!merged.hasLocation;
    const notLoading = !merged.addressLoading;
    const hasAddress = !!(merged.addressMain && String(merged.addressMain).trim());
    return hasLocation && notLoading && hasAddress;
  },

  onConfirm() {
    if (!this.data.canConfirm) {
      wx.showToast({ title: "正在获取地址，请稍后", icon: "none" });
      return;
    }
    const latitude = this.data.selectedLatitude;
    const longitude = this.data.selectedLongitude;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      wx.showToast({ title: "未能获取有效坐标", icon: "none" });
      return;
    }
    const addressDetail = this.data.addressDetail || this.data.addressMain || "";
    const payload = {
      latitude,
      longitude,
      address: addressDetail,
      displayAddress: this.data.addressMain,
      gcjLatitude: this._currentGcj?.latitude || null,
      gcjLongitude: this._currentGcj?.longitude || null
    };
    if (this._eventChannel && typeof this._eventChannel.emit === "function") {
      this._eventChannel.emit("locationPicked", payload);
    }
    wx.navigateBack();
  }
});
