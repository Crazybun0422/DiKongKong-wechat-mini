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

module.exports = {
  fetchLotteryConfig,
  drawLottery
};
