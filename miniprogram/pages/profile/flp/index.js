const DEFAULT_BALANCE_DISPLAY = "0.00";
const MAP_PAGE_PATH = "/pages/map/map";

const BENEFIT_ITEMS = [
  {
    id: "invite",
    title: "邀请好友",
    description: "邀请好友得FLP奖励",
    type: "share",
    actionText: "分享"
  },
  {
    id: "settlement",
    title: "空域图入驻",
    description: "将您空服务标记在空域园",
    type: "link",
    action: "create-marker",
    actionText: "前往"
  },
  {
    id: "gallery",
    title: "低空线上展馆",
    description: "仅480个抢占并节节高可转让",
    type: "tag",
    badge: "V2.0上线"
  },
  {
    id: "market",
    title: "供需大厅",
    description: "用武之地等你的低空供需整合平台",
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
    wx.showToast({ title: "敬请期待", icon: "none" });
  },

  onHelpLinkTap() {
    wx.showToast({ title: "敬请期待", icon: "none" });
  },

  onShareAppMessage() {
    return {
      title: "邀你上天-来空域地图探索新世界",
      path: MAP_PAGE_PATH
    };
  },

  onShareTimeline() {
    return {
      title: "邀你上天-来空域地图探索新世界",
      query: ""
    };
  },

  onBenefitActionTap(event) {
    const action = event?.currentTarget?.dataset?.action;
    if (action === "create-marker") {
      this.navigateToMarkerCreation();
    }
  },

  navigateToMarkerCreation() {
    if (typeof wx.navigateTo !== "function") {
      wx.showToast({ title: "当前版本暂不支持", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/markers/index?create=1" });
  }
});
