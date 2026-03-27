const { searchPlaces } = require("../../../utils/search");
const { searchMarkers } = require("../../../utils/markers");
const { searchPins } = require("../../../utils/pins");
const {
  parseCoordinateSearchKeyword,
  buildCoordinateSuggestion
} = require("../../../utils/coordinate-search");
const { gcj02ToWgs84 } = require("../../../utils/coords");

const MAX_SEARCH_SUGGESTIONS = 10;
const MAX_SEARCH_RESULTS = 20;
const SEARCH_LINK_OWNER_SEARCH = "search";

const getWindowMetrics = () => {
  let windowInfo = {};
  let deviceInfo = {};
  if (typeof wx !== "undefined") {
    if (typeof wx.getWindowInfo === "function") {
      try {
        windowInfo = wx.getWindowInfo() || {};
      } catch (err) {
        windowInfo = {};
      }
    }
    if (typeof wx.getDeviceInfo === "function") {
      try {
        deviceInfo = wx.getDeviceInfo() || {};
      } catch (err) {
        deviceInfo = {};
      }
    }
  }
  const windowWidth = Number(windowInfo.windowWidth) || 375;
  const windowHeight = Number(windowInfo.windowHeight) || 667;
  const screenWidth = Number(windowInfo.screenWidth || deviceInfo.screenWidth) || windowWidth;
  const screenHeight = Number(windowInfo.screenHeight || deviceInfo.screenHeight) || windowHeight;
  const statusBarHeight = Number(windowInfo.statusBarHeight || deviceInfo.statusBarHeight) || 0;
  const platform = `${deviceInfo.platform || windowInfo.platform || ""}`.toLowerCase();
  const pixelRatio = Number(windowInfo.pixelRatio || deviceInfo.pixelRatio) || 1;
  return {
    windowWidth,
    windowHeight,
    screenWidth,
    screenHeight,
    statusBarHeight,
    platform,
    pixelRatio
  };
};

const settleWithValue = (promise, options = {}) => {
  const defaultValue =
    options && Object.prototype.hasOwnProperty.call(options, "defaultValue")
      ? options.defaultValue
      : undefined;
  return promise
    .then((value) => ({ ok: true, value }))
    .catch((error) => {
      if (typeof options?.onError === "function") {
        options.onError(error);
      } else {
        console.warn(options?.label || "Promise rejected", error);
      }
      return { ok: false, error, value: defaultValue };
    });
};

function buildSearchLocationArgs(page) {
  let locationArgs = null;
  const center = page._centerOverride || page.data.center;
  try {
    const centerWgs = center
      ? gcj02ToWgs84(center.longitude, center.latitude)
      : null;
    if (Number.isFinite(centerWgs?.lat) && Number.isFinite(centerWgs?.lng)) {
      locationArgs = {
        latitude: centerWgs.lat,
        longitude: centerWgs.lng
      };
    }
  } catch (err) {
    console.warn("Failed to convert center for search", err);
  }
  return locationArgs;
}

function fillPinSuggestionAddresses(page, suggestions = [], keywordSnapshot = "") {
  const list = Array.isArray(suggestions) ? suggestions : [];
  list.forEach((item, idx) => {
    if (item.source !== "pin") return;
    if (item.address) return;
    const lat = Number(item.latitude);
    const lng = Number(item.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    page.requestPinAddress(lat, lng)
      .then((addr) => {
        if (!addr) return;
        if (keywordSnapshot !== page.data.keyword.trim()) return;
        const patch = {};
        patch[`searchSuggestions[${idx}].address`] = addr;
        page.setData(patch);
      })
      .catch((err) => console.warn("pin suggest reverse geocode failed", err));
  });
}

function updatePreflightOverlayTop(page) {
  const baseTopRpx = Number(page.data.preflightBaseTopRpx) || 120;
  const { screenWidth } = getWindowMetrics();
  const rpx = screenWidth ? screenWidth / 750 : 0;
  const baseTopPx = rpx > 0 ? baseTopRpx * rpx : 60;
  let topPx = baseTopPx;

  if (typeof wx !== "undefined" && typeof wx.getMenuButtonBoundingClientRect === "function") {
    try {
      const menuRect = wx.getMenuButtonBoundingClientRect();
      const menuTop = Number(menuRect?.top);
      const menuBottom = Number(menuRect?.bottom);
      if (Number.isFinite(menuTop) && Number.isFinite(menuBottom) && menuBottom > menuTop) {
        topPx = (menuTop + menuBottom) / 2;
      }
    } catch (err) {
      topPx = baseTopPx;
    }
  }

  page.setData({
    preflightTopRpx: rpx > 0 ? topPx / rpx : baseTopRpx,
    preflightTopPx: topPx
  });
}

function applyAirBoardToggle(page, enabled) {
  page.setData({ showDashboardPanel: !!enabled });
}

function clearSearchSelectionVisuals(page) {
  page.clearSearchLinkOverlay({ owner: SEARCH_LINK_OWNER_SEARCH });
  page.applySearchMarkers([]);
}

function onKeywordInput(page, event = {}) {
  const keyword = event?.detail?.value || "";
  page.setData({ keyword }, () => {
    if (!keyword.trim()) {
      if (page._suggestTimer) {
        clearTimeout(page._suggestTimer);
        page._suggestTimer = null;
      }
      clearSearchSelectionVisuals(page);
      page.setData({
        searchSuggestions: [],
        searchSuggestLoading: false,
        searchSuggestError: ""
      });
      return;
    }
    page.setData({
      searchSuggestLoading: true,
      searchSuggestError: "",
      searchSuggestions: []
    });
    scheduleSearchSuggest(page);
  });
}

function onSearchConfirm(page) {
  performSearch(page);
}

function onSearchTap(page) {
  performSearch(page);
}

function onSearchCoordinateTipsTap(page) {
  page.setData({ searchCoordinateTipsVisible: true });
}

function onCloseSearchCoordinateTipsDialog(page) {
  if (!page.data.searchCoordinateTipsVisible) return;
  page.setData({ searchCoordinateTipsVisible: false });
}

function onTemporaryZoneLinkTap(page, event = {}) {
  const info = page.data.temporaryNoFlyZoneInfo;
  if (!info || !info.hasLink) {
    page.showPlaceholderToast("链接不可用");
    return;
  }
  const dataset = event?.currentTarget?.dataset || {};
  const detail = event?.detail || {};
  const targetPath = detail.path || dataset.path || info.linkPath || "";
  if (targetPath && typeof wx.navigateTo === "function") {
    wx.navigateTo({ url: targetPath });
    return;
  }
  page.showPlaceholderToast("链接不可用");
}

function onCenterPinIndicatorTap(page) {
  if (page.shouldSuppressCenterPinOpen()) return;
  const opened = page.openMarkerOrPinAtCenter();
  if (!opened) {
    wx.showToast({ title: "未找到标记", icon: "none" });
  }
}

function performSearch(page) {
  const keyword = page.data.keyword.trim();
  if (!keyword) {
    clearSearchSelectionVisuals(page);
    page.setData({
      searchSuggestions: [],
      searchSuggestLoading: false,
      searchSuggestError: ""
    });
    return;
  }
  const coordinateResult = parseCoordinateSearchKeyword(keyword);
  if (coordinateResult) {
    const suggestion = buildCoordinateSuggestion(coordinateResult);
    const marker = buildSearchSelectionMarker(page, suggestion, 0);
    if (marker) {
      applySearchSelectionFromMarker(page, marker, {
        keyword: coordinateResult.title,
        centerOnPoint: true,
        centerScale: 15
      });
    }
    return;
  }
  page.clearSearchLinkOverlay({ owner: SEARCH_LINK_OWNER_SEARCH });
  wx.showLoading({ title: "Searching...", mask: true });
  const locationArgs = buildSearchLocationArgs(page);
  const markerPromise = settleWithValue(
    searchMarkers(keyword, {
      apiBase: page.getApiBase(),
      limit: MAX_SEARCH_RESULTS
    }),
    {
      defaultValue: [],
      onError: (err) => console.warn("Marker search failed", err)
    }
  );
  const pinPromise = settleWithValue(
    searchPins(keyword, {
      apiBase: page.getApiBase(),
      limit: MAX_SEARCH_RESULTS
    }),
    {
      defaultValue: [],
      onError: (err) => console.warn("Pin search failed", err)
    }
  );
  const placePromise = settleWithValue(
    locationArgs
      ? searchPlaces(keyword, locationArgs)
      : searchPlaces(keyword),
    {
      defaultValue: [],
      onError: (err) => console.warn("Search failed", err)
    }
  );
  Promise.all([markerPromise, pinPromise, placePromise])
    .then(([markerResult, pinResult, placeResult]) => {
      const markerPayloads = (markerResult.value || [])
        .map((item, index) =>
          page.createMarkerSearchPayload(item, {
            fallbackId: `marker-search-${index}`
          })
        )
        .filter(Boolean);
      const markerMarkers = markerPayloads
        .map((payload) =>
          page.buildMarkerFromSearchPayload(payload, {
            source: "marker-search"
          })
        )
        .filter(Boolean);
      const pinPayloads = (pinResult.value || [])
        .map((item, index) =>
          page.createPinSearchPayload(item, {
            fallbackId: `pin-search-${index}`
          })
        )
        .filter(Boolean);
      const pinMarkers = pinPayloads
        .map((payload) =>
          page.buildPinSearchMarker(payload, {
            source: "pin-search"
          })
        )
        .filter(Boolean);
      const pinLimited = pinMarkers.slice(
        0,
        Math.max(0, MAX_SEARCH_RESULTS - markerMarkers.length)
      );
      const combined = markerMarkers.concat(pinLimited);
      const remainingSlots = Math.max(0, MAX_SEARCH_RESULTS - combined.length);
      const qqMarkers = (placeResult.value || [])
        .map((poi, index) => page.buildQqSearchMarker(poi, index))
        .filter(Boolean)
        .slice(0, remainingSlots);
      const markers = combined.concat(qqMarkers);
      if (markers.length) {
        page.applySearchMarkers(markers);
        const points = markers.map((marker) => ({
          latitude: marker.latitude,
          longitude: marker.longitude
        }));
        page.mapCtx.includePoints({
          points,
          padding: [60, 60, 60, 60]
        });
      } else {
        page.applySearchMarkers([]);
        const message =
          markerResult.ok && placeResult.ok
            ? "没有匹配的地点"
            : "搜索失败，请稍后重试";
        wx.showToast({ title: message, icon: "none" });
      }
    })
    .finally(() => {
      wx.hideLoading();
      page.setData({
        searchSuggestions: [],
        searchSuggestLoading: false,
        searchSuggestError: ""
      });
    });
}

function scheduleSearchSuggest(page) {
  if (page._suggestTimer) clearTimeout(page._suggestTimer);
  page._suggestTimer = setTimeout(() => {
    page._suggestTimer = null;
    fetchSearchSuggestions(page);
  }, 250);
}

function fetchSearchSuggestions(page) {
  const keyword = page.data.keyword.trim();
  if (!keyword) {
    page.setData({
      searchSuggestions: [],
      searchSuggestLoading: false,
      searchSuggestError: ""
    });
    return;
  }
  const coordinateResult = parseCoordinateSearchKeyword(keyword);
  if (coordinateResult) {
    const suggestion = buildCoordinateSuggestion(coordinateResult);
    page.setData({
      searchSuggestions: suggestion ? [suggestion] : [],
      searchSuggestLoading: false,
      searchSuggestError: suggestion ? "" : "没有匹配的地点"
    });
    return;
  }
  const snapshot = keyword;
  const locationArgs = buildSearchLocationArgs(page);
  const markerPromise = settleWithValue(
    searchMarkers(keyword, {
      apiBase: page.getApiBase(),
      limit: MAX_SEARCH_SUGGESTIONS
    }),
    {
      defaultValue: [],
      onError: (err) => console.warn("Marker suggest search failed", err)
    }
  );
  const pinPromise = settleWithValue(
    searchPins(keyword, {
      apiBase: page.getApiBase(),
      limit: MAX_SEARCH_SUGGESTIONS
    }),
    {
      defaultValue: [],
      onError: (err) => console.warn("Pin suggest search failed", err)
    }
  );
  const placePromise = settleWithValue(
    locationArgs
      ? searchPlaces(keyword, locationArgs)
      : searchPlaces(keyword),
    {
      defaultValue: [],
      onError: (err) => console.warn("Suggest failed", err)
    }
  );
  Promise.all([markerPromise, pinPromise, placePromise]).then(
    ([markerResult, pinResult, placeResult]) => {
      if (snapshot !== page.data.keyword.trim()) return;
      const markerPayloads = (markerResult.value || [])
        .map((item, index) =>
          page.createMarkerSearchPayload(item, {
            fallbackId: `marker-suggest-${index}`
          })
        )
        .filter(Boolean);
      const markerSuggestions = markerPayloads
        .map((payload) => page.buildMarkerSuggestionFromPayload(payload))
        .filter(Boolean)
        .slice(0, MAX_SEARCH_SUGGESTIONS);
      const pinPayloads = (pinResult.value || [])
        .map((item, index) =>
          page.createPinSearchPayload(item, {
            fallbackId: `pin-suggest-${index}`
          })
        )
        .filter(Boolean);
      const pinSuggestions = pinPayloads
        .map((payload) => page.buildPinSuggestionFromPayload(payload))
        .filter(Boolean)
        .slice(0, Math.max(0, MAX_SEARCH_SUGGESTIONS - markerSuggestions.length));
      const remainingSlots = Math.max(
        0,
        MAX_SEARCH_SUGGESTIONS - markerSuggestions.length - pinSuggestions.length
      );
      const qqSuggestions = (placeResult.value || [])
        .map((poi, index) => page.buildQqSuggestion(poi, index))
        .filter(Boolean)
        .slice(0, remainingSlots);
      const suggestions = markerSuggestions.concat(pinSuggestions, qqSuggestions);
      const noResults = !suggestions.length;
      const nextError = noResults
        ? markerResult.ok && placeResult.ok
          ? "没有匹配的地点"
          : "提示获取失败，请稍后重试"
        : "";
      page.setData({
        searchSuggestions: suggestions,
        searchSuggestLoading: false,
        searchSuggestError: nextError
      });
      fillPinSuggestionAddresses(page, suggestions, snapshot);
    }
  );
}

function buildSearchSelectionMarker(page, suggestion = {}, index = 0) {
  if (!suggestion || typeof suggestion !== "object") return null;
  if (suggestion.source === "marker" && suggestion.markerPayload) {
    return page.buildMarkerFromSearchPayload(suggestion.markerPayload, {
      source: "marker-search-selected"
    });
  }
  if (suggestion.source === "pin" && suggestion.pinPayload) {
    return page.buildPinSearchMarker(suggestion.pinPayload, {
      source: "pin-search-selected"
    });
  }
  if (suggestion.source === "qqmap" && suggestion.rawPoi) {
    return page.buildQqSearchMarker(suggestion.rawPoi, index);
  }
  if (suggestion.source === "coordinate" && suggestion.coordinatePayload) {
    return page.buildCoordinateSearchMarker(suggestion.coordinatePayload, {
      source: "coordinate-search-selected"
    });
  }
  const latitude = Number(suggestion.latitude);
  const longitude = Number(suggestion.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  const marker = {
    id: `search-selected-${Date.now()}`,
    latitude,
    longitude,
    title: suggestion.title || "",
    extData: {
      source: "search-selected",
      raw: suggestion
    }
  };
  const title = `${suggestion.title || ""}`.trim();
  const address = `${suggestion.address || ""}`.trim();
  if (title || address) {
    marker.callout = {
      content: address ? `${title}\n${address}` : title,
      display: "ALWAYS",
      borderRadius: 4,
      padding: 4
    };
  }
  return marker;
}

function applySearchSelectionFromMarker(page, marker, options = {}) {
  if (!marker || !page.isSearchSelectionMarker(marker)) {
    return false;
  }
  const latitude = Number(marker.latitude);
  const longitude = Number(marker.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }
  page.clearMapTapTargetPoint({ preserveSearchLink: true });
  const selectedMarker = page.cloneSearchSelectionMarker(marker) || marker;
  const keyword = `${options.keyword || marker.title || marker.name || page.data.keyword || ""}`.trim();
  const target = { latitude, longitude };
  page.setData({
    keyword: keyword || page.data.keyword,
    searchSuggestions: [],
    searchSuggestLoading: false,
    searchSuggestError: ""
  });
  page.applySearchLinkTarget(target, {
    owner: SEARCH_LINK_OWNER_SEARCH,
    visible: true
  });
  page.applySearchMarkers([selectedMarker]);
  if (options.centerOnPoint) {
    const centerScale = Number.isFinite(Number(options.centerScale))
      ? Number(options.centerScale)
      : 15;
    page.centerOnPoint(target, centerScale);
  }
  page.resolveSearchSelectionAddress(selectedMarker);
  return true;
}

function applySearchSelectionFromPinPayload(page, payload = {}, options = {}) {
  if (!payload || !page.isAreaPinSearchPayload(payload)) {
    return false;
  }
  const target = page.resolvePinSearchTarget(payload);
  if (!target) {
    return false;
  }
  page.clearMapTapTargetPoint({ preserveSearchLink: true });
  clearSearchSelectionVisuals(page);
  const keyword = `${options.keyword || payload.name || page.data.keyword || ""}`.trim();
  page.setData({
    keyword: keyword || page.data.keyword,
    searchSuggestions: [],
    searchSuggestLoading: false,
    searchSuggestError: ""
  });
  if (options.centerOnPoint) {
    const centerScale = Number.isFinite(Number(options.centerScale))
      ? Number(options.centerScale)
      : 15;
    page.centerOnPoint(target, centerScale);
  }
  return true;
}

function onSuggestionTap(page, event = {}) {
  const idx = Number(event?.currentTarget?.dataset?.index ?? event?.detail?.index);
  const suggestion = page.data.searchSuggestions?.[idx];
  if (!suggestion) return;
  if (
    suggestion.source === "pin" &&
    suggestion.pinPayload &&
    page.isAreaPinSearchPayload(suggestion.pinPayload)
  ) {
    const handled = applySearchSelectionFromPinPayload(page, suggestion.pinPayload, {
      keyword: suggestion.title || page.data.keyword,
      centerOnPoint: true,
      centerScale: 15
    });
    if (handled) {
      return;
    }
  }
  const marker = buildSearchSelectionMarker(page, suggestion, idx);
  if (
    !marker ||
    !Number.isFinite(marker.latitude) ||
    !Number.isFinite(marker.longitude)
  ) {
    return;
  }
  applySearchSelectionFromMarker(page, marker, {
    keyword: suggestion.title || page.data.keyword,
    centerOnPoint: true,
    centerScale: 15
  });
}

module.exports = {
  fillPinSuggestionAddresses,
  updatePreflightOverlayTop,
  applyAirBoardToggle,
  clearSearchSelectionVisuals,
  onKeywordInput,
  onSearchConfirm,
  performSearch,
  scheduleSearchSuggest,
  fetchSearchSuggestions,
  onSearchTap,
  onSearchCoordinateTipsTap,
  onCloseSearchCoordinateTipsDialog,
  onTemporaryZoneLinkTap,
  onCenterPinIndicatorTap,
  buildSearchSelectionMarker,
  applySearchSelectionFromMarker,
  applySearchSelectionFromPinPayload,
  onSuggestionTap
};
