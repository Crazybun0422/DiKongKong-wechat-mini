const { clampMapScale, hasValidCoordinate } = require("./map-shared");

const decodeParamValue = (value) => {
  if (value === undefined || value === null) return "";
  const text = `${value}`.trim();
  if (!text) return "";
  try {
    return decodeURIComponent(text);
  } catch (err) {
    return text;
  }
};

const isTruthyFlag = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return ["1", "true", "yes", "y", "on", "share"].includes(normalized);
  }
  return false;
};

const parseSceneParams = (scene) => {
  if (!scene || typeof scene !== "string") {
    return {};
  }
  let decoded = scene;
  try {
    decoded = decodeURIComponent(scene);
  } catch (err) {
    decoded = `${scene}`;
  }
  decoded = decoded.replace(/\+/g, " ");
  const params = {};
  decoded.split(/[&,|]/).forEach((segment) => {
    const chunk = segment.trim();
    if (!chunk) return;
    let separatorIndex = chunk.indexOf("=");
    if (separatorIndex < 0) {
      separatorIndex = chunk.indexOf(":");
    }
    if (separatorIndex < 0) {
      params[chunk] = "";
      return;
    }
    const key = chunk.slice(0, separatorIndex).trim();
    const value = chunk.slice(separatorIndex + 1).trim();
    if (!key) return;
    params[key] = value;
  });
  return params;
};

const normalizeLaunchCenterShareOptions = (options = {}) => {
  const normalized = {
    active: false,
    latitude: null,
    longitude: null,
    scale: 15
  };
  if (!options || typeof options !== "object") {
    return normalized;
  }
  const readFromObject = (source) => {
    if (!source || typeof source !== "object") return null;
    const hasCenterKeys =
      source.clat !== undefined ||
      source.clng !== undefined ||
      source.centerLat !== undefined ||
      source.centerLng !== undefined;
    const explicitFlag = source.cs ?? source.centerShare ?? source.shareCenter ?? source.center;
    if (!hasCenterKeys && !isTruthyFlag(explicitFlag)) {
      return null;
    }
    const lat = Number(source.clat ?? source.centerLat ?? source.lat ?? source.latitude);
    const lng = Number(source.clng ?? source.centerLng ?? source.lng ?? source.longitude);
    if (!hasValidCoordinate(lat, lng)) {
      return null;
    }
    const scaleRaw = Number(source.cscale ?? source.zoom ?? source.scale);
    return {
      latitude: lat,
      longitude: lng,
      scale: Number.isFinite(scaleRaw) ? scaleRaw : normalized.scale
    };
  };
  const applyPayload = (payload) => {
    if (!payload) return false;
    normalized.active = true;
    normalized.latitude = payload.latitude;
    normalized.longitude = payload.longitude;
    normalized.scale = clampMapScale(payload.scale);
    return true;
  };
  if (applyPayload(readFromObject(options))) {
    return normalized;
  }
  if (applyPayload(readFromObject(options.query))) {
    return normalized;
  }
  if (applyPayload(readFromObject(parseSceneParams(options.scene)))) {
    return normalized;
  }
  if (typeof options.q === "string" && options.q.trim()) {
    const decoded = decodeParamValue(options.q);
    const queryIndex = decoded.indexOf("?");
    const queryString = queryIndex >= 0 ? decoded.slice(queryIndex + 1) : decoded;
    const qParams = parseSceneParams(queryString);
    if (applyPayload(readFromObject(qParams))) {
      return normalized;
    }
  }
  return normalized;
};

module.exports = {
  decodeParamValue,
  isTruthyFlag,
  parseSceneParams,
  normalizeLaunchCenterShareOptions
};
