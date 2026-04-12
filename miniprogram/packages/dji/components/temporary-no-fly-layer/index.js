const {
  fetchNearbyNoFlyZones,
  buildNoFlyZoneGraphics,
  filterEffectiveNoFlyZones,
  filterUnexpiredNoFlyZones,
  isNoFlyZoneEffective,
  expandNoFlyZoneAreas
} = require("../../../../utils/no-fly-zones");
const { haversineMeters } = require("../../../../utils/coords");

const DEFAULT_CENTER = {
  latitude: 39.908823,
  longitude: 116.39747
};

const DEFAULT_SCALE = 11;
const UPCOMING_ZONE_COLOR = "#8A6E72";
const MIN_FETCH_RADIUS_KM = 2;
const FETCH_RADIUS_BUFFER_KM = 1;
const formatTemporaryZoneLabel = (value, maxLength = 9) => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const chars = Array.from(trimmed);
  if (chars.length <= maxLength) {
    return trimmed;
  }
  return `${chars.slice(0, maxLength).join("")}...`;
};

const clampScale = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SCALE;
  return Math.min(18, Math.max(0, Math.round(numeric)));
};

Component({
  properties: {},

  lifetimes: {
    attached() {
      this._enabled = true;
      this._apiBase = "";
      this._center = DEFAULT_CENTER;
      this._region = null;
      this._scale = DEFAULT_SCALE;
      this._polygons = [];
      this._circles = [];
      this._polylines = [];
      this._shapes = [];
      this._activeAreas = [];
      this._upcomingAreas = [];
      this._activeShapes = [];
      this._upcomingShapes = [];
      this._ready = false;
      this._activeRequestId = 0;
      this._requestSeq = 0;
      this._lastFetch = null;
      this._status = {
        temporaryNoFlyZoneInfo: null,
        temporaryNoFlyText: "评估中",
        temporaryNoFlyTone: "neutral"
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
      const center = this.normalizeCenter(options.center) || this._center || DEFAULT_CENTER;
      const region = this.normalizeRegion(options.region);
      const scale = clampScale(options.scale);
      this._center = center;
      this._region = region || null;
      this._scale = scale;
      if (typeof options.apiBase === "string") {
        this._apiBase = options.apiBase;
      }
      const enabled = options.enabled !== false;
      if (!enabled) {
        this.setEnabled(false, { force: false });
        return;
      }
      this._enabled = true;
      this.fetchTemporaryZones({ force: true });
    },

    setEnabled(enabled, options = {}) {
      const nextEnabled = enabled !== false;
      this._enabled = nextEnabled;
      if (!nextEnabled) {
        this._activeRequestId = 0;
        this._ready = false;
        this._lastFetch = null;
        this._polygons = [];
        this._circles = [];
        this._polylines = [];
        this._shapes = [];
        this._activeAreas = [];
        this._upcomingAreas = [];
        this._activeShapes = [];
        this._upcomingShapes = [];
        this.emitGraphicsChange();
        this.emitStatusChange({
          temporaryNoFlyZoneInfo: null,
          temporaryNoFlyText: "已禁用",
          temporaryNoFlyTone: "warn"
        });
        return;
      }
      const force = options.force === true || !this._ready;
      this.fetchTemporaryZones({ force });
    },

    updateViewport(options = {}) {
      const center = this.normalizeCenter(options.center);
      if (center) {
        this._center = center;
      }
      this._region = this.normalizeRegion(options.region) || null;
      this._scale = clampScale(options.scale);
      if (typeof options.apiBase === "string") {
        this._apiBase = options.apiBase;
      }
      if (!this._enabled) return;
      this.fetchTemporaryZones({ force: options.force === true });
    },

    refresh(options = {}) {
      if (typeof options.apiBase === "string") {
        this._apiBase = options.apiBase;
      }
      if (!this._enabled) return;
      this.fetchTemporaryZones({ force: options.force === true });
    },

    fetchTemporaryZones(options = {}) {
      if (!this._enabled) return;
      const force = options.force === true;
      const center = this._center || DEFAULT_CENTER;
      if (!center) return;
      const scale = this._scale || DEFAULT_SCALE;
      const region = this._region;
      const radiusKm = this.computeRadiusKm(region, scale);
      if (!Number.isFinite(radiusKm) || radiusKm <= 0) return;

      const latitude = Number(center.latitude);
      const longitude = Number(center.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

      const prev = this._lastFetch || {};
      const moveMeters = haversineMeters(
        center.latitude,
        center.longitude,
        prev.latitude || 0,
        prev.longitude || 0
      );
      const radiusDiff = Math.abs((prev.radiusKm || 0) - radiusKm);
      const scaleDiff = Math.abs((prev.scale || 0) - scale);
      const now = Date.now();
      const prevTimestamp = Number(prev.timestamp) || 0;
      const isStale = !prevTimestamp || now - prevTimestamp > 60000;
      if (!force && moveMeters < 50 && radiusDiff < 0.2 && scaleDiff < 1 && !isStale) {
        this.emitStatusChange(this.describeTemporaryStatus());
        return;
      }

      const requestId = ++this._requestSeq;
      this._activeRequestId = requestId;

      fetchNearbyNoFlyZones(
        {
          latitude,
          longitude,
          radiusInKilometers: radiusKm
        },
        {
          apiBase: this._apiBase
        }
      )
        .then((zones = []) => {
          if (this._activeRequestId !== requestId) return;
          const allZones = filterUnexpiredNoFlyZones(Array.isArray(zones) ? zones : []);
          const activeItems = filterEffectiveNoFlyZones(allZones);
          const upcomingItems = allZones.filter((zone) => !isNoFlyZoneEffective(zone));
          this._activeAreas = expandNoFlyZoneAreas(activeItems);
          this._upcomingAreas = expandNoFlyZoneAreas(upcomingItems);
          const activeGraphics = buildNoFlyZoneGraphics(this._activeAreas);
          const upcomingGraphics = buildNoFlyZoneGraphics(this._upcomingAreas, {
            color: UPCOMING_ZONE_COLOR,
            fillOpacity: 0.18,
            strokeOpacity: 0.72
          });
          this._polygons = []
            .concat(upcomingGraphics.polygons || [], activeGraphics.polygons || []);
          this._circles = []
            .concat(upcomingGraphics.circles || [], activeGraphics.circles || []);
          this._polylines = []
            .concat(upcomingGraphics.polylines || [], activeGraphics.polylines || []);
          this._activeShapes = Array.isArray(activeGraphics.shapes) ? activeGraphics.shapes : [];
          this._upcomingShapes = Array.isArray(upcomingGraphics.shapes) ? upcomingGraphics.shapes : [];
          this._shapes = this._activeShapes.concat(this._upcomingShapes);
          console.log("[temporary-no-fly-shapes]", {
            activeShapeCount: this._activeShapes.length,
            upcomingShapeCount: this._upcomingShapes.length,
            activeCircleCount: this._activeShapes.filter((item) => item && item.type === "circle").length,
            upcomingCircleCount: this._upcomingShapes.filter((item) => item && item.type === "circle").length,
            scale
          });
          this._ready = true;
          this.emitGraphicsChange();
          this.emitStatusChange(this.describeTemporaryStatus());
          this._lastFetch = {
            latitude: center.latitude,
            longitude: center.longitude,
            radiusKm,
            scale,
            timestamp: now
          };
        })
        .catch((err) => {
          console.warn("Fetch temporary no-fly zones failed", err);
          if (!this._ready) {
            this._polygons = [];
            this._circles = [];
            this._polylines = [];
            this._shapes = [];
            this._activeAreas = [];
            this._upcomingAreas = [];
            this._activeShapes = [];
            this._upcomingShapes = [];
            this.emitGraphicsChange();
          }
          this._ready = true;
          this.emitStatusChange(this.describeTemporaryStatus());
        })
        .finally(() => {
          if (this._activeRequestId === requestId) {
            this._activeRequestId = 0;
          }
        });
    },

    describeTemporaryStatus() {
      if (!this._enabled) {
        return {
          temporaryNoFlyZoneInfo: null,
          temporaryNoFlyText: "已禁用",
          temporaryNoFlyTone: "warn"
        };
      }
      const center = this._center;
      if (!center) {
        return {
          temporaryNoFlyZoneInfo: null,
          temporaryNoFlyText: "评估中",
          temporaryNoFlyTone: "neutral"
        };
      }
      if (!Number.isFinite(center.longitude) || !Number.isFinite(center.latitude)) {
        return {
          temporaryNoFlyZoneInfo: null,
          temporaryNoFlyText: "评估中",
          temporaryNoFlyTone: "neutral"
        };
      }
      const hit = this.findNoFlyZoneAtPoint(center.longitude, center.latitude);
      if (!hit) {
        return {
          temporaryNoFlyZoneInfo: null,
          temporaryNoFlyText: "",
          temporaryNoFlyTone: "safe"
        };
      }
      const rawName = typeof hit.zone?.name === "string" ? hit.zone.name.trim() : "";
      const name = rawName || "临时禁飞区";
      const displayName = formatTemporaryZoneLabel(name);
      const rawLink = typeof hit.zone?.wechatLink === "string" ? hit.zone.wechatLink.trim() : "";
      const validLink = /^https?:\/\/mp\.weixin\.qq\.com\//.test(rawLink) ? rawLink : "";
      const linkPath = validLink
        ? `/packages/city-report/h5/index?url=${encodeURIComponent(validLink)}`
        : "";
      const zoneInfo = {
        id: hit.zone?.id || "",
        name,
        displayName,
        hasLink: !!validLink,
        link: validLink,
        linkPath,
        effective: hit.effective === true
      };
      return {
        temporaryNoFlyZoneInfo: zoneInfo,
        temporaryNoFlyText: displayName,
        temporaryNoFlyTone: hit.effective === true ? "alert" : "warn"
      };
    },

    findNoFlyZoneAtPoint(lng, lat) {
      const activeHit = this.findHitInShapes(this._activeShapes, lng, lat);
      if (activeHit) {
        return Object.assign({ effective: true }, activeHit);
      }
      const upcomingHit = this.findHitInShapes(this._upcomingShapes, lng, lat);
      if (upcomingHit) {
        return Object.assign({ effective: false }, upcomingHit);
      }
      return null;
    },

    findHitInShapes(shapes, lng, lat) {
      if (!Array.isArray(shapes) || !shapes.length) {
        return null;
      }
      for (const entry of shapes) {
        if (!entry) continue;
        if (entry.type === "circle" && entry.center) {
          const radius = Number(entry.radius);
          if (!Number.isFinite(radius) || radius <= 0) continue;
          const centerLat = Number(entry.center.lat);
          const centerLng = Number(entry.center.lng);
          const dist = haversineMeters(lat, lng, centerLat, centerLng);
          console.log("[temporary-no-fly-circle-distance]", {
            zoneId: entry.zone?.id || "",
            zoneName: entry.zone?.name || "",
            point: { lat, lng },
            center: { lat: centerLat, lng: centerLng },
            radius,
            distance: dist,
            hit: Number.isFinite(dist) && dist <= radius
          });
          if (Number.isFinite(dist) && dist <= radius) {
            return { zone: entry.zone, shape: entry };
          }
          continue;
        }
        if (entry.type === "polygon" && Array.isArray(entry.rings)) {
          for (const ring of entry.rings) {
            if (this.ringContains(ring, lng, lat)) {
              return { zone: entry.zone, shape: entry };
            }
          }
        }
      }
      return null;
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

    computeRadiusKm(region, scale) {
      if (region?.northeast && region?.southwest) {
        const { northeast, southwest } = region;
        const diag = haversineMeters(
          northeast.latitude,
          northeast.longitude,
          southwest.latitude,
          southwest.longitude
        );
        if (Number.isFinite(diag) && diag > 0) {
          const radiusKm = Math.max(MIN_FETCH_RADIUS_KM, diag / 2000 + FETCH_RADIUS_BUFFER_KM);
          return Math.min(radiusKm, 200);
        }
      }
      const zoom = clampScale(scale);
      const zoomFactor = Math.pow(2, Math.max(0, (18 - zoom) / 1.3));
      return Math.max(MIN_FETCH_RADIUS_KM, Math.min(200, zoomFactor * 0.8 + FETCH_RADIUS_BUFFER_KM));
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

    emitGraphicsChange() {
      this.triggerEvent("graphicschange", {
        polygons: Array.isArray(this._polygons) ? this._polygons : [],
        circles: Array.isArray(this._circles) ? this._circles : [],
        polylines: Array.isArray(this._polylines) ? this._polylines : []
      });
    },

    emitStatusChange(payload = {}) {
      const next = Object.assign({}, this._status || {}, payload || {});
      this._status = next;
      this.triggerEvent("statuschange", next);
    }
  }
});
