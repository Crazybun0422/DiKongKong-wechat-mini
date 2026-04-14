const {
  fetchTemporaryNoFlyZonesPage,
  searchTemporaryNoFlyZones,
  fetchNoFlyZoneRichTextConfig,
  computeNoFlyZoneCenter,
  isNoFlyZoneEffective
} = require("../../utils/no-fly-zones");
const { appendInviteCodeToPath, appendInviteCodeToQuery } = require("../../utils/share");
const { transformHtmlContent } = require("../../utils/open-platform");

const PAGE_SIZE = 20;
const DEFAULT_MAP_SCALE = 13;
const SEARCH_DEBOUNCE_MS = 260;
const NAVIGATION_LOCK_MS = 1500;
const MAP_PAGE_ROUTE = "pages/map/map";
const SHARE_PAGE_PATH = "/pages/temporary-no-fly-announcement/index";
const SHARE_TITLE = "临时禁飞通告";
const ACTIVE_PREVIEW_COLOR = "#DE4329";
const UPCOMING_PREVIEW_COLOR = "#8A6E72";
const NOTICE_TEXT_COLOR = "#D7A33A";

const normalizeUnixSeconds = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (Math.abs(numeric) >= 1e12) {
    return Math.floor(numeric / 1000);
  }
  return Math.floor(numeric);
};

const padNumber = (value) => `${value}`.padStart(2, "0");

const formatPeriodDateTime = (value) => {
  const seconds = normalizeUnixSeconds(value);
  if (!Number.isFinite(seconds)) return "";
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return `${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}`;
};

const formatPeriodRange = (from, to) => {
  const fromText = formatPeriodDateTime(from);
  const toText = formatPeriodDateTime(to);
  if (fromText && toText) return `${fromText}至${toText}`;
  if (fromText) return `${fromText}起`;
  if (toText) return `截至${toText}`;
  return "";
};

const resolvePeriodRows = (zone = {}, nowSeconds = normalizeUnixSeconds(Date.now())) => {
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

  const rows = deduped.map((period) => {
    const from = period.effectiveFrom;
    const to = period.effectiveTo;
    const isActive = (from === null || nowSeconds >= from) && (to === null || nowSeconds <= to);
    const isUpcoming = from !== null && nowSeconds < from;
    return {
      label: isActive ? "生效中" : isUpcoming ? "待生效" : "已失效",
      value: formatPeriodRange(from, to) || "时间待定",
      priority: isActive ? 0 : isUpcoming ? 1 : 2,
      tone: isActive ? "active" : isUpcoming ? "upcoming" : "expired"
    };
  });

  rows.sort((a, b) => a.priority - b.priority);
  return rows;
};

const parseTimeValue = (value) => {
  if (typeof value === "string" && value.trim()) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  return 0;
};

const sortZonesByCreatedAtDesc = (list = []) =>
  list.slice().sort((a, b) => {
    const aTime = parseTimeValue(a?.createdAt || a?.updatedAt || a?.effectiveFrom || 0);
    const bTime = parseTimeValue(b?.createdAt || b?.updatedAt || b?.effectiveFrom || 0);
    if (aTime !== bTime) return bTime - aTime;
    return `${b?.id || ""}`.localeCompare(`${a?.id || ""}`);
  });

const stripNoticeStyleDeclaration = (styleText = "") =>
  styleText
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.split(":")[0]?.trim().toLowerCase();
      return ![
        "color",
        "background",
        "background-color",
        "background-image"
      ].includes(key);
    })
    .join(";");

const normalizeNoticeHtml = (html = "") => {
  if (!html || typeof html !== "string") return "";
  let output = html.replace(/<font\b[^>]*>/gi, "<span>");
  output = output.replace(/<\/font>/gi, "</span>");
  output = output.replace(/\sstyle=['"]([^'"]*)['"]/gi, (match, styleText = "") => {
    const next = stripNoticeStyleDeclaration(styleText);
    return next ? ` style="${next}"` : "";
  });
  output = output.replace(/<(span|p|div|strong|b|em|i)\b([^>]*)>/gi, (match, tagName, attrs = "") => {
    if (/\bstyle=['"]/.test(attrs)) {
      return `<${tagName}${attrs.replace(/\bstyle=['"]([^'"]*)['"]/i, (m, styleText = "") => {
        const cleaned = stripNoticeStyleDeclaration(styleText);
        const merged = [cleaned, `color:${NOTICE_TEXT_COLOR}`].filter(Boolean).join(";");
        return `style="${merged}"`;
      })}>`;
    }
    return `<${tagName}${attrs} style="color:${NOTICE_TEXT_COLOR}">`;
  });
  return output;
};

const buildTemporaryPreviewShape = (zone = {}) => {
  const type = `${zone?.type || ""}`.trim().toUpperCase();
  if (type === "CIRCLE" && zone?.circle) {
    const latitude = Number(zone.circle.latitude ?? zone.circle.lat);
    const longitude = Number(zone.circle.longitude ?? zone.circle.lng);
    const radiusMeters = Number(zone.circle.radiusMeters ?? zone.circle.radius ?? 0);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radiusMeters) || radiusMeters <= 0) {
      return null;
    }
    return {
      type: "CIRCLE",
      coordinates: [{ latitude, longitude }],
      radius: radiusMeters / 1000,
      circle: { latitude, longitude, radiusMeters }
    };
  }
  if (type === "PATH") {
    return {
      type: "PATH",
      coordinates: Array.isArray(zone?.coordinates) ? zone.coordinates : [],
      width: Number(zone?.pathDistanceMeters) || 0
    };
  }
  return {
    type: "POLYGON",
    coordinates: Array.isArray(zone?.coordinates) ? zone.coordinates : []
  };
};

const buildTemporaryPreviewShapes = (zone = {}) => {
  const baseShape = buildTemporaryPreviewShape(zone);
  const extraShapes = Array.isArray(zone?.extra)
    ? zone.extra.map((item) => buildTemporaryPreviewShape(item)).filter(Boolean)
    : [];
  return [baseShape].concat(extraShapes).filter(Boolean);
};

const buildMapTargets = (zone = {}) => {
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
        label: multiple ? `查看位置${index + 1}` : "地图查看"
      };
    })
    .filter(Boolean);
};

const buildTemporaryPreviewPayload = (zone = {}, targetIndex = 0) => {
  const shapes = buildTemporaryPreviewShapes(zone);
  const shape = shapes[targetIndex] || shapes[0] || null;
  const center = computeNoFlyZoneCenter(shape || zone);
  if (!center || !shape) return null;
  const title = `${zone?.name || "临时禁飞区"}`.trim();
  const rawLink = typeof zone?.wechatLink === "string" ? zone.wechatLink.trim() : "";
  const validLink = /^https?:\/\/mp\.weixin\.qq\.com\//.test(rawLink) ? rawLink : "";
  const active = isNoFlyZoneEffective(zone);
  return {
    id: `${zone?.id || zone?.name || Date.now()}`,
    name: title,
    location: {
      latitude: Number(center.latitude),
      longitude: Number(center.longitude)
    },
    shape,
    shapes,
    suppressCenterMarker: true,
    previewColor: active ? ACTIVE_PREVIEW_COLOR : UPCOMING_PREVIEW_COLOR,
    temporaryNoFlyZoneInfo: {
      id: `${zone?.id || ""}`,
      name: title,
      displayName: title,
      hasLink: !!validLink,
      link: validLink,
      linkPath: validLink ? `/packages/city-report/h5/index?url=${encodeURIComponent(validLink)}` : "",
      effective: active
    },
    raw: zone,
    zoom: DEFAULT_MAP_SCALE
  };
};

const findLatestMapPage = () => {
  if (typeof getCurrentPages !== "function") return null;
  const pages = getCurrentPages();
  if (!Array.isArray(pages) || pages.length < 2) return null;
  for (let i = pages.length - 2; i >= 0; i -= 1) {
    const page = pages[i];
    if (`${page?.route || ""}` === MAP_PAGE_ROUTE) {
      return {
        page,
        delta: pages.length - 1 - i
      };
    }
  }
  return null;
};

const normalizeZoneItem = (zone = {}) => {
  const center = computeNoFlyZoneCenter(zone);
  const title = typeof zone?.name === "string" ? zone.name.trim() : "";
  const wechatLink = typeof zone?.wechatLink === "string" ? zone.wechatLink.trim() : "";
  const validWechatLink = /^https?:\/\/mp\.weixin\.qq\.com\//.test(wechatLink) ? wechatLink : "";
  return {
    id: `${zone?.id || title || Date.now()}`,
    title: title || "临时禁飞通告",
    center,
    active: isNoFlyZoneEffective(zone),
    raw: zone,
    wechatLink: validWechatLink,
    canOpenArticle: !!validWechatLink,
    periodRows: resolvePeriodRows(zone),
    mapTargets: buildMapTargets(zone)
  };
};

Page({
  data: {
    keyword: "",
    noticeVisible: false,
    noticeNodes: [],
    zones: [],
    loading: true,
    loadingMore: false,
    refreshing: false,
    hasMore: true,
    page: 0,
    errorText: "",
    emptyText: ""
  },

  onLoad() {
    this._searchTimer = null;
    this._activeRequestId = 0;
    this._navigationLocked = false;
    this._navigationTimer = null;
    this.loadNotice();
    this.loadZoneList({ reset: true });
  },

  onShow() {
    this.releaseNavigationLock();
  },

  onHide() {
    this.releaseNavigationLock();
  },

  onUnload() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    this.releaseNavigationLock();
  },

  onPullDownRefresh() {
    this.loadZoneList({ reset: true, fromPullDown: true });
  },

  onReachBottom() {
    if (this.data.keyword.trim()) return;
    if (!this.data.hasMore || this.data.loading || this.data.loadingMore) return;
    this.loadZoneList({ reset: false });
  },

  onListScrollToLower() {
    this.onReachBottom();
  },

  onKeywordInput(event) {
    const keyword = `${event?.detail?.value || ""}`;
    this.setData({ keyword });
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null;
      this.loadZoneList({ reset: true });
    }, SEARCH_DEBOUNCE_MS);
  },

  onSearchConfirm() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    this.loadZoneList({ reset: true });
  },

  onShareAppMessage() {
    return {
      title: SHARE_TITLE,
      path: appendInviteCodeToPath(SHARE_PAGE_PATH)
    };
  },

  onShareTimeline() {
    return {
      title: SHARE_TITLE,
      query: appendInviteCodeToQuery("")
    };
  },

  loadNotice() {
    return fetchNoFlyZoneRichTextConfig()
      .then((response = {}) => {
        const content = typeof response.content === "string" ? response.content.trim() : "";
        const transformed = content ? normalizeNoticeHtml(transformHtmlContent(content)) : [];
        const hasNotice = Array.isArray(transformed)
          ? transformed.length > 0
          : !!`${transformed || ""}`.replace(/<[^>]*>/g, "").replace(/\s+/g, "").trim();
        this.setData({
          noticeVisible: hasNotice,
          noticeNodes: hasNotice ? transformed : []
        });
      })
      .catch((err) => {
        console.warn("load no-fly zone rich text config failed", err);
        this.setData({
          noticeVisible: false,
          noticeNodes: []
        });
      });
  },

  loadZoneList(options = {}) {
    const reset = options.reset !== false;
    const fromPullDown = options.fromPullDown === true;
    const keyword = this.data.keyword.trim();
    const nextPage = reset ? 0 : Number(this.data.page) || 0;
    const requestId = ++this._activeRequestId;

    this.setData(
      reset
        ? {
            loading: !fromPullDown,
            refreshing: fromPullDown,
            errorText: "",
            emptyText: ""
          }
        : {
            loadingMore: true,
            errorText: ""
          }
    );

    const request = keyword
      ? searchTemporaryNoFlyZones(keyword)
      : fetchTemporaryNoFlyZonesPage({
          page: nextPage,
          size: PAGE_SIZE,
          sortOrder: "DESC"
        });

    Promise.resolve(request)
      .then((response) => {
        if (this._activeRequestId !== requestId) return;
        const rawList = keyword
          ? response
          : (Array.isArray(response?.content) ? response.content : []);
        const sorted = sortZonesByCreatedAtDesc(rawList).map((item) => normalizeZoneItem(item));
        const zones = reset ? sorted : this.data.zones.concat(sorted);
        const totalPages = keyword ? 1 : Number(response?.totalPages) || 0;
        const totalElements = keyword ? sorted.length : Number(response?.totalElements);
        const hasMore = keyword
          ? false
          : totalPages > 0
            ? nextPage + 1 < totalPages
            : (Number.isFinite(totalElements) ? zones.length < totalElements : sorted.length >= PAGE_SIZE);
        this.setData({
          zones,
          page: nextPage + (keyword ? 0 : 1),
          hasMore,
          loading: false,
          loadingMore: false,
          refreshing: false,
          errorText: "",
          emptyText: zones.length ? "" : (keyword ? "未搜索到相关通告" : "暂无临时禁飞通告")
        });
      })
      .catch((err) => {
        console.warn("load temporary no-fly announcements failed", err);
        if (this._activeRequestId !== requestId) return;
        this.setData({
          loading: false,
          loadingMore: false,
          refreshing: false,
          errorText: "加载失败，请稍后重试",
          emptyText: this.data.zones.length ? "" : "加载失败，请稍后重试"
        });
      })
      .finally(() => {
        if (fromPullDown && typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh();
        }
      });
  },

  onTitleTap(event) {
    const item = this.resolveZoneFromEvent(event);
    if (!item?.wechatLink) {
      wx.showToast({ title: "公众号链接不可用", icon: "none" });
      return;
    }
    if (this._navigationLocked) return;
    this.lockNavigation();
    wx.navigateTo({
      url: `/packages/city-report/h5/index?url=${encodeURIComponent(item.wechatLink)}`,
      fail: (err) => {
        console.warn("temporary no-fly article navigate failed", err);
        this.releaseNavigationLock();
      }
    });
  },

  onMapTap(event) {
    const item = this.resolveZoneFromEvent(event);
    const targetIndex = Math.max(0, Number(event?.currentTarget?.dataset?.targetIndex) || 0);
    const mapTargets = Array.isArray(item?.mapTargets) ? item.mapTargets : [];
    const mapTarget = mapTargets[targetIndex] || mapTargets[0] || null;
    const center = mapTarget?.center || item?.center;
    if (!center || !Number.isFinite(Number(center.latitude)) || !Number.isFinite(Number(center.longitude))) {
      wx.showToast({ title: "禁飞区中心点不可用", icon: "none" });
      return;
    }
    if (this._navigationLocked) return;
    this.lockNavigation();
    const existingMap = findLatestMapPage();
    if (existingMap?.page) {
      try {
        if (typeof existingMap.page.clearPinPreview === "function") {
          existingMap.page.clearPinPreview();
        }
        if (typeof existingMap.page.centerOnPoint === "function") {
          existingMap.page.centerOnPoint({
            latitude: Number(center.latitude),
            longitude: Number(center.longitude)
          }, DEFAULT_MAP_SCALE);
        }
        wx.navigateBack({
          delta: existingMap.delta,
          fail: (err) => {
            console.warn("temporary no-fly navigateBack to existing map failed", err);
            this.releaseNavigationLock();
          }
        });
        return;
      } catch (err) {
        console.warn("temporary no-fly apply to existing map failed", err);
      }
    }

    const latitude = Number(center.latitude).toFixed(6);
    const longitude = Number(center.longitude).toFixed(6);
    const app = typeof getApp === "function" ? getApp() : null;
    if (app?.globalData) {
      app.globalData.pendingPinPreview = null;
    }
    const targetUrl = `/pages/map/map?cs=1&clat=${encodeURIComponent(latitude)}&clng=${encodeURIComponent(longitude)}&cscale=${DEFAULT_MAP_SCALE}`;
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const navigate = Array.isArray(pages) && pages.length >= 9 ? wx.redirectTo : wx.navigateTo;
    navigate.call(wx, {
      url: targetUrl,
      fail: (err) => {
        console.warn("temporary no-fly map navigate failed", err);
        this.releaseNavigationLock();
      }
    });
  },

  resolveZoneFromEvent(event = {}) {
    const id = `${event?.currentTarget?.dataset?.id || ""}`;
    if (!id) return null;
    return this.data.zones.find((item) => `${item.id}` === id) || null;
  },

  lockNavigation() {
    this._navigationLocked = true;
    if (this._navigationTimer) {
      clearTimeout(this._navigationTimer);
    }
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
