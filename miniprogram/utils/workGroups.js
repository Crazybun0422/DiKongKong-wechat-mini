const { authorizedRequest, resolveApiBase, getAuthToken, ensureFeatureCode } = require("./profile");
const { extractUploadedFileName } = require("./markers");

function listMyWorkGroups(params = {}, options = {}) {
  const query = [];
  const page = Number(params.page);
  const size = Number(params.size);
  if (Number.isFinite(page) && page >= 0) {
    query.push(`page=${page}`);
  }
  if (Number.isFinite(size) && size > 0) {
    query.push(`size=${size}`);
  }
  const qs = query.length ? `?${query.join("&")}` : "";
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/work-groups/mine${qs}`,
    method: "GET"
  }).then((body = {}) => body.data || {});
}

function fetchWorkGroupById(id, options = {}) {
  if (!id) return Promise.reject(new Error("missing-work-group-id"));
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/work-groups/${encodeURIComponent(id)}`,
    method: "GET"
  }).then((body = {}) => body.data || {});
}

function createWorkGroup(payload = {}, options = {}) {
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/work-groups",
    method: "POST",
    data: payload
  }).then((body = {}) => body.data || {});
}

function updateWorkGroup(id, payload = {}, options = {}) {
  if (!id) return Promise.reject(new Error("missing-work-group-id"));
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/work-groups/${encodeURIComponent(id)}`,
    method: "PUT",
    data: payload
  }).then((body = {}) => body.data || {});
}

function dissolveWorkGroup(id, options = {}) {
  if (!id) return Promise.reject(new Error("missing-work-group-id"));
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/work-groups/${encodeURIComponent(id)}`,
    method: "DELETE"
  }).then((body = {}) => body.data || {});
}

function exitWorkGroup(id, options = {}) {
  if (!id) return Promise.reject(new Error("missing-work-group-id"));
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/work-groups/${encodeURIComponent(id)}/exit`,
    method: "POST"
  }).then((body = {}) => body.data || {});
}

function updateMembers(id, memberFeatureCodes = [], method = "POST", options = {}) {
  if (!id) return Promise.reject(new Error("missing-work-group-id"));
  const codes = Array.isArray(memberFeatureCodes)
    ? memberFeatureCodes.filter(Boolean).map((code) => ensureFeatureCode(code))
    : [];
  if (!codes.length) return Promise.reject(new Error("missing-member-feature-codes"));
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/work-groups/${encodeURIComponent(id)}/members`,
    method,
    data: { memberFeatureCodes: codes }
  }).then((body = {}) => body.data || {});
}

function addWorkGroupMembers(id, memberFeatureCodes = [], options = {}) {
  return updateMembers(id, memberFeatureCodes, "POST", options);
}

function removeWorkGroupMembers(id, memberFeatureCodes = [], options = {}) {
  return updateMembers(id, memberFeatureCodes, "DELETE", options);
}

function fetchFeatureCodeProfiles(featureCodes = [], options = {}) {
  const codes = Array.isArray(featureCodes)
    ? featureCodes.filter(Boolean).map((code) => ensureFeatureCode(code))
    : [];
  if (!codes.length) return Promise.resolve([]);
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: "/api/users/feature-code-profiles",
    method: "POST",
    data: { featureCodes: codes }
  }).then((body = {}) => body.data || []);
}

function uploadWorkGroupImage(filePath, options = {}) {
  return new Promise((resolve, reject) => {
    if (!filePath) {
      reject(new Error("missing-file-path"));
      return;
    }
    const base = resolveApiBase(options.apiBase);
    if (!base) {
      reject(new Error("missing-api-base"));
      return;
    }
    const token = options.token || getAuthToken();
    wx.uploadFile({
      url: `${base}/api/files/upload`,
      filePath,
      name: "file",
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success: (res) => {
        try {
          const body = JSON.parse(res?.data || "{}");
          if (body && body.data) {
            const extracted = extractUploadedFileName(body.data);
            if (extracted) {
              resolve(extracted);
              return;
            }
            if (typeof body.data === "string" && body.data.trim()) {
              resolve(body.data.trim());
              return;
            }
          }
        } catch (err) {
          console.warn("解析上传响应失败", err);
        }
        reject(new Error("upload-work-group-image-failed"));
      },
      fail: (err) => reject(err)
    });
  });
}

function joinWorkGroup(id, invitationCode, options = {}) {
  if (!id) return Promise.reject(new Error("missing-work-group-id"));
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: `/api/work-groups/${encodeURIComponent(id)}/join`,
    method: "POST",
    data: { invitationCode }
  }).then((body = {}) => body.data || {});
}

module.exports = {
  listMyWorkGroups,
  createWorkGroup,
  updateWorkGroup,
  dissolveWorkGroup,
  exitWorkGroup,
  addWorkGroupMembers,
  removeWorkGroupMembers,
  fetchFeatureCodeProfiles,
  uploadWorkGroupImage,
  joinWorkGroup,
  fetchWorkGroupById
};
