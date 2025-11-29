const {
  ensureFeatureCode,
  loadStoredProfile,
  FEATURE_CODE_STORAGE_KEY
} = require("../../../utils/profile");
const {
  fetchFeatureCodeProfiles,
  removeWorkGroupMembers
} = require("../../../utils/workGroups");
const { buildImageUrl } = require("../../../utils/images");

Page({
  data: {
    groupId: "",
    groupName: "",
    ownerFeatureCode: "",
    isOwner: false,
    members: [],
    loading: false
  },

  onLoad() {
    const cached = this.readCachedGroup();
    if (!cached) {
      wx.showToast({ title: "未获取到工作组信息", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
      return;
    }
    const profile = loadStoredProfile() || {};
    let selfCode = ensureFeatureCode(profile.featureCode || "");
    if (!selfCode) {
      try {
        const stored = wx.getStorageSync(FEATURE_CODE_STORAGE_KEY);
        selfCode = ensureFeatureCode(stored || "");
      } catch (err) {
        console.warn("read feature code from storage failed", err);
      }
    }
    const ownerCode = ensureFeatureCode(cached.ownerFeatureCode || "");
    this.setData(
      {
        groupId: cached.id || "",
        groupName: cached.name || "工作组",
        ownerFeatureCode: ownerCode || selfCode,
        isOwner: cached.isOwner || (!!selfCode && !!ownerCode && selfCode === ownerCode),
        members: Array.isArray(cached.memberFeatureCodes)
          ? cached.memberFeatureCodes.map((code) => ({
            featureCode: ensureFeatureCode(code),
            nickname: ensureFeatureCode(code),
            avatarUrl: "/assets/default-avatar.png",
            isOwner: ensureFeatureCode(code) === (ownerCode || selfCode)
          }))
          : []
      },
      () => {
        this.loadMembers(cached.memberFeatureCodes || []);
      }
    );
  },

  onUnload() {
    try {
      wx.removeStorageSync("workGroupMembersTemp");
    } catch (err) {
      console.warn("clean storage failed", err);
    }
  },

  readCachedGroup() {
    try {
      const cached = wx.getStorageSync("workGroupMembersTemp");
      if (cached && cached.id) return cached;
    } catch (err) {
      console.warn("read cache failed", err);
    }
    return null;
  },

  loadMembers(codes = []) {
    const list = Array.isArray(codes) ? codes.filter(Boolean) : [];
    const fallbackMembers = list.map((code) => ({
      featureCode: ensureFeatureCode(code),
      nickname: ensureFeatureCode(code),
      avatarUrl: "/assets/default-avatar.png",
      isOwner: ensureFeatureCode(code) === this.data.ownerFeatureCode
    }));
    this.setData({ loading: true, members: fallbackMembers });
    if (!list.length) {
      this.setData({ loading: false });
      return;
    }
    fetchFeatureCodeProfiles(list, {})
      .then((profiles = []) => {
        const merged = list.map((code) => {
          const profile = profiles.find((p) => ensureFeatureCode(p.featureCode) === ensureFeatureCode(code)) || {};
          const avatarUrl = buildImageUrl(profile.avatarUrl || profile.avatar || profile.fileName || "", {
            fallback: "/assets/default-avatar.png"
          });
          return {
            featureCode: ensureFeatureCode(code),
            nickname: profile.nickname || code,
            avatarUrl,
            isOwner: ensureFeatureCode(code) === this.data.ownerFeatureCode
          };
        });
        this.setData({ members: merged });
      })
      .catch((err) => {
        console.warn("load members failed", err);
        wx.showToast({ title: "成员加载失败，使用本地列表", icon: "none" });
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  onRemoveTap(e) {
    const code = ensureFeatureCode(e?.currentTarget?.dataset?.code || "");
    if (!code || code === this.data.ownerFeatureCode) return;
    if (!this.data.isOwner) {
      wx.showToast({ title: "仅管理员可移除", icon: "none" });
      return;
    }
    wx.showModal({
      title: "移除成员",
      content: `确认移除 ${code} ？`,
      confirmText: "移除",
      confirmColor: "#ff3b30",
      success: (res) => {
        if (!res.confirm) return;
        removeWorkGroupMembers(this.data.groupId, [code], {})
          .then(() => {
            wx.showToast({ title: "已移除", icon: "success" });
            const remain = this.data.members.filter((m) => ensureFeatureCode(m.featureCode) !== code);
            this.setData({ members: remain });
            try {
              wx.setStorageSync("workGroupMembersChanged", true);
              const cached = wx.getStorageSync("workGroupMembersTemp") || {};
              cached.memberFeatureCodes = remain.map((m) => m.featureCode);
              cached.memberCount = remain.length;
              wx.setStorageSync("workGroupMembersTemp", cached);
            } catch (err) {
              console.warn("set members changed flag failed", err);
            }
          })
          .catch((err) => {
            console.error("移除成员失败", err);
            wx.showToast({ title: err?.message || "移除失败", icon: "none" });
          });
      }
    });
  }
});
