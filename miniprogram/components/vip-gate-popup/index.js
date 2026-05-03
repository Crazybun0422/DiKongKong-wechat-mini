Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: "请先开通会员" },
    desc: { type: String, value: "当前功能为会员专属，点击优惠开通前往会员页。" },
    actionText: { type: String, value: "优惠开通" }
  },

  methods: {
    noop() {},

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
