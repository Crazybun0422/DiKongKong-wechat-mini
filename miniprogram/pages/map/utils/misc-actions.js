function applyCustomMapStyle(page) {
  const styleId = page.data.customMapStyleId;
  if (!styleId) {
    return;
  }
  if (typeof wx !== "undefined" && typeof wx.setMapCustomStyle === "function") {
    wx.setMapCustomStyle({ styleId });
    return;
  }
  if (page.mapCtx && typeof page.mapCtx.setCustomMapStyle === "function") {
    page.mapCtx.setCustomMapStyle({ styleId });
  }
}

function resolveUomEventSource(event = {}) {
  return `${event?.currentTarget?.dataset?.source || event?.target?.dataset?.source || ""}`.trim();
}

function isActiveUomEvent(page, event = {}) {
  const source = resolveUomEventSource(event);
  return !!source && source === page._activeUomPluginSource;
}

function onUomStatusChange(page, event = {}) {
  if (!isActiveUomEvent(page, event)) {
    return;
  }
  const detail = event?.detail || {};
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(detail, "uomStatus")) {
    updates.uomStatus = detail.uomStatus;
  }
  if (Object.prototype.hasOwnProperty.call(detail, "uomTone")) {
    updates.uomTone = detail.uomTone;
  }
  if (Object.prototype.hasOwnProperty.call(detail, "uomLoading")) {
    updates.uomLoading = !!detail.uomLoading;
  }
  if (Object.prototype.hasOwnProperty.call(detail, "uomTileWarningVisible")) {
    updates.uomTileWarningVisible = detail.uomTileWarningVisible;
  }
  if (Object.prototype.hasOwnProperty.call(detail, "uomTileWarningDismissed")) {
    updates.uomTileWarningDismissed = detail.uomTileWarningDismissed;
  }
  if (Object.keys(updates).length) {
    page.setData(updates);
  }
}

function onUomGraphicsChange(page, event = {}) {
  if (!isActiveUomEvent(page, event)) {
    return;
  }
  const detail = event?.detail || {};
  const nextPolygons = Array.isArray(detail.polygons) ? detail.polygons : [];
  const nextPolylines = Array.isArray(detail.polylines) ? detail.polylines : [];
  const hasNextGraphics = nextPolygons.length > 0 || nextPolylines.length > 0;
  const hasCurrentGraphics =
    (Array.isArray(page._uomPolygons) && page._uomPolygons.length > 0) ||
    (Array.isArray(page._uomPolylines) && page._uomPolylines.length > 0);
  if (!hasNextGraphics && hasCurrentGraphics && page.data.uomDivisionEnabled !== false) {
    return;
  }
  page._uomPolygons = nextPolygons;
  page._uomPolylines = nextPolylines;
  page.queueMapGraphicsSync({ overlay: true, polylines: true });
}

function onUomTilesChange(page, event = {}) {
  if (!isActiveUomEvent(page, event)) {
    return;
  }
  const detail = event?.detail || {};
  page._uomTileMarkers = Array.isArray(detail.markers) ? detail.markers : [];
  page.queueMapGraphicsSync({ markers: true });
}

function onMapCheckinEntryTap(page) {
  if (typeof wx.navigateTo !== "function") {
    wx.showToast({ title: "当前版本暂不支持", icon: "none" });
    return;
  }
  const app = typeof getApp === "function" ? getApp() : null;
  if (app && app.globalData && app.globalData.checkinGuide?.active) {
    app.globalData.checkinGuide = { active: true, step: "checkin" };
    if (page.data.showCheckinGuideMap) {
      page.setData({ showCheckinGuideMap: false, checkinGuideOverlayStyle: "" });
    }
  }
  wx.navigateTo({ url: "/pages/profile/checkin/index" });
  page.ensureProfileAuthenticated()
    .then(() =>
      Promise.allSettled([
        page.ensureCheckinSubscriptionOnEntry(),
        page.requestProfileSubscriptions()
      ])
    )
    .catch((err) => {
      if (err?.message === "user-cancel") return;
      console.warn("map checkin subscriptions failed", err);
    });
}

function onPanoramaDemoTap() {
  if (typeof wx.chooseMessageFile !== "function") {
    wx.showToast({ title: "当前版本不支持从聊天记录选图", icon: "none" });
    return;
  }
  wx.chooseMessageFile({
    count: 1,
    type: "image",
    success: (res) => {
      const filePath = res?.tempFiles?.[0]?.path;
      console.log("panorama file chosen", { filePath });
      if (!filePath) {
        wx.showToast({ title: "未选择图片", icon: "none" });
        return;
      }
      const fs = typeof wx.getFileSystemManager === "function" ? wx.getFileSystemManager() : null;
      const saveIfNeeded = fs && typeof fs.saveFile === "function"
        ? new Promise((resolve) => {
          fs.saveFile({
            tempFilePath: filePath,
            success: (saveRes) => {
              const saved = saveRes?.savedFilePath;
              if (saved) {
                console.log("panorama file saved", { savedFilePath: saved });
                resolve(saved);
                return;
              }
              resolve(filePath);
            },
            fail: (err) => {
              console.warn("panorama save file failed", err);
              resolve(filePath);
            }
          });
        })
        : Promise.resolve(filePath);
      const getInfo = (path) => (typeof wx.getImageInfo === "function"
        ? new Promise((resolve, reject) => {
          wx.getImageInfo({
            src: path,
            success: (info) => resolve({ path, info }),
            fail: (err) => reject(err || new Error("invalid-panorama-image"))
          });
        })
        : Promise.resolve({ path, info: null }));
      const buildPlanetSrc = (path, info) => {
        const width = Number(info?.width || 0);
        const height = Number(info?.height || 0);
        const maxSide = Math.max(width, height);
        if (!Number.isFinite(maxSide) || maxSide <= 8192 || typeof wx.compressImage !== "function") {
          return Promise.resolve(path);
        }
        const scale = 8192 / maxSide;
        const targetW = Math.max(1, Math.round(width * scale));
        const targetH = Math.max(1, Math.round(height * scale));
        return new Promise((resolve) => {
          wx.compressImage({
            src: path,
            quality: 85,
            compressedWidth: targetW,
            compressedHeight: targetH,
            success: (compressRes) => {
              const temp = compressRes?.tempFilePath || path;
              console.log("panorama compressed for planet", { temp, targetW, targetH });
              resolve(temp);
            },
            fail: (err) => {
              console.warn("panorama compress failed", err);
              resolve(path);
            }
          });
        });
      };
      saveIfNeeded
        .then((path) => getInfo(path))
        .then(({ path, info }) => buildPlanetSrc(path, info).then((planetPath) => ({
          originalPath: path,
          planetPath
        })))
        .then(({ originalPath, planetPath }) => {
          const encoded = encodeURIComponent(originalPath);
          const planetEncoded = encodeURIComponent(planetPath || originalPath);
          wx.navigateTo({
            url: `/pages/dji-360/index?src=${encoded}&planetSrc=${planetEncoded}`,
            fail: (err) => {
              console.warn("navigate to panorama failed", err);
              wx.showToast({ title: "打开失败", icon: "none" });
            }
          });
        })
        .catch((err) => {
          console.warn("panorama image invalid", err);
          wx.showToast({ title: "图片不可用", icon: "none" });
        });
    },
    fail: (err) => {
      console.warn("panorama choose file failed", err);
      wx.showToast({ title: "取消选择", icon: "none" });
    }
  });
}

module.exports = {
  applyCustomMapStyle,
  onUomStatusChange,
  onUomGraphicsChange,
  onUomTilesChange,
  onMapCheckinEntryTap,
  onPanoramaDemoTap
};
