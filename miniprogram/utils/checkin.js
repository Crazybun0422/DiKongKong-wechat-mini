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

function makeupCheckin(date, options = {}) {
  const targetDate = `${date || ""}`.trim();
  if (!targetDate) return Promise.reject(new Error("missing-checkin-date"));
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/checkins/makeup",
    method: "POST",
    data: { date: targetDate }
  }).then((body = {}) => body.data || {});
}

function assistCheckin(payload = {}, options = {}) {
  const featureCode = `${payload.featureCode || ""}`.trim();
  const date = `${payload.date || ""}`.trim();
  if (!featureCode) return Promise.reject(new Error("missing-feature-code"));
  if (!date) return Promise.reject(new Error("missing-checkin-date"));
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/checkins/assist",
    method: "POST",
    data: { featureCode, date }
  }).then((body = {}) => body.data || {});
}

module.exports = {
  fetchCheckinDetail,
  checkin,
  makeupCheckin,
  assistCheckin
};
