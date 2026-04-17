const { getMapKeySync, prefetchMapKey, resolveMapKey } = require("../../../utils/map-key");
const { reverseGeocode } = require("../../../utils/geocoder");
const { fetchDrones } = require("../../../utils/drones");
const { haversineMeters } = require("../../../utils/coords");
const { loadCachedMapLocation } = require("../../../pages/map/utils/location");
const { shouldUseWeChatUom } = require("../../../utils/runtime");
const { buildDroneCategories, resolveDroneIndexByModel } = require("../../../pages/map/utils/drone-picker");
const { fetchReportEntries } = require("../../../utils/report-entries");
const { buildCityReportWebviewPath } = require("../../../utils/city-report");
const {
  fetchNearbyNoFlyZones,
  filterEffectiveNoFlyZones,
  buildNoFlyZoneGraphics,
  computeNoFlyZoneCenter,
  isNoFlyZoneEffective,
  expandNoFlyZoneAreas
} = require("../../../utils/no-fly-zones");
const { resolveApiBase } = require("../../../utils/profile");

const DEFAULT_CENTER = { latitude: 39.908823, longitude: 116.39747 };
const DEFAULT_LEVELS_PARAM = "2,6,1,4,3,7,8,10";
const DEFAULT_HIDDEN_SCALE = 16;
const DEFAULT_MAP_SCALE = 13;
const INIT_RETRY_LIMIT = 10;
const INIT_RETRY_BASE_DELAY = 80;
const STATUS_PENDING_TEXT = "评估中";
const POLICE_SEARCH_RADIUS = 1000;
const UOM_GUIDE_URL = "https://uom.caac.gov.cn/";
const POLICE_PLATFORM_APP_ID = "wx049b98d340ec25cd";
const NAVIGATION_LOCK_MS = 1500;
const REPORT_REGION_SUFFIXES = [
  "省",
  "市",
  "县",
  "区",
  "自治州",
  "自治市",
  "自治县",
  "特别行政区",
  "盟",
  "地区",
  "自治旗",
  "旗",
  "林区",
  "新区"
];

function hasValidCoordinate(latitude, longitude) {
  return Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude));
}

function normalizeCenter(options = {}) {
  const latitude = Number(options.lat ?? options.latitude);
  const longitude = Number(options.lng ?? options.longitude);
  if (hasValidCoordinate(latitude, longitude)) return { latitude, longitude };
  const cached = loadCachedMapLocation();
  if (cached && hasValidCoordinate(cached.latitude, cached.longitude)) {
    return { latitude: cached.latitude, longitude: cached.longitude };
  }
  return DEFAULT_CENTER;
}

function formatDistance(distanceMeters) {
  const distance = Number(distanceMeters);
  if (!Number.isFinite(distance) || distance < 0) return "";
  if (distance >= 1000) return `${(distance / 1000).toFixed(distance >= 10000 ? 0 : 1)}km`;
  return `${Math.round(distance)}m`;
}

function parsePhone(value) {
  const text = `${value || ""}`.trim();
  if (!text) return "";
  const cleaned = text.replace(/[锛?銆侊紝,]/g, "/");
  const parts = cleaned.split("/").map((item) => item.trim()).filter(Boolean);
  const candidates = parts.length ? parts : [cleaned];
  for (const item of candidates) {
    const mobile = item.match(/1[3-9]\d{9}/);
    if (mobile) return mobile[0];
    const landline = item.match(/(?:0\d{2,3}-?)?\d{7,8}/);
    if (landline) return landline[0];
  }
  return "";
}

function normalizeUnixSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (Math.abs(numeric) >= 1e12) {
    return Math.floor(numeric / 1000);
  }
  return Math.floor(numeric);
}

function padNumber(value) {
  return `${value}`.padStart(2, "0");
}

function formatPeriodDateTime(value) {
  const seconds = normalizeUnixSeconds(value);
  if (!Number.isFinite(seconds)) return "";
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}`;
}

function formatPeriodRange(from, to) {
  const fromText = formatPeriodDateTime(from);
  const toText = formatPeriodDateTime(to);
  if (fromText && toText) return `${fromText}至${toText}`;
  if (fromText) return `${fromText}起`;
  if (toText) return `截至${toText}`;
  return "";
}

function resolvePeriodRows(zone = {}, nowSeconds = normalizeUnixSeconds(Date.now())) {
  const sourcePeriods = Array.isArray(zone?.effectivePeriods) ? zone.effectivePeriods : [];
  const normalized = sourcePeriods
    .map((period) => ({
      effectiveFrom: normalizeUnixSeconds(period?.effectiveFrom),
      effectiveTo: normalizeUnixSeconds(period?.effectiveTo)
    }))
    .filter((period) => period.effectiveFrom !== null || period.effectiveTo !== null);

  const legacyFrom = normalizeUnixSeconds(zone?.effectiveFrom);
  const legacyTo = normalizeUnixSeconds(zone?.effectiveTo);
  if (legacyFrom !== null || legacyTo !== null) {
    normalized.push({ effectiveFrom: legacyFrom, effectiveTo: legacyTo });
  }

  const deduped = [];
  const seen = new Set();
  normalized.forEach((period) => {
    const key = `${period.effectiveFrom ?? ""}|${period.effectiveTo ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(period);
  });

  deduped.sort((a, b) => {
    const aFrom = a.effectiveFrom ?? Number.MAX_SAFE_INTEGER;
    const bFrom = b.effectiveFrom ?? Number.MAX_SAFE_INTEGER;
    if (aFrom !== bFrom) return aFrom - bFrom;
    return (a.effectiveTo ?? Number.MAX_SAFE_INTEGER) - (b.effectiveTo ?? Number.MAX_SAFE_INTEGER);
  });

  return deduped.map((period) => {
    const from = period.effectiveFrom;
    const to = period.effectiveTo;
    const isActive = (from === null || nowSeconds >= from) && (to === null || nowSeconds <= to);
    const isUpcoming = from !== null && nowSeconds < from;
    return {
      label: isActive ? "生效中" : isUpcoming ? "待生效" : "已失效",
      value: formatPeriodRange(from, to) || "时间待定",
      tone: isActive ? "active" : isUpcoming ? "upcoming" : "expired"
    };
  });
}

function extractAddressFromGeocode(result = {}) {
  return `${result.recommend || result.formatted_addresses?.recommend || result.address || result.formatted_address || result.title || ""}`.trim();
}

function resolveCenterAddress(center = null) {
  if (!center || !hasValidCoordinate(center.latitude, center.longitude)) {
    return Promise.resolve("");
  }
  return reverseGeocode(Number(center.latitude), Number(center.longitude))
    .then((result = {}) => extractAddressFromGeocode(result))
    .catch((err) => {
      console.warn("preflight reverse geocode failed", err);
      return "";
    });
}

function fetchNearestPoliceStation(center = {}) {
  return resolveMapKey()
    .then((mapKey) => new Promise((resolve, reject) => {
      wx.request({
        url: "https://apis.map.qq.com/ws/place/v1/search",
        method: "GET",
        data: {
          key: mapKey,
          keyword: "派出所",
          boundary: `nearby(${Number(center.latitude)},${Number(center.longitude)},${POLICE_SEARCH_RADIUS})`,
          orderby: "_distance",
          filter: "tel<>null",
          page_size: 20,
          page_index: 1
        },
        success: (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`police-poi-http-${res.statusCode}`));
            return;
          }
          const payload = res.data || {};
          if (payload.status !== 0) {
            reject(new Error(payload.message || `police-poi-${payload.status}`));
            return;
          }
          const list = Array.isArray(payload.data) ? payload.data : [];
          resolve(list[0] || null);
        },
        fail: reject
      });
    }));
}

function extractCoordinate(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    if (raw.length < 2) return null;
    const lng = Number(raw[0]);
    const lat = Number(raw[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return { lng, lat };
  }
  const lat = Number(raw.latitude ?? raw.lat);
  const lng = Number(raw.longitude ?? raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lng, lat };
}

function buildTemporaryPreviewShape(zone = {}) {
  const type = `${zone?.type || ""}`.trim().toUpperCase();
  if (type === "CIRCLE" && zone?.circle) {
    const center = extractCoordinate(zone.circle);
    const radiusMeters = Number(zone.circle.radiusMeters ?? zone.circle.radius ?? 0);
    if (!center || !Number.isFinite(radiusMeters) || radiusMeters <= 0) return null;
    return {
      type: "CIRCLE",
      circle: {
        latitude: center.lat,
        longitude: center.lng,
        radiusMeters
      }
    };
  }
  if (type === "PATH") {
    return {
      type: "PATH",
      coordinates: Array.isArray(zone.coordinates) ? zone.coordinates : [],
      pathDistanceMeters: Number(zone.pathDistanceMeters) || 0
    };
  }
  return {
    type: "POLYGON",
    coordinates: Array.isArray(zone.coordinates) ? zone.coordinates : []
  };
}

function buildTemporaryPreviewShapes(zone = {}) {
  const baseShape = buildTemporaryPreviewShape(zone);
  const extraShapes = Array.isArray(zone?.extra)
    ? zone.extra.map((item) => buildTemporaryPreviewShape(Object.assign({}, zone, item, { extra: [] }))).filter(Boolean)
    : [];
  return [baseShape].concat(extraShapes).filter(Boolean);
}

function buildMapTargets(zone = {}) {
  const shapes = buildTemporaryPreviewShapes(zone);
  const multiple = shapes.length > 1;
  return shapes
    .map((shape, index) => {
      const center = computeNoFlyZoneCenter(shape);
      if (!center) return null;
      return {
        id: `${zone?.id || zone?.name || "zone"}-${index + 1}`,
        index,
        center,
        label: multiple ? `鏌ョ湅浣嶇疆${index + 1}` : "鏌ョ湅浣嶇疆"
      };
    })
    .filter(Boolean);
}

function pointInRing(ring = [], lng, lat) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = Number(ring[i][0]);
    const yi = Number(ring[i][1]);
    const xj = Number(ring[j][0]);
    const yj = Number(ring[j][1]);
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function hitTemporaryShape(shape, center) {
  if (!shape || !center) return false;
  const latitude = Number(center.latitude);
  const longitude = Number(center.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (shape.type === "circle" && shape.center) {
    return haversineMeters(latitude, longitude, shape.center.lat, shape.center.lng) <= Number(shape.radius || 0);
  }
  if (shape.type === "polygon" && Array.isArray(shape.rings)) {
    return shape.rings.some((ring) => pointInRing(ring, longitude, latitude));
  }
  return false;
}

function findActiveTemporaryZone(zones = [], center = null) {
  if (!center || !Array.isArray(zones) || !zones.length) return null;
  const activeZones = filterEffectiveNoFlyZones(zones);
  if (!activeZones.length) return null;
  const graphics = buildNoFlyZoneGraphics(activeZones);
  const shapes = Array.isArray(graphics.shapes) ? graphics.shapes : [];
  for (const shape of shapes) {
    if (hitTemporaryShape(shape, center)) {
      return shape.zone || null;
    }
  }
  return null;
}

function buildTemporaryZoneCard(zone = {}) {
  const title = `${zone?.name || "临时禁飞区"}`.trim();
  const rawLink = typeof zone?.wechatLink === "string" ? zone.wechatLink.trim() : "";
  const validLink = /^https?:\/\/mp\.weixin\.qq\.com\//.test(rawLink) ? rawLink : "";
  return {
    id: `${zone?.id || title}`,
    title,
    wechatLink: validLink,
    canOpenArticle: !!validLink,
    periodRows: resolvePeriodRows(zone),
    mapTargets: buildMapTargets(zone)
  };
}

function resolveCanFly(uomStatus = "", djiStatus = "") {
  return `${uomStatus}`.includes("适飞") && `${djiStatus}`.includes("不在限制区");
}

function isDjiNoFlyZoneStatus(djiStatus = "") {
  return `${djiStatus || ""}`.includes("禁飞区");
}

function isPendingStatus(value = "") {
  return !value || `${value}`.includes(STATUS_PENDING_TEXT);
}

function resolveAssessmentState(data = {}) {
  if (data.activeTemporaryNoFlyZone) {
    return {
      assessmentPending: false,
      assessmentState: "no-fly",
      canFly: false
    };
  }
  const pending = isPendingStatus(data.uomStatus) || isPendingStatus(data.djiStatus);
  if (pending) {
    return {
      assessmentPending: true,
      assessmentState: "pending",
      canFly: false
    };
  }
  if (data.isDjiNoFlyZone) {
    return {
      assessmentPending: false,
      assessmentState: "no-fly",
      canFly: false
    };
  }
  return {
    assessmentPending: false,
    assessmentState: data.canFly ? "safe" : "report"
  };
}

function buildAssessmentPatch(data = {}, extra = {}) {
  const merged = Object.assign({}, data, extra);
  return resolveAssessmentFlags(merged);
}

function normalizeRegionName(value) {
  if (typeof value !== "string") return "";
  let text = value.trim().replace(/\s+/g, "");
  if (!text) return "";
  for (const suffix of REPORT_REGION_SUFFIXES) {
    if (text.endsWith(suffix)) {
      text = text.slice(0, Math.max(0, text.length - suffix.length));
      break;
    }
  }
  return text;
}

function buildReportRegionInfo(adInfo = {}) {
  const province = typeof adInfo.province === "string" ? adInfo.province.trim() : "";
  const city = typeof adInfo.city === "string" ? adInfo.city.trim() : "";
  const county = typeof adInfo.district === "string"
    ? adInfo.district.trim()
    : (typeof adInfo.county === "string" ? adInfo.county.trim() : "");
  return {
    province,
    city,
    county,
    normalized: {
      province: normalizeRegionName(province),
      city: normalizeRegionName(city),
      county: normalizeRegionName(county)
    }
  };
}

function entryMatchesReportRegion(entry = {}, region = {}) {
  const normalized = region.normalized || {};
  if (!entry || !entry.province || !normalized.province) return false;
  if (normalizeRegionName(entry.province) !== normalized.province) return false;
  if (entry.city && normalizeRegionName(entry.city) !== normalized.city) return false;
  if (entry.county && normalizeRegionName(entry.county) !== normalized.county) return false;
  return true;
}

function pickBestReportEntry(entries = [], region = {}) {
  const matched = entries.filter((entry) => entryMatchesReportRegion(entry, region));
  if (!matched.length) return null;
  const countyEntry = matched.find((entry) => normalizeRegionName(entry.county));
  if (countyEntry) return countyEntry;
  const provinceEntry = matched.find(
    (entry) => normalizeRegionName(entry.province) && !normalizeRegionName(entry.city) && !normalizeRegionName(entry.county)
  );
  if (provinceEntry) return provinceEntry;
  const cityEntry = matched.find((entry) => normalizeRegionName(entry.city));
  if (cityEntry) return cityEntry;
  return matched[0] || null;
}

function resolveReportEntryLabel(entry = {}, region = {}) {
  const fallback = region?.city || region?.province || "当地";
  if (typeof entry?.label === "string" && entry.label.trim()) return entry.label.trim();
  if (typeof entry?.county === "string" && entry.county.trim()) return `${entry.county.trim()}飞行报备`;
  if (typeof entry?.city === "string" && entry.city.trim()) return `${entry.city.trim()}飞行报备`;
  if (typeof entry?.province === "string" && entry.province.trim()) return `${entry.province.trim()}飞行报备`;
  return `${fallback}飞行报备`;
}

function resolveReportEntryDescription(entry = {}, label = "") {
  const direct = typeof entry?.description === "string" ? entry.description.trim() : "";
  if (direct) return direct;
  const summary = typeof entry?.summary === "string" ? entry.summary.trim() : "";
  if (summary) return summary;
  const content = typeof entry?.content === "string" ? entry.content.trim() : "";
  if (content) return content;
  const title = label || "当地飞行报备";
  return `${title}入口已配置，可直接进入办理。`;
}

function isGuideAvailable(guide = {}) {
  const publicAccountLink = typeof guide?.publicAccountLink === "string" ? guide.publicAccountLink.trim() : "";
  const videoAccountId = typeof guide?.videoAccountId === "string" ? guide.videoAccountId.trim() : "";
  return !!publicAccountLink || !!videoAccountId;
}

function resolveAssessmentFlags(data = {}) {
  const uomStatusText = `${data.uomStatus || ""}`;
  const djiStatusText = `${data.djiStatus || ""}`;
  const isDjiNoFlyZone = djiStatusText.includes("禁飞区");
  const baseCanFly = uomStatusText.includes("适飞") && !isDjiNoFlyZone;
  const safeChecklistComplete = !!(data.flightHeightUnder120 && data.noSpecialFlightScenario);
  const pending = !data.uomStatus || !data.djiStatus ||
    uomStatusText.includes("评估中") ||
    djiStatusText.includes("评估中");

  if (data.activeTemporaryNoFlyZone) {
    return {
      baseCanFly,
      isDjiNoFlyZone,
      safeChecklistComplete,
      showSafeChecklist: false,
      assessmentPending: false,
      assessmentState: "no-fly",
      canFly: false
    };
  }

  if (pending) {
    return {
      baseCanFly,
      isDjiNoFlyZone,
      safeChecklistComplete,
      showSafeChecklist: false,
      assessmentPending: true,
      assessmentState: "pending",
      canFly: false
    };
  }

  if (isDjiNoFlyZone) {
    return {
      baseCanFly,
      isDjiNoFlyZone,
      safeChecklistComplete,
      showSafeChecklist: false,
      assessmentPending: false,
      assessmentState: "no-fly",
      canFly: false
    };
  }

  const showSafeChecklist = baseCanFly;
  const canFly = baseCanFly && safeChecklistComplete;
  return {
    baseCanFly,
    isDjiNoFlyZone,
    safeChecklistComplete,
    showSafeChecklist,
    assessmentPending: false,
    assessmentState: canFly ? "safe" : "report",
    canFly
  };
}

Page({
  data: {
    isWideLayout: false,
    isWeChatRuntime: true,
    mapSubKey: getMapKeySync(),
    center: DEFAULT_CENTER,
    hiddenMapScale: DEFAULT_HIDDEN_SCALE,
    dronePickerVisible: false,
    dronePickerLabel: "加载中",
    droneCategories: [],
    droneCategoryItems: [],
    activeDroneCategoryIndex: 0,
    pendingDroneIndex: null,
    selectedDroneIndex: -1,
    selectedDrone: "",
    selectedDroneName: "",
    uomStatus: STATUS_PENDING_TEXT,
    uomTone: "neutral",
    uomLoading: true,
    djiStatus: STATUS_PENDING_TEXT,
    djiTone: "neutral",
    djiColor: "",
    djiStatusExtra: "",
    baseCanFly: false,
    showSafeChecklist: false,
    safeChecklistComplete: true,
    flightHeightUnder120: true,
    noSpecialFlightScenario: true,
    canFly: false,
    isDjiNoFlyZone: false,
    assessmentPending: true,
    assessmentState: "pending",
    centerAddress: "",
    policeLoading: false,
    policeStation: null,
    reportEntry: null,
    reportDialogText: "",
    activeTemporaryNoFlyZone: false,
    activeTemporaryNoFlyZoneCard: null
  },

  onLoad(options = {}) {
    const center = normalizeCenter(options);
    const systemInfo = typeof wx.getWindowInfo === "function" ? (wx.getWindowInfo() || {}) : {};
    const width = Number(systemInfo.windowWidth) || 375;
    this._selectedDroneFromQuery = `${options.drone || ""}`.trim();
    this._droneList = [];
    this._uomPlugin = null;
    this._djiLayer = null;
    this._uomPluginInitialized = false;
    this._djiLayerInitialized = false;
    this._uomPluginInitTimer = null;
    this._djiLayerInitTimer = null;
    this._statusWatchdogTimer = null;
    this._navigationLocked = false;
    this._navigationTimer = null;

    this.setData(Object.assign({
      center,
      isWeChatRuntime: shouldUseWeChatUom(),
      isWideLayout: width >= 560
    }, buildAssessmentPatch({
      uomStatus: STATUS_PENDING_TEXT,
      djiStatus: STATUS_PENDING_TEXT,
      activeTemporaryNoFlyZone: false
    })));

    prefetchMapKey().then((mapKey) => {
      if (mapKey && mapKey !== this.data.mapSubKey) this.setData({ mapSubKey: mapKey });
    });

    this.loadCenterAddress(center);
    this.loadDroneList();
    this.loadPoliceStation();
    this.loadReportEntry(center);
    this.loadTemporaryNoFlyZone(center);
  },

  onReady() {
    this.mapCtx = wx.createMapContext("preflight-hidden-map", this);
    this.initStatusEngines();
  },

  onUnload() {
    if (this._uomPluginInitTimer) clearTimeout(this._uomPluginInitTimer);
    if (this._djiLayerInitTimer) clearTimeout(this._djiLayerInitTimer);
    if (this._statusWatchdogTimer) clearTimeout(this._statusWatchdogTimer);
    if (this._navigationTimer) clearTimeout(this._navigationTimer);
    if (this._uomPlugin && typeof this._uomPlugin.destroy === "function") {
      this._uomPlugin.destroy();
    }
    if (this._djiLayer && typeof this._djiLayer.destroy === "function") {
      this._djiLayer.destroy();
    }
  },

  onOpenDronePickerTap() {
    if (!this.data.droneCategories.length) return;
    this.setData({ dronePickerVisible: true, pendingDroneIndex: this.data.selectedDroneIndex });
  },

  closeDronePicker() {
    this.setData({ dronePickerVisible: false, pendingDroneIndex: null });
  },

  onSelectDroneCategory(event = {}) {
    const index = Number(event.detail?.index);
    if (!Number.isFinite(index)) return;
    const category = this.data.droneCategories[index];
    if (!category) return;
    this.setData({
      activeDroneCategoryIndex: index,
      droneCategoryItems: category.items || []
    });
  },

  onSelectDroneOption(event = {}) {
    const index = Number(event.detail?.index);
    if (Number.isFinite(index)) this.setData({ pendingDroneIndex: index });
  },

  confirmDronePicker() {
    const index = Number(this.data.pendingDroneIndex);
    if (Number.isFinite(index) && index >= 0) this.applyDroneByIndex(index);
    this.closeDronePicker();
  },

  loadDroneList() {
    this.setData({ dronePickerLabel: "加载中" });
    fetchDrones()
      .then((list = []) => {
        this._droneList = Array.isArray(list) ? list : [];
        if (!this._droneList.length) {
          this.setData({ dronePickerLabel: "未提供" });
          return;
        }
        const categories = buildDroneCategories(this, this._droneList);
        let selectedIndex = resolveDroneIndexByModel(this, this._selectedDroneFromQuery);
        if (selectedIndex < 0) selectedIndex = 0;
        let activeCategoryIndex = categories.findIndex((category) =>
          Array.isArray(category.items) && category.items.some((item) => item.index === selectedIndex)
        );
        if (activeCategoryIndex < 0) activeCategoryIndex = 0;
        this.setData({
          droneCategories: categories,
          activeDroneCategoryIndex: activeCategoryIndex,
          droneCategoryItems: categories[activeCategoryIndex]?.items || []
        }, () => this.applyDroneByIndex(selectedIndex));
      })
      .catch((err) => {
        console.warn("preflight load drones failed", err);
        this.setData({ dronePickerLabel: "未提供" });
      });
  },

  applyDroneByIndex(index) {
    const list = Array.isArray(this._droneList) ? this._droneList : [];
    const next = list[index];
    if (!next) return;
    this.setData({
      selectedDroneIndex: index,
      pendingDroneIndex: index,
      selectedDrone: next.slug,
      selectedDroneName: next.name,
      dronePickerLabel: next.name
    }, () => {
      if (this._djiLayer && typeof this._djiLayer.updateQuery === "function") {
        this._djiLayer.updateQuery({
          drone: this.data.selectedDrone,
          levels: DEFAULT_LEVELS_PARAM,
          force: true
        });
      } else {
        this.ensureDjiLayerReady();
      }
    });
  },

  initStatusEngines() {
    this.ensureUomPluginReady();
    this.ensureDjiLayerReady();
    this.startStatusWatchdog();
  },

  ensureUomPluginReady(retry = 0) {
    if (this._uomPlugin && this._uomPluginInitialized) return;
    const selector = this.data.isWeChatRuntime ? "#uom-plugin" : "#uom2-plugin";
    const plugin = this.selectComponent(selector);
    if (plugin && typeof plugin.init === "function") {
      plugin.init({
        mapCtx: this.mapCtx,
        center: this.data.center,
        centerPin: this.data.center,
        scale: this.data.hiddenMapScale,
        region: null,
        enabled: true
      });
      if (typeof plugin.scheduleFinalRefresh === "function") {
        plugin.scheduleFinalRefresh();
      }
      this._uomPlugin = plugin;
      this._uomPluginInitialized = true;
      return;
    }
    if (retry >= INIT_RETRY_LIMIT) return;
    if (this._uomPluginInitTimer) clearTimeout(this._uomPluginInitTimer);
    const delay = retry === 0 ? 0 : Math.min(500, INIT_RETRY_BASE_DELAY * (retry + 1));
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
      typeof layer.updateViewport === "function" &&
      typeof layer.updateQuery === "function"
    ) {
      layer.init({
        enabled: true,
        center: this.data.center,
        region: null,
        scale: this.data.hiddenMapScale,
        drone: this.data.selectedDrone || "",
        levels: DEFAULT_LEVELS_PARAM,
        force: true
      });
      this._djiLayer = layer;
      this._djiLayerInitialized = true;
      return;
    }
    if (retry >= INIT_RETRY_LIMIT) return;
    if (this._djiLayerInitTimer) clearTimeout(this._djiLayerInitTimer);
    const delay = retry === 0 ? 0 : Math.min(500, INIT_RETRY_BASE_DELAY * (retry + 1));
    this._djiLayerInitTimer = setTimeout(() => {
      this._djiLayerInitTimer = null;
      this.ensureDjiLayerReady(retry + 1);
    }, delay);
  },

  startStatusWatchdog() {
    if (this._statusWatchdogTimer) clearTimeout(this._statusWatchdogTimer);
    this._statusWatchdogTimer = setTimeout(() => {
      const stillPending = isPendingStatus(this.data.uomStatus) || isPendingStatus(this.data.djiStatus);
      if (!stillPending) return;
      this._uomPluginInitialized = false;
      this._djiLayerInitialized = false;
      this.ensureUomPluginReady();
      this.ensureDjiLayerReady();
    }, 1200);
  },

  onUomStatusChange(event = {}) {
    const detail = event.detail || {};
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(detail, "uomStatus")) updates.uomStatus = detail.uomStatus;
    if (Object.prototype.hasOwnProperty.call(detail, "uomTone")) updates.uomTone = detail.uomTone;
    if (Object.prototype.hasOwnProperty.call(detail, "uomLoading")) updates.uomLoading = !!detail.uomLoading;
    if (!Object.keys(updates).length) return;
    this.setData(Object.assign(
      updates,
      buildAssessmentPatch(this.data, updates)
    ));
  },

  onDjiStatusChange(event = {}) {
    const detail = event.detail || {};
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(detail, "djiStatus")) updates.djiStatus = detail.djiStatus;
    if (Object.prototype.hasOwnProperty.call(detail, "djiTone")) updates.djiTone = detail.djiTone;
    if (Object.prototype.hasOwnProperty.call(detail, "djiColor")) updates.djiColor = detail.djiColor || "";
    if (Object.prototype.hasOwnProperty.call(detail, "djiStatusExtra")) updates.djiStatusExtra = detail.djiStatusExtra || "";
    if (!Object.keys(updates).length) return;
    this.setData(Object.assign(
      updates,
      buildAssessmentPatch(this.data, updates)
    ));
  },

  loadTemporaryNoFlyZone(center = this.data.center) {
    if (!center || !hasValidCoordinate(center.latitude, center.longitude)) {
      this.setData(Object.assign({
        activeTemporaryNoFlyZone: false,
        activeTemporaryNoFlyZoneCard: null
      }, buildAssessmentPatch(this.data, {
        activeTemporaryNoFlyZone: false
      })));
      return;
    }
    fetchNearbyNoFlyZones({
      latitude: Number(center.latitude),
      longitude: Number(center.longitude),
      radiusInKilometers: 8
    }, {
      apiBase: resolveApiBase()
    })
      .then((zones = []) => {
        const activeZone = findActiveTemporaryZone(Array.isArray(zones) ? zones : [], center);
        const activeTemporaryNoFlyZone = !!activeZone;
        const activeTemporaryNoFlyZoneCard = activeZone ? buildTemporaryZoneCard(activeZone) : null;
        this.setData(Object.assign({
          activeTemporaryNoFlyZone,
          activeTemporaryNoFlyZoneCard
        }, buildAssessmentPatch(this.data, {
          activeTemporaryNoFlyZone
        })));
      })
      .catch((err) => {
        console.warn("preflight load temporary no-fly failed", err);
        this.setData(Object.assign({
          activeTemporaryNoFlyZone: false,
          activeTemporaryNoFlyZoneCard: null
        }, buildAssessmentPatch(this.data, {
          activeTemporaryNoFlyZone: false
        })));
      });
  },

  loadReportEntry(center = this.data.center) {
    if (!center || !hasValidCoordinate(center.latitude, center.longitude)) {
      this.setData({ reportEntry: null, reportDialogText: "" });
      return;
    }
    reverseGeocode(Number(center.latitude), Number(center.longitude))
      .then((result = {}) => {
        const region = buildReportRegionInfo(result.ad_info || {});
        if (!region.province && !region.city) {
          this.setData({ reportEntry: null, reportDialogText: "" });
          return null;
        }
        return fetchReportEntries({ province: region.province }, { apiBase: resolveApiBase() })
          .then((payload = {}) => {
            const entries = Array.isArray(payload.entries) ? payload.entries : [];
            const match = pickBestReportEntry(entries, region);
            const dialogText = typeof payload.dialogText === "string" ? payload.dialogText.trim() : "";
            if (!match) {
              this.setData({ reportEntry: null, reportDialogText: dialogText });
              return;
            }
            const label = resolveReportEntryLabel(match, region);
            this.setData({
              reportDialogText: dialogText,
              reportEntry: {
                label,
                description: resolveReportEntryDescription(match, label),
                buttonText: label,
                miniProgram: match.miniProgram || null,
                guide: match.guide || null,
                showGuide: isGuideAvailable(match.guide || {})
              }
            });
          });
      })
      .catch((err) => {
        console.warn("preflight load report entry failed", err);
        this.setData({ reportEntry: null });
      });
  },

  loadPoliceStation() {
    const center = this.data.center;
    if (!hasValidCoordinate(center.latitude, center.longitude)) return;
    this.setData({ policeLoading: true });
    fetchNearestPoliceStation(center)
      .then((item) => {
        if (!item) {
          this.setData({ policeLoading: false, policeStation: null });
          return;
        }
        const latitude = Number(item.location?.lat);
        const longitude = Number(item.location?.lng);
        if (!hasValidCoordinate(latitude, longitude)) {
          this.setData({ policeLoading: false, policeStation: null });
          return;
        }
        const distance = haversineMeters(center.latitude, center.longitude, latitude, longitude);
        const phone = parsePhone(item.tel || item.phone || "");
        this.setData({
          policeLoading: false,
          policeStation: {
            title: item.title || item.address || "闄勮繎鍏畨閮ㄩ棬",
            address: item.address || "",
            latitude,
            longitude,
            distance,
            distanceText: formatDistance(distance),
            phone
          }
        });
      })
      .catch((err) => {
        console.warn("preflight load police station failed", err);
        this.setData({ policeLoading: false, policeStation: null });
      });
  },

  loadCenterAddress(center = this.data.center) {
    if (!center || !hasValidCoordinate(center.latitude, center.longitude)) {
      this.setData({ centerAddress: "" });
      return;
    }
    resolveCenterAddress(center).then((address) => {
      const currentCenter = this.data.center || {};
      if (
        Number(currentCenter.latitude) !== Number(center.latitude) ||
        Number(currentCenter.longitude) !== Number(center.longitude)
      ) {
        return;
      }
      this.setData({ centerAddress: address || "" });
    });
  },

  toggleChecklistField(field) {
    if (!this.data.showSafeChecklist) return;
    const nextValue = !this.data[field];
    const updates = { [field]: nextValue };
    this.setData(Object.assign(updates, buildAssessmentPatch(this.data, updates)));
  },

  onToggleFlightHeight() {
    this.toggleChecklistField("flightHeightUnder120");
  },

  onToggleSpecialScenario() {
    this.toggleChecklistField("noSpecialFlightScenario");
  },

  onFlightHeightTipTap() {
    wx.showToast({ title: "飞行高度说明待补充", icon: "none" });
  },

  onSpecialScenarioTipTap() {
    wx.showToast({ title: "特殊飞行场景说明待补充", icon: "none" });
  },

  onPhoneTap() {
    const phone = `${this.data.policeStation?.phone || ""}`.trim();
    if (!phone) {
      wx.showToast({ title: "暂无电话", icon: "none" });
      return;
    }
    wx.makePhoneCall({ phoneNumber: phone });
  },

  onNavigateTap() {
    const station = this.data.policeStation;
    if (!station || !hasValidCoordinate(station.latitude, station.longitude)) return;
    wx.openLocation({
      latitude: Number(station.latitude),
      longitude: Number(station.longitude),
      name: station.title || "鍏畨閮ㄩ棬",
      address: station.address || "",
      scale: 18
    });
  },

  onOpenUomGuideTap() {
    wx.navigateTo({ url: `/pages/webview/index?url=${encodeURIComponent(UOM_GUIDE_URL)}` });
  },

  onReportEntryTap() {
    const entry = this.data.reportEntry;
    const appId = entry?.miniProgram?.appId || "";
    if (!appId) {
      const text = this.data.reportDialogText || "暂无可用的本地报备入口";
      wx.showModal({ title: "飞行报备", content: text, showCancel: false });
      return;
    }
    wx.navigateToMiniProgram({
      appId,
      path: entry?.miniProgram?.path || "",
      envVersion: "release"
    });
  },

  onReportGuideTap() {
    const guide = this.data.reportEntry?.guide || {};
    const link = typeof guide.publicAccountLink === "string" ? guide.publicAccountLink.trim() : "";
    if (link) {
      const target = buildCityReportWebviewPath(link);
      if (target) {
        wx.navigateTo({ url: target });
        return;
      }
    }
    const finderUserName = typeof guide.videoAccountId === "string" ? guide.videoAccountId.trim() : "";
    const feedId = typeof guide.videoId === "string" ? guide.videoId.trim() : "";
    if (finderUserName && feedId && typeof wx.openChannelsActivity === "function") {
      wx.openChannelsActivity({ finderUserName, feedId });
      return;
    }
    if (finderUserName && typeof wx.openChannelsUserProfile === "function") {
      wx.openChannelsUserProfile({ finderUserName });
      return;
    }
    if (feedId && typeof wx.openChannelsActivity === "function") {
      wx.openChannelsActivity({ activityId: feedId });
      return;
    }
    const text = this.data.reportDialogText || "暂无更多报备说明";
    wx.showModal({ title: "飞行报备", content: text, showCancel: false });
  },

  onPolicePlatformTap() {
    if (!POLICE_PLATFORM_APP_ID || typeof wx.navigateToMiniProgram !== "function") {
      wx.showToast({ title: "暂无无法跳转", icon: "none" });
      return;
    }
    wx.navigateToMiniProgram({
      appId: POLICE_PLATFORM_APP_ID
    });
  },

  onTemporaryNoticeTitleTap() {
    const item = this.data.activeTemporaryNoFlyZoneCard;
    if (!item?.wechatLink) {
      wx.showToast({ title: "鍏紬鍙烽摼鎺ヤ笉鍙敤", icon: "none" });
      return;
    }
    if (this._navigationLocked) return;
    this.lockNavigation();
    wx.navigateTo({
      url: `/packages/city-report/h5/index?url=${encodeURIComponent(item.wechatLink)}`,
      fail: (err) => {
        console.warn("preflight temporary article navigate failed", err);
        this.releaseNavigationLock();
      }
    });
  },

  onTemporaryNoticeMapTap(event = {}) {
    const item = this.data.activeTemporaryNoFlyZoneCard;
    const targetIndex = Math.max(0, Number(event?.currentTarget?.dataset?.targetIndex) || 0);
    const mapTargets = Array.isArray(item?.mapTargets) ? item.mapTargets : [];
    const mapTarget = mapTargets[targetIndex] || mapTargets[0] || null;
    const center = mapTarget?.center || null;
    if (!center || !hasValidCoordinate(center.latitude, center.longitude)) {
      wx.showToast({ title: "禁飞区中心点不可用", icon: "none" });
      return;
    }
    if (this._navigationLocked) return;
    this.lockNavigation();
    const latitude = Number(center.latitude).toFixed(6);
    const longitude = Number(center.longitude).toFixed(6);
    const targetUrl = `/pages/map/map?cs=1&clat=${encodeURIComponent(latitude)}&clng=${encodeURIComponent(longitude)}&cscale=${DEFAULT_MAP_SCALE}`;
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const navigate = Array.isArray(pages) && pages.length >= 9 ? wx.redirectTo : wx.navigateTo;
    navigate.call(wx, {
      url: targetUrl,
      fail: (err) => {
        console.warn("preflight temporary map navigate failed", err);
        this.releaseNavigationLock();
      }
    });
  },

  lockNavigation() {
    this._navigationLocked = true;
    if (this._navigationTimer) clearTimeout(this._navigationTimer);
    this._navigationTimer = setTimeout(() => {
      this.releaseNavigationLock();
    }, NAVIGATION_LOCK_MS);
  },

  releaseNavigationLock() {
    this._navigationLocked = false;
    if (this._navigationTimer) {
      clearTimeout(this._navigationTimer);
      this._navigationTimer = null;
    }
  }
});



