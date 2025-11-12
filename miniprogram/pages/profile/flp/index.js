const DEFAULT_BALANCE_DISPLAY = "0.00";
const MAP_PAGE_PATH = "/pages/map/map";

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
    }
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
    return {
      title: "晒晒余额~",
      path: MAP_PAGE_PATH
    };
  },

  onShareTimeline() {
    return {
      title: "晒晒余额~",
      query: ""
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
  }
});
