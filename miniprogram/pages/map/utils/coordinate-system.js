const {
  gcj02ToWgs84,
  gcj02ToBd09,
  gcj02ToCgcs2000
} = require("../../../utils/coords");

const COORDINATE_SYSTEM_OPTIONS = [
  { value: "gcj02", label: "GCJ-02" },
  { value: "bd09", label: "BD09" },
  { value: "wgs84", label: "WGS84" },
  { value: "cgcs2000", label: "CGCS2000" }
];

const COORDINATE_SYSTEM_DISPLAY_LABEL_MAP = {
  gcj02: "gcj-02",
  bd09: "bd09",
  wgs84: "wgs84",
  cgcs2000: "cgcs2000"
};

const COORDINATE_SYSTEM_CLIPBOARD_LABEL_MAP = {
  gcj02: "GCJ-02",
  bd09: "BD09",
  wgs84: "WGS84",
  cgcs2000: "CGCS2000"
};

const normalizeCoordinateSystem = (value) => {
  const raw = `${value || ""}`.toLowerCase();
  return COORDINATE_SYSTEM_OPTIONS.some((item) => item.value === raw) ? raw : "gcj02";
};

const resolveCoordinateSystemDisplayLabel = (coordinateSystem) =>
  COORDINATE_SYSTEM_DISPLAY_LABEL_MAP[normalizeCoordinateSystem(coordinateSystem)] || "gcj-02";

const resolveCoordinateSystemLabel = (coordinateSystem) =>
  COORDINATE_SYSTEM_CLIPBOARD_LABEL_MAP[normalizeCoordinateSystem(coordinateSystem)] || "GCJ-02";

const formatCoordinateParts = (lat, lng) => {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
  const latText = latNum.toFixed(6);
  const lngText = lngNum.toFixed(6);
  return { lngText, latText };
};

const formatCoordinateDisplayParts = (lat, lng) => {
  const parts = formatCoordinateParts(lat, lng);
  if (!parts) return null;
  const latNum = Number(lat);
  const lngNum = Number(lng);
  return {
    lngText: `${parts.lngText}°${lngNum >= 0 ? "E" : "W"}`,
    latText: `${parts.latText}°${latNum >= 0 ? "N" : "S"}`
  };
};

const formatDmsUnit = (value) => {
  const abs = Math.abs(Number(value) || 0);
  const degree = Math.floor(abs);
  const minuteFloat = (abs - degree) * 60;
  const minute = Math.floor(minuteFloat);
  const second = (minuteFloat - minute) * 60;
  const secondText = Number(second.toFixed(2)).toString();
  return `${degree}°${minute}'${secondText}"`;
};

const formatCoordinateDms = (value, axis) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const direction =
    axis === "lng"
      ? (numeric >= 0 ? "东经" : "西经")
      : (numeric >= 0 ? "北纬" : "南纬");
  return `${direction}${formatDmsUnit(numeric)}`;
};

const normalizeAddressText = (value) => {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
};

const convertCoordinateFromGcj02 = (lng, lat, coordinateSystem = "gcj02") => {
  const baseLng = Number(lng);
  const baseLat = Number(lat);
  if (!Number.isFinite(baseLng) || !Number.isFinite(baseLat)) return null;
  const normalized = normalizeCoordinateSystem(coordinateSystem);
  let converted = { lng: baseLng, lat: baseLat };
  if (normalized === "wgs84") {
    converted = gcj02ToWgs84(baseLng, baseLat);
  } else if (normalized === "bd09") {
    converted = gcj02ToBd09(baseLng, baseLat);
  } else if (normalized === "cgcs2000") {
    converted = gcj02ToCgcs2000(baseLng, baseLat);
  }
  const outLng = Number(converted?.lng);
  const outLat = Number(converted?.lat);
  if (!Number.isFinite(outLng) || !Number.isFinite(outLat)) {
    return { lng: baseLng, lat: baseLat };
  }
  return { lng: outLng, lat: outLat };
};

const buildCoordinateClipboardText = ({
  lat,
  lng,
  coordinateSystem = "gcj02",
  address = ""
} = {}) => {
  const decimal = formatCoordinateParts(lat, lng);
  if (!decimal) return "";
  const lngDms = formatCoordinateDms(lng, "lng");
  const latDms = formatCoordinateDms(lat, "lat");
  const normalizedAddress = normalizeAddressText(address);
  const lines = [
    `坐标系：${resolveCoordinateSystemLabel(coordinateSystem)}`,
    `经度(十进制)：${decimal.lngText}`,
    `纬度(十进制)：${decimal.latText}`,
    `经度(时分秒)：${lngDms || "-"}`,
    `纬度(时分秒)：${latDms || "-"}`,
    `详细地址：${normalizedAddress || "未获取到地址"}`
  ];
  return lines.join("\n");
};

module.exports = {
  COORDINATE_SYSTEM_OPTIONS,
  normalizeCoordinateSystem,
  resolveCoordinateSystemDisplayLabel,
  resolveCoordinateSystemLabel,
  formatCoordinateParts,
  formatCoordinateDisplayParts,
  formatDmsUnit,
  formatCoordinateDms,
  normalizeAddressText,
  convertCoordinateFromGcj02,
  buildCoordinateClipboardText
};
