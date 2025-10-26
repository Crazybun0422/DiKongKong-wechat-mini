const { DRONES } = require("../../utils/drones");
const { fetchDjiAreas, buildAreaGraphics } = require("../../utils/dji");
const { searchPlaces } = require("../../utils/search");
const {
  buildWmsOverlay,
  WMS_MIN_ZOOM,
  WMS_MAX_ZOOM
} = require("../../utils/wms");
const {
  haversineMeters,
  clampRadius,
  gcj02ToWgs84
} = require("../../utils/coords");

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
// 小程序静态资源使用相对路径；assets 位于 miniprogram/assets
const NFZ_CENTER_COLORS = {
  1: "#1088F2",
  2: "#DE4329",
  3: "#EE8815",
  4: "#FFCC00",
  6: "#979797",
  7: "#37C4DB",
  8: "#35C759",
  10: "#A9D86E"
};

Page({
  data: {
    keyword: "",
    djiMsg: "",
    center: DEFAULT_CENTER,
    scale: 12,
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
    djiStatusExtra: ""
  },

  onLoad() {
    this.mapCtx = wx.createMapContext("main-map");
    this._fetchTimer = null;
    this._currentRadius = 30000;
    this._currentBounds = null;
    this._suppressRegionOnce = false;
    this._centerOverride = this.data.center;
    this._currentWmsTiles = [];
    this._uomTileMasks = new Map();
    this._uomMaskSupported = typeof wx !== "undefined" && typeof wx.createOffscreenCanvas === "function";
    this.refreshWmsOverlay();
    this.scheduleFetchDji(0);
    this.updateStatusPanel();
    this.requestInitialLocation();
  },

  onUnload() {
    if (this._fetchTimer) clearTimeout(this._fetchTimer);
    this.clearMapOverlays();
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value || "" });
  },

  onSearchConfirm() {
    this.performSearch();
  },

  onSearchTap() {
    this.performSearch();
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
          return marker;
        });
        if (markers.length) {
          this.setData({ markers });
          const points = markers.map((m) => ({
            latitude: m.latitude,
            longitude: m.longitude
          }));
          this.mapCtx.includePoints({
            points,
            padding: [60, 60, 60, 60]
          });
        } else {
          this.setData({ markers: [] });
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
      });
  },

  onDronePickerChange(e) {
    const idx = Number(e.detail.value) || 0;
    this.applyDroneByIndex(idx);
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
        this.centerOnPoint(
          { latitude: res.latitude, longitude: res.longitude },
          options.scale || 14,
          !!options.silent
        );
      },
      fail: (err) => {
        console.warn("getLocation fail", err);
        wx.showToast({ title: "定位失败，请在设置中开启定位权限", icon: "none" });
      }
    });
  },

  centerOnPoint(point, scale = 14, silent = false) {
    if (!point) return;
    this._suppressRegionOnce = true;
    this._centerOverride = point;
    this.setData(
      {
        center: point,
        scale
      },
      () => {
        this._currentBounds = null;
        this.refreshWmsOverlay(this.data.center, this.data.scale, this._lastRegion);
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
          wx.authorize({
            scope: "scope.userLocation",
            success: () => resolve(),
            fail: () => {
              wx.showModal({
                title: "需要定位权限",
                content: "用于定位当前位置并展示附近空域/禁飞区，是否前往开启？",
                confirmText: "去开启",
                success: (r) => {
                  if (r.confirm) {
                    wx.openSetting({
                      success: (st) => {
                        if (st.authSetting && st.authSetting["scope.userLocation"]) resolve();
                        else reject();
                      },
                      fail: reject
                    });
                  } else {
                    reject();
                  }
                }
              });
            }
          });
        },
        fail: reject
      });
    });
  },

  onRegionChange(e) {
    if (e.type === "begin") {
      if (this._fetchTimer) clearTimeout(this._fetchTimer);
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
        const scale = e.detail.scale || this.data.scale;
        this._lastRegion = region;
        const radius = this.computeRadius({ region });
        this._currentRadius = clampRadius(radius);
        this._currentBounds = this.buildBoundsRect(region, newCenter, this._currentRadius);
        const diffLat = Math.abs((this.data.center?.latitude || 0) - newCenter.latitude);
        const diffLng = Math.abs((this.data.center?.longitude || 0) - newCenter.longitude);
        const shouldSync = diffLat > 1e-5 || diffLng > 1e-5 || scale !== this.data.scale;
        const run = () => {
          this.refreshWmsOverlay(newCenter, scale, region);
          this.requestDjiZones(true, newCenter, region, scale);
          this.updateStatusPanel(this._lastAreas);
        };
        if (shouldSync) {
          this._suppressRegionOnce = true;
          this.setData({ center: newCenter, scale }, run);
        } else {
          run();
        }
        return;
      }
      // 兜底：取中心再刷新（少量机型可能无 centerLocation）
      this.updateCenterAndRadius(e.detail);
    }
  },

  onMapUpdated() {},

  updateCenterAndRadius(detail) {
    this.mapCtx.getCenterLocation({
      type: "gcj02",
      success: (res) => {
        const newCenter = {
          latitude: res.latitude,
          longitude: res.longitude
        };
        this._centerOverride = newCenter;
        const scale = detail?.scale || this.data.scale;
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
        return Math.max(1000, Math.min(80000, diag / 2));
      }
    }
    return 30000;
  },

  scheduleFetchDji(delay = 300, force = false) {
    if (this._fetchTimer) clearTimeout(this._fetchTimer);
    this._fetchTimer = setTimeout(() => {
      this._fetchTimer = null;
      this.requestDjiZones(force);
    }, delay);
  },

  requestDjiZones(force, centerOverride, regionOverride, scaleOverride) {
    const center = centerOverride || this.data.center;
    const radius = this._currentRadius || 30000;
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
      status: this.labelForArea(target.area),
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
    const scale = scaleOverride || this.data.scale;
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
        fail: () => {}
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
        fail: () => {}
      });
    });
    this._wmsOverlayHandles = [];
    this._currentWmsTiles = [];
    this.updateStatusPanel(this._lastAreas);
  },

  buildBoundsRect(region, center, radius) {
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
    const useRadius = clampRadius(radius || 30000);
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
      this._currentRadius || 30000
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

  labelForArea(area) {
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
