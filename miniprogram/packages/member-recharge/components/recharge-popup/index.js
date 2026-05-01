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

const PAYMENT_MODES = [
  { id: MEMBER_PAYMENT_MODES.WECHAT, label: "现金充值" },
  { id: MEMBER_PAYMENT_MODES.FLP, label: "FLP兑换" }
];

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

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(value) {
        if (value) {
          this.preparePopup();
        } else {
          this.setData({ successVisible: false });
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
    successVisible: false
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
      this.setData({
        successVisible: false,
        plans: this.buildPlans(this.data.rechargeConfig || {}, this.data.paymentMode)
      });
      if (!this.data.rechargeConfig && !this._configPromise) {
        this.loadRechargeConfig();
      }
    },

    loadRechargeConfig() {
      this._configPromise = fetchMemberRechargeConfig()
        .then((config = {}) => {
          this.setData({
            rechargeConfig: config,
            plans: this.buildPlans(config, this.data.paymentMode)
          });
          return config;
        })
        .catch((err) => {
          console.warn("load member recharge config failed", err);
          this.setData({ plans: this.buildPlans({}, this.data.paymentMode) });
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
          this.setData({ successVisible: true });
          this.triggerEvent("success", { profile });
        })
        .catch((err) => {
          console.warn("member recharge failed", err);
          const message = normalizeRechargeErrorMessage(err);
          wx.showToast({ title: message, icon: "none" });
        })
        .finally(() => {
          if (typeof wx.hideLoading === "function") {
            wx.hideLoading();
          }
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

    onSuccessConfirmTap() {
      this.triggerEvent("close");
    }
  }
});
