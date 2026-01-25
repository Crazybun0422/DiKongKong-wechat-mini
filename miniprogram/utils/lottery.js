const { authorizedRequest } = require("./profile");

function fetchLotteryConfig(options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/lottery/config",
    method: "GET"
  }).then((body = {}) => body.data || {});
}

function drawLottery(options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/lottery/draw",
    method: "POST"
  }).then((body = {}) => body.data || {});
}

function fetchLotteryLogs(options = {}) {
  const page = Number.isFinite(options.page) ? options.page : 0;
  const size = Number.isFinite(options.size) ? options.size : 20;
  const query = `?page=${page}&size=${size}`;
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/lottery/logs${query}`,
    method: "GET"
  }).then((body = {}) => body.data || {});
}

module.exports = {
  fetchLotteryConfig,
  drawLottery,
  fetchLotteryLogs
};
