const {
  DEFAULT_AVATAR_PATH,
  fetchUserProfile,
  normalizeProfileData,
  loadStoredProfile,
  persistProfileLocally,
  resolveApiBase,
  getAuthToken,
  prepareAvatarForUpload,
  uploadAvatarFile,
  updateUserProfile
} = require("../../utils/profile");
const { fetchMyLikes } = require("../../utils/likes");
const {
  fetchLatestSubscriptionPush,
  SUBSCRIPTION_TEMPLATE_ID,
  fetchSubscriptions,
  requestSubscribeMessageForTemplateIds,
  normalizeTemplateIds
} = require("../../utils/subscriptions");
const { SUBSCRIPTION_TEMPLATE_IDS } = require("../../config/subscription-templates");
const {
  updateLatestItemVersion,
  fetchLatestItemVersion,
  normalizeVersion
} = require("../../utils/latest-items");
const { fetchCheckinDetail } = require("../../utils/checkin");

const NICKNAME_MAX_UNITS = 16;
const NICKNAME_CJK_RE = /[\u4e00-\u9fff]/;

function truncateNicknameByUnits(value, maxUnits = NICKNAME_MAX_UNITS) {
  let total = 0;
  let output = "";
  for (const char of Array.from(value || "")) {
    const nextTotal = total + (NICKNAME_CJK_RE.test(char) ? 2 : 1);
    if (nextTotal > maxUnits) break;
    total = nextTotal;
    output += char;
  }
  return output;
}

function getWindowMetrics() {
  let windowInfo = {};
  if (typeof wx !== "undefined" && typeof wx.getWindowInfo === "function") {
    try {
      windowInfo = wx.getWindowInfo() || {};
    } catch (err) {
      windowInfo = {};
    }
  }
  const windowWidth = Number(windowInfo.windowWidth) || 375;
  const windowHeight = Number(windowInfo.windowHeight) || 667;
  const screenWidth = Number(windowInfo.screenWidth) || windowWidth;
  const screenHeight = Number(windowInfo.screenHeight) || windowHeight;
  return { windowWidth, windowHeight, screenWidth, screenHeight };
}

function resolveNicknameUpdateErrorMessage(err) {
  if (err?.message === "missing-token") {
    return "请先登录后再试";
  }
  if (Number(err?.statusCode) === 400) {
    return "名称重复";
  }
  return err?.displayMessage || err?.message || "更新失败，请稍后重试";
}

Page({
  data: {
    loading: true,
    error: "",
    profile: null,
    defaultAvatar: DEFAULT_AVATAR_PATH,
    activeTab: "profile",
    customerServiceSessionFrom: "profile-customer-service",
    nicknameEditing: false,
    nicknameInput: "",
    nicknameSaving: false,
    likeSummary: { total: "--" },
    showSubscriptionRedDot: false,
    showSubscribeWaitOverlay: false,
    checkinTodaySigned: false,
    statusBadgeStyle: "",
    avatarActionSheetVisible: false,
    showCheckinGuideProfile: false,
    checkinGuideOverlayStyle: "",
    checkinGuideMask: {
      top: 0,
      left: 0,
      size: 0,
      rightLeft: 0,
      bottomTop: 0
    },
    checkinGuideIntroduce: {
      left: 0,
      top: 0
    },
    showInviteGuideProfile: false,
    inviteGuideMask: {
      top: 0,
      left: 0,
      width: 0,
      height: 0,
      rightLeft: 0,
      bottomTop: 0
    }
  },

  loadLikeSummary() {
    const apiBase = resolveApiBase();
    fetchMyLikes({ apiBase })
      .then((summary = {}) => {
        const total = Number(summary.totalLikes);
        const display =
          Number.isFinite(total) && total >= 0
            ? (total >= 1000 ? `${Math.round((total / 1000) * 10) / 10}k` : `${total}`)
            : "--";
        this.setData({ likeSummary: { total: display } });
      })
      .catch((err) => {
        console.warn("loadLikeSummary failed", err);
        this.setData({ likeSummary: { total: "--" } });
      });
  },

  loadCheckinStatus() {
    const apiBase = resolveApiBase();
    if (!apiBase) {
      this.setData({ checkinTodaySigned: false });
      return;
    }
    fetchCheckinDetail({ apiBase })
      .then((detail = {}) => {
        this.setData({ checkinTodaySigned: !!detail.todaySigned });
      })
      .catch((err) => {
        if (err?.message === "missing-token") {
          this.setData({ checkinTodaySigned: false });
          return;
        }
        console.warn("loadCheckinStatus failed", err);
        this.setData({ checkinTodaySigned: false });
      });
  },

  onLoad() {
    this._storedProfileCache = loadStoredProfile() || {};
    const normalized = normalizeProfileData(this._storedProfileCache, {
      storedProfile: this._storedProfileCache,
      apiBase: resolveApiBase()
    });
    this.setData({
      profile: normalized,
      loading: true,
      error: "",
      customerServiceSessionFrom: this.composeCustomerServiceSessionFrom(normalized),
      nicknameInput: normalized.nickname
    });
    this.updateStatusBadgeStyle();
    this.reloadProfile();
    this.loadLikeSummary();
    this.loadCheckinStatus();
  },

  onShow() {
    if (this.data.activeTab !== "profile") {
      this.setData({ activeTab: "profile" });
    }
    this.updateStatusBadgeStyle();
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) {
      this.setData({
        showSubscriptionRedDot: !!app.globalData.subscriptionFeedHasUpdate,
        showSubscribeWaitOverlay: !!app.globalData.showSubscribeWaitOverlay
      });
    }
    this.refreshSubscriptionRedDot();
    this.loadCheckinStatus();
    if (this.data.showCheckinGuideProfile) {
      this.setData({ showCheckinGuideProfile: false });
    }
    if (app && app.globalData && app.globalData.inviteGuide?.active && app.globalData.inviteGuide.step === "profile") {
      this.showInviteGuideProfile();
    } else if (this.data.showInviteGuideProfile) {
      this.setData({ showInviteGuideProfile: false });
    }
  },

  onPullDownRefresh() {
    this.reloadProfile({ fromPullDown: true });
  },

  updateStatusBadgeStyle() {
    if (typeof wx.getMenuButtonBoundingClientRect !== "function") return;
    const menuRect = wx.getMenuButtonBoundingClientRect();
    if (!menuRect || !menuRect.left) return;
    const { screenWidth } = getWindowMetrics();
    if (!screenWidth) return;
    const rpx = screenWidth / 750;
    const badgeWidth = 150 * rpx;
    const badgeHeight = 50 * rpx;
    const gap = 40 * rpx;
    const badgeRight = menuRect.left - gap;
    let left = badgeRight - badgeWidth;
    const minLeft = 12 * rpx;
    if (left < minLeft) left = minLeft;
    const top = menuRect.top + (menuRect.height - badgeHeight) / 2;
    this.setData({
      statusBadgeStyle: `left:${left.toFixed(2)}px;top:${top.toFixed(2)}px;right:auto;`
    });
  },

  reloadProfile(options = {}) {
    const { fromPullDown = false } = options;
    if (!fromPullDown) {
      this.setData({ loading: true, error: "" });
    } else {
      this.setData({ error: "" });
    }
    fetchUserProfile()
      .then((remoteProfile) => {
        const normalized = normalizeProfileData(remoteProfile, {
          storedProfile: this._storedProfileCache,
          apiBase: resolveApiBase()
        });
        console.log("remoteProfile:", remoteProfile);
        this._storedProfileCache = persistProfileLocally({
          nickname: normalized.nickname,
          avatarUrl: normalized.avatarFileName || normalized.avatarUrl,
          featureCode: normalized.featureCode,
          flpValue: normalized.flpValue,
          inviteCode: normalized.inviteCode,
          vip: normalized.vip,
          memberExpireDate: normalized.memberExpireDate,
          checkinQuota: normalized.checkinQuota
        });
        this.setData({
          profile: normalized,
          loading: false,
          error: "",
          customerServiceSessionFrom: this.composeCustomerServiceSessionFrom(normalized),
          nicknameInput: this.data.nicknameEditing ? this.data.nicknameInput : normalized.nickname
        });
      })
      .catch((err) => {
        const message = err?.message || "加载失败，请稍后重试";
        let display = message;
        if (message === "missing-token") {
          display = "未登录，暂时无法获取个人资料";
        }
        this.setData({ error: display, loading: false });
      })
      .finally(() => {
        if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh();
        }
        this.loadLikeSummary();
        const app = typeof getApp === "function" ? getApp() : null;
        if (app && app.globalData && app.globalData.inviteGuide?.active && app.globalData.inviteGuide.step === "profile") {
          wx.nextTick(() => {
            this.showInviteGuideProfile();
          });
        }
      });
  },

  onRetryTap() {
    this.reloadProfile();
    this.loadLikeSummary();
  },

  onCopyFeatureCode() {
    const code = this.data.profile?.featureCode || "";
    if (!code) {
      wx.showToast({ title: "暂无可复制的低空号", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: code,
      success: () => {
        wx.showToast({ title: "已复制", icon: "success" });
      },
      fail: () => {
        wx.showToast({ title: "复制失败", icon: "none" });
      }
    });
  },

  onEditProfileTap() {
    // legacy fallback: still allow manual navigate if needed in future
    this.startNicknameEdit();
  },

  openAvatarActionSheet() {
    this.setData({ avatarActionSheetVisible: true });
  },

  closeAvatarActionSheet() {
    this.setData({ avatarActionSheetVisible: false });
  },

  onChooseAvatar(e) {
    const avatarUrl = e?.detail?.avatarUrl;
    if (!avatarUrl) return;
    if (this.data.avatarActionSheetVisible) {
      this.setData({ avatarActionSheetVisible: false });
    }
    this.handleAvatarSelection(avatarUrl);
  },

  onCyberpunkPilotTap() {
    this.setData({ avatarActionSheetVisible: false });
    if (typeof wx.navigateTo !== "function") {
      wx.showToast({ title: "当前版本暂不支持", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/profile/cyberpunk-pilot/index" });
  },

  handleAvatarSelection(tempPath) {
    if (!tempPath) return;
    const showLoading = typeof wx.showLoading === "function";
    const hideLoading = typeof wx.hideLoading === "function" ? () => wx.hideLoading() : () => { };
    if (showLoading) wx.showLoading({ title: "上传中...", mask: true });
    const apiBase = resolveApiBase();
    prepareAvatarForUpload(tempPath)
      .then((filePath) => uploadAvatarFile(filePath, { apiBase }))
      .then((fileName) =>
        updateUserProfile({ avatarUrl: fileName }, { apiBase })
          .then((remote) => ({ remote, fileName }))
          .catch((err) => {
            const wrapped = err || new Error("update-avatar-failed");
            wrapped._uploadedFileName = fileName;
            throw wrapped;
          })
      )
      .then(({ remote, fileName }) => {
        hideLoading();
        this.handleProfileUpdateResult(remote, { avatarFileName: fileName });
        wx.showToast({ title: "头像已更新", icon: "success" });
      })
      .catch((err) => {
        hideLoading();
        if (err && err.errMsg && err.errMsg.includes("cancel")) {
          return;
        }
        if (err && err.message === "missing-token") {
          wx.showToast({ title: "请先登录后再试", icon: "none" });
          return;
        }
        console.warn("更新头像失败", err);
        wx.showToast({ title: "更新失败，请稍后重试", icon: "none" });
      });
  },

  startNicknameEdit() {
    if (this.data.nicknameSaving) return;
    const nickname = this.data.profile?.nickname || "";
    const limited = truncateNicknameByUnits(nickname);
    this.setData({
      nicknameEditing: true,
      nicknameInput: limited
    });
  },

  onNicknameInputChange(e) {
    const value = e?.detail?.value || "";
    const limited = truncateNicknameByUnits(value);
    this.setData({ nicknameInput: limited });
  },
  onEditing(e) {

  },
  onBlankTap(e) {
    if (this.data.nicknameSaving || !this.data.nicknameEditing) return;

    this.cancelNicknameEdit();
  },
  onNickReview(e) {
    const value = e?.detail?.value ?? this.data.nicknameInput;
    const limited = truncateNicknameByUnits(value);

    if (!e.detail.pass) {
      wx.showToast({ icon: "none", title: "昵称不合规，请重新填写" });
      this.setData({
        nicknameEditing: true,
        nicknameInput: limited
      });
      return;
    }
    this.saveNicknameInline(limited);
  },

  onNicknameInputConfirm(e) {
    const inputTypeRaw = e?.detail?.inputType || "";
    const inputType = typeof inputTypeRaw === "string" ? inputTypeRaw.toLowerCase() : "";
    if (inputType === "nickname") {
      return;
    }
    const value = e?.detail?.value ?? this.data.nicknameInput;
    this.saveNicknameInline(value);
  },

  onNicknameInputBlur() {
    if (this.data.nicknameSaving) return;
    this.cancelNicknameEdit();
  },

  saveNicknameInline(nickname) {
    const trimmed = truncateNicknameByUnits((nickname || "").trim());
    if (!this.data.nicknameEditing) return;
    if (this.data.nicknameSaving) return;
    const current = this.data.profile?.nickname || "";
    if (!trimmed) {
      wx.showToast({ title: "昵称不能为空", icon: "none" });
      this.setData({
        nicknameEditing: false,
        nicknameInput: current
      });
      return;
    }
    if (trimmed === current) {
      this.setData({
        nicknameEditing: false,
        nicknameInput: current
      });
      return;
    }
    this.setData({ nicknameSaving: true });
    const apiBase = resolveApiBase();
    updateUserProfile({ username: trimmed }, { apiBase })
      .then((remote) => {
        this.handleProfileUpdateResult(remote, { nickname: trimmed });
        wx.showToast({ title: "昵称已更新", icon: "success" });
        this.setData({
          nicknameEditing: false,
          nicknameInput: trimmed
        });
      })
      .catch((err) => {
        console.warn("更新昵称失败", err);
        const message = resolveNicknameUpdateErrorMessage(err);
        wx.showToast({ title: message, icon: "none" });
        this.setData({
          nicknameEditing: false,
          nicknameInput: current
        });
      })
      .finally(() => {
        this.setData({ nicknameSaving: false });
      });
  },

  cancelNicknameEdit() {
    // if (!this.data.nicknameEditing) return;
    const current = this.data.profile?.nickname || "";
    console.log("xxxxx")
    this.setData({
      nicknameEditing: false,
      nicknameInput: current
    });
  },

  syncNicknameWithWechat(nickname) {
    const trimmed = (nickname || "").trim();
    if (!trimmed) {
      return Promise.reject(new Error("empty-nickname"));
    }
    const apiBase = resolveApiBase();
    const showLoading = typeof wx.showLoading === "function";
    const hideLoading = typeof wx.hideLoading === "function" ? () => wx.hideLoading() : () => { };
    if (showLoading) wx.showLoading({ title: "同步中...", mask: true });
    return updateUserProfile({ username: trimmed }, { apiBase })
      .then((remote) => {
        hideLoading();
        this.handleProfileUpdateResult(remote, { nickname: trimmed });
        wx.showToast({ title: "昵称已同步", icon: "success" });
        return remote;
      })
      .catch((err) => {
        hideLoading();
        const nextErr = err || new Error("nickname-sync-failed");
        nextErr.displayMessage = resolveNicknameUpdateErrorMessage(nextErr);
        throw nextErr;
      });
  },

  handleProfileUpdateResult(rawProfile = {}, fallbackChanges = {}) {
    const current = this.data.profile || {};
    const stored = this._storedProfileCache || {};
    const merged = Object.assign(
      {},
      stored,
      current,
      fallbackChanges,
      rawProfile || {}
    );
    if (!merged.featureCode) {
      merged.featureCode = current.featureCode || stored.featureCode || "";
    }
    if (merged.flpValue === undefined || merged.flpValue === null) {
      const fallbackFlp =
        current.flpValue !== undefined && current.flpValue !== null
          ? current.flpValue
          : stored.flpValue;
      if (fallbackFlp !== undefined) merged.flpValue = fallbackFlp;
    }
    const persisted = persistProfileLocally({
      nickname: merged.nickname || current.nickname || "",
      avatarUrl: merged.avatarFileName || merged.avatarUrl || current.avatarFileName || "",
      featureCode: merged.featureCode,
      flpValue: merged.flpValue,
      vip: merged.vip ?? merged.member ?? current.vip ?? false,
      memberExpireDate: merged.memberExpireDate || current.memberExpireDate || "",
      checkinQuota: merged.checkinQuota || current.checkinQuota || {}
    });
    this._storedProfileCache = persisted;
    const normalized = normalizeProfileData(merged, {
      storedProfile: persisted,
      apiBase: resolveApiBase()
    });
    this.setData({
      profile: normalized,
      customerServiceSessionFrom: this.composeCustomerServiceSessionFrom(normalized),
      nicknameInput: this.data.nicknameEditing ? this.data.nicknameInput : normalized.nickname
    });
    return normalized;
  },

  composeCustomerServiceSessionFrom(profile = {}) {
    const payload = {
      source: "profile-customer-service",
      featureCode: profile.featureCode || "",
      nickname: profile.nickname || ""
    };
    try {
      return JSON.stringify(payload);
    } catch (err) {
      console.warn("Failed to stringify session-from payload", err);
      return "profile-customer-service";
    }
  },

  onCustomerServiceContact(event) {
    console.log("Customer service contact event", event);
  },

  onFlpCardTap() {
    if (typeof wx.navigateTo !== "function") {
      wx.showToast({ title: "当前版本暂不支持", icon: "none" });
      return;
    }
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData && app.globalData.inviteGuide?.active) {
      app.globalData.inviteGuide = { active: true, step: "flp" };
      if (this.data.showInviteGuideProfile) {
        this.setData({ showInviteGuideProfile: false });
      }
    }
    const balance = this.data.profile?.flpDisplay || "0.00";
    const query = encodeURIComponent(balance);
    wx.navigateTo({ url: `/pages/profile/flp/index?balance=${query}` });
  },

  onMemberCenterTap() {
    if (typeof wx.navigateTo !== "function") {
      wx.showToast({ title: "当前版本暂不支持", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/packages/member/index/index" });
  },

  onListItemTap(e) {
    const action = e.currentTarget?.dataset?.action;
    if (action === "markers") {
      if (typeof wx.navigateTo !== "function") {
        wx.showToast({ title: "��ǰ�汾�ݲ�֧��", icon: "none" });
        return;
      }
      wx.navigateTo({ url: "/pages/markers/index" });
      return;
    }
    if (action === "open-platform") {
      if (typeof wx.navigateTo !== "function") {
        wx.showToast({ title: "当前版本暂不支持", icon: "none" });
        return;
      }
      wx.navigateTo({ url: "/pages/profile/open-platform/index" });
      return;
    }
    if (action === "subscription-feed") {
      if (typeof wx.navigateTo !== "function") {
        wx.showToast({ title: "当前版本暂不支持", icon: "none" });
        return;
      }
      wx.navigateTo({ url: "/pages/profile/subscription-feed/index" });
      return;
    }
    if (action === "community-interaction") {
      const appId = "wxf6b0c0f50d040b4c";
      const path =
        "pages/guild/index/index?digestToken=CBUSQDIxXzBfQl8yZWI0NWY2OTIyNjIwOTAwMTQ0MTE1MjE5MDIzNzIxODM5MFg2MF8xNDQxMTUyMTkxNDEzMjQ4MjcY%2FPTP5YeCyzkg6bfnrgIoATABUKC6t4S6M1pAZWJjNTY5YmE1YjQxMGYxZDllNDc4OWY5NTVmMTAwNTNhNjU0ODgzOGRkMmUzN2I3Mjc2NzEwNjJhMDQ0NzZhOQ%3D%3D&guildFromSource=1&feedId=B_2eb45f69226209001441152190237218390X60&miniappJumpTarget=1&guildId=32418071644994172";
      const options = { appId, path, envVersion: "release" };
      if (typeof wx.openEmbeddedMiniProgram === "function") {
        wx.openEmbeddedMiniProgram({
          ...options,
          fail: () => {
            if (typeof wx.navigateToMiniProgram === "function") {
              wx.navigateToMiniProgram(options);
              return;
            }
            wx.showToast({ title: "当前版本暂不支持", icon: "none" });
          }
        });
        return;
      }
      if (typeof wx.navigateToMiniProgram === "function") {
        wx.navigateToMiniProgram(options);
        return;
      }
      wx.showToast({ title: "当前版本暂不支持", icon: "none" });
      return;
    }

    wx.showToast({ title: "敬请期待", icon: "none" });

  },

  onChatButtonTap() {
    wx.showToast({ title: "您暂未获得低空智能体（Agent）体验特权", icon: "none" });
  },

  onMenuHomeTap() {
    if (this.data.activeTab !== "home") {
      this.setData({ activeTab: "home" });
    }
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const canGoBack = typeof wx.navigateBack === "function" && pages.length > 1;
    if (canGoBack) {
      const prevPage = pages[pages.length - 2] || null;
      const prevRoute = pages[pages.length - 2]?.route || "";
      if (prevRoute === "pages/profile/checkin/index") {
        if (typeof wx.reLaunch === "function") {
          wx.reLaunch({ url: "/pages/map/map" });
          return;
        }
        if (typeof wx.redirectTo === "function") {
          wx.redirectTo({ url: "/pages/map/map" });
          return;
        }
      } else {
        if (
          prevRoute === "pages/map/map" &&
          prevPage &&
          typeof prevPage.setData === "function"
        ) {
          const next = { activeTab: "home" };
          if (Object.prototype.hasOwnProperty.call(prevPage.data || {}, "airBoardEnabled")) {
            next.showDashboardPanel = !!prevPage.data.airBoardEnabled;
          }
          prevPage.setData(next);
        }
        wx.navigateBack({ delta: 1 });
        return;
      }
    }
    if (typeof wx.reLaunch === "function") {
      wx.reLaunch({ url: "/pages/map/map" });
      return;
    }
    if (typeof wx.redirectTo === "function") {
      wx.redirectTo({ url: "/pages/map/map" });
      return;
    }
    if (typeof wx.navigateTo === "function") {
      wx.navigateTo({ url: "/pages/map/map" });
    }
  },

  onMenuProfileTap() {
    if (this.data.activeTab !== "profile") {
      this.setData({ activeTab: "profile" });
    }
    wx.showToast({ title: "当前已在我的页面", icon: "none" });
  },

  refreshSubscriptionRedDot() {
    const apiBase = resolveApiBase();
    if (!apiBase) return;
    fetchLatestSubscriptionPush({ apiBase })
      .then((payload = {}) => {
        const latestVersion = normalizeVersion(payload.version || "0");
        const app = typeof getApp === "function" ? getApp() : null;
        if (app && app.globalData) {
          app.globalData.subscriptionLatestVersion = latestVersion;
        }
        if (!latestVersion) {
          this.updateSubscriptionRedDot(false);
          return null;
        }
        return fetchLatestItemVersion({
          apiBase,
          itemId: SUBSCRIPTION_TEMPLATE_ID,
          version: latestVersion
        }).then((result) => {
          const serverVersion = normalizeVersion(result.version || "");
          const hasUpdate = serverVersion !== latestVersion;
          this.updateSubscriptionRedDot(hasUpdate);
        });
      })
      .catch((err) => {
        console.warn("refreshSubscriptionRedDot failed", err);
      });
  },

  updateSubscriptionRedDot(show) {
    if (typeof show !== "boolean") return;
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) {
      app.globalData.subscriptionFeedHasUpdate = show;
    }
    this.setData({ showSubscriptionRedDot: show });
  },

  onCheckinEntryTap() {
    if (typeof wx.navigateTo !== "function") {
      wx.showToast({ title: "当前版本暂不支持", icon: "none" });
      return;
    }
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData && app.globalData.checkinGuide?.active) {
      app.globalData.checkinGuide = { active: true, step: "checkin" };
      if (this.data.showCheckinGuideProfile) {
        this.setData({ showCheckinGuideProfile: false });
      }
    }
    wx.navigateTo({ url: "/pages/profile/checkin/index" });
    this.ensureCheckinSubscriptionOnEntry().catch((err) => {
      console.warn("ensureCheckinSubscriptionOnEntry failed", err);
    });
  },

  noop() { },

  showCheckinGuideProfile() {
    this.measureCheckinEntryTarget()
      .then((result) => {
        if (!result) return;
        this.setData({
          showCheckinGuideProfile: true,
          checkinGuideMask: result.mask,
          checkinGuideIntroduce: result.introduce,
          checkinGuideOverlayStyle: this.buildGuideOverlayStyle(result.mask)
        });
      })
      .catch((err) => {
        console.warn("showCheckinGuideProfile failed", err);
      });
  },

  measureCheckinEntryTarget() {
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery().in(this);
      query.select("#checkin-entry-btn").boundingClientRect();
      query.exec((res) => {
        const rect = res && res[0];
        if (!rect) {
          resolve(null);
          return;
        }
        const { windowWidth, windowHeight } = getWindowMetrics();
        const rpx = windowWidth / 750;
        const padding = 10;
        const size = Math.max(rect.width, rect.height) + padding * 2;
        const left = Math.max(0, rect.left + rect.width / 2 - size / 2);
        const top = Math.max(0, rect.top + rect.height / 2 - size / 2);
        const rightLeft = Math.min(windowWidth, left + size);
        const bottomTop = Math.min(windowHeight, top + size);
        const introduceLeft = Math.max(0, left - 14 - 150 * rpx);
        const introduceTop = Math.min(windowHeight, top + size + 12);
        resolve({
          mask: { top, left, size, rightLeft, bottomTop },
          introduce: { left: introduceLeft, top: introduceTop }
        });
      });
    });
  },

  buildGuideOverlayStyle(mask) {
    if (!mask) return "";
    const centerX = mask.left + mask.size / 2;
    const centerY = mask.top + mask.size / 2;
    const radius = mask.size / 2;
    const edge = Math.max(2, Math.round(radius * 0.04));
    const clearRadius = radius + 1;
    return `background: radial-gradient(circle at ${centerX}px ${centerY}px, rgba(0,0,0,0) 0, rgba(0,0,0,0) ${clearRadius}px, rgba(0,0,0,0.6) ${clearRadius + edge}px);`;
  },

  showInviteGuideProfile() {
    this.measureInviteGuideProfileTarget()
      .then((mask) => {
        if (!mask) {
          if (!this._inviteGuideRetryTimer) {
            this._inviteGuideRetryTimer = setTimeout(() => {
              this._inviteGuideRetryTimer = null;
              this.showInviteGuideProfile();
            }, 200);
          }
          return;
        }
        this.setData({
          showInviteGuideProfile: true,
          inviteGuideMask: mask
        });
      })
      .catch((err) => {
        console.warn("show invite guide profile failed", err);
      });
  },

  measureInviteGuideProfileTarget() {
    return new Promise((resolve) => {
      const query = wx.createSelectorQuery().in(this);
      query.select("#profile-flp-card").boundingClientRect();
      query.exec((res) => {
        const rect = res && res[0];
        if (!rect) {
          resolve(null);
          return;
        }
        const { windowWidth, windowHeight } = getWindowMetrics();
        const padding = 10;
        const width = rect.width + padding * 2;
        const height = rect.height + padding * 2;
        const left = Math.max(0, rect.left - padding);
        const top = Math.max(0, rect.top - padding);
        const rightLeft = Math.min(windowWidth, left + width);
        const bottomTop = Math.min(windowHeight, top + height);
        resolve({
          top,
          left,
          width,
          height,
          rightLeft,
          bottomTop
        });
      });
    });
  },

  ensureCheckinSubscriptionOnEntry() {
    const apiBase = resolveApiBase();
    const token = getAuthToken();
    if (!apiBase || !token) return Promise.resolve();
    const templateId = SUBSCRIPTION_TEMPLATE_IDS.checkinReminder;
    return fetchSubscriptions({ apiBase, token })
      .then((serverIds = []) => {
        const normalized = normalizeTemplateIds(serverIds);
        if (!normalized.includes(templateId)) return null;
        console.log("Checkin subscription already exists on server");
        return requestSubscribeMessageForTemplateIds([templateId]).catch(() => null);
      })
      .catch((err) => {
        console.warn("ensureCheckinSubscriptionOnEntry fetch failed", err);
      });
  }
});
