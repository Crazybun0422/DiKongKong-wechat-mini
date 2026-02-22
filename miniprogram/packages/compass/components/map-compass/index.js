Component({
  properties: {
    rotate: {
      type: Number,
      value: 0
    },
    skew: {
      type: Number,
      value: 0
    },
    satellite: {
      type: Boolean,
      value: false
    }
  },
  methods: {
    onTap() {
      this.triggerEvent("compasstap");
    }
  }
});
