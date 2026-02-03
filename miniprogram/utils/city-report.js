const buildCityReportWebviewPath = (url) => {
  const value = typeof url === "string" ? url.trim() : "";
  if (!value) return "";
  return `/packages/city-report/h5/index?url=${encodeURIComponent(value)}`;
};

module.exports = {
  buildCityReportWebviewPath
};
