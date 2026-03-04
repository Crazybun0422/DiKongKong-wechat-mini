const { authorizedRequest } = require("./profile");

function readApiData(body = {}) {
  if (!body || typeof body !== "object") return {};
  if (Object.prototype.hasOwnProperty.call(body, "data")) {
    return body.data || {};
  }
  return body;
}

function fetchLadderMyRank(options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/ladder-game/user/my-rank",
    method: "GET"
  }).then((body) => readApiData(body));
}

function fetchLadderLeaderboard(params = {}, options = {}) {
  const page = Number.isFinite(Number(params.page)) ? Number(params.page) : 0;
  const size = Number.isFinite(Number(params.size)) ? Number(params.size) : 10;
  const query = `?page=${Math.max(0, page)}&size=${Math.max(1, size)}`;
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/ladder-game/user/leaderboard${query}`,
    method: "GET"
  }).then((body) => readApiData(body));
}

function startLadderGame(payload = {}, options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/ladder-game/user/start",
    method: "POST",
    data: payload
  }).then((body) => readApiData(body));
}

function endLadderGame(payload = {}, options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/ladder-game/user/end",
    method: "POST",
    data: payload
  }).then((body) => readApiData(body));
}

module.exports = {
  fetchLadderMyRank,
  fetchLadderLeaderboard,
  startLadderGame,
  endLadderGame
};
