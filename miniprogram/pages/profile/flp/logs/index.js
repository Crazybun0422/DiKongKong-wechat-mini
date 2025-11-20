const { fetchFlpLogs } = require("../../../../utils/flp");

const DEFAULT_PAGE_SIZE = 20;

Page({
  data: {
    logs: [],
    loading: true,
    loadingMore: false,
    hasMore: true,
    errorMessage: "",
    page: -1,
    size: DEFAULT_PAGE_SIZE
  },

  onLoad() {
    this.fetchLogs({ reset: true });
  },

  onPullDownRefresh() {
    this.fetchLogs({ reset: true }).finally(() => {
      if (typeof wx?.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh();
      }
    });
  },

  onReachBottom() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) {
      return;
    }
    this.fetchLogs();
  },

  getAppInstance() {
    try {
      return getApp ? getApp() : null;
    } catch (err) {
      console.warn("getApp failed", err);
      return null;
    }
  },

  getApiBase() {
    const app = this.getAppInstance();
    return (app && app.globalData && app.globalData.apiBase) || "";
  },

  getAuthToken() {
    const app = this.getAppInstance();
    return (app && app.globalData && app.globalData.token) || "";
  },

  fetchLogs(options = {}) {
    if (this._fetchingLogs) {
      return Promise.resolve();
    }
    const reset = !!options.reset;
    const nextPage = reset ? 0 : this.data.page + 1;

    this._fetchingLogs = true;
    this.setData({
      loading: reset,
      loadingMore: !reset,
      errorMessage: reset ? "" : this.data.errorMessage
    });

    return fetchFlpLogs(
      { page: nextPage, size: this.data.size },
      { apiBase: this.getApiBase(), token: this.getAuthToken() }
    )
      .then((payload = {}) => {
        const list = Array.isArray(payload.content) ? payload.content : [];
        const formatted = list.map((entry) => this.formatLogEntry(entry));
        const logs = reset ? formatted : this.data.logs.concat(formatted);
        const totalPages = Number(payload.totalPages);
        const currentPage =
          Number.isFinite(payload.page) && payload.page >= 0 ? payload.page : nextPage;
        const hasMore =
          Number.isFinite(totalPages) && totalPages > 0
            ? currentPage < totalPages - 1
            : formatted.length === this.data.size;
        this.setData({
          logs,
          page: currentPage,
          hasMore,
          loading: false,
          loadingMore: false,
          errorMessage: ""
        });
      })
      .catch((err) => {
        console.warn("fetch flp logs failed", err);
        const message =
          err && err.message === "missing-token"
            ? "请先登录后查看明细"
            : "加载失败，请稍后再试";
        this.setData({
          loading: false,
          loadingMore: false,
          errorMessage: message
        });
        if (typeof wx?.showToast === "function") {
          wx.showToast({ title: message, icon: "none" });
        }
      })
      .finally(() => {
        this._fetchingLogs = false;
      });
  },

  formatLogEntry(raw = {}) {
    const amount = Number(raw.amount);
    const operation = typeof raw.operation === "string" ? raw.operation.toUpperCase() : "";
    const isIncrease = operation !== "DECREASE";
    return {
      id:
        raw.id !== undefined && raw.id !== null
          ? raw.id
          : `${raw.featureCode || ""}-${raw.createdAt || ""}`,
      reason: this.resolveReason(raw),
      amountDisplay: this.formatAmount(amount, operation),
      isIncrease,
      timeDisplay: this.formatDateTime(raw.createdAt)
    };
  },

  resolveReason(raw = {}) {
    if (typeof raw.reason === "string" && raw.reason.trim()) {
      return raw.reason.trim();
    }
    const operation = typeof raw.operation === "string" ? raw.operation : "";
    return operation === "DECREASE" ? "鐐规暟鎵ｉ櫎" : "鐐规暟濂栧姳";
  },

  formatAmount(amount, operation) {
    if (!Number.isFinite(amount)) {
      return "--";
    }
    const abs = Math.abs(amount);
    const hasDecimal = Math.abs(abs - Math.round(abs)) > 0.00001;
    const valueText = hasDecimal
      ? abs.toFixed(2).replace(/\.?0+$/, "")
      : `${Math.round(abs)}`;
    const sign = operation === "DECREASE" ? "-" : "+";
    return `${sign}${valueText}`;
  },

  formatDateTime(value) {
    if (!value) return "--";
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "--";
      const yyyy = date.getFullYear();
      const mm = `${date.getMonth() + 1}`.padStart(2, "0");
      const dd = `${date.getDate()}`.padStart(2, "0");
      const hh = `${date.getHours()}`.padStart(2, "0");
      const mi = `${date.getMinutes()}`.padStart(2, "0");
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    } catch (err) {
      return "--";
    }
  }
});
