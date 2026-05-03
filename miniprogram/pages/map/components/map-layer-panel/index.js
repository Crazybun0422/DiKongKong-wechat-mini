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
    mapElementOptions: { type: Array, value: [] },
    userVip: { type: Boolean, value: false },
    userAvatarUrl: { type: String, value: "" },
    myLocationIconType: { type: String, value: "default" },
    myLocationAvatarIconPath: { type: String, value: "" },
    centerPinIconType: { type: String, value: "default" }
  },

  data: {
    activeSettingsTab: "common",
    vipGatePopupVisible: false
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
      const type = event?.currentTarget?.dataset?.type || "";
      if ((type === "satellite" || type === "tianditu") && !this.properties.userVip) {
        this.showVipGatePopup();
        return;
      }
      this.emitDataset("maplayerselect", event);
    },

    onSettingsTabTap(event = {}) {
      const tab = event?.currentTarget?.dataset?.tab || "";
      if (!tab || tab === this.data.activeSettingsTab) return;
      this.setData({ activeSettingsTab: tab }, () => {
        this.triggerEvent("layoutchange");
      });
    },

    onLocationIconTap(event = {}) {
      const mode = event?.currentTarget?.dataset?.mode || "default";
      if (mode !== "default" && !this.properties.userVip) {
        this.showVipGatePopup();
        return;
      }
      this.triggerEvent("mylocationiconselect", { dataset: { type: mode } });
    },

    onCenterPinIconTap(event = {}) {
      const type = event?.currentTarget?.dataset?.type || "default";
      if (type !== "default" && !this.properties.userVip) {
        this.showVipGatePopup();
        return;
      }
      this.triggerEvent("centerpiniconselect", { dataset: { type } });
    },

    onVipFeatureTap() {
      if (!this.properties.userVip) {
        this.showVipGatePopup();
      }
    },

    showVipGatePopup() {
      this.setData({ vipGatePopupVisible: true });
    },

    onVipGatePopupClose() {
      this.setData({ vipGatePopupVisible: false });
    },

    onVipGatePopupConfirm() {
      this.setData({ vipGatePopupVisible: false });
      this.triggerEvent("vipgateconfirm");
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
