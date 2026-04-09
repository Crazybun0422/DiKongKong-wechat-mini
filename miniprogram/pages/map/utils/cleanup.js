const { setSubscribeWaitOverlay } = require("../../../utils/subscribe-wait");

function onHide(page) {
  page.stopMyLocationDirectionTracking();
  page.pauseCenterPinLocationFollow();
  page.clearPinPreview();
  page.hideMarkerCertificationSheet(true);
  if (page._checkinEntryStyleTimer) {
    clearTimeout(page._checkinEntryStyleTimer);
    page._checkinEntryStyleTimer = null;
  }
  if (page._mapGraphicsSyncTimer) {
    clearTimeout(page._mapGraphicsSyncTimer);
    page._mapGraphicsSyncTimer = null;
  }
  if (page._weatherFetchTimer) {
    clearTimeout(page._weatherFetchTimer);
    page._weatherFetchTimer = null;
  }
  if (page._elevationFetchTimer) {
    clearTimeout(page._elevationFetchTimer);
    page._elevationFetchTimer = null;
  }
  page._pendingMapGraphicsSync = null;
}

function onUnload(page) {
  page.stopMyLocationDirectionTracking();
  page.stopCenterPinLocationFollow({ toast: false });
  page.unregisterWindowResizeListener();
  if (page._mapGraphicsSyncTimer) clearTimeout(page._mapGraphicsSyncTimer);
  page._mapGraphicsSyncTimer = null;
  page._pendingMapGraphicsSync = null;
  if (page._markersFetchTimer) clearTimeout(page._markersFetchTimer);
  if (page._pinsFetchTimer) clearTimeout(page._pinsFetchTimer);
  if (page._weatherFetchTimer) clearTimeout(page._weatherFetchTimer);
  if (page._elevationFetchTimer) clearTimeout(page._elevationFetchTimer);
  if (page._pendingCenterActionShareTimer) clearTimeout(page._pendingCenterActionShareTimer);
  if (page._centerShareLaunchLockTimer) clearTimeout(page._centerShareLaunchLockTimer);
  if (page._subscribeWaitTimer) clearTimeout(page._subscribeWaitTimer);
  setSubscribeWaitOverlay(false);
  if (page._markerDetailCloseTimer) clearTimeout(page._markerDetailCloseTimer);
  if (page._markerPageCloseTimer) clearTimeout(page._markerPageCloseTimer);
  if (page._markerDetailExpandTimer) clearTimeout(page._markerDetailExpandTimer);
  if (page._markerCertificationSheetCloseTimer) clearTimeout(page._markerCertificationSheetCloseTimer);
  if (page._restoreMarkerDetailTimer) clearTimeout(page._restoreMarkerDetailTimer);
  if (page._layerPanelCloseTimer) clearTimeout(page._layerPanelCloseTimer);
  if (page._layerPanelMeasureTimer) clearTimeout(page._layerPanelMeasureTimer);
  if (page._addMiniAppPopupCheckTimer) clearTimeout(page._addMiniAppPopupCheckTimer);
  if (page._checkinEntryStyleTimer) clearTimeout(page._checkinEntryStyleTimer);
  if (page._nativeInitialLocationBootstrapTimer) clearTimeout(page._nativeInitialLocationBootstrapTimer);
  if (page._subscriptionBannerLayoutTimer) clearTimeout(page._subscriptionBannerLayoutTimer);
  if (page._uomPluginInitTimer) clearTimeout(page._uomPluginInitTimer);
  if (page._djiLayerInitTimer) clearTimeout(page._djiLayerInitTimer);
  if (page._temporaryNoFlyLayerInitTimer) clearTimeout(page._temporaryNoFlyLayerInitTimer);
  page._activeMarkersRequest = null;
  page._activePinsRequest = null;
  page._activeWeatherRequest = null;
  page._activeElevationRequest = null;
  page._centerPinLinkElevationState = null;
  page._centerPinLinkElevationRequestKey = "";
  page._pointElevationCache = null;
  if (page._uomPlugin && typeof page._uomPlugin.destroy === "function") {
    page._uomPlugin.destroy();
  }
  if (page._djiLayer && typeof page._djiLayer.destroy === "function") {
    page._djiLayer.destroy();
  }
  if (page._temporaryNoFlyLayer && typeof page._temporaryNoFlyLayer.destroy === "function") {
    page._temporaryNoFlyLayer.destroy();
  }
}

module.exports = {
  onHide,
  onUnload
};
