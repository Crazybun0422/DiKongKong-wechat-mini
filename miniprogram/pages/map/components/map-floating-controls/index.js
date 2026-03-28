Component({
  options: {
    styleIsolation: "shared"
  },

  properties: {
    visible: { type: Boolean, value: false },
    containerStyle: { type: String, value: "" },
    uiScaleStyle: { type: String, value: "" },
    showNewbieGiftEntry: { type: Boolean, value: false }
  },

  methods: {
    onNewbieGiftTap() {
      this.triggerEvent("newbiegifttap");
    },

    onLayerButtonTap() {
      this.triggerEvent("layerbuttontap");
    },

    onMarkerButtonTap() {
      this.triggerEvent("markerbuttontap");
    },

    onLocateTap() {
      this.triggerEvent("locatetap");
    }
  }
});
