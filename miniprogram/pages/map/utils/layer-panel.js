const {
  prepareProvinceCityHighlightResource,
  buildProvinceCityHighlightPolygons,
  buildProvinceNodeId
} = require("../../../utils/province-city-highlight");
const {
  fetchMapLayerSettings,
  updateMapLayerSettings
} = require("../../../utils/map-layer-settings");

const MAP_USE_PLANET_MY_LOCATION_STORAGE_KEY = "map.usePlanetMyLocationPoint";
const MAP_LAYER_EXTRA_CONFIG_DISABLE_CENTER_TARGET_LINK_KEY = "disableCenterTargetLinkDistance";
const MAP_LAYER_EXTRA_CONFIG_ENABLE_PROVINCE_CITY_HIGHLIGHT_KEY = "enableProvinceCityHighlight";
const MAP_LAYER_EXTRA_CONFIG_PROVINCE_CITY_HIGHLIGHT_SELECTION_KEY = "provinceCityHighlightSelection";
const MAP_LAYER_EXTRA_CONFIG_BASE_LAYER_TYPE_KEY = "baseLayerType";
const MAP_LAYER_BASE_TYPE_TIANDITU = "tiandituSatellite";

const resolveEventDataset = (event = {}) => {
  const currentTargetDataset = event?.currentTarget?.dataset;
  if (
    currentTargetDataset &&
    typeof currentTargetDataset === "object" &&
    Object.keys(currentTargetDataset).length
  ) {
    return currentTargetDataset;
  }
  const detailDataset = event?.detail?.dataset;
  if (
    detailDataset &&
    typeof detailDataset === "object" &&
    Object.keys(detailDataset).length
  ) {
    return detailDataset;
  }
  return {};
};

function onLayerButtonTap(page) {
  if (typeof page.syncUserMembershipState === "function") {
    page.syncUserMembershipState();
  }
  if (page._layerPanelCloseTimer) {
    clearTimeout(page._layerPanelCloseTimer);
    page._layerPanelCloseTimer = null;
  }
  page.setData({ layerPanelVisible: true, layerPanelClosing: false }, () => {
    scheduleLayerPanelLayoutMeasure(page, 32);
  });
  page.loadMapLayerSettings(false);
}

function onLayerPanelMaskTap(page) {
  closeLayerPanel(page);
}

function onLayerPanelClose(page) {
  closeLayerPanel(page);
}

function closeLayerPanel(page) {
  if (!page.data.layerPanelVisible) {
    return;
  }
  if (page._layerPanelCloseTimer) {
    clearTimeout(page._layerPanelCloseTimer);
    page._layerPanelCloseTimer = null;
  }
  page.setData({ layerPanelClosing: true });
  page._layerPanelCloseTimer = setTimeout(() => {
    page.setData({ layerPanelVisible: false, layerPanelClosing: false, layerPanelBodyHeightPx: 0 });
    page._layerPanelCloseTimer = null;
  }, 220);
}

function onMapLayerSelect(page, event = {}) {
  const type = resolveEventDataset(event).type || "";
  const nextType = type === "satellite" || type === "tianditu" ? type : "standard";
  if ((nextType === "satellite" || nextType === "tianditu") && !page.data.userVip) {
    if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
      wx.showToast({ title: "请先开通会员", icon: "none" });
    }
    return;
  }
  const enableSatellite = nextType === "satellite" || nextType === "tianditu";
  page.setData({
    mapLayerType: nextType,
    enableSatellite
  }, () => {
    page.setTiandituSatelliteLayerEnabled(nextType === "tianditu", { force: true });
    page.refreshMyLocationGraphics(page.data.myLocationPoint || page._lastKnownLocation || null);
    page.persistMapLayerSettings();
  });
}

function onAirBoardSwitchChange(page, event = {}) {
  const enabled = !!event?.detail?.value;
  page.setData(
    { airBoardEnabled: enabled, showDashboardPanel: enabled },
    () => {
      page.applyAirBoardToggle(enabled);
      page.persistMapLayerSettings();
    }
  );
}

function onUsePlanetCenterPointSwitchChange(page, event = {}) {
  const enabled = !!event?.detail?.value;
  page.setData({ usePlanetCenterPoint: enabled }, () => {
    page.cacheUsePlanetMyLocationPreference(enabled);
    const finish = () => {
      page.refreshMyLocationGraphics(page.data.myLocationPoint || page._lastKnownLocation || null);
      page.persistMapLayerSettings();
    };
    if (enabled) {
      page.syncMyLocationPoint({ silent: true }).finally(finish);
      return;
    }
    finish();
  });
}

function onCenterTargetLinkSwitchChange(page, event = {}) {
  const enabled = !!event?.detail?.value;
  page.setData({ centerTargetLinkEnabled: enabled }, () => {
    page.updateCenterPinIndicator();
    page.persistMapLayerSettings();
  });
}

function buildProvinceCityTreeViewData(page, treeNodes = null) {
  const source = Array.isArray(treeNodes) ? treeNodes : page._provinceCityHighlightTree;
  const selectedId = `${page._provinceCityHighlightSelectedId || ""}`;
  const expandedMap = page._provinceCityHighlightExpandedMap || {};
  return (Array.isArray(source) ? source : []).map((province) => {
    const children = Array.isArray(province?.children) ? province.children : [];
    const expanded =
      children.some((child) => `${child?.id || ""}` === selectedId) ||
      expandedMap[province.id] === true;
    const renderChildren = expanded
      ? children.map((child) =>
        Object.assign({}, child, {
          selected: `${child?.id || ""}` === selectedId
        })
      )
      : [];
    return Object.assign({}, province, {
      hasChildren: children.length > 0,
      expanded: children.length > 0 ? expanded : false,
      selected: `${province?.id || ""}` === selectedId,
      children: renderChildren
    });
  });
}

function updateProvinceCityTreeData(page, extra = {}) {
  page.setData(
    Object.assign(
      {
        provinceCityTree: buildProvinceCityTreeViewData(page),
        provinceCityHighlightSelectedId: `${page._provinceCityHighlightSelectedId || ""}`
      },
      extra || {}
    ),
    () => {
      if (page.data.layerPanelVisible) {
        scheduleLayerPanelLayoutMeasure(page, 0);
      }
    }
  );
}

function scheduleLayerPanelLayoutMeasure(page, delay = 0) {
  if (page._layerPanelMeasureTimer) {
    clearTimeout(page._layerPanelMeasureTimer);
  }
  page._layerPanelMeasureTimer = setTimeout(() => {
    page._layerPanelMeasureTimer = null;
    measureLayerPanelLayout(page);
  }, Math.max(0, Number(delay) || 0));
}

function measureLayerPanelLayout(page) {
  if (!page.data.layerPanelVisible) return;
  const bodyMaxHeightPx = Number(page.data.layerPanelBodyMaxHeightPx);
  const panelMaxHeightPx = Number(page.data.layerPanelMaxHeightPx);
  if (!Number.isFinite(bodyMaxHeightPx) || bodyMaxHeightPx <= 0 || !Number.isFinite(panelMaxHeightPx)) {
    return;
  }
  const pxPerRpx = page._pxPerRpx || 0.5;
  const bodyBottomPaddingPx = Math.round(36 * pxPerRpx);
  const panel = page.selectComponent("#map-layer-panel");
  if (!panel || typeof panel.measureContentHeight !== "function") {
    return;
  }
  Promise.resolve(panel.measureContentHeight())
    .then((contentHeight) => {
      const numericHeight = Number(contentHeight);
      if (!Number.isFinite(numericHeight) || numericHeight <= 0) {
        return;
      }
      const nextBodyHeightPx = Math.max(
        120,
        Math.min(bodyMaxHeightPx, Math.ceil(numericHeight + bodyBottomPaddingPx))
      );
      if (page.data.layerPanelBodyHeightPx !== nextBodyHeightPx) {
        page.setData({
          layerPanelBodyHeightPx: nextBodyHeightPx,
          layerPanelMaxHeightPx: panelMaxHeightPx
        });
      }
    })
    .catch((err) => {
      console.warn("measure layer panel layout failed", err);
    });
}

function findProvinceCityTreeNodeById(page, nodeId, treeNodes = null) {
  const targetId = `${nodeId || ""}`.trim();
  if (!targetId) return null;
  const source = Array.isArray(treeNodes) ? treeNodes : page._provinceCityHighlightTree;
  for (let i = 0; i < source.length; i += 1) {
    const province = source[i];
    if (`${province?.id || ""}` === targetId) {
      return province;
    }
    const children = Array.isArray(province?.children) ? province.children : [];
    for (let j = 0; j < children.length; j += 1) {
      if (`${children[j]?.id || ""}` === targetId) {
        return children[j];
      }
    }
  }
  return null;
}

function setProvinceCityHighlightPolygons(page, polygons = []) {
  page._provinceCityHighlightPolygons = Array.isArray(polygons) ? polygons.slice() : [];
  page.updateOverlayGraphics();
}

function loadProvinceCityHighlightResource(page, options = {}) {
  const apiBase = page.getApiBase();
  const token = page.getAuthToken();
  if (!apiBase || !token) {
    updateProvinceCityTreeData(page, {
      provinceCityHighlightLoading: false,
      provinceCityHighlightError: "省市图层暂不可用"
    });
    return Promise.resolve(false);
  }
  const loadToken = page._provinceCityHighlightLoadToken + 1;
  page._provinceCityHighlightLoadToken = loadToken;
  updateProvinceCityTreeData(page, {
    provinceCityHighlightLoading: true,
    provinceCityHighlightError: ""
  });
  return prepareProvinceCityHighlightResource({
    apiBase,
    token
  })
    .then((resource) => {
      if (page._provinceCityHighlightLoadToken !== loadToken) {
        return false;
      }
      page._provinceCityHighlightResource = resource || null;
      page._provinceCityHighlightTree = Array.isArray(resource?.tree) ? resource.tree : [];
      page._provinceCityHighlightPolygonCache = new Map();
      updateProvinceCityTreeData(page, {
        provinceCityHighlightLoading: false,
        provinceCityHighlightError: ""
      });
      const selectedNode = findProvinceCityTreeNodeById(page, page._provinceCityHighlightSelectedId);
      if (selectedNode) {
        return applyProvinceCityHighlightSelection(page, selectedNode.id, {
          showErrorToast: false,
          persist: false
        });
      }
      setProvinceCityHighlightPolygons(page, []);
      return true;
    })
    .catch((err) => {
      if (page._provinceCityHighlightLoadToken !== loadToken) {
        return false;
      }
      console.warn("load province city highlight resource failed", err);
      updateProvinceCityTreeData(page, {
        provinceCityHighlightLoading: false,
        provinceCityHighlightError: "省市图层加载失败"
      });
      if (options.showErrorToast) {
        wx.showToast({ title: "省市图层加载失败", icon: "none" });
      }
      return false;
    });
}

function syncProvinceCityHighlightLayer(page, enabled, options = {}) {
  if (enabled !== true) {
    page._provinceCityHighlightLoadToken += 1;
    setProvinceCityHighlightPolygons(page, []);
    updateProvinceCityTreeData(page, {
      provinceCityHighlightLoading: false,
      provinceCityHighlightError: ""
    });
    return Promise.resolve(false);
  }
  return loadProvinceCityHighlightResource(page, options);
}

function applyProvinceCityHighlightSelection(page, nodeId, options = {}) {
  const node = findProvinceCityTreeNodeById(page, nodeId);
  if (!node) {
    return Promise.resolve(false);
  }
  if (!node.filePath) {
    if (node.type === "province") {
      const provinceId = `${node.id || ""}`;
      page._provinceCityHighlightExpandedMap[provinceId] =
        page._provinceCityHighlightExpandedMap[provinceId] !== true;
      updateProvinceCityTreeData(page);
    }
    return Promise.resolve(false);
  }
  if (node.type === "city" && node.provinceName) {
    page._provinceCityHighlightExpandedMap[buildProvinceNodeId(node.provinceName)] = true;
  }
  page._provinceCityHighlightSelectedId = `${node.id || ""}`;
  updateProvinceCityTreeData(page);
  if (options.persist !== false) {
    page.persistMapLayerSettings();
  }
  const cacheKey = `${node.id || ""}`;
  let polygonPromise = options.force === true ? null : page._provinceCityHighlightPolygonCache.get(cacheKey);
  if (!polygonPromise) {
    polygonPromise = buildProvinceCityHighlightPolygons(node.filePath);
    page._provinceCityHighlightPolygonCache.set(cacheKey, polygonPromise);
  }
  return Promise.resolve(polygonPromise)
    .then((polygons) => {
      if (
        page.data.provinceCityHighlightEnabled !== true ||
        `${page._provinceCityHighlightSelectedId || ""}` !== cacheKey
      ) {
        return false;
      }
      setProvinceCityHighlightPolygons(page, polygons);
      return true;
    })
    .catch((err) => {
      console.warn("apply province city highlight selection failed", err);
      if (`${page._provinceCityHighlightSelectedId || ""}` === cacheKey) {
        setProvinceCityHighlightPolygons(page, []);
      }
      if (options.showErrorToast) {
        wx.showToast({ title: "区域高亮加载失败", icon: "none" });
      }
      return false;
    });
}

function onProvinceCityHighlightSwitchChange(page, event = {}) {
  const enabled = !!event?.detail?.value;
  page.setData({ provinceCityHighlightEnabled: enabled }, () => {
    page.persistMapLayerSettings();
    syncProvinceCityHighlightLayer(page, enabled, { showErrorToast: true });
  });
}

function onProvinceCityTreeExpandTap(page, event = {}) {
  const id = `${resolveEventDataset(event).id || ""}`.trim();
  if (!id) return;
  page._provinceCityHighlightExpandedMap[id] = page._provinceCityHighlightExpandedMap[id] !== true;
  updateProvinceCityTreeData(page);
}

function onProvinceCityTreeSelectTap(page, event = {}) {
  const id = `${resolveEventDataset(event).id || ""}`.trim();
  if (!id || page.data.provinceCityHighlightEnabled !== true) return;
  applyProvinceCityHighlightSelection(page, id, { showErrorToast: true });
}

function onMapElementToggle(page, event = {}) {
  const id = resolveEventDataset(event).id;
  if (!id) return;
  const flagMap = {
    uom: "uomDivisionEnabled",
    dji: "djiNoFlyZoneEnabled",
    tempNoFly: "temporaryNoFlyZoneEnabled",
    service: "merchantMarkersEnabled",
    private: "privateMarkersEnabled",
    group: "groupSharingEnabled",
    platform: "platformCoConstructionEnabled"
  };
  const flagKey = flagMap[id];
  if (!flagKey) return;
  const nextValue = !page.data[flagKey];
  const pinToggle =
    flagKey === "privateMarkersEnabled" ||
    flagKey === "groupSharingEnabled" ||
    flagKey === "platformCoConstructionEnabled";
  const updates = { [flagKey]: nextValue };
  updates.mapElementOptions = page.composeMapElementOptions({
    uomDivisionEnabled: flagKey === "uomDivisionEnabled" ? nextValue : page.data.uomDivisionEnabled,
    djiNoFlyZoneEnabled: flagKey === "djiNoFlyZoneEnabled" ? nextValue : page.data.djiNoFlyZoneEnabled,
    temporaryNoFlyZoneEnabled:
      flagKey === "temporaryNoFlyZoneEnabled" ? nextValue : page.data.temporaryNoFlyZoneEnabled,
    merchantMarkersEnabled:
      flagKey === "merchantMarkersEnabled" ? nextValue : page.data.merchantMarkersEnabled,
    privateMarkersEnabled: flagKey === "privateMarkersEnabled" ? nextValue : page.data.privateMarkersEnabled,
    groupSharingEnabled: flagKey === "groupSharingEnabled" ? nextValue : page.data.groupSharingEnabled,
    platformCoConstructionEnabled:
      flagKey === "platformCoConstructionEnabled" ? nextValue : page.data.platformCoConstructionEnabled
  });
  page.setData(updates, () => {
    if (flagKey === "uomDivisionEnabled") {
      if (page._uomPlugin && typeof page._uomPlugin.setEnabled === "function") {
        page._uomPlugin.setEnabled(nextValue);
      }
    }
    if (flagKey === "djiNoFlyZoneEnabled") {
      page.applyNoFlyOverlayToggle({
        djiEnabled: nextValue,
        temporaryEnabled: page.data.temporaryNoFlyZoneEnabled
      });
    }
    if (flagKey === "temporaryNoFlyZoneEnabled") {
      page.applyNoFlyOverlayToggle({
        djiEnabled: page.data.djiNoFlyZoneEnabled,
        temporaryEnabled: nextValue
      });
    }
    if (flagKey === "merchantMarkersEnabled") {
      page.applyMerchantMarkersToggle(nextValue);
    }
    if (pinToggle) {
      page.applyPinLayerToggle(nextValue);
    }
    page.persistMapLayerSettings();
  });
}

function applyNoFlyOverlayToggle(page, options = {}) {
  const djiEnabled = options.djiEnabled !== false;
  const temporaryEnabled = options.temporaryEnabled !== false;
  if (!djiEnabled) {
    page._djiPolygons = [];
    page._djiCircles = [];
    page.setData({
      djiStatus: "已禁用",
      djiStatusExtra: "",
      djiTone: "warn",
      djiColor: ""
    });
  } else {
    page.setData({
      djiStatus: "评估中",
      djiStatusExtra: "",
      djiTone: "neutral",
      djiColor: ""
    });
  }
  page.setDjiLayerEnabled(djiEnabled, { force: djiEnabled });
  if (!temporaryEnabled) {
    page._nfzPolygons = [];
    page._nfzCircles = [];
    page.setData({
      temporaryNoFlyZoneInfo: null,
      temporaryNoFlyText: "已禁用",
      temporaryNoFlyTone: "warn"
    });
  } else {
    page.setData({
      temporaryNoFlyZoneInfo: null,
      temporaryNoFlyText: "评估中",
      temporaryNoFlyTone: "neutral"
    });
  }
  page.setTemporaryNoFlyLayerEnabled(temporaryEnabled, { force: temporaryEnabled });
  page.updateOverlayGraphics();
}

function applyMerchantMarkersToggle(page, enabled) {
  if (enabled === false) {
    page._nearbyMarkersRaw = [];
    page._nearbyMarkers = [];
    page._lastNearbyFetch = null;
    page.syncAllMarkers();
    return;
  }
  page.syncAllMarkers();
  page.scheduleFetchMarkers(0, { force: true });
}

function applyPinLayerToggle(page, forceFetch = false) {
  page.rebuildNearbyPinGraphics();
  if (!page.isPinLayerEnabled()) {
    if (page._pinsFetchTimer) {
      clearTimeout(page._pinsFetchTimer);
      page._pinsFetchTimer = null;
    }
    page._lastNearbyPinFetch = null;
    return;
  }
  if (forceFetch && page.isPinLayerEnabled()) {
    page.scheduleFetchPins(0, { force: true });
  }
}

function parseMapLayerExtraBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
      return false;
    }
  }
  return fallback;
}

function resolveCenterTargetLinkEnabled(page, settings = {}) {
  const extraConfig = settings && typeof settings.extraConfig === "object" ? settings.extraConfig : null;
  const raw = extraConfig ? extraConfig[MAP_LAYER_EXTRA_CONFIG_DISABLE_CENTER_TARGET_LINK_KEY] : undefined;
  if (raw === undefined || raw === null) {
    return true;
  }
  const disabled = parseMapLayerExtraBoolean(raw, false);
  return disabled !== true;
}

function resolveProvinceCityHighlightEnabled(page, settings = {}) {
  const extraConfig = settings && typeof settings.extraConfig === "object" ? settings.extraConfig : null;
  const raw = extraConfig ? extraConfig[MAP_LAYER_EXTRA_CONFIG_ENABLE_PROVINCE_CITY_HIGHLIGHT_KEY] : undefined;
  if (raw === undefined || raw === null) {
    return false;
  }
  return parseMapLayerExtraBoolean(raw, false) === true;
}

function resolveProvinceCityHighlightSelectionId(page, settings = {}) {
  const extraConfig = settings && typeof settings.extraConfig === "object" ? settings.extraConfig : null;
  const raw = extraConfig ? extraConfig[MAP_LAYER_EXTRA_CONFIG_PROVINCE_CITY_HIGHLIGHT_SELECTION_KEY] : undefined;
  if (typeof raw !== "string") {
    return "";
  }
  return raw.trim();
}

function resolveMapBaseLayerType(page, settings = {}) {
  const extraConfig = settings && typeof settings.extraConfig === "object" ? settings.extraConfig : null;
  const raw = extraConfig ? extraConfig[MAP_LAYER_EXTRA_CONFIG_BASE_LAYER_TYPE_KEY] : undefined;
  if (`${raw || ""}` === MAP_LAYER_BASE_TYPE_TIANDITU) {
    return "tianditu";
  }
  return settings.mapType === "SATELLITE" ? "satellite" : "standard";
}

function buildMapLayerExtraConfigPayload(page) {
  const existing =
    page._mapLayerSettings && typeof page._mapLayerSettings.extraConfig === "object"
      ? page._mapLayerSettings.extraConfig
      : null;
  const extraConfig = existing ? Object.assign({}, existing) : {};
  extraConfig[MAP_LAYER_EXTRA_CONFIG_DISABLE_CENTER_TARGET_LINK_KEY] =
    page.data.centerTargetLinkEnabled === false ? "true" : "false";
  extraConfig[MAP_LAYER_EXTRA_CONFIG_ENABLE_PROVINCE_CITY_HIGHLIGHT_KEY] =
    page.data.provinceCityHighlightEnabled === true ? "true" : "false";
  const selectedId =
    `${page._provinceCityHighlightSelectedId || page.data.provinceCityHighlightSelectedId || ""}`.trim();
  extraConfig[MAP_LAYER_EXTRA_CONFIG_PROVINCE_CITY_HIGHLIGHT_SELECTION_KEY] = selectedId || null;
  extraConfig[MAP_LAYER_EXTRA_CONFIG_BASE_LAYER_TYPE_KEY] =
    page.data.mapLayerType === "tianditu" ? MAP_LAYER_BASE_TYPE_TIANDITU : null;
  return extraConfig;
}

function buildMapLayerSettingsPayload(page) {
  return {
    mapType: page.data.mapLayerType === "satellite" || page.data.mapLayerType === "tianditu" ? "SATELLITE" : "STANDARD",
    airspaceBoardEnabled: !!page.data.airBoardEnabled,
    uomDivisionEnabled: !!page.data.uomDivisionEnabled,
    djiNoFlyZoneEnabled: !!page.data.djiNoFlyZoneEnabled,
    temporaryNoFlyZoneEnabled: !!page.data.temporaryNoFlyZoneEnabled,
    merchantMarkersEnabled: !!page.data.merchantMarkersEnabled,
    privateMarkersEnabled: !!page.data.privateMarkersEnabled,
    groupSharingEnabled: !!page.data.groupSharingEnabled,
    platformCoConstructionEnabled: !!page.data.platformCoConstructionEnabled,
    useDefaultCenterPoint: !page.data.usePlanetCenterPoint,
    aircraftModel: page.data.selectedDrone || "",
    extraConfig: buildMapLayerExtraConfigPayload(page)
  };
}

function loadCachedUsePlanetMyLocationPreference() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return null;
  try {
    const cached = wx.getStorageSync(MAP_USE_PLANET_MY_LOCATION_STORAGE_KEY);
    if (typeof cached === "boolean") return cached;
  } catch (err) {
    console.warn("load cached usePlanetMyLocation preference failed", err);
  }
  return null;
}

function cacheUsePlanetMyLocationPreference(enabled) {
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") return;
  try {
    wx.setStorageSync(MAP_USE_PLANET_MY_LOCATION_STORAGE_KEY, enabled === true);
  } catch (err) {
    console.warn("cache usePlanetMyLocation preference failed", err);
  }
}

function composeMapElementOptions(flags = {}) {
  const state = Object.assign(
    {
      uomDivisionEnabled: true,
      djiNoFlyZoneEnabled: true,
      temporaryNoFlyZoneEnabled: true,
      merchantMarkersEnabled: true,
      privateMarkersEnabled: false,
      groupSharingEnabled: false,
      platformCoConstructionEnabled: true
    },
    flags
  );
  const djiEnabled = !!state.djiNoFlyZoneEnabled;
  const tempEnabled = !!state.temporaryNoFlyZoneEnabled;
  return [
    { id: "uom", label: "uom划分", enabled: !!state.uomDivisionEnabled },
    { id: "dji", label: "大疆划分", enabled: djiEnabled },
    { id: "tempNoFly", label: "临时禁飞区", enabled: tempEnabled },
    { id: "service", label: "商户服务", enabled: !!state.merchantMarkersEnabled },
    { id: "private", label: "私有标记", enabled: !!state.privateMarkersEnabled },
    { id: "group", label: "小组共享", enabled: !!state.groupSharingEnabled },
    { id: "platform", label: "平台共建", enabled: !!state.platformCoConstructionEnabled }
  ];
}

function applyLayerSettings(page, settings = {}, options = {}) {
  const resolvedMapType = page.resolveMapBaseLayerType(settings);
  const mapType =
    (resolvedMapType === "satellite" || resolvedMapType === "tianditu") && !page.data.userVip
      ? "standard"
      : resolvedMapType;
  const airspace = settings.airspaceBoardEnabled !== false;
  const uom = settings.uomDivisionEnabled !== false;
  const dji = settings.djiNoFlyZoneEnabled !== false;
  const temporary = settings.temporaryNoFlyZoneEnabled !== undefined
    ? settings.temporaryNoFlyZoneEnabled !== false
    : dji;
  const merchant = settings.merchantMarkersEnabled !== false;
  const privateMarkers = settings.privateMarkersEnabled !== false;
  const groupSharing = settings.groupSharingEnabled !== false;
  const platformCoConstruction = settings.platformCoConstructionEnabled !== false;
  const usePlanetCenterPoint = settings.useDefaultCenterPoint === false;
  const centerTargetLinkEnabled = page.resolveCenterTargetLinkEnabled(settings);
  const provinceCityHighlightEnabled = page.resolveProvinceCityHighlightEnabled(settings);
  const provinceCityHighlightSelectionId = page.resolveProvinceCityHighlightSelectionId(settings);
  const mapElementOptions = page.composeMapElementOptions({
    uomDivisionEnabled: uom,
    djiNoFlyZoneEnabled: dji,
    temporaryNoFlyZoneEnabled: temporary,
    merchantMarkersEnabled: merchant,
    privateMarkersEnabled: privateMarkers,
    groupSharingEnabled: groupSharing,
    platformCoConstructionEnabled: platformCoConstruction
  });
  page.setData(
    {
      mapLayerType: mapType,
      enableSatellite: mapType === "satellite" || mapType === "tianditu",
      airBoardEnabled: airspace,
      showDashboardPanel: airspace,
      uomDivisionEnabled: uom,
      djiNoFlyZoneEnabled: dji,
      temporaryNoFlyZoneEnabled: temporary,
      merchantMarkersEnabled: merchant,
      privateMarkersEnabled: privateMarkers,
      groupSharingEnabled: groupSharing,
      platformCoConstructionEnabled: platformCoConstruction,
      usePlanetCenterPoint,
      centerTargetLinkEnabled,
      provinceCityHighlightEnabled,
      provinceCityHighlightSelectedId: provinceCityHighlightSelectionId,
      myLocationModeResolved: true,
      mapElementOptions
    },
    () => {
      page._provinceCityHighlightSelectedId = provinceCityHighlightSelectionId;
      page.cacheUsePlanetMyLocationPreference(usePlanetCenterPoint);
      const afterLocationReady = () => {
        page.refreshMyLocationGraphics(page.data.myLocationPoint || page._lastKnownLocation || null);
        page.applyAirBoardToggle(airspace);
        if (page._uomPlugin && typeof page._uomPlugin.setEnabled === "function") {
          page._uomPlugin.setEnabled(uom);
        }
        page.setTiandituSatelliteLayerEnabled(mapType === "tianditu", { force: true });
        page.applyNoFlyOverlayToggle({ djiEnabled: dji, temporaryEnabled: temporary });
        page.applyMerchantMarkersToggle(merchant);
        page.applyPinLayerToggle(true);
        page.syncProvinceCityHighlightLayer(provinceCityHighlightEnabled, { showErrorToast: false });
        if (typeof options.onApplied === "function") {
          options.onApplied();
        }
      };
      if (usePlanetCenterPoint) {
        const fallbackPoint =
          page.data.myLocationPoint ||
          page._lastKnownLocation ||
          page.resolveCachedMapLocationPoint();
        if (
          Number.isFinite(Number(fallbackPoint?.latitude)) &&
          Number.isFinite(Number(fallbackPoint?.longitude))
        ) {
          page._lastKnownLocation = {
            latitude: Number(fallbackPoint.latitude),
            longitude: Number(fallbackPoint.longitude)
          };
          page.setMyLocationControlPoint(page._lastKnownLocation);
          afterLocationReady();
          if (page._skipNextApplyLayerInitialSync) {
            page._skipNextApplyLayerInitialSync = false;
            return;
          }
        } else if (page._skipNextApplyLayerInitialSync) {
          page._skipNextApplyLayerInitialSync = false;
          afterLocationReady();
          return;
        }
        page.syncMyLocationPoint({ silent: true }).finally(() => {
          if (
            !Number.isFinite(Number(fallbackPoint?.latitude)) ||
            !Number.isFinite(Number(fallbackPoint?.longitude))
          ) {
            afterLocationReady();
          }
        });
        return;
      }
      afterLocationReady();
      page.bootstrapInitialNativeLocationCenter();
    }
  );
}

function loadMapLayerSettings(page, force = false) {
  if (page.data.mapLayerSettingsLoading) return;
  if (page._mapLayerSettingsLoaded && !force) return;
  const apiBase = page.getApiBase();
  const token = page.getAuthToken();
  if (!apiBase || !token) {
    if (!page.data.myLocationModeResolved) {
      page.setData({ myLocationModeResolved: true });
    }
    return;
  }
  page.setData({ mapLayerSettingsLoading: true });
  fetchMapLayerSettings({
    apiBase,
    token
  })
    .then((settings) => {
      if (settings) {
        page._mapLayerSettings = settings;
        applyLayerSettings(page, settings, {
          onApplied: () => {
            const aircraftModel = page.normalizeAircraftModel(settings.aircraftModel);
            if (aircraftModel) {
              const applied = page.applyAircraftModelSetting(aircraftModel, { persist: false });
              if (!applied) {
                page._pendingAircraftModel = aircraftModel;
              } else {
                page._pendingAircraftModel = "";
              }
            } else if (!page._mapLayerAircraftModelWritten) {
              page._mapLayerAircraftModelWritten = true;
              if (page.data.selectedDrone) {
                page.persistMapLayerSettings();
              }
            }
          }
        });
        page._mapLayerSettingsLoaded = true;
        page.scheduleAddMiniAppPopupCheck("map-layer-settings");
      }
    })
    .catch((err) => {
      console.warn("Failed to load map layer settings", err);
    })
    .finally(() => {
      page.setData({
        mapLayerSettingsLoading: false,
        myLocationModeResolved: true
      });
    });
}

function bootstrapMapLayerSettings(page, force = false) {
  if (page._mapLayerSettingsInitPromise) return page._mapLayerSettingsInitPromise;
  const apiBase = page.getApiBase();
  const token = page.getAuthToken();
  if (apiBase && token) {
    loadMapLayerSettings(page, force);
    return Promise.resolve();
  }
  const promise = page.ensureProfileAuthenticated();
  if (!promise || typeof promise.then !== "function") {
    return Promise.resolve();
  }
  page._mapLayerSettingsInitPromise = promise
    .then(() => {
      loadMapLayerSettings(page, force);
    })
    .catch((err) => {
      console.warn("bootstrap map layer settings failed", err);
    })
    .finally(() => {
      page._mapLayerSettingsInitPromise = null;
    });
  return page._mapLayerSettingsInitPromise;
}

function persistMapLayerSettings(page) {
  const apiBase = page.getApiBase();
  const token = page.getAuthToken();
  if (!apiBase || !token) return;
  const payload = page.buildMapLayerSettingsPayload();
  updateMapLayerSettings(payload, {
    apiBase,
    token
  })
    .then((settings) => {
      if (settings && typeof settings === "object") {
        page._mapLayerSettings = settings;
        return;
      }
      const previous =
        page._mapLayerSettings && typeof page._mapLayerSettings === "object"
          ? page._mapLayerSettings
          : {};
      page._mapLayerSettings = Object.assign({}, previous, payload);
    })
    .catch((err) => {
      console.warn("Failed to update map layer settings", err);
    });
}

module.exports = {
  onLayerButtonTap,
  onLayerPanelMaskTap,
  onLayerPanelClose,
  closeLayerPanel,
  onMapLayerSelect,
  onAirBoardSwitchChange,
  onUsePlanetCenterPointSwitchChange,
  onCenterTargetLinkSwitchChange,
  buildProvinceCityTreeViewData,
  updateProvinceCityTreeData,
  scheduleLayerPanelLayoutMeasure,
  measureLayerPanelLayout,
  findProvinceCityTreeNodeById,
  setProvinceCityHighlightPolygons,
  loadProvinceCityHighlightResource,
  syncProvinceCityHighlightLayer,
  applyProvinceCityHighlightSelection,
  onProvinceCityHighlightSwitchChange,
  onProvinceCityTreeExpandTap,
  onProvinceCityTreeSelectTap,
  onMapElementToggle,
  applyNoFlyOverlayToggle,
  applyMerchantMarkersToggle,
  applyPinLayerToggle,
  parseMapLayerExtraBoolean,
  resolveCenterTargetLinkEnabled,
  resolveProvinceCityHighlightEnabled,
  resolveProvinceCityHighlightSelectionId,
  resolveMapBaseLayerType,
  buildMapLayerExtraConfigPayload,
  buildMapLayerSettingsPayload,
  loadCachedUsePlanetMyLocationPreference,
  cacheUsePlanetMyLocationPreference,
  composeMapElementOptions,
  applyLayerSettings,
  loadMapLayerSettings,
  bootstrapMapLayerSettings,
  persistMapLayerSettings
};
