const { authorizedRequest } = require("./profile");

function fetchCheckinDetail(options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/checkins/detail",
    method: "GET"
  }).then((body = {}) => body.data || {});
}

function checkin(options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/checkins",
    method: "POST"
  }).then((body = {}) => body.data || {});
}

module.exports = {
  fetchCheckinDetail,
  checkin
};
