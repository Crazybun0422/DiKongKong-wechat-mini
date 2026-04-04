Component({
  options: {
    styleIsolation: "shared"
  },

  properties: {
    markerPageClosing: { type: Boolean, value: false },
    markerPageDetail: { type: Object, value: null },
    markerPageCurrentImage: { type: Number, value: 0 },
    markerPageVideoLoading: { type: Boolean, value: false },
    markerPageLikeAnimating: { type: Boolean, value: false },
    markerPageLikeHintLabel: { type: String, value: "" },
    markerPageLikeResultLabel: { type: String, value: "" },
    markerPageLiked: { type: Boolean, value: false },
    markerPageLikeCount: { type: Number, value: 0 },
    markerPageLikeCountDisplay: { type: String, value: "" },
    markerPageShareEnabled: { type: Boolean, value: false },
    markerPageIsPin: { type: Boolean, value: false },
    markerPageDistanceText: { type: String, value: "" },
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
        changedTouches: event.changedTouches || [],
        detail: event.detail || {}
      }));
    },

    onMaskTap() {
      this.triggerEvent("masktap");
    },

    onScroll(event = {}) {
      this.triggerEvent("scroll", event.detail || {});
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

    onCertificationTap() {
      this.triggerEvent("certificationtap");
    },

    onLikeTouchStart(event = {}) {
      this.emitTouch("liketouchstart", event, { page: true });
    },

    onLikeTouchEnd(event = {}) {
      this.emitTouch("liketouchend", event, { page: true });
    },

    onLikeCountTap(event = {}) {
      const count = Number(event.currentTarget?.dataset?.count);
      this.triggerEvent("likecounttap", { count });
    },

    onPosterTap() {
      this.triggerEvent("postertap");
    },

    onShareDisabledTap() {
      this.triggerEvent("sharedisabledtap");
    },

    onNavigateTap(event = {}) {
      this.emitDataset("navigatetap", event);
    },

    onCallTap(event = {}) {
      this.emitDataset("calltap", event);
    },

    onAttachmentTap(event = {}) {
      this.emitDataset("attachmenttap", event);
    },

    onVideoTap(event = {}) {
      this.emitDataset("videotap", event);
    },

    onCreatorTap() {
      this.triggerEvent("creatortap");
    }
  }
});
