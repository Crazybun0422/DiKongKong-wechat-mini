const { computeGreatCircleDistance } = require("../../../../utils/distance");

const HINT_TEXT = "\u6e05\u9664\u641c\u7d22\u6846\u6d88\u5931";
const STANDARD_COLOR = "#111111";
const SATELLITE_COLOR = "#ffffff";
const LABEL_ICON_PATH = "/assets/dot-black.png";
const MID_DISTANCE_MARKER_ID = "search-link-mid-distance";
const MID_HINT_MARKER_ID = "search-link-mid-hint";

const isValidCoordinate = (point = {}) => {
  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude);
};

const normalizePoint = (point = {}) => ({
  latitude: Number(point.latitude),
  longitude: Number(point.longitude)
});

const formatMeters = (value) => {
  const meters = Number(value);
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (meters >= 1000) {
    const km = meters / 1000;
    const display = km >= 10 ? Math.round(km) : Math.round(km * 10) / 10;
    return `${display}km`;
  }
  return `${Math.max(1, Math.round(meters))}m`;
};

const buildMidPoint = (a = {}, b = {}) => ({
  latitude: (Number(a.latitude) + Number(b.latitude)) / 2,
  longitude: (Number(a.longitude) + Number(b.longitude)) / 2
});

const buildPointOnSegment = (from = {}, to = {}, ratio = 0.5) => {
  const r = Math.max(0, Math.min(1, Number(ratio) || 0));
  return {
    latitude: Number(from.latitude) + (Number(to.latitude) - Number(from.latitude)) * r,
    longitude: Number(from.longitude) + (Number(to.longitude) - Number(from.longitude)) * r
  };
};

Component({
  properties: {
    center: {
      type: Object,
      value: null
    },
    target: {
      type: Object,
      value: null
    },
    visible: {
      type: Boolean,
      value: false
    },
    satellite: {
      type: Boolean,
      value: false
    }
  },

  lifetimes: {
    attached() {
      this.emitGraphics();
    }
  },

  observers: {
    "center, target, visible, satellite"() {
      this.emitGraphics();
    }
  },

  methods: {
    emitGraphics() {
      const payload = this.buildGraphics();
      this.triggerEvent("graphicschange", payload);
    },

    buildGraphics() {
      const visible = this.properties.visible === true;
      const center = this.properties.center;
      const target = this.properties.target;
      if (!visible || !isValidCoordinate(center) || !isValidCoordinate(target)) {
        return { markers: [], polylines: [] };
      }

      const centerPoint = normalizePoint(center);
      const targetPoint = normalizePoint(target);
      const distanceMeters = computeGreatCircleDistance(centerPoint, targetPoint);
      if (!Number.isFinite(distanceMeters) || distanceMeters < 0.5) {
        return { markers: [], polylines: [] };
      }

      const color = this.properties.satellite ? SATELLITE_COLOR : STANDARD_COLOR;
      const midpoint = buildMidPoint(centerPoint, targetPoint);
      const labelBasePoint = buildPointOnSegment(centerPoint, midpoint, 0.35);
      const deltaLat = Number(targetPoint.latitude) - Number(centerPoint.latitude);
      const deltaLng = Number(targetPoint.longitude) - Number(centerPoint.longitude);
      const mostlyHorizontal = Math.abs(deltaLng) >= Math.abs(deltaLat);
      const distanceAnchorX = mostlyHorizontal ? 0 : 24;
      const distanceAnchorY = mostlyHorizontal ? -32 : -14;
      const hintAnchorX = mostlyHorizontal ? 0 : 24;
      const hintAnchorY = mostlyHorizontal ? -12 : 6;
      const distanceText = formatMeters(distanceMeters);
      const baseLabelMarker = {
        latitude: labelBasePoint.latitude,
        longitude: labelBasePoint.longitude,
        iconPath: LABEL_ICON_PATH,
        width: 1,
        height: 1,
        alpha: 1,
        zIndex: 1020,
        anchor: { x: 0.5, y: 0.5 },
        extData: { source: "search-link-label" }
      };

      const distanceMarker = Object.assign({}, baseLabelMarker, {
        id: MID_DISTANCE_MARKER_ID,
        label: {
          content: distanceText,
          color,
          fontSize: 12,
          anchorX: distanceAnchorX,
          anchorY: distanceAnchorY,
          bgColor: "#00000000",
          borderWidth: 0,
          borderRadius: 0,
          padding: 0,
          textAlign: "center"
        }
      });

      const hintMarker = Object.assign({}, baseLabelMarker, {
        id: MID_HINT_MARKER_ID,
        label: {
          content: HINT_TEXT,
          color,
          fontSize: 11,
          anchorX: hintAnchorX,
          anchorY: hintAnchorY,
          bgColor: "#00000000",
          borderWidth: 0,
          borderRadius: 0,
          padding: 0,
          textAlign: "center"
        }
      });

      return {
        polylines: [
          {
            points: [centerPoint, targetPoint],
            color,
            width: 3,
            dottedLine: true,
            arrowLine: false,
            zIndex: 1010
          }
        ],
        markers: [distanceMarker, hintMarker]
      };
    }
  }
});
