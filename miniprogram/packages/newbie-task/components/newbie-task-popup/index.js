const {
  fetchNewbieTasks,
  closeNewbieTaskPopup,
  completeNewbieTask,
  claimNewbieTaskReward
} = require("../../../../utils/newbie-tasks");
const { fetchCheckinDetail } = require("../../../../utils/checkin");
const { fetchFlpLogs } = require("../../../../utils/flp");
const { getLatestFontFileSource } = require("../../../../utils/font-config");

const POPUP_DURATION_MS = 30 * 1000;
const PROGRESS_INTERVAL_MS = 100;
const VIDEO_FINDER_USER_NAME = "sphW8PwCfzcysHB";

const getApiBase = () => {
  try {
    const app = typeof getApp === "function" ? getApp() : null;
    return (app && app.globalData && app.globalData.apiBase) || "";
  } catch (err) {
    return "";
  }
};

const getAuthToken = () => {
  try {
    const app = typeof getApp === "function" ? getApp() : null;
    return (app && app.globalData && app.globalData.token) || "";
  } catch (err) {
    return "";
  }
};

Component({
  data: {
    visible: false,
    tasks: [],
    remainingSeconds: 30,
    showScrollHint: false,
    rewardAvailable: false,
    showGiftEntry: false,
    showCountdownTitle: true,
    showRewardSuccess: false
  },
  lifetimes: {
    attached() {
      this.ensureFontLoaded();
      this.loadTasks();
    }
  },
  pageLifetimes: {
    show() {
      this.loadTasks();
    },
    hide() {
      this.stopPopupTimer();
    }
  },
  methods: {
    noop() { },
    normalizeTaskPayload(payload = {}) {
      const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
      const showPopup = !!payload.showThirtySecondPopup;
      const rewardAvailable = !!payload.rewardAvailable;
      const hasIncomplete = tasks.some((task) => !task.completed);
      const showGiftEntry = !showPopup && (hasIncomplete || rewardAvailable);
      return {
        tasks,
        showPopup,
        rewardAvailable,
        hasIncomplete,
        showGiftEntry
      };
    },
    applyTaskPayload(payload = {}, options = {}) {
      const normalized = this.normalizeTaskPayload(payload);
      this.setData({
        tasks: normalized.tasks,
        rewardAvailable: normalized.rewardAvailable,
        showGiftEntry: normalized.showGiftEntry
      });
      this.triggerStateChange({
        showGiftEntry: normalized.showGiftEntry,
        rewardAvailable: normalized.rewardAvailable,
        hasIncomplete: normalized.hasIncomplete,
        showPopup: normalized.showPopup,
        tasksCount: normalized.tasks.length
      });
      if (options.autoTogglePopup) {
        if (normalized.tasks.length && normalized.showPopup) {
          this.openPopup({ mode: "auto", tasks: normalized.tasks });
        } else {
          this.hidePopup({ persist: false, refresh: false });
        }
      }
      return normalized;
    },
    loadTasks(options = {}) {
      if (this._loading) return;
      const autoTogglePopup = options.autoTogglePopup !== false;
      const apiBase = getApiBase();
      const token = getAuthToken();
      if (!apiBase || !token) return;
      this._loading = true;
      fetchNewbieTasks({ apiBase, token })
        .then((payload = {}) => {
          this.applyTaskPayload(payload, { autoTogglePopup });
          wx.nextTick(() => {
            this.measureTaskList();
          });
        })
        .catch((err) => {
          console.warn("fetch newbie tasks failed", err);
        })
        .finally(() => {
          this._loading = false;
        });
    },
    ensureFontLoaded() {
      if (this._fontLoaded) return;
      const apiBase = getApiBase();
      this._fontLoaded = true;
      getLatestFontFileSource({ apiBase })
        .then((source) => {
          if (!source) {
            this._fontLoaded = false;
            return;
          }
          wx.loadFontFace({
            family: "ZhSubset",
            source: `url("${source}")`,
            global: false,
            success: () => { },
            fail: (err) => {
              this._fontLoaded = false;
              console.warn("load font face failed", err);
            }
          });
        })
        .catch((err) => {
          this._fontLoaded = false;
          console.warn("load font config failed", err);
        });
    },
    openPopup(options = {}) {
      if (this.data.visible) return;
      const mode = options.mode === "manual" ? "manual" : "auto";
      const showCountdownTitle = false;
      const tasks = Array.isArray(options.tasks) ? options.tasks : this.data.tasks;
      this._popupAuto = mode === "auto";
      this.setData({ visible: true, showCountdownTitle }, () => {
        this.triggerStateChange();
      });
      if (mode === "auto") {
        this.startPopupTimer();
      } else {
        this.stopPopupTimer();
        // Progress ring is removed; keep logic disabled for now.
        // this.setRemainingSeconds(0);
        // if (this._progressCtx) {
        //   this.drawProgress(1);
        // } else {
        //   this._pendingProgress = 1;
        // }
        // wx.nextTick(() => {
        //   this.initPopupCanvas();
        // });
      }
      wx.nextTick(() => {
        this.measureTaskList();
      });
      this.ensureTaskOneCompleted(tasks);
      this.ensureCheckinTaskCompleted(tasks);
      this.ensureInviteTaskCompleted(tasks);
    },
    hidePopup(options = {}) {
      const onHidden = typeof options.onHidden === "function" ? options.onHidden : null;
      if (!this.data.visible) {
        if (onHidden) onHidden();
        return;
      }
      this._popupAuto = false;
      this.setData({ visible: false }, () => {
        this.triggerStateChange();
        if (onHidden) onHidden();
      });
      this.stopPopupTimer();
      this._progressCtx = null;
      this._progressCanvas = null;
      this._progressSize = null;
      const shouldPersist = options.persist !== false;
      const shouldRefresh = options.refresh !== false;
      if (shouldPersist) {
        const apiBase = getApiBase();
        const token = getAuthToken();
        if (apiBase && token) {
          closeNewbieTaskPopup({ apiBase, token })
            .catch((err) => {
              console.warn("close newbie task popup failed", err);
            })
            .finally(() => {
              if (shouldRefresh) {
                this.loadTasks();
              }
            });
        }
      } else if (shouldRefresh) {
        this.loadTasks();
      }
    },
    onCloseTap() {
      this.hidePopup({ persist: true });
    },
    onPopupHoldTap() {
      if (!this._popupAuto || !this.data.visible) return;
      this._popupAuto = false;
      this.stopPopupTimer();
      this.setData({ showCountdownTitle: false });
      // Progress ring is removed; keep logic disabled for now.
      // this.setRemainingSeconds(0);
      // if (this._progressCtx) {
      //   this.drawProgress(1);
      // } else {
      //   this._pendingProgress = 1;
      //   wx.nextTick(() => {
      //     this.initPopupCanvas();
      //   });
      // }
    },
    openFromEntry() {
      this.openPopup({ mode: "manual" });
    },
    onRewardTap() {
      if (!this.data.rewardAvailable || this._claimingReward) return;
      const apiBase = getApiBase();
      const token = getAuthToken();
      if (!apiBase || !token) {
        wx.showToast({ title: "请先登录后领取", icon: "none" });
        return;
      }
      this._claimingReward = true;
      claimNewbieTaskReward({ apiBase, token })
        .then((payload = {}) => {
          const links = Array.isArray(payload.links) ? payload.links : [];
          const lines = [];
          links.forEach((link) => {
            const name = link && link.name ? String(link.name).trim() : "";
            const url = link && link.url ? String(link.url).trim() : "";
            if (name) lines.push(`网盘名称:${name}`);
            if (url) lines.push(`网盘连接:${url}`);
          });
          const copyText = lines.join("\n");
          const afterCopy = () => {
            this.hidePopup({ persist: false, refresh: false });
            this.setData({ rewardAvailable: false, showRewardSuccess: true }, () => {
              this.triggerStateChange();
            });
            this.loadTasks({ autoTogglePopup: false });
            if (typeof wx?.hideToast === "function") {
              wx.hideToast();
            }
          };
          if (copyText && typeof wx?.setClipboardData === "function") {
            wx.setClipboardData({
              data: copyText,
              showToast: false,
              success: afterCopy,
              fail: afterCopy
            });
          } else {
            afterCopy();
          }
        })
        .catch((err) => {
          const message = err?.message === "missing-token" ? "请先登录后领取" : "领取失败，请稍后再试";
          wx.showToast({ title: message, icon: "none" });
        })
        .finally(() => {
          this._claimingReward = false;
        });
    },
    onRewardSuccessClose() {
      if (this.data.showRewardSuccess) {
        this.setData({ showRewardSuccess: false }, () => {
          this.triggerStateChange();
        });
      }
    },
    ensureTaskOneCompleted(tasksOverride) {
      if (this._completingOne) return;
      const tasks = Array.isArray(tasksOverride) ? tasksOverride : this.data.tasks || [];
      const target = tasks.find((task) => Number(task.index) === 1);
      if (!target || target.completed) return;
      const apiBase = getApiBase();
      const token = getAuthToken();
      if (!apiBase || !token) return;
      this._completingOne = true;
      completeNewbieTask(1, { apiBase, token })
        .then((payload = {}) => {
          this.applyTaskPayload(payload);
          wx.nextTick(() => {
            this.measureTaskList();
          });
        })
        .catch((err) => {
          console.warn("complete newbie task failed", err);
        })
        .finally(() => {
          this._completingOne = false;
        });
    },
    startPopupTimer() {
      this.stopPopupTimer();
      // Countdown/progress disabled: keep popup open without auto-close.
      // this._popupStart = Date.now();
      // this._lastRemainingSeconds = null;
      // this.setRemainingSeconds(30);
      // wx.nextTick(() => {
      //   this.initPopupCanvas();
      //   this.drawProgress(0);
      // });
      // this._popupTimer = setInterval(() => {
      //   const elapsed = Date.now() - this._popupStart;
      //   const progress = Math.min(1, elapsed / POPUP_DURATION_MS);
      //   this.setRemainingSeconds(Math.ceil((POPUP_DURATION_MS - elapsed) / 1000));
      //   this.drawProgress(progress);
      //   if (progress >= 1) {
      //     this.setRemainingSeconds(0);
      //     this.hidePopup({ persist: true });
      //   }
      // }, PROGRESS_INTERVAL_MS);
    },
    stopPopupTimer() {
      if (this._popupTimer) {
        clearInterval(this._popupTimer);
      }
      this._popupTimer = null;
    },
    initPopupCanvas() {
      if (this._progressCtx) return;
      const query = this.createSelectorQuery();
      query
        .select("#newbie-close-progress")
        .fields({ node: true, size: true })
        .exec((res) => {
          const info = res && res[0];
          const canvas = info && info.node;
          if (!canvas) return;
          const ctx = canvas.getContext("2d");
          const dpr = wx.getSystemInfoSync().pixelRatio || 1;
          const width = info.width || 0;
          const height = info.height || 0;
          if (!width || !height) return;
          canvas.width = width * dpr;
          canvas.height = height * dpr;
          ctx.scale(dpr, dpr);
          this._progressCanvas = canvas;
          this._progressCtx = ctx;
          this._progressSize = { width, height };
          if (typeof this._pendingProgress === "number") {
            const value = this._pendingProgress;
            this._pendingProgress = null;
            this.drawProgress(value);
          } else {
            this.drawProgress(0);
          }
        });
    },
    drawProgress(progress = 0) {
      const ctx = this._progressCtx;
      const size = this._progressSize;
      if (!ctx || !size) return;
      const width = size.width;
      const height = size.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) / 2 - 4;
      if (radius <= 0) return;
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#0C3BFF");
      gradient.addColorStop(0.16, "#2D86FF");
      gradient.addColorStop(0.34, "#66E7FF");
      gradient.addColorStop(0.5, "#E9FDFF");
      gradient.addColorStop(0.62, "#4FB9FF");
      gradient.addColorStop(0.78, "#6A5BFF");
      gradient.addColorStop(1, "#0B2E7A");
      ctx.beginPath();
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.shadowColor = "rgba(12, 59, 255, 0.35)";
      ctx.shadowBlur = 10;
      const start = -Math.PI / 2;
      const end = start + Math.PI * 2 * Math.max(0, Math.min(1, progress));
      ctx.arc(centerX, centerY, radius, start, end, false);
      ctx.stroke();
      ctx.restore();
    },
    setRemainingSeconds(value) {
      const nextValue = Math.max(0, Math.min(30, Number.isFinite(value) ? Math.round(value) : 0));
      if (this._lastRemainingSeconds === nextValue) return;
      this._lastRemainingSeconds = nextValue;
      this.setData({ remainingSeconds: nextValue });
    },
    triggerStateChange(payload) {
      const state = {
        popupVisible: !!this.data.visible,
        rewardVisible: !!this.data.showRewardSuccess,
        blockMap: !!(this.data.visible || this.data.showRewardSuccess)
      };
      this.triggerEvent("statechange", Object.assign(state, payload || {}));
    },
    measureTaskList() {
      if (!this.data.tasks.length) {
        this.setData({ showScrollHint: false });
        return;
      }
      const query = this.createSelectorQuery();
      query
        .select(".newbie-task-list")
        .fields({ size: true, scrollOffset: true, properties: ["scrollHeight"] })
        .exec((res) => {
          const info = res && res[0];
          if (!info) return;
          this._listViewHeight = info.height || 0;
          const scrollTop = info.scrollTop || 0;
          const scrollHeight = info.scrollHeight || 0;
          this.updateScrollHint(scrollTop, scrollHeight);
        });
    },
    onTaskListScroll(event) {
      const detail = event?.detail || {};
      this.updateScrollHint(detail.scrollTop || 0, detail.scrollHeight || 0);
    },
    onTaskActionTap(event) {
      const index = Number(event?.currentTarget?.dataset?.index);
      if (!Number.isFinite(index)) return;
      const runAction = () => {
        if (index === 2) {
          this.startCheckinGuide();
          return;
        }
        if (index === 3) {
          this.startVideoTask();
          return;
        }
        if (index === 4) {
          this.startInviteGuide();
        }
      };
      this.hidePopup({ persist: false, refresh: false, onHidden: runAction });
    },
    startCheckinGuide() {
      this.triggerEvent("checkinguide", { step: "map" });
    },
    startInviteGuide() {
      this.triggerEvent("inviteguide", { step: "map" });
    },
    startVideoTask() {
      const apiBase = getApiBase();
      const token = getAuthToken();
      const completeTask = () => {
        if (!apiBase || !token) return;
        completeNewbieTask(3, { apiBase, token })
          .then((payload = {}) => {
            this.applyTaskPayload(payload);
            wx.nextTick(() => {
              this.measureTaskList();
            });
          })
          .catch((err) => {
            console.warn("complete newbie task 3 failed", err);
          });
      };
      if (typeof wx?.openChannelsUserProfile === "function") {
        wx.openChannelsUserProfile({
          finderUserName: VIDEO_FINDER_USER_NAME,
          success: () => {
            completeTask();
          },
          fail: (err) => {
            if (err?.errMsg?.includes("cancel")) return;
            wx.showToast({ title: "打开失败", icon: "none" });
          }
        });
        return;
      }
      wx.showToast({ title: "暂不支持打开视频号", icon: "none" });
    },
    updateScrollHint(scrollTop, scrollHeight) {
      const viewHeight = this._listViewHeight || 0;
      const canScroll = scrollHeight > viewHeight + 4;
      const shouldShow = canScroll && scrollTop + viewHeight < scrollHeight - 4;
      if (this.data.showScrollHint !== shouldShow) {
        this.setData({ showScrollHint: shouldShow });
      }
    },
    ensureCheckinTaskCompleted(tasksOverride) {
      if (this._checkingCheckinStatus) return;
      const tasks = Array.isArray(tasksOverride) ? tasksOverride : this.data.tasks || [];
      const target = tasks.find((task) => Number(task.index) === 2);
      if (!target || target.completed) return;
      const apiBase = getApiBase();
      const token = getAuthToken();
      if (!apiBase || !token) return;
      this._checkingCheckinStatus = true;
      fetchCheckinDetail({ apiBase, token })
        .then((detail = {}) => {
          if (!detail.todaySigned) return;
          return completeNewbieTask(2, { apiBase, token }).then((payload = {}) => {
            this.applyTaskPayload(payload);
            wx.nextTick(() => {
              this.measureTaskList();
            });
          });
        })
        .catch((err) => {
          console.warn("checkin detail failed", err);
        })
        .finally(() => {
          this._checkingCheckinStatus = false;
        });
    },
    isInviteRewardLog(entry = {}) {
      const reason = typeof entry.reason === "string" ? entry.reason : "";
      const featureCode = typeof entry.featureCode === "string" ? entry.featureCode : "";
      const source = typeof entry.source === "string" ? entry.source : "";
      return [reason, featureCode, source].some((value) => /邀请|invite/i.test(value));
    },
    ensureInviteTaskCompleted(tasksOverride) {
      if (this._checkingInviteLogs) return;
      const tasks = Array.isArray(tasksOverride) ? tasksOverride : this.data.tasks || [];
      const target = tasks.find((task) => Number(task.index) === 4);
      if (!target || target.completed) return;
      const apiBase = getApiBase();
      const token = getAuthToken();
      if (!apiBase || !token) return;
      this._checkingInviteLogs = true;
      fetchFlpLogs({ page: 0, size: 20 }, { apiBase, token })
        .then((payload = {}) => {
          const list = Array.isArray(payload.content) ? payload.content : [];
          if (!list.some((entry) => this.isInviteRewardLog(entry))) return;
          return completeNewbieTask(4, { apiBase, token }).then((result = {}) => {
            this.applyTaskPayload(result);
            wx.nextTick(() => {
              this.measureTaskList();
            });
          });
        })
        .catch((err) => {
          console.warn("fetch invite flp logs failed", err);
        })
        .finally(() => {
          this._checkingInviteLogs = false;
        });
    }
  }
});
