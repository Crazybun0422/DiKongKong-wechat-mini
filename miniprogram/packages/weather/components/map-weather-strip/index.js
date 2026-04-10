const { resolveWeatherIconPath } = require("../../../../utils/weather");

function formatWindSpeedValue(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "暂无";
  }
  return `${numeric.toFixed(1)}m/s`;
}

Component({
  properties: {
    visible: { type: Boolean, value: false },
    satellite: { type: Boolean, value: false },
    containerStyle: { type: String, value: "" },
    loading: { type: Boolean, value: false },
    error: { type: String, value: "" },
    updatedAtText: { type: String, value: "" },
    items: { type: Array, value: [] }
  },

  data: {
    currentItem: null
  },

  observers: {
    "items,satellite"(list = [], satellite = false) {
      const item = Array.isArray(list) && list.length ? (list[0] || null) : null;
      const currentItem = item
        ? Object.assign({}, item, {
          iconPath: resolveWeatherIconPath(item.iconName, !!satellite),
          directionRotation: Number.isFinite(Number(item.windDirectionRotation)) ? Number(item.windDirectionRotation) : 0,
          windSpeedValueText: formatWindSpeedValue(item.windSpeedValue),
          windForceText: `${item.windForceLevelText || ""}`.trim() || "--"
        })
        : null;
      this.setData({ currentItem });
    }
  },

  methods: {
    onTap() {
      this.triggerEvent("weathertap");
    }
  }
});
