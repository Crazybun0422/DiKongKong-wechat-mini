const { authorizedRequest } = require("./profile");
const { buildFileDownloadUrl } = require("./markers");

function extractFileName(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  const withoutFragment = text.split("#")[0];
  const withoutQuery = withoutFragment.split("?")[0];
  const parts = withoutQuery.split(/[/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : withoutQuery;
}

function fetchMemberGroupQrcode(options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/config/member-group-qrcode",
    method: "GET"
  }).then((body = {}) => {
    const data = body?.data || {};
    const fileName = extractFileName(data.imageUrl || "");
    return {
      imageUrl: buildFileDownloadUrl(fileName, options),
      updatedAt: data.updatedAt || ""
    };
  });
}

module.exports = {
  fetchMemberGroupQrcode
};
