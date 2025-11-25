const { reverseGeocode } = require("../../../utils/geocoder");
const { gcj02ToWgs84, wgs84ToGcj02 } = require("../../../utils/coords");
const { searchPlaces } = require("../../../utils/search");

const DEFAULT_CENTER = {
  latitude: 39.9042,
  longitude: 116.4074,
  scale: 16
};
const COORD_ADJUST_STEP = 0.00001;
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
    options: [{ id: "LINE_PATH_BUFFER", label: "临时禁飞区路径缓冲区", icon: "/assets/path.png" }]
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
    lineBufferInput: "50",
    circleRadiusInput: "100",
    lineActionHint: "",
    lineRewriteIndex: null,
    coordPanelCollapsed: true,
    lineDrawingStarted: false,
    pointActionHint: ""
  },

  onLoad() {
    this.mapCtx = null;
    this._ready = false;
    this._eventChannel = null;
    this._initialPayload = null;
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

    this.refreshDisplayCoordinateList();
  },

  isLineCategory() {
    return (this.data.selectedType?.category || this.findSectionByType(this.data.selectedType?.id)) === "LINE";
  },

  isAreaCategory() {
    return (this.data.selectedType?.category || this.findSectionByType(this.data.selectedType?.id)) === "AREA";
  },

  shouldSyncActiveCoordinate() {
    return !this.isLineCategory();
  },

  buildPointHint(label) {
    const name = label || this.data.selectedType?.label || "通用";
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
    if (!this.isLineCategory()) {
      const base = normalizeCoordinateList(this.data.coordinateList);
      const normalized = base.map((item, index) =>
        Object.assign({}, item, {
          _sourceIndex: index,
          _isPreview: false,
          _canDelete: base.length > 1
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

  updateLineShapes(options = {}) {
    if (!this.isLineCategory()) {
      this.setData({ polyline: [], bufferPolygons: [] });
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
        color: "#0f172a",
        width: 6,
        arrowLine: false,
        dottedLine: false
      });
    }
    if (confirmedPoints.length >= 1 && preview) {
      lines.push({
        points: [confirmedPoints[confirmedPoints.length - 1], preview],
        color: "#111827",
        width: 4,
        dottedLine: true
      });
    } else if (!confirmedPoints.length && preview) {
      lines.push({
        points: [preview],
        color: "#9ca3af",
        width: 2,
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
            fillColor: "#DE43294D",
            strokeColor: "#DE4329F2",
            strokeWidth: 1
          }
        ]
      : [];
    this.setData({ polyline: lines, bufferPolygons: polygons, circles: [] });
  },

  updateAreaShapes(options = {}) {
    if (!this.isAreaCategory || this.isLineCategory()) return;
    const typeId = this.data.selectedType?.id;
    const includePreview = options.includePreview !== false;
    const confirmedPoints = this.getConfirmedLinePoints();
    const confirmedLength = confirmedPoints.length;
    const allowPreview = includePreview && (this.data.lineDrawingStarted || confirmedLength === 0);
    const preview = allowPreview ? this.getPreviewPoint() : null;
    const working = confirmedPoints.slice();
    if (preview) {
      working.push(preview);
    }
    let polygons = [];
    let circles = [];

    const fillColor = "#DE43294D";
    const strokeColor = "#DE4329F2";
    const strokeWidth = 1;

    if (typeId === "AREA_POLYGON" || typeId === "AREA_RECTANGLE") {
      const pointsForPoly = working.slice();
      if (typeId === "AREA_RECTANGLE" && working.length === 2) {
        // derive rectangle from two diagonal points
        const [a, b] = working;
        const pts = [
          { latitude: a.latitude, longitude: a.longitude },
          { latitude: a.latitude, longitude: b.longitude },
          { latitude: b.latitude, longitude: b.longitude },
          { latitude: b.latitude, longitude: a.longitude }
        ];
        pointsForPoly.splice(0, pointsForPoly.length, ...pts);
      }
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
      if (confirmedLength >= 1) {
        const first = confirmedPoints[0];
        circles.push({
          latitude: first.latitude,
          longitude: first.longitude,
          color: strokeColor,
          fillColor: "#DE432933",
          radius: 20,
          strokeWidth: 2
        });
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

    this.setData({ bufferPolygons: polygons, circles });
  },

  onReady() {
    this.mapCtx = wx.createMapContext("pin-picker-map", this);
    this._ready = true;
    if (this._pendingMoveTo) {
      const { latitude, longitude } = this._pendingMoveTo;
      this.queueMapMove(latitude, longitude);
    }
    this.requestInitialLocation();
  },

  onUnload() {
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
    if (this._eventChannel && typeof this._eventChannel.off === "function") {
      this._eventChannel.off("initLocation");
    }
    this._eventChannel = null;
  },

  requestInitialLocation() {
    const moved = this.applyInitialPayload(this._initialPayload);
    if (moved || hasSavedLocationPayload(this._initialPayload)) {
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
    const { silent = false } = options;
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
    const data = payload || {};
    const lat = normalizeCoord(data.latitude);
    const lng = normalizeCoord(data.longitude);
    const typeId = data.typeId || data.type;
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
        : this.data.lineBufferInput;
    this.setData({
      coordinateList,
      activeCoordIndex,
      lineBufferInput: bufferWidthInput,
      lineDrawingStarted: false,
      pointActionHint: isLineType ? "" : this.buildPointHint(this.data.selectedType?.label)
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
    if (!this._ready) {
      this._pendingMoveTo = { latitude, longitude };
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
          pointActionHint: this.isLineCategory() ? "" : this.buildPointHint(this.data.selectedType?.label)
        },
        () => {
          if (this.isLineCategory()) {
            this.updateLineShapes({ includePreview: true });
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
    if (e && e.type === "end" && e.detail && e.detail.centerLocation) {
      const latitude = normalizeCoord(e.detail.centerLocation.latitude);
      const longitude = normalizeCoord(e.detail.centerLocation.longitude);
      if (!hasValidCoordinate(latitude, longitude)) return;
      const shouldSync = this.shouldSyncActiveCoordinate();
      this.setData(
        {
          selectedLatitude: latitude,
          selectedLongitude: longitude,
          coordinateText: formatCoordinateText(latitude, longitude),
          hasLocation: true,
          canConfirm: true,
          addressError: "",
          addressLoading: true
        },
        () => {
          if (this.isLineCategory()) {
            this.updateLineShapes({ includePreview: true });
          }
          this.refreshDisplayCoordinateList();
        }
      );
      if (shouldSync) {
        this.updateActiveCoordinate(latitude, longitude);
      }
      this.reverseGeocode(latitude, longitude);
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
      pointActionHint: next.category === "POINT" ? this.buildPointHint(next.label) : ""
    };
    if (next.category === "LINE") {
      patch.coordinateList = [];
      patch.activeCoordIndex = 0;
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
      patch.polyline = [];
      patch.bufferPolygons = [];
      patch.circles = [];
      if (next.category === "AREA") {
        patch.coordinateList = [];
        patch.activeCoordIndex = 0;
      }
    }
    this.setData(patch, () => {
      if (next.category === "LINE") {
        this.updateLineShapes({ includePreview: true });
      } else if (next.category === "AREA") {
        this.updateAreaShapes({ includePreview: true });
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
    const confirmedLength = this.getConfirmedLinePoints().length;
    const typeId = this.data.selectedType?.id;
    let firstHint = "选好位置，点击“确认锚点”绘制第一个点";
    let nextHint = "拖动地图选取位置，点击“确认锚点”绘制下一个点";
    if (this.isAreaCategory()) {
      if (typeId === "AREA_POLYGON") {
        firstHint = "选好位置，点击“确认锚点”放下第一个点，至少 3 个点后回到起点闭合";
        nextHint = "拖动地图选取位置，点击“确认锚点”绘制下一个点（回到起点闭合）";
      } else if (typeId === "AREA_RECTANGLE") {
        firstHint = "选好位置，点击“确认锚点”放下第一个角点";
        nextHint = "拖动地图，依次确认矩形四个角点，完成后闭合";
      } else if (typeId === "AREA_CIRCLE") {
        firstHint = "选好位置，点击“确认锚点”设置圆心，再填写半径后完成";
        nextHint = "拖动地图微调圆心，填写半径后点击完成绘制";
      }
    }
    const hint = confirmedLength === 0 ? firstHint : nextHint;
    this.setData({ lineDrawingStarted: true, lineActionHint: hint }, () => {
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
    const wgs = gcj02ToWgs84(this.data.selectedLongitude, this.data.selectedLatitude);
    const wgsLat = normalizeCoord(wgs?.lat);
    const wgsLng = normalizeCoord(wgs?.lng);
    const result = {
      latitude: this.data.selectedLatitude,
      longitude: this.data.selectedLongitude,
      wgs84: hasValidCoordinate(wgsLat, wgsLng) ? { latitude: wgsLat, longitude: wgsLng } : null,
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
    const list = Array.isArray(this.data.coordinateList) ? this.data.coordinateList.slice() : [];
    const rewriteIndex =
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
    const typeId = this.data.selectedType?.id;
    let nextHint = "拖动地图选取位置，点击“确认锚点”绘制下一个点";
    if (this.isAreaCategory()) {
      if (typeId === "AREA_POLYGON") {
        nextHint = "拖动地图选取位置，点击“确认锚点”绘制下一个点（回到起点闭合）";
      } else if (typeId === "AREA_RECTANGLE") {
        nextHint = "继续确认矩形剩余角点，完成后闭合";
      } else if (typeId === "AREA_CIRCLE") {
        nextHint = "可拖动地图微调圆心，填写半径后完成绘制";
      }
    }
    this.setData(
      {
        coordinateList: list,
        activeCoordIndex: nextActiveIndex,
        lineRewriteIndex: null,
        lineActionHint: nextHint
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
        if (points.length < 4) {
          this.showLineHint("请绘制四个角点后再闭合");
          return;
        }
      } else if (typeId === "AREA_CIRCLE") {
        if (!points.length) {
          this.showLineHint("请确认圆心");
          return;
        }
        const radius = this.parseCircleRadius();
        if (!radius) {
          this.showLineHint("请输入有效的半径");
          return;
        }
      }
      const polygonPoints =
        typeId === "AREA_RECTANGLE" && points.length === 4
          ? [...points, points[0]]
          : typeId === "AREA_POLYGON" && points.length >= 3
          ? [...points, points[0]]
          : points;
      const result = {
        coordinates: points,
        coordinateList: points,
        typeId: this.data.selectedType.id,
        typeLabel: this.data.selectedType.label,
        category: this.data.selectedType.category || this.findSectionByType(this.data.selectedType.id),
        polygons: polygonPoints,
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
      this.showLineHint("请输入缓冲带宽度");
      return;
    }
    const wgs84Coordinates = points
      .map((pt) => {
        const wgs = gcj02ToWgs84(pt.longitude, pt.latitude);
        const lat = normalizeCoord(wgs?.lat);
        const lng = normalizeCoord(wgs?.lng);
        if (!hasValidCoordinate(lat, lng)) return null;
        return { latitude: lat, longitude: lng };
      })
      .filter(Boolean);
    const result = {
      coordinates: points,
      coordinateList: points,
      wgs84Coordinates,
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
