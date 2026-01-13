const { fetchCheckinDetail, checkin } = require("../../../utils/checkin");
const {
  fetchUserProfile,
  normalizeProfileData,
  loadStoredProfile,
  resolveApiBase,
  getAuthToken
} = require("../../../utils/profile");
const {
  requestSubscribeMessageForTemplateIds,
  fetchSubscriptions,
  updateSubscriptions,
  normalizeTemplateIds,
  extractAcceptedTemplateIdsFromWxSetting
} = require("../../../utils/subscriptions");
const { SUBSCRIPTION_TEMPLATE_IDS } = require("../../../config/subscription-templates");
const {
  appendInviteCodeToPath,
  appendInviteCodeToQuery,
  getShareInviteCode
} = require("../../../utils/share");

const MAP_PAGE_PATH = "/pages/map/map";
const ELEME_APP_ID = "";
const ELEME_PATH = "";
const ELEME_ENV = "release";

const WEEKDAY_LABELS = {
  monday: "周一",
  tuesday: "周二",
  wednesday: "周三",
  thursday: "周四",
  friday: "周五",
  saturday: "周六",
  sunday: "周日"
};

const DOUBLE_REWARD_WEEKDAYS = new Set(["wednesday", "saturday", "sunday", "周三", "周六", "周日"]);
const LOTTERY_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];

function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  if (!value) return null;
  const parts = `${value}`.split("-").map((item) => Number(item));
  if (parts.length !== 3) return null;
  const [year, month, day] = parts;
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function addDays(value, offset) {
  const date = parseDate(value);
  if (!date) return value;
  date.setDate(date.getDate() + offset);
  return formatDate(date);
}

function normalizeWeekday(raw, date) {
  if (typeof raw === "string" && raw.trim()) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("周")) return trimmed;
    const key = trimmed.toLowerCase();
    if (WEEKDAY_LABELS[key]) return WEEKDAY_LABELS[key];
  }
  const parsed = parseDate(date);
  if (!parsed) return "";
  const idx = parsed.getDay();
  const labels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return labels[idx] || "";
}

function formatReward(value) {
  if (!Number.isFinite(value)) return "--";
  const fixed = value.toFixed(2);
  return fixed.replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
}

function isDoubleReward(weekday) {
  if (!weekday) return false;
  if (DOUBLE_REWARD_WEEKDAYS.has(weekday)) return true;
  const lower = `${weekday}`.toLowerCase();
  return DOUBLE_REWARD_WEEKDAYS.has(lower);
}

Page({
  data: {
    loading: true,
    pageLoading: true,
    error: "",
    flpDisplay: "--",
    continuousDays: 0,
    weekDays: [],
    canCheckinToday: false,
    todayDate: "",
    checkinSubscriptionLoading: false,
    showCheckinSubscriptionBanner: false,
    showLotteryModal: false,
    lotteryPrizes: ["0.1", "0.2", "0.5", "0.8", "", "1", "2", "8", "88"],
    lotteryActiveIndex: -1,
    isLotteryDrawing: false,
    lotteryButtonActive: false
  },

  onLoad() {
    const stored = loadStoredProfile() || {};
    const normalized = normalizeProfileData(stored, { storedProfile: stored, apiBase: resolveApiBase() });
    this.setData({
      flpDisplay: normalized.flpDisplay || "--"
    });
    this.loadAllData({ showPageLoading: true }).finally(() => {
      this._initialLoadDone = true;
    });
    this.initCheckinSubscription().catch((err) => {
      console.warn("initCheckinSubscription failed", err);
    });
  },

  onShow() {
    if (!this._initialLoadDone) return;
    this.refreshFlp();
    this.loadCheckinDetail();
    this.initCheckinSubscription().catch((err) => {
      console.warn("initCheckinSubscription onShow failed", err);
    });
  },

  onBackTap() {
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    if (typeof wx.navigateBack === "function" && pages && pages.length > 1) {
      wx.navigateBack();
      return;
    }
    if (typeof wx.navigateTo === "function") {
      wx.navigateTo({ url: "/pages/profile/profile" });
    }
  },

  refreshFlp() {
    const apiBase = resolveApiBase();
    if (!apiBase) return Promise.resolve();
    return fetchUserProfile({ apiBase })
      .then((profile) => {
        const normalized = normalizeProfileData(profile, {
          storedProfile: loadStoredProfile() || {},
          apiBase
        });
        this.setData({ flpDisplay: normalized.flpDisplay || "--" });
      })
      .catch((err) => {
        if (err?.message === "missing-token") return;
        console.warn("refreshFlp failed", err);
      });
  },

  loadCheckinDetail() {
    const apiBase = resolveApiBase();
    const todayDate = formatDate(new Date());
    this.setData({ loading: true, error: "", todayDate });
    return fetchCheckinDetail({ apiBase })
      .then((detail = {}) => {
        const weekDays = this.buildWeekDays(detail, todayDate);
        const canCheckinToday = !detail.todaySigned && weekDays.some((item) => item.isToday);
        this.setData({
          loading: false,
          continuousDays: Number(detail.continuousDays) || 0,
          weekDays,
          canCheckinToday
        });
      })
      .catch((err) => {
        const message =
          err?.message === "missing-token"
            ? "未登录，暂时无法签到"
            : err?.message || "加载失败，请稍后重试";
        this.setData({ loading: false, error: message, weekDays: [], canCheckinToday: false });
      });
  },

  loadAllData({ showPageLoading = false } = {}) {
    if (showPageLoading) {
      this.setData({ pageLoading: true });
    }
    const tasks = [this.refreshFlp(), this.loadCheckinDetail()].map((task) =>
      Promise.resolve(task).catch(() => { })
    );
    return Promise.all(tasks).finally(() => {
      if (showPageLoading) {
        this.setData({ pageLoading: false });
      }
      if (showPageLoading && !this._lotteryShown) {
        this._lotteryShown = true;
        this.setData({ showLotteryModal: true });
      }
    });
  },

  getCheckinTemplateId() {
    return SUBSCRIPTION_TEMPLATE_IDS.checkinReminder;
  },

  setCheckinSubscriptionBannerVisibility(show) {
    this.setData({ showCheckinSubscriptionBanner: !!show });
  },

  getSubscriptionSettingsFromWx() {
    if (typeof wx === "undefined" || typeof wx.getSetting !== "function") {
      return Promise.resolve({ mainSwitch: true, acceptedIds: [], availableIds: [] });
    }
    return new Promise((resolve) => {
      wx.getSetting({
        withSubscriptions: true,
        success: (res = {}) => {
          const mainSwitch = res?.subscriptionsSetting?.mainSwitch;
          const enabled = mainSwitch !== false;
          const itemSettings = res?.subscriptionsSetting?.itemSettings || res?.subscriptionsSetting?.itemsettings;
          const availableIds = itemSettings && typeof itemSettings === "object"
            ? normalizeTemplateIds(Object.keys(itemSettings))
            : [];
          const ids = enabled
            ? extractAcceptedTemplateIdsFromWxSetting(res.subscriptionsSetting) || []
            : [];
          const acceptedIds = normalizeTemplateIds(ids);
          console.log("checkin subscription settings ids", { availableIds, acceptedIds, mainSwitch: enabled });
          resolve({ mainSwitch: enabled, acceptedIds, availableIds });
        },
        fail: () => resolve({ mainSwitch: true, acceptedIds: [], availableIds: [] })
      });
    });
  },

  openCheckinSubscriptionSetting(prefAccepted = []) {
    if (typeof wx === "undefined" || typeof wx.openSetting !== "function") {
      return Promise.resolve([]);
    }
    const apiBase = resolveApiBase();
    const token = getAuthToken();
    return new Promise((resolve) => {
      wx.openSetting({
        withSubscriptions: true,
        success: (res = {}) => {
          const mainSwitch = res?.subscriptionsSetting?.mainSwitch;
          const enabled = mainSwitch !== false;
          if (!enabled) {
            this.setCheckinSubscriptionBannerVisibility(true);
            wx.showToast({ title: "", icon: "none" });
            resolve([]);
            return;
          }
          const ids = extractAcceptedTemplateIdsFromWxSetting(res.subscriptionsSetting) || [];
          const merged = normalizeTemplateIds([...(prefAccepted || []), ...(ids || [])]);
          const templateId = this.getCheckinTemplateId();
          const shouldHide = merged.includes(templateId);
          const syncPromise =
            merged.length && apiBase && token
              ? updateSubscriptions(merged, { apiBase, token }).catch((err) => {
                console.warn("updateSubscriptions after openSetting failed", err);
              })
              : Promise.resolve();
          syncPromise.finally(() => {
            this.setCheckinSubscriptionBannerVisibility(!shouldHide);
            resolve(merged);
          });
        },
        fail: () => {
          this.setCheckinSubscriptionBannerVisibility(true);
          resolve([]);
        }
      });
    }).finally(() => {
      this.refreshCheckinSubscriptionStatus().catch(() => { });
    });
  },

  requestCheckinSubscription(prefAccepted = []) {
    const apiBase = resolveApiBase();
    const token = getAuthToken();
    const templateId = this.getCheckinTemplateId();
    return requestSubscribeMessageForTemplateIds([templateId])
      .then((result = {}) => {
        const acceptedIds = Array.isArray(result.acceptedIds) ? result.acceptedIds : [];
        const merged = normalizeTemplateIds([...(prefAccepted || []), ...(acceptedIds || [])]);
        const accepted = merged.includes(templateId);
        if (accepted && apiBase && token) {
          return updateSubscriptions(merged, { apiBase, token })
            .catch((err) => {
              console.warn("updateSubscriptions after checkin consent failed", err);
            })
            .finally(() => {
              this.setCheckinSubscriptionBannerVisibility(!accepted);
            });
        }
        this.setCheckinSubscriptionBannerVisibility(!accepted);
        return null;
      })
      .catch((err) => {
        console.warn("checkin subscription request failed", err);
        this.setCheckinSubscriptionBannerVisibility(true);
      })
      .finally(() => {
        this.refreshCheckinSubscriptionStatus().catch(() => { });
      });
  },

  refreshCheckinSubscriptionStatus() {
    const apiBase = resolveApiBase();
    const token = getAuthToken();
    if (!apiBase || !token) return Promise.resolve();
    return Promise.all([fetchSubscriptions({ apiBase, token }), this.getSubscriptionSettingsFromWx()])
      .then(([serverIds = [], settings = {}]) => {
        const templateId = this.getCheckinTemplateId();
        this._checkinServerIds = normalizeTemplateIds(serverIds);
        const accepted = normalizeTemplateIds(settings.acceptedIds || []);
        const shouldHide =
          settings.mainSwitch !== false &&
          this._checkinServerIds.includes(templateId) &&
          accepted.includes(templateId);
        this.setCheckinSubscriptionBannerVisibility(!shouldHide);
      })
      .catch((err) => {
        console.warn("refreshCheckinSubscriptionStatus failed", err);
      });
  },

  initCheckinSubscription() {
    const apiBase = resolveApiBase();
    const token = getAuthToken();
    const fetchPromise = apiBase && token ? fetchSubscriptions({ apiBase, token }) : Promise.resolve([]);
    return fetchPromise
      .then((serverIds = []) => {
        const templateId = this.getCheckinTemplateId();
        this._checkinServerIds = normalizeTemplateIds(serverIds);
        const hasServerId = this._checkinServerIds.includes(templateId);
        return this.getSubscriptionSettingsFromWx().then((settings = {}) => {
          const mainSwitch = settings.mainSwitch !== false;
          const accepted = normalizeTemplateIds(settings.acceptedIds || []);
          const hasAccepted = accepted.includes(templateId);
          if (!mainSwitch) {
            this.setCheckinSubscriptionBannerVisibility(true);
            return this.openCheckinSubscriptionSetting(this._checkinServerIds);
          }
          if (hasServerId && hasAccepted) {
            this.setCheckinSubscriptionBannerVisibility(false);
            return null;
          }
          return this.requestCheckinSubscription(this._checkinServerIds);
        });
      })
      .catch((err) => {
        console.warn("initCheckinSubscription failed", err);
        this.setCheckinSubscriptionBannerVisibility(true);
      });
  },
  buildWeekDays(detail, todayDate) {
    const signedDays = Array.isArray(detail.signedDays) ? detail.signedDays : [];
    const unsignedDays = Array.isArray(detail.unsignedDays) ? detail.unsignedDays : [];
    const signedSet = new Set(signedDays.map((item) => item.date).filter(Boolean));
    const dayMap = new Map();

    signedDays.forEach((item) => {
      if (!item || !item.date) return;
      dayMap.set(item.date, { date: item.date, weekday: item.weekday, signed: true });
    });
    unsignedDays.forEach((item) => {
      if (!item || !item.date) return;
      if (!dayMap.has(item.date)) {
        dayMap.set(item.date, { date: item.date, weekday: item.weekday, signed: false });
      }
    });

    let ordered = [];
    if (detail.weekStart) {
      for (let i = 0; i < 7; i += 1) {
        const date = addDays(detail.weekStart, i);
        const existing = dayMap.get(date);
        ordered.push(existing || { date, weekday: "" });
      }
    } else {
      ordered = Array.from(dayMap.values()).sort((a, b) => `${a.date}`.localeCompare(`${b.date}`));
    }

    return ordered.map((item) => {
      const date = item.date || "";
      const weekdayLabel = normalizeWeekday(item.weekday, date);
      const signed = signedSet.has(date);
      const isToday = date === todayDate;
      const isSunday = weekdayLabel === "周日";
      const bonus = isDoubleReward(item.weekday || weekdayLabel);
      const rewardValue = bonus ? 0.02 : 0.01;
      let iconType = "unsigned";
      if (signed) {
        iconType = "signed";
      } else if (isToday) {
        iconType = "today";
      }
      return {
        date,
        weekdayLabel,
        reward: formatReward(rewardValue),
        isSigned: signed,
        isToday,
        isSunday,
        canCheckin: isToday && !detail.todaySigned,
        isBonus: bonus,
        iconType
      };
    });
  },

  onCheckinDayTap(e) {
    const date = e.currentTarget?.dataset?.date || "";
    if (!date) return;
    if (!this.data.canCheckinToday || date !== this.data.todayDate) {
      return;
    }
    this.onCheckinTap();
  },

  onCheckinTap() {
    if (!this.data.canCheckinToday) return;
    const apiBase = resolveApiBase();
    const showLoading = typeof wx.showLoading === "function";
    const hideLoading = typeof wx.hideLoading === "function" ? () => wx.hideLoading() : () => { };
    if (showLoading) wx.showLoading({ title: "签到中...", mask: true });
    checkin({ apiBase })
      .then(() => {
        hideLoading();
        wx.showToast({ title: "签到成功", icon: "success" });
        this.loadCheckinDetail();
        this.refreshFlp();
      })
      .catch((err) => {
        hideLoading();
        const message =
          err?.message === "missing-token"
            ? "请先登录后再试"
            : err?.message || "签到失败，请稍后重试";
        wx.showToast({ title: message, icon: "none" });
      });
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

  onCheckinSubscriptionTap() {
    if (this.data.checkinSubscriptionLoading) return;
    this.setData({ checkinSubscriptionLoading: true });
    const templateId = this.getCheckinTemplateId();
    this.getSubscriptionSettingsFromWx()
      .then((settings = {}) => {
        const accepted = normalizeTemplateIds(settings.acceptedIds || []);
        const available = normalizeTemplateIds(settings.availableIds || []);
        const existsInSettings = available.includes(templateId);
        console.log("Current subscription settings from wx:", settings,
          "accepted template IDs:", accepted,
          "available template IDs:", available);
        const needOpenSetting = settings.mainSwitch === false || (existsInSettings && !accepted.includes(templateId));
        const openPromise = needOpenSetting
          ? this.openCheckinSubscriptionSetting(this._checkinServerIds || [])
          : Promise.resolve(accepted);
        return openPromise.then((merged) => this.requestCheckinSubscription(merged || accepted));
      })
      .then(() => {
        if (!this.data.showCheckinSubscriptionBanner) {
          wx.showToast({ title: "已开启提醒", icon: "success" });
        }
      })
      .finally(() => {
        this.setData({ checkinSubscriptionLoading: false });
      });
  },

  onLotteryMaskTap() {
    this._clearLotteryTimers();
    this._clearLotteryButtonTimer();
    this.setData({ showLotteryModal: false, lotteryActiveIndex: -1, isLotteryDrawing: false });
  },

  onLotteryMaskTouchMove() {},

  onLotteryCardTap() {},

  onLotteryButtonTap() {
    if (this.data.isLotteryDrawing) return;
    this._triggerLotteryButtonActive();
    const order = LOTTERY_ORDER;
    if (!order.length) return;
    const targetPos = Math.floor(Math.random() * order.length);
    const baseOffset = (targetPos - (order.length - 1) + order.length) % order.length;
    let extraSteps = baseOffset === 0 ? order.length : baseOffset;
    extraSteps += order.length * 2;

    const fastSteps = order.length;
    const fastDuration = 500;
    const totalDuration = 3000;
    const remainingDuration = Math.max(totalDuration - fastDuration, 0);

    this._clearLotteryTimers();
    this.setData({ isLotteryDrawing: true, lotteryActiveIndex: order[0] });

    const timers = [];
    for (let i = 1; i < fastSteps; i += 1) {
      const delay = Math.round((fastDuration / fastSteps) * i);
      timers.push(
        setTimeout(() => {
          this.setData({ lotteryActiveIndex: order[i] });
        }, delay)
      );
    }

    if (extraSteps <= 0 || remainingDuration <= 0) {
      timers.push(
        setTimeout(() => {
          this.setData({ isLotteryDrawing: false });
        }, fastDuration)
      );
      this._lotteryTimers = timers;
      return;
    }

    const weights = [];
    for (let i = 1; i <= extraSteps; i += 1) {
      const t = i / extraSteps;
      weights.push(0.6 + 1.8 * t * t);
    }
    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    let elapsed = fastDuration;
    let orderIndex = fastSteps - 1;

    for (let i = 0; i < extraSteps; i += 1) {
      const interval = remainingDuration * (weights[i] / weightSum);
      elapsed += interval;
      orderIndex = (orderIndex + 1) % order.length;
      const activeIndex = order[orderIndex];
      const isFinal = i === extraSteps - 1;
      timers.push(
        setTimeout(() => {
          this.setData({ lotteryActiveIndex: activeIndex, isLotteryDrawing: isFinal ? false : true });
        }, Math.round(elapsed))
      );
    }

    this._lotteryTimers = timers;
  },

  _triggerLotteryButtonActive() {
    this._clearLotteryButtonTimer();
    this.setData({ lotteryButtonActive: true });
    this._lotteryButtonTimer = setTimeout(() => {
      this.setData({ lotteryButtonActive: false });
    }, 160);
  },

  _clearLotteryButtonTimer() {
    if (this._lotteryButtonTimer) {
      clearTimeout(this._lotteryButtonTimer);
      this._lotteryButtonTimer = null;
    }
    this.setData({ lotteryButtonActive: false });
  },

  _clearLotteryTimers() {
    if (Array.isArray(this._lotteryTimers)) {
      this._lotteryTimers.forEach((timer) => clearTimeout(timer));
    }
    this._lotteryTimers = [];
  },

  onInviteFriendTap() {
    if (typeof wx.navigateTo !== "function") {
      wx.showToast({ title: "当前版本暂不支持", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/profile/flp/invite/index" });
  },

  onTakeoutTap() {
    if (!ELEME_APP_ID) {
      wx.showToast({ title: "请配置饿了么跳转信息", icon: "none" });
      return;
    }
    const options = { appId: ELEME_APP_ID, envVersion: ELEME_ENV };
    if (ELEME_PATH) options.path = ELEME_PATH;
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
  }
});







