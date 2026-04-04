Component({
  options: {
    styleIsolation: "shared"
  },

  properties: {
    center: { type: Object, value: null },
    active: { type: Boolean, value: false },
    dialogVisible: { type: Boolean, value: false },
    dialogText: { type: String, value: "" }
  },

  methods: {
    onStateChange(event = {}) {
      this.triggerEvent("statechange", event.detail || {});
    },

    onDialogChange(event = {}) {
      this.triggerEvent("dialogchange", event.detail || {});
    },

    onDialogCloseTap() {
      this.triggerEvent("dialogclose");
    },

    closeDialog() {
      const popup = this.selectComponent("#city-report-h5-entry-inner");
      if (popup && typeof popup.closeDialog === "function") {
        popup.closeDialog();
      }
    },

    noop() {}
  }
});
