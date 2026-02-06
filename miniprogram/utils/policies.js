const { resolveApiBase, authorizedRequest } = require("./profile");

const USER_AGREEMENT_PATH = "/api/policies/user-agreements/latest";
const PRIVACY_POLICY_PATH = "/api/policies/privacy-policies/latest";
const ACCESS_RECORD_PATH = "/api/policies/access-record";

function normalizePolicyVersion(value) {
  if (value === undefined || value === null) return "";
  return `${value}`.trim();
}

function normalizePolicyContent(payload) {
  if (!payload || typeof payload !== "object") return null;
  const version = normalizePolicyVersion(payload.version);
  const content = typeof payload.content === "string" ? payload.content : "";
  return {
    id: payload.id,
    version,
    content,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt
  };
}

function requestPublicPolicy(path, options = {}) {
  const base = resolveApiBase(options.apiBase);
  if (!base) {
    return Promise.reject(new Error("missing-api-base"));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${base}${path}`,
      method: "GET",
      header: { "content-type": "application/json" },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data?.data ?? null);
        } else {
          const reason = res.data?.message || res.errMsg || `status-${res.statusCode}`;
          reject(new Error(typeof reason === "string" ? reason : JSON.stringify(reason)));
        }
      },
      fail: (err) => reject(err)
    });
  });
}

function fetchLatestUserAgreement(options = {}) {
  return requestPublicPolicy(USER_AGREEMENT_PATH, options).then((payload) =>
    normalizePolicyContent(payload)
  );
}

function fetchLatestPrivacyPolicy(options = {}) {
  return requestPublicPolicy(PRIVACY_POLICY_PATH, options).then((payload) =>
    normalizePolicyContent(payload)
  );
}

function extractPolicyAccessVersions(profile = {}) {
  const record = profile?.policyAccessRecord || {};
  const userAgreementVersion = normalizePolicyVersion(record.userAgreementVersion);
  const privacyPolicyVersion = normalizePolicyVersion(record.privacyPolicyVersion);
  return { userAgreementVersion, privacyPolicyVersion };
}

function shouldShowGuide(profile = {}) {
  const versions = extractPolicyAccessVersions(profile);
  return !versions.userAgreementVersion && !versions.privacyPolicyVersion;
}

function recordPolicyAccess(versions = {}, options = {}) {
  const userAgreementVersion = normalizePolicyVersion(versions.userAgreementVersion) || null;
  const privacyPolicyVersion = normalizePolicyVersion(versions.privacyPolicyVersion) || null;
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path: ACCESS_RECORD_PATH,
    method: "POST",
    data: { userAgreementVersion, privacyPolicyVersion }
  }).then((body = {}) => body?.data || {});
}

module.exports = {
  normalizePolicyVersion,
  fetchLatestUserAgreement,
  fetchLatestPrivacyPolicy,
  extractPolicyAccessVersions,
  shouldShowGuide,
  recordPolicyAccess
};
