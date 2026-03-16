const {
  wgs84ToGcj02,
  bd09ToGcj02,
  cgcs2000ToGcj02
} = require("./coords");

const CHINA_LAT_MIN = 0;
const CHINA_LAT_MAX = 60;
const CHINA_LON_MIN = 70;
const CHINA_LON_MAX = 140;
const SEARCH_COORDINATE_TIPS_TEXT =
  "支持中国范围内经纬度搜索：经度在前或纬度在前，十进制度或时分秒格式；输入坐标默认按左下角所选坐标系解析。";

const toAsciiDirection = (value = "") =>
  `${value || ""}`
    .replace(/东经/gi, "E ")
    .replace(/西经/gi, "W ")
    .replace(/北纬/gi, "N ")
    .replace(/南纬/gi, "S ")
    .replace(/[东]/g, "E")
    .replace(/[西]/g, "W")
    .replace(/[北]/g, "N")
    .replace(/[南]/g, "S");

const normalizeInput = (value = "") =>
  toAsciiDirection(value)
    .replace(/[，]/g, ",")
    .replace(/[；;]/g, ",")
    .replace(/[|]/g, ",")
    .replace(/\s+/g, " ")
    .trim();

const isChinaLatitude = (value) => Number.isFinite(value) && value >= CHINA_LAT_MIN && value <= CHINA_LAT_MAX;
const isChinaLongitude = (value) => Number.isFinite(value) && value >= CHINA_LON_MIN && value <= CHINA_LON_MAX;

const formatCoordinate = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return `${Math.round(numeric * 1000000) / 1000000}`;
};

const buildCoordinateTitle = ({ latitude, longitude }) =>
  `经度 ${formatCoordinate(longitude)}，纬度 ${formatCoordinate(latitude)}`;

function parseCoordinateParts(parts = [], hemisphere = "") {
  if (!Array.isArray(parts) || !parts.length) return null;
  const deg = Number(parts[0]);
  if (!Number.isFinite(deg)) return null;
  const min = Number(parts[1] || 0);
  const sec = Number(parts[2] || 0);
  if (!Number.isFinite(min) || !Number.isFinite(sec)) return null;
  let value = Math.abs(deg) + Math.abs(min) / 60 + Math.abs(sec) / 3600;
  const signSource = `${hemisphere || ""}`.toUpperCase();
  const isNegative = deg < 0 || signSource === "S" || signSource === "W";
  if (isNegative) value *= -1;
  return value;
}

function parseSingleSegment(segment = "") {
  const raw = normalizeInput(segment);
  if (!raw) return null;
  const hemisphereMatches = raw.match(/[NSEW]/gi) || [];
  const hemisphere = hemisphereMatches.length ? hemisphereMatches[hemisphereMatches.length - 1] : "";
  const numericParts = raw.match(/[+-]?\d+(?:\.\d+)?/g) || [];
  if (!numericParts.length) return null;
  if (/[°度′'″"分秒]/i.test(raw) || numericParts.length >= 2) {
    return parseCoordinateParts(numericParts.slice(0, 3), hemisphere);
  }
  const decimal = Number(numericParts[0]);
  if (!Number.isFinite(decimal)) return null;
  if (hemisphere === "S" || hemisphere === "W") return -Math.abs(decimal);
  return decimal;
}

function splitCoordinateInput(input = "") {
  const normalized = normalizeInput(input);
  if (!normalized) return [];
  const commaParts = normalized.split(",").map((item) => item.trim()).filter(Boolean);
  if (commaParts.length === 2) return commaParts;
  const numberTokens = normalized.match(/[+-]?\d+(?:\.\d+)?/g) || [];
  if (numberTokens.length === 2) return [numberTokens[0], numberTokens[1]];
  if (numberTokens.length === 4) {
    return [
      `${numberTokens[0]} ${numberTokens[1]}`,
      `${numberTokens[2]} ${numberTokens[3]}`
    ];
  }
  if (numberTokens.length >= 6) {
    return [
      `${numberTokens[0]} ${numberTokens[1]} ${numberTokens[2]}`,
      `${numberTokens[3]} ${numberTokens[4]} ${numberTokens[5]}`
    ];
  }
  return [];
}

function resolveCoordinateOrder(first, second) {
  if (isChinaLongitude(first) && isChinaLatitude(second)) {
    return { longitude: first, latitude: second, order: "lnglat" };
  }
  if (isChinaLatitude(first) && isChinaLongitude(second)) {
    return { longitude: second, latitude: first, order: "latlng" };
  }
  return null;
}

function parseCoordinateSearchKeyword(input = "") {
  const trimmed = `${input || ""}`.trim();
  if (!trimmed) return null;
  const parts = splitCoordinateInput(trimmed);
  if (parts.length !== 2) return null;
  const first = parseSingleSegment(parts[0]);
  const second = parseSingleSegment(parts[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  const resolved = resolveCoordinateOrder(first, second);
  if (!resolved) return null;
  return {
    keyword: trimmed,
    latitude: resolved.latitude,
    longitude: resolved.longitude,
    order: resolved.order,
    title: buildCoordinateTitle(resolved)
  };
}

function buildCoordinateSuggestion(result = {}) {
  if (!Number.isFinite(result.latitude) || !Number.isFinite(result.longitude)) {
    return null;
  }
  return {
    id: `coordinate-${formatCoordinate(result.longitude)}-${formatCoordinate(result.latitude)}`,
    title: result.title || buildCoordinateTitle(result),
    address: "",
    latitude: result.latitude,
    longitude: result.longitude,
    source: "coordinate",
    coordinatePayload: {
      latitude: result.latitude,
      longitude: result.longitude,
      title: result.title || buildCoordinateTitle(result),
      keyword: result.keyword || ""
    }
  };
}

function convertParsedCoordinateToGcj02(result = {}, coordinateSystem = "gcj02") {
  const latitude = Number(result.latitude);
  const longitude = Number(result.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const normalized = `${coordinateSystem || "gcj02"}`.trim().toLowerCase();
  if (normalized === "wgs84") {
    return wgs84ToGcj02(longitude, latitude);
  }
  if (normalized === "bd09") {
    return bd09ToGcj02(longitude, latitude);
  }
  if (normalized === "cgcs2000") {
    return cgcs2000ToGcj02(longitude, latitude);
  }
  return { lng: longitude, lat: latitude };
}

module.exports = {
  parseCoordinateSearchKeyword,
  buildCoordinateSuggestion,
  buildCoordinateTitle,
  formatCoordinate,
  convertParsedCoordinateToGcj02,
  SEARCH_COORDINATE_TIPS_TEXT
};
