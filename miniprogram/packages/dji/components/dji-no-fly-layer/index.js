const { fetchDjiAreas, buildAreaGraphics } = require("../../../../utils/dji");
const { haversineMeters, clampRadius, gcj02ToWgs84 } = require("../../../../utils/coords");

const DEFAULT_CENTER = {
  latitude: 39.908823,
  longitude: 116.39747
};

const DEFAULT_LEVELS_PARAM = "2,6,1,4,3,7,8,10";
const DEFAULT_FETCH_RADIUS = 80000;
const MAP_MIN_SCALE = 0;
const MAP_MAX_SCALE = 18;
const DEFAULT_MAP_SCALE = 11;

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

const clampMapScale = (value) => {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : DEFAULT_MAP_SCALE;
  const rounded = Math.round(base);
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, rounded));
};

Component({
  properties: {},

  lifetimes: {
    attached() {
      this._enabled = true;
      this._center = DEFAULT_CENTER;
      this._region = null;
      this._scale = DEFAULT_MAP_SCALE;
      this._drone = "";
      this._levels = DEFAULT_LEVELS_PARAM;
      this._lastFetch = null;
      this._lastAreas = undefined;
      this._polygons = [];
      this._circles = [];
      this._ready = false;
      this._activeRequestId = 0;
      this._requestSeq = 0;
      this._status = {
        djiStatus: "评估中",
        djiStatusExtra: "",
        djiTone: "neutral",
        djiColor: "",
        djiMsg: "",
        loadingDji: false,
        djiReady: false,
        djiEnabled: true
      };
      this.emitGraphicsChange();
      this.emitStatusChange(this._status);
    },

    detached() {
      this._activeRequestId = 0;
    }
  },

  methods: {
    init(options = {}) {
      const nextCenter = this.normalizeCenter(options.center);
      const nextRegion = this.normalizeRegion(options.region);
      const nextScale = this.normalizeScale(options.scale);
      const nextDrone = typeof options.drone === "string" ? options.drone : this._drone;
      const nextLevels = this.normalizeLevels(options.levels);
      const enabled = options.enabled !== false;

      this._center = nextCenter || this._center || DEFAULT_CENTER;
      this._region = nextRegion || null;
      this._scale = nextScale;
      this._drone = nextDrone || "";
      this._levels = nextLevels;

      if (!enabled) {
        this.setEnabled(false, { force: false });
        return;
      }
      this._enabled = true;
      this.fetchDjiZones({ force: true });
    },

    setEnabled(enabled, options = {}) {
      const nextEnabled = enabled !== false;
      this._enabled = nextEnabled;
      if (!nextEnabled) {
        this._activeRequestId = 0;
        this._ready = false;
        this._lastFetch = null;
        this._lastAreas = undefined;
        this._polygons = [];
        this._circles = [];
        this.emitGraphicsChange();
        this.emitStatusChange({
          djiStatus: "已禁用",
          djiStatusExtra: "",
          djiTone: "warn",
          djiColor: this.softenPanelColor("#F59E0B"),
          djiMsg: "",
          loadingDji: false,
          djiReady: false,
          djiEnabled: false
        });
        return;
      }
      const force = options.force === true || !this._ready;
      this.fetchDjiZones({ force });
    },

    updateViewport(options = {}) {
      const nextCenter = this.normalizeCenter(options.center);
      const nextRegion = this.normalizeRegion(options.region);
      const nextScale = this.normalizeScale(options.scale);
      if (nextCenter) {
        this._center = nextCenter;
      }
      this._region = nextRegion || null;
      this._scale = nextScale;
      if (!this._enabled) return;
      this.fetchDjiZones({ force: options.force === true });
    },

    updateQuery(options = {}) {
      const nextDrone = typeof options.drone === "string" ? options.drone : this._drone;
      const nextLevels = this.normalizeLevels(options.levels);
      const changed = nextDrone !== this._drone || nextLevels !== this._levels;
      this._drone = nextDrone;
      this._levels = nextLevels;
      if (!this._enabled) return;
      if (changed || options.force === true) {
        this.fetchDjiZones({ force: true });
      }
    },

    refresh(options = {}) {
      if (!this._enabled) return;
      this.fetchDjiZones({ force: options.force === true });
    },

    normalizeCenter(center = null) {
      const latitude = Number(center?.latitude);
      const longitude = Number(center?.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }
      return { latitude, longitude };
    },

    normalizeRegion(region = null) {
      if (!region || typeof region !== "object") return null;
      const northeast = region.northeast;
      const southwest = region.southwest;
      if (!northeast || !southwest) return null;
      const neLat = Number(northeast.latitude);
      const neLng = Number(northeast.longitude);
      const swLat = Number(southwest.latitude);
      const swLng = Number(southwest.longitude);
      if (![neLat, neLng, swLat, swLng].every(Number.isFinite)) return null;
      return {
        northeast: { latitude: neLat, longitude: neLng },
        southwest: { latitude: swLat, longitude: swLng }
      };
    },

    normalizeScale(scale) {
      return clampMapScale(scale);
    },

    normalizeLevels(levels) {
      if (typeof levels !== "string") return this._levels || DEFAULT_LEVELS_PARAM;
      const cleaned = levels
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      return cleaned.length ? cleaned.join(",") : DEFAULT_LEVELS_PARAM;
    },

    fetchDjiZones(options = {}) {
      if (!this._enabled) return;
      const force = options.force === true;
      const center = this._center || DEFAULT_CENTER;
      if (!center) return;
      const radius = this.computeRadius(this._region);
      const prev = this._lastFetch || {};
      const moved =
        haversineMeters(
          center.latitude,
          center.longitude,
          prev.latitude || 0,
          prev.longitude || 0
        ) > 300;
      const radiusDiff = Math.abs((prev.radius || 0) - radius) > 500;
      const gcjRect = this.buildBoundsRect(this._region, center, radius);
      if (!gcjRect) return;
      const rectChanged = prev.rect
        ? (
          Math.abs((gcjRect.ltlng || 0) - (prev.rect.ltlng || 0)) > 0.005 ||
          Math.abs((gcjRect.ltlat || 0) - (prev.rect.ltlat || 0)) > 0.005 ||
          Math.abs((gcjRect.rblng || 0) - (prev.rect.rblng || 0)) > 0.005 ||
          Math.abs((gcjRect.rblat || 0) - (prev.rect.rblat || 0)) > 0.005
        )
        : true;
      if (!force && !moved && !radiusDiff && !rectChanged) {
        const status = this.describeDjiStatus(this._lastAreas);
        this.emitStatusChange(Object.assign({}, status, {
          djiMsg: this._status?.djiMsg || "",
          loadingDji: false,
          djiReady: Array.isArray(this._lastAreas),
          djiEnabled: true
        }));
        return;
      }

      const rect = this.gcjRectToWgs(gcjRect);
      if (!rect) {
        this.emitStatusChange({
          djiMsg: "坐标转换失败，稍后重试",
          loadingDji: false,
          djiEnabled: true
        });
        return;
      }

      const requestId = ++this._requestSeq;
      this._activeRequestId = requestId;
      this.emitStatusChange({
        loadingDji: true,
        djiMsg: "",
        djiEnabled: true
      });

      fetchDjiAreas({
        rect,
        levels: this._levels || DEFAULT_LEVELS_PARAM,
        drone: this._drone || ""
      })
        .then((areas) => {
          if (this._activeRequestId !== requestId) return;
          const list = Array.isArray(areas) ? areas : [];
          const graphics = buildAreaGraphics(list);
          this._polygons = graphics.polygons || [];
          this._circles = graphics.circles || [];
          this._lastAreas = list;
          this._ready = true;
          this.emitGraphicsChange();
          const status = this.describeDjiStatus(list);
          this.emitStatusChange(Object.assign({}, status, {
            djiMsg: `已获取 ${list.length} 个空域`,
            loadingDji: false,
            djiReady: true,
            djiEnabled: true
          }));
          this._lastFetch = {
            latitude: center.latitude,
            longitude: center.longitude,
            radius,
            rect: gcjRect
          };
        })
        .catch((err) => {
          if (this._activeRequestId !== requestId) return;
          console.error("DJI geo fetch failed", err);
          this._lastAreas = null;
          this._ready = false;
          const status = this.describeDjiStatus(null);
          this.emitStatusChange(Object.assign({}, status, {
            djiMsg: "DJI 数据暂不可用",
            loadingDji: false,
            djiReady: false,
            djiEnabled: true
          }));
        })
        .finally(() => {
          if (this._activeRequestId === requestId) {
            this._activeRequestId = 0;
          }
        });
    },

    emitGraphicsChange() {
      this.triggerEvent("graphicschange", {
        polygons: Array.isArray(this._polygons) ? this._polygons : [],
        circles: Array.isArray(this._circles) ? this._circles : []
      });
    },

    emitStatusChange(payload = {}) {
      const next = Object.assign({}, this._status || {}, payload || {});
      this._status = next;
      this.triggerEvent("statuschange", next);
    },

    computeRadius(region) {
      if (region?.northeast && region?.southwest) {
        const { northeast, southwest } = region;
        const diag = haversineMeters(
          northeast.latitude,
          northeast.longitude,
          southwest.latitude,
          southwest.longitude
        );
        if (Number.isFinite(diag) && diag > 0) {
          return clampRadius(diag / 2);
        }
      }
      return clampRadius(DEFAULT_FETCH_RADIUS);
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
        if (!Number.isFinite(lng)) return 0;
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

    describeDjiStatus(areas) {
      if (!this._enabled) {
        return { djiStatus: "已禁用", djiStatusExtra: "", djiTone: "warn", djiColor: this.softenPanelColor("#F59E0B") };
      }
      const fallback = { djiStatus: "暂无空域数据", djiStatusExtra: "", djiTone: "neutral", djiColor: "" };
      if (typeof areas === "undefined") {
        return { djiStatus: "评估中", djiStatusExtra: "", djiTone: "neutral", djiColor: "" };
      }
      if (areas === null) {
        return { djiStatus: "空域数据加载失败", djiStatusExtra: "", djiTone: "warn", djiColor: "" };
      }
      if (!Array.isArray(areas) || !areas.length) {
        return { djiStatus: "不在限制区", djiStatusExtra: "", djiTone: "safe", djiColor: "" };
      }
      const center = this._center || DEFAULT_CENTER;
      if (!center) return fallback;
      const wgs = gcj02ToWgs84(center.longitude, center.latitude);
      if (!wgs) return fallback;
      const hits = [];
      const visitArea = (area, parent, polygonOnly) => {
        if (!area) return;
        if (Array.isArray(area.sub_areas) && area.sub_areas.length) {
          area.sub_areas.forEach((sub) => visitArea(sub, area, true));
          return;
        }
        if (this.areaContainsWgsPoint(area, wgs.lng, wgs.lat, { polygonOnly })) {
          hits.push({ area, parent });
        }
      };
      areas.forEach((area) => visitArea(area, null, false));
      if (!hits.length) {
        return { djiStatus: "不在限制区", djiStatusExtra: "", djiTone: "safe", djiColor: "" };
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
      const normalizedLevel = this.normalizedAreaLevel(target.area);
      return {
        djiStatus: this.labelForArea(target.area, target.parent),
        djiStatusExtra: extraParts.join(" · "),
        djiTone: this.toneForLevel(normalizedLevel),
        djiColor: this.softenPanelColor(this.colorForArea(target.area))
      };
    },

    toneForLevel(level) {
      const normalized = Number(level);
      if (normalized === 2 || normalized === 1) return "alert";
      if (normalized === 6 || normalized === 3 || normalized === 4) return "warn";
      if (normalized === 7 || normalized === 10) return "neutral";
      return "safe";
    },

    labelForArea(area) {
      const level = this.normalizedAreaLevel(area);
      switch (level) {
        case 2: return "禁飞区";
        case 6: return "限高区";
        case 1: return "授权区";
        case 4: return "警示区";
        case 3: return "加强警示区";
        case 7: return "法规限制区";
        case 8: return "法规适飞区";
        case 10: return "风景示范区";
        default: return "空域限制";
      }
    },

    severityRank(area) {
      const level = this.normalizedAreaLevel(area);
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
      const ar = Number(a.radius);
      const br = Number(b.radius);
      if (!Number.isFinite(ar) || !Number.isFinite(br)) return false;
      const ax = Number(a.lng);
      const ay = Number(a.lat);
      const bx = Number(b.lng);
      const by = Number(b.lat);
      if (![ax, ay, bx, by].every(Number.isFinite)) return false;
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

    areaContainsWgsPoint(area, lng, lat, options = {}) {
      if (!area) return false;
      const polygonOnly = !!options.polygonOnly;
      const poly = this.resolvePolygonCoords(area, polygonOnly);
      if (this.hasPolygonCoords(poly)) {
        return this.polygonPointsContain(poly, lng, lat);
      }
      return this.circleContainsArea(area, lng, lat);
    },

    resolvePolygonCoords(area, polygonOnly) {
      if (!area) return null;
      if (polygonOnly) return area.polygon_points;
      return area.polygon_points || area.points || area.polygon || (area.geometry && area.geometry.coordinates);
    },

    hasPolygonCoords(poly) {
      return Array.isArray(poly) && poly.length > 0;
    },

    polygonPointsContain(poly, lng, lat) {
      if (!this.hasPolygonCoords(poly)) return false;
      if (Array.isArray(poly[0]) && Array.isArray(poly[0][0]) && Array.isArray(poly[0][0][0])) {
        return poly.some((single) => {
          const outer = Array.isArray(single[0]) ? single[0] : single;
          const ring = Array.isArray(outer[0]) ? outer[0] : outer;
          return this.ringContains(ring, lng, lat);
        });
      }
      if (Array.isArray(poly[0]) && Array.isArray(poly[0][0])) {
        const ring = Array.isArray(poly[0]) ? poly[0] : poly;
        return this.ringContains(ring, lng, lat);
      }
      return this.ringContains(poly, lng, lat);
    },

    circleContainsArea(area, lng, lat) {
      if (!area) return false;
      const isCircleShape = area.shape === 0;
      const hasCircleParams = area.radius && area.lat && area.lng;
      if (!isCircleShape && !hasCircleParams) return false;
      const radius = Number(area.radius);
      const centerLng = Number(area.lng);
      const centerLat = Number(area.lat);
      if (!Number.isFinite(radius) || radius <= 0) return false;
      if (!Number.isFinite(centerLng) || !Number.isFinite(centerLat)) return false;
      const dist = haversineMeters(lat, lng, centerLat, centerLng);
      return Number.isFinite(dist) && dist <= radius;
    },

    ringContains(ring, lng, lat) {
      if (!Array.isArray(ring) || ring.length === 0) return false;
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = Number(ring[i][0]);
        const yi = Number(ring[i][1]);
        const xj = Number(ring[j][0]);
        const yj = Number(ring[j][1]);
        const intersect = ((yi > lat) !== (yj > lat)) &&
          (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    },

    normalizedAreaLevel(area) {
      const level = Number(area?.level);
      if (!Number.isFinite(level)) return level;
      const color = this.normalizeHexColor(area?.color);
      if (color === "#979797" && level === 2) {
        return 6;
      }
      return level;
    },

    normalizeHexColor(hex) {
      if (typeof hex !== "string") return "";
      const trimmed = hex.trim();
      if (!trimmed) return "";
      const prefixed = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
      return prefixed.toUpperCase();
    },

    softenPanelColor(hex, mix = 0.72) {
      const normalized = this.normalizeHexColor(hex);
      if (!normalized) return "";
      const raw = normalized.slice(1);
      let r;
      let g;
      let b;
      if (raw.length === 3) {
        r = parseInt(raw[0] + raw[0], 16);
        g = parseInt(raw[1] + raw[1], 16);
        b = parseInt(raw[2] + raw[2], 16);
      } else {
        r = parseInt(raw.slice(0, 2), 16);
        g = parseInt(raw.slice(2, 4), 16);
        b = parseInt(raw.slice(4, 6), 16);
      }
      if (![r, g, b].every(Number.isFinite)) return normalized;
      const blend = (value) => Math.round(value + (255 - value) * mix);
      const toHex = (value) => blend(value).toString(16).padStart(2, "0").toUpperCase();
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    },

    colorForArea(area) {
      const level = this.normalizedAreaLevel(area);
      if (level === 6) {
        return "#FFFFFF";
      }
      const explicit = this.normalizeHexColor(area?.color);
      if (explicit) return explicit;
      return NFZ_CENTER_COLORS[level] || "#DE4329";
    }
  }
});
