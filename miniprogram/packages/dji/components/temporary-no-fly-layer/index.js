const {
  fetchNearbyNoFlyZones,
  buildNoFlyZoneGraphics
} = require("../../../../utils/no-fly-zones");
const { haversineMeters, gcj02ToWgs84 } = require("../../../../utils/coords");

const DEFAULT_CENTER = {
  latitude: 39.908823,
  longitude: 116.39747
};

const DEFAULT_SCALE = 11;

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
      this._shapes = [];
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
        this._shapes = [];
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

      const wgs = gcj02ToWgs84(center.longitude, center.latitude);
      const latitude = Number.isFinite(wgs?.lat) ? wgs.lat : Number(center.latitude);
      const longitude = Number.isFinite(wgs?.lng) ? wgs.lng : Number(center.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

      const prev = this._lastFetch || {};
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
      if (!force && moveMeters < 50 && radiusDiff < 0.2 && !isStale) {
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
          const items = Array.isArray(zones) ? zones : [];
          const graphics = buildNoFlyZoneGraphics(items);
          this._polygons = graphics.polygons || [];
          this._circles = graphics.circles || [];
          this._shapes = graphics.shapes || [];
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
            this._shapes = [];
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
        linkPath
      };
      return {
        temporaryNoFlyZoneInfo: zoneInfo,
        temporaryNoFlyText: displayName,
        temporaryNoFlyTone: "alert"
      };
    },

    findNoFlyZoneAtPoint(lng, lat) {
      if (!Array.isArray(this._shapes) || !this._shapes.length) {
        return null;
      }
      for (const entry of this._shapes) {
        if (!entry) continue;
        if (entry.type === "circle" && entry.center) {
          const radius = Number(entry.radius);
          if (!Number.isFinite(radius) || radius <= 0) continue;
          const dist = haversineMeters(lat, lng, Number(entry.center.lat), Number(entry.center.lng));
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
          const radiusKm = Math.max(0.1, diag / 2000);
          return Math.min(radiusKm, 200);
        }
      }
      const zoom = clampScale(scale);
      const zoomFactor = Math.pow(2, Math.max(0, (18 - zoom) / 1.3));
      return Math.max(0.1, Math.min(200, zoomFactor * 0.8));
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
        circles: Array.isArray(this._circles) ? this._circles : []
      });
    },

    emitStatusChange(payload = {}) {
      const next = Object.assign({}, this._status || {}, payload || {});
      this._status = next;
      this.triggerEvent("statuschange", next);
    }
  }
});
