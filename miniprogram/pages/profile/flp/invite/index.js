const drawQrcode = require("../../../../libs/weapp-qrcode");
const { fetchUserProfile, resolveApiBase, loadStoredProfile } = require("../../../../utils/profile");
const { appendInviteCodeToPath, appendInviteCodeToQuery } = require("../../../../utils/share");
const { buildFileDownloadUrl } = require("../../../../utils/markers");
const { requestWeappQrcode } = require("../../../../utils/weapp");

const MAP_PAGE_PATH = "/pages/map/map";
const SHARE_TITLE = "与uom、大疆100%同步且可视化，还有低空智能体~";
const APP_ID = "wx5ebbcb44d73c2f17";
const POSTER_FILE_NAME = "main-page.png";
const QR_CANVAS_ID = "invite-qrcode";
const QR_IMAGE_SIZE = 520;

const isHttpUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value);
const isFilePath = (value) =>
  typeof value === "string" && (value.startsWith("wxfile://") || value.startsWith("file://"));

Page({
  data: {
    loading: true,
    error: "",
    inviteCode: "",
    qrImagePath: "",
    shareLink: MAP_PAGE_PATH,
    shareImageUrl: "",
    shareTitle: SHARE_TITLE,
    qrImageSource: "",
    qrImageReady: false
  },

  onLoad() {
    this.apiBase = resolveApiBase();
    this.posterImageUrl = buildFileDownloadUrl(POSTER_FILE_NAME, { apiBase: this.apiBase });
    this.fileSystemManager =
      typeof wx !== "undefined" && typeof wx.getFileSystemManager === "function"
        ? wx.getFileSystemManager()
        : null;
    this.userDataPath = (typeof wx !== "undefined" && wx.env && wx.env.USER_DATA_PATH) || "";
    this.setData({ shareImageUrl: this.posterImageUrl });
    this.reloadInviteInfo();
  },

  onPullDownRefresh() {
    this.reloadInviteInfo({ fromPullDown: true });
  },

  reloadInviteInfo(options = {}) {
    const { fromPullDown = false } = options;
    if (!fromPullDown) {
      this.setData({ loading: true, error: "" });
    } else {
      this.setData({ error: "" });
    }
    fetchUserProfile({ apiBase: this.apiBase })
      .then((profile = {}) => {
        const inviteCode = this.deriveInviteCode(profile);
        if (!inviteCode) {
          throw new Error("暂未生成邀请码，请联系管理员配置");
        }
        const shareLink = this.composeSharePath(inviteCode);
        this.setData({
          inviteCode,
          shareLink,
          qrImagePath: "",
          qrImageSource: "",
          qrImageReady: false
        });
        return this.prepareQrImage(inviteCode, shareLink);
      })
      .then(() => {
        this.setData({ loading: false });
      })
      .catch((err) => {
        console.warn("Failed to load invite info", err);
        const message =
          err && err.message === "missing-token"
            ? "请先登录后再试"
            : err?.message || "加载失败，请稍后重试";
        this.setData({ error: message, loading: false });
      })
      .finally(() => {
        if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh();
        }
      });
  },

  deriveInviteCode(profile = {}) {
    const direct = this.normalizeInviteCode(profile.inviteCode);
    if (direct) return direct;
    const stored = loadStoredProfile() || {};
    return this.normalizeInviteCode(stored.inviteCode);
  },

  normalizeInviteCode(value) {
    if (value === undefined || value === null) return "";
    const text = `${value}`.trim();
    return text;
  },

  composeSharePath(inviteCode) {
    const code = this.normalizeInviteCode(inviteCode);
    return appendInviteCodeToPath(MAP_PAGE_PATH, { inviteCode: code });
  },

  composeQueryString(inviteCode) {
    const code = this.normalizeInviteCode(inviteCode);
    return appendInviteCodeToQuery("", { inviteCode: code });
  },

  prepareQrImage(inviteCode, shareLink) {
    if (inviteCode) {
      return this.requestOfficialQrCode(inviteCode)
        .catch((err) => {
          console.warn("requestOfficialQrCode failed, fallback to canvas", err);
          return this.generateQrCode(shareLink);
        })
        .then(() => {});
    }
    return this.generateQrCode(shareLink);
  },

  requestOfficialQrCode(inviteCode) {
    if (!inviteCode) {
      return Promise.reject(new Error("missing-invite-code"));
    }
    const payload = {
      path: MAP_PAGE_PATH,
      inviteCode,
      width: QR_IMAGE_SIZE
    };
    return requestWeappQrcode(payload, { apiBase: this.apiBase })
      .then((result) => this.applyQrCodeResult(result))
      .catch((err) => {
        throw err;
      });
  },

  applyQrCodeResult(result) {
    const normalized = this.normalizeQrCodeResult(result);
    if (!normalized) {
      return Promise.reject(new Error("empty-qrcode"));
    }
    if (normalized.type === "url") {
      this.setData({
        qrImagePath: normalized.value,
        qrImageSource: "remote",
        qrImageReady: true
      });
      return normalized.value;
    }
    if (normalized.type === "file") {
      this.setData({
        qrImagePath: normalized.value,
        qrImageSource: "file",
        qrImageReady: true
      });
      return normalized.value;
    }
    if (normalized.type === "base64") {
      return this.persistBase64Image(normalized.value).then((filePath) => {
        this.setData({
          qrImagePath: filePath,
          qrImageSource: "file",
          qrImageReady: true
        });
        return filePath;
      });
    }
    return Promise.reject(new Error("unsupported-qrcode-result"));
  },

  normalizeQrCodeResult(result) {
    if (!result && result !== 0) {
      return null;
    }
    if (typeof result === "string") {
      const trimmed = result.trim();
      if (!trimmed) return null;
      if (isHttpUrl(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("wxfile://")) {
        if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
          return {
            type: "url",
            value: buildFileDownloadUrl(trimmed, { apiBase: this.apiBase })
          };
        }
        return { type: "url", value: trimmed };
      }
      return {
        type: "url",
        value: buildFileDownloadUrl(trimmed, { apiBase: this.apiBase })
      };
    }
    if (Array.isArray(result)) {
      for (const item of result) {
        const normalized = this.normalizeQrCodeResult(item);
        if (normalized) return normalized;
      }
      return null;
    }
    if (typeof result === "object") {
      const directUrl = result.url || result.imageUrl || result.qrCodeUrl || result.qrcodeUrl;
      if (directUrl) {
        const resolved = isHttpUrl(directUrl)
          ? directUrl
          : buildFileDownloadUrl(directUrl, { apiBase: this.apiBase });
        return { type: "url", value: resolved };
      }
      const fileName = result.fileName || result.filename || result.objectName || result.path;
      if (fileName) {
        return {
          type: "url",
          value: buildFileDownloadUrl(fileName, { apiBase: this.apiBase })
        };
      }
      if (typeof result.tempFilePath === "string" && result.tempFilePath.trim()) {
        return { type: "file", value: result.tempFilePath.trim() };
      }
      const base64 = result.base64 || result.imageBase64 || result.qrcodeBase64;
      if (typeof base64 === "string" && base64.trim()) {
        return { type: "base64", value: base64.trim() };
      }
    }
    return null;
  },

  persistBase64Image(base64Data) {
    return new Promise((resolve, reject) => {
      if (!base64Data) {
        reject(new Error("missing-base64"));
        return;
      }
      const fs = this.fileSystemManager;
      const userPath = this.userDataPath || (wx.env && wx.env.USER_DATA_PATH) || "";
      if (!fs || !userPath) {
        reject(new Error("fs-unavailable"));
        return;
      }
      const filePath = `${userPath}/invite-qrcode-${Date.now()}.png`;
      const arrayBuffer =
        typeof wx !== "undefined" && typeof wx.base64ToArrayBuffer === "function"
          ? wx.base64ToArrayBuffer(base64Data)
          : this.base64ToArrayBuffer(base64Data);
      if (!arrayBuffer) {
        reject(new Error("invalid-base64"));
        return;
      }
      fs.writeFile({
        filePath,
        data: arrayBuffer,
        encoding: "binary",
        success: () => resolve(filePath),
        fail: reject
      });
    });
  },

  base64ToArrayBuffer(data) {
    try {
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
      let str = data.replace(/[^A-Za-z0-9+/=]/g, "");
      let bufferLength = (str.length * 3) / 4;
      if (str.charAt(str.length - 1) === "=") bufferLength -= 1;
      if (str.charAt(str.length - 2) === "=") bufferLength -= 1;
      const arraybuffer = new ArrayBuffer(bufferLength);
      const bytes = new Uint8Array(arraybuffer);
      let p = 0;
      for (let i = 0; i < str.length; i += 4) {
        const encoded1 = chars.indexOf(str.charAt(i));
        const encoded2 = chars.indexOf(str.charAt(i + 1));
        const encoded3 = chars.indexOf(str.charAt(i + 2));
        const encoded4 = chars.indexOf(str.charAt(i + 3));
        bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
        if (encoded3 !== 64) {
          bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
        }
        if (encoded4 !== 64) {
          bytes[p++] = ((encoded3 & 3) << 6) | encoded4;
        }
      }
      return arraybuffer;
    } catch (err) {
      console.warn("base64ToArrayBuffer failed", err);
      return null;
    }
  },

  generateQrCode(content) {
    const text = content || MAP_PAGE_PATH;
    return new Promise((resolve, reject) => {
      drawQrcode({
        width: QR_IMAGE_SIZE,
        height: QR_IMAGE_SIZE,
        canvasId: QR_CANVAS_ID,
        text,
        _this: this,
        callback: () => {
          wx.canvasToTempFilePath(
            {
              canvasId: QR_CANVAS_ID,
              width: QR_IMAGE_SIZE,
              height: QR_IMAGE_SIZE,
              destWidth: QR_IMAGE_SIZE,
              destHeight: QR_IMAGE_SIZE,
              success: (res) => {
                this.setData({
                  qrImagePath: res.tempFilePath,
                  qrImageSource: "canvas",
                  qrImageReady: true
                });
                resolve(res.tempFilePath);
              },
              fail: (error) => {
                console.warn("Failed to export QR image", error);
                this.setData({ error: "二维码生成失败，请重试", qrImageReady: false });
                reject(error);
              }
            },
            this
          );
        }
      });
    });
  },

  ensureQrImageFileReady() {
    if (this.data.qrImageSource === "canvas" && this.data.qrImagePath) {
      return Promise.resolve(this.data.qrImagePath);
    }
    const existing = this.data.qrImagePath;
    if (isFilePath(existing)) {
      return Promise.resolve(existing);
    }
    if (isHttpUrl(existing)) {
      return new Promise((resolve, reject) => {
        wx.downloadFile({
          url: existing,
          success: (res) => {
            if (res.tempFilePath) {
              this.setData({
                qrImagePath: res.tempFilePath,
                qrImageSource: "file"
              });
              resolve(res.tempFilePath);
            } else {
              reject(new Error("download-empty"));
            }
          },
          fail: reject
        });
      });
    }
    if (existing) {
      return Promise.resolve(existing);
    }
    return this.generateQrCode(this.data.shareLink || MAP_PAGE_PATH).then(() => this.data.qrImagePath);
  },

  onRetryTap() {
    this.reloadInviteInfo();
  },

  onSaveImageTap() {
    wx.showLoading({ title: "保存中...", mask: true });
    this.ensureQrImageFileReady()
      .then((filePath) => {
        wx.saveImageToPhotosAlbum({
          filePath,
          success: () => {
            wx.hideLoading();
            wx.showToast({ title: "已保存", icon: "success" });
          },
          fail: (err) => {
            wx.hideLoading();
            this.handleSaveImageError(err);
          }
        });
      })
      .catch((err) => {
        wx.hideLoading();
        console.warn("ensureQrImageFileReady failed", err);
        wx.showToast({ title: "保存失败，请稍后重试", icon: "none" });
      });
  },

  handleSaveImageError(err) {
    if (err && typeof err.errMsg === "string" && err.errMsg.includes("auth deny")) {
      wx.showModal({
        title: "需要授权",
        content: "请在设置中允许保存到相册",
        confirmText: "去设置",
        success: (res) => {
          if (res.confirm && typeof wx.openSetting === "function") {
            wx.openSetting({});
          }
        }
      });
      return;
    }
    wx.showToast({ title: "保存失败", icon: "none" });
  },

  onCopyLinkTap() {
    const inviteCode = this.normalizeInviteCode(this.data.inviteCode);
    if (!inviteCode) {
      wx.showToast({ title: "暂无邀请码可复制", icon: "none" });
      return;
    }
    const path = this.composeSharePath(inviteCode);
    const payload = `appid:${APP_ID}\npath:${path}`;
    wx.setClipboardData({
      data: payload,
      success: () => {
        wx.showToast({ title: "小程序路径已复制", icon: "success", duration: 2000 });
      },
      fail: () => wx.showToast({ title: "复制失败", icon: "none" })
    });
  },

  onShareAppMessage() {
    return {
      title: SHARE_TITLE,
      path: appendInviteCodeToPath(this.data.shareLink || MAP_PAGE_PATH, {
        inviteCode: this.normalizeInviteCode(this.data.inviteCode)
      }),
      imageUrl: this.posterImageUrl || this.data.shareImageUrl || ""
    };
  },

  onShareTimeline() {
    return {
      title: SHARE_TITLE,
      query: this.composeQueryString(this.data.inviteCode)
    };
  }
});
