const DEV_API_BASE_URL = "https://kylee-suborbital-herta.ngrok-free.dev";
const WEAPP_LOGIN_PATH = "/api/weapp/login";
const ACCESS_TOKEN_STORAGE_KEY = "accessToken";
const USER_PROFILE_STORAGE_KEY = "userProfile";
const INVITE_CODE_STORAGE_KEY = "pendingInviteCode";

const { fetchUserProfile } = require("./utils/profile");
const {
  fetchSubscriptions,
  updateSubscriptions,
  extractAcceptedTemplateIdsFromWxSetting,
  areTemplateIdSetsEqual
} = require("./utils/subscriptions");
const { prefetchFontFileConfig } = require("./utils/font-config");

// miniprogram/app.js
const API_BASE_BY_ENV = {
  //develop: "https://kylee-suborbital-herta.ngrok-free.dev", // IDE / preview
  develop: "https://skylane.cn",
  trial: "https://skylane.cn",                   // uploaded “体验版”
  // trial: "https://kylee-suborbital-herta.ngrok-free.dev",                   // uploaded “体验版”
  release: "https://skylane.cn"                        // 审核 & 上线
};

function resolveApiBase() {
  try {
    const { miniProgram } = wx.getAccountInfoSync();
    const env = miniProgram?.envVersion || "develop";       // develop | trial | release

    return API_BASE_BY_ENV[env] || API_BASE_BY_ENV.develop;
  } catch (err) {
    console.warn("Fallback to dev API base because env lookup failed", err);
    return API_BASE_BY_ENV.develop;
  }
}

const API_BASE_URL = resolveApiBase();

function decodeParamValue(value) {
  if (value === undefined || value === null) return "";
  const text = `${value}`.trim();
  if (!text) return "";
  try {
    return decodeURIComponent(text);
  } catch (err) {
    return text;
  }
}

function parseSceneParams(scene) {
  if (!scene || typeof scene !== "string") {
    return {};
  }
  let decoded = scene;
  try {
    decoded = decodeURIComponent(scene);
  } catch (err) {
    decoded = `${scene}`;
  }
  decoded = decoded.replace(/\+/g, " ");
  const params = {};
  decoded.split(/[&,|]/).forEach((segment) => {
    const chunk = segment.trim();
    if (!chunk) return;
    let separatorIndex = chunk.indexOf("=");
    if (separatorIndex < 0) {
      separatorIndex = chunk.indexOf(":");
    }
    if (separatorIndex < 0) {
      params[chunk] = "";
      return;
    }
    const key = chunk.slice(0, separatorIndex).trim();
    const value = chunk.slice(separatorIndex + 1).trim();
    if (!key) return;
    params[key] = value;
  });
  return params;
}

function extractInviteCodeFromOptions(options = {}) {
  const readInviteFromObject = (source) => {
    if (!source || typeof source !== "object") return "";
    const candidate = source.ic ?? source.inviteCode ?? source.invitationCode;
    if (candidate === undefined || candidate === null) return "";
    return decodeParamValue(candidate);
  };
  if (!options || typeof options !== "object") {
    return "";
  }
  const direct = readInviteFromObject(options);
  if (direct) return direct;
  if (options.query) {
    const fromQuery = readInviteFromObject(options.query);
    if (fromQuery) return fromQuery;
  }
  const sceneParams = parseSceneParams(options.scene);
  const fromScene = readInviteFromObject(sceneParams);
  if (fromScene) return fromScene;
  if (typeof options.q === "string" && options.q.trim()) {
    const decoded = decodeParamValue(options.q);
    const queryIndex = decoded.indexOf("?");
    const queryString = queryIndex >= 0 ? decoded.slice(queryIndex + 1) : decoded;
    const qParams = parseSceneParams(queryString);
    const fromQ = readInviteFromObject(qParams);
    if (fromQ) return fromQ;
  }
  return "";
}

App({
  globalData: {
    version: "0.0.1",
    buildFrom: "vue-tencent-map-demo",
    token: null,
    userProfile: null,
    apiBase: API_BASE_URL,
    pendingMarkerFocus: null,
    pendingPinPreview: null,
    pendingInviteCode: "",
    subscriptionAcceptedTemplateIds: [],
    subscriptionSettingsReady: false,
    subscriptionMainSwitch: true,
    showSubscribeWaitOverlay: false
  },

  onLaunch(options = {}) {
    console.log("Mini program launched");
    const launchInvite = extractInviteCodeFromOptions(options);
    if (launchInvite) {
      this.setPendingInviteCode(launchInvite);
      console.log("Extracted invite code from launch options:", launchInvite);
    }
    try {
      const storedToken = wx.getStorageSync(ACCESS_TOKEN_STORAGE_KEY);
      if (storedToken) this.globalData.token = storedToken;
    } catch (err) {
      console.warn("Failed to read stored access token", err);
    }
    try {
      const storedProfile = wx.getStorageSync(USER_PROFILE_STORAGE_KEY);
      if (storedProfile && typeof storedProfile === "object") {
        const nickname = storedProfile.nickname || storedProfile.nickName || "";
        const avatarUrl = storedProfile.avatarUrl || "";
        if (nickname || avatarUrl) {
          this.globalData.userProfile = { nickName: nickname, avatarUrl };
        }
      }
    } catch (err) {
      console.warn("Failed to read stored user profile", err);
    }
    try {
      const cachedInvite = wx.getStorageSync(INVITE_CODE_STORAGE_KEY);
      if (typeof cachedInvite === "string" && cachedInvite.trim()) {
        this.globalData.pendingInviteCode = cachedInvite.trim();
      }
    } catch (err) {
      console.warn("Failed to read cached invite code", err);
    }

    if (this.globalData.token) {
      this.validateStoredToken(this.globalData.token).catch((err) => {
        console.warn("Failed to validate stored token, attempting re-login", err);
      });
      this.syncSubscriptionsFromWxSetting();
    }

    prefetchFontFileConfig({ apiBase: this.globalData.apiBase }).catch((err) => {
      console.warn("prefetch font config failed", err);
    });

    this.initUpdateManager();
  },

  validateStoredToken(token) {
    return fetchUserProfile({
      token,
      apiBase: API_BASE_URL
    })
      .then((profile) => {
        const nickname = profile.nickname || profile.nickName || "";
        const avatarUrl = profile.avatarUrl || profile.avatar || "";
        if (nickname || avatarUrl) {
          this.globalData.userProfile = { nickName: nickname, avatarUrl };
          try {
            wx.setStorageSync(USER_PROFILE_STORAGE_KEY, {
              nickname,
              avatarUrl
            });
          } catch (err) {
            console.warn("Failed to persist validated user profile", err);
          }
        }
        return profile;
      })
      .catch((err) => {
        console.warn("Stored token rejected, clearing it", err);
        this.globalData.token = null;
        try {
          wx.removeStorageSync(ACCESS_TOKEN_STORAGE_KEY);
        } catch (clearErr) {
          console.warn("Failed to clear invalid token", clearErr);
        }

        const cachedProfile = this.globalData.userProfile || {};
        return this.loginWithProfile({
          nickname: cachedProfile.nickName || cachedProfile.nickname || "",
          avatarUrl: cachedProfile.avatarUrl || ""
        });
      });
  },

  loginWithProfile(profile = {}) {
    return new Promise((resolve, reject) => {
      wx.login({
        success: (loginRes) => {
          const code = loginRes?.code;
          if (!code) {
            reject(new Error(loginRes?.errMsg || "wx.login did not return a code"));
            return;
          }
          const payload = { code };
          if (profile.nickname) payload.nickname = profile.nickname;
          if (profile.avatarUrl) payload.avatarUrl = profile.avatarUrl;
          const inviteCode = this.getPendingInviteCode();
          console.log("Found pending invite code during login:", inviteCode);
          if (inviteCode) {
            payload.inviteCode = inviteCode;
          }
          console.log("Refreshing login with profile payload:", payload);
          this.requestWeappLogin(payload)
            .then((token) => {
              if (inviteCode) {
                this.clearPendingInviteCode();
              }
              resolve(token);
            })
            .catch(reject);
        },
        fail: (err) => reject(err)
      });
    });
  },

  syncSubscriptionsFromWxSetting() {
    const apiBase = this.globalData.apiBase;
    const token = this.globalData.token;
    const canGetSetting = typeof wx !== "undefined" && typeof wx.getSetting === "function";
    console.log("Syncing subscriptions from WeChat settings with", { apiBase, token, canGetSetting });
    if (!canGetSetting) {
      this.globalData.subscriptionSettingsReady = true;
      this.globalData.subscriptionAcceptedTemplateIds = [];
      this.globalData.subscriptionMainSwitch = false;
      return Promise.resolve({ ids: [], mainSwitch: false });
    }
    return new Promise((resolve) => {
      wx.getSetting({
        withSubscriptions: true,
        success: (res = {}) => {
          console.log("wx.getSetting subscriptions success:", res);
          const mainSwitch = res?.subscriptionsSetting?.mainSwitch;
          const enabled = mainSwitch !== false;
          const clientIds = enabled
            ? extractAcceptedTemplateIdsFromWxSetting(res.subscriptionsSetting) || []
            : [];
          this.globalData.subscriptionAcceptedTemplateIds = clientIds;
          this.globalData.subscriptionMainSwitch = enabled;
          this.globalData.subscriptionSettingsReady = true;
          //console.log("Extracted accepted template IDs from WeChat settings:", { clientIds, mainSwitch: enabled });
          const syncPromise =
            apiBase && token && enabled
              ? fetchSubscriptions({ apiBase, token })
                .then((serverIds) => {
                  if (!areTemplateIdSetsEqual(clientIds, serverIds)) {
                    console.log("Syncing backend subscriptions to match WeChat settings:", { clientIds, serverIds });
                    return updateSubscriptions(clientIds, { apiBase, token }).catch((err) => {
                      console.warn("Failed to update backend subscriptions", err);
                      return null;
                    });
                  }
                  return null;
                })
                .catch((err) => {
                  console.warn("Failed to fetch backend subscriptions", err);
                })
              : Promise.resolve();
          syncPromise.finally(() => resolve({ ids: clientIds, mainSwitch: enabled }));
        },
        fail: (err) => {
          console.warn("wx.getSetting subscriptions failed", err);
          this.globalData.subscriptionSettingsReady = true;
          this.globalData.subscriptionAcceptedTemplateIds = [];
          this.globalData.subscriptionMainSwitch = false;
          resolve({ ids: [], mainSwitch: false });
        }
      });
    });
  },

  initUpdateManager() {
    if (this._updateManagerInitialized) return;
    this._updateManagerInitialized = true;
    if (typeof wx.getUpdateManager !== "function") {
      console.warn("UpdateManager is not available in this environment.");
      return;
    }
    const updateManager = wx.getUpdateManager();
    updateManager.onCheckForUpdate((res) => {
      console.log("Check for update", res.hasUpdate);
    });
    updateManager.onUpdateReady(() => {
      wx.showModal({
        title: "发现新版本",
        content: "已为你准备好新版，重启后即可使用最新功能。",
        confirmText: "立即更新",
        cancelText: "稍后",
        success: (modalRes) => {
          if (modalRes.confirm) {
            updateManager.applyUpdate();
          }
        }
      });
    });
    updateManager.onUpdateFailed((err) => {
      console.warn("Update failed", err);
      wx.showModal({
        title: "更新未完成",
        content: "下载新版本时遇到问题，请检查网络后重试。",
        confirmText: "我知道了",
        showCancel: false
      });
    });
  },

  fetchUserProfile(options = {}) {
    const { userInitiated = true } = options;

    return new Promise((resolve) => {
      const handleSuccess = (res) => {
        const info = res?.userInfo || {};
        const nick = info.nickName || "";
        const avatar = info.avatarUrl || "";
        const isAnonymous = !nick || nick === "微信用户";
        console.log("Fetched user profile:", { nickname: nick, avatarUrl: avatar });
        if (isAnonymous) {
          resolve({});
          return;
        }
        const profile = { nickname: nick, avatarUrl: avatar };
        this.globalData.userProfile = { nickName: nick, avatarUrl: avatar };
        try {
          wx.setStorageSync(USER_PROFILE_STORAGE_KEY, profile);
        } catch (err) {
          console.warn("Failed to persist user profile", err);
        }
        resolve(profile);
      };

      const handleFail = (err) => {
        console.warn("Failed to get user profile", err);
        resolve({});
      };

      const canUseGetUserProfile = typeof wx.getUserProfile === "function";
      const canUseGetUserInfo = typeof wx.getUserInfo === "function";

      if (userInitiated && canUseGetUserProfile) {
        wx.getUserProfile({
          desc: "用于完善个人资料",
          success: handleSuccess,
          fail: handleFail
        });
        return;
      }

      if (!userInitiated && canUseGetUserProfile) {
        console.info("Skipping wx.getUserProfile because it requires a user TAP gesture");
      }

      if (canUseGetUserInfo) {
        wx.getUserInfo({
          withCredentials: false,
          success: handleSuccess,
          fail: handleFail
        });
        return;
      }

      resolve({});
    });
  },

  setPendingInviteCode(inviteCode = "") {
    const code = typeof inviteCode === "string" ? inviteCode.trim() : `${inviteCode || ""}`.trim();
    if (!code) return;
    this.globalData.pendingInviteCode = code;
    if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
      try {
        wx.setStorageSync(INVITE_CODE_STORAGE_KEY, code);
      } catch (err) {
        console.warn("Failed to cache invite code", err);
      }
    }
  },

  getPendingInviteCode() {
    const cached = (this.globalData.pendingInviteCode || "").trim();
    if (cached) return cached;
    if (typeof wx !== "undefined" && typeof wx.getStorageSync === "function") {
      try {
        const stored = wx.getStorageSync(INVITE_CODE_STORAGE_KEY);
        if (typeof stored === "string" && stored.trim()) {
          this.globalData.pendingInviteCode = stored.trim();
          return stored.trim();
        }
      } catch (err) {
        console.warn("Failed to read cached invite code", err);
      }
    }
    return "";
  },

  clearPendingInviteCode() {
    this.globalData.pendingInviteCode = "";
    if (typeof wx !== "undefined" && typeof wx.removeStorageSync === "function") {
      try {
        wx.removeStorageSync(INVITE_CODE_STORAGE_KEY);
      } catch (err) {
        console.warn("Failed to clear cached invite code", err);
      }
    }
  },

  requestWeappLogin(payload = {}) {
    console.log("Requesting Weapp login with payload:", payload);
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${API_BASE_URL}${WEAPP_LOGIN_PATH}`,
        method: "POST",
        data: payload,
        header: {
          "content-type": "application/json"
        },
        success: (resp) => {
          const { statusCode, data } = resp || {};
          const token = data?.data?.token;
          if (statusCode >= 200 && statusCode < 300 && token) {
            this.globalData.token = token;
            try {
              wx.setStorageSync(ACCESS_TOKEN_STORAGE_KEY, token);
            } catch (err) {
              console.warn("Failed to persist access token", err);
            }
            console.log("Received auth token:", payload, token);
            this.syncSubscriptionsFromWxSetting();
            resolve(token);
          } else {
            const reason = data?.message || data?.errMsg || resp?.errMsg || "Unknown error";
            console.error(`Weapp login failed: ${statusCode || "n/a"}`, reason);
            reject(new Error(reason));
          }
        },
        fail: (err) => {
          console.error("Weapp login request failed", err);
          reject(err);
        }
      });
    });
  }
});
