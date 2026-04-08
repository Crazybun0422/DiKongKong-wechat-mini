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
    items(list = []) {
      const currentItem = Array.isArray(list) && list.length ? (list[0] || null) : null;
      this.setData({ currentItem });
    }
  },

  methods: {
    onTap() {
      this.triggerEvent("weathertap");
    }
  }
});
