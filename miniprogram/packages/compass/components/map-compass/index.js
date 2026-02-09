Component({
  properties: {
    rotate: {
      type: Number,
      value: 0
    },
    skew: {
      type: Number,
      value: 0
    }
  },
  methods: {
    onTap() {
      this.triggerEvent("compasstap");
    }
  }
});
