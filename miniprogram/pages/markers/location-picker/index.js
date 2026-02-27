const { reverseGeocode } = require("../../../utils/geocoder");
const { gcj02ToWgs84, wgs84ToGcj02 } = require("../../../utils/coords");
const { searchPlaces } = require("../../../utils/search");
const { getMapKeySync, prefetchMapKey } = require("../../../utils/map-key");
const { isWeChatRuntime, isDesktopRuntime } = require("../../../utils/runtime");

const DEFAULT_CENTER = {
  latitude: 39.9042,
  longitude: 116.4074,
  scale: 16
};
const DEFAULT_LEVELS_PARAM = "2,6,1,4,3,7,8,10";
const MAP_MIN_SCALE = 0;
const MAP_MAX_SCALE = 18;
const RUNTIME_IS_WECHAT = isWeChatRuntime() && !isDesktopRuntime();

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

function normalizeMapScale(value) {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : DEFAULT_CENTER.scale;
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, Math.round(base)));
}

function normalizeRegionDetail(detail = {}) {
  if (!detail || typeof detail !== "object") return null;
  const region = detail.region || {
    northeast: detail.northeast,
    southwest: detail.southwest
  };
  if (!region || !region.northeast || !region.southwest) return null;
  const neLat = Number(region.northeast.latitude);
  const neLng = Number(region.northeast.longitude);
  const swLat = Number(region.southwest.latitude);
  const swLng = Number(region.southwest.longitude);
  if (![neLat, neLng, swLat, swLng].every(Number.isFinite)) return null;
  return {
    northeast: { latitude: neLat, longitude: neLng },
    southwest: { latitude: swLat, longitude: swLng }
  };
}

Page({
  data: {
    latitude: DEFAULT_CENTER.latitude,
    longitude: DEFAULT_CENTER.longitude,
    scale: DEFAULT_CENTER.scale,
    mapSubKey: getMapKeySync(),
    isWeChatRuntime: RUNTIME_IS_WECHAT,
    markers: [],
    polygons: [],
    circles: [],
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
    this._lastRegion = null;
    this._uomPlugin = null;
    this._uomPluginInitialized = false;
    this._uomPluginInitTimer = null;
    this._djiLayer = null;
    this._djiLayerInitialized = false;
    this._djiLayerInitTimer = null;
    this._temporaryNoFlyLayer = null;
    this._temporaryNoFlyLayerInitialized = false;
    this._temporaryNoFlyLayerInitTimer = null;
    this._uom2Markers = [];
    this._djiPolygons = [];
    this._djiCircles = [];
    this._nfzPolygons = [];
    this._nfzCircles = [];
    this._mapMarkerIdMap = new Map();
    this._mapMarkerIdSeq = 100000;
    this.loadMapSubKey();

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
    this.ensureUomPluginReady();
    this.ensureDjiLayerReady();
    this.ensureTemporaryNoFlyLayerReady();
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
    if (this._uomPluginInitTimer) {
      clearTimeout(this._uomPluginInitTimer);
      this._uomPluginInitTimer = null;
    }
    if (this._djiLayerInitTimer) {
      clearTimeout(this._djiLayerInitTimer);
      this._djiLayerInitTimer = null;
    }
    if (this._temporaryNoFlyLayerInitTimer) {
      clearTimeout(this._temporaryNoFlyLayerInitTimer);
      this._temporaryNoFlyLayerInitTimer = null;
    }
    if (this._uomPlugin && typeof this._uomPlugin.destroy === "function") {
      this._uomPlugin.destroy();
    }
    if (this._djiLayer && typeof this._djiLayer.destroy === "function") {
      this._djiLayer.destroy();
    }
    if (this._temporaryNoFlyLayer && typeof this._temporaryNoFlyLayer.destroy === "function") {
      this._temporaryNoFlyLayer.destroy();
    }
    if (this._eventChannel && typeof this._eventChannel.off === "function") {
      this._eventChannel.off("initLocation");
    }
    this._eventChannel = null;
  },

  loadMapSubKey() {
    prefetchMapKey()
      .then((mapKey) => {
        const nextKey = typeof mapKey === "string" ? mapKey.trim() : "";
        if (!nextKey || nextKey === this.data.mapSubKey) return;
        this.setData({ mapSubKey: nextKey });
      })
      .catch((err) => {
        console.warn("location picker loadMapSubKey failed", err);
      });
  },

  ensureMapMarkerId(value) {
    if (Number.isFinite(value)) return Number(value);
    const text = value === undefined || value === null ? "" : `${value}`.trim();
    if (!text) {
      this._mapMarkerIdSeq += 1;
      return this._mapMarkerIdSeq;
    }
    const numeric = Number(text);
    if (Number.isFinite(numeric)) return numeric;
    if (!this._mapMarkerIdMap) {
      this._mapMarkerIdMap = new Map();
      this._mapMarkerIdSeq = 100000;
    }
    if (this._mapMarkerIdMap.has(text)) {
      return this._mapMarkerIdMap.get(text);
    }
    this._mapMarkerIdSeq += 1;
    const mapped = this._mapMarkerIdSeq;
    this._mapMarkerIdMap.set(text, mapped);
    return mapped;
  },

  normalizeMapMarkerId(marker) {
    if (!marker || typeof marker !== "object") return marker;
    const rawId =
      marker.id !== undefined && marker.id !== null
        ? marker.id
        : marker.markerId ?? marker.markerID;
    const mappedId = this.ensureMapMarkerId(rawId);
    marker.id = mappedId;
    return marker;
  },

  normalizeMapMarkerList(list) {
    if (!Array.isArray(list)) return list;
    list.forEach((marker) => this.normalizeMapMarkerId(marker));
    return list;
  },

  ensureUomPluginReady(retry = 0) {
    if (this._uomPlugin && this._uomPluginInitialized) return;
    const selector = this.data.isWeChatRuntime ? "#uom-plugin" : "#uom2-plugin";
    const plugin = this.selectComponent(selector);
    if (plugin && typeof plugin.init === "function") {
      plugin.init({
        mapCtx: this.mapCtx,
        center: { latitude: this.data.latitude, longitude: this.data.longitude },
        centerPin: { latitude: this.data.latitude, longitude: this.data.longitude },
        scale: normalizeMapScale(this.data.scale),
        region: this._lastRegion,
        enabled: true
      });
      this._uomPlugin = plugin;
      this._uomPluginInitialized = true;
      return;
    }
    if (retry >= 10) return;
    if (this._uomPluginInitTimer) clearTimeout(this._uomPluginInitTimer);
    const delay = retry === 0 ? 0 : Math.min(500, 80 * (retry + 1));
    this._uomPluginInitTimer = setTimeout(() => {
      this._uomPluginInitTimer = null;
      this.ensureUomPluginReady(retry + 1);
    }, delay);
  },

  ensureDjiLayerReady(retry = 0) {
    if (this._djiLayer && this._djiLayerInitialized) return;
    const layer = this.selectComponent("#dji-no-fly-layer");
    if (
      layer &&
      typeof layer.init === "function" &&
      typeof layer.updateViewport === "function"
    ) {
      this._djiLayer = layer;
      this._djiLayerInitialized = true;
      layer.init({
        enabled: true,
        center: { latitude: this.data.latitude, longitude: this.data.longitude },
        region: this._lastRegion || null,
        scale: normalizeMapScale(this.data.scale),
        drone: "",
        levels: DEFAULT_LEVELS_PARAM,
        force: true
      });
      return;
    }
    if (retry >= 10) return;
    if (this._djiLayerInitTimer) clearTimeout(this._djiLayerInitTimer);
    const delay = retry === 0 ? 0 : Math.min(500, 80 * (retry + 1));
    this._djiLayerInitTimer = setTimeout(() => {
      this._djiLayerInitTimer = null;
      this.ensureDjiLayerReady(retry + 1);
    }, delay);
  },

  ensureTemporaryNoFlyLayerReady(retry = 0) {
    if (this._temporaryNoFlyLayer && this._temporaryNoFlyLayerInitialized) return;
    const layer = this.selectComponent("#temporary-no-fly-layer");
    if (
      layer &&
      typeof layer.init === "function" &&
      typeof layer.updateViewport === "function"
    ) {
      this._temporaryNoFlyLayer = layer;
      this._temporaryNoFlyLayerInitialized = true;
      layer.init({
        enabled: true,
        center: { latitude: this.data.latitude, longitude: this.data.longitude },
        region: this._lastRegion || null,
        scale: normalizeMapScale(this.data.scale),
        force: true
      });
      return;
    }
    if (retry >= 10) return;
    if (this._temporaryNoFlyLayerInitTimer) clearTimeout(this._temporaryNoFlyLayerInitTimer);
    const delay = retry === 0 ? 0 : Math.min(500, 80 * (retry + 1));
    this._temporaryNoFlyLayerInitTimer = setTimeout(() => {
      this._temporaryNoFlyLayerInitTimer = null;
      this.ensureTemporaryNoFlyLayerReady(retry + 1);
    }, delay);
  },

  syncExternalLayerViewport(options = {}) {
    const center = options.center || { latitude: this.data.latitude, longitude: this.data.longitude };
    const scale = normalizeMapScale(options.scale || this.data.scale);
    const region = options.region || this._lastRegion || null;
    this.ensureUomPluginReady();
    this.ensureDjiLayerReady();
    this.ensureTemporaryNoFlyLayerReady();
    if (this._uomPlugin && typeof this._uomPlugin.handleRegionChange === "function") {
      this._uomPlugin.handleRegionChange({
        center,
        centerPin: center,
        scale,
        rawScale: options.rawScale,
        region,
        force: options.force === true
      });
    }
    if (this._djiLayer && typeof this._djiLayer.updateViewport === "function") {
      this._djiLayer.updateViewport({
        center,
        region,
        scale,
        force: options.force === true
      });
    }
    if (this._temporaryNoFlyLayer && typeof this._temporaryNoFlyLayer.updateViewport === "function") {
      this._temporaryNoFlyLayer.updateViewport({
        center,
        region,
        scale,
        force: options.force === true
      });
    }
  },

  updateOverlayGraphics() {
    const polygons = [];
    const circles = [];
    if (Array.isArray(this._djiPolygons)) polygons.push(...this._djiPolygons);
    if (Array.isArray(this._nfzPolygons)) polygons.push(...this._nfzPolygons);
    if (Array.isArray(this._djiCircles)) circles.push(...this._djiCircles);
    if (Array.isArray(this._nfzCircles)) circles.push(...this._nfzCircles);
    this.setData({ polygons, circles });
  },

  syncMapMarkers() {
    const markers = Array.isArray(this._uom2Markers) ? this._uom2Markers.slice() : [];
    this.normalizeMapMarkerList(markers);
    this.setData({ markers });
  },

  onUomStatusChange() { },

  onUomTilesChanged(event = {}) {
    const detail = event?.detail || {};
    this._uom2Markers = Array.isArray(detail.markers) ? detail.markers : [];
    this.syncMapMarkers();
  },

  onDjiGraphicsChange(event = {}) {
    const detail = event?.detail || {};
    this._djiPolygons = Array.isArray(detail.polygons) ? detail.polygons : [];
    this._djiCircles = Array.isArray(detail.circles) ? detail.circles : [];
    this.updateOverlayGraphics();
  },

  onTemporaryNoFlyGraphicsChange(event = {}) {
    const detail = event?.detail || {};
    this._nfzPolygons = Array.isArray(detail.polygons) ? detail.polygons : [];
    this._nfzCircles = Array.isArray(detail.circles) ? detail.circles : [];
    this.updateOverlayGraphics();
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
      isHighAccuracy: false,
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
    const center = { latitude, longitude };
    if (this.mapCtx && typeof this.mapCtx.moveToLocation === "function") {
      const moveOptions = { latitude, longitude };
      moveOptions.fail = () => {
        if (this.mapCtx && typeof this.mapCtx.moveToLocation === "function") {
          this.mapCtx.moveToLocation();
        }
      };
      this.mapCtx.moveToLocation(moveOptions);
      this._pendingMoveTo = null;
      this.syncExternalLayerViewport({
        center,
        region: this._lastRegion,
        scale: this.data.scale,
        force: true
      });
      return;
    }
    this._pendingMoveTo = { latitude, longitude };
    this.syncExternalLayerViewport({
      center,
      region: this._lastRegion,
      scale: this.data.scale,
      force: true
    });
  },

  handleCenterChange(gcjLat, gcjLng, options = {}) {
    const {
      updateMapCenter = false,
      syncMapCenter = false,
      suppressLayerSync = false,
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
    if (updateMapCenter || syncMapCenter) {
      const moveLatitude = latitude;
      const moveLongitude = longitude;
      nextData.latitude = latitude;
      nextData.longitude = longitude;
      if (updateMapCenter) {
        moveAfterUpdate = () => {
          this.queueMapMove(moveLatitude, moveLongitude);
        };
      }
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
      if (!suppressLayerSync) {
        this.syncExternalLayerViewport({
          center: { latitude, longitude },
          region: this._lastRegion,
          scale: this.data.scale,
          force: !moveAfterUpdate
        });
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
    const detail = e?.detail || {};
    const cause = e?.causedBy || detail?.causedBy || detail?.cause || "";
    if (cause && cause !== "drag" && cause !== "scale") return;
    if (e?.type !== "end") {
      if (this._uomPlugin && typeof this._uomPlugin.startFollow === "function") {
        this._uomPlugin.startFollow();
      }
      const cl = detail.centerLocation || null;
      if (cl && this._uomPlugin && typeof this._uomPlugin.handleRegionChange === "function") {
        const region = normalizeRegionDetail(detail);
        const scale = normalizeMapScale(detail.scale || this.data.scale);
        if (region) this._lastRegion = region;
        this._uomPlugin.handleRegionChange({
          center: { latitude: cl.latitude, longitude: cl.longitude },
          centerPin: { latitude: cl.latitude, longitude: cl.longitude },
          scale,
          rawScale: detail.scale,
          region: region || this._lastRegion,
          force: true
        });
      }
      return;
    }
    if (this._uomPlugin && typeof this._uomPlugin.stopFollow === "function") {
      this._uomPlugin.stopFollow();
    }
    const centerLocation = detail.centerLocation || null;
    const region = normalizeRegionDetail(detail);
    const rawScale = Number(detail.scale);
    const currentScale = Number(this.data.scale);
    const resolvedScale = Number.isFinite(rawScale) ? rawScale : currentScale;
    const scale = normalizeMapScale(resolvedScale);
    const updates = {};
    if (cause === "scale" && scale !== this.data.scale) {
      updates.scale = scale;
    }
    if (Object.keys(updates).length) {
      this.setData(updates);
    }
    this._lastRegion = region;
    const center = centerLocation && hasValidCoordinate(centerLocation.latitude, centerLocation.longitude)
      ? { latitude: Number(centerLocation.latitude), longitude: Number(centerLocation.longitude) }
      : { latitude: this.data.latitude, longitude: this.data.longitude };
    if (centerLocation && hasValidCoordinate(center.latitude, center.longitude)) {
      this.handleCenterChange(center.latitude, center.longitude, {
        updateMapCenter: false,
        syncMapCenter: true,
        suppressLayerSync: true
      });
    }
    this.syncExternalLayerViewport({
      center,
      region,
      scale,
      rawScale: detail.scale
    });
    if (this._uomPlugin && typeof this._uomPlugin.scheduleFinalRefresh === "function") {
      this._uomPlugin.scheduleFinalRefresh();
    }
    if (!centerLocation || !hasValidCoordinate(center.latitude, center.longitude)) {
      this.fetchCenterLocation();
    }
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
