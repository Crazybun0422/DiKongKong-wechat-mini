Component({
  options: { virtualHost: true },
  properties: {
    info: {
      type: Object,
      value: {}
    }
  },
  data: {
    visible: false
  },
  methods: {
    onToggle() {
      this.setData({ visible: true });
    },
    onClose() {
      this.setData({ visible: false });
    }
  }
});
