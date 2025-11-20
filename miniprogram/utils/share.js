const { loadStoredProfile } = require("./profile");

const INVITE_QUERY_KEY = "inviteCode";
const PATH_PARAM_PATTERN = new RegExp(`(?:\\?|&)${INVITE_QUERY_KEY}=`);
const QUERY_PARAM_PATTERN = new RegExp(`(?:^|&)${INVITE_QUERY_KEY}=`);

const normalizeInviteCode = (value) => {
  if (value === undefined || value === null) return "";
  return `${value}`.trim();
};

const getAppInstance = () => {
  try {
    return typeof getApp === "function" ? getApp() : null;
  } catch (err) {
    console.warn("getApp failed in share utils", err);
    return null;
  }
};

function getShareInviteCode() {
  const app = getAppInstance();
  const fromGlobal = normalizeInviteCode(app?.globalData?.userInviteCode);
  if (fromGlobal) {
    return fromGlobal;
  }
  try {
    const stored = typeof loadStoredProfile === "function" ? loadStoredProfile() : null;
    const fromStored = normalizeInviteCode(stored?.inviteCode);
    if (fromStored) {
      return fromStored;
    }
  } catch (err) {
    console.warn("Failed to load stored invite code for sharing", err);
  }
  return "";
}

function appendInviteCodeToPath(path = "") {
  const inviteCode = getShareInviteCode();
  if (!inviteCode) return path || "";
  const safePath = path || "";
  if (PATH_PARAM_PATTERN.test(safePath)) {
    return safePath;
  }
  const delimiter = safePath.includes("?") ? "&" : "?";
  return `${safePath}${delimiter}${INVITE_QUERY_KEY}=${encodeURIComponent(inviteCode)}`;
}

function appendInviteCodeToQuery(query = "") {
  const inviteCode = getShareInviteCode();
  if (!inviteCode) return query || "";
  const safeQuery = query || "";
  if (QUERY_PARAM_PATTERN.test(safeQuery)) {
    return safeQuery;
  }
  const prefix = safeQuery ? `${safeQuery}&` : "";
  return `${prefix}${INVITE_QUERY_KEY}=${encodeURIComponent(inviteCode)}`;
}

module.exports = {
  INVITE_QUERY_KEY,
  getShareInviteCode,
  appendInviteCodeToPath,
  appendInviteCodeToQuery
};
