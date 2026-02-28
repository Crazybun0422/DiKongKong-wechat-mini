const { reverseGeocode } = require("../../../utils/geocoder");
const { gcj02ToWgs84 } = require("../../../utils/coords");
const { searchPlaces } = require("../../../utils/search");
const { getMapKeySync, prefetchMapKey } = require("../../../utils/map-key");
const { isWeChatRuntime, isDesktopRuntime } = require("../../../utils/runtime");

const DEFAULT_CENTER = {
  latitude: 39.9042,
  longitude: 116.4074,
  scale: 16
};
const DEFAULT_LEVELS_PARAM = "2,6,1,4,3,7,8,10";
const MAP_MIN_SCALE = 0;
const MAP_MAX_SCALE = 18;
const RUNTIME_IS_WECHAT = isWeChatRuntime() && !isDesktopRuntime();
const COORD_ADJUST_STEP = 0.00001;
const PICKER_WIDE_LAYOUT_MIN_WIDTH = 560;
const PICKER_WIDE_LAYOUT_MIN_RATIO = 1.1;
const WINDOW_RESIZE_DEBOUNCE_MS = 80;
const hasSavedLocationPayload = (payload = {}) => {
  if (!payload) return false;
  const lat = normalizeCoord(payload.latitude);
  const lng = normalizeCoord(payload.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return true;
  const list = normalizeCoordinateList(payload.coordinates || payload.coordinateList || []);
  return list.some((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
};

const TYPE_SECTIONS = [
  {
    id: "POINT",
    label: "绘制点",
    options: [
      { id: "POINT_DEFAULT", label: "通用", icon: "/assets/default.png" },
      { id: "POINT_WARNING", label: "警示点", icon: "/assets/drone-warning.png" },
      { id: "POINT_AERIAL", label: "航拍点", icon: "/assets/aerial.png" },
      { id: "POINT_DOCK", label: "起降场", icon: "/assets/dock.png" },
      { id: "POINT_ELEVATION", label: "高程建筑", icon: "/assets/elevation.png" }
    ]
  },
  {
    id: "LINE",
    label: "绘制线",
    options: [{ id: "LINE_PATH_BUFFER", label: "航线", icon: "/assets/path.png" }]
  },
  {
    id: "AREA",
    label: "绘制面",
    options: [
      { id: "AREA_CIRCLE", label: "圆形", icon: "/assets/circle.png" },
      { id: "AREA_RECTANGLE", label: "矩形", icon: "/assets/rectangle.png" },
      { id: "AREA_POLYGON", label: "多边形", icon: "/assets/polygon.png" }
    ]
  }
];

const DEFAULT_TYPE = TYPE_SECTIONS[0].options[0];
const PIN_SHAPE_COLOR = "#D3A05B";
const PIN_SHAPE_STROKE = "#D3A05BF2";
const PIN_SHAPE_FILL = "#D3A05B4D";

function getWindowMetrics(event = {}) {
  let windowInfo = {};
  if (typeof wx !== "undefined" && typeof wx.getWindowInfo === "function") {
    try {
      windowInfo = wx.getWindowInfo() || {};
    } catch (err) {
      windowInfo = {};
    }
  }
  let size = event && event.size;
  if (Array.isArray(size)) {
    size = size[0] || null;
  }
  if (!size || typeof size !== "object") {
    size = event;
  }
  const resizeWidth = Number(size.windowWidth || size.width);
  const resizeHeight = Number(size.windowHeight || size.height);
  const windowWidth =
    Number.isFinite(resizeWidth) && resizeWidth > 0
      ? resizeWidth
      : (Number(windowInfo.windowWidth) || 375);
  const windowHeight =
    Number.isFinite(resizeHeight) && resizeHeight > 0
      ? resizeHeight
      : (Number(windowInfo.windowHeight) || 667);
  return { windowWidth, windowHeight };
}

function resolveWideLayout(metrics = {}) {
  const width = Number(metrics.windowWidth);
  const height = Number(metrics.windowHeight);
  if (!Number.isFinite(width) || width <= 0) return false;
  if (width >= PICKER_WIDE_LAYOUT_MIN_WIDTH) return true;
  if (Number.isFinite(height) && height > 0) {
    return width / height >= PICKER_WIDE_LAYOUT_MIN_RATIO;
  }
  return false;
}

function normalizeCoord(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Number(num.toFixed(6));
}

function normalizeAltitude(value) {
  if (value === undefined || value === null || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return Number(num.toFixed(2));
}

function normalizeCoordinateItem(item = {}) {
  const lat = normalizeCoord(item.latitude);
  const lng = normalizeCoord(item.longitude);
  return {
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
    altitude: normalizeAltitude(item.altitude)
  };
}

function normalizeCoordinateList(list) {
  if (!Array.isArray(list) || !list.length) {
    return [normalizeCoordinateItem({})];
  }
  const normalized = list.map((item) => normalizeCoordinateItem(item));
  return normalized.length ? normalized : [normalizeCoordinateItem({})];
}

function normalizeLineCoordinateList(list) {
  if (!Array.isArray(list) || !list.length) return [];
  return list
    .map((item) => normalizeCoordinateItem(item))
    .filter((item) => hasValidCoordinate(item.latitude, item.longitude));
}

function formatCoordinateText(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function normalizeSuggestions(list = [], limit = 10) {
  const suggestions = [];
  list.forEach((poi, index) => {
    const lat = Number(poi?.location?.lat);
    const lng = Number(poi?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }
    const title = poi.title || poi.name || "";
    const addressParts = [
      poi.address,
      poi.district,
      poi.city,
      poi.province,
      poi.category
    ]
      .map((part) => (part || "").trim())
      .filter(Boolean);
    const address = addressParts.reduce((acc, part) => {
      return acc.includes(part) ? acc : `${acc ? `${acc} · ` : ""}${part}`;
    }, "");
    suggestions.push({
      id: poi.id || poi.adcode || `poi-${index}`,
      title: title || address || "未命名地点",
      address,
      latitude: lat,
      longitude: lng
    });
  });
  return suggestions.slice(0, limit);
}

function isZeroCoordinate(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return Math.abs(lat) <= 1e-6 && Math.abs(lng) <= 1e-6;
}

function hasValidCoordinate(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && !isZeroCoordinate(lat, lng);
}

function normalizeMapScale(value) {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : DEFAULT_CENTER.scale;
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, Math.round(base)));
}

function normalizeRegionDetail(detail = {}) {
  if (!detail || typeof detail !== "object") return null;
  const region = detail.region || {
    northeast: detail.northeast,
    southwest: detail.southwest
  };
  if (!region || !region.northeast || !region.southwest) return null;
  const neLat = Number(region.northeast.latitude);
  const neLng = Number(region.northeast.longitude);
  const swLat = Number(region.southwest.latitude);
  const swLng = Number(region.southwest.longitude);
  if (![neLat, neLng, swLat, swLng].every(Number.isFinite)) return null;
  return {
    northeast: { latitude: neLat, longitude: neLng },
    southwest: { latitude: swLat, longitude: swLng }
  };
}

function averageValue(list = [], field) {
  if (!Array.isArray(list) || !list.length) return 0;
  let total = 0;
  list.forEach((item) => {
    total += Number(item?.[field] || 0);
  });
  return total / list.length;
}

function buildLineBufferPolygon(points = [], bufferMeters = 0) {
  if (!Array.isArray(points) || points.length < 2) return [];
  if (!Number.isFinite(bufferMeters) || bufferMeters <= 0) return [];
  const validPoints = points.filter((pt) => hasValidCoordinate(pt?.latitude, pt?.longitude));
  if (validPoints.length < 2) return [];
  const baseLat = averageValue(validPoints, "latitude");
  const baseLng = averageValue(validPoints, "longitude");
  const cosLat = Math.max(Math.cos((baseLat * Math.PI) / 180), 0.0001);
  const kLat = 111320;
  const kLng = 111320 * cosLat;
  const project = (pt) => ({
    x: (pt.longitude - baseLng) * kLng,
    y: (pt.latitude - baseLat) * kLat
  });
  const unproject = (p) => ({
    latitude: p.y / kLat + baseLat,
    longitude: p.x / kLng + baseLng
  });
  const projected = validPoints.map(project);
  const segmentNormals = [];
  for (let i = 0; i < projected.length - 1; i += 1) {
    const a = projected[i];
    const b = projected[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!len) {
      segmentNormals.push({ x: 0, y: 0 });
      continue;
    }
    segmentNormals.push({ x: -dy / len, y: dx / len });
  }
  const normals = projected.map((point, index) => {
    if (!segmentNormals.length) return { x: 0, y: 0 };
    if (index === 0) return segmentNormals[0];
    if (index === projected.length - 1) return segmentNormals[segmentNormals.length - 1];
    const prev = segmentNormals[index - 1] || { x: 0, y: 0 };
    const next = segmentNormals[index] || { x: 0, y: 0 };
    const nx = prev.x + next.x;
    const ny = prev.y + next.y;
    const len = Math.sqrt(nx * nx + ny * ny) || 1;
    return { x: nx / len, y: ny / len };
  });
  const left = [];
  const right = [];
  for (let i = 0; i < projected.length; i += 1) {
    const normal = normals[i] || { x: 0, y: 0 };
    const offsetX = normal.x * bufferMeters;
    const offsetY = normal.y * bufferMeters;
    left.push({ x: projected[i].x + offsetX, y: projected[i].y + offsetY });
    right.push({ x: projected[i].x - offsetX, y: projected[i].y - offsetY });
  }
  const polygon = [...left, ...right.reverse()];
  return polygon.map(unproject);
}

Page({
  data: {
    latitude: DEFAULT_CENTER.latitude,
    longitude: DEFAULT_CENTER.longitude,
    scale: DEFAULT_CENTER.scale,
    mapSubKey: getMapKeySync(),
    isWideLayout: false,
    isWeChatRuntime: RUNTIME_IS_WECHAT,
    enableSatellite: false,
    showUserLocation: true,
    addressMain: "",
    addressDetail: "",
    addressError: "",
    addressLoading: true,
    hasLocation: false,
    selectedLatitude: DEFAULT_CENTER.latitude,
    selectedLongitude: DEFAULT_CENTER.longitude,
    coordinateText: "",
    searchKeyword: "",
    searchSuggestions: [],
    searchSuggestLoading: false,
    searchSuggestError: "",
    searchPanelFocused: false,
    canConfirm: false,
    typeSections: TYPE_SECTIONS,
    selectedType: Object.assign({ category: "POINT" }, DEFAULT_TYPE),
    activeTypeSectionId: TYPE_SECTIONS[0].id,
    activeTypeOptions: TYPE_SECTIONS[0].options,
    typeMenuVisible: false,
    coordinateList: normalizeCoordinateList(),
    displayCoordinateList: normalizeCoordinateList().map((item, index) =>
      Object.assign({}, item, { _sourceIndex: index, _isPreview: false, _canDelete: false })
    ),
    activeCoordIndex: 0,
    coordAdjustStep: COORD_ADJUST_STEP,
    polyline: [],
    bufferPolygons: [],
    circles: [],
    lineBufferInput: "1",
    circleRadiusInput: "50",
    lineActionHint: "点击开始绘制进行图形绘制",
    lineRewriteIndex: null,
    coordPanelCollapsed: true,
    lineDrawingStarted: false,
    rectangleClosed: false,
    polygonClosed: false,
    markers: [],
    anchorToastVisible: false,
    circleAnchorLocked: false,
    pointActionHint: ""
  },

  applyResponsiveLayout(options = {}) {
    const metrics = getWindowMetrics(options.event);
    const wideLayout = resolveWideLayout(metrics);
    if (this.data.isWideLayout !== wideLayout) {
      this.setData({ isWideLayout: wideLayout });
    }
  },

  registerWindowResizeListener() {
    if (typeof wx === "undefined" || typeof wx.onWindowResize !== "function") {
      return;
    }
    if (this._onWindowResize) {
      return;
    }
    this._onWindowResize = (event = {}) => {
      this._lastResizeEvent = event;
      if (this._windowResizeTimer) {
        clearTimeout(this._windowResizeTimer);
      }
      this._windowResizeTimer = setTimeout(() => {
        this._windowResizeTimer = null;
        this.applyResponsiveLayout({ event: this._lastResizeEvent });
      }, WINDOW_RESIZE_DEBOUNCE_MS);
    };
    wx.onWindowResize(this._onWindowResize);
  },

  unregisterWindowResizeListener() {
    if (this._windowResizeTimer) {
      clearTimeout(this._windowResizeTimer);
      this._windowResizeTimer = null;
    }
    if (!this._onWindowResize) {
      return;
    }
    if (typeof wx !== "undefined" && typeof wx.offWindowResize === "function") {
      wx.offWindowResize(this._onWindowResize);
    }
    this._onWindowResize = null;
    this._lastResizeEvent = null;
  },

  onLoad() {
    this.mapCtx = null;
    this._ready = false;
    this._eventChannel = null;
    this._initialPayload = null;
    this._initialPayloadApplied = false;
    this._reverseTimer = null;
    this._reverseToken = 0;
    this._currentGcj = null;
    this._reverseDebounceDelay = 450;
    this._reverseMinInterval = 1200;
    this._lastReverseExecutedAt = 0;
    this._lastReverseLocationKey = "";
    this._pendingReverseLocationKey = "";
    this._suggestTimer = null;
    this._suggestDelay = 280;
    this._latestSuggestKeyword = "";
    this._pendingMoveTo = null;
    this._searchBlurTimer = null;
    this._anchorToastTimer = null;
    this._lastRegion = null;
    this._uomPlugin = null;
    this._uomPluginInitialized = false;
    this._uomPluginInitTimer = null;
    this._djiLayer = null;
    this._djiLayerInitialized = false;
    this._djiLayerInitTimer = null;
    this._temporaryNoFlyLayer = null;
    this._temporaryNoFlyLayerInitialized = false;
    this._temporaryNoFlyLayerInitTimer = null;
    this._uom2Markers = [];
    this._djiPolygons = [];
    this._djiCircles = [];
    this._nfzPolygons = [];
    this._nfzCircles = [];
    this._shapePolyline = Array.isArray(this.data.polyline) ? this.data.polyline.slice() : [];
    this._shapePolygons = Array.isArray(this.data.bufferPolygons) ? this.data.bufferPolygons.slice() : [];
    this._shapeCircles = Array.isArray(this.data.circles) ? this.data.circles.slice() : [];
    this._shapeMarkers = Array.isArray(this.data.markers) ? this.data.markers.slice() : [];
    this._mapMarkerIdMap = new Map();
    this._mapMarkerIdSeq = 100000;
    this._windowResizeTimer = null;
    this._onWindowResize = null;
    this._lastResizeEvent = null;
    this.applyResponsiveLayout({ force: true });
    this.registerWindowResizeListener();
    this.loadMapSubKey();

    if (typeof this.getOpenerEventChannel === "function") {
      const channel = this.getOpenerEventChannel();
      this._eventChannel = channel;
      if (channel && typeof channel.on === "function") {
        channel.on("initLocation", (payload) => {
          this._initialPayload = payload || null;
          if (this._ready) {
            this.applyInitialPayload(payload);
          }
        });
      }
    }

    // 页面加载尽早跳转到当前位置，后续回填的标记不会被影响
    this.requestCurrentLocation({ silent: true, initial: true });
    this.refreshDisplayCoordinateList();
  },

  isLineCategory() {
    return (this.data.selectedType?.category || this.findSectionByType(this.data.selectedType?.id)) === "LINE";
  },

  isAreaCategory() {
    return (this.data.selectedType?.category || this.findSectionByType(this.data.selectedType?.id)) === "AREA";
  },

  shouldSyncActiveCoordinate() {
    const category = this.data.selectedType?.category || this.findSectionByType(this.data.selectedType?.id);
    if (category === "POINT") return true;
    if (category === "AREA" && this.data.selectedType?.id === "AREA_CIRCLE") {
      const hasConfirmedCenter =
        this.data.circleAnchorLocked === true || this.getConfirmedLinePoints().length > 0;
      return !hasConfirmedCenter;
    }
    return false;
  },

  buildPointHint(label, typeId) {
    const resolvedLabel =
      label ||
      (typeId ? this.findTypeById(typeId)?.label : "") ||
      this.data.selectedType?.label ||
      "通用";
    const name = resolvedLabel || "通用";
    return `选好位置，点击下方“确认${name}”完成标记`;
  },

  getPreviewPoint(useMapCenterFallback = false) {
    let lat = normalizeCoord(this.data.selectedLatitude);
    let lng = normalizeCoord(this.data.selectedLongitude);
    if (useMapCenterFallback && !hasValidCoordinate(lat, lng)) {
      const fallbackLat = normalizeCoord(this.data.latitude);
      const fallbackLng = normalizeCoord(this.data.longitude);
      if (hasValidCoordinate(fallbackLat, fallbackLng)) {
        lat = fallbackLat;
        lng = fallbackLng;
      }
    }
    if (!hasValidCoordinate(lat, lng)) return null;
    return { latitude: lat, longitude: lng };
  },

  getConfirmedLinePoints() {
    const list = Array.isArray(this.data.coordinateList) ? this.data.coordinateList : [];
    return list
      .map((item = {}) => ({
        latitude: normalizeCoord(item.latitude),
        longitude: normalizeCoord(item.longitude)
      }))
      .filter((pt, idx) => {
        const original = list[idx] || {};
        const isPreview = original.isPreview === true || original.isTemp === true;
        return !isPreview && hasValidCoordinate(pt.latitude, pt.longitude);
      });
  },

  refreshDisplayCoordinateList() {
    const typeId = this.data.selectedType?.id;
    if (!this.isLineCategory()) {
      let base = normalizeCoordinateList(this.data.coordinateList);
      if (this.isAreaCategory()) {
        if (typeId === "AREA_RECTANGLE" && base.length >= 2) {
          const rectPoints = this.buildRectanglePoints(base);
          if (rectPoints.length) {
            base = rectPoints;
          }
        } else if (typeId === "AREA_CIRCLE" && base.length > 1) {
          base = [base[0]];
        }
      }
      const normalized = base.map((item, index) =>
        Object.assign({}, item, {
          _sourceIndex: this.data.coordinateList.length
            ? Math.min(index, this.data.coordinateList.length - 1)
            : 0,
          _isPreview: false,
          _canDelete: this.isAreaCategory()
            ? typeId === "AREA_POLYGON" && base.length > 1
            : base.length > 1
        })
      );
      this.setData({ displayCoordinateList: normalized });
      return;
    }
    const confirmed = normalizeLineCoordinateList(this.data.coordinateList);
    const confirmedLength = confirmed.length;
    const allowPreview = this.data.lineDrawingStarted || confirmedLength === 0;
    const preview = allowPreview ? this.getPreviewPoint(true) : null;
    const display = confirmed.map((item, index) =>
      Object.assign({}, item, {
        _sourceIndex: index,
        _isPreview: false,
        _canDelete: confirmedLength >= 1
      })
    );
    if (preview) {
      display.push({
        latitude: preview.latitude,
        longitude: preview.longitude,
        altitude: "",
        _sourceIndex: confirmedLength,
        _isPreview: true,
        _canDelete: false
      });
    }
    const safeActive =
      confirmedLength === 0 ? 0 : Math.min(Math.max(Number(this.data.activeCoordIndex || 0), 0), confirmedLength - 1);
    if (safeActive !== this.data.activeCoordIndex) {
      this.setData({ activeCoordIndex: safeActive });
    }
    this.setData({ displayCoordinateList: display });
  },

  parseBufferWidth() {
    const value = Number(this.data.lineBufferInput);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value;
  },

  parseCircleRadius() {
    const value = Number(this.data.circleRadiusInput || this.data.lineBufferInput || 0);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value;
  },

  buildRectanglePoints(start, end) {
    // Accept either two points (start/end) or an array of points, and build a bounding rectangle.
    const points = Array.isArray(start) ? start : [start, end];
    const valid = points
      .map((pt) => ({
        lat: normalizeCoord(pt?.latitude),
        lng: normalizeCoord(pt?.longitude)
      }))
      .filter((pt) => hasValidCoordinate(pt.lat, pt.lng));
    if (valid.length < 2) return [];
    const top = Math.max(...valid.map((p) => p.lat));
    const bottom = Math.min(...valid.map((p) => p.lat));
    const left = Math.min(...valid.map((p) => p.lng));
    const right = Math.max(...valid.map((p) => p.lng));
    return [
      { latitude: normalizeCoord(top), longitude: normalizeCoord(left) },
      { latitude: normalizeCoord(top), longitude: normalizeCoord(right) },
      { latitude: normalizeCoord(bottom), longitude: normalizeCoord(right) },
      { latitude: normalizeCoord(bottom), longitude: normalizeCoord(left) },
      { latitude: normalizeCoord(top), longitude: normalizeCoord(left) }
    ];
  },

  showLineHint(message) {
    if (this._lineHintTimer) {
      clearTimeout(this._lineHintTimer);
      this._lineHintTimer = null;
    }
    this.setData({ lineActionHint: message || "" });
    if (message) {
      this._lineHintTimer = setTimeout(() => {
        this.setData({ lineActionHint: "" });
      }, 1800);
    }
  },

  showAnchorToast() {
    if (this._anchorToastTimer) {
      clearTimeout(this._anchorToastTimer);
      this._anchorToastTimer = null;
    }
    this.setData({ anchorToastVisible: true });
    this._anchorToastTimer = setTimeout(() => {
      this.setData({ anchorToastVisible: false });
      this._anchorToastTimer = null;
    }, 500);
  },

  loadMapSubKey() {
    prefetchMapKey()
      .then((mapKey) => {
        const nextKey = typeof mapKey === "string" ? mapKey.trim() : "";
        if (!nextKey || nextKey === this.data.mapSubKey) return;
        this.setData({ mapSubKey: nextKey });
      })
      .catch((err) => {
        console.warn("pin picker loadMapSubKey failed", err);
      });
  },

  ensureMapMarkerId(value) {
    if (Number.isFinite(value)) return Number(value);
    const text = value === undefined || value === null ? "" : `${value}`.trim();
    if (!text) {
      this._mapMarkerIdSeq += 1;
      return this._mapMarkerIdSeq;
    }
    const numeric = Number(text);
    if (Number.isFinite(numeric)) return numeric;
    if (!this._mapMarkerIdMap) {
      this._mapMarkerIdMap = new Map();
      this._mapMarkerIdSeq = 100000;
    }
    if (this._mapMarkerIdMap.has(text)) {
      return this._mapMarkerIdMap.get(text);
    }
    this._mapMarkerIdSeq += 1;
    const mapped = this._mapMarkerIdSeq;
    this._mapMarkerIdMap.set(text, mapped);
    return mapped;
  },

  normalizeMapMarkerId(marker) {
    if (!marker || typeof marker !== "object") return marker;
    const rawId =
      marker.id !== undefined && marker.id !== null
        ? marker.id
        : marker.markerId ?? marker.markerID;
    const mappedId = this.ensureMapMarkerId(rawId);
    marker.id = mappedId;
    return marker;
  },

  normalizeMapMarkerList(list) {
    if (!Array.isArray(list)) return list;
    list.forEach((marker) => this.normalizeMapMarkerId(marker));
    return list;
  },

  composeMapPolygons(basePolygons = []) {
    const polygons = [];
    if (Array.isArray(this._djiPolygons)) polygons.push(...this._djiPolygons);
    if (Array.isArray(this._nfzPolygons)) polygons.push(...this._nfzPolygons);
    if (Array.isArray(basePolygons)) polygons.push(...basePolygons);
    return polygons;
  },

  composeMapCircles(baseCircles = []) {
    const circles = [];
    if (Array.isArray(this._djiCircles)) circles.push(...this._djiCircles);
    if (Array.isArray(this._nfzCircles)) circles.push(...this._nfzCircles);
    if (Array.isArray(baseCircles)) circles.push(...baseCircles);
    return circles;
  },

  composeMapMarkers(baseMarkers = []) {
    const markers = [];
    if (Array.isArray(this._uom2Markers)) {
      const uom2 = this._uom2Markers.slice();
      this.normalizeMapMarkerList(uom2);
      markers.push(...uom2);
    }
    if (Array.isArray(baseMarkers)) markers.push(...baseMarkers);
    return markers;
  },

  applyMapGraphics(options = {}) {
    if (Object.prototype.hasOwnProperty.call(options, "polyline")) {
      this._shapePolyline = Array.isArray(options.polyline) ? options.polyline : [];
    }
    if (Object.prototype.hasOwnProperty.call(options, "polygons")) {
      this._shapePolygons = Array.isArray(options.polygons) ? options.polygons : [];
    }
    if (Object.prototype.hasOwnProperty.call(options, "circles")) {
      this._shapeCircles = Array.isArray(options.circles) ? options.circles : [];
    }
    if (Object.prototype.hasOwnProperty.call(options, "markers")) {
      this._shapeMarkers = Array.isArray(options.markers) ? options.markers : [];
    }
    this.setData({
      polyline: Array.isArray(this._shapePolyline) ? this._shapePolyline : [],
      bufferPolygons: this.composeMapPolygons(this._shapePolygons),
      circles: this.composeMapCircles(this._shapeCircles),
      markers: this.composeMapMarkers(this._shapeMarkers)
    });
  },

  updateLineShapes(options = {}) {
    if (!this.isLineCategory()) {
      this.applyMapGraphics({
        polyline: [],
        polygons: [],
        circles: [],
        markers: []
      });
      return;
    }
    const includePreview = options.includePreview !== false;
    const confirmedPoints = this.getConfirmedLinePoints();
    const allowPreview = includePreview && (this.data.lineDrawingStarted || confirmedPoints.length === 0);
    const preview = allowPreview ? this.getPreviewPoint() : null;
    const workingPoints = confirmedPoints.slice();
    if (preview) {
      workingPoints.push(preview);
    }
    const lines = [];
    if (confirmedPoints.length >= 2) {
      lines.push({
        points: confirmedPoints,
        color: PIN_SHAPE_COLOR,
        width: 6,
        arrowLine: false,
        dottedLine: false
      });
    }
    if (confirmedPoints.length >= 1 && preview) {
      lines.push({
        points: [confirmedPoints[confirmedPoints.length - 1], preview],
        color: PIN_SHAPE_COLOR,
        width: 4,
        dottedLine: true
      });
    }
    const bufferWidth = this.parseBufferWidth();
    const polygonPoints =
      bufferWidth && workingPoints.length >= 2 ? buildLineBufferPolygon(workingPoints, bufferWidth) : [];
    const polygons = polygonPoints.length
      ? [
        {
          points: polygonPoints,
          fillColor: PIN_SHAPE_FILL,
          strokeColor: PIN_SHAPE_STROKE,
          strokeWidth: 1
        }
      ]
      : [];
    this.applyMapGraphics({
      polyline: lines,
      polygons,
      circles: [],
      markers: []
    });
  },

  updateAreaShapes(options = {}) {
    if (!this.isAreaCategory() || this.isLineCategory()) return;
    const typeId = this.data.selectedType?.id;
    const includePreview = options.includePreview !== false;
    const confirmedPoints = this.getConfirmedLinePoints();
    const confirmedLength = confirmedPoints.length;
    const rectangleClosed = typeId === "AREA_RECTANGLE" && this.data.rectangleClosed === true;
    const polygonClosed = typeId === "AREA_POLYGON" && this.data.polygonClosed === true;
    const allowPreview =
      includePreview &&
      !rectangleClosed &&
      !polygonClosed &&
      (this.data.lineDrawingStarted || confirmedLength === 0);
    const preview = allowPreview ? this.getPreviewPoint() : null;
    const working = confirmedPoints.slice();
    if (preview) {
      working.push(preview);
    }
    let polygons = [];
    let circles = [];
    let markers = [];

    const fillColor = PIN_SHAPE_FILL;
    const strokeColor = PIN_SHAPE_STROKE;
    const strokeWidth = 1;

    if (typeId === "AREA_POLYGON") {
      const pointsForPoly = working.slice();
      if (pointsForPoly.length >= 2) {
        const closed = [...pointsForPoly, pointsForPoly[0]];
        polygons = [
          {
            points: closed,
            fillColor,
            strokeColor,
            strokeWidth
          }
        ];
      }
    } else if (typeId === "AREA_RECTANGLE") {
      if (working.length === 0 && preview) {
        working.push(preview);
      }
      if (working.length === 1 && preview) {
        working.push(preview);
      }
      if (working.length >= 2) {
        const rectPoints = this.buildRectanglePoints(working);
        if (rectPoints.length) {
          polygons = [
            {
              points: rectPoints,
              fillColor,
              strokeColor,
              strokeWidth
            }
          ];
        }
      }
    } else if (typeId === "AREA_CIRCLE") {
      const center = confirmedPoints[0] || preview;
      const radius = this.parseCircleRadius();
      if (center && radius) {
        circles.push({
          latitude: center.latitude,
          longitude: center.longitude,
          color: strokeColor,
          fillColor,
          radius,
          strokeWidth
        });
      }
    }

    if (typeId === "AREA_POLYGON") {
      const markerPoints = confirmedPoints.slice();
      if (allowPreview && preview) {
        markerPoints.push(preview);
      }
      const canClose = !polygonClosed && confirmedPoints.length >= 3;
      markers = markerPoints.map((pt, idx) => {
        const marker = {
          id: `poly-${idx}`,
          latitude: pt.latitude,
          longitude: pt.longitude,
          iconPath: "/assets/dot-black.png",
          width: canClose && idx === 0 ? 36 : 12,
          height: canClose && idx === 0 ? 36 : 12,
          anchor: { x: 0.5, y: 0.5 },
          zIndex: 9
        };
        if (canClose && idx === 0) {
          marker.callout = {
            content: "点击闭合",
            color: "#111827",
            fontSize: 12,
            borderRadius: 6,
            bgColor: "#ffffff",
            padding: 6,
            display: "ALWAYS"
          };
        }
        return marker;
      });
    }

    this.applyMapGraphics({
      polyline: [],
      polygons,
      circles,
      markers
    });
  },

  onReady() {
    this.mapCtx = wx.createMapContext("pin-picker-map", this);
    this._ready = true;
    this.ensureUomPluginReady();
    this.ensureDjiLayerReady();
    this.ensureTemporaryNoFlyLayerReady();
    if (this._pendingMoveTo) {
      const { latitude, longitude } = this._pendingMoveTo;
      this.queueMapMove(latitude, longitude);
    }
    this.requestInitialLocation();
  },

  onShow() {
    this.applyResponsiveLayout({ force: true });
  },

  onResize(event = {}) {
    this.applyResponsiveLayout({ event, force: true });
  },

  onUnload() {
    this.unregisterWindowResizeListener();
    if (this._reverseTimer) {
      clearTimeout(this._reverseTimer);
      this._reverseTimer = null;
    }
    if (this._suggestTimer) {
      clearTimeout(this._suggestTimer);
      this._suggestTimer = null;
    }
    if (this._searchBlurTimer) {
      clearTimeout(this._searchBlurTimer);
      this._searchBlurTimer = null;
    }
    if (this._lineHintTimer) {
      clearTimeout(this._lineHintTimer);
      this._lineHintTimer = null;
    }
    if (this._anchorToastTimer) {
      clearTimeout(this._anchorToastTimer);
      this._anchorToastTimer = null;
    }
    if (this._uomPluginInitTimer) {
      clearTimeout(this._uomPluginInitTimer);
      this._uomPluginInitTimer = null;
    }
    if (this._djiLayerInitTimer) {
      clearTimeout(this._djiLayerInitTimer);
      this._djiLayerInitTimer = null;
    }
    if (this._temporaryNoFlyLayerInitTimer) {
      clearTimeout(this._temporaryNoFlyLayerInitTimer);
      this._temporaryNoFlyLayerInitTimer = null;
    }
    if (this._uomPlugin && typeof this._uomPlugin.destroy === "function") {
      this._uomPlugin.destroy();
    }
    if (this._djiLayer && typeof this._djiLayer.destroy === "function") {
      this._djiLayer.destroy();
    }
    if (this._temporaryNoFlyLayer && typeof this._temporaryNoFlyLayer.destroy === "function") {
      this._temporaryNoFlyLayer.destroy();
    }
    if (this._eventChannel && typeof this._eventChannel.off === "function") {
      this._eventChannel.off("initLocation");
    }
    this._eventChannel = null;
  },

  ensureUomPluginReady(retry = 0) {
    if (this._uomPlugin && this._uomPluginInitialized) return;
    const selector = this.data.isWeChatRuntime ? "#uom-plugin" : "#uom2-plugin";
    const plugin = this.selectComponent(selector);
    if (plugin && typeof plugin.init === "function") {
      plugin.init({
        mapCtx: this.mapCtx,
        center: { latitude: this.data.latitude, longitude: this.data.longitude },
        centerPin: { latitude: this.data.latitude, longitude: this.data.longitude },
        scale: normalizeMapScale(this.data.scale),
        region: this._lastRegion,
        enabled: true
      });
      this._uomPlugin = plugin;
      this._uomPluginInitialized = true;
      return;
    }
    if (retry >= 10) return;
    if (this._uomPluginInitTimer) clearTimeout(this._uomPluginInitTimer);
    const delay = retry === 0 ? 0 : Math.min(500, 80 * (retry + 1));
    this._uomPluginInitTimer = setTimeout(() => {
      this._uomPluginInitTimer = null;
      this.ensureUomPluginReady(retry + 1);
    }, delay);
  },

  ensureDjiLayerReady(retry = 0) {
    if (this._djiLayer && this._djiLayerInitialized) return;
    const layer = this.selectComponent("#dji-no-fly-layer");
    if (
      layer &&
      typeof layer.init === "function" &&
      typeof layer.updateViewport === "function"
    ) {
      this._djiLayer = layer;
      this._djiLayerInitialized = true;
      layer.init({
        enabled: true,
        center: { latitude: this.data.latitude, longitude: this.data.longitude },
        region: this._lastRegion || null,
        scale: normalizeMapScale(this.data.scale),
        drone: "",
        levels: DEFAULT_LEVELS_PARAM,
        force: true
      });
      return;
    }
    if (retry >= 10) return;
    if (this._djiLayerInitTimer) clearTimeout(this._djiLayerInitTimer);
    const delay = retry === 0 ? 0 : Math.min(500, 80 * (retry + 1));
    this._djiLayerInitTimer = setTimeout(() => {
      this._djiLayerInitTimer = null;
      this.ensureDjiLayerReady(retry + 1);
    }, delay);
  },

  ensureTemporaryNoFlyLayerReady(retry = 0) {
    if (this._temporaryNoFlyLayer && this._temporaryNoFlyLayerInitialized) return;
    const layer = this.selectComponent("#temporary-no-fly-layer");
    if (
      layer &&
      typeof layer.init === "function" &&
      typeof layer.updateViewport === "function"
    ) {
      this._temporaryNoFlyLayer = layer;
      this._temporaryNoFlyLayerInitialized = true;
      layer.init({
        enabled: true,
        center: { latitude: this.data.latitude, longitude: this.data.longitude },
        region: this._lastRegion || null,
        scale: normalizeMapScale(this.data.scale),
        force: true
      });
      return;
    }
    if (retry >= 10) return;
    if (this._temporaryNoFlyLayerInitTimer) clearTimeout(this._temporaryNoFlyLayerInitTimer);
    const delay = retry === 0 ? 0 : Math.min(500, 80 * (retry + 1));
    this._temporaryNoFlyLayerInitTimer = setTimeout(() => {
      this._temporaryNoFlyLayerInitTimer = null;
      this.ensureTemporaryNoFlyLayerReady(retry + 1);
    }, delay);
  },

  syncExternalLayerViewport(options = {}) {
    const center = options.center || { latitude: this.data.latitude, longitude: this.data.longitude };
    const scale = normalizeMapScale(options.scale || this.data.scale);
    const region = options.region || this._lastRegion || null;
    this.ensureUomPluginReady();
    this.ensureDjiLayerReady();
    this.ensureTemporaryNoFlyLayerReady();
    if (this._uomPlugin && typeof this._uomPlugin.handleRegionChange === "function") {
      this._uomPlugin.handleRegionChange({
        center,
        centerPin: center,
        scale,
        rawScale: options.rawScale,
        region,
        force: options.force === true
      });
    }
    if (this._djiLayer && typeof this._djiLayer.updateViewport === "function") {
      this._djiLayer.updateViewport({
        center,
        region,
        scale,
        force: options.force === true
      });
    }
    if (this._temporaryNoFlyLayer && typeof this._temporaryNoFlyLayer.updateViewport === "function") {
      this._temporaryNoFlyLayer.updateViewport({
        center,
        region,
        scale,
        force: options.force === true
      });
    }
  },

  onUomStatusChange() { },

  onUomTilesChanged(event = {}) {
    const detail = event?.detail || {};
    this._uom2Markers = Array.isArray(detail.markers) ? detail.markers : [];
    this.applyMapGraphics();
  },

  onDjiGraphicsChange(event = {}) {
    const detail = event?.detail || {};
    this._djiPolygons = Array.isArray(detail.polygons) ? detail.polygons : [];
    this._djiCircles = Array.isArray(detail.circles) ? detail.circles : [];
    this.applyMapGraphics();
  },

  onTemporaryNoFlyGraphicsChange(event = {}) {
    const detail = event?.detail || {};
    this._nfzPolygons = Array.isArray(detail.polygons) ? detail.polygons : [];
    this._nfzCircles = Array.isArray(detail.circles) ? detail.circles : [];
    this.applyMapGraphics();
  },

  requestInitialLocation() {
    const moved = this.applyInitialPayload(this._initialPayload);
    this._initialPayloadApplied = moved || hasSavedLocationPayload(this._initialPayload);
    if (this._initialPayloadApplied) {
      return;
    }
    // 若无保存数据，则保持默认中心，不再自动跳转当前位置
  },

  ensureLocationPermission() {
    return new Promise((resolve, reject) => {
      if (typeof wx === "undefined" || typeof wx.getSetting !== "function") {
        resolve();
        return;
      }
      wx.getSetting({
        success: (res) => {
          const granted = !!(res.authSetting && res.authSetting["scope.userLocation"]);
          if (granted) {
            resolve();
            return;
          }
          this.authorizeLocation().then(resolve).catch(reject);
        },
        fail: reject
      });
    });
  },

  authorizeLocation() {
    return new Promise((resolve, reject) => {
      if (typeof wx === "undefined") {
        resolve();
        return;
      }
      const openSetting = () => {
        if (typeof wx.openSetting !== "function") {
          reject(new Error("permission-denied"));
          return;
        }
        wx.openSetting({
          success: (st) => {
            const granted = !!(st.authSetting && st.authSetting["scope.userLocation"]);
            if (granted) {
              resolve();
            } else {
              reject(new Error("permission-denied"));
            }
          },
          fail: reject
        });
      };
      if (typeof wx.authorize !== "function") {
        openSetting();
        return;
      }
      wx.authorize({
        scope: "scope.userLocation",
        success: resolve,
        fail: openSetting
      });
    });
  },

  requestCurrentLocation(options = {}) {
    const { silent = false, initial = false } = options;
    if (!silent) {
      this.setData({ addressLoading: true, addressError: "" });
    }
    return new Promise((resolve, reject) => {
      if (typeof wx === "undefined" || typeof wx.getLocation !== "function") {
        reject(new Error("unsupported"));
        return;
      }
      wx.getLocation({
        type: "gcj02",
        success: (res) => {
          const latitude = normalizeCoord(res.latitude);
          const longitude = normalizeCoord(res.longitude);
          if (!hasValidCoordinate(latitude, longitude)) {
            reject(new Error("invalid-location"));
            return;
          }
          if (initial && this._initialPayloadApplied && hasSavedLocationPayload(this._initialPayload)) {
            resolve({ latitude, longitude, skipped: true });
            return;
          }
          this.queueMapMove(latitude, longitude);
          resolve({ latitude, longitude });
        },
        fail: reject
      });
    }).catch((err) => {
      if (!silent) {
        this.setData({ addressError: "无法获取当前位置", addressLoading: false });
      }
      console.warn("getLocation failed", err);
    });
  },

  applyInitialPayload(payload) {
    console.log("Applying initial payload:", payload);
    const data = payload || {};
    const lat = normalizeCoord(data.latitude);
    const lng = normalizeCoord(data.longitude);
    const typeId = data?.typeId;
    const sectionFromType = typeId ? this.findSectionByType(typeId) : "";
    const isLineType = sectionFromType === "LINE" || data.category === "LINE";
    const coordinateList = isLineType
      ? normalizeLineCoordinateList(data.coordinates || data.coordinateList)
      : normalizeCoordinateList(data.coordinates || data.coordinateList);
    const activeCoordIndex = isLineType
      ? (coordinateList.length
        ? Math.min(Math.max(Number(data.activeCoordIndex || 0), 0), coordinateList.length - 1)
        : 0)
      : Math.min(Math.max(Number(data.activeCoordIndex || 0), 0), coordinateList.length - 1);
    const bufferWidthInput =
      data.bufferWidth !== undefined && data.bufferWidth !== null
        ? `${data.bufferWidth}`
        : data.pathBufferWidth !== undefined && data.pathBufferWidth !== null
          ? `${data.pathBufferWidth}`
          : data.bufferWidthMeters !== undefined && data.bufferWidthMeters !== null
            ? `${data.bufferWidthMeters}`
            : this.data.lineBufferInput;
    const circleRadiusInput =
      data.radius !== undefined && data.radius !== null ? `${data.radius}` : this.data.circleRadiusInput;
    const circleHasCenter =
      typeId === "AREA_CIRCLE" &&
      coordinateList.some((item) => hasValidCoordinate(normalizeCoord(item.latitude), normalizeCoord(item.longitude)));

    this.setData({
      coordinateList,
      activeCoordIndex,
      lineBufferInput: bufferWidthInput,
      circleRadiusInput,
      lineDrawingStarted:
        sectionFromType === "AREA"
          ? typeId === "AREA_RECTANGLE"
            ? coordinateList.length >= 2
            : typeId === "AREA_POLYGON"
              ? coordinateList.length >= 3
              : typeId === "AREA_CIRCLE"
                ? coordinateList.length >= 1
                : false
          : false,
      circleAnchorLocked: circleHasCenter,
      rectangleClosed: typeId === "AREA_RECTANGLE" && coordinateList.length >= 2,
      polygonClosed: typeId === "AREA_POLYGON" && coordinateList.length >= 3,
      pointActionHint: !payload?.latitude && !payload?.longitude ? "👆请先选择标记类型" : (isLineType ? "" : this.buildPointHint(data?.typeLabel, typeId))
    });
    this.refreshDisplayCoordinateList();
    let effectiveLat = lat;
    let effectiveLng = lng;
    if (!hasValidCoordinate(effectiveLat, effectiveLng)) {
      const activeItem = coordinateList[activeCoordIndex] || {};
      effectiveLat = normalizeCoord(activeItem.latitude);
      effectiveLng = normalizeCoord(activeItem.longitude);
      if (!hasValidCoordinate(effectiveLat, effectiveLng)) {
        effectiveLat = normalizeCoord(this.data.latitude);
        effectiveLng = normalizeCoord(this.data.longitude);
      }
    }
    let moved = false;
    if (hasValidCoordinate(effectiveLat, effectiveLng)) {
      const shouldSync = this.shouldSyncActiveCoordinate();
      this.setData(
        {
          latitude: effectiveLat,
          longitude: effectiveLng,
          selectedLatitude: effectiveLat,
          selectedLongitude: effectiveLng,
          coordinateText: formatCoordinateText(effectiveLat, effectiveLng),
          hasLocation: true,
          canConfirm: true,
          addressLoading: true,
          addressError: ""
        },
        () => {
          if (this.isLineCategory()) {
            this.updateLineShapes({ includePreview: true });
          } else if (this.isAreaCategory()) {
            this.updateAreaShapes({ includePreview: true });
          }
          this.refreshDisplayCoordinateList();
        }
      );
      if (shouldSync) {
        this.updateActiveCoordinate(effectiveLat, effectiveLng);
      }
      if (this._ready) {
        this.mapCtx && this.mapCtx.moveToLocation && this.mapCtx.moveToLocation({ latitude: effectiveLat, longitude: effectiveLng });
        this.syncExternalLayerViewport({
          center: { latitude: effectiveLat, longitude: effectiveLng },
          region: this._lastRegion,
          scale: this.data.scale,
          force: true
        });
        this.reverseGeocode(effectiveLat, effectiveLng);
      } else {
        this._pendingMoveTo = { latitude: effectiveLat, longitude: effectiveLng };
      }
      moved = true;
    }
    if (typeId) {
      const next = this.findTypeById(typeId);
      if (next) {
        const sectionId = next.category || this.findSectionByType(typeId);
        this.setData({
          selectedType: next,
          activeTypeSectionId: sectionId,
          activeTypeOptions: this.getTypeOptionsBySection(sectionId)
        });
        if (next.category === "LINE") {
          this.updateLineShapes({ includePreview: true });
        } else if (next.category === "AREA") {
          this.updateAreaShapes({ includePreview: true });
        }
      }
    }
    this._initialPayloadApplied = moved || hasSavedLocationPayload(payload);
    return moved;
  },

  findTypeById(id) {
    if (!id) return null;
    for (const section of TYPE_SECTIONS) {
      for (const option of section.options) {
        if (option.id === id) {
          return { ...option, category: section.id };
        }
      }
    }
    return null;
  },

  queueMapMove(latitude, longitude) {
    if (!hasValidCoordinate(latitude, longitude)) return;
    const center = { latitude, longitude };
    if (!this._ready) {
      this._pendingMoveTo = { latitude, longitude };
      this.syncExternalLayerViewport({
        center,
        region: this._lastRegion,
        scale: this.data.scale,
        force: true
      });
      return;
    }
    const shouldSync = this.shouldSyncActiveCoordinate();
    this.setData(
      {
        latitude,
        longitude,
        selectedLatitude: latitude,
        selectedLongitude: longitude,
        hasLocation: true,
        canConfirm: true,
        coordinateText: formatCoordinateText(latitude, longitude),
        addressLoading: true,
        addressError: "",
        pointActionHint: this.isLineCategory() ? "" : this.buildPointHint(this.data.selectedType?.label, this.data.selectedType?.id)
      },
      () => {
        if (this.isLineCategory()) {
          this.updateLineShapes({ includePreview: true });
        } else if (this.isAreaCategory()) {
          this.updateAreaShapes({ includePreview: true });
        }
        this.refreshDisplayCoordinateList();
      }
    );
    if (shouldSync) {
      this.updateActiveCoordinate(latitude, longitude);
    }
    if (this.mapCtx && typeof this.mapCtx.moveToLocation === "function") {
      this.mapCtx.moveToLocation({ latitude, longitude });
    }
    this.syncExternalLayerViewport({
      center,
      region: this._lastRegion,
      scale: this.data.scale,
      force: true
    });
    this.reverseGeocode(latitude, longitude);
  },

  reverseGeocode(lat, lng) {
    if (!hasValidCoordinate(lat, lng)) return;
    if (!reverseGeocode) return;
    if (this._reverseTimer) {
      clearTimeout(this._reverseTimer);
      this._reverseTimer = null;
    }
    const now = Date.now();
    const elapsed = now - this._lastReverseExecutedAt;
    const key = `${lat},${lng}`;
    this._pendingReverseLocationKey = key;
    const schedule = () => {
      this._reverseTimer = setTimeout(() => {
        this._reverseTimer = null;
        this._lastReverseExecutedAt = Date.now();
        this._lastReverseLocationKey = key;
        const wgs = gcj02ToWgs84(lng, lat);
        const wgsLat = normalizeCoord(wgs?.lat);
        const wgsLng = normalizeCoord(wgs?.lng);
        if (!hasValidCoordinate(wgsLat, wgsLng)) {
          this.setData({ addressError: "坐标无效", addressLoading: false });
          return;
        }
        reverseGeocode(wgsLat, wgsLng)
          .then((address) => {
            if (this._pendingReverseLocationKey !== key) return;
            const main = address?.recommend || address?.formatted_addresses?.recommend || address?.address || "";
            const detail = address?.standard_address || address?.address_reference?.landmark_l1?.title || "";
            this.setData({
              addressMain: main,
              addressDetail: detail,
              addressError: "",
              addressLoading: false
            });
          })
          .catch((err) => {
            console.warn("reverseGeocode failed", err);
            if (this._pendingReverseLocationKey !== key) return;
            this.setData({ addressError: "无法解析地址", addressLoading: false });
          });
      }, this._reverseDebounceDelay);
    };
    if (elapsed >= this._reverseMinInterval) {
      schedule();
    } else {
      this._reverseTimer = setTimeout(schedule, this._reverseMinInterval - elapsed);
    }
  },

  onRegionChange(e) {
    const detail = e?.detail || {};
    const cause = e?.causedBy || detail?.causedBy || detail?.cause || "";
    if (cause && cause !== "drag" && cause !== "scale") return;
    if (e?.type !== "end") {
      if (this._uomPlugin && typeof this._uomPlugin.startFollow === "function") {
        this._uomPlugin.startFollow();
      }
      const cl = detail.centerLocation || null;
      if (cl && this._uomPlugin && typeof this._uomPlugin.handleRegionChange === "function") {
        const regionMoving = normalizeRegionDetail(detail);
        const scaleMoving = normalizeMapScale(detail.scale || this.data.scale);
        if (regionMoving) this._lastRegion = regionMoving;
        this._uomPlugin.handleRegionChange({
          center: { latitude: cl.latitude, longitude: cl.longitude },
          centerPin: { latitude: cl.latitude, longitude: cl.longitude },
          scale: scaleMoving,
          rawScale: detail.scale,
          region: regionMoving || this._lastRegion,
          force: true
        });
      }
      return;
    }
    if (!detail.centerLocation) return;
    if (this._uomPlugin && typeof this._uomPlugin.stopFollow === "function") {
      this._uomPlugin.stopFollow();
    }
    const latitude = normalizeCoord(detail.centerLocation.latitude);
    const longitude = normalizeCoord(detail.centerLocation.longitude);
    if (!hasValidCoordinate(latitude, longitude)) return;
    const rawScale = Number(detail.scale);
    const currentScale = Number(this.data.scale);
    const resolvedScale = Number.isFinite(rawScale) ? rawScale : currentScale;
    const scale = normalizeMapScale(resolvedScale);
    const region = normalizeRegionDetail(detail);
    this._lastRegion = region;
    const center = { latitude, longitude };
    const shouldSync = this.shouldSyncActiveCoordinate();
    const nextData = {
      latitude,
      longitude,
      selectedLatitude: latitude,
      selectedLongitude: longitude,
      coordinateText: formatCoordinateText(latitude, longitude),
      hasLocation: true,
      canConfirm: true,
      addressError: "",
      addressLoading: true
    };
    if (cause === "scale") {
      nextData.scale = scale;
    }
    this.setData(
      nextData,
      () => {
        if (this.isLineCategory()) {
          this.updateLineShapes({ includePreview: true });
        } else if (this.isAreaCategory()) {
          this.updateAreaShapes({ includePreview: true });
        }
        this.refreshDisplayCoordinateList();
      }
    );
    this.syncExternalLayerViewport({
      center,
      region,
      scale,
      rawScale: detail.scale
    });
    if (this._uomPlugin && typeof this._uomPlugin.scheduleFinalRefresh === "function") {
      this._uomPlugin.scheduleFinalRefresh();
    }
    if (shouldSync) {
      this.updateActiveCoordinate(latitude, longitude);
    }
    this.reverseGeocode(latitude, longitude);
  },

  onMarkerTap(e) {
    const markerId = e?.markerId || e?.detail?.markerId;
    const typeId = this.data.selectedType?.id;
    if (typeId !== "AREA_POLYGON") return;
    const points = this.getConfirmedLinePoints();
    if (markerId === "poly-0" && points.length >= 3) {
      this.setData(
        {
          polygonClosed: true,
          lineDrawingStarted: true,
          lineActionHint: "已闭合，点击完成绘制或确认锚点重画"
        },
        () => {
          this.updateAreaShapes({ includePreview: false });
          this.refreshDisplayCoordinateList();
        }
      );
    }
  },

  onLocateTap() {
    this.requestCurrentLocation({ silent: false });
  },

  onSearchInput(e) {
    const value = (e?.detail?.value || "").trim();
    this.setData({ searchKeyword: value });
    this.scheduleSuggest(value);
  },

  onSearchFocus() {
    this.setData({ searchPanelFocused: true });
    if (this.data.searchKeyword) {
      this.scheduleSuggest(this.data.searchKeyword);
    }
  },

  onSearchBlur() {
    if (this._searchBlurTimer) {
      clearTimeout(this._searchBlurTimer);
    }
    this._searchBlurTimer = setTimeout(() => {
      this.setData({ searchPanelFocused: false });
    }, 120);
  },

  onSearchConfirm() {
    if (this.data.searchSuggestions.length) return;
    if (this.data.searchKeyword) {
      this.scheduleSuggest(this.data.searchKeyword);
    }
  },

  onSearchClear() {
    this.setData({
      searchKeyword: "",
      searchSuggestions: [],
      searchSuggestError: "",
      searchSuggestLoading: false
    });
  },

  scheduleSuggest(keyword) {
    if (this._suggestTimer) {
      clearTimeout(this._suggestTimer);
      this._suggestTimer = null;
    }
    if (!keyword) {
      this.setData({ searchSuggestions: [], searchSuggestError: "" });
      return;
    }
    this._latestSuggestKeyword = keyword;
    this._suggestTimer = setTimeout(() => {
      this._suggestTimer = null;
      this.fetchSuggestions(keyword);
    }, this._suggestDelay);
  },

  fetchSuggestions(keyword) {
    this.setData({ searchSuggestLoading: true, searchSuggestError: "" });
    searchPlaces(keyword)
      .then((list) => {
        if (keyword !== this._latestSuggestKeyword) return;
        const suggestions = normalizeSuggestions(list);
        this.setData({
          searchSuggestions: suggestions,
          searchSuggestLoading: false,
          searchSuggestError: suggestions.length ? "" : "未匹配到地点"
        });
      })
      .catch((err) => {
        console.warn("searchPlaces failed", err);
        if (keyword !== this._latestSuggestKeyword) return;
        this.setData({
          searchSuggestions: [],
          searchSuggestLoading: false,
          searchSuggestError: "搜索失败，请重试"
        });
      });
  },

  onSuggestionTap(e) {
    const index = e?.currentTarget?.dataset?.index;
    const suggestion = this.data.searchSuggestions[index];
    if (!suggestion) return;
    this.setData({
      searchKeyword: suggestion.title,
      searchSuggestions: [],
      searchSuggestError: "",
      searchSuggestLoading: false
    });
    this.queueMapMove(suggestion.latitude, suggestion.longitude);
  },

  toggleTypeMenu() {
    this.setData({ typeMenuVisible: !this.data.typeMenuVisible });
  },

  closeTypeMenu() {
    this.setData({ typeMenuVisible: false });
  },

  onToggleCoordPanel() {
    const next = !this.data.coordPanelCollapsed;
    this.setData({ coordPanelCollapsed: next }, () => {
      if (!next && this.isLineCategory()) {
        this.updateLineShapes({ includePreview: true });
      } else if (!next && this.isAreaCategory()) {
        this.updateAreaShapes({ includePreview: true });
      }
    });
  },

  onTypeSectionTap(e) {
    const id = e?.currentTarget?.dataset?.sectionId;
    if (!id || id === this.data.activeTypeSectionId) return;
    this.setData({
      activeTypeSectionId: id,
      activeTypeOptions: this.getTypeOptionsBySection(id)
    });
  },

  onTypeSelect(e) {
    const typeId = e?.currentTarget?.dataset?.typeid;
    const next = this.findTypeById(typeId);
    if (!next) return;
    const preview = this.getPreviewPoint(true);
    const patch = {
      selectedType: next,
      activeTypeSectionId: next.category || this.findSectionByType(next.id),
      activeTypeOptions: this.getTypeOptionsBySection(next.category || this.findSectionByType(next.id)),
      typeMenuVisible: false,
      coordPanelCollapsed: false,
      lineDrawingStarted: next.category === "LINE" ? false : this.data.lineDrawingStarted,
      pointActionHint: next.category === "POINT" ? this.buildPointHint(next.label, next.id) : "",
      polygonClosed: next.category === "AREA" ? false : this.data.polygonClosed,
      circleAnchorLocked: next.id === "AREA_CIRCLE" ? false : this.data.circleAnchorLocked
    };
    if (next.category === "LINE") {
      patch.coordinateList = [];
      patch.activeCoordIndex = 0;
      patch.rectangleClosed = false;
      patch.polygonClosed = false;
      patch.lineActionHint = "点击开始绘制进行图形绘制";
      if (preview) {
        patch.selectedLatitude = preview.latitude;
        patch.selectedLongitude = preview.longitude;
        patch.coordinateText = formatCoordinateText(preview.latitude, preview.longitude);
        patch.hasLocation = true;
        patch.canConfirm = true;
      }
    } else {
      patch.lineRewriteIndex = null;
      patch.lineActionHint = "";
      patch.lineActionHint = "点击开始绘制进行图形绘制";
      if (next.category === "AREA") {
        patch.coordinateList = [];
        patch.activeCoordIndex = 0;
        patch.polygonClosed = false;
      }
    }
    this.setData(patch, () => {
      if (next.category === "LINE") {
        this.updateLineShapes({ includePreview: true });
      } else if (next.category === "AREA") {
        this.updateAreaShapes({ includePreview: true });
      } else {
        this.applyMapGraphics({
          polyline: [],
          polygons: [],
          circles: [],
          markers: []
        });
      }
      this.refreshDisplayCoordinateList();
    });
  },

  onLayerToggle() {
    this.setData({ enableSatellite: !this.data.enableSatellite });
  },

  noop() { },

  onStartLineDrawing() {
    if (!this.isLineCategory() && !this.isAreaCategory()) return;
    let confirmedLength = this.getConfirmedLinePoints().length;
    const typeId = this.data.selectedType?.id;

    if (this.isAreaCategory() && typeId === "AREA_RECTANGLE" && confirmedLength > 0) {
      this.setData({ coordinateList: [], activeCoordIndex: 0, lineRewriteIndex: null, rectangleClosed: false });
      confirmedLength = 0;
    }
    if (this.isAreaCategory() && typeId === "AREA_POLYGON" && confirmedLength > 0) {
      this.setData({ coordinateList: [], activeCoordIndex: 0, lineRewriteIndex: null, polygonClosed: false });
      confirmedLength = 0;
    }

    let firstHint = "选好位置，点击“确认锚点”绘制第一个点";
    let nextHint = "拖动地图选取位置，点击“确认锚点”绘制下一个点";
    if (this.isAreaCategory()) {
      if (typeId === "AREA_POLYGON") {
        firstHint = "选好位置，点击“确认锚点”放下第一个点，至少 3 个点后回到起点闭合";
        nextHint = "拖动地图，每次“确认锚点”追加一个顶点，回到起点闭合";
      } else if (typeId === "AREA_RECTANGLE") {
        firstHint = "选好位置，点击“确认锚点”放下矩形左上角";
        nextHint = "拖动地图至右下角，对准后点击“确认锚点”闭合矩形";
      } else if (typeId === "AREA_CIRCLE") {
        firstHint = "选好位置，点击“确认锚点”设置圆心，默认半径 50 米";
        nextHint = "圆心已设，可拖动微调，填写半径后点击完成绘制";
      }
    }
    const hint = confirmedLength === 0 ? firstHint : nextHint;
    const startPatch = {
      lineDrawingStarted: true,
      lineActionHint: hint,
      rectangleClosed: false
    };
    if (typeId === "AREA_CIRCLE") {
      startPatch.circleAnchorLocked = false;
    }
    this.setData(startPatch, () => {
      if (this.isLineCategory()) {
        this.updateLineShapes({ includePreview: true });
      } else if (this.isAreaCategory()) {
        this.updateAreaShapes({ includePreview: true });
      }
      this.refreshDisplayCoordinateList();
    });
  },
  onConfirm() {
    if (!this.data.canConfirm || !hasValidCoordinate(this.data.selectedLatitude, this.data.selectedLongitude)) {
      wx.showToast({ title: "请选择标记位置", icon: "none" });
      return;
    }
    if (this.data.selectedType?.id === "POINT_ELEVATION") {
      const { list, activeIndex } = this.getSafeCoordinateList();
      const altitude = list[activeIndex]?.altitude;
      const altitudeNumber = Number(altitude);
      const altitudeEmpty = altitude === "" || altitude === null || altitude === undefined;
      if (altitudeEmpty || !Number.isFinite(altitudeNumber)) {
        wx.showToast({ title: "请填写高度参数", icon: "none" });
        return;
      }
    }
    const result = {
      latitude: this.data.selectedLatitude,
      longitude: this.data.selectedLongitude,
      addressMain: this.data.addressMain,
      addressDetail: this.data.addressDetail,
      coordinateText: this.data.coordinateText,
      typeId: this.data.selectedType.id,
      typeLabel: this.data.selectedType.label,
      category: this.data.selectedType.category || this.findSectionByType(this.data.selectedType.id),
      coordinates: this.data.coordinateList,
      activeCoordIndex: this.data.activeCoordIndex
    };
    if (this._eventChannel && typeof this._eventChannel.emit === "function") {
      this._eventChannel.emit("pinSelected", result);
    }
    wx.navigateBack({ delta: 1 });
  },

  getSafeCoordinateList() {
    if (this.isLineCategory()) {
      const raw = Array.isArray(this.data.coordinateList) ? this.data.coordinateList : [];
      const list = raw
        .map((item) => normalizeCoordinateItem(item))
        .filter((item) => hasValidCoordinate(item.latitude, item.longitude));
      const activeIndex = list.length
        ? Math.min(Math.max(Number(this.data.activeCoordIndex || 0), 0), list.length - 1)
        : 0;
      if (activeIndex !== this.data.activeCoordIndex) {
        this.setData({ activeCoordIndex: activeIndex });
      }
      return { list, activeIndex };
    }
    const list = normalizeCoordinateList(this.data.coordinateList);
    const activeIndex = Math.min(Math.max(Number(this.data.activeCoordIndex || 0), 0), list.length - 1);
    if (list.length !== (this.data.coordinateList || []).length || activeIndex !== this.data.activeCoordIndex) {
      this.setData({ coordinateList: list, activeCoordIndex: activeIndex });
    }
    return { list, activeIndex };
  },

  updateActiveCoordinate(latitude, longitude) {
    if (!this.shouldSyncActiveCoordinate()) return;
    const normLat = normalizeCoord(latitude);
    const normLng = normalizeCoord(longitude);
    const { list, activeIndex } = this.getSafeCoordinateList();
    list[activeIndex] = Object.assign({}, list[activeIndex] || {}, {
      latitude: Number.isFinite(normLat) ? normLat : null,
      longitude: Number.isFinite(normLng) ? normLng : null
    });
    this.setData({ coordinateList: list, activeCoordIndex: activeIndex });
  },

  onAddCoordinate() {
    const { list } = this.getSafeCoordinateList();
    const lat = normalizeCoord(this.data.selectedLatitude);
    const lng = normalizeCoord(this.data.selectedLongitude);
    list.push({
      latitude: Number.isFinite(lat) ? lat : null,
      longitude: Number.isFinite(lng) ? lng : null,
      altitude: ""
    });
    this.setData(
      {
        coordinateList: list,
        activeCoordIndex: list.length - 1
      },
      () => {
        if (this.isLineCategory()) {
          this.updateLineShapes({ includePreview: true });
        } else if (this.isAreaCategory()) {
          this.updateAreaShapes({ includePreview: true });
        }
        this.refreshDisplayCoordinateList();
        if (this.isLineCategory() || this.isAreaCategory()) {
          this.setData({ lineDrawingStarted: true });
        }
      }
    );
  },

  onRemoveCoordinate(e) {
    const index = Number(e?.currentTarget?.dataset?.index);
    const { list } = this.getSafeCoordinateList();
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return;
    list.splice(index, 1);
    const nextActive = Math.min(this.data.activeCoordIndex, list.length - 1);
    this.setData(
      {
        coordinateList: list,
        activeCoordIndex: nextActive,
        lineRewriteIndex: this.data.lineRewriteIndex
      },
      () => {
        if (this.isLineCategory()) {
          this.updateLineShapes({ includePreview: true });
        } else if (this.isAreaCategory()) {
          this.updateAreaShapes({ includePreview: true });
        }
        this.refreshDisplayCoordinateList();
      }
    );
    const nextItem = list[nextActive] || {};
    const lat = normalizeCoord(nextItem.latitude);
    const lng = normalizeCoord(nextItem.longitude);
    if (hasValidCoordinate(lat, lng)) {
      this.queueMapMove(lat, lng);
    }
  },

  onActivateCoordinate(e) {
    const index = Number(e?.currentTarget?.dataset?.index);
    if (!Number.isInteger(index) || index < 0) return;
    if (this.isLineCategory()) {
      const confirmed = normalizeLineCoordinateList(this.data.coordinateList);
      const confirmedLength = confirmed.length;
      const safeIndex = Math.min(index, confirmedLength); // 最后一个索引可用于预览位
      const item = confirmed[safeIndex] || {};
      const lat = normalizeCoord(item.latitude);
      const lng = normalizeCoord(item.longitude);
      const nextData = {
        activeCoordIndex: safeIndex,
        lineRewriteIndex: safeIndex < confirmedLength ? safeIndex : null
      };
      if (hasValidCoordinate(lat, lng)) {
        nextData.selectedLatitude = lat;
        nextData.selectedLongitude = lng;
        nextData.coordinateText = formatCoordinateText(lat, lng);
        nextData.hasLocation = true;
        nextData.canConfirm = true;
        this.queueMapMove(lat, lng);
      } else {
        this.refreshDisplayCoordinateList();
      }
      this.setData(nextData, () => {
        if (this.isLineCategory()) {
          this.updateLineShapes({ includePreview: true });
        } else if (this.isAreaCategory()) {
          this.updateAreaShapes({ includePreview: true });
        }
        this.refreshDisplayCoordinateList();
      });
      return;
    }
    const { list } = this.getSafeCoordinateList();
    if (index >= list.length) return;
    const item = list[index] || {};
    const lat = normalizeCoord(item.latitude);
    const lng = normalizeCoord(item.longitude);
    const nextData = {
      activeCoordIndex: index,
      lineRewriteIndex: this.isLineCategory() ? index : null
    };
    if (hasValidCoordinate(lat, lng)) {
      nextData.selectedLatitude = lat;
      nextData.selectedLongitude = lng;
      nextData.coordinateText = formatCoordinateText(lat, lng);
      nextData.hasLocation = true;
      nextData.canConfirm = true;
      this.queueMapMove(lat, lng);
    }
    this.setData(nextData, () => {
      if (this.isLineCategory()) {
        this.updateLineShapes({ includePreview: true });
      }
      this.refreshDisplayCoordinateList();
    });
  },

  onCoordinateInput(e) {
    const index = Number(e?.currentTarget?.dataset?.index);
    const field = e?.currentTarget?.dataset?.field;
    const value = (e?.detail?.value || "").trim();
    const { list } = this.getSafeCoordinateList();
    if (!list[index]) return;
    if (field === "altitude") {
      list[index].altitude = normalizeAltitude(value);
      this.setData({ coordinateList: list }, () => {
        if (this.isLineCategory()) {
          this.updateLineShapes({ includePreview: true });
        } else if (this.isAreaCategory()) {
          this.updateAreaShapes({ includePreview: true });
        }
        this.refreshDisplayCoordinateList();
      });
      return;
    }
    if (field === "latitude" || field === "longitude") {
      const num = normalizeCoord(value);
      list[index][field] = Number.isFinite(num) ? num : null;
      this.setData({ coordinateList: list }, () => {
        if (this.isLineCategory()) {
          this.updateLineShapes({ includePreview: true });
        } else if (this.isAreaCategory()) {
          this.updateAreaShapes({ includePreview: true });
        }
        this.refreshDisplayCoordinateList();
      });
      if (index === this.data.activeCoordIndex) {
        const lat = field === "latitude" ? num : normalizeCoord(list[index].latitude);
        const lng = field === "longitude" ? num : normalizeCoord(list[index].longitude);
        if (hasValidCoordinate(lat, lng)) {
          this.queueMapMove(lat, lng);
        }
      }
    }
  },

  onCoordinateAdjust(e) {
    const index = Number(e?.currentTarget?.dataset?.index);
    const field = e?.currentTarget?.dataset?.field;
    const delta = Number(e?.currentTarget?.dataset?.delta || 0);
    const { list } = this.getSafeCoordinateList();
    if (!list[index]) return;
    if (field !== "latitude" && field !== "longitude") return;
    const current = Number(list[index][field] || 0);
    const next = normalizeCoord(current + delta);
    list[index] = Object.assign({}, list[index], {
      [field]: Number.isFinite(next) ? next : list[index][field]
    });
    this.setData({ coordinateList: list, activeCoordIndex: index }, () => {
      if (this.isLineCategory()) {
        this.updateLineShapes({ includePreview: true });
      } else if (this.isAreaCategory()) {
        this.updateAreaShapes({ includePreview: true });
      }
      this.refreshDisplayCoordinateList();
    });
    const lat = normalizeCoord(list[index].latitude);
    const lng = normalizeCoord(list[index].longitude);
    if (hasValidCoordinate(lat, lng)) {
      this.queueMapMove(lat, lng);
    }
  },

  onBufferInput(e) {
    const value = (e?.detail?.value || "").trim();
    this.setData({ lineBufferInput: value }, () => {
      if (this.isLineCategory()) {
        this.updateLineShapes({ includePreview: true });
      }
    });
  },

  onCircleRadiusInput(e) {
    const value = (e?.detail?.value || "").trim();
    this.setData({ circleRadiusInput: value }, () => {
      if (this.isAreaCategory()) {
        this.updateAreaShapes({ includePreview: true });
      }
    });
  },

  onConfirmAnchor() {
    if (!this.isLineCategory() && !this.isAreaCategory()) return;
    const preview = this.getPreviewPoint();
    if (!preview) {
      this.showLineHint("请选择锚点");
      return;
    }
    this.showAnchorToast();
    const typeId = this.data.selectedType?.id;
    const confirmedPoints = this.getConfirmedLinePoints();
    const list = Array.isArray(this.data.coordinateList) ? this.data.coordinateList.slice() : [];
    let nextHint = "拖动地图选取位置，点击“确认锚点”绘制下一个点";

    if (typeId === "AREA_CIRCLE") {
      const center = Object.assign({}, preview, { altitude: "" });
      this.setData(
        {
          coordinateList: [center],
          activeCoordIndex: 0,
          lineRewriteIndex: null,
          lineDrawingStarted: true,
          lineActionHint: "圆心已设置，填写半径后点击完成绘制",
          circleAnchorLocked: true,
          rectangleClosed: false,
          polygonClosed: false
        },
        () => {
          this.updateAreaShapes({ includePreview: true });
          this.refreshDisplayCoordinateList();
        }
      );
      return;
    }

    if (typeId === "AREA_RECTANGLE") {
      let nextList = [];
      let nextDrawingStarted = this.data.lineDrawingStarted;
      let rectangleClosed = this.data.rectangleClosed;
      if (rectangleClosed && confirmedPoints.length >= 2) {
        nextList = [Object.assign({}, preview, { altitude: "" })];
        nextHint = "已重置，请拖动到右下角点击“确认锚点”闭合矩形";
        nextDrawingStarted = true;
        rectangleClosed = false;
      } else if (confirmedPoints.length >= 1) {
        nextList = [Object.assign({}, confirmedPoints[0], { altitude: "" }), Object.assign({}, preview, { altitude: "" })];
        nextHint = "矩形已闭合，如需重画再次确认新的左上角";
        nextDrawingStarted = true;
        rectangleClosed = true;
      } else {
        nextList = [Object.assign({}, preview, { altitude: "" })];
        nextHint = "拖动地图到右下角位置，点击“确认锚点”闭合矩形";
        nextDrawingStarted = true;
        rectangleClosed = false;
      }
      this.setData(
        {
          coordinateList: nextList,
          activeCoordIndex: Math.max(nextList.length - 1, 0),
          lineRewriteIndex: null,
          lineDrawingStarted: nextDrawingStarted,
          rectangleClosed,
          polygonClosed: false,
          lineActionHint: nextHint
        },
        () => {
          this.updateAreaShapes({ includePreview: true });
          this.refreshDisplayCoordinateList();
        }
      );
      return;
    }

    if (typeId === "AREA_POLYGON") {
      let nextList = [];
      let polygonClosed = this.data.polygonClosed;
      let nextDrawingStarted = this.data.lineDrawingStarted;
      if (polygonClosed && confirmedPoints.length >= 3) {
        nextList = [Object.assign({}, preview, { altitude: "" })];
        nextHint = "已重置，请拖动地图选择下一个顶点";
        polygonClosed = false;
        nextDrawingStarted = true;
      } else {
        nextList = confirmedPoints.slice();
        nextList.push(Object.assign({}, preview, { altitude: "" }));
        nextHint = "拖动地图选取位置，点击“确认锚点”绘制下一个点（回到起点闭合）";
        polygonClosed = false;
        nextDrawingStarted = true;
      }
      this.setData(
        {
          coordinateList: nextList,
          activeCoordIndex: Math.max(nextList.length - 1, 0),
          lineRewriteIndex: null,
          lineDrawingStarted: nextDrawingStarted,
          polygonClosed,
          rectangleClosed: false,
          lineActionHint: nextHint
        },
        () => {
          this.updateAreaShapes({ includePreview: true });
          this.refreshDisplayCoordinateList();
        }
      );
      return;
    } const rewriteIndex =
      Number.isInteger(this.data.lineRewriteIndex) &&
        this.data.lineRewriteIndex >= 0 &&
        this.data.lineRewriteIndex < list.length
        ? this.data.lineRewriteIndex
        : null;
    const nextIndex = rewriteIndex !== null ? rewriteIndex : list.length;
    if (rewriteIndex !== null) {
      list[nextIndex] = Object.assign({}, list[nextIndex], preview);
    } else {
      list.push(Object.assign({}, preview, { altitude: "" }));
    }
    const nextActiveIndex = rewriteIndex !== null ? nextIndex : list.length; // 下一锚点默认指向新增的预览位
    if (this.isAreaCategory()) {
      if (typeId === "AREA_POLYGON") {
        nextHint = "拖动地图选取位置，点击“确认锚点”绘制下一个点（回到起点闭合）";
      }
    }
    this.setData(
      {
        coordinateList: list,
        activeCoordIndex: nextActiveIndex,
        lineRewriteIndex: null,
        lineActionHint: nextHint,
        rectangleClosed: false
      },
      () => {
        if (this.isLineCategory()) {
          this.updateLineShapes({ includePreview: true });
        } else if (this.isAreaCategory()) {
          this.updateAreaShapes({ includePreview: true });
        }
        this.refreshDisplayCoordinateList();
      }
    );
  },
  onCompleteLine() {
    if (this.isAreaCategory()) {
      const typeId = this.data.selectedType?.id;
      const points = this.getConfirmedLinePoints();
      if (typeId === "AREA_POLYGON") {
        if (points.length < 3) {
          this.showLineHint("请至少绘制三个点后再闭合");
          return;
        }
      } else if (typeId === "AREA_RECTANGLE") {
        if (points.length < 2) {
          this.showLineHint("请先确认左上角与右下角");
          return;
        }
      } else if (typeId === "AREA_CIRCLE") {
        if (!points.length) {
          this.showLineHint("请确认圆心");
          return;
        }
        const radius = this.parseCircleRadius();
        if (!radius) {
          this.showLineHint("请填写半径");
          return;
        }
      }
      let polygonPoints = points;
      if (typeId === "AREA_RECTANGLE" && points.length >= 2) {
        polygonPoints = this.buildRectanglePoints(points);
      } else if (typeId === "AREA_POLYGON" && points.length >= 3) {
        polygonPoints = [...points, points[0]];
      }
      const result = {
        coordinates: typeId === "AREA_CIRCLE" ? points : polygonPoints,
        coordinateList: typeId === "AREA_CIRCLE" ? points : polygonPoints,
        typeId: this.data.selectedType.id,
        typeLabel: this.data.selectedType.label,
        category: this.data.selectedType.category || this.findSectionByType(this.data.selectedType.id),
        polygons: typeId === "AREA_CIRCLE" ? [] : polygonPoints,
        activeCoordIndex: this.data.activeCoordIndex,
        radius: typeId === "AREA_CIRCLE" ? this.parseCircleRadius() : null
      };
      if (this._eventChannel && typeof this._eventChannel.emit === "function") {
        this._eventChannel.emit("pinSelected", result);
      }
      wx.navigateBack({ delta: 1 });
      return;
    }
    if (!this.isLineCategory()) return;
    const points = this.getConfirmedLinePoints();
    if (points.length < 2) {
      this.showLineHint("请绘制两个以上的点");
      return;
    }
    const bufferWidth = this.parseBufferWidth();
    if (!bufferWidth) {
      this.showLineHint("沿边宽度请填写完整");
      return;
    }
    const result = {
      coordinates: points,
      coordinateList: points,
      bufferWidth,
      pathBufferWidth: bufferWidth,
      bufferWidthMeters: bufferWidth,
      typeId: this.data.selectedType.id,
      typeLabel: this.data.selectedType.label,
      category: this.data.selectedType.category || this.findSectionByType(this.data.selectedType.id),
      activeCoordIndex: this.data.activeCoordIndex
    };
    if (this._eventChannel && typeof this._eventChannel.emit === "function") {
      this._eventChannel.emit("pinSelected", result);
    }
    wx.navigateBack({ delta: 1 });
  },

  findSectionByType(typeId) {
    for (const section of TYPE_SECTIONS) {
      const match = section.options.find((op) => op.id === typeId);
      if (match) return section.id;
    }
    return "";
  },

  getTypeOptionsBySection(sectionId) {
    const section = TYPE_SECTIONS.find((sec) => sec.id === sectionId);
    return section ? section.options : [];
  }
});




