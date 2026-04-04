const { fetchUserProfile } = require("../../../utils/profile");
const {
  fetchLatestUserAgreement,
  fetchLatestPrivacyPolicy,
  extractPolicyAccessVersions,
  normalizePolicyVersion,
  recordPolicyAccess
} = require("../../../utils/policies");
const {
  fetchCoordinateSystemDescription,
  fetchCoordinateLongPressGuide
} = require("../../../utils/map-guides");
const { transformHtmlContent } = require("../../../utils/open-platform");

function autoLoginOnLaunch(page) {
  page.ensureAccessToken()
    .then(() => {
      page.loadMapGuideConfigs().catch((err) => {
        console.warn("loadMapGuideConfigs failed", err);
      });
      wx.nextTick(() => {
        const popup = page.selectComponent("#newbie-task-popup");
        if (popup && typeof popup.loadTasks === "function") {
          popup.loadTasks();
        }
      });
    })
    .catch((err) => {
      console.warn("自动登录失败", err);
    });
}

function loadMapGuideConfigs(page) {
  const apiBase = page.getApiBase();
  if (!apiBase) {
    page.setData({
      coordinateSystemDescriptionNodes: "",
      coordinateLongPressGuideNodes: ""
    });
    page._mapGuideConfigLoaded = false;
    return Promise.resolve();
  }
  const token = page.getAuthToken();
  if (!token) {
    page.setData({
      coordinateSystemDescriptionNodes: "",
      coordinateLongPressGuideNodes: ""
    });
    page._mapGuideConfigLoaded = false;
    return Promise.resolve();
  }
  const parseRichText = (content) => {
    const html = typeof content === "string" ? content : "";
    if (!html.trim()) return "";
    return transformHtmlContent(html, { apiBase });
  };
  const loadCoordinateSystemDescription = fetchCoordinateSystemDescription({ apiBase, token })
    .then((payload = {}) => parseRichText(payload.content))
    .catch((err) => {
      console.warn("loadCoordinateSystemDescription failed", err);
      return "";
    });
  const loadCoordinateLongPressGuide = fetchCoordinateLongPressGuide({ apiBase, token })
    .then((payload = {}) => parseRichText(payload.content))
    .catch((err) => {
      console.warn("loadCoordinateLongPressGuide failed", err);
      return "";
    });
  return Promise.all([loadCoordinateSystemDescription, loadCoordinateLongPressGuide])
    .then(([coordinateSystemDescriptionNodes, coordinateLongPressGuideNodes]) => {
      page.setData({
        coordinateSystemDescriptionNodes,
        coordinateLongPressGuideNodes
      });
    })
    .finally(() => {
      page._mapGuideConfigLoaded = true;
    });
}

function checkPolicyUpdateOnLaunch(page) {
  if (page._policyUpdateChecking || page._policyUpdateChecked) return;
  page._policyUpdateChecking = true;
  const apiBase = page.getApiBase();
  if (!apiBase) {
    page._policyUpdateChecking = false;
    return;
  }
  const app = typeof getApp === "function" ? getApp() : null;
  const cachedProfile = app?.globalData?.latestUserProfile;
  const loadLatestPolicies = () =>
    Promise.all([
      fetchLatestUserAgreement({ apiBase }),
      fetchLatestPrivacyPolicy({ apiBase })
    ]);
  const loadProfile = () =>
    fetchUserProfile({
      apiBase,
      token: page.getAuthToken()
    });
  page.ensureAccessToken()
    .then(() => {
      const profilePromise = cachedProfile ? Promise.resolve(cachedProfile) : loadProfile();
      return Promise.all([profilePromise, loadLatestPolicies()]);
    })
    .then(([profile, [latestAgreement, latestPrivacy]]) => {
      if (app && app.globalData && profile && profile !== cachedProfile) {
        app.globalData.latestUserProfile = profile;
        app.globalData.latestUserProfileAt = Date.now();
      }
      const record = extractPolicyAccessVersions(profile || {});
      const agreementVersion = normalizePolicyVersion(latestAgreement?.version);
      const privacyVersion = normalizePolicyVersion(latestPrivacy?.version);
      const agreementNeedsUpdate =
        agreementVersion && record.userAgreementVersion !== agreementVersion;
      const privacyNeedsUpdate =
        privacyVersion && record.privacyPolicyVersion !== privacyVersion;
      if (!agreementNeedsUpdate && !privacyNeedsUpdate) {
        page._policyUpdateChecked = true;
        return;
      }
      const updateType = agreementNeedsUpdate && privacyNeedsUpdate
        ? "both"
        : (agreementNeedsUpdate ? "agreement" : "privacy");
      const title =
        updateType === "both"
          ? "协议更新提示"
          : (updateType === "agreement" ? "用户协议更新提示" : "隐私政策更新提示");
      page._policyUpdateVersions = {
        userAgreementVersion: agreementVersion || record.userAgreementVersion,
        privacyPolicyVersion: privacyVersion || record.privacyPolicyVersion
      };
      page._policyUpdatePolicies = {
        agreement: latestAgreement || null,
        privacy: latestPrivacy || null
      };
      page.setData({
        policyUpdateVisible: true,
        policyUpdateType: updateType,
        policyUpdateTitle: title,
        policyUpdateClosing: false,
        mapBlockerVisible: true
      }, () => {
        page.updateMapBlockerVisible();
      });
    })
    .catch((err) => {
      console.warn("checkPolicyUpdateOnLaunch failed", err);
    })
    .finally(() => {
      page._policyUpdateChecking = false;
    });
}

function onPolicyUpdateAgree(page) {
  if (page._policyUpdateSubmitting) return;
  const apiBase = page.getApiBase();
  const token = page.getAuthToken();
  const versions = page._policyUpdateVersions || {};
  const policies = page._policyUpdatePolicies || {};
  const updateType = page.data.policyUpdateType;
  if (!apiBase || !token) return;
  page._policyUpdateSubmitting = true;
  page.setData({ policyUpdateSubmitting: true });
  const tasks = [];
  if (updateType === "agreement" || updateType === "both") {
    const version = normalizePolicyVersion(policies?.agreement?.version || versions.userAgreementVersion);
    if (version) {
      tasks.push(
        recordPolicyAccess(
          {
            agreementType: "terms",
            version,
            docHash: policies?.agreement?.docHash,
            scene: "POPUP"
          },
          { apiBase, token }
        )
      );
    }
  }
  if (updateType === "privacy" || updateType === "both") {
    const version = normalizePolicyVersion(policies?.privacy?.version || versions.privacyPolicyVersion);
    if (version) {
      tasks.push(
        recordPolicyAccess(
          {
            agreementType: "privacy",
            version,
            docHash: policies?.privacy?.docHash,
            scene: "POPUP"
          },
          { apiBase, token }
        )
      );
    }
  }
  Promise.all(tasks)
    .then(() => {
      page._policyUpdateChecked = true;
      page.setData({ policyUpdateClosing: true }, () => {
        if (page._policyUpdateCloseTimer) {
          clearTimeout(page._policyUpdateCloseTimer);
        }
        page._policyUpdateCloseTimer = setTimeout(() => {
          page._policyUpdateCloseTimer = null;
          page.setData({
            policyUpdateVisible: false,
            policyUpdateClosing: false,
            policyUpdateSubmitting: false
          }, () => {
            page.updateMapBlockerVisible();
          });
        }, 240);
      });
    })
    .catch((err) => {
      console.warn("record policy access failed", err);
      wx.showToast({ title: "提交失败，请稍后重试", icon: "none" });
      page.setData({ policyUpdateSubmitting: false });
    })
    .finally(() => {
      page._policyUpdateSubmitting = false;
    });
}

function onPolicyUpdateDisagree(page) {
  if (typeof wx.exitMiniProgram === "function") {
    wx.exitMiniProgram();
    return;
  }
  if (page.data.policyUpdateVisible) {
    page.setData({ policyUpdateVisible: false }, () => {
      page.updateMapBlockerVisible();
    });
  }
  wx.showToast({ title: "请同意后继续使用", icon: "none" });
}

function onPolicyAgreementTap() {
  wx.navigateTo({ url: "/packages/guide/policy/index?type=agreement" });
}

function onPolicyPrivacyTap() {
  wx.navigateTo({ url: "/packages/guide/policy/index?type=privacy" });
}

module.exports = {
  autoLoginOnLaunch,
  loadMapGuideConfigs,
  checkPolicyUpdateOnLaunch,
  onPolicyUpdateAgree,
  onPolicyUpdateDisagree,
  onPolicyAgreementTap,
  onPolicyPrivacyTap
};
