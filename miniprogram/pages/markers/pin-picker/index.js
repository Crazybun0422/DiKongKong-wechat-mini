const { reverseGeocode } = require("../../../utils/geocoder");
const { gcj02ToWgs84, wgs84ToGcj02 } = require("../../../utils/coords");
const { searchPlaces } = require("../../../utils/search");

const DEFAULT_CENTER = {
  latitude: 39.9042,
  longitude: 116.4074,
  scale: 16
};

const TYPE_SECTIONS = [
  {
    id: "POINT",
    label: "绘制点",
    options: [
      { id: "POINT_DEFAULT", label: "通用", icon: "/assets/default.png" },
      { id: "POINT_WARNING", label: "警示点", icon: "/assets/drone-warning.png" },
      { id: "POINT_AERIAL", label: "航拍点", icon: "/assets/aerial.png" },
      { id: "POINT_DOCK", label: "起降场", icon: "/assets/dock.png" },
      { id: "POINT_ELEVATION", label: "高程建筑", icon: "/assets/elevation.png" }
    ]
  },
  {
    id: "LINE",
    label: "绘制线",
    options: [{ id: "LINE_PATH_BUFFER", label: "临时禁飞区路径缓冲区", icon: "/assets/path.png" }]
  },
  {
    id: "AREA",
    label: "绘制面",
    options: [
      { id: "AREA_CIRCLE", label: "圆形", icon: "/assets/circle.png" },
      { id: "AREA_RECTANGLE", label: "矩形", icon: "/assets/rectangle.png" },
      { id: "AREA_POLYGON", label: "多边形", icon: "/assets/polygon.png" }
    ]
  }
];

const DEFAULT_TYPE = TYPE_SECTIONS[0].options[0];

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
    canConfirm: false,
    typeSections: TYPE_SECTIONS,
    selectedType: Object.assign({ category: "POINT" }, DEFAULT_TYPE),
    activeTypeSectionId: TYPE_SECTIONS[0].id,
    activeTypeOptions: TYPE_SECTIONS[0].options,
    typeMenuVisible: false
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
    this.mapCtx = wx.createMapContext("pin-picker-map", this);
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
        success: resolve,
        fail: openSetting
      });
    });
  },

  requestCurrentLocation(options = {}) {
    const { silent = false } = options;
    if (!silent) {
      this.setData({ addressLoading: true, addressError: "" });
    }
    return new Promise((resolve, reject) => {
      if (typeof wx === "undefined" || typeof wx.getLocation !== "function") {
        reject(new Error("unsupported"));
        return;
      }
      wx.getLocation({
        type: "gcj02",
        success: (res) => {
          const latitude = normalizeCoord(res.latitude);
          const longitude = normalizeCoord(res.longitude);
          if (!hasValidCoordinate(latitude, longitude)) {
            reject(new Error("invalid-location"));
            return;
          }
          this.queueMapMove(latitude, longitude);
          resolve({ latitude, longitude });
        },
        fail: reject
      });
    }).catch((err) => {
      if (!silent) {
        this.setData({ addressError: "无法获取当前位置", addressLoading: false });
      }
      console.warn("getLocation failed", err);
    });
  },

  applyInitialPayload(payload) {
    const data = payload || {};
    const lat = normalizeCoord(data.latitude);
    const lng = normalizeCoord(data.longitude);
    let moved = false;
    if (hasValidCoordinate(lat, lng)) {
      this.setData({
        latitude: lat,
        longitude: lng,
        selectedLatitude: lat,
        selectedLongitude: lng,
        coordinateText: formatCoordinateText(lat, lng),
        hasLocation: true,
        canConfirm: true,
        addressLoading: true,
        addressError: ""
      });
      if (this._ready) {
        this.mapCtx && this.mapCtx.moveToLocation && this.mapCtx.moveToLocation({ latitude: lat, longitude: lng });
        this.reverseGeocode(lat, lng);
      } else {
        this._pendingMoveTo = { latitude: lat, longitude: lng };
      }
      moved = true;
    }
    const typeId = data.typeId || data.type;
    if (typeId) {
      const next = this.findTypeById(typeId);
      if (next) {
        const sectionId = next.category || this.findSectionByType(typeId);
        this.setData({
          selectedType: next,
          activeTypeSectionId: sectionId,
          activeTypeOptions: this.getTypeOptionsBySection(sectionId)
        });
      }
    }
    return moved;
  },

  findTypeById(id) {
    if (!id) return null;
    for (const section of TYPE_SECTIONS) {
      for (const option of section.options) {
        if (option.id === id) {
          return { ...option, category: section.id };
        }
      }
    }
    return null;
  },

  queueMapMove(latitude, longitude) {
    if (!hasValidCoordinate(latitude, longitude)) return;
    if (!this._ready) {
      this._pendingMoveTo = { latitude, longitude };
      return;
    }
    this.setData({
      latitude,
      longitude,
      selectedLatitude: latitude,
      selectedLongitude: longitude,
      hasLocation: true,
      canConfirm: true,
      coordinateText: formatCoordinateText(latitude, longitude),
      addressLoading: true,
      addressError: ""
    });
    if (this.mapCtx && typeof this.mapCtx.moveToLocation === "function") {
      this.mapCtx.moveToLocation({ latitude, longitude });
    }
    this.reverseGeocode(latitude, longitude);
  },

  reverseGeocode(lat, lng) {
    if (!hasValidCoordinate(lat, lng)) return;
    if (!reverseGeocode) return;
    if (this._reverseTimer) {
      clearTimeout(this._reverseTimer);
      this._reverseTimer = null;
    }
    const now = Date.now();
    const elapsed = now - this._lastReverseExecutedAt;
    const key = `${lat},${lng}`;
    this._pendingReverseLocationKey = key;
    const schedule = () => {
      this._reverseTimer = setTimeout(() => {
        this._reverseTimer = null;
        this._lastReverseExecutedAt = Date.now();
        this._lastReverseLocationKey = key;
        const wgs = gcj02ToWgs84(lng, lat);
        const wgsLat = normalizeCoord(wgs?.lat);
        const wgsLng = normalizeCoord(wgs?.lng);
        if (!hasValidCoordinate(wgsLat, wgsLng)) {
          this.setData({ addressError: "坐标无效", addressLoading: false });
          return;
        }
        reverseGeocode(wgsLat, wgsLng)
          .then((address) => {
            if (this._pendingReverseLocationKey !== key) return;
            const main = address?.recommend || address?.formatted_addresses?.recommend || address?.address || "";
            const detail = address?.standard_address || address?.address_reference?.landmark_l1?.title || "";
            this.setData({
              addressMain: main,
              addressDetail: detail,
              addressError: "",
              addressLoading: false
            });
          })
          .catch((err) => {
            console.warn("reverseGeocode failed", err);
            if (this._pendingReverseLocationKey !== key) return;
            this.setData({ addressError: "无法解析地址", addressLoading: false });
          });
      }, this._reverseDebounceDelay);
    };
    if (elapsed >= this._reverseMinInterval) {
      schedule();
    } else {
      this._reverseTimer = setTimeout(schedule, this._reverseMinInterval - elapsed);
    }
  },

  onRegionChange(e) {
    if (e && e.type === "end" && e.detail && e.detail.centerLocation) {
      const latitude = normalizeCoord(e.detail.centerLocation.latitude);
      const longitude = normalizeCoord(e.detail.centerLocation.longitude);
      if (!hasValidCoordinate(latitude, longitude)) return;
      this.setData({
        selectedLatitude: latitude,
        selectedLongitude: longitude,
        coordinateText: formatCoordinateText(latitude, longitude),
        hasLocation: true,
        canConfirm: true,
        addressError: "",
        addressLoading: true
      });
      this.reverseGeocode(latitude, longitude);
    }
  },

  onLocateTap() {
    this.requestCurrentLocation({ silent: false });
  },

  onSearchInput(e) {
    const value = (e?.detail?.value || "").trim();
    this.setData({ searchKeyword: value });
    this.scheduleSuggest(value);
  },

  onSearchFocus() {
    this.setData({ searchPanelFocused: true });
    if (this.data.searchKeyword) {
      this.scheduleSuggest(this.data.searchKeyword);
    }
  },

  onSearchBlur() {
    if (this._searchBlurTimer) {
      clearTimeout(this._searchBlurTimer);
    }
    this._searchBlurTimer = setTimeout(() => {
      this.setData({ searchPanelFocused: false });
    }, 120);
  },

  onSearchConfirm() {
    if (this.data.searchSuggestions.length) return;
    if (this.data.searchKeyword) {
      this.scheduleSuggest(this.data.searchKeyword);
    }
  },

  onSearchClear() {
    this.setData({
      searchKeyword: "",
      searchSuggestions: [],
      searchSuggestError: "",
      searchSuggestLoading: false
    });
  },

  scheduleSuggest(keyword) {
    if (this._suggestTimer) {
      clearTimeout(this._suggestTimer);
      this._suggestTimer = null;
    }
    if (!keyword) {
      this.setData({ searchSuggestions: [], searchSuggestError: "" });
      return;
    }
    this._latestSuggestKeyword = keyword;
    this._suggestTimer = setTimeout(() => {
      this._suggestTimer = null;
      this.fetchSuggestions(keyword);
    }, this._suggestDelay);
  },

  fetchSuggestions(keyword) {
    this.setData({ searchSuggestLoading: true, searchSuggestError: "" });
    searchPlaces(keyword)
      .then((list) => {
        if (keyword !== this._latestSuggestKeyword) return;
        const suggestions = normalizeSuggestions(list);
        this.setData({
          searchSuggestions: suggestions,
          searchSuggestLoading: false,
          searchSuggestError: suggestions.length ? "" : "未匹配到地点"
        });
      })
      .catch((err) => {
        console.warn("searchPlaces failed", err);
        if (keyword !== this._latestSuggestKeyword) return;
        this.setData({
          searchSuggestions: [],
          searchSuggestLoading: false,
          searchSuggestError: "搜索失败，请重试"
        });
      });
  },

  onSuggestionTap(e) {
    const index = e?.currentTarget?.dataset?.index;
    const suggestion = this.data.searchSuggestions[index];
    if (!suggestion) return;
    this.setData({
      searchKeyword: suggestion.title,
      searchSuggestions: [],
      searchSuggestError: "",
      searchSuggestLoading: false
    });
    this.queueMapMove(suggestion.latitude, suggestion.longitude);
  },

  toggleTypeMenu() {
    this.setData({ typeMenuVisible: !this.data.typeMenuVisible });
  },

  closeTypeMenu() {
    this.setData({ typeMenuVisible: false });
  },

  onTypeSectionTap(e) {
    const id = e?.currentTarget?.dataset?.sectionId;
    if (!id || id === this.data.activeTypeSectionId) return;
    this.setData({
      activeTypeSectionId: id,
      activeTypeOptions: this.getTypeOptionsBySection(id)
    });
  },

  onTypeSelect(e) {
    const typeId = e?.currentTarget?.dataset?.typeid;
    const next = this.findTypeById(typeId);
    if (!next) return;
    this.setData({
      selectedType: next,
      activeTypeSectionId: next.category || this.findSectionByType(next.id),
      activeTypeOptions: this.getTypeOptionsBySection(next.category || this.findSectionByType(next.id)),
      typeMenuVisible: false
    });
  },

  noop() { },

  onConfirm() {
    if (!this.data.canConfirm || !hasValidCoordinate(this.data.selectedLatitude, this.data.selectedLongitude)) {
      wx.showToast({ title: "请选择标记位置", icon: "none" });
      return;
    }
    const wgs = gcj02ToWgs84(this.data.selectedLongitude, this.data.selectedLatitude);
    const wgsLat = normalizeCoord(wgs?.lat);
    const wgsLng = normalizeCoord(wgs?.lng);
    const result = {
      latitude: this.data.selectedLatitude,
      longitude: this.data.selectedLongitude,
      wgs84: hasValidCoordinate(wgsLat, wgsLng) ? { latitude: wgsLat, longitude: wgsLng } : null,
      addressMain: this.data.addressMain,
      addressDetail: this.data.addressDetail,
      coordinateText: this.data.coordinateText,
      typeId: this.data.selectedType.id,
      typeLabel: this.data.selectedType.label,
      category: this.data.selectedType.category || this.findSectionByType(this.data.selectedType.id)
    };
    if (this._eventChannel && typeof this._eventChannel.emit === "function") {
      this._eventChannel.emit("pinSelected", result);
    }
    wx.navigateBack({ delta: 1 });
  },

  findSectionByType(typeId) {
    for (const section of TYPE_SECTIONS) {
      const match = section.options.find((op) => op.id === typeId);
      if (match) return section.id;
    }
    return "";
  },

  getTypeOptionsBySection(sectionId) {
    const section = TYPE_SECTIONS.find((sec) => sec.id === sectionId);
    return section ? section.options : [];
  }
});
