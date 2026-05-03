Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: "请先开通会员" },
    desc: { type: String, value: "当前功能为会员专属" },
    actionText: { type: String, value: "了解会员" }
  },

  methods: {
    noop() { },

    onMaskTap() {
      this.triggerEvent("close");
    },

    onCloseTap() {
      this.triggerEvent("close");
    },

    onConfirmTap() {
      this.triggerEvent("confirm");
    }
  }
});
