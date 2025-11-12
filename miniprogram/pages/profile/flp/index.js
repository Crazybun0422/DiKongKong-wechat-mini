const DEFAULT_BALANCE_DISPLAY = "0.00";
const MAP_PAGE_PATH = "/pages/map/map";
const {
  fetchUserProfile,
  normalizeProfileData,
  loadStoredProfile,
  persistProfileLocally,
  resolveApiBase
} = require("../../../utils/profile");
const {
  appendInviteCodeToPath,
  appendInviteCodeToQuery,
  getShareInviteCode
} = require("../../../utils/share");

const BENEFIT_ITEMS = [
  {
    id: "invite",
    title: "邀请好友",
    description: "邀请好友得FLP奖励",
    type: "link",
    action: "invite",
    actionText: "分享"
  },
  {
    id: "settlement",
    title: "空域图入驻",
    description: "将低空服务标记在空域图",
    type: "link",
    action: "create-marker",
    actionText: "前往"
  },
  {
    id: "gallery",
    title: "低空线上展馆",
    description: "仅480个抢到不经营可转让",
    type: "tag",
    badge: "V2.0上线"
  },
  {
    id: "market",
    title: "供需大厅",
    description: "用过都说好的低空供需撮合平台",
    type: "tag",
    badge: "V2.0上线"
  },
  {
    id: "mall",
    title: "兑换商城",
    description: "你懂的。",
    type: "tag",
    badge: "V3.0上线"
  }
];

Page({
  data: {
    balance: DEFAULT_BALANCE_DISPLAY,
    detailIcon: "/assets/detais.png",
    benefits: BENEFIT_ITEMS
  },

  onLoad(options = {}) {
    const balance = decodeURIComponent(options.balance || "").trim();
    if (balance) {
      this.setData({ balance });
    } else {
      this.applyStoredBalance();
    }
    this.syncBalanceFromProfile({ silent: true });
  },

  onPullDownRefresh() {
    this.syncBalanceFromProfile({ fromPullDown: true });
  },

  onDetailTap() {
    if (typeof wx.navigateTo === "function") {
      wx.navigateTo({ url: "/pages/profile/flp/logs/index" });
      return;
    }
    wx.showToast({ title: "当前版本暂不支持", icon: "none" });
  },

  onHelpLinkTap() {
    if (typeof wx.navigateTo === "function") {
      wx.navigateTo({ url: "/pages/profile/flp/reward-help/index" });
      return;
    }
    wx.showToast({ title: "当前版本暂不支持", icon: "none" });
  },

  onShareAppMessage() {
    const inviteCode = getShareInviteCode();
    return {
      title: "晒晒余额~",
      path: appendInviteCodeToPath(MAP_PAGE_PATH, { inviteCode })
    };
  },

  onShareTimeline() {
    const inviteCode = getShareInviteCode();
    return {
      title: "晒晒余额~",
      query: appendInviteCodeToQuery("", { inviteCode })
    };
  },

  onBenefitActionTap(event) {
    const action = event?.currentTarget?.dataset?.action;
    if (action === "create-marker") {
      this.navigateToMarkerCreation();
      return;
    }
    if (action === "invite") {
      this.navigateToInvitePage();
    }
  },

  navigateToMarkerCreation() {
    if (typeof wx.navigateTo !== "function") {
      wx.showToast({ title: "当前版本暂不支持", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/markers/index" });
  },

  navigateToInvitePage() {
    if (typeof wx.navigateTo !== "function") {
      wx.showToast({ title: "当前版本暂不支持", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/profile/flp/invite/index" });
  },

  applyStoredBalance() {
    try {
      const stored = loadStoredProfile ? loadStoredProfile() : null;
      const flpValue = stored && typeof stored.flpValue === "number" && isFinite(stored.flpValue)
        ? stored.flpValue
        : null;
      if (flpValue !== null) {
        this.setData({ balance: formatBalanceDisplay(flpValue) });
      }
    } catch (err) {
      console.warn("applyStoredBalance failed", err);
    }
  },

  syncBalanceFromProfile(options = {}) {
    const { fromPullDown = false, silent = false } = options;
    if (this._syncingBalance) {
      if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
      return Promise.resolve();
    }
    this._syncingBalance = true;
    const showNavLoading = !silent && typeof wx.showNavigationBarLoading === "function";
    if (showNavLoading) {
      wx.showNavigationBarLoading();
    }
    const apiBase = resolveApiBase();
    const storedProfile = loadStoredProfile ? loadStoredProfile() : {};
    return fetchUserProfile({ apiBase })
      .then((remoteProfile) => {
        const normalized = normalizeProfileData(remoteProfile, {
          storedProfile,
          apiBase
        });
        persistProfileLocally({
          nickname: normalized.nickname,
          avatarUrl: normalized.avatarFileName || normalized.avatarUrl,
          featureCode: normalized.featureCode,
          flpValue: normalized.flpValue,
          inviteCode: normalized.inviteCode
        });
        if (normalized.flpDisplay && normalized.flpDisplay !== "--") {
          this.setData({ balance: normalized.flpDisplay });
        }
      })
      .catch((err) => {
        const message =
          err && err.message === "missing-token"
            ? "请先登录后再刷新FLP"
            : "刷新FLP失败，请稍后重试";
        if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
          wx.showToast({ title: message, icon: "none" });
        }
        console.warn("syncBalanceFromProfile failed", err);
      })
      .finally(() => {
        this._syncingBalance = false;
        if (showNavLoading && typeof wx.hideNavigationBarLoading === "function") {
          wx.hideNavigationBarLoading();
        }
        if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh();
        }
      });
  }
});

function formatBalanceDisplay(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return DEFAULT_BALANCE_DISPLAY;
  }
  return amount.toFixed(2);
}
