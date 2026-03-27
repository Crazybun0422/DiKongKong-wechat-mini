Component({
  options: {
    styleIsolation: "shared"
  },

  properties: {
    layerPanelClosing: { type: Boolean, value: false },
    layerPanelMaxHeightPx: { type: Number, value: 0 },
    layerPanelBodyHeightPx: { type: Number, value: 0 },
    layerPanelBodyMaxHeightPx: { type: Number, value: 0 },
    mapLayerType: { type: String, value: "standard" },
    airBoardEnabled: { type: Boolean, value: true },
    usePlanetCenterPoint: { type: Boolean, value: false },
    centerTargetLinkEnabled: { type: Boolean, value: true },
    provinceCityHighlightEnabled: { type: Boolean, value: false },
    provinceCityTree: { type: Array, value: [] },
    provinceCityHighlightLoading: { type: Boolean, value: false },
    provinceCityHighlightError: { type: String, value: "" },
    mapElementOptions: { type: Array, value: [] }
  },

  methods: {
    noop() {},

    emitDataset(name, event = {}) {
      this.triggerEvent(name, {
        dataset: event?.currentTarget?.dataset || {}
      });
    },

    measureContentHeight() {
      return new Promise((resolve) => {
        const query = wx.createSelectorQuery().in(this);
        query.select("#layer-panel-content").boundingClientRect();
        query.exec((result = []) => {
          resolve(Number(result?.[0]?.height) || 0);
        });
      });
    },

    onMaskTap() {
      this.triggerEvent("masktap");
    },

    onCloseTap() {
      this.triggerEvent("close");
    },

    onMapLayerSelect(event = {}) {
      this.emitDataset("maplayerselect", event);
    },

    onAirBoardSwitchChange(event = {}) {
      this.triggerEvent("airboardswitchchange", event.detail || {});
    },

    onUsePlanetCenterPointSwitchChange(event = {}) {
      this.triggerEvent("useplanetcenterpointswitchchange", event.detail || {});
    },

    onCenterTargetLinkSwitchChange(event = {}) {
      this.triggerEvent("centertargetlinkswitchchange", event.detail || {});
    },

    onProvinceCityHighlightSwitchChange(event = {}) {
      this.triggerEvent("provincecityhighlightswitchchange", event.detail || {});
    },

    onProvinceCityTreeSelectTap(event = {}) {
      this.emitDataset("provincecitytreeselecttap", event);
    },

    onProvinceCityTreeExpandTap(event = {}) {
      this.emitDataset("provincecitytreeexpandtap", event);
    },

    onMapElementToggle(event = {}) {
      this.emitDataset("mapelementtoggle", event);
    }
  }
});
