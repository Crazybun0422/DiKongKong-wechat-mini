const DEFAULT_VIDEO_MODAL_TITLE = "即将打开视频";

const hasWx = typeof wx !== "undefined" && wx !== null;
const isFunction = (value) => typeof value === "function";

const safeCall = (fn, ...args) => {
  if (isFunction(fn)) {
    return fn(...args);
  }
  return undefined;
};

const safeTrim = (value) => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === undefined || value === null) {
    return "";
  }
  return `${value}`.trim();
};

const showToast = (options = {}) => {
  if (!hasWx) return;
  const toast = wx.showToast || wx.showToastSync;
  if (isFunction(toast)) {
    toast({ icon: "none", duration: 2000, ...options });
  }
};

const hideLoading = () => {
  if (!hasWx) return;
  safeCall(wx.hideLoading);
};

const describeVideoTarget = ({ finderUserName, activityId, url }) => {
  if (finderUserName && activityId) {
    return `将打开视频号 ${finderUserName} 的活动 ${activityId}`;
  }
  if (finderUserName) {
    return `将打开视频号 ${finderUserName} 的主页`;
  }
  if (activityId) {
    return `将打开视频活动 ${activityId}`;
  }
  if (url) {
    return `将打开链接：${url}`;
  }
  return "暂无可跳转的视频内容";
};

const openVideoTarget = ({ finderUserName, activityId, url }) => {
  if (!hasWx) {
    showToast({ title: "视频不可用" });
    return;
  }
  if (finderUserName && activityId && isFunction(wx.openChannelsActivity)) {
    wx.openChannelsActivity({ finderUserName, feedId: activityId });
    return;
  }
  if (finderUserName && isFunction(wx.openChannelsUserProfile)) {
    wx.openChannelsUserProfile({ finderUserName });
    return;
  }
  if (activityId && isFunction(wx.openChannelsActivity)) {
    wx.openChannelsActivity({ activityId });
    return;
  }
  if (url && /^https?:\/\//.test(url)) {
    if (/^https?:\/\/mp\.weixin\.qq\.com\//.test(url) && isFunction(wx.navigateTo)) {
      wx.navigateTo({ url: `/pages/webview/index?url=${encodeURIComponent(url)}` });
      return;
    }
    if (isFunction(wx.setClipboardData)) {
      wx.setClipboardData({
        data: url,
        success: () => {
          showToast({ title: "链接已复制" });
        },
        fail: () => {
          showToast({ title: "复制失败" });
        }
      });
      return;
    }
    showToast({ title: "请复制链接访问" });
    return;
  }
  showToast({ title: "视频不可用" });
};

const handleVideoTap = (dataset = {}) => {
  const finderUserName = safeTrim(dataset.finder);
  const activityId = safeTrim(dataset.activity);
  const url = safeTrim(dataset.url);

  const description = describeVideoTarget({ finderUserName, activityId, url });

  if (description === "暂无可跳转的视频内容") {
    showToast({ title: description });
    return;
  }

  if (hasWx && isFunction(wx.showModal)) {
    wx.showModal({
      title: DEFAULT_VIDEO_MODAL_TITLE,
      content: description,
      confirmText: "前往",
      cancelText: "取消",
      success: (res) => {
        if (res?.confirm) {
          openVideoTarget({ finderUserName, activityId, url });
        }
      }
    });
    return;
  }

  openVideoTarget({ finderUserName, activityId, url });
};

const handleAttachmentTap = (dataset = {}) => {
  const url = safeTrim(dataset.url);
  if (!url) {
    showToast({ title: "附件不可用" });
    return;
  }
  if (!hasWx || !isFunction(wx.downloadFile)) {
    showToast({ title: "下载失败" });
    return;
  }
  safeCall(wx.showLoading, { title: "下载中...", mask: true });
  wx.downloadFile({
    url,
    success: (res) => {
      const statusCode = Number(res?.statusCode);
      const filePath = res?.tempFilePath;
      if (statusCode === 200 && filePath) {
        if (isFunction(wx.openDocument)) {
          wx.openDocument({
            filePath,
            showMenu: true,
            success: () => hideLoading(),
            fail: () => {
              hideLoading();
              showToast({ title: "打开失败" });
            }
          });
          return;
        }
        hideLoading();
        showToast({ title: "已下载", icon: "success" });
        return;
      }
      hideLoading();
      showToast({ title: "下载失败" });
    },
    fail: () => {
      hideLoading();
      showToast({ title: "下载失败" });
    }
  });
};

const makePhoneCall = (phone) => {
  const value = safeTrim(phone);
  if (!value) {
    showToast({ title: "暂无联系电话" });
    return;
  }
  if (!hasWx) {
    showToast({ title: value });
    return;
  }
  if (isFunction(wx.makePhoneCall)) {
    wx.makePhoneCall({ phoneNumber: value });
    return;
  }
  if (isFunction(wx.setClipboardData)) {
    wx.setClipboardData({
      data: value,
      success: () => {
        showToast({ title: "号码已复制" });
      }
    });
    return;
  }
  showToast({ title: value });
};

module.exports = {
  handleAttachmentTap,
  handleVideoTap,
  makePhoneCall
};
