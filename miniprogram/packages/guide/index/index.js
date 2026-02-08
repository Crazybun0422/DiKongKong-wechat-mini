const { fetchGuideUrls } = require("../../../utils/guide");
const {
  fetchLatestUserAgreement,
  fetchLatestPrivacyPolicy,
  recordPolicyAccess
} = require("../../../utils/policies");
const { resolveApiBase } = require("../../../utils/profile");

const DEFAULT_TITLE = "";
const DEFAULT_ERROR = "加载失败";
const TOAST_NEED_AGREE = "请先同意用户协议和隐私政策";
const TOAST_SUBMIT_FAIL = "提交失败，请稍后重试";

Page({
  data: {
    loading: true,
    error: "",
    title: DEFAULT_TITLE,
    slides: [],
    current: 0,
    agreed: false,
    submitLoading: false,
    contentTopRpx: 0
  },

  onLoad() {
    this.updateContentTopOffset();
    this.loadGuide();
  },

  onRetryTap() {
    this.loadGuide();
  },

  loadGuide() {
    this.setData({ loading: true, error: "" });
    const apiBase = resolveApiBase();
    if (!apiBase) {
      this.setData({ loading: false, error: "未配置服务地址" });
      return;
    }
    fetchGuideUrls({ apiBase })
      .then((payload = {}) => {
        const slides = Array.isArray(payload.items) ? payload.items : [];
        const title = slides[0]?.title || payload.title || DEFAULT_TITLE;
        this.setData({
          title,
          slides,
          current: 0,
          loading: false,
          error: ""
        });
      })
      .catch((err) => {
        this.setData({
          loading: false,
          error: err?.message || DEFAULT_ERROR,
          slides: []
        });
      });
  },

  updateContentTopOffset() {
    let windowWidth = 375;
    let statusBarHeight = 0;
    let capsuleBottom = 0;
    try {
      const info = typeof wx.getWindowInfo === "function"
        ? wx.getWindowInfo()
        : wx.getSystemInfoSync();
      windowWidth = Number(info?.windowWidth) || windowWidth;
      statusBarHeight = Number(info?.statusBarHeight) || 0;
    } catch (err) {
      windowWidth = 375;
      statusBarHeight = 0;
    }

    try {
      if (typeof wx.getMenuButtonBoundingClientRect === "function") {
        const rect = wx.getMenuButtonBoundingClientRect();
        if (rect && Number.isFinite(rect.bottom)) {
          capsuleBottom = rect.bottom;
        }
      }
    } catch (err) {
      capsuleBottom = 0;
    }

    if (!capsuleBottom) {
      capsuleBottom = statusBarHeight + 44;
    }

    const pxToRpx = 750 / (windowWidth || 375);
    const baseRpx = Math.round(capsuleBottom * pxToRpx);
    const offsetRpx = baseRpx + 100;
    const safeOffset = Math.max(120, offsetRpx);
    this.setData({ contentTopRpx: safeOffset });
  },

  onSwiperChange(event) {
    const current = Number(event?.detail?.current) || 0;
    const title = this.data.slides?.[current]?.title || DEFAULT_TITLE;
    this.setData({ current, title });
  },

  onToggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  onUserAgreementTap() {
    wx.navigateTo({ url: "/packages/guide/policy/index?type=agreement" });
  },

  onPrivacyPolicyTap() {
    wx.navigateTo({ url: "/packages/guide/policy/index?type=privacy" });
  },

  onStartTap() {
    if (!this.data.agreed) {
      wx.showToast({ title: TOAST_NEED_AGREE, icon: "none" });
      return;
    }
    if (this.data.submitLoading) return;
    this.setData({ submitLoading: true });
    this.submitPolicyAccess()
      .then(() => this.ensureLocationPermission().catch(() => {}))
      .then(() => this.goMap())
      .catch((err) => {
        console.warn("submit policy access failed", err);
        wx.showToast({ title: TOAST_SUBMIT_FAIL, icon: "none" });
      })
      .finally(() => {
        this.setData({ submitLoading: false });
      });
  },

  submitPolicyAccess() {
    const apiBase = resolveApiBase();
    return Promise.all([
      fetchLatestUserAgreement({ apiBase }),
      fetchLatestPrivacyPolicy({ apiBase })
    ]).then(([userAgreement, privacyPolicy]) => {
      const versions = {
        userAgreementVersion: userAgreement?.version || "",
        privacyPolicyVersion: privacyPolicy?.version || ""
      };
      return recordPolicyAccess(versions, { apiBase }).then((record) => {
        const app = typeof getApp === "function" ? getApp() : null;
        if (app && app.globalData) {
          const cached = app.globalData.latestUserProfile || {};
          app.globalData.latestUserProfile = {
            ...cached,
            policyAccessRecord: {
              userAgreementVersion: versions.userAgreementVersion || cached?.policyAccessRecord?.userAgreementVersion || "",
              privacyPolicyVersion: versions.privacyPolicyVersion || cached?.policyAccessRecord?.privacyPolicyVersion || "",
              createdAt: record?.createdAt || cached?.policyAccessRecord?.createdAt || ""
            }
          };
          app.globalData.latestUserProfileAt = Date.now();
        }
        return record;
      });
    });
  },

  ensureLocationPermission() {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (res) => {
          const granted = !!(res.authSetting && res.authSetting["scope.userLocation"]);
          if (granted) {
            resolve();
            return;
          }
          this.authorizeLocation().then(resolve).catch(reject);
        },
        fail: reject
      });
    });
  },

  authorizeLocation() {
    return new Promise((resolve, reject) => {
      wx.authorize({
        scope: "scope.userLocation",
        success: () => resolve(),
        fail: () => {
          wx.openSetting({
            success: (st) => {
              const granted = !!(st.authSetting && st.authSetting["scope.userLocation"]);
              if (granted) resolve();
              else reject(new Error("permission-denied"));
            },
            fail: (err) => reject(err)
          });
        }
      });
    });
  },

  goMap() {
    wx.reLaunch({
      url: "/pages/map/map",
      fail: (err) => {
        console.warn("guide goMap failed", err);
      }
    });
  }
});
