const { computeGreatCircleDistance } = require("../../../../utils/distance");

const STANDARD_COLOR = "#111111";
const SATELLITE_COLOR = "#ffffff";

const isValidCoordinate = (point = {}) => {
  const latitude = Number(point.latitude);
  const longitude = Number(point.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude);
};

const normalizePoint = (point = {}) => ({
  latitude: Number(point.latitude),
  longitude: Number(point.longitude)
});

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
        markers: []
      };
    }
  }
});
