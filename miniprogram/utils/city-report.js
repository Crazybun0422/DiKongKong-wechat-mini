const { CITY_REPORT_CITY_CONFIGS } = require("./config");

const normalizeKey = (value) => (typeof value === "string" ? value.trim() : "");

const getCityReportConfig = (key) => {
  const cityKey = normalizeKey(key);
  if (!cityKey) return null;
  const cfg = CITY_REPORT_CITY_CONFIGS?.[cityKey] || null;
  return cfg && typeof cfg === "object" ? cfg : null;
};

const getCityReportMpLink = (key) => {
  const cfg = getCityReportConfig(key);
  console.log("getCityReportMpLink", key, cfg);
  const url = cfg?.mpLink || "";
  return typeof url === "string" ? url.trim() : "";
};

const buildCityReportWebviewPath = (params = {}) => {
  const url = getCityReportMpLink(params.city);
  console.log("buildCityReportWebviewPath", params, url);
  return url ? `/packages/city-report/h5/index?url=${encodeURIComponent(url)}` : "";
};

module.exports = {
  getCityReportConfig,
  getCityReportMpLink,
  buildCityReportWebviewPath
};
