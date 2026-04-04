Component({
  options: {
    styleIsolation: "shared"
  },

  properties: {
    visible: { type: Boolean, value: false },
    wideLayout: { type: Boolean, value: false },
    droneCategories: { type: Array, value: [] },
    activeDroneCategoryIndex: { type: Number, value: 0 },
    droneCategoryItems: { type: Array, value: [] },
    pendingDroneIndex: { type: Number, value: null }
  },

  methods: {
    noop() {},

    onMaskTap() {
      this.triggerEvent("close");
    },

    onConfirmTap() {
      this.triggerEvent("confirm");
    },

    onSelectCategory(event = {}) {
      const index = Number(event.currentTarget?.dataset?.index);
      this.triggerEvent("selectcategory", { index });
    },

    onSelectOption(event = {}) {
      const index = Number(event.currentTarget?.dataset?.index);
      this.triggerEvent("selectoption", { index });
    }
  }
});
