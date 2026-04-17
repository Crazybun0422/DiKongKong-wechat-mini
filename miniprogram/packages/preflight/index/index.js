const { getMapKeySync, prefetchMapKey, resolveMapKey } = require("../../../utils/map-key");
const { reverseGeocode } = require("../../../utils/geocoder");
const { fetchDrones } = require("../../../utils/drones");
const { haversineMeters } = require("../../../utils/coords");
const { loadCachedMapLocation } = require("../../../pages/map/utils/location");
const { shouldUseWeChatUom } = require("../../../utils/runtime");
const { buildDroneCategories, resolveDroneIndexByModel } = require("../../../pages/map/utils/drone-picker");
const { fetchReportEntries } = require("../../../utils/report-entries");
const { buildPreflightRichTextUrl } = require("../../../utils/preflight-config");
const {
  QUALIFICATION_MODE_ENTERTAINMENT,
  QUALIFICATION_MODE_COMMERCIAL,
  QUALIFICATION_LEVEL_REQUIRED,
  buildQualificationAssessment,
  resolveAircraftClassFromStaticModel
} = require("../../../utils/preflight-qualification");
const {
  fetchWeatherCalendarBundle,
  loadWeatherCalendarSnapshot,
  saveWeatherCalendarSnapshot,
  snapshotMatches,
  resolveWeatherIconPath
} = require("../../../utils/weather");
const { buildPreflightWeatherAssessment } = require("../../../utils/preflight-weather");
const {
  USER_CREDENTIAL_TYPES,
  USER_CREDENTIAL_META,
  fetchUserCredentials,
  uploadUserCredential,
  downloadUserCredentialFile,
  deleteUserCredential,
  inferFileKind
} = require("../../../utils/user-credentials");
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

const QUALIFICATION_CARD_ITEMS = [
  USER_CREDENTIAL_TYPES.THEORY,
  USER_CREDENTIAL_TYPES.CAAC,
  USER_CREDENTIAL_TYPES.OPERATION,
  USER_CREDENTIAL_TYPES.INSURANCE
];
const WEATHER_DAY_GRID_SIZE = 14;
const WEATHER_HANDLE_WIDTH = 30;

function pad2(value) {
  return `${Number(value) || 0}`.padStart(2, "0");
}

function formatPreflightDayLabel(day = {}, index = 0) {
  const relativeDay = Number(day?.relativeDay);
  if (relativeDay === -1) return "昨天";
  if (relativeDay === 0) return "今天";
  if (relativeDay === 1) return "明天";
  if (relativeDay === 2) return "后天";
  return `${day?.weekdayLabel || `第${index + 1}天`}`.trim();
}

function buildWeatherIntelDays(snapshot = null) {
  const days = Array.isArray(snapshot?.days) ? snapshot.days : [];
  return days.slice(0, WEATHER_DAY_GRID_SIZE).map((day, index) => ({
    key: day.dateKey || `day-${index}`,
    dateKey: day.dateKey || "",
    tabLabel: formatPreflightDayLabel(day, index),
    dateLabel: day.dateLabel || "",
    relativeDay: Number(day.relativeDay)
  }));
}

function resolveWeatherIntelDefaultDay(snapshot = null) {
  const days = Array.isArray(snapshot?.days) ? snapshot.days : [];
  return days.find((item) => Number(item?.relativeDay) === 0) || days[0] || null;
}

function findWeatherSlot(snapshot = null, dateKey = "", hour = 0) {
  const days = Array.isArray(snapshot?.days) ? snapshot.days : [];
  const day = days.find((item) => item?.dateKey === dateKey) || null;
  if (!day) return null;
  const rows = Array.isArray(day.rows) ? day.rows : [];
  const targetTimeKey = `${pad2(hour)}:00`;
  return rows.find((item) => item?.timeKey === targetTimeKey) || rows[0] || null;
}

function buildWeatherHandleStyle(hour = 0) {
  const bounded = Math.max(0, Math.min(23, Number(hour) || 0));
  const percent = (bounded / 23) * 100;
  return `left: calc(${percent.toFixed(4)}% - ${WEATHER_HANDLE_WIDTH / 2}px);`;
}

function clampWeatherHour(value) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(23, numeric));
}

function buildWeatherIntelPatch(snapshot = null, options = {}) {
  const fallbackHour = new Date().getHours();
  const selectedHour = Math.max(0, Math.min(23, Number(options.selectedHour)));
  const days = buildWeatherIntelDays(snapshot);
  const defaultDay = resolveWeatherIntelDefaultDay(snapshot);
  const selectedDateKey = `${options.selectedDateKey || defaultDay?.dateKey || ""}`.trim();
  const selectedSlot = findWeatherSlot(snapshot, selectedDateKey, Number.isFinite(selectedHour) ? selectedHour : fallbackHour);
  const actualHour = Number.isFinite(Number(selectedSlot?.hour))
    ? Number(selectedSlot.hour)
    : (Number.isFinite(selectedHour) ? selectedHour : fallbackHour);
  const aircraftClass = resolveAircraftClassFromStaticModel({
    slug: options.droneSlug,
    name: options.droneName
  });
  const assessment = buildPreflightWeatherAssessment(selectedSlot || {}, aircraftClass);
  return {
    weatherIntelDays: days.map((item) => Object.assign({}, item, {
      active: item.dateKey === selectedDateKey
    })),
    weatherIntelSelectedDateKey: selectedDateKey,
    weatherIntelSelectedHour: actualHour,
    weatherIntelSelectedSlot: selectedSlot ? Object.assign({}, selectedSlot, {
      iconPath: resolveWeatherIconPath(selectedSlot.iconName, false)
    }) : null,
    weatherIntelAssessmentLevel: assessment.level,
    weatherIntelAssessmentTitle: assessment.title,
    weatherIntelAssessmentReason: assessment.reason,
    weatherIntelAssessmentReasons: assessment.reasons || [],
    weatherIntelHandleStyle: buildWeatherHandleStyle(actualHour)
  };
}

function buildQualificationCardItems(credentials = {}) {
  const assessment = buildQualificationAssessment({
    mode: credentials.__mode,
    droneSlug: credentials.__droneSlug,
    droneName: credentials.__droneName,
    credentials
  });
  return QUALIFICATION_CARD_ITEMS.map((type) => {
    const meta = USER_CREDENTIAL_META[type] || {};
    const item = credentials[type] || {};
    const policy = assessment.items?.[type] || {};
    return {
      type,
      title: meta.title || item.title || "",
      requirementText: policy.requirementLabel || "无需",
      requirementDetail: policy.requirementDetail || "",
      requirementClass:
        policy.requirementLevel === QUALIFICATION_LEVEL_REQUIRED
          ? "is-required"
          : (policy.requirementLabel === "建议" ? "is-suggested" : "is-none"),
      statusText: item.bound ? "已绑定" : "未绑定",
      statusClass: item.bound ? "is-bound" : "is-unbound"
    };
  });
}

function buildQualificationState(mode = QUALIFICATION_MODE_ENTERTAINMENT, credentials = {}, drone = {}) {
  const decoratedCredentials = Object.assign({}, credentials, {
    __mode: mode,
    __droneSlug: drone.slug || "",
    __droneName: drone.name || ""
  });
  const assessment = buildQualificationAssessment({
    mode,
    droneSlug: drone.slug || "",
    droneName: drone.name || "",
    credentials
  });
  return {
    qualificationMode: mode,
    qualificationPassed: assessment.passed,
    qualificationAircraftClass: assessment.aircraftClassLabel,
    qualificationPurposeLabel: assessment.purposeLabel,
    qualificationCardItems: buildQualificationCardItems(decoratedCredentials)
  };
}

function createEmptyCredentialState() {
  const map = {};
  Object.keys(USER_CREDENTIAL_META).forEach((type) => {
    map[type] = {
      type,
      key: USER_CREDENTIAL_META[type].key,
      title: USER_CREDENTIAL_META[type].title,
      fullTitle: USER_CREDENTIAL_META[type].fullTitle,
      guideTitle: USER_CREDENTIAL_META[type].guideTitle,
      guideSubtitle: USER_CREDENTIAL_META[type].guideSubtitle,
      uploadLabel: USER_CREDENTIAL_META[type].uploadLabel,
      richTextKey: USER_CREDENTIAL_META[type].richTextKey,
      bound: false,
      objectName: "",
      location: "",
      fileName: "",
      originalFilename: "",
      fileKind: "unknown",
      publicUrl: ""
    };
  });
  return map;
}

function buildCredentialDialogState(item = {}, mode = "empty", extra = {}) {
  const fileKind = item?.fileKind || "unknown";
  return Object.assign({
    credentialDialogVisible: true,
    credentialDialogMode: mode,
    activeCredentialType: item?.type || "",
    activeCredentialTitle: item?.fullTitle || item?.title || "",
    activeCredentialGuideTitle: item?.guideTitle || "",
    activeCredentialGuideSubtitle: item?.guideSubtitle || "",
    activeCredentialRichTextKey: item?.richTextKey || "",
    activeCredentialUploadLabel: item?.uploadLabel || "上传文件",
    activeCredentialBound: !!item?.bound,
    activeCredentialFileName: item?.fileName || "",
    activeCredentialFileKind: fileKind,
    activeCredentialPreviewUrl: "",
    activeCredentialPdfPath: "",
    activeCredentialUploading: false,
    credentialPendingFilePath: "",
    credentialPendingFileName: "",
    credentialPendingFileKind: "unknown",
    credentialPendingPreviewUrl: ""
  }, extra);
}

function buildQualificationDroneSnapshot(data = {}) {
  return {
    slug: `${data?.selectedDrone || ""}`.trim(),
    name: `${data?.selectedDroneName || ""}`.trim()
  };
}

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
  const cleaned = text.replace(/[、，,；;]/g, "/");
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
        label: multiple ? `查看位置${index + 1}` : "查看位置"
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
    activeTemporaryNoFlyZoneCard: null,
    qualificationMode: QUALIFICATION_MODE_ENTERTAINMENT,
    qualificationPassed: false,
    qualificationAircraftClass: "",
    qualificationPurposeLabel: "",
    qualificationCardItems: buildQualificationCardItems(createEmptyCredentialState()),
    weatherIntelLoading: true,
    weatherIntelError: "",
    weatherIntelUpdatedAtText: "",
    weatherIntelDays: [],
    weatherIntelSelectedDateKey: "",
    weatherIntelSelectedHour: new Date().getHours(),
    weatherIntelSelectedSlot: null,
    weatherIntelAssessmentLevel: "caution",
    weatherIntelAssessmentTitle: "谨慎飞行",
    weatherIntelAssessmentReason: "气象数据加载中",
    weatherIntelAssessmentReasons: [],
    weatherIntelHandleStyle: buildWeatherHandleStyle(new Date().getHours()),
    qualificationCredentials: createEmptyCredentialState(),
    credentialDialogVisible: false,
    credentialDialogMode: "empty",
    activeCredentialType: "",
    activeCredentialTitle: "",
    activeCredentialGuideTitle: "",
    activeCredentialGuideSubtitle: "",
    activeCredentialRichTextKey: "",
    activeCredentialUploadLabel: "上传文件",
    activeCredentialBound: false,
    activeCredentialFileName: "",
    activeCredentialFileKind: "unknown",
    activeCredentialPreviewUrl: "",
    activeCredentialPdfPath: "",
    activeCredentialUploading: false,
    credentialPendingFilePath: "",
    credentialPendingFileName: "",
    credentialPendingFileKind: "unknown",
    credentialPendingPreviewUrl: ""
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
    this.loadQualificationCredentials();
    this.loadWeatherIntel(center);
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

  noop() {},

  refreshQualificationState(nextMode = this.data.qualificationMode, nextCredentials = this.data.qualificationCredentials) {
    const drone = buildQualificationDroneSnapshot(this.data);
    this.setData(buildQualificationState(nextMode, nextCredentials || createEmptyCredentialState(), drone));
  },

  refreshWeatherIntelSelection(snapshot = this._weatherCalendarSnapshot) {
    if (!snapshot) return;
    const drone = buildQualificationDroneSnapshot(this.data);
    this.setData(buildWeatherIntelPatch(snapshot, {
      selectedDateKey: this.data.weatherIntelSelectedDateKey,
      selectedHour: this.data.weatherIntelSelectedHour,
      droneSlug: drone.slug,
      droneName: drone.name
    }));
  },

  measureWeatherIntelSlider() {
    return new Promise((resolve) => {
      const query = this.createSelectorQuery();
      query.select(".preflight-weather-intel__slider-shell").boundingClientRect((rect) => {
        this._weatherIntelSliderRect = rect && Number.isFinite(rect.width) ? rect : null;
        resolve(this._weatherIntelSliderRect);
      }).exec();
    });
  },

  updateWeatherIntelHourByClientX(clientX, commit = false) {
    const rect = this._weatherIntelSliderRect;
    if (!rect || !Number.isFinite(Number(clientX)) || !Number.isFinite(rect.left) || !Number.isFinite(rect.width) || rect.width <= 0) {
      return;
    }
    const ratio = Math.max(0, Math.min(1, (Number(clientX) - rect.left) / rect.width));
    const hour = clampWeatherHour(ratio * 23);
    if (commit && this._weatherCalendarSnapshot) {
      const drone = buildQualificationDroneSnapshot(this.data);
      this.setData(buildWeatherIntelPatch(this._weatherCalendarSnapshot, {
        selectedDateKey: this.data.weatherIntelSelectedDateKey,
        selectedHour: hour,
        droneSlug: drone.slug,
        droneName: drone.name
      }));
      return;
    }
    this.setData({
      weatherIntelSelectedHour: hour,
      weatherIntelHandleStyle: buildWeatherHandleStyle(hour)
    });
  },

  onWeatherIntelHandleTouchStart(event = {}) {
    const touch = event?.touches?.[0] || event?.changedTouches?.[0] || null;
    if (!touch) return;
    this.measureWeatherIntelSlider().then(() => {
      this.updateWeatherIntelHourByClientX(touch.clientX, false);
    });
  },

  onWeatherIntelHandleTouchMove(event = {}) {
    const touch = event?.touches?.[0] || event?.changedTouches?.[0] || null;
    if (!touch) return;
    if (!this._weatherIntelSliderRect) {
      this.measureWeatherIntelSlider().then(() => {
        this.updateWeatherIntelHourByClientX(touch.clientX, false);
      });
      return;
    }
    this.updateWeatherIntelHourByClientX(touch.clientX, false);
  },

  onWeatherIntelHandleTouchEnd(event = {}) {
    const touch = event?.changedTouches?.[0] || event?.touches?.[0] || null;
    if (!touch) return;
    if (!this._weatherIntelSliderRect) {
      this.measureWeatherIntelSlider().then(() => {
        this.updateWeatherIntelHourByClientX(touch.clientX, true);
      });
      return;
    }
    this.updateWeatherIntelHourByClientX(touch.clientX, true);
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
      this.refreshQualificationState();
      this.refreshWeatherIntelSelection();
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

  loadWeatherIntel(center = this.data.center) {
    if (!center || !hasValidCoordinate(center.latitude, center.longitude)) {
      this._weatherCalendarSnapshot = null;
      this.setData({
        weatherIntelLoading: false,
        weatherIntelError: "中心点不可用",
        weatherIntelUpdatedAtText: "",
        weatherIntelDays: [],
        weatherIntelSelectedDateKey: "",
        weatherIntelSelectedSlot: null
      });
      return;
    }
    const cached = loadWeatherCalendarSnapshot();
    if (cached && snapshotMatches(cached, center)) {
      this._weatherCalendarSnapshot = cached;
      this.setData(Object.assign({
        weatherIntelLoading: false,
        weatherIntelError: "",
        weatherIntelUpdatedAtText: `${cached.updatedAtText || ""}`.replace(/^更新于/, "")
      }, buildWeatherIntelPatch(cached, {
        selectedDateKey: this.data.weatherIntelSelectedDateKey,
        selectedHour: this.data.weatherIntelSelectedHour,
        droneSlug: this.data.selectedDrone,
        droneName: this.data.selectedDroneName
      })));
    } else {
      this.setData({ weatherIntelLoading: true, weatherIntelError: "" });
    }

    fetchWeatherCalendarBundle(center)
      .then((snapshot) => {
        this._weatherCalendarSnapshot = saveWeatherCalendarSnapshot(snapshot);
        this.setData(Object.assign({
          weatherIntelLoading: false,
          weatherIntelError: "",
          weatherIntelUpdatedAtText: `${snapshot?.updatedAtText || ""}`.replace(/^更新于/, "")
        }, buildWeatherIntelPatch(this._weatherCalendarSnapshot, {
          selectedDateKey: this.data.weatherIntelSelectedDateKey,
          selectedHour: this.data.weatherIntelSelectedHour,
          droneSlug: this.data.selectedDrone,
          droneName: this.data.selectedDroneName
        })));
      })
      .catch((err) => {
        console.warn("preflight load weather intel failed", err);
        if (this._weatherCalendarSnapshot) {
          this.setData({ weatherIntelLoading: false, weatherIntelError: "" });
          return;
        }
        this.setData({
          weatherIntelLoading: false,
          weatherIntelError: "气象数据暂不可用"
        });
      });
  },

  onWeatherIntelDayTap(event = {}) {
    const dateKey = `${event?.currentTarget?.dataset?.dateKey || ""}`.trim();
    if (!dateKey || !this._weatherCalendarSnapshot) return;
    const drone = buildQualificationDroneSnapshot(this.data);
    this.setData(buildWeatherIntelPatch(this._weatherCalendarSnapshot, {
      selectedDateKey: dateKey,
      selectedHour: this.data.weatherIntelSelectedHour,
      droneSlug: drone.slug,
      droneName: drone.name
    }));
  },

  onWeatherIntelHourChanging(event = {}) {
    const hour = Math.max(0, Math.min(23, Math.round(Number(event?.detail?.value))));
    if (!Number.isFinite(hour)) return;
    this.setData({ weatherIntelSelectedHour: hour, weatherIntelHandleStyle: buildWeatherHandleStyle(hour) });
  },

  onWeatherIntelHourChange(event = {}) {
    const hour = Math.max(0, Math.min(23, Math.round(Number(event?.detail?.value))));
    if (!Number.isFinite(hour) || !this._weatherCalendarSnapshot) return;
    const drone = buildQualificationDroneSnapshot(this.data);
    this.setData(buildWeatherIntelPatch(this._weatherCalendarSnapshot, {
      selectedDateKey: this.data.weatherIntelSelectedDateKey,
      selectedHour: hour,
      droneSlug: drone.slug,
      droneName: drone.name
    }));
  },

  loadQualificationCredentials() {
    fetchUserCredentials({ apiBase: resolveApiBase() })
      .then((credentials = {}) => {
        const nextCredentials = Object.assign(createEmptyCredentialState(), credentials);
        this.setData({
          qualificationCredentials: nextCredentials
        }, () => this.refreshQualificationState(this.data.qualificationMode, nextCredentials));
      })
      .catch((err) => {
        console.warn("preflight load qualification credentials failed", err);
        const nextCredentials = createEmptyCredentialState();
        this.setData({
          qualificationCredentials: nextCredentials
        }, () => this.refreshQualificationState(this.data.qualificationMode, nextCredentials));
      });
  },

  onQualificationTipTap() {
    const target = buildPreflightRichTextUrl("flightQualificationAssessment", "飞行资质评估");
    if (target) wx.navigateTo({ url: target });
  },

  onQualificationModeChange(event = {}) {
    const mode = `${event?.currentTarget?.dataset?.mode || ""}`.trim();
    if (!mode || mode === this.data.qualificationMode) return;
    this.setData(
      buildQualificationState(mode, this.data.qualificationCredentials || {}, buildQualificationDroneSnapshot(this.data))
    );
  },

  onCredentialTap(event = {}) {
    const type = `${event?.currentTarget?.dataset?.type || ""}`.trim();
    if (!type) return;
    const item = this.data.qualificationCredentials?.[type];
    if (!item) return;
    if (item.bound) {
      this.openBoundCredentialDialog(item);
      return;
    }
    this.setData(buildCredentialDialogState(item, "empty"));
  },

  closeCredentialDialog() {
    this.setData({
      credentialDialogVisible: false,
      credentialDialogMode: "empty",
      activeCredentialType: "",
      activeCredentialTitle: "",
      activeCredentialGuideTitle: "",
      activeCredentialGuideSubtitle: "",
      activeCredentialRichTextKey: "",
      activeCredentialUploadLabel: "上传文件",
      activeCredentialBound: false,
      activeCredentialFileName: "",
      activeCredentialFileKind: "unknown",
      activeCredentialPreviewUrl: "",
      activeCredentialPdfPath: "",
      activeCredentialUploading: false,
      credentialPendingFilePath: "",
      credentialPendingFileName: "",
      credentialPendingFileKind: "unknown",
      credentialPendingPreviewUrl: ""
    });
  },

  onCredentialMaskTap() {
    if (this.data.activeCredentialUploading) return;
    this.closeCredentialDialog();
  },

  onCredentialGuideTap() {
    const key = `${this.data.activeCredentialRichTextKey || ""}`.trim();
    if (!key) return;
    const title = `${this.data.activeCredentialGuideTitle || this.data.activeCredentialTitle || ""}`.trim();
    const target = buildPreflightRichTextUrl(key, title);
    if (target) wx.navigateTo({ url: target });
  },

  onCredentialStartUploadTap() {
    this.setData({
      credentialDialogMode: "upload",
      credentialPendingFilePath: "",
      credentialPendingFileName: "",
      credentialPendingFileKind: "unknown",
      credentialPendingPreviewUrl: ""
    });
  },

  onCredentialChooseFileTap() {
    const success = (res = {}) => {
      const file = res?.tempFiles?.[0] || res?.files?.[0] || null;
      const filePath = file?.path || file?.tempFilePath || "";
      const fileName = file?.name || file?.originalFileObj?.name || filePath.split(/[\\/]/).pop() || "";
      const fileKind = inferFileKind(fileName || filePath);
      if (!filePath) {
        wx.showToast({ title: "未选择文件", icon: "none" });
        return;
      }
      if (fileKind !== "image" && fileKind !== "pdf") {
        wx.showToast({ title: "仅支持png或pdf", icon: "none" });
        return;
      }
      this.setData({
        credentialPendingFilePath: filePath,
        credentialPendingFileName: fileName,
        credentialPendingFileKind: fileKind,
        credentialPendingPreviewUrl: fileKind === "image" ? filePath : ""
      });
    };

    if (typeof wx.chooseFile === "function") {
      wx.chooseFile({ count: 1, success });
      return;
    }
    if (typeof wx.chooseMessageFile === "function") {
      wx.chooseMessageFile({ count: 1, type: "all", success });
      return;
    }
    wx.showToast({ title: "当前版本不支持选文件", icon: "none" });
  },

  onCredentialConfirmTap() {
    const type = `${this.data.activeCredentialType || ""}`.trim();
    const filePath = `${this.data.credentialPendingFilePath || ""}`.trim();
    if (!type || !filePath) {
      wx.showToast({ title: "请先选择文件", icon: "none" });
      return;
    }
    this.setData({ activeCredentialUploading: true });
    wx.showLoading({ title: "上传中...", mask: true });
    uploadUserCredential(type, filePath, { apiBase: resolveApiBase() })
      .then(() => fetchUserCredentials({ apiBase: resolveApiBase() }))
      .then((credentials = {}) => {
        wx.hideLoading();
        const nextCredentials = Object.assign(createEmptyCredentialState(), credentials);
        const nextItem = nextCredentials[type] || createEmptyCredentialState()[type];
        this.setData({
          qualificationCredentials: nextCredentials,
          activeCredentialUploading: false
        }, () => {
          this.refreshQualificationState(this.data.qualificationMode, nextCredentials);
          this.openBoundCredentialDialog(nextItem);
        });
      })
      .catch((err) => {
        wx.hideLoading();
        console.warn("preflight upload credential failed", err);
        this.setData({ activeCredentialUploading: false });
        wx.showToast({ title: "上传失败", icon: "none" });
      });
  },

  openBoundCredentialDialog(item = {}) {
    this.setData(buildCredentialDialogState(item, "bound"));
    if (!item?.bound) return;
    if (item.fileKind === "pdf") {
      return;
    }
    downloadUserCredentialFile(item, { apiBase: resolveApiBase() })
      .then((tempFilePath) => {
        if (this.data.activeCredentialType !== item.type || !this.data.credentialDialogVisible) return;
        this.setData({
          activeCredentialPreviewUrl: tempFilePath,
          activeCredentialPdfPath: item.fileKind === "pdf" ? tempFilePath : ""
        });
      })
      .catch((err) => {
        console.warn("preflight download credential preview failed", err);
      });
  },

  onCredentialPreviewTap() {
    const previewUrl = `${this.data.activeCredentialPreviewUrl || ""}`.trim();
    const kind = `${this.data.activeCredentialFileKind || ""}`.trim();
    if (kind === "pdf") {
      const item = this.data.qualificationCredentials?.[this.data.activeCredentialType] || null;
      if (!item?.bound) return;
      wx.showLoading({ title: "下载中...", mask: true });
      downloadUserCredentialFile(item, { apiBase: resolveApiBase() })
        .then((filePath) => {
          wx.hideLoading();
          if (typeof wx.openDocument === "function") {
            wx.openDocument({ filePath, showMenu: true });
          }
        })
        .catch((err) => {
          wx.hideLoading();
          console.warn("preflight open credential pdf failed", err);
          wx.showToast({ title: "打开失败", icon: "none" });
        });
      return;
    }
    if (previewUrl && typeof wx.previewImage === "function") {
      wx.previewImage({
        urls: [previewUrl],
        current: previewUrl,
        showmenu: true
      });
    }
  },

  onCredentialMoreTap() {
    const item = this.data.qualificationCredentials?.[this.data.activeCredentialType] || null;
    if (!item?.type) return;
    wx.showActionSheet({
      itemList: ["重新上传", "删除"],
      success: (res = {}) => {
        if (Number(res.tapIndex) === 0) {
          this.setData(buildCredentialDialogState(item, "upload"));
          return;
        }
        if (Number(res.tapIndex) === 1) {
          this.onCredentialDeleteTap(item);
        }
      }
    });
  },

  onCredentialDeleteTap(item = null) {
    const target = item || this.data.qualificationCredentials?.[this.data.activeCredentialType] || null;
    if (!target?.type) return;
    wx.showModal({
      title: "删除资质文件",
      content: `确认删除${target.title || "该资质"}吗？`,
      confirmColor: "#d93025",
      success: (res = {}) => {
        if (!res.confirm) return;
        wx.showLoading({ title: "删除中...", mask: true });
        deleteUserCredential(target.type, { apiBase: resolveApiBase() })
          .then(() => fetchUserCredentials({ apiBase: resolveApiBase() }))
          .then((credentials = {}) => {
            wx.hideLoading();
            const nextCredentials = Object.assign(createEmptyCredentialState(), credentials);
            const nextItem = nextCredentials[target.type] || createEmptyCredentialState()[target.type];
            this.setData({
              qualificationCredentials: nextCredentials
            }, () => {
              this.refreshQualificationState(this.data.qualificationMode, nextCredentials);
              this.setData(buildCredentialDialogState(nextItem, "empty"));
              wx.showToast({ title: "已删除", icon: "success" });
            });
          })
          .catch((err) => {
            wx.hideLoading();
            console.warn("preflight delete credential failed", err);
            wx.showToast({ title: "删除失败", icon: "none" });
          });
      }
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
            title: item.title || item.address || "附近公安部门",
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
    const target = buildPreflightRichTextUrl("flightHeight120m", "120米飞行说明");
    if (target) wx.navigateTo({ url: target });
  },

  onSpecialScenarioTipTap() {
    const target = buildPreflightRichTextUrl("noSpecialFlightScenario", "特殊飞行场景说明");
    if (target) wx.navigateTo({ url: target });
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
      name: station.title || "公安部门",
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
    const target = buildPreflightRichTextUrl("reportAndUnlockGuide", "报备和解禁指南");
    if (target) wx.navigateTo({ url: target });
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
      wx.showToast({ title: "公众号链接不可用", icon: "none" });
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



