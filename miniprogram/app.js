const DEV_API_BASE_URL = "https://kylee-suborbital-herta.ngrok-free.dev";
const WEAPP_LOGIN_PATH = "/api/weapp/login";
const ACCESS_TOKEN_STORAGE_KEY = "accessToken";
const USER_PROFILE_STORAGE_KEY = "userProfile";

// miniprogram/app.js
const API_BASE_BY_ENV = {
  //develop: "https://kylee-suborbital-herta.ngrok-free.dev", // IDE / preview
  develop: "https://skylane.cn",
  trial:   "https://skylane.cn",                   // uploaded “体验版”
  release: "https://skylane.cn"                        // 审核 & 上线
};

function resolveApiBase() {
  try {
    const { miniProgram } = wx.getAccountInfoSync();
    const env = miniProgram?.envVersion || "develop";       // develop | trial | release
    console.log("env->",env);
    return API_BASE_BY_ENV[env] || API_BASE_BY_ENV.develop;
  } catch (err) {
    console.warn("Fallback to dev API base because env lookup failed", err);
    return API_BASE_BY_ENV.develop;
  }
}

const API_BASE_URL = resolveApiBase();

App({
  globalData: {
    version: "0.0.1",
    buildFrom: "vue-tencent-map-demo",
    token: null,
    userProfile: null,
    apiBase: API_BASE_URL,
    pendingMarkerFocus: null
  },

  onLaunch() {
    console.log("Mini program launched");
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
          console.log("Refreshing login with profile payload:", payload);
          this.requestWeappLogin(payload).then(resolve).catch(reject);
        },
        fail: (err) => reject(err)
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
