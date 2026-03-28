const DEFAULT_CENTER = {
  latitude: 39.908823,
  longitude: 116.39747
};

const MAP_MIN_SCALE = 0;
const MAP_MAX_SCALE = 18;
const DEFAULT_MAP_SCALE = 11;
const DEFAULT_SCALE_BAR_BASE_RPX = 80;
const MARKER_FETCH_SCALE_LIMIT_METERS = 5000;
const MIN_CENTER_SYNC_METERS = 6;
const CENTER_PIN_FOLLOW_TIP_TEXT = "长按解除绑定状态~";
const DEFAULT_MAP_CHECKIN_ENTRY_STYLE =
  "top: calc(env(safe-area-inset-top) + 96rpx); right: 24rpx; width: 150rpx; height: 50rpx;";
const MAP_COMPASS_ROTATE_THRESHOLD = 1;
const MAP_COMPASS_ROTATE_SYNC_DELTA = 1;
const MAP_COMPASS_SKEW_SYNC_DELTA = 0.5;
const ADD_MINI_APP_SUPPRESS_SECONDS = 72 * 60 * 60;
const ADD_MINI_APP_CHECK_DELAY_MS = 2000;

const hasValidCoordinate = (lat, lng) =>
  Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

const clampMapScale = (value) => {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : DEFAULT_MAP_SCALE;
  const rounded = Math.round(base);
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, rounded));
};

const clampMapScaleFloat = (value) => {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : DEFAULT_MAP_SCALE;
  return Math.min(MAP_MAX_SCALE, Math.max(MAP_MIN_SCALE, base));
};

const applyMapStatusBarStyle = () => {
  if (typeof wx === "undefined" || typeof wx.setNavigationBarColor !== "function") {
    return;
  }
  wx.setNavigationBarColor({
    frontColor: "#000000",
    backgroundColor: "#ffffff",
    animation: { duration: 0, timingFunc: "linear" }
  });
};

module.exports = {
  DEFAULT_CENTER,
  MAP_MIN_SCALE,
  MAP_MAX_SCALE,
  DEFAULT_MAP_SCALE,
  DEFAULT_SCALE_BAR_BASE_RPX,
  MARKER_FETCH_SCALE_LIMIT_METERS,
  MIN_CENTER_SYNC_METERS,
  CENTER_PIN_FOLLOW_TIP_TEXT,
  DEFAULT_MAP_CHECKIN_ENTRY_STYLE,
  MAP_COMPASS_ROTATE_THRESHOLD,
  MAP_COMPASS_ROTATE_SYNC_DELTA,
  MAP_COMPASS_SKEW_SYNC_DELTA,
  ADD_MINI_APP_SUPPRESS_SECONDS,
  ADD_MINI_APP_CHECK_DELAY_MS,
  hasValidCoordinate,
  clampMapScale,
  clampMapScaleFloat,
  applyMapStatusBarStyle
};
