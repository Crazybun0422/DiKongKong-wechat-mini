const { reverseGeocode } = require("../../../../utils/geocoder");
const { buildCityReportWebviewPath } = require("../../../../utils/city-report");
const { fetchReportEntries } = require("../../../../utils/report-entries");
const { getLatestFontFileSource } = require("../../../../utils/font-config");

const RESOLVE_DEBOUNCE_MS = 450;
const MIN_MOVED_METERS = 300;
const JUMP_BASE_WIDTH = 240;
const JUMP_CHAR_WIDTH = 28;
const JUMP_SIDE_PADDING = 56;
const JUMP_MAX_WIDTH = 520;

const REGION_SUFFIXES = [
  "省",
  "市",
  "县",
  "区",
  "自治区",
  "自治州",
  "自治县",
  "特别行政区",
  "盟",
  "地区",
  "自治旗",
  "旗",
  "林区",
  "新区"
];

const normalizeName = (value) => {
  if (typeof value !== "string") return "";
  let text = value.trim().replace(/\s+/g, "");
  if (!text) return "";
  for (const suffix of REGION_SUFFIXES) {
    if (text.endsWith(suffix)) {
      text = text.slice(0, Math.max(0, text.length - suffix.length));
      break;
    }
  }
  return text;
};

const hasLabelSuffix = (value) =>
  REGION_SUFFIXES.some((suffix) => typeof value === "string" && value.endsWith(suffix));

const ensureLabelSuffix = (value, suffix) => {
  if (!value) return "";
  if (hasLabelSuffix(value)) return value;
  return suffix ? `${value}${suffix}` : value;
};

const formatReportLabel = (name, suffix) => {
  const base = ensureLabelSuffix(name, suffix);
  return base ? `${base}飞行报备` : "";
};

const calcJumpWidth = (label) => {
  const length = Array.from(label || "").length;
  if (!length) return JUMP_BASE_WIDTH;
  const width = JUMP_SIDE_PADDING + length * JUMP_CHAR_WIDTH;
  return Math.max(JUMP_BASE_WIDTH, Math.min(JUMP_MAX_WIDTH, Math.round(width)));
};

const buildRegionInfo = (adInfo = {}) => {
  const province = typeof adInfo.province === "string" ? adInfo.province.trim() : "";
  const city = typeof adInfo.city === "string" ? adInfo.city.trim() : "";
  const districtRaw =
    typeof adInfo.district === "string"
      ? adInfo.district.trim()
      : (typeof adInfo.county === "string" ? adInfo.county.trim() : "");
  return {
    province,
    city,
    county: districtRaw,
    normalized: {
      province: normalizeName(province),
      city: normalizeName(city),
      county: normalizeName(districtRaw)
    }
  };
};

const buildRegionKey = (region) =>
  `${region?.normalized?.province || ""}|${region?.normalized?.city || ""}|${region?.normalized?.county || ""}`;

const entryMatchesRegion = (entry = {}, region = {}) => {
  const normalized = region.normalized || {};
  if (!entry || !entry.province || !normalized.province) return false;
  if (normalizeName(entry.province) !== normalized.province) return false;
  if (entry.city && normalizeName(entry.city) !== normalized.city) return false;
  if (entry.county && normalizeName(entry.county) !== normalized.county) return false;
  return true;
};

const pickBestEntry = (entries = [], region = {}) => {
  const matched = entries.filter((entry) => entryMatchesRegion(entry, region));
  if (!matched.length) return null;
  const countyEntry = matched.find((entry) => normalizeName(entry.county));
  if (countyEntry) return countyEntry;
  const provinceEntry = matched.find(
    (entry) => normalizeName(entry.province) && !normalizeName(entry.city) && !normalizeName(entry.county)
  );
  if (provinceEntry) return provinceEntry;
  const cityEntry = matched.find((entry) => normalizeName(entry.city));
  if (cityEntry) return cityEntry;
  return null;
};

const buildEntryLabel = (entry, region) => {
  if (entry) {
    if (entry.county) return formatReportLabel(entry.county, "县");
    if (entry.city) return formatReportLabel(entry.city, "市");
    if (entry.province) return formatReportLabel(entry.province, "省");
  }
  const fallback = region?.city || region?.province || "";
  const suffix = region?.city ? "市" : "省";
  return formatReportLabel(fallback, suffix);
};

const normalizeDialogText = (value) =>
  typeof value === "string" ? value.trim() : "";

const normalizeGuideValue = (value) =>
  typeof value === "string" ? value.trim() : "";

const isGuideAvailable = (guide = {}) => {
  const publicAccountLink = normalizeGuideValue(guide.publicAccountLink);
  const videoAccountId = normalizeGuideValue(guide.videoAccountId);
  return !!publicAccountLink || !!videoAccountId;
}

const haversineMeters = (lat1, lng1, lat2, lng2) => {
  const toRad = (v) => (Number(v) * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

Component({
  properties: {
    center: {
      type: Object,
      value: null
    },
    active: {
      type: Boolean,
      value: true
    }
  },
  data: {
    visible: false,
    jumpLabel: "",
    jumpWidth: JUMP_BASE_WIDTH,
    dialogText: "",
    dialogVisible: false,
    showGuide: false
  },
  observers: {
    "center.latitude, center.longitude, active": function (lat, lng, active) {
      if (!active) return;
      const next = {
        latitude: Number(lat),
        longitude: Number(lng)
      };
      if (!Number.isFinite(next.latitude) || !Number.isFinite(next.longitude)) return;
      this.scheduleResolve(next);
    }
  },
  lifetimes: {
    attached() {
      this.ensureFontLoaded();
    },
    detached() {
      if (this._resolveTimer) {
        clearTimeout(this._resolveTimer);
        this._resolveTimer = null;
      }
    }
  },
  methods: {
    noop() { },
    ensureFontLoaded() {
      if (this._fontLoaded) return;
      const apiBase = typeof getApp === "function" ? getApp()?.globalData?.apiBase : "";
      this._fontLoaded = true;
      getLatestFontFileSource({ apiBase })
        .then((source) => {
          if (!source) {
            this._fontLoaded = false;
            return;
          }
          wx.loadFontFace({
            family: "ZhSubset",
            source: `url("${source}")`,
            global: true,
            success: () => { },
            fail: () => {
              this._fontLoaded = false;
            }
          });
        })
        .catch(() => {
          this._fontLoaded = false;
        });
    },
    triggerStateChange(payload) {
      const state = { blockMap: !!this.data.dialogVisible };
      this.triggerEvent("statechange", Object.assign(state, payload || {}));
    },
    triggerDialogChange(visible, text) {
      this.triggerEvent("dialogchange", {
        visible: !!visible,
        text: typeof text === "string" ? text : ""
      });
    },

    scheduleResolve(center) {
      if (!center) return;
      if (this._lastCenter) {
        const dist = haversineMeters(
          this._lastCenter.latitude,
          this._lastCenter.longitude,
          center.latitude,
          center.longitude
        );
        if (Number.isFinite(dist) && dist < MIN_MOVED_METERS) return;
      }
      this._pendingCenter = center;
      if (this._resolveTimer) clearTimeout(this._resolveTimer);
      this._resolveTimer = setTimeout(() => {
        this._resolveTimer = null;
        this.resolveRegionFromCenter(this._pendingCenter);
      }, RESOLVE_DEBOUNCE_MS);
    },

    resolveRegionFromCenter(center) {
      if (!center) return;
      const token = (this._resolveToken || 0) + 1;
      this._resolveToken = token;
      reverseGeocode(center.latitude, center.longitude)
        .then((res = {}) => {
          if (this._resolveToken !== token) return;
          this._lastCenter = center;
          const region = buildRegionInfo(res.ad_info || {});
          if (!region.province && !region.city) {
            this.setData({ visible: false, jumpLabel: "" });
            return;
          }
          const regionKey = buildRegionKey(region);
          if (this._lastRegionKey === regionKey) {
            this._regionInfo = region;
            return;
          }
          this._lastRegionKey = regionKey;
          this.applyRegion(region);
          this.loadReportEntries(region);
        })
        .catch(() => {
          if (this._resolveToken !== token) return;
          if (!this.data.jumpLabel) {
            this.setData({ visible: false });
          }
        });
    },

    applyRegion(region) {
      this._regionInfo = region;
      const defaultLabel = buildEntryLabel(null, region);
      const jumpWidth = calcJumpWidth(defaultLabel);
      this.setData({
        visible: !!defaultLabel,
        jumpLabel: defaultLabel || "",
        jumpWidth,
        dialogVisible: false,
        showGuide: false
      }, () => {
        this.triggerStateChange();
      });
    },

    loadReportEntries(region) {
      if (!region || !region.province) return;
      const token = (this._loadToken || 0) + 1;
      this._loadToken = token;
      fetchReportEntries({ province: region.province })
        .then((payload = {}) => {
          if (this._loadToken !== token) return;
          const entries = Array.isArray(payload.entries) ? payload.entries : [];
          const dialogText = normalizeDialogText(payload.dialogText);
          this._entries = entries;
          this._globalDialogText = dialogText;
          this.applyMatchedEntry(region, entries, dialogText);
        })
        .catch((err) => {
          if (this._loadToken !== token) return;
          console.warn("fetch report entries failed", err);
          this._entries = [];
          this.applyMatchedEntry(region, [], "");
        });
    },

    applyMatchedEntry(region, entries, dialogTextOverride) {
      const match = pickBestEntry(entries, region);
      this._activeEntry = match;
      const label = buildEntryLabel(match, region);
      const jumpWidth = calcJumpWidth(label);
      const dialogText =
        typeof dialogTextOverride === "string"
          ? normalizeDialogText(dialogTextOverride)
          : normalizeDialogText(this._globalDialogText);
      const showGuide = isGuideAvailable(match?.guide);
      console.log("matched entry", match, label, showGuide);
      this.setData({
        visible: !!label,
        jumpLabel: label || "",
        jumpWidth,
        dialogText,
        showGuide
      });
    },

    openDialog(message) {
      const text =
        normalizeDialogText(message) ||
        normalizeDialogText(this.data.dialogText) ||
        normalizeDialogText(this._globalDialogText);
      this.setData({
        dialogVisible: true,
        dialogText: text || "暂无报备入口"
      }, () => {
        this.triggerStateChange();
        this.triggerDialogChange(true, this.data.dialogText || "");
      });
    },

    closeDialog() {
      if (!this.data.dialogVisible) return;
      this.setData({ dialogVisible: false }, () => {
        this.triggerStateChange();
        this.triggerDialogChange(false, "");
      });
    },

    onJumpTap() {
      const entry = this._activeEntry;
      const appId = entry?.miniProgram?.appId || "";
      if (!entry || !appId) {
        this.openDialog();
        return;
      }
      wx.navigateToMiniProgram({
        appId,
        path: entry?.miniProgram?.path || "",
        envVersion: "release"
      });
    },

    onTipTap() {
      const entry = this._activeEntry;
      const guide = entry?.guide || {};
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
      if (finderUserName && feedId && typeof wx?.openChannelsActivity === "function") {
        wx.openChannelsActivity({ finderUserName, feedId });
        return;
      }
      if (finderUserName && typeof wx?.openChannelsUserProfile === "function") {
        wx.openChannelsUserProfile({ finderUserName });
        return;
      }
      if (feedId && typeof wx?.openChannelsActivity === "function") {
        wx.openChannelsActivity({ activityId: feedId });
        return;
      }
      this.openDialog();
    },

    onDialogClose() {
      this.closeDialog();
    }
  }
});
