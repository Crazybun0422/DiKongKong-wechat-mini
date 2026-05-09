const {
  fetchUserProfile,
  loadStoredProfile,
  normalizeProfileData,
  persistProfileLocally,
  resolveApiBase
} = require("../../../../utils/profile");
const { fetchWechatPaymentStatus } = require("../../../../utils/payments");
const {
  MEMBER_CYCLES,
  MEMBER_PAYMENT_MODES,
  fetchMemberRechargeConfig,
  rechargeMember
} = require("../../../../utils/membership");
const { fetchMemberGroupQrcode } = require("../../../../utils/member-group-qrcode");

const MEMBER_QRCODE_FRAME_LONG_SIDE_RPX = 356;
const MEMBER_QRCODE_FRAME_MIN_SHORT_SIDE_RPX = 212;
const MEMBER_QRCODE_FRAME_PADDING_RPX = 8;

const PAYMENT_MODES = [
  { id: MEMBER_PAYMENT_MODES.WECHAT, label: "现金充值" },
  { id: MEMBER_PAYMENT_MODES.FLP, label: "FLP兑换" }
];

function resolveVisiblePaymentModes(config = {}) {
  const cashPaymentEnabled = config?.cashPaymentEnabled === true;
  return PAYMENT_MODES.filter((item) =>
    item.id !== MEMBER_PAYMENT_MODES.WECHAT || cashPaymentEnabled
  );
}

function resolveDefaultPaymentMode(config = {}, currentMode = "") {
  const visibleModes = resolveVisiblePaymentModes(config);
  const normalizedCurrent = `${currentMode || ""}`.trim().toUpperCase();
  if (visibleModes.some((item) => item.id === normalizedCurrent)) {
    return normalizedCurrent;
  }
  return visibleModes[0]?.id || MEMBER_PAYMENT_MODES.FLP;
}

const CYCLES = [
  {
    cycle: MEMBER_CYCLES.YEARLY,
    name: "年度高级会员",
    duration: "（12个月）",
    desc: "加鸡腿",
    badge: "多数人选择"
  },
  {
    cycle: MEMBER_CYCLES.MONTHLY,
    name: "月度高级会员",
    duration: "（1个月）",
    desc: "一杯奶茶",
    badge: ""
  }
];

function pickLocalizedMessage(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";
    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try {
        return pickLocalizedMessage(JSON.parse(text)) || text;
      } catch (err) {
        return text;
      }
    }
    return text;
  }
  if (typeof value === "object") {
    return (
      pickLocalizedMessage(value.zh) ||
      pickLocalizedMessage(value["zh-CN"]) ||
      pickLocalizedMessage(value.cn) ||
      pickLocalizedMessage(value.message) ||
      pickLocalizedMessage(value.error) ||
      pickLocalizedMessage(value.en)
    );
  }
  return `${value}`;
}

function normalizeRechargeErrorMessage(err, fallback = "支付失败，请稍后重试") {
  return (
    pickLocalizedMessage(err?.displayMessage) ||
    pickLocalizedMessage(err?.response?.message) ||
    pickLocalizedMessage(err?.response?.data?.message) ||
    pickLocalizedMessage(err?.message) ||
    fallback
  );
}

function buildMemberQrcodeFrameStyle(width = 0, height = 0) {
  const normalizedWidth = Number(width);
  const normalizedHeight = Number(height);
  let imageWidth = MEMBER_QRCODE_FRAME_LONG_SIDE_RPX;
  let imageHeight = MEMBER_QRCODE_FRAME_LONG_SIDE_RPX;

  if (Number.isFinite(normalizedWidth) && Number.isFinite(normalizedHeight) && normalizedWidth > 0 && normalizedHeight > 0) {
    const ratio = normalizedWidth / normalizedHeight;
    if (ratio >= 1) {
      imageWidth = MEMBER_QRCODE_FRAME_LONG_SIDE_RPX;
      imageHeight = Math.max(
        MEMBER_QRCODE_FRAME_MIN_SHORT_SIDE_RPX,
        Math.round(MEMBER_QRCODE_FRAME_LONG_SIDE_RPX / ratio)
      );
    } else {
      imageHeight = MEMBER_QRCODE_FRAME_LONG_SIDE_RPX;
      imageWidth = Math.max(
        MEMBER_QRCODE_FRAME_MIN_SHORT_SIDE_RPX,
        Math.round(MEMBER_QRCODE_FRAME_LONG_SIDE_RPX * ratio)
      );
    }
  }

  const cardWidth = imageWidth + MEMBER_QRCODE_FRAME_PADDING_RPX * 2;
  const cardHeight = imageHeight + MEMBER_QRCODE_FRAME_PADDING_RPX * 2;

  return {
    cardStyle: `width: ${cardWidth}rpx; height: ${cardHeight}rpx; padding: ${MEMBER_QRCODE_FRAME_PADDING_RPX}rpx;`,
    imageStyle: `width: ${imageWidth}rpx; height: ${imageHeight}rpx;`
  };
}

function resolveQrcodeImageInfo(src = "") {
  const target = `${src || ""}`.trim();
  if (!target || typeof wx === "undefined" || typeof wx.getImageInfo !== "function") {
    return Promise.reject(new Error("qrcode-image-info-unavailable"));
  }
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: target,
      success: (info) => resolve(info || {}),
      fail: (err) => reject(err || new Error("qrcode-image-info-failed"))
    });
  });
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(value) {
        if (value) {
          this.preparePopup();
        } else {
          const frameStyle = buildMemberQrcodeFrameStyle();
          this.setData({
            successVisible: false,
            memberGroupQrcodeUrl: "",
            memberGroupQrcodeLoading: false,
            memberGroupQrcodeReady: false,
            memberGroupQrcodeCardStyle: frameStyle.cardStyle,
            memberGroupQrcodeImageStyle: frameStyle.imageStyle
          });
        }
      }
    },
    expireText: {
      type: String,
      value: "暂未获得"
    }
  },

  data: {
    paymentModes: PAYMENT_MODES,
    paymentMode: MEMBER_PAYMENT_MODES.WECHAT,
    selectedCycle: MEMBER_CYCLES.YEARLY,
    rechargeConfig: null,
    plans: [],
    submitting: false,
    successVisible: false,
    memberGroupQrcodeUrl: "",
    memberGroupQrcodeLoading: false,
    memberGroupQrcodeReady: false,
    memberGroupQrcodeCardStyle: buildMemberQrcodeFrameStyle().cardStyle,
    memberGroupQrcodeImageStyle: buildMemberQrcodeFrameStyle().imageStyle
  },

  lifetimes: {
    attached() {
      this.setData({ plans: this.buildPlans({}, this.data.paymentMode) });
      if (this.data.visible) {
        this.preparePopup();
      }
    }
  },

  methods: {
    noop() {},

    preparePopup() {
      const rechargeConfig = this.data.rechargeConfig || {};
      const paymentMode = resolveDefaultPaymentMode(rechargeConfig, this.data.paymentMode);
      const frameStyle = buildMemberQrcodeFrameStyle();
      this.setData({
        successVisible: false,
        memberGroupQrcodeUrl: "",
        memberGroupQrcodeLoading: false,
        memberGroupQrcodeReady: false,
        memberGroupQrcodeCardStyle: frameStyle.cardStyle,
        memberGroupQrcodeImageStyle: frameStyle.imageStyle,
        paymentModes: resolveVisiblePaymentModes(rechargeConfig),
        paymentMode,
        plans: this.buildPlans(rechargeConfig, paymentMode)
      });
      if (!this.data.rechargeConfig && !this._configPromise) {
        this.loadRechargeConfig();
      }
    },

    loadRechargeConfig() {
      this._configPromise = fetchMemberRechargeConfig()
        .then((config = {}) => {
          const paymentMode = resolveDefaultPaymentMode(config, this.data.paymentMode);
          this.setData({
            rechargeConfig: config,
            paymentModes: resolveVisiblePaymentModes(config),
            paymentMode,
            plans: this.buildPlans(config, paymentMode)
          });
          return config;
        })
        .catch((err) => {
          console.warn("load member recharge config failed", err);
          const fallbackConfig = {};
          const paymentMode = resolveDefaultPaymentMode(fallbackConfig, this.data.paymentMode);
          this.setData({
            paymentModes: resolveVisiblePaymentModes(fallbackConfig),
            paymentMode,
            plans: this.buildPlans(fallbackConfig, paymentMode)
          });
          return null;
        })
        .finally(() => {
          this._configPromise = null;
        });
      return this._configPromise;
    },

    buildPlans(config = {}, paymentMode = MEMBER_PAYMENT_MODES.WECHAT) {
      const isFlp = paymentMode === MEMBER_PAYMENT_MODES.FLP;
      return CYCLES.map((item) => {
        const prefix = item.cycle === MEMBER_CYCLES.YEARLY ? "yearly" : "monthly";
        const netKey = `${prefix}${isFlp ? "Flp" : "Wechat"}NetPrice`;
        const listKey = `${prefix}${isFlp ? "Flp" : "Wechat"}ListPrice`;
        const unit = isFlp ? "FLP" : "¥";
        return Object.assign({}, item, {
          price: this.formatPrice(config[netKey], unit),
          originalPrice: this.formatPrice(config[listKey], unit)
        });
      });
    },

    formatPrice(value, unit = "¥") {
      const number = Number(value);
      if (!Number.isFinite(number) || number <= 0) {
        return `${unit}--`;
      }
      const text = number % 1 === 0
        ? `${number}`
        : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
      return `${unit}${text}`;
    },

    onMaskTap() {
      if (this.data.submitting) return;
      this.triggerEvent("close");
    },

    onModeTap(e) {
      const mode = e.currentTarget?.dataset?.mode || "";
      if (!mode || mode === this.data.paymentMode || this.data.submitting) return;
      this.setData({
        paymentMode: mode,
        plans: this.buildPlans(this.data.rechargeConfig || {}, mode)
      });
    },

    onPlanTap(e) {
      const cycle = e.currentTarget?.dataset?.cycle || "";
      if (!cycle || cycle === this.data.selectedCycle || this.data.submitting) return;
      this.setData({ selectedCycle: cycle });
    },

    onConfirmTap() {
      if (this.data.submitting) return;
      const cycle = this.data.selectedCycle || MEMBER_CYCLES.YEARLY;
      const paymentMode = this.data.paymentMode || MEMBER_PAYMENT_MODES.WECHAT;
      let loadingClosed = false;
      const closeLoading = () => {
        if (loadingClosed) return;
        loadingClosed = true;
        if (typeof wx.hideLoading === "function") {
          wx.hideLoading();
        }
      };
      this.setData({ submitting: true });
      if (typeof wx.showLoading === "function") {
        wx.showLoading({
          title: paymentMode === MEMBER_PAYMENT_MODES.FLP ? "正在兑换..." : "正在支付...",
          mask: true
        });
      }
      rechargeMember({ cycle, paymentMode })
        .then((result = {}) => {
          if (paymentMode === MEMBER_PAYMENT_MODES.WECHAT) {
            return this.invokeWechatPayment(result)
              .then(() => this.pollPaymentStatus(result.orderId))
              .then(() => result);
          }
          return result;
        })
        .then(() => this.refreshProfile())
        .then((profile) => {
          closeLoading();
          const frameStyle = buildMemberQrcodeFrameStyle();
          this.setData({
            successVisible: true,
            memberGroupQrcodeUrl: "",
            memberGroupQrcodeLoading: true,
            memberGroupQrcodeReady: false,
            memberGroupQrcodeCardStyle: frameStyle.cardStyle,
            memberGroupQrcodeImageStyle: frameStyle.imageStyle
          });
          this.loadMemberGroupQrcode();
          this.triggerEvent("success", { profile });
        })
        .catch((err) => {
          console.warn("member recharge failed", err);
          closeLoading();
          const message = normalizeRechargeErrorMessage(err);
          wx.showToast({ title: message, icon: "none", duration: 2500 });
        })
        .finally(() => {
          closeLoading();
          this.setData({ submitting: false });
        });
    },

    invokeWechatPayment(prepay = {}) {
      return new Promise((resolve, reject) => {
        if (!prepay) {
          const error = new Error("缺少微信支付参数");
          error.displayMessage = "缺少微信支付参数";
          reject(error);
          return;
        }
        if (typeof wx === "undefined" || typeof wx.requestPayment !== "function") {
          const error = new Error("当前环境不支持微信支付");
          error.displayMessage = "当前环境不支持微信支付";
          reject(error);
          return;
        }
        const timeStamp = `${prepay.timeStamp || prepay.timestamp || ""}`;
        const nonceStr = prepay.nonceStr || "";
        const packageValue = prepay.packageValue || prepay.package || "";
        const signType = prepay.signType || "RSA";
        const paySign = prepay.paySign || "";
        if (!timeStamp || !nonceStr || !packageValue || !paySign) {
          const error = new Error("微信支付参数不完整");
          error.displayMessage = "微信支付参数不完整";
          reject(error);
          return;
        }
        wx.requestPayment({
          timeStamp,
          nonceStr,
          package: packageValue,
          signType,
          paySign,
          success: () => resolve(),
          fail: (err) => {
            const message = err?.errMsg || "微信支付失败";
            const cancelled = /cancel/i.test(message);
            const error = new Error(cancelled ? "已取消微信支付" : message);
            error.displayMessage = error.message;
            reject(error);
          }
        });
      });
    },

    pollPaymentStatus(orderId, options = {}) {
      if (!orderId) {
        const error = new Error("缺少支付订单标识");
        error.displayMessage = "缺少支付订单标识";
        return Promise.reject(error);
      }
      const timeoutMs = Math.max(Number(options.timeoutMs) || 0, 0) || 10000;
      const intervalMs = Math.max(Number(options.intervalMs) || 0, 0) || 1000;
      const deadline = Date.now() + timeoutMs;
      const attempt = () =>
        fetchWechatPaymentStatus(orderId)
          .then((status = {}) => {
            if (status.paid) return status;
            if (Date.now() >= deadline) {
              const error = new Error("支付结果确认超时，请稍后查看会员状态");
              error.displayMessage = "支付结果确认超时，请稍后查看会员状态";
              throw error;
            }
            return new Promise((resolve, reject) => {
              setTimeout(() => {
                attempt().then(resolve).catch(reject);
              }, intervalMs);
            });
          });
      return attempt();
    },

    refreshProfile() {
      const stored = loadStoredProfile() || {};
      return fetchUserProfile()
        .then((remote) => {
          const profile = normalizeProfileData(remote, {
            storedProfile: stored,
            apiBase: resolveApiBase()
          });
          persistProfileLocally(profile);
          return profile;
        })
        .catch((err) => {
          console.warn("refresh member profile after recharge failed", err);
          return null;
        });
    },

    loadMemberGroupQrcode() {
      return fetchMemberGroupQrcode()
        .then((payload = {}) => {
          const remoteUrl = `${payload.imageUrl || ""}`.trim();
          if (!remoteUrl) {
            const frameStyle = buildMemberQrcodeFrameStyle();
            this.setData({
              memberGroupQrcodeUrl: "",
              memberGroupQrcodeLoading: false,
              memberGroupQrcodeReady: false,
              memberGroupQrcodeCardStyle: frameStyle.cardStyle,
              memberGroupQrcodeImageStyle: frameStyle.imageStyle
            });
            return payload;
          }
          return resolveQrcodeImageInfo(remoteUrl)
            .then((info = {}) => {
              const frameStyle = buildMemberQrcodeFrameStyle(info.width, info.height);
              this.setData({
                memberGroupQrcodeUrl: info.path || remoteUrl,
                memberGroupQrcodeLoading: false,
                memberGroupQrcodeReady: true,
                memberGroupQrcodeCardStyle: frameStyle.cardStyle,
                memberGroupQrcodeImageStyle: frameStyle.imageStyle
              });
              return payload;
            })
            .catch((err) => {
              console.warn("resolve member group qrcode image info failed", err);
              const frameStyle = buildMemberQrcodeFrameStyle();
              this.setData({
                memberGroupQrcodeUrl: "",
                memberGroupQrcodeLoading: false,
                memberGroupQrcodeReady: false,
                memberGroupQrcodeCardStyle: frameStyle.cardStyle,
                memberGroupQrcodeImageStyle: frameStyle.imageStyle
              });
              return payload;
            });
        })
        .catch((err) => {
          console.warn("load member group qrcode failed", err);
          const frameStyle = buildMemberQrcodeFrameStyle();
          this.setData({
            memberGroupQrcodeUrl: "",
            memberGroupQrcodeLoading: false,
            memberGroupQrcodeReady: false,
            memberGroupQrcodeCardStyle: frameStyle.cardStyle,
            memberGroupQrcodeImageStyle: frameStyle.imageStyle
          });
          return null;
        });
    },

    onMemberGroupQrcodeLoad(e) {
      const width = Number(e?.detail?.width);
      const height = Number(e?.detail?.height);
      const frameStyle = buildMemberQrcodeFrameStyle(width, height);
      this.setData({
        memberGroupQrcodeReady: true,
        memberGroupQrcodeCardStyle: frameStyle.cardStyle,
        memberGroupQrcodeImageStyle: frameStyle.imageStyle
      });
    },

    onSuccessConfirmTap() {
      this.triggerEvent("close");
    }
  }
});
