const { authorizedRequest } = require("./profile");

function buildQuery(params = {}) {
  const parts = [];
  if (params.province) {
    parts.push(`province=${encodeURIComponent(params.province)}`);
  }
  if (params.city) {
    parts.push(`city=${encodeURIComponent(params.city)}`);
  }
  if (params.county) {
    parts.push(`county=${encodeURIComponent(params.county)}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

function fetchReportEntries(params = {}, options = {}) {
  const query = buildQuery(params);
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/report-entries${query}`,
    method: "GET"
  }).then((body = {}) => {
    const data = body?.data;
    if (Array.isArray(data)) {
      return { entries: data, dialogText: "" };
    }
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    const dialogText = typeof data?.dialogText === "string" ? data.dialogText.trim() : "";
    return { entries, dialogText };
  });
}

module.exports = {
  fetchReportEntries
};
