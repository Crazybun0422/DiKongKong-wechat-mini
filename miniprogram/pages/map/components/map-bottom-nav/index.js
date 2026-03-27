Component({
  options: {
    styleIsolation: "shared"
  },

  properties: {
    visible: { type: Boolean, value: false },
    uiScaleStyle: { type: String, value: "" },
    activeTab: { type: String, value: "home" },
    showProfileRedDot: { type: Boolean, value: false }
  },

  methods: {
    onMenuHomeTap() {
      this.triggerEvent("menuhometap");
    },

    onMenuProfileTap() {
      this.triggerEvent("menuprofiletap");
    },

    onChatButtonTap() {
      this.triggerEvent("chatbuttontap");
    },

    measureProfileButtonRect() {
      return new Promise((resolve) => {
        const query = wx.createSelectorQuery().in(this);
        query.select("#menu-profile-btn").boundingClientRect();
        query.exec((res) => resolve((res && res[0]) || null));
      });
    }
  }
});
