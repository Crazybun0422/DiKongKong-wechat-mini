const { authorizedRequest } = require("./profile");
const NEWBIE_TASK_POPUP_RESTORE_KEY = "newbieTaskPopupVisible";

function deriveNewbieTaskState(payload = {}) {
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const rewardAvailable = !!payload.rewardAvailable;
  const showPopup = !!payload.showThirtySecondPopup;
  const hasIncomplete = tasks.some((task) => !task.completed);
  const showGiftEntry = !showPopup && (hasIncomplete || rewardAvailable);
  return {
    tasks,
    rewardAvailable,
    showPopup,
    hasIncomplete,
    showGiftEntry
  };
}

function requestNewbieTaskPopupOpen() {
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") return;
  try {
    wx.setStorageSync(NEWBIE_TASK_POPUP_RESTORE_KEY, "1");
  } catch (err) {
    console.warn("persist newbie task popup open request failed", err);
  }
}

function fetchNewbieTasks(options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/newbie-tasks",
    method: "GET"
  }).then((body = {}) => body.data || {});
}

function closeNewbieTaskPopup(options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/newbie-tasks/popup/close",
    method: "POST"
  }).then((body = {}) => body.data || {});
}

function completeNewbieTask(index, options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/newbie-tasks/complete",
    method: "POST",
    data: { index }
  }).then((body = {}) => body.data || {});
}

function claimNewbieTaskReward(options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/newbie-tasks/reward",
    method: "POST"
  }).then((body = {}) => body.data || {});
}

function claimNewbieTaskMemberReward(options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/newbie-tasks/member-reward",
    method: "POST"
  }).then((body = {}) => body.data || {});
}

module.exports = {
  deriveNewbieTaskState,
  requestNewbieTaskPopupOpen,
  fetchNewbieTasks,
  closeNewbieTaskPopup,
  completeNewbieTask,
  claimNewbieTaskReward,
  claimNewbieTaskMemberReward
};
