const { authorizedRequest, resolveApiBase } = require("./profile");

function fetchLatestMerchantOperationData(options = {}) {
  return authorizedRequest({
    apiBase: resolveApiBase(options.apiBase),
    token: options.token,
    path: "/api/weapp/merchant-operation-data/latest",
    method: "GET"
  }).then((body = {}) => body?.data || {});
}

function fetchPlanetMerchantAdvancedGuide(options = {}) {
  return authorizedRequest({
    apiBase: resolveApiBase(options.apiBase),
    token: options.token,
    path: "/api/config/planet-merchant-advanced-guide",
    method: "GET"
  }).then((body = {}) => body?.data || {});
}

function fetchPlanetCreationAdvancedGuide(options = {}) {
  return authorizedRequest({
    apiBase: resolveApiBase(options.apiBase),
    token: options.token,
    path: "/api/config/planet-creation-advanced-guide",
    method: "GET"
  }).then((body = {}) => body?.data || {});
}

function fetchMerchantIntroLongImageConfig(options = {}) {
  return authorizedRequest({
    apiBase: resolveApiBase(options.apiBase),
    token: options.token,
    path: "/api/config/merchant-intro-long-image",
    method: "GET"
  }).then((body = {}) => body?.data || {});
}

module.exports = {
  fetchLatestMerchantOperationData,
  fetchPlanetMerchantAdvancedGuide,
  fetchPlanetCreationAdvancedGuide,
  fetchMerchantIntroLongImageConfig
};
