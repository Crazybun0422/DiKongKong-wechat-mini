Component({
  options: {
    styleIsolation: "shared"
  },

  properties: {
    detailCard: { type: Object, value: null },
    markerDetailClosing: { type: Boolean, value: false },
    markerDetailExpanding: { type: Boolean, value: false },
    markerDetailAllowExpand: { type: Boolean, value: false },
    markerDetailCurrentImage: { type: Number, value: 0 },
    markerDetailVideoLoading: { type: Boolean, value: false },
    markerLikeAnimating: { type: Boolean, value: false },
    markerLikeHintLabel: { type: String, value: "" },
    markerLikeResultLabel: { type: String, value: "" },
    markerLiked: { type: Boolean, value: false },
    markerLikeCount: { type: Number, value: 0 },
    markerLikeCountDisplay: { type: String, value: "" },
    markerSvipIconPath: { type: String, value: "" }
  },

  methods: {
    emitDataset(name, event = {}, extra = {}) {
      this.triggerEvent(name, Object.assign({}, extra, {
        dataset: event.currentTarget?.dataset || {}
      }));
    },

    emitTouch(name, event = {}, extra = {}) {
      this.triggerEvent(name, Object.assign({}, extra, {
        touches: event.touches || [],
        changedTouches: event.changedTouches || []
      }));
    },

    onMaskTap() {
      this.triggerEvent("masktap");
    },

    onMaskTouchMove() {
      this.triggerEvent("masktouchmove");
    },

    onTouchStart(event = {}) {
      this.emitTouch("touchstart", event);
    },

    onTouchMove(event = {}) {
      this.emitTouch("touchmove", event);
    },

    onTouchEnd(event = {}) {
      this.emitTouch("touchend", event);
    },

    onTouchCancel(event = {}) {
      this.emitTouch("touchcancel", event);
    },

    onLikeTouchStart(event = {}) {
      this.emitTouch("liketouchstart", event, { page: false });
    },

    onLikeTouchEnd(event = {}) {
      this.emitTouch("liketouchend", event, { page: false });
    },

    onLikeCountTap(event = {}) {
      const count = Number(event.currentTarget?.dataset?.count);
      this.triggerEvent("likecounttap", { count });
    },

    onSwiperChange(event = {}) {
      this.triggerEvent("swiperchange", event.detail || {});
    },

    onVideoWaiting(event = {}) {
      this.emitDataset("videowaiting", event);
    },

    onVideoReady(event = {}) {
      this.emitDataset("videoready", event);
    },

    onInlineVideoTap(event = {}) {
      this.emitDataset("inlinevideotap", event);
    },

    onCreatorTap() {
      this.triggerEvent("creatortap");
    }
  }
});
