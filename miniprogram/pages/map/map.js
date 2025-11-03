const { DRONES } = require("../../utils/drones");
const { fetchDjiAreas, buildAreaGraphics } = require("../../utils/dji");
const { searchPlaces } = require("../../utils/search");
const { fetchNearbyMarkers, buildFileDownloadUrl } = require("../../utils/markers");
const {
  buildWmsOverlay,
  WMS_MIN_ZOOM,
  WMS_MAX_ZOOM
} = require("../../utils/wms");
const { haversineMeters, clampRadius, gcj02ToWgs84, wgs84ToGcj02 } = require("../../utils/coords");
const { QQMAP_KEY, QQMAP_CUSTOM_STYLE_ID } = require("../../utils/config");
const {
  DEFAULT_AVATAR_PATH,
  extractAvatarFileName: extractAvatarFileNameUtil,
  buildAvatarDownloadUrl: buildAvatarDownloadUrlUtil,
  prepareAvatarForUpload: prepareAvatarForUploadUtil,
  uploadAvatarFile: uploadAvatarFileUtil,
  loadStoredProfile: loadStoredProfileUtil,
  persistProfileLocally: persistProfileLocallyUtil,
  hasStoredProfile: hasStoredProfileUtil
} = require("../../utils/profile");

const DEFAULT_CENTER = {
  latitude: 39.908823,
  longitude: 116.39747
};

const DEFAULT_DRONE_INDEX = (() => {
  const idx = DRONES.findIndex((d) => d.slug === "dji-mavic-3");
  return idx >= 0 ? idx : 0;
})();

const DEFAULT_DRONE = DRONES[DEFAULT_DRONE_INDEX] || DRONES[0] || {
  name: "",
  slug: ""
};
const DEFAULT_LEVELS_PARAM = "2,6,1,4,3,7,8,10";
const ACCESS_TOKEN_STORAGE_KEY = "accessToken";
// 小程序静态资源使用相对路径；assets 位于 miniprogram/assets
const NFZ_CENTER_COLORS = {
  1: "#000000",
  2: "#DE4329",
  3: "#EE8815",
  4: "#FFCC00",
  6: "#979797",
  7: "#37C4DB",
  8: "#35C759",
  10: "#A9D86E"
};

const MAP_MIN_SCALE = 3;
const MAP_MAX_SCALE = 16;
const DEFAULT_MAP_SCALE = 15;

const MIN_FETCH_RADIUS = 80000;
const MAX_FETCH_RADIUS = 80000;
const DEFAULT_FETCH_RADIUS = 80000;

const clampMapScale = (value) => {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : DEFAULT_MAP_SCALE;
  const rounded = Math.round(base);
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, rounded));
};

const formatNearbyMarkerLabel = (value) => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= 5) {
    return trimmed;
  }
  const firstLine = trimmed.slice(0, 5);
  const remaining = trimmed.slice(5);
  if (!remaining) {
    return firstLine;
  }
  let secondLine = remaining.slice(0, 5);
  if (remaining.length > 5) {
    secondLine = `${secondLine}...`;
  }
  return `${firstLine}\n${secondLine}`;
};

Page({
  data: {
    keyword: "",
    djiMsg: "",
    center: DEFAULT_CENTER,
    scale: DEFAULT_MAP_SCALE,
    minScale: MAP_MIN_SCALE,
    maxScale: MAP_MAX_SCALE,
    mapSubKey: QQMAP_KEY || "",
    customMapStyleId: QQMAP_CUSTOM_STYLE_ID || "",
    markers: [],
    polygons: [],
    circles: [],
    droneNames: DRONES.map((d) => d.name),
    selectedDroneIndex: DEFAULT_DRONE_INDEX,
    selectedDrone: DEFAULT_DRONE.slug,
    selectedDroneName: DEFAULT_DRONE.name,
    levelsInput: DEFAULT_LEVELS_PARAM,
    loadingDji: false,
    uomStatus: "评估中",
    uomTone: "neutral",
    djiStatus: "评估中",
    djiTone: "neutral",
    djiStatusExtra: "",
    searchSuggestions: [],
    searchSuggestLoading: false,
    searchSuggestError: "",
    dronePickerVisible: false,
    pendingDroneIndex: null,
    showDashboardPanel: true,
    showPermissionChecklistPanel: false,
    permissionChecklistLoading: false,
    showProfileFill: false,
    tempNickname: "",
    tempAvatarUrl: DEFAULT_AVATAR_PATH,
    activeTab: "home",
    showMarkerDetail: false,
    activeMarkerDetail: null
  },

  onLoad() {
    this.mapCtx = wx.createMapContext("main-map");
    this.applyCustomMapStyle();
    this._fetchTimer = null;
    this._markersFetchTimer = null;
    this._currentRadius = clampRadius(DEFAULT_FETCH_RADIUS);
    this._currentBounds = null;
    this._suppressRegionOnce = false;
    this._centerOverride = this.data.center;
    this._currentWmsTiles = [];
    this._uomTileMasks = new Map();
    this._uomMaskSupported = typeof wx !== "undefined" && typeof wx.createOffscreenCanvas === "function";
    this._suggestTimer = null;
    this._selectedAvatarSource = DEFAULT_AVATAR_PATH;
    this._selectedAvatarFileName = "";
    this._avatarChanged = false;
    this._activeMarkersRequest = null;
    this._lastNearbyFetch = null;
    this._nearbyMarkers = [];
    this._searchMarkers = [];
    this.refreshWmsOverlay();
    this.scheduleFetchDji(0);
    this.scheduleFetchMarkers(0, {
      center: this.data.center,
      scale: this.data.scale,
      force: true
    });
    this.updateStatusPanel();
    this.requestInitialLocation();
  },

  normalizeMarkerDetail(raw = {}) {
    const apiBase = this.getApiBase();
    const download = (value) => buildFileDownloadUrl(value, { apiBase });
    const ensureText = (value) => {
      if (typeof value !== "string") return "";
      const trimmed = value.trim();
      return trimmed || "";
    };

    const name =
      ensureText(raw.name) ||
      ensureText(raw.title) ||
      ensureText(raw.location?.text) ||
      "";

    const locationText =
      ensureText(raw.locationText) ||
      ensureText(raw.address) ||
      ensureText(raw.location?.text) ||
      "";

    const images = [];
    const pushImage = (value) => {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach((item) => pushImage(item));
        return;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed) images.push(trimmed);
        return;
      }
      if (typeof value === "object") {
        const candidate =
          value.fileName ||
          value.filename ||
          value.objectName ||
          value.name ||
          value.location ||
          value.path ||
          value.url ||
          value.imageUrl ||
          "";
        if (candidate) pushImage(candidate);
      }
    };

    pushImage(raw.images);
    pushImage(raw.imageUrls);
    pushImage(raw.covers);
    pushImage(raw.coverImage);
    pushImage(raw.cover);

    const firstImage = images.length ? images[0] : "";
    const imageUrl = firstImage ? download(firstImage) : "";

    return {
      id: raw.id || "",
      name,
      locationText,
      imageUrl,
      raw
    };
  },

  findMarkerById(markerId) {
    if (markerId === undefined || markerId === null) return null;
    const markerIdStr = `${markerId}`;
    const nearby = Array.isArray(this._nearbyMarkers) ? this._nearbyMarkers : [];
    const search = Array.isArray(this._searchMarkers) ? this._searchMarkers : [];
    const combined = nearby.concat(search);
    for (const marker of combined) {
      if ((marker?.id || marker?.id === 0) && `${marker.id}` === markerIdStr) {
        return marker;
      }
    }
    return null;
  },

  openMarkerDetail(marker) {
    if (!marker) return;
    const detail =
      (marker.extData && marker.extData.detail) ||
      (marker.extData && marker.extData.raw && this.normalizeMarkerDetail(marker.extData.raw)) ||
      this.normalizeMarkerDetail(marker);
    this.setData({
      showMarkerDetail: true,
      activeMarkerDetail: detail
    });
  },

  closeMarkerDetail() {
    this.setData({ showMarkerDetail: false, activeMarkerDetail: null });
  },

  onMarkerTap(event) {
    const markerId = event?.detail?.markerId;
    const marker = this.findMarkerById(markerId);
    if (marker) {
      this.openMarkerDetail(marker);
    }
  },

  onMarkerCalloutTap(event) {
    const markerId = event?.detail?.markerId;
    const marker = this.findMarkerById(markerId);
    if (marker) {
      this.openMarkerDetail(marker);
    }
  },

  onMarkerDetailTouchStart(event) {
    const touch = event?.touches && event.touches[0];
    this._markerDetailTouchStartY = Number.isFinite(touch?.clientY)
      ? touch.clientY
      : null;
    this._markerDetailTriggered = false;
  },

  onMarkerDetailTouchMove(event) {
    if (this._markerDetailTriggered) return;
    if (this._markerDetailTouchStartY === null || this._markerDetailTouchStartY === undefined) {
      return;
    }
    const touch = event?.touches && event.touches[0];
    if (!touch || !Number.isFinite(touch.clientY)) return;
    const deltaY = this._markerDetailTouchStartY - touch.clientY;
    if (deltaY > 40) {
      this._markerDetailTriggered = true;
      this._markerDetailTouchStartY = null;
      this.openMarkerDetailPage();
    }
  },

  onMarkerDetailTouchEnd() {
    this._markerDetailTouchStartY = null;
    this._markerDetailTriggered = false;
  },

  openMarkerDetailPage() {
    const detail = this.data.activeMarkerDetail;
    if (!detail) return;
    this.showPlaceholderToast("详情页面开发中");
  },

  applyCustomMapStyle() {
    const styleId = this.data.customMapStyleId;
    if (!styleId) {
      return;
    }
    if (typeof wx !== "undefined" && typeof wx.setMapCustomStyle === "function") {
      wx.setMapCustomStyle({ styleId });
      return;
    }
    if (this.mapCtx && typeof this.mapCtx.setCustomMapStyle === "function") {
      this.mapCtx.setCustomMapStyle({ styleId });
    }
  },

  onShow() {
    if (this.data.activeTab !== "home") {
      this.setData({ activeTab: "home" ,showDashboardPanel: true});
      this.showDashboardPanel = true;
    }
  },

  onUnload() {
    if (this._fetchTimer) clearTimeout(this._fetchTimer);
    if (this._markersFetchTimer) clearTimeout(this._markersFetchTimer);
    this._activeMarkersRequest = null;
    this.clearMapOverlays();
  },

  onKeywordInput(e) {
    const keyword = e.detail.value || "";
    this.setData({ keyword }, () => {
      if (!keyword.trim()) {
        if (this._suggestTimer) {
          clearTimeout(this._suggestTimer);
          this._suggestTimer = null;
        }
        this.setData({
          searchSuggestions: [],
          searchSuggestLoading: false,
          searchSuggestError: ""
        });
        return;
      }
      this.setData({
        searchSuggestLoading: true,
        searchSuggestError: "",
        searchSuggestions: []
      });
      this.scheduleSearchSuggest();
    });
  },

  onSearchConfirm() {
    this.performSearch();
  },

  onSearchTap() {
    this.performSearch();
  },

  toggleDashboardPanel() {
    this.setData({ showDashboardPanel: !this.data.showDashboardPanel });
  },

  onChatButtonTap() {
    this.showPlaceholderToast("聊天功能开发中");
  },

  onMenuHomeTap() {
    if (this.data.activeTab !== "home") {
      this.setData({ activeTab: "home"});
    }
    this.showPlaceholderToast("已在首页");
  },

  onMenuProfileTap() {
    if (this.data.activeTab !== "profile") {
      this.setData({ activeTab: "profile" });
    }
    this.ensureProfileAuthenticated()
      .then(() => {
        if (this.data.showDashboardPanel) {
          this.setData({ showDashboardPanel: false });
        }
        if (typeof wx.navigateTo === "function") {
          wx.navigateTo({ url: "/pages/profile/profile" });
        }
      })
      .catch((err) => {
        this.setData({ activeTab: "home" });
        if (err && err.message === "user-cancel") {
          return;
        }
        if (err && err.message === "login-unavailable") {
          this.showPlaceholderToast("暂时无法打开我的页面");
        }
      });
  },

  onMarkerButtonTap() {
    if (this.hasAccessToken()) {
      this.showPlaceholderToast("标记功能开发中");
      return;
    }
    const showLoading = typeof wx.showLoading === "function";
    const hideLoading = typeof wx.hideLoading === "function" ? () => wx.hideLoading() : () => {};
    const ensureProfile = this.hasProfileInfo() ? Promise.resolve(this.loadStoredProfile()) : this.openProfileFill();
    ensureProfile
      .then((profile) => {
        if (showLoading) wx.showLoading({ title: "授权中...", mask: true });
        return this.ensureAccessToken({ profileOverride: profile || {} })
          .then(() => {
            hideLoading();
            this.showPlaceholderToast("标记功能开发中");
          })
          .catch((err) => {
            hideLoading();
            throw err;
          });
      })
      .catch((err) => {
        if (err && err.message === "user-cancel") {
          wx.showToast({ title: "已取消", icon: "none" });
          return;
        }
        console.warn("登录失败", err);
        if (typeof wx.showToast === "function") {
          wx.showToast({ title: "登录失败，请稍后再试", icon: "none" });
        }
      });
  },

  showPlaceholderToast(message) {
    console.log(`[placeholder] ${message}`);
    if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
      wx.showToast({ title: message, icon: "none" });
    }
  },

  applyNearbyMarkers(markers) {
    this._nearbyMarkers = Array.isArray(markers) ? markers : [];
    this.syncAllMarkers();
  },

  applySearchMarkers(markers) {
    this._searchMarkers = Array.isArray(markers) ? markers : [];
    this.syncAllMarkers();
  },

  syncAllMarkers() {
    const nearby = Array.isArray(this._nearbyMarkers) ? this._nearbyMarkers : [];
    const search = Array.isArray(this._searchMarkers) ? this._searchMarkers : [];
    const combined = nearby.concat(search);
    this.setData({ markers: combined });
  },

  performSearch() {
    const keyword = this.data.keyword.trim();
    if (!keyword) return;
    wx.showLoading({ title: "Searching...", mask: true });
    const centerWgs = gcj02ToWgs84(
      this.data.center.longitude,
      this.data.center.latitude
    );
    searchPlaces(keyword, {
      latitude: centerWgs.lat,
      longitude: centerWgs.lng
    })
      .then((results) => {
        const markers = results.map((poi, index) => {
          const marker = {
            id: index + 1,
            latitude: Number(poi.location?.lat),
            longitude: Number(poi.location?.lng),
            title: poi.title,
            width: 24,
            height: 24
          };
          if (poi.address) {
            marker.callout = {
              content: `${poi.title}\n${poi.address}`,
              display: "ALWAYS",
              borderRadius: 4,
              padding: 4
            };
          }
          marker.extData = Object.assign({}, marker.extData, {
            source: "search",
            detail: this.normalizeMarkerDetail({
              id: marker.id,
              name: poi.title,
              title: poi.title,
              address: poi.address,
              location: { text: poi.address }
            })
          });
          return marker;
        });
        if (markers.length) {
          this.applySearchMarkers(markers);
          const points = markers.map((m) => ({
            latitude: m.latitude,
            longitude: m.longitude
          }));
          this.mapCtx.includePoints({
            points,
            padding: [60, 60, 60, 60]
          });
        } else {
          this.applySearchMarkers([]);
        }
      })
      .catch((err) => {
        console.error("Search failed", err);
        wx.showToast({
          title: "Search failed, check QQMAP_KEY",
          icon: "none"
        });
      })
      .finally(() => {
        wx.hideLoading();
        this.setData({
          searchSuggestions: [],
          searchSuggestLoading: false,
          searchSuggestError: ""
        });
      });
  },

  scheduleSearchSuggest() {
    if (this._suggestTimer) clearTimeout(this._suggestTimer);
    this._suggestTimer = setTimeout(() => {
      this._suggestTimer = null;
      this.fetchSearchSuggestions();
    }, 250);
  },

  fetchSearchSuggestions() {
    const keyword = this.data.keyword.trim();
    if (!keyword) {
      this.setData({
        searchSuggestions: [],
        searchSuggestLoading: false,
        searchSuggestError: ""
      });
      return;
    }
    const centerWgs = gcj02ToWgs84(
      this.data.center.longitude,
      this.data.center.latitude
    );
    const snapshot = keyword;
    searchPlaces(keyword, {
      latitude: centerWgs.lat,
      longitude: centerWgs.lng
    })
      .then((results) => {
        if (snapshot !== this.data.keyword.trim()) return;
        const suggestions = (results || [])
          .slice(0, 10)
          .map((poi, index) => {
            const lat = Number(poi.location?.lat);
            const lng = Number(poi.location?.lng);
            return {
              id: poi.id || poi.adcode || index,
              title: poi.title || "",
              address: poi.address || poi.category || "",
              latitude: lat,
              longitude: lng
            };
          })
          .filter(
            (item) =>
              item.title &&
              Number.isFinite(item.latitude) &&
              Number.isFinite(item.longitude)
          );
        this.setData({
          searchSuggestions: suggestions,
          searchSuggestLoading: false,
          searchSuggestError: suggestions.length ? "" : "没有匹配的地点"
        });
      })
      .catch((err) => {
        console.warn("Suggest failed", err);
        if (snapshot !== this.data.keyword.trim()) return;
        this.setData({
          searchSuggestions: [],
          searchSuggestLoading: false,
          searchSuggestError: "提示获取失败，请稍后重试"
        });
      });
  },

  onSuggestionTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const suggestion = this.data.searchSuggestions?.[idx];
    if (!suggestion) return;
    const { latitude, longitude } = suggestion;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    const marker = {
      id: Date.now(),
      latitude,
      longitude,
      title: suggestion.title,
      width: 24,
      height: 24
    };
    if (suggestion.address) {
      marker.callout = {
        content: `${suggestion.title}\n${suggestion.address}`,
        display: "ALWAYS",
        borderRadius: 4,
        padding: 4
      };
    }
    this.setData({
      keyword: suggestion.title,
      searchSuggestions: [],
      searchSuggestLoading: false,
      searchSuggestError: ""
    });
    this.applySearchMarkers([marker]);
    this.centerOnPoint({ latitude, longitude }, 15);
  },

  openDronePicker() {
    this.setData({
      dronePickerVisible: true,
      pendingDroneIndex: this.data.selectedDroneIndex
    });
  },

  closeDronePicker() {
    this.setData({
      dronePickerVisible: false,
      pendingDroneIndex: null
    });
  },

  onSelectDroneOption(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (!Number.isFinite(idx)) return;
    this.setData({ pendingDroneIndex: idx });
  },

  confirmDronePicker() {
    const idx = this.data.pendingDroneIndex;
    if (typeof idx === "number" && idx >= 0) {
      this.applyDroneByIndex(idx);
    }
    this.closeDronePicker();
  },

  applyDroneByIndex(idx) {
    const bounded = Math.max(0, Math.min(DRONES.length - 1, idx));
    const drone = DRONES[bounded] || DRONES[0];
    this.setData({
      selectedDroneIndex: bounded,
      selectedDrone: drone.slug,
      selectedDroneName: drone.name
    });
    this.scheduleFetchDji(200, true);
  },

  onLocateTap() {
    this.ensureLocationPermission()
      .then(() => this.pullAndCenterLocation())
      .catch(() => {
        wx.showToast({ title: "未授权定位权限", icon: "none" });
      });
  },

  requestInitialLocation() {
    this.ensureLocationPermission()
      .then(() => this.pullAndCenterLocation({ silent: true }))
      .catch(() => {
        // 用户拒绝初始授权时不打扰，仍可手动定位
      });
  },

  pullAndCenterLocation(options = {}) {
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: true,
      highAccuracyExpireTime: 8000,
      success: (res) => {
        const targetScale = clampMapScale(options.scale || this.data.scale);
        this.centerOnPoint(
          { latitude: res.latitude, longitude: res.longitude },
          targetScale,
          !!options.silent
        );
      },
      fail: (err) => {
        console.warn("getLocation fail", err);
        wx.showToast({ title: "定位失败，请在设置中开启定位权限", icon: "none" });
      }
    });
  },

  getApiBase() {
    const app = getApp ? getApp() : null;
    return (app && app.globalData && app.globalData.apiBase) || "";
  },

  getAuthToken() {
    const app = getApp ? getApp() : null;
    return (app && app.globalData && app.globalData.token) || "";
  },

  ensureProfileAuthenticated() {
    if (this.hasAccessToken()) {
      return Promise.resolve(this.loadStoredProfile());
    }
    const ensureProfile = this.hasProfileInfo()
      ? Promise.resolve(this.loadStoredProfile())
      : this.openProfileFill();
    const showLoading = typeof wx.showLoading === "function";
    const hideLoading = typeof wx.hideLoading === "function" ? () => wx.hideLoading() : () => {};
    return ensureProfile.then((profile) => {
      if (showLoading) wx.showLoading({ title: "授权中...", mask: true });
      return this.ensureAccessToken({ profileOverride: profile || {} })
        .then(() => {
          hideLoading();
          return profile;
        })
        .catch((err) => {
          hideLoading();
          throw err;
        });
    });
  },

  extractAvatarFileName(value) {
    return extractAvatarFileNameUtil(value);
  },

  buildAvatarDownloadUrl(value) {
    return buildAvatarDownloadUrlUtil(value, { apiBase: this.getApiBase() });
  },

  hasAccessToken() {
    const app = getApp ? getApp() : null;
    if (app && app.globalData && app.globalData.token) {
      return true;
    }
    try {
      const token = wx.getStorageSync(ACCESS_TOKEN_STORAGE_KEY);
      if (token && typeof token === "string") {
        if (app && app.globalData) app.globalData.token = token;
        return true;
      }
    } catch (err) {
      console.warn("读取 accessToken 失败", err);
    }
    return false;
  },

  loadStoredProfile() {
    return loadStoredProfileUtil();
  },

  hasProfileInfo() {
    return hasStoredProfileUtil();
  },

  openPermissionChecklist(options = {}) {
    const { includeProfile = false, resolve, reject } = options;
    this._pendingLocationPermission = {
      resolve,
      reject,
      includeProfile: !!includeProfile
    };
    this.setData({
      showPermissionChecklistPanel: true,
      permissionChecklistLoading: false
    });
  },

  closePermissionChecklist(success) {
    if (this._pendingLocationPermission && success && typeof this._pendingLocationPermission.resolve === "function") {
      this._pendingLocationPermission.resolve();
    } else if (this._pendingLocationPermission && !success && typeof this._pendingLocationPermission.reject === "function") {
      this._pendingLocationPermission.reject(new Error("user-cancel"));
    }
    this._pendingLocationPermission = null;
    this.setData({
      showPermissionChecklistPanel: false,
      permissionChecklistLoading: false
    });
  },

  centerOnPoint(point, scale = DEFAULT_MAP_SCALE, silent = false) {
    if (!point) return;
    this._suppressRegionOnce = true;
    this._centerOverride = point;
    const targetScale = clampMapScale(scale);
    this.setData(
      {
        center: point,
        scale: targetScale
      },
      () => {
        this._currentBounds = null;
        this.refreshWmsOverlay(this.data.center, this.data.scale, this._lastRegion);
        this.scheduleFetchMarkers(silent ? 300 : 0, {
          center: point,
          region: this._lastRegion,
          scale: targetScale,
          force: true
        });
        this.scheduleFetchDji(silent ? 300 : 0, true);
        this.updateStatusPanel(this._lastAreas);
      }
    );
  },

  ensureLocationPermission() {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (res) => {
          const granted = !!(res.authSetting && res.authSetting["scope.userLocation"]);
          if (granted) {
            resolve();
            return;
          }
          const needsProfile = !this.hasProfileInfo();
          this.openPermissionChecklist({
            includeProfile: needsProfile,
            resolve,
            reject
          });
        },
        fail: reject
      });
    });
  },

  authorizeLocation() {
    return new Promise((resolve, reject) => {
      wx.authorize({
        scope: "scope.userLocation",
        success: () => resolve(),
        fail: () => {
          wx.openSetting({
            success: (st) => {
              const granted = !!(st.authSetting && st.authSetting["scope.userLocation"]);
              if (granted) resolve();
              else reject(new Error("permission-denied"));
            },
            fail: (err) => reject(err)
          });
        }
      });
    });
  },

  ensureAccessToken(options = {}) {
    if (this.hasAccessToken()) return Promise.resolve();
    if (this._ensureLoginPromise) return this._ensureLoginPromise;
    const app = getApp ? getApp() : null;
    if (!app || typeof app.loginWithProfile !== "function") {
      return Promise.reject(new Error("login-unavailable"));
    }
    const override = options && options.profileOverride;
    const profile = override || this.loadStoredProfile() || {};
    this._ensureLoginPromise = app.loginWithProfile(profile)
      .catch((err) => {
        throw err || new Error("login-failed");
      })
      .finally(() => {
        this._ensureLoginPromise = null;
      });
    return this._ensureLoginPromise;
  },

  onPermissionChecklistCancel() {
    if (this.data.permissionChecklistLoading) return;
    this.closePermissionChecklist(false);
  },

  openProfileFill() {
    const existing = this.loadStoredProfile();
    const nickname = existing?.nickname || "";
    const avatarFileName = existing?.avatarUrl || "";
    this._selectedAvatarFileName = avatarFileName || "";
    this._avatarChanged = false;
    const preview = avatarFileName ? this.buildAvatarDownloadUrl(avatarFileName) : DEFAULT_AVATAR_PATH;
    this._selectedAvatarSource = preview;
    return new Promise((resolve, reject) => {
      this._profileFillResolve = resolve;
      this._profileFillReject = reject;
      this.setData({
        showProfileFill: true,
        tempNickname: nickname,
        tempAvatarUrl: preview
      });
    });
  },

  onProfileFillCancel() {
    const rej = this._profileFillReject;
    this._profileFillResolve = null;
    this._profileFillReject = null;
    this._avatarChanged = false;
    this._selectedAvatarSource = DEFAULT_AVATAR_PATH;
    this._selectedAvatarFileName = "";
    this.setData({
      showProfileFill: false,
      tempNickname: "",
      tempAvatarUrl: DEFAULT_AVATAR_PATH
    });
    if (typeof rej === "function") rej(new Error("user-cancel"));
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail || {};
    if (avatarUrl) {
      this._selectedAvatarSource = avatarUrl;
      this._avatarChanged = true;
      this.setData({ tempAvatarUrl: avatarUrl });
    }
  },

  onNicknameInput(e) {
    this.setData({ tempNickname: (e.detail && e.detail.value) || "" });
  },

  prepareAvatarForUpload(src) {
    return prepareAvatarForUploadUtil(src);
  },

  uploadAvatarFile(filePath) {
    return uploadAvatarFileUtil(filePath, {
      apiBase: this.getApiBase()
    });
  },

  onProfileFillSubmit(e) {
    const nickname = ((e.detail && e.detail.value && e.detail.value.nickname) || this.data.tempNickname || "").trim();
    if (!nickname) {
      wx.showToast({ title: "请填写昵称", icon: "none" });
      return;
    }
    const hasExistingFile = !!this._selectedAvatarFileName;
    const source = this._selectedAvatarSource || DEFAULT_AVATAR_PATH;
    const needsUpload = this._avatarChanged || !hasExistingFile;
    const app = getApp ? getApp() : null;

    const persistProfile = (avatarFileName) => {
      const rawValue = typeof avatarFileName === "string" ? avatarFileName.trim() : avatarFileName;
      const normalized =
        (typeof rawValue === "string" && /^https?:\/\//.test(rawValue))
          ? rawValue
          : this.extractAvatarFileName(rawValue) || (typeof rawValue === "string" ? rawValue : "");
      persistProfileLocallyUtil({
        nickname,
        avatarUrl: normalized
      });
      this._selectedAvatarFileName = normalized;
      this._selectedAvatarSource = this.buildAvatarDownloadUrl(normalized);
      this._avatarChanged = false;
      return {
        nickname,
        avatarUrl: normalized
      };
    };

    const finish = (profile) => {
      const resolve = this._profileFillResolve;
      this._profileFillResolve = null;
      this._profileFillReject = null;
      this.setData({
        showProfileFill: false,
        tempNickname: profile.nickname,
        tempAvatarUrl: this.buildAvatarDownloadUrl(profile.avatarUrl)
      });
      if (typeof resolve === "function") resolve(profile);
    };

    const showLoading = typeof wx.showLoading === "function";
    const hideLoading = typeof wx.hideLoading === "function"
      ? () => wx.hideLoading()
      : () => {};

    const handleFailure = (err) => {
      hideLoading();
      console.warn("保存头像昵称失败", err);
      wx.showToast({ title: "保存失败，请稍后再试", icon: "none" });
      const rejecter = this._profileFillReject;
      this._profileFillResolve = null;
      this._profileFillReject = null;
      this._selectedAvatarSource = DEFAULT_AVATAR_PATH;
      this._selectedAvatarFileName = "";
      this._avatarChanged = false;
      this.setData({
        showProfileFill: false,
        tempNickname: nickname,
        tempAvatarUrl: DEFAULT_AVATAR_PATH
      });
      if (typeof rejecter === "function") rejecter(err || new Error("profile-save-failed"));
    };

    if (showLoading) wx.showLoading({ title: "保存中...", mask: true });

    if (!needsUpload && this._selectedAvatarFileName) {
      const profile = persistProfile(this._selectedAvatarFileName);
      hideLoading();
      finish(profile);
      return;
    }

    this.prepareAvatarForUpload(source)
      .then((filePath) => this.uploadAvatarFile(filePath))
      .then((fileName) => {
        const profile = persistProfile(fileName);
        hideLoading();
        finish(profile);
      })
      .catch((err) => {
        handleFailure(err);
      });
  },

  onPermissionChecklistConfirm() {
    const pending = this._pendingLocationPermission;
    if (!pending || this.data.permissionChecklistLoading) return;
    this.setData({ permissionChecklistLoading: true });
    const needProfile = !!pending.includeProfile && !this.hasProfileInfo();
    const ensureProfile = needProfile ? this.openProfileFill() : Promise.resolve(this.loadStoredProfile());
    ensureProfile
      .then((profile) => this.ensureAccessToken({ profileOverride: profile }))
      .then(() => this.authorizeLocation().catch((err) => {
        const wrapped = err || new Error("location-failed");
        wrapped._source = "location";
        throw wrapped;
      }))
      .then(() => {
        this.closePermissionChecklist(true);
      })
      .catch((err) => {
        if (err && err.message === "user-cancel") {
          wx.showToast({ title: "已取消", icon: "none" });
        } else if (err && err._source === "location" && err.message === "permission-denied") {
          wx.showToast({ title: "开启定位权限后才能继续", icon: "none" });
        } else {
          console.warn("权限流程失败", err);
          wx.showToast({ title: "操作失败，请稍后再试", icon: "none" });
        }
        this.setData({ permissionChecklistLoading: false });
      });
  },

  onRegionChange(e) {
    if (e.type === "begin") {
      if (this._fetchTimer) clearTimeout(this._fetchTimer);
      if (this._markersFetchTimer) clearTimeout(this._markersFetchTimer);
      this._currentBounds = null;
      return;
    }
    if (e.type === "end") {
      if (this._suppressRegionOnce) {
        this._suppressRegionOnce = false;
        return;
      }
      // 使用事件内的中心与范围，仅用于刷新覆盖物，避免 setData 改 center 造成回环抖动
      const region = e.detail && (e.detail.region || {
        northeast: e.detail.northeast,
        southwest: e.detail.southwest
      });
      const cl = e.detail && (e.detail.centerLocation || null);
      if (region && region.northeast && region.southwest && cl) {
        const newCenter = { latitude: cl.latitude, longitude: cl.longitude };
        this._centerOverride = newCenter;
        const prevScale = this.data.scale;
        const scale = clampMapScale(e.detail.scale || prevScale);
        const scaleChanged = scale !== prevScale;
        console.log("[map] regionchange scale", scale);
        this._lastRegion = region;
        const radius = this.computeRadius({ region });
        this._currentRadius = clampRadius(radius);
        this._currentBounds = this.buildBoundsRect(region, newCenter, this._currentRadius);
        const diffLat = Math.abs((this.data.center?.latitude || 0) - newCenter.latitude);
        const diffLng = Math.abs((this.data.center?.longitude || 0) - newCenter.longitude);
        const shouldSync = diffLat > 1e-5 || diffLng > 1e-5 || scale !== this.data.scale;
        const run = (forceRefresh) => {
          this.refreshWmsOverlay(newCenter, scale, region);
          this.requestDjiZones(forceRefresh, newCenter, region, scale);
          this.scheduleFetchMarkers(forceRefresh ? 0 : 200, {
            center: newCenter,
            region,
            scale,
            force: !!forceRefresh
          });
          this.updateStatusPanel(this._lastAreas);
        };
        if (shouldSync) {
          this._suppressRegionOnce = true;
          this.setData({ center: newCenter, scale }, () => run(scaleChanged));
        } else {
          run(scaleChanged);
        }
        return;
      }
      // 兜底：取中心再刷新（少量机型可能无 centerLocation）
      this.updateCenterAndRadius(e.detail);
    }
  },

  onMapUpdated() { },

  updateCenterAndRadius(detail) {
    this.mapCtx.getCenterLocation({
      type: "gcj02",
      success: (res) => {
        const newCenter = {
          latitude: res.latitude,
          longitude: res.longitude
        };
        this._centerOverride = newCenter;
        const scale = clampMapScale(detail?.scale || this.data.scale);
        // cache region for WMS tiling
        this._lastRegion = detail?.region || null;
        const diffLat = Math.abs((this.data.center?.latitude || 0) - newCenter.latitude);
        const diffLng = Math.abs((this.data.center?.longitude || 0) - newCenter.longitude);
        const needSync = diffLat > 1e-5 || diffLng > 1e-5 || scale !== this.data.scale;
        const run = () => {
          const radius = this.computeRadius(detail);
          this._currentRadius = clampRadius(radius);
          this._currentBounds = this.buildBoundsRect(
            detail?.region,
            newCenter,
            this._currentRadius
          );
          this.refreshWmsOverlay(newCenter, scale, detail?.region);
          this.scheduleFetchMarkers(0, {
            center: newCenter,
            region: detail?.region,
            scale,
            force: true
          });
          this.scheduleFetchDji(300);
        };
        const afterUpdate = () => {
          run();
          this.updateStatusPanel(this._lastAreas);
        };
        if (needSync) {
          this._suppressRegionOnce = true;
          this.setData({ center: newCenter, scale }, afterUpdate);
        } else {
          afterUpdate();
        }
      }
    });
  },

  computeRadius(detail) {
    if (detail?.region) {
      const { northeast, southwest } = detail.region;
      if (northeast && southwest) {
        const diag = haversineMeters(
          northeast.latitude,
          northeast.longitude,
          southwest.latitude,
          southwest.longitude
        );
        return Math.max(MIN_FETCH_RADIUS, Math.min(MAX_FETCH_RADIUS, diag / 2));
      }
    }
    return clampRadius(DEFAULT_FETCH_RADIUS);
  },

  computeMarkerRadiusKm(context = {}) {
    const region = context?.region;
    if (region?.northeast && region?.southwest) {
      const { northeast, southwest } = region;
      const diag = haversineMeters(
        northeast.latitude,
        northeast.longitude,
        southwest.latitude,
        southwest.longitude
      );
      if (Number.isFinite(diag) && diag > 0) {
        const radiusKm = Math.max(0.1, diag / 2000);
        return Math.min(radiusKm, 200);
      }
    }
    const scale = clampMapScale(context?.scale || this.data.scale);
    const zoomFactor = Math.pow(2, Math.max(0, (18 - scale) / 1.3));
    return Math.max(0.1, Math.min(200, zoomFactor * 0.8));
  },

  scheduleFetchMarkers(delay = 0, options = {}) {
    if (this._markersFetchTimer) clearTimeout(this._markersFetchTimer);
    const ms = Math.max(0, Number(delay) || 0);
    this._markersFetchTimer = setTimeout(() => {
      this._markersFetchTimer = null;
      this.requestNearbyMarkers(options);
    }, ms);
  },

  scheduleFetchDji(delay = 300, force = false) {
    if (this._fetchTimer) clearTimeout(this._fetchTimer);
    this._fetchTimer = setTimeout(() => {
      this._fetchTimer = null;
      this.requestDjiZones(force);
    }, delay);
  },

  requestNearbyMarkers(options = {}) {
    const center = options?.center || this._centerOverride || this.data.center;
    if (!center) return;
    const scale = options?.scale || this.data.scale;
    const region = options?.region || this._lastRegion;
    const radiusKm = this.computeMarkerRadiusKm({ region, scale });
    if (!Number.isFinite(radiusKm) || radiusKm <= 0) return;

    const wgs = gcj02ToWgs84(center.longitude, center.latitude);
    const latitude = Number.isFinite(wgs?.lat) ? wgs.lat : Number(center.latitude);
    const longitude = Number.isFinite(wgs?.lng) ? wgs.lng : Number(center.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

    const prev = this._lastNearbyFetch || {};
    const moveMeters = haversineMeters(
      center.latitude,
      center.longitude,
      prev.latitude || 0,
      prev.longitude || 0
    );
    const radiusDiff = Math.abs((prev.radiusKm || 0) - radiusKm);
    const now = Date.now();
    const prevTimestamp = Number(prev.timestamp) || 0;
    const isStale = !prevTimestamp || now - prevTimestamp > 60000;
    if (!options.force && moveMeters < 50 && radiusDiff < 0.2 && !isStale) {
      return;
    }

    const requestId = now;
    this._activeMarkersRequest = requestId;

    fetchNearbyMarkers(
      {
        latitude,
        longitude,
        radiusInKilometers: radiusKm
      },
      {
        apiBase: this.getApiBase(),
        token: this.getAuthToken()
      }
    )
      .then((items = []) => {
        if (this._activeMarkersRequest !== requestId) return;
        const markerList = (Array.isArray(items) ? items : [])
          .map((item, index) => {
            const latValue = Number(
              item?.location?.latitude ??
                item?.location?.lat ??
                item?.latitude ??
                item?.lat
            );
            const lngValue = Number(
              item?.location?.longitude ??
                item?.location?.lng ??
                item?.longitude ??
                item?.lng
            );
            if (!Number.isFinite(latValue) || !Number.isFinite(lngValue)) return null;
            const gcj = wgs84ToGcj02(lngValue, latValue);
            const latitudeGcj = Number.isFinite(gcj?.lat) ? gcj.lat : latValue;
            const longitudeGcj = Number.isFinite(gcj?.lng) ? gcj.lng : lngValue;
            const name =
              (typeof item?.name === "string" && item.name) ||
              (typeof item?.title === "string" && item.title) ||
              (typeof item?.location?.text === "string" && item.location.text) ||
              "";
            const locationText =
              (typeof item?.location?.text === "string" && item.location.text) ||
              (typeof item?.address === "string" && item.address) ||
              (typeof item?.locationText === "string" && item.locationText) ||
              "";
            console.log("name,", name);
            const marker = {
              id: item?.id || `nearby-${index}`,
              latitude: latitudeGcj,
              longitude: longitudeGcj,
              title: name,
              iconPath: "/assets/drone.png",
              width: 22,
              height: 22
            };
            const calloutContent = formatNearbyMarkerLabel(name);
            if (calloutContent) {
              marker.callout = {
                content: calloutContent,
                color: "rgba(0, 0, 0, 0.95)",
                fontSize: 14,
                fontWeight: "bold",
                display: "ALWAYS",
                borderRadius: 4,
                padding: 4,
                // bgColor: "rgba(255, 255, 255, 0)"
              };
            }
            marker.extData = Object.assign({}, marker.extData, {
              source: "nearby",
              raw: item,
              detail: this.normalizeMarkerDetail(item)
            });
            return marker;
          })
          .filter(Boolean);
        this.applyNearbyMarkers(markerList);
        this._lastNearbyFetch = {
          latitude: center.latitude,
          longitude: center.longitude,
          radiusKm,
          scale: clampMapScale(scale),
          timestamp: now
        };
      })
      .catch((err) => {
        console.warn("Fetch nearby markers failed", err);
      })
      .finally(() => {
        if (this._activeMarkersRequest === requestId) {
          this._activeMarkersRequest = null;
        }
      });
  },

  requestDjiZones(force, centerOverride, regionOverride, scaleOverride) {
    const center = centerOverride || this.data.center;
    const radius = this._currentRadius || clampRadius(DEFAULT_FETCH_RADIUS);
    const prev = this._lastFetch || {};
    const moved =
      haversineMeters(
        center.latitude,
        center.longitude,
        prev.latitude || 0,
        prev.longitude || 0
      ) > 300;
    const radiusDiff = Math.abs((prev.radius || 0) - radius) > 500;
    const gcjRect = regionOverride
      ? this.buildBoundsRect(regionOverride, center, radius)
      : this.currentGcjRect();
    const rectChanged = prev.rect
      ? (
        Math.abs((gcjRect.ltlng || 0) - (prev.rect.ltlng || 0)) > 0.005 ||
        Math.abs((gcjRect.ltlat || 0) - (prev.rect.ltlat || 0)) > 0.005 ||
        Math.abs((gcjRect.rblng || 0) - (prev.rect.rblng || 0)) > 0.005 ||
        Math.abs((gcjRect.rblat || 0) - (prev.rect.rblat || 0)) > 0.005
      )
      : true;
    if (!force && !moved && !radiusDiff && !rectChanged) return;

    this.setData({ loadingDji: true, djiMsg: "" });
    if (!gcjRect) {
      this.setData({
        loadingDji: false,
        djiMsg: "正在获取地图范围，请稍后再试"
      });
      return;
    }
    const rect = this.gcjRectToWgs(gcjRect);
    if (!rect) {
      this.setData({
        loadingDji: false,
        djiMsg: "坐标转换失败，稍后重试"
      });
      return;
    }
    fetchDjiAreas({
      rect,
      levels: this.levelsParam(),
      drone: this.data.selectedDrone
    })
      .then((areas) => {
        console.log("areas",areas);
        const graphics = buildAreaGraphics(areas);
        this._lastAreas = areas;
        this.updateStatusPanel(areas);
        this.setData({
          polygons: graphics.polygons,
          circles: graphics.circles,
          djiMsg: `已获取 ${areas.length} 个空域`
        });
        this._lastFetch = {
          latitude: center.latitude,
          longitude: center.longitude,
          radius,
          rect: gcjRect
        };
      })
      .catch((err) => {
        console.error("DJI geo fetch failed", err);
        this._lastAreas = null;
        this.updateStatusPanel(null);
        this.setData({
          djiMsg: "DJI 数据暂不可用"
        });
      })
      .finally(() => {
        this.setData({ loadingDji: false });
      });
  },

  updateStatusPanel(areas) {
    const resolved = typeof areas === "undefined" ? this._lastAreas : areas;
    const dji = this.describeDjiStatus(resolved);
    const uom = this.describeUomStatus();
    this.setData({
      djiStatus: dji.status,
      djiStatusExtra: dji.extra,
      djiTone: dji.tone,
      uomStatus: uom.status,
      uomTone: uom.tone
    });
  },

  describeDjiStatus(areas) {
    const fallback = { status: "暂无空域数据", extra: "", tone: "neutral" };
    if (typeof areas === "undefined") {
      return { status: "评估中", extra: "", tone: "neutral" };
    }
    if (areas === null) {
      return { status: "空域数据加载失败", extra: "", tone: "warn" };
    }
    if (!Array.isArray(areas) || !areas.length) {
      return { status: "不在限制区", extra: "", tone: "safe" };
    }
    const center = this._centerOverride || this.data.center;
    if (!center) return fallback;
    const wgs = gcj02ToWgs84(center.longitude, center.latitude);
    if (!wgs) return fallback;
    const hits = [];
    const pushIfContains = (area, parent) => {
      if (this.areaContainsWgsPoint(area, wgs.lng, wgs.lat)) hits.push({ area, parent });
    };
    areas.forEach((area) => {
      pushIfContains(area, null);
      if (Array.isArray(area.sub_areas)) {
        area.sub_areas.forEach((sub) => pushIfContains(sub, area));
      }
    });
    if (!hits.length) {
      return { status: "不在限制区", extra: "", tone: "safe" };
    }
    hits.sort((a, b) => this.severityRank(a.area) - this.severityRank(b.area));
    const target = hits[0];
    const extraParts = [];
    const areaName = target.area.name || target.area.title || target.parent?.name;
    const city = target.area.city || target.parent?.city;
    if (areaName) extraParts.push(areaName);
    if (city && city !== areaName) extraParts.push(city);
    const height = this.effectiveHeight(target.area, target.parent);
    if (typeof height === "number" && height > 0) {
      extraParts.push(`限高 ${Math.round(height)}m`);
    }
    const reason = target.area.reason || target.area.desc || target.area.description;
    if (reason) extraParts.push(reason);
    return {
      status: this.labelForArea(target.area, target.parent),
      extra: extraParts.join(" · "),
      tone: this.toneForLevel(Number(target.area.level))
    };
  },

  describeUomStatus() {
    const center = this._centerOverride || this.data.center;
    if (!center) {
      return { status: "评估中", tone: "neutral" };
    }
    const tile = this.findUomTileForPoint(center);
    if (!tile) {
      return { status: "非适飞空域", tone: "alert" };
    }
    const maskEntry = this._uomTileMasks?.get(tile.id);
    if (!maskEntry) {
      this.ensureUomMask(tile);
      return { status: "评估中", tone: "neutral" };
    }
    if (maskEntry.status === "pending") {
      return { status: "评估中", tone: "neutral" };
    }
    if (maskEntry.status === "unsupported") {
      const withinBounds = this.pointInBounds(center, tile.bounds);
      return withinBounds
        ? { status: "适飞空域", tone: "safe" }
        : { status: "非适飞空域", tone: "alert" };
    }
    if (maskEntry.status !== "ready" || !maskEntry.data) {
      return { status: "非适飞空域", tone: "alert" };
    }
    const covered = this.pointCoveredByUomMask(center, tile.bounds, maskEntry);
    return covered
      ? { status: "适飞空域", tone: "safe" }
      : { status: "非适飞空域", tone: "alert" };
  },

  pointInBounds(point, bounds) {
    if (!point || !bounds) return false;
    const sw = bounds.southwest || {};
    const ne = bounds.northeast || {};
    const swLat = typeof sw.latitude === "number" ? sw.latitude : -90;
    const neLat = typeof ne.latitude === "number" ? ne.latitude : 90;
    const swLng = typeof sw.longitude === "number" ? sw.longitude : -180;
    const neLng = typeof ne.longitude === "number" ? ne.longitude : 180;
    return (
      point.latitude >= swLat &&
      point.latitude <= neLat &&
      point.longitude >= swLng &&
      point.longitude <= neLng
    );
  },

  toneForLevel(level) {
    if (level === 2 || level === 1) return "alert";
    if (level === 6 || level === 3 || level === 4) return "warn";
    if (level === 7 || level === 10) return "neutral";
    return "safe";
  },

  levelsParam() {
    const cleaned = this.data.levelsInput
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    return cleaned.length ? cleaned.join(",") : DEFAULT_LEVELS_PARAM;
  },

  refreshWmsOverlay(centerOverride, scaleOverride, regionOverride) {
    const center = centerOverride || this.data.center;
    const scale = clampMapScale(scaleOverride || this.data.scale);
    if (scale < WMS_MIN_ZOOM || scale > WMS_MAX_ZOOM) {
      this.clearMapOverlays();
      this._currentWmsTiles = [];
      this.updateStatusPanel(this._lastAreas);
      return;
    }
    const overlays = buildWmsOverlay(
      { longitude: center.longitude, latitude: center.latitude },
      scale,
      regionOverride || this._lastRegion || null
    );
    this._currentWmsTiles = overlays;
    this.updateStatusPanel(this._lastAreas);
    overlays.forEach((tile) => this.ensureUomMask(tile));
    const sig = overlays.map(o => o.id).join('|');
    if (sig === this._wmsSig) {
      return; // tile set unchanged,避免重复 setData 造成闪烁
    }
    this._wmsSig = sig;
    this.applyWmsOverlays(overlays);
  },

  applyWmsOverlays(tiles) {
    if (!this.mapCtx) return;
    const ctx = this.mapCtx;
    const prev = this._wmsOverlayHandles || [];
    prev.forEach((handle) => {
      ctx.removeGroundOverlay({
        id: handle.id,
        fail: () => { }
      });
    });
    this._wmsOverlayHandles = [];
    this._wmsOverlaySeed = this._wmsOverlaySeed || 0;
    tiles.forEach((tile) => {
      this._wmsOverlaySeed += 1;
      const numericId = this._wmsOverlaySeed;
      const alpha = tile.alpha != null ? tile.alpha : (tile.opacity != null ? tile.opacity : 0.65);

      ctx.addGroundOverlay({
        id: numericId,
        src: tile.src,
        bounds: tile.bounds,
        alpha,
        success: () => {
          if (!Array.isArray(this._wmsOverlayHandles)) this._wmsOverlayHandles = [];
          this._wmsOverlayHandles.push({ id: numericId, key: tile.id });
        },
        fail: (err) => {
          console.error('addGroundOverlay failed', tile.id, err);
        }
      });
    });
  },

  clearMapOverlays() {
    if (!this.mapCtx) {
      this._wmsOverlayHandles = [];
      this._currentWmsTiles = [];
      return;
    }
    const handles = this._wmsOverlayHandles || [];
    handles.forEach((handle) => {
      this.mapCtx.removeGroundOverlay({
        id: handle.id,
        fail: () => { }
      });
    });
    this._wmsOverlayHandles = [];
    this._currentWmsTiles = [];
    this.updateStatusPanel(this._lastAreas);
  },

  buildBoundsRect(region, center, radius) {
    if (typeof radius === "number" && Number.isFinite(radius)) {
      return this.circleRectFromCenter(center, radius);
    }
    if (region?.northeast && region?.southwest) {
      const { northeast, southwest } = region;
      return {
        ltlat: northeast.latitude,
        ltlng: southwest.longitude,
        rblat: southwest.latitude,
        rblng: northeast.longitude
      };
    }
    return this.circleRectFromCenter(center, radius);
  },

  circleRectFromCenter(center, radius) {
    if (!center) return null;
    const metersLat = 111320;
    const useRadius = clampRadius(radius || DEFAULT_FETCH_RADIUS);
    const latDelta = useRadius / metersLat;
    const cosLat = Math.cos((center.latitude * Math.PI) / 180);
    const metersLng = metersLat * Math.max(cosLat, 0.01);
    const lngDelta = useRadius / metersLng;
    const clampLat = (lat) => Math.max(-90, Math.min(90, lat));
    const clampLng = (lng) => {
      if (!isFinite(lng)) return 0;
      let val = lng;
      while (val > 180) val -= 360;
      while (val < -180) val += 360;
      return val;
    };
    return {
      ltlat: clampLat(center.latitude + latDelta),
      ltlng: clampLng(center.longitude - lngDelta),
      rblat: clampLat(center.latitude - latDelta),
      rblng: clampLng(center.longitude + lngDelta)
    };
  },

  currentGcjRect() {
    if (this._currentBounds) return this._currentBounds;
    const rect = this.circleRectFromCenter(
      this.data.center || DEFAULT_CENTER,
      this._currentRadius || DEFAULT_FETCH_RADIUS
    );
    this._currentBounds = rect;
    return rect;
  },

  gcjRectToWgs(rect) {
    if (!rect) return null;
    const leftTop = gcj02ToWgs84(rect.ltlng, rect.ltlat);
    const rightBottom = gcj02ToWgs84(rect.rblng, rect.rblat);
    if (!leftTop || !rightBottom) return null;
    return {
      ltlat: leftTop.lat,
      ltlng: leftTop.lng,
      rblat: rightBottom.lat,
      rblng: rightBottom.lng
    };
  },

  labelForArea(area, parent) {
    const height = this.effectiveHeight(area, parent);
    if (typeof height === "number" && height > 0) {
      area.level = 6;
      return "高度限制区";
    }
    const level = Number(area?.level);
    switch (level) {
      case 2: return "禁飞区";
      case 6: return "高度限制区";
      case 1: return "授权飞行区";
      case 4: return "警示区";
      case 3: return "加强警示区";
      case 7: return "监管区";
      case 8: return "适飞区";
      case 10: return "景观区";
      default: return "空域限制";
    }
  },

  severityRank(area) {
    const level = Number(area?.level);
    if (level === 2) return 0;
    if (level === 6) return 1;
    if (level === 1) return 2;
    if (level === 3) return 3;
    if (level === 4) return 4;
    if (level === 7) return 5;
    if (level === 10) return 6;
    if (level === 8) return 7;
    return 100;
  },

  effectiveHeight(area, parent) {
    if (typeof area.height === "number" && area.height > 0) return area.height;
    const fallback = parent && Array.isArray(parent.sub_areas)
      ? parent.sub_areas.find((sa) => this.sameGeometry(area, sa) && typeof sa.height === "number" && sa.height > 0)
      : null;
    return fallback ? fallback.height : null;
  },

  sameGeometry(a, b) {
    if (!a || !b) return false;
    return this.sameCircle(a, b) || this.samePolygon(a, b);
  },

  sameCircle(a, b) {
    const ar = Number(a.radius), br = Number(b.radius);
    if (!isFinite(ar) || !isFinite(br)) return false;
    const ax = Number(a.lng), ay = Number(a.lat);
    const bx = Number(b.lng), by = Number(b.lat);
    if (!isFinite(ax) || !isFinite(ay) || !isFinite(bx) || !isFinite(by)) return false;
    const near = (x, y, eps = 1e-5) => Math.abs(x - y) <= eps;
    return near(ar, br, 1) && near(ax, bx) && near(ay, by);
  },

  samePolygon(a, b) {
    const ap = a.polygon_points || a.points || a.polygon || a.geometry?.coordinates;
    const bp = b.polygon_points || b.points || b.polygon || b.geometry?.coordinates;
    if (!ap || !bp) return false;
    try {
      return JSON.stringify(ap) === JSON.stringify(bp);
    } catch (err) {
      return false;
    }
  },

  areaContainsWgsPoint(area, lng, lat) {
    if (!area) return false;
    if ((area.shape === 0) || (!area.polygon_points && area.radius && area.lat && area.lng)) {
      const dist = haversineMeters(lat, lng, Number(area.lat), Number(area.lng));
      return dist <= Number(area.radius);
    }
    const poly = area.polygon_points || area.points || area.polygon || (area.geometry && area.geometry.coordinates);
    if (!poly) return false;
    if (Array.isArray(poly[0]) && Array.isArray(poly[0][0]) && Array.isArray(poly[0][0][0])) {
      return poly.some((single) => this.ringContains(single[0] ? single[0] : single, lng, lat));
    }
    return this.ringContains(poly[0] ? poly[0] : poly, lng, lat);
  },

  ringContains(ring, lng, lat) {
    if (!Array.isArray(ring) || ring.length === 0) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = Number(ring[i][0]), yi = Number(ring[i][1]);
      const xj = Number(ring[j][0]), yj = Number(ring[j][1]);
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  },

  colorForArea(area) {
    const level = Number(area?.level);
    return NFZ_CENTER_COLORS[level] || "#DE4329";
  },

  findUomTileForPoint(point) {
    if (!point || !Array.isArray(this._currentWmsTiles)) return null;
    for (const tile of this._currentWmsTiles) {
      if (this.pointInBounds(point, tile.bounds)) return tile;
    }
    return null;
  },

  ensureUomMask(tile) {
    if (!tile || !tile.id) return;
    if (!this._uomTileMasks) this._uomTileMasks = new Map();
    const cached = this._uomTileMasks.get(tile.id);
    if (cached && (cached.status === "ready" || cached.status === "pending")) return;
    if (!this._uomMaskSupported) {
      this._uomTileMasks.set(tile.id, { status: "unsupported" });
      return;
    }
    try {
      const canvas = wx.createOffscreenCanvas({ type: "2d", width: 256, height: 256 });
      const ctx = canvas.getContext("2d");
      const img = canvas.createImage();
      const entry = { status: "pending" };
      this._uomTileMasks.set(tile.id, entry);
      img.onload = () => {
        try {
          const w = img.width || 256;
          const h = img.height || 256;
          canvas.width = w;
          canvas.height = h;
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          entry.status = "ready";
          entry.width = imageData.width;
          entry.height = imageData.height;
          entry.data = imageData.data;
          this.updateStatusPanel(this._lastAreas);
        } catch (err) {
          console.error("解析 UOM 瓦片失败", err);
          entry.status = "error";
        }
      };
      img.onerror = (err) => {
        console.error("加载 UOM 瓦片失败", err);
        const entry = this._uomTileMasks.get(tile.id);
        if (entry) entry.status = "error";
      };
      img.src = tile.src;
    } catch (err) {
      console.error("创建 UOM 蒙版失败", err);
      this._uomTileMasks.set(tile.id, { status: "error" });
    }
  },

  pointCoveredByUomMask(point, bounds, mask) {
    if (!point || !bounds || !mask || mask.status !== "ready" || !mask.data) return false;
    const sw = bounds.southwest || {};
    const ne = bounds.northeast || {};
    const lngSpan = (ne.longitude ?? sw.longitude) - (sw.longitude ?? 0);
    const latSpan = (ne.latitude ?? sw.latitude) - (sw.latitude ?? 0);
    if (!lngSpan || !latSpan) return false;
    const u = (point.longitude - sw.longitude) / lngSpan;
    const v = (ne.latitude - point.latitude) / latSpan;
    if (u < 0 || u > 1 || v < 0 || v > 1) return false;
    const width = mask.width || 256;
    const height = mask.height || 256;
    const px = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))));
    const py = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))));
    const idx = (py * width + px) * 4;
    const alpha = mask.data[idx + 3];
    return alpha > 16;
  }
});
