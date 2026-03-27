Component({
  options: {
    styleIsolation: "shared"
  },

  properties: {
    visible: { type: Boolean, value: false },
    wideLayout: { type: Boolean, value: false },
    coordinateSystem: { type: String, value: "gcj02" },
    coordinateSystemOptions: { type: Array, value: [] },
    coordinateSystemDescriptionNodes: { type: null, value: "" }
  },

  methods: {
    noop() {},

    onMaskTap() {
      this.triggerEvent("masktap");
    },

    onOptionTap(event = {}) {
      const value = event.currentTarget?.dataset?.value || "";
      this.triggerEvent("optiontap", { value });
    }
  }
});
