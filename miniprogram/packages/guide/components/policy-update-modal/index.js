Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    updateType: {
      type: String,
      value: ""
    },
    title: {
      type: String,
      value: ""
    },
    loading: {
      type: Boolean,
      value: false
    },
    closing: {
      type: Boolean,
      value: false
    }
  },

  data: {},

  methods: {
    onMaskTap() {},
    onMaskTouchMove() {},
    onAgreeTap() {
      this.triggerEvent("agree");
    },
    onDisagreeTap() {
      this.triggerEvent("disagree");
    },
    onAgreementTap() {
      this.triggerEvent("agreement");
    },
    onPrivacyTap() {
      this.triggerEvent("privacy");
    }
  }
});
