const { DEFAULT_AVATAR_PATH, loadStoredProfile } = require("../../../utils/profile");
const {
  queryPlanetAgentByAddress,
  extractPlanetAgentReplyText
} = require("../../../utils/planet-agent");

const CACHE_KEY = "planetQaConversationCacheV1";
const MAX_CACHE_ITEMS = 30;
const LOADING_COPY = "正在努力搜索中....";
const PLANET_LOGO_PRIMARY = "/packages/map-center-pin/assets/3d-planet-logo.png";
const PLANET_LOGO_FALLBACK = "/packages/map-center-pin/assets/ask-ai.png";
const FOLLOWUP_DISABLED_TIP = "暂不支持继续提问（更多功能敬请期待）";

function normalizeText(value) {
  if (value === undefined || value === null) return "";
  return `${value}`.trim();
}

function decodeQueryText(value) {
  const text = normalizeText(value);
  if (!text) return "";
  try {
    return decodeURIComponent(text);
  } catch (err) {
    return text;
  }
}

function createMessage(question = "", answer = "", loading = false, createdAt = Date.now()) {
  const normalizedCreatedAt = Number(createdAt) || Date.now();
  const id = `qa-${normalizedCreatedAt}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    domId: `msg-${id}`,
    question: normalizeText(question),
    answer: normalizeText(answer),
    loading: !!loading,
    createdAt: normalizedCreatedAt,
    loadingStartAt: loading ? normalizedCreatedAt : 0,
    elapsedSeconds: 0
  };
}

function normalizeCachedMessages(raw = []) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item = {}) =>
      createMessage(
        item.question || item.ask || "",
        item.answer || item.reply || "",
        false,
        Number(item.createdAt) || Date.now()
      )
    )
    .filter((item) => item.question || item.answer)
    .slice(-MAX_CACHE_ITEMS);
}

Page({
  data: {
    messages: [],
    inputValue: "",
    sending: false,
    scrollToId: "",
    userName: "用户",
    userAvatar: DEFAULT_AVATAR_PATH,
    planetName: "星球智能体",
    planetLogoSrc: PLANET_LOGO_PRIMARY,
    followupDisabled: true,
    followupDisabledTip: FOLLOWUP_DISABLED_TIP
  },

  onLoad(options = {}) {
    this.loadProfile();
    this.restoreMessagesFromCache();
    const initialAddress = decodeQueryText(options.address);
    const lat = Number(options.lat);
    const lng = Number(options.lng);
    const coordinateFallback =
      Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : "";
    const firstQuestion = initialAddress || coordinateFallback;
    if (!firstQuestion) return;
    this.setData({ inputValue: firstQuestion }, () => {
      this.submitQuestion(firstQuestion, { auto: true });
    });
  },

  onUnload() {
    this.stopLoadingTicker();
  },

  onPlanetLogoError() {
    if (this.data.planetLogoSrc === PLANET_LOGO_FALLBACK) return;
    this.setData({ planetLogoSrc: PLANET_LOGO_FALLBACK });
  },

  onInput(event = {}) {
    if (this.data.followupDisabled) return;
    const value = normalizeText(event?.detail?.value);
    this.setData({ inputValue: value });
  },

  onSendTap() {
    if (this.data.followupDisabled) {
      wx.showToast({ title: FOLLOWUP_DISABLED_TIP, icon: "none" });
      return;
    }
    this.submitQuestion(this.data.inputValue, { auto: false });
  },

  loadProfile() {
    let profile = {};
    try {
      profile = loadStoredProfile() || {};
    } catch (err) {
      profile = {};
    }
    const nickname = normalizeText(profile.nickname || profile.nickName) || "用户";
    const avatar = normalizeText(profile.avatarUrl) || DEFAULT_AVATAR_PATH;
    this.setData({
      userName: nickname,
      userAvatar: avatar
    });
  },

  restoreMessagesFromCache() {
    let cached = [];
    try {
      cached = wx.getStorageSync(CACHE_KEY);
    } catch (err) {
      cached = [];
    }
    const messages = normalizeCachedMessages(cached);
    if (!messages.length) return;
    this.setData({ messages }, () => {
      this.scrollToBottom();
      this.syncLoadingTicker();
    });
  },

  persistMessagesToCache(messages = []) {
    const payload = (Array.isArray(messages) ? messages : [])
      .slice(-MAX_CACHE_ITEMS)
      .map((item = {}) => ({
        question: item.question || "",
        answer: item.answer || "",
        createdAt: Number(item.createdAt) || Date.now()
      }));
    try {
      wx.setStorageSync(CACHE_KEY, payload);
    } catch (err) {
      console.warn("persist planet qa cache failed", err);
    }
  },

  updateMessageById(messageId, patch = {}) {
    const list = Array.isArray(this.data.messages) ? this.data.messages : [];
    const index = list.findIndex((item) => item.id === messageId);
    if (index < 0) return;
    const updates = {};
    Object.keys(patch || {}).forEach((key) => {
      updates[`messages[${index}].${key}`] = patch[key];
    });
    this.setData(updates, () => {
      this.scrollToBottom();
      this.persistMessagesToCache(this.data.messages);
      this.syncLoadingTicker();
    });
  },

  ensureLoadingTicker() {
    if (this._loadingTicker) return;
    this._loadingTicker = setInterval(() => {
      this.refreshLoadingElapsedSeconds();
    }, 1000);
  },

  stopLoadingTicker() {
    if (!this._loadingTicker) return;
    clearInterval(this._loadingTicker);
    this._loadingTicker = null;
  },

  refreshLoadingElapsedSeconds() {
    const list = Array.isArray(this.data.messages) ? this.data.messages : [];
    if (!list.length) return;
    const now = Date.now();
    const updates = {};
    let changed = false;
    list.forEach((item, idx) => {
      if (!item || !item.loading) return;
      const startAt = Number(item.loadingStartAt) || Number(item.createdAt) || now;
      const elapsed = Math.max(0, Math.floor((now - startAt) / 1000));
      if (Number(item.elapsedSeconds || 0) !== elapsed) {
        updates[`messages[${idx}].elapsedSeconds`] = elapsed;
        changed = true;
      }
    });
    if (!changed) return;
    this.setData(updates);
  },

  syncLoadingTicker() {
    const list = Array.isArray(this.data.messages) ? this.data.messages : [];
    const hasLoading = list.some((item) => item && item.loading);
    if (!hasLoading) {
      this.stopLoadingTicker();
      return;
    }
    this.refreshLoadingElapsedSeconds();
    this.ensureLoadingTicker();
  },

  scrollToBottom() {
    const list = Array.isArray(this.data.messages) ? this.data.messages : [];
    const last = list[list.length - 1];
    if (!last || !last.domId) return;
    this.setData({ scrollToId: last.domId });
  },

  submitQuestion(question, options = {}) {
    const auto = !!options.auto;
    const content = normalizeText(question);
    if (!content) {
      if (!auto) {
        wx.showToast({ title: "请输入内容", icon: "none" });
      }
      return;
    }
    if (this.data.sending) {
      if (!auto) {
        wx.showToast({ title: "正在搜索中", icon: "none" });
      }
      return;
    }

    const nextMessage = createMessage(content, LOADING_COPY, true, Date.now());
    const nextMessages = [...(this.data.messages || []), nextMessage].slice(-MAX_CACHE_ITEMS);
    this.setData(
      {
        messages: nextMessages,
        sending: true,
        inputValue: auto ? content : ""
      },
      () => {
        this.scrollToBottom();
        this.persistMessagesToCache(nextMessages);
        this.syncLoadingTicker();
      }
    );

    queryPlanetAgentByAddress(content)
      .then((responseBody = {}) => {
        const output = normalizeText(extractPlanetAgentReplyText(responseBody));
        const answer = output || "暂未获取到有效结果，请稍后重试。";
        this.updateMessageById(nextMessage.id, {
          answer,
          loading: false,
          loadingStartAt: 0
        });
      })
      .catch((err) => {
        console.warn("planet agent query failed", err);
        const msg = err?.message === "missing-token" ? "请先登录后再试" : "查询失败，请稍后重试。";
        this.updateMessageById(nextMessage.id, {
          answer: msg,
          loading: false,
          loadingStartAt: 0
        });
      })
      .finally(() => {
        this.setData({ sending: false });
      });
  }
});