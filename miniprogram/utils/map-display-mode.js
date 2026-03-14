const DISPLAY_MODE_ICON_WITH_NAME = "ICON_WITH_NAME";
const DISPLAY_MODE_ICON_ONLY = "ICON_ONLY";
const DISPLAY_MODE_SMALL_ICON_ONLY = "SMALL_ICON_ONLY";
const DISPLAY_MODE_HIDDEN = "HIDDEN";

function normalizeDisplayMode(value) {
  const mode = `${value || ""}`.trim().toUpperCase();
  if (
    mode === DISPLAY_MODE_ICON_WITH_NAME ||
    mode === DISPLAY_MODE_ICON_ONLY ||
    mode === DISPLAY_MODE_SMALL_ICON_ONLY ||
    mode === DISPLAY_MODE_HIDDEN
  ) {
    return mode;
  }
  return "";
}

function normalizeScaleKey(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric);
}

function buildScaleRangeEntry(key, value) {
  const normalizedKey = `${key || ""}`.trim().toUpperCase();
  const mode = normalizeDisplayMode(value);
  if (!normalizedKey || !mode) return null;
  const presets = {
    UNDER_200: { min: 0, max: 199 },
    "200_TO_499": { min: 200, max: 499 },
    "500_TO_999": { min: 500, max: 999 },
    "1000_TO_1999": { min: 1000, max: 1999 },
    "2000_TO_4999": { min: 2000, max: 4999 },
    "5000_AND_ABOVE": { min: 5000, max: Number.POSITIVE_INFINITY }
  };
  if (presets[normalizedKey]) {
    return Object.assign({ mode }, presets[normalizedKey]);
  }
  const betweenMatch = normalizedKey.match(/^(\d+)_TO_(\d+)$/);
  if (betweenMatch) {
    const min = Number(betweenMatch[1]);
    const max = Number(betweenMatch[2]);
    if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
      return { min, max, mode };
    }
  }
  const underMatch = normalizedKey.match(/^UNDER_(\d+)$/);
  if (underMatch) {
    const max = Number(underMatch[1]) - 1;
    if (Number.isFinite(max) && max >= 0) {
      return { min: 0, max, mode };
    }
  }
  const aboveMatch = normalizedKey.match(/^(\d+)_AND_ABOVE$/);
  if (aboveMatch) {
    const min = Number(aboveMatch[1]);
    if (Number.isFinite(min) && min >= 0) {
      return { min, max: Number.POSITIVE_INFINITY, mode };
    }
  }
  const exactScale = normalizeScaleKey(normalizedKey);
  if (exactScale !== null) {
    return { min: exactScale, max: exactScale, mode };
  }
  return null;
}

function resolveDisplayModeFromMap(modes = {}, scaleInMeters) {
  if (!modes || typeof modes !== "object") return "";
  const requestedScale = normalizeScaleKey(scaleInMeters);
  const entries = Object.keys(modes)
    .map((key) => buildScaleRangeEntry(key, modes[key]))
    .filter(Boolean)
    .sort((a, b) => a.min - b.min);
  if (!entries.length) return "";
  if (requestedScale === null) {
    const defaultEntry = entries.find((item) => item.min <= 2000 && item.max >= 2000);
    return (defaultEntry || entries[0]).mode;
  }
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (requestedScale >= entry.min && requestedScale <= entry.max) {
      return entry.mode;
    }
  }
  if (requestedScale < entries[0].min) {
    return entries[0].mode;
  }
  return entries[entries.length - 1].mode;
}

function resolveMapDisplayMode(raw = {}, scaleInMeters) {
  return resolveDisplayModeFromMap(raw?.mapDisplayModes, scaleInMeters);
}

function getDisplayModeMarkerSize(mode, baseSize) {
  const numeric = Number(baseSize);
  const fallback = Number.isFinite(numeric) && numeric > 0 ? numeric : 32;
  if (mode === DISPLAY_MODE_SMALL_ICON_ONLY) {
    return Math.max(20, Math.round(fallback * 0.75));
  }
  return fallback;
}

module.exports = {
  DISPLAY_MODE_ICON_WITH_NAME,
  DISPLAY_MODE_ICON_ONLY,
  DISPLAY_MODE_SMALL_ICON_ONLY,
  DISPLAY_MODE_HIDDEN,
  normalizeDisplayMode,
  resolveMapDisplayMode,
  getDisplayModeMarkerSize
};
