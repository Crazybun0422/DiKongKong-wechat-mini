const { reverseGeocode } = require("../../../utils/geocoder");
const { gcj02ToWgs84, wgs84ToGcj02 } = require("../../../utils/coords");
const { searchPlaces } = require("../../../utils/search");

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

function formatCoordinateText(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function normalizeSuggestions(list = [], limit = 10) {
  const suggestions = [];
  list.forEach((poi, index) => {
    const lat = Number(poi?.location?.lat);
    const lng = Number(poi?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }
    const title = poi.title || poi.name || "";
    const addressParts = [
      poi.address,
      poi.district,
      poi.city,
      poi.province,
      poi.category
    ]
      .map((part) => (part || "").trim())
      .filter(Boolean);
    const address = addressParts.reduce((acc, part) => {
      return acc.includes(part) ? acc : `${acc ? `${acc} · ` : ""}${part}`;
    }, "");
    suggestions.push({
      id: poi.id || poi.adcode || `poi-${index}`,
      title: title || address || "未命名地点",
      address,
      latitude: lat,
      longitude: lng
    });
  });
  return suggestions.slice(0, limit);
}

function isZeroCoordinate(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return Math.abs(lat) <= 1e-6 && Math.abs(lng) <= 1e-6;
}

function hasValidCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && !isZeroCoordinate(lat, lng);
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
    coordinateText: "",
    searchKeyword: "",
    searchSuggestions: [],
    searchSuggestLoading: false,
    searchSuggestError: "",
    searchPanelFocused: false,
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
    this._suggestTimer = null;
    this._suggestDelay = 280;
    this._latestSuggestKeyword = "";
    this._pendingMoveTo = null;
    this._searchBlurTimer = null;

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
    if (this._pendingMoveTo) {
      const { latitude, longitude } = this._pendingMoveTo;
      this.queueMapMove(latitude, longitude);
    }
    this.requestInitialLocation();
  },

  onUnload() {
    if (this._reverseTimer) {
      clearTimeout(this._reverseTimer);
      this._reverseTimer = null;
    }
    if (this._suggestTimer) {
      clearTimeout(this._suggestTimer);
      this._suggestTimer = null;
    }
    if (this._searchBlurTimer) {
      clearTimeout(this._searchBlurTimer);
      this._searchBlurTimer = null;
    }
    if (this._eventChannel && typeof this._eventChannel.off === "function") {
      this._eventChannel.off("initLocation");
    }
    this._eventChannel = null;
  },

  requestInitialLocation() {
    if (this.applyInitialPayload(this._initialPayload)) {
      return;
    }
    const fallback = () => {
      this.requestCurrentLocation({ silent: true });
    };
    this.ensureLocationPermission().then(fallback).catch(fallback);
  },

  ensureLocationPermission() {
    return new Promise((resolve, reject) => {
      if (typeof wx === "undefined" || typeof wx.getSetting !== "function") {
        resolve();
        return;
      }
      wx.getSetting({
        success: (res) => {
          const granted = !!(res.authSetting && res.authSetting["scope.userLocation"]);
          if (granted) {
            resolve();
            return;
          }
          this.authorizeLocation().then(resolve).catch(reject);
        },
        fail: reject
      });
    });
  },

  authorizeLocation() {
    return new Promise((resolve, reject) => {
      if (typeof wx === "undefined") {
        resolve();
        return;
      }
      const openSetting = () => {
        if (typeof wx.openSetting !== "function") {
          reject(new Error("permission-denied"));
          return;
        }
        wx.openSetting({
          success: (st) => {
            const granted = !!(st.authSetting && st.authSetting["scope.userLocation"]);
            if (granted) {
              resolve();
            } else {
              reject(new Error("permission-denied"));
            }
          },
          fail: reject
        });
      };
      if (typeof wx.authorize !== "function") {
        openSetting();
        return;
      }
      wx.authorize({
        scope: "scope.userLocation",
        success: () => resolve(),
        fail: () => {
          openSetting();
        }
      });
    });
  },

  applyInitialPayload(payload) {
    if (!payload) return false;
    const rawLat = Number(payload.latitude);
    const rawLng = Number(payload.longitude);
    const address = payload.address || "";
    if (!hasValidCoordinate(rawLat, rawLng)) {
      if (address) {
        const nextData = {
          addressMain: address,
          addressDetail: address,
          addressError: "",
          addressLoading: false,
          searchKeyword: address
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
    if (address) {
      this.setData({ searchKeyword: address });
    }
    return true;
  },

  requestCurrentLocation(options = {}) {
    const silent = !!options.silent;
    const handleFailure = () => {
      if (!silent && typeof wx !== "undefined" && typeof wx.showToast === "function") {
        wx.showToast({ title: "定位失败，请手动选择", icon: "none" });
      }
      this.handleCenterChange(DEFAULT_CENTER.latitude, DEFAULT_CENTER.longitude, {
        updateMapCenter: true,
        immediateReverse: true
      });
    };
    if (typeof wx.getLocation !== "function") {
      handleFailure();
      return;
    }
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: true,
      highAccuracyExpireTime: 8000,
      success: (res) => {
        const gcjLat = Number(res.latitude);
        const gcjLng = Number(res.longitude);
        if (!hasValidCoordinate(gcjLat, gcjLng)) {
          handleFailure();
          return;
        }
        this.handleCenterChange(gcjLat, gcjLng, {
          updateMapCenter: true,
          immediateReverse: true
        });
      },
      fail: handleFailure
    });
  },

  queueMapMove(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }
    if (this.mapCtx && typeof this.mapCtx.moveToLocation === "function") {
      const moveOptions = { latitude, longitude };
      moveOptions.fail = () => {
        if (this.mapCtx && typeof this.mapCtx.moveToLocation === "function") {
          this.mapCtx.moveToLocation();
        }
      };
      this.mapCtx.moveToLocation(moveOptions);
      this._pendingMoveTo = null;
      return;
    }
    this._pendingMoveTo = { latitude, longitude };
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
      coordinateText: formatCoordinateText(selectedLatitude, selectedLongitude),
      hasLocation: true
    };
    let moveAfterUpdate = null;
    if (updateMapCenter) {
      const moveLatitude = latitude;
      const moveLongitude = longitude;
      nextData.latitude = latitude;
      nextData.longitude = longitude;
      moveAfterUpdate = () => {
        this.queueMapMove(moveLatitude, moveLongitude);
      };
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
    this.setData(nextData, () => {
      if (typeof moveAfterUpdate === "function") {
        moveAfterUpdate();
      }
    });

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

  onSearchInput(e) {
    const keyword = e?.detail?.value || "";
    if (this._searchBlurTimer) {
      clearTimeout(this._searchBlurTimer);
      this._searchBlurTimer = null;
    }
    this.setData({ searchKeyword: keyword });
    if (!keyword.trim()) {
      if (this._suggestTimer) {
        clearTimeout(this._suggestTimer);
        this._suggestTimer = null;
      }
      this._latestSuggestKeyword = "";
      this.setData({
        searchSuggestions: [],
        searchSuggestLoading: false,
        searchSuggestError: ""
      });
      return;
    }
    this.setData({
      searchSuggestLoading: true,
      searchSuggestError: ""
    });
    this.scheduleSearchSuggest();
  },

  onSearchFocus() {
    if (this._searchBlurTimer) {
      clearTimeout(this._searchBlurTimer);
      this._searchBlurTimer = null;
    }
    if (!this.data.searchPanelFocused) {
      this.setData({ searchPanelFocused: true });
    }
  },

  onSearchBlur() {
    if (this._searchBlurTimer) {
      clearTimeout(this._searchBlurTimer);
    }
    this._searchBlurTimer = setTimeout(() => {
      this._searchBlurTimer = null;
      this.setData({ searchPanelFocused: false });
    }, 180);
  },

  onSearchClear() {
    if (this._suggestTimer) {
      clearTimeout(this._suggestTimer);
      this._suggestTimer = null;
    }
    this._latestSuggestKeyword = "";
    this.setData({
      searchKeyword: "",
      searchSuggestions: [],
      searchSuggestLoading: false,
      searchSuggestError: ""
    });
  },

  onSearchConfirm() {
    const keyword = (this.data.searchKeyword || "").trim();
    if (!keyword) return;
    if (this._suggestTimer) {
      clearTimeout(this._suggestTimer);
      this._suggestTimer = null;
    }
    this.setData({
      searchSuggestLoading: true,
      searchSuggestError: ""
    });
    const gcjCenter =
      this._currentGcj &&
      Number.isFinite(this._currentGcj.latitude) &&
      Number.isFinite(this._currentGcj.longitude)
        ? this._currentGcj
        : (Number.isFinite(this.data.latitude) && Number.isFinite(this.data.longitude)
            ? { latitude: this.data.latitude, longitude: this.data.longitude }
            : null);
    let searchPromise;
    if (gcjCenter) {
      try {
        const centerWgs = gcj02ToWgs84(gcjCenter.longitude, gcjCenter.latitude);
        searchPromise = searchPlaces(keyword, {
          latitude: centerWgs.lat,
          longitude: centerWgs.lng
        });
      } catch (err) {
        console.warn("Failed to convert center for search", err);
        searchPromise = searchPlaces(keyword);
      }
    } else {
      searchPromise = searchPlaces(keyword);
    }
    const snapshot = keyword;
    this._latestSuggestKeyword = snapshot;
    searchPromise
      .then((results) => {
        if (this._latestSuggestKeyword !== snapshot) return;
        const suggestions = normalizeSuggestions(results, 10);
        if (!suggestions.length) {
          this.setData({
            searchSuggestions: [],
            searchSuggestLoading: false,
            searchSuggestError: "未找到匹配地点"
          });
          wx.showToast({ title: "未找到相关地点", icon: "none" });
          return;
        }
        this.setData({
          searchSuggestions: suggestions,
          searchSuggestLoading: false,
          searchSuggestError: ""
        });
        this.applySuggestion(suggestions[0], {
          updateKeyword: true,
          collapseSuggestions: false,
          keepFocus: true
        });
      })
      .catch((err) => {
        console.warn("Location picker search failed", err);
        if (this._latestSuggestKeyword !== snapshot) return;
        this.setData({
          searchSuggestions: [],
          searchSuggestLoading: false,
          searchSuggestError: "搜索失败，请稍后重试"
        });
        wx.showToast({ title: "搜索失败，请稍后重试", icon: "none" });
      });
  },

  onLocateTap() {
    this.ensureLocationPermission()
      .then(() => {
        this.requestCurrentLocation();
      })
      .catch(() => {
        wx.showToast({ title: "未授权定位权限", icon: "none" });
      });
  },

  scheduleSearchSuggest() {
    if (this._suggestTimer) {
      clearTimeout(this._suggestTimer);
    }
    this._suggestTimer = setTimeout(() => {
      this._suggestTimer = null;
      this.fetchSearchSuggestions();
    }, this._suggestDelay);
  },

  fetchSearchSuggestions() {
    const keyword = (this.data.searchKeyword || "").trim();
    if (!keyword) {
      this.setData({
        searchSuggestions: [],
        searchSuggestLoading: false,
        searchSuggestError: ""
      });
      return;
    }
    const gcjCenter =
      this._currentGcj &&
      Number.isFinite(this._currentGcj.latitude) &&
      Number.isFinite(this._currentGcj.longitude)
        ? this._currentGcj
        : (Number.isFinite(this.data.latitude) && Number.isFinite(this.data.longitude)
            ? { latitude: this.data.latitude, longitude: this.data.longitude }
            : null);
    let searchPromise;
    if (gcjCenter) {
      try {
        const centerWgs = gcj02ToWgs84(gcjCenter.longitude, gcjCenter.latitude);
        searchPromise = searchPlaces(keyword, {
          latitude: centerWgs.lat,
          longitude: centerWgs.lng
        });
      } catch (err) {
        console.warn("Failed to convert center for suggestions", err);
        searchPromise = searchPlaces(keyword);
      }
    } else {
      searchPromise = searchPlaces(keyword);
    }
    const snapshot = keyword;
    this._latestSuggestKeyword = snapshot;
    searchPromise
      .then((results) => {
        if (this._latestSuggestKeyword !== snapshot) return;
        const suggestions = normalizeSuggestions(results, 8);
        this.setData({
          searchSuggestions: suggestions,
          searchSuggestLoading: false,
          searchSuggestError: suggestions.length ? "" : "未找到匹配地点"
        });
      })
      .catch((err) => {
        console.warn("Location picker suggestion failed", err);
        if (this._latestSuggestKeyword !== snapshot) return;
        this.setData({
          searchSuggestions: [],
          searchSuggestLoading: false,
          searchSuggestError: "搜索失败，请稍后重试"
        });
      });
  },

  applySuggestion(suggestion, options = {}) {
    if (!suggestion) return;
    const {
      updateKeyword = true,
      collapseSuggestions = true,
      keepFocus = false
    } = options;
    const { latitude, longitude } = suggestion;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      wx.showToast({ title: "无法定位到该地址", icon: "none" });
      return;
    }
    this.handleCenterChange(latitude, longitude, {
      updateMapCenter: true,
      immediateReverse: true
    });
    const displayMain = suggestion.title || suggestion.address || "已选地点";
    let displayDetail = suggestion.address || "";
    if (displayDetail === displayMain) {
      displayDetail = "";
    }
    const addressData = {
      addressMain: displayMain,
      addressDetail: displayDetail,
      addressError: "",
      addressLoading: false
    };
    const updates = Object.assign({}, addressData);
    updates.canConfirm = this.computeCanConfirm(addressData);
    if (updateKeyword) {
      updates.searchKeyword = displayMain;
    }
    if (collapseSuggestions) {
      updates.searchSuggestions = [];
      updates.searchSuggestLoading = false;
      updates.searchSuggestError = "";
    }
    if (!keepFocus) {
      updates.searchPanelFocused = false;
    }
    this.setData(updates);
  },

  onSuggestionTap(e) {
    if (this._searchBlurTimer) {
      clearTimeout(this._searchBlurTimer);
      this._searchBlurTimer = null;
    }
    const idx = Number(e?.currentTarget?.dataset?.index);
    if (!Number.isFinite(idx)) return;
    const suggestion = this.data.searchSuggestions?.[idx];
    if (!suggestion) return;
    this.applySuggestion(suggestion, {
      updateKeyword: true,
      collapseSuggestions: true,
      keepFocus: false
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
