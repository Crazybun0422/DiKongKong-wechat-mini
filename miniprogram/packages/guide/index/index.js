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
    autoplay: true,
    agreed: false,
    submitLoading: false,
    contentTopRpx: 0
  },

  onLoad() {
    this.updateContentTopOffset();
    this.loadGuide();
  },

  onShow() {
    const slides = Array.isArray(this.data.slides) ? this.data.slides : [];
    const current = Number.isFinite(this.data.current) ? this.data.current : 0;
    const safeCurrent = Math.min(Math.max(current, 0), Math.max(0, slides.length - 1));
    const title = slides[safeCurrent]?.title || DEFAULT_TITLE;
    if (this._resumeAutoplayTimer) {
      clearTimeout(this._resumeAutoplayTimer);
      this._resumeAutoplayTimer = null;
    }
    this.setData(
      {
        autoplay: false,
        current: safeCurrent,
        title
      },
      () => {
        this._resumeAutoplayTimer = setTimeout(() => {
          this._resumeAutoplayTimer = null;
          this.setData({ autoplay: true });
        }, 200);
      }
    );
  },

  onHide() {
    if (this._resumeAutoplayTimer) {
      clearTimeout(this._resumeAutoplayTimer);
      this._resumeAutoplayTimer = null;
    }
    this.setData({ autoplay: false });
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
        const slides = (Array.isArray(payload.items) ? payload.items : []).map((item = {}) => ({
          ...item,
          _loaded: false
        }));
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

  onGuideImageLoad(event) {
    const index = Number(event?.currentTarget?.dataset?.index);
    if (!Number.isFinite(index) || index < 0) return;
    const slide = this.data.slides?.[index];
    if (!slide || slide._loaded) return;
    this.setData({ [`slides[${index}]._loaded`]: true });
  },

  onGuideImageError(event) {
    const index = Number(event?.currentTarget?.dataset?.index);
    if (!Number.isFinite(index) || index < 0) return;
    const slide = this.data.slides?.[index];
    if (!slide || slide._loaded) return;
    this.setData({ [`slides[${index}]._loaded`]: true });
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
      const tasks = [];
      const agreementVersion = userAgreement?.version || "";
      const privacyVersion = privacyPolicy?.version || "";
      if (agreementVersion) {
        tasks.push(
          recordPolicyAccess(
            {
              agreementType: "terms",
              version: agreementVersion,
              docHash: userAgreement?.docHash,
              scene: "ENTRY"
            },
            { apiBase }
          )
        );
      }
      if (privacyVersion) {
        tasks.push(
          recordPolicyAccess(
            {
              agreementType: "privacy",
              version: privacyVersion,
              docHash: privacyPolicy?.docHash,
              scene: "ENTRY"
            },
            { apiBase }
          )
        );
      }
      return Promise.all(tasks).then((records = []) => {
        const app = typeof getApp === "function" ? getApp() : null;
        if (app && app.globalData) {
          const cached = app.globalData.latestUserProfile || {};
          const cachedRecords = cached.policyAccessRecords || {};
          const nextRecords = { ...cachedRecords };
          records.forEach((record) => {
            const type = `${record?.agreementType || ""}`.toLowerCase();
            if (type) {
              nextRecords[type] = record;
            }
          });
          if (agreementVersion && !nextRecords.terms) {
            nextRecords.terms = {
              agreementType: "terms",
              version: agreementVersion,
              docHash: userAgreement?.docHash || null
            };
          }
          if (privacyVersion && !nextRecords.privacy) {
            nextRecords.privacy = {
              agreementType: "privacy",
              version: privacyVersion,
              docHash: privacyPolicy?.docHash || null
            };
          }
          app.globalData.latestUserProfile = {
            ...cached,
            policyAccessRecords: nextRecords
          };
          app.globalData.latestUserProfileAt = Date.now();
        }
        return records;
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
