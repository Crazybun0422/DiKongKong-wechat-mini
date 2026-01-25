const { authorizedRequest } = require("./profile");

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

module.exports = {
  fetchNewbieTasks,
  closeNewbieTaskPopup,
  completeNewbieTask,
  claimNewbieTaskReward
};
