const { fetchCheckinDetail, checkin } = require("../../../utils/checkin");
const { completeNewbieTask } = require("../../../utils/newbie-tasks");
const { fetchLotteryConfig, drawLottery, fetchLotteryLogs } = require("../../../utils/lottery");
const {
  fetchUserProfile,
  normalizeProfileData,
  loadStoredProfile,
  resolveApiBase,
  getAuthToken,
  buildAvatarDownloadUrl
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
const { buildFileDownloadUrl } = require("../../../utils/markers");

const CHECKIN_PAGE_PATH = "/pages/profile/checkin/index";
const ELEME_APP_ID = "wxece3a9a4c82f58c9";
const ELEME_PATH = "ele-recommend-price/pages/guest/index?inviterId=64e1965&chInfo=ch_wechat_chsub_CopyLink&_ltracker_f=ch_wechat_grzx_cp_tjyj";
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
const LOTTERY_FAST_DURATION = 500;
const LOTTERY_TOTAL_DURATION = 3000;
const LOTTERY_LATE_DURATION = 1100;
const LOTTERY_AWAIT_INTERVAL = 220;
const DEFAULT_LOTTERY_CONFIG = [
  { level: 1, flp: true, flpCount: 0.0 },
  { level: 2, flp: true, flpCount: 0.0 },
  { level: 3, flp: true, flpCount: 0.0 },
  { level: 4, flp: true, flpCount: 0.0 },
  { level: 5, flp: true, flpCount: 0.0 },
  { level: 6, flp: true, flpCount: 0.0 },
  { level: 7, flp: true, flpCount: 0.0 },
  { level: 8, flp: true, flpCount: 0.0 }
];

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

function isSameDate(value, compare) {
  if (!value || !compare) return false;
  const parsed = new Date(compare);
  if (!Number.isFinite(parsed.getTime())) return false;
  return formatDate(parsed) === value;
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

function normalizeLotteryEntry(entry = {}, apiBase) {
  const flp = !!entry.flp;
  const flpCount = Number(entry.flpCount);
  const description = typeof entry.description === "string" ? entry.description.trim() : "";
  const rawImageUrl = typeof entry.imageUrl === "string" ? entry.imageUrl.trim() : "";
  const probability = Number(entry.probability);
  const displayImageUrl = flp
    ? "/pages/profile/assets/flp-coin.png"
    : (rawImageUrl ? buildAvatarDownloadUrl(rawImageUrl, { apiBase }) : "");
  const displayText = flp ? `+${formatReward(flpCount)}` : description;
  return {
    level: Number(entry.level) || 0,
    flp,
    flpCount,
    description,
    imageUrl: rawImageUrl,
    probability: Number.isFinite(probability) ? probability : null,
    displayImageUrl,
    displayText
  };
}

function applyLotteryProbabilityStyles(prizes = []) {
  const candidates = [];
  prizes.forEach((item, index) => {
    if (!item || !Number.isFinite(item.probability)) return;
    candidates.push({ index, probability: item.probability });
  });
  if (!candidates.length) return prizes;

  const sorted = [...candidates].sort((a, b) => a.probability - b.probability);
  const lowSet = new Set(sorted.slice(0, 2).map((item) => item.index));
  const lowestProbability = sorted[0]?.probability;
  const lowestSet = new Set(
    candidates.filter((item) => item.probability === lowestProbability).map((item) => item.index)
  );

  return prizes.map((item, index) => {
    if (!item) return item;
    return Object.assign({}, item, {
      isLowProbability: lowSet.has(index),
      isLowestProbability: lowestSet.has(index)
    });
  });
}

function buildLotteryDisplay(entries = [], apiBase) {
  const sorted = Array.isArray(entries)
    ? [...entries].sort((a, b) => (Number(a.level) || 0) - (Number(b.level) || 0))
    : [];
  const prizes = new Array(9).fill(null);
  const levelToOrderIndex = new Map();
  LOTTERY_ORDER.forEach((gridIndex, orderIndex) => {
    const entry = sorted[orderIndex];
    if (!entry) return;
    const normalized = normalizeLotteryEntry(entry, apiBase);
    prizes[gridIndex] = normalized;
    if (normalized.level) {
      levelToOrderIndex.set(normalized.level, orderIndex);
    }
  });
  const styledPrizes = applyLotteryProbabilityStyles(prizes);
  return { prizes: styledPrizes, levelToOrderIndex };
}

function shouldEnableTurntable({ todayDate, continuousDays, hasDrawToday }) {
  if (!todayDate) return false;
  const parsed = parseDate(todayDate);
  const isSunday = parsed ? parsed.getDay() === 0 : false;
  return isSunday && Number(continuousDays) >= 7 && !hasDrawToday;
  return true
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
    lotteryPrizes: [],
    lotteryActiveIndex: -1,
    isLotteryDrawing: false,
    lotteryButtonActive: false,
    isLotteryFinished: false,
    lotteryResultText: "",
    lotteryResultImage: "",
    lotteryResultIsFlp: true,
    canLotteryToday: false,
    isAndroid: false,
    isIOS: false
  },

  onLoad() {
    if (typeof wx !== "undefined" && typeof wx.getSystemInfoSync === "function") {
      const system = (wx.getSystemInfoSync()?.system || "").toLowerCase();
      this.setData({
        isAndroid: system.includes("android"),
        isIOS: system.includes("ios")
      });
    }
    this.setData({ pageLoading: true });
    this.loadCheckinFont();
    const stored = loadStoredProfile() || {};
    const normalized = normalizeProfileData(stored, { storedProfile: stored, apiBase: resolveApiBase() });
    this.setData({
      flpDisplay: normalized.flpDisplay || "--"
    });
    this.loadLotteryConfig({ fallbackOnly: true });
    this.ensureValidToken()
      .catch((err) => {
        console.warn("checkin ensureValidToken failed", err);
      })
      .finally(() => {
        this.loadAllData({ showPageLoading: true }).finally(() => {
          this._initialLoadDone = true;
        });
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

  loadCheckinFont() {
    if (typeof wx === "undefined" || typeof wx.loadFontFace !== "function") return;
    const apiBase = resolveApiBase();
    const fontUrl = buildFileDownloadUrl("zh.subset.woff2", { apiBase });
    if (!fontUrl) return;
    wx.loadFontFace({
      family: "ZhSubset",
      source: `url("${fontUrl}")`,
      global: false,
      success: () => { },
      fail: (err) => {
        console.warn("loadCheckinFont failed", err);
      }
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
    return this.runWithLoginRetry(() => fetchUserProfile({ apiBase }))
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

  ensureAccessToken(options = {}) {
    if (getAuthToken()) {
      return Promise.resolve();
    }
    if (this._ensureLoginPromise) {
      return this._ensureLoginPromise;
    }
    if (typeof getApp !== "function") {
      return Promise.reject(new Error("login-unavailable"));
    }
    const app = getApp();
    if (!app || typeof app.loginWithProfile !== "function") {
      return Promise.reject(new Error("login-unavailable"));
    }
    const profile = options.profileOverride || loadStoredProfile() || {};
    this._ensureLoginPromise = app
      .loginWithProfile(profile)
      .catch((err) => {
        throw err || new Error("login-failed");
      })
      .finally(() => {
        this._ensureLoginPromise = null;
      });
    return this._ensureLoginPromise;
  },

  ensureValidToken(options = {}) {
    const token = getAuthToken();
    if (!token) {
      return this.ensureAccessToken(options);
    }
    if (typeof getApp !== "function") {
      return Promise.resolve();
    }
    const app = getApp();
    if (app && typeof app.validateStoredToken === "function") {
      return app.validateStoredToken(token);
    }
    return Promise.resolve();
  },

  runWithLoginRetry(task, options = {}) {
    const allowRetry = options.allowRetry !== false;
    return Promise.resolve()
      .then(() => task())
      .catch((err) => {
        if (allowRetry && err?.message === "missing-token") {
          return this.ensureAccessToken()
            .then(() => this.runWithLoginRetry(task, { allowRetry: false }));
        }
        throw err;
      });
  },

  loadCheckinDetail() {
    const apiBase = resolveApiBase();
    const todayDate = formatDate(new Date());
    this.setData({ loading: true, error: "", todayDate });
    return this.runWithLoginRetry(() => fetchCheckinDetail({ apiBase }))
      .then((detail = {}) => {
        const weekDays = this.buildWeekDays(detail, todayDate);
        const canCheckinToday = !detail.todaySigned && weekDays.some((item) => item.isToday);
        this.setData({
          loading: false,
          continuousDays: Number(detail.continuousDays) || 0,
          weekDays,
          canCheckinToday
        });
        this.refreshLotteryEligibility({
          continuousDays: Number(detail.continuousDays) || 0,
          todayDate
        });
      })
      .catch((err) => {
        const message =
          err?.message === "missing-token"
            ? "未登录，暂时无法签到"
            : err?.message || "加载失败，请稍后重试";
        this.setData({ loading: false, error: message, weekDays: [], canCheckinToday: false, canLotteryToday: false });
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
        fail: () => resolve([])
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
        this.setCheckinSubscriptionBannerVisibility(false);
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
        this.setCheckinSubscriptionBannerVisibility(false);
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
        this.setCheckinSubscriptionBannerVisibility(false);
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
      const parsedDate = parseDate(date);
      const isSunday = parsedDate ? parsedDate.getDay() === 0 : weekdayLabel === "周日";
      const bonus = !isSunday && isDoubleReward(item.weekday || weekdayLabel);
      const rewardValue = bonus ? 0.2 : 0.1;
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

  onTurntableTap() {
    this.setData({
      showLotteryModal: true,
      isLotteryFinished: false,
      lotteryResultText: "",
      lotteryResultImage: "",
      lotteryResultIsFlp: true
    });
    this.loadLotteryConfig();
  },

  onCheckinTap() {
    const apiBase = resolveApiBase();
    const app = typeof getApp === "function" ? getApp() : null;
    const guideActive = !!(app && app.globalData && app.globalData.checkinGuide?.active);
    if (guideActive) {
      completeNewbieTask(2, { apiBase, token: getAuthToken() })
        .catch((err) => {
          console.warn("complete newbie task 2 failed", err);
        });
      app.globalData.checkinGuide = { active: false, step: "" };
    }
    if (!this.data.canCheckinToday) return;
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
      title: "每日签到领FLP，连签还可抽大奖~",
      path: appendInviteCodeToPath(CHECKIN_PAGE_PATH, { inviteCode })
    };
  },

  onShareTimeline() {
    const inviteCode = getShareInviteCode();
    return {
      title: "每日签到领FLP，连签还可抽大奖~",
      query: appendInviteCodeToQuery(CHECKIN_PAGE_PATH, { inviteCode })
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
    this.setData({
      showLotteryModal: false,
      lotteryActiveIndex: -1,
      isLotteryDrawing: false,
      isLotteryFinished: false,
      lotteryResultText: "",
      lotteryResultImage: "",
      lotteryResultIsFlp: true
    });
  },

  onLotteryMaskTouchMove() { },

  onLotteryCardTap() { },

  onLotteryButtonTap() {
    if (!this.data.canLotteryToday) {
      wx.showToast({ title: "连签满7天才可抽奖哦~", icon: "none" });
      return;
    }
    if (this.data.isLotteryDrawing) return;
    this._triggerLotteryButtonActive();
    this._lotteryTargetOrderIndex = null;
    this._lotteryResult = null;
    this.setData({
      isLotteryFinished: false,
      lotteryResultText: "",
      lotteryResultImage: "",
      lotteryResultIsFlp: true
    });
    this._startLotterySpin();
    this._requestLotteryDraw();
  },

  refreshLotteryEligibility({ continuousDays, todayDate } = {}) {
    const apiBase = resolveApiBase();
    if (!apiBase) {
      this.setData({ canLotteryToday: false });
      return Promise.resolve();
    }
    return fetchLotteryLogs({ apiBase, page: 0, size: 20 })
      .then((data = {}) => {
        const logs = Array.isArray(data.content) ? data.content : [];
        const hasDrawToday = logs.some((item) => isSameDate(todayDate, item?.createdAt));
        const canLotteryToday = shouldEnableTurntable({ todayDate, continuousDays, hasDrawToday });
        this.setData({ canLotteryToday });
      })
      .catch((err) => {
        if (err?.message !== "missing-token") {
          console.warn("refreshLotteryEligibility failed", err);
        }
        const canLotteryToday = shouldEnableTurntable({
          todayDate,
          continuousDays,
          hasDrawToday: false
        });
        this.setData({ canLotteryToday });
      });
  },

  loadLotteryConfig({ fallbackOnly = false } = {}) {
    const apiBase = resolveApiBase();
    const fallback = buildLotteryDisplay(DEFAULT_LOTTERY_CONFIG, apiBase);
    if (fallbackOnly) {
      this._lotteryLevelIndexMap = fallback.levelToOrderIndex;
      this.setData({ lotteryPrizes: fallback.prizes });
      return Promise.resolve();
    }
    return fetchLotteryConfig({ apiBase })
      .then((config = {}) => {
        const prizes = Array.isArray(config.prizes) ? config.prizes : [];
        if (prizes.length === LOTTERY_ORDER.length) {
          const display = buildLotteryDisplay(prizes, apiBase);
          this._lotteryLevelIndexMap = display.levelToOrderIndex;
          this.setData({ lotteryPrizes: display.prizes });
          return;
        }
        this._lotteryLevelIndexMap = fallback.levelToOrderIndex;
        this.setData({ lotteryPrizes: fallback.prizes });
      })
      .catch((err) => {
        if (err?.message !== "missing-token") {
          console.warn("loadLotteryConfig failed", err);
        }
        this._lotteryLevelIndexMap = fallback.levelToOrderIndex;
        this.setData({ lotteryPrizes: fallback.prizes });
      });
  },

  _requestLotteryDraw() {
    const apiBase = resolveApiBase();
    drawLottery({ apiBase })
      .then((result = {}) => {
        this._lotteryResult = result;
        const isFlpPrize = !!result.flp;
        const flpCount = Number(result.flpCount);
        const description = typeof result.description === "string" ? result.description.trim() : "";
        const imageUrl = typeof result.imageUrl === "string" ? result.imageUrl.trim() : "";
        const displayText = isFlpPrize && Number.isFinite(flpCount)
          ? `FLP+${formatReward(flpCount)}`
          : description;
        const displayImage = isFlpPrize
          ? "/pages/profile/assets/flp-coin.png"
          : (imageUrl ? buildAvatarDownloadUrl(imageUrl, { apiBase }) : "");
        this.setData({
          lotteryResultText: displayText,
          lotteryResultImage: displayImage,
          lotteryResultIsFlp: isFlpPrize
        });
        const level = Number(result.prizeLevel);
        const targetOrderIndex = this._lotteryLevelIndexMap?.get(level);
        if (typeof targetOrderIndex === "number") {
          this._lotteryTargetOrderIndex = targetOrderIndex;
          this._handleLotteryResultReady();
        }
      })
      .catch((err) => {
        console.warn("drawLottery failed", err);
        if (this.data.isLotteryDrawing) {
          this._finishLotterySpin();
        }
        wx.showToast({ title: err?.message || "", icon: "none" });
      });
  },

  _startLotterySpin() {
    const order = LOTTERY_ORDER;
    if (!order.length) return;
    this._clearLotteryTimers();
    this._lotteryPhase = "fast";
    this._lotterySpinState = { orderIndex: 0 };
    this.setData({ isLotteryDrawing: true, lotteryActiveIndex: order[0] });
    const fastInterval = LOTTERY_FAST_DURATION / order.length;
    const timers = [];
    for (let i = 1; i < order.length; i += 1) {
      const delay = Math.round(fastInterval * i);
      timers.push(
        setTimeout(() => {
          this._lotterySpinState.orderIndex = i;
          this.setData({ lotteryActiveIndex: order[i] });
        }, delay)
      );
    }
    timers.push(setTimeout(() => this._enterLotteryAwaitPhase(), LOTTERY_FAST_DURATION));
    this._lotteryTimers = timers;
  },

  _enterLotteryAwaitPhase() {
    if (this._lotteryPhase !== "fast") return;
    const targetOrderIndex = this._lotteryTargetOrderIndex;
    if (typeof targetOrderIndex === "number") {
      this._scheduleLotteryStop(targetOrderIndex, LOTTERY_TOTAL_DURATION - LOTTERY_FAST_DURATION, 2);
      return;
    }
    this._lotteryPhase = "await";
    const order = LOTTERY_ORDER;
    const spin = () => {
      if (this._lotteryPhase !== "await") return;
      const current = this._lotterySpinState.orderIndex || 0;
      const nextIndex = (current + 1) % order.length;
      this._lotterySpinState.orderIndex = nextIndex;
      this.setData({ lotteryActiveIndex: order[nextIndex] });
      this._lotteryAwaitTimer = setTimeout(spin, LOTTERY_AWAIT_INTERVAL);
    };
    this._lotteryAwaitTimer = setTimeout(spin, LOTTERY_AWAIT_INTERVAL);
  },

  _handleLotteryResultReady() {
    if (!this.data.isLotteryDrawing) return;
    if (this._lotteryPhase === "fast") {
      return;
    }
    if (this._lotteryPhase === "await") {
      this._scheduleLotteryStop(this._lotteryTargetOrderIndex, LOTTERY_LATE_DURATION, 1);
    }
  },

  _scheduleLotteryStop(targetOrderIndex, duration, extraCycles) {
    const order = LOTTERY_ORDER;
    if (!order.length) return;
    if (this._lotteryAwaitTimer) {
      clearTimeout(this._lotteryAwaitTimer);
      this._lotteryAwaitTimer = null;
    }
    this._lotteryPhase = "decel";
    let orderIndex = this._lotterySpinState?.orderIndex || 0;
    const baseOffset = (targetOrderIndex - orderIndex + order.length) % order.length;
    let steps = baseOffset === 0 ? order.length : baseOffset;
    steps += order.length * Math.max(extraCycles, 0);

    const weights = [];
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      weights.push(0.6 + 1.8 * t * t);
    }
    const weightSum = weights.reduce((sum, value) => sum + value, 0);
    let elapsed = 0;
    const timers = [];

    for (let i = 0; i < steps; i += 1) {
      const interval = duration * (weights[i] / weightSum);
      elapsed += interval;
      orderIndex = (orderIndex + 1) % order.length;
      const activeIndex = order[orderIndex];
      const isFinal = i === steps - 1;
      timers.push(
        setTimeout(() => {
          this._lotterySpinState.orderIndex = orderIndex;
          this.setData({ lotteryActiveIndex: activeIndex, isLotteryDrawing: !isFinal });
          if (isFinal) {
            this._lotteryPhase = null;
            this.setData({ isLotteryFinished: true });
          }
        }, Math.round(elapsed))
      );
    }

    this._lotteryTimers = (this._lotteryTimers || []).concat(timers);
  },

  _finishLotterySpin() {
    this._clearLotteryTimers();
    this.setData({ isLotteryDrawing: false, isLotteryFinished: false });
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
    if (this._lotteryAwaitTimer) {
      clearTimeout(this._lotteryAwaitTimer);
      this._lotteryAwaitTimer = null;
    }
    this._lotteryPhase = null;
  },

  onLotteryClaimTap() {
    this._clearLotteryTimers();
    this._clearLotteryButtonTimer();
    this.setData({
      showLotteryModal: false,
      lotteryActiveIndex: -1,
      isLotteryDrawing: false,
      isLotteryFinished: false,
      lotteryResultText: "",
      lotteryResultImage: "",
      lotteryResultIsFlp: true
    });
    this.refreshFlp();
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
        fail: (err = {}) => {
          if (typeof err.errMsg === "string" && err.errMsg.toLowerCase().includes("cancel")) {
            return;
          }
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




















