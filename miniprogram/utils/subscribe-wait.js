function setSubscribeWaitOverlay(show) {
  const visible = !!show;
  try {
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) {
      app.globalData.showSubscribeWaitOverlay = visible;
    }
  } catch (err) {
    // ignore
  }
  try {
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    pages.forEach((page) => {
      if (page && typeof page.setData === "function" && page.data && Object.prototype.hasOwnProperty.call(page.data, "showSubscribeWaitOverlay")) {
        page.setData({ showSubscribeWaitOverlay: visible });
      }
    });
  } catch (err) {
    // ignore
  }
}

module.exports = {
  setSubscribeWaitOverlay
};
