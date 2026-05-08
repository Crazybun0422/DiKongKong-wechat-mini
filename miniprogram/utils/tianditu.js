const {
  gcj02ToWgs84,
  wgs84ToGcj02
} = require("./coords");

const TIANDITU_SATELLITE_KEY = "527ee77a80db0a8548b2f8bde9cce690";
const TIANDITU_SATELLITE_WMTS_BASE = "https://t4.tianditu.gov.cn/img_w/wmts";
const TIANDITU_MIN_ZOOM = 3;
const TIANDITU_MAX_ZOOM = 18;
const WEB_TILE_SIZE = 256;
const DEFAULT_VIEWPORT_WIDTH = 375;
const DEFAULT_VIEWPORT_HEIGHT = 667;
const DEFAULT_VIEWPORT_PADDING_PX = 96;
const DEFAULT_MAX_TILES = 36;

function clampTiandituZoom(value) {
  const numeric = Number(value);
  const rounded = Number.isFinite(numeric) ? Math.round(numeric) : 11;
  return Math.max(TIANDITU_MIN_ZOOM, Math.min(TIANDITU_MAX_ZOOM, rounded));
}

function lonLatToTileFloat(lng, lat, zoom) {
  const scale = Math.pow(2, zoom);
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
  const x = ((Number(lng) + 180) / 360) * scale;
  const sinLat = Math.sin((safeLat * Math.PI) / 180);
  const y =
    (0.5 -
      Math.log((1 + sinLat) / (1 - sinLat)) /
      (4 * Math.PI)) *
    scale;
  return { x, y };
}

function tileXYToLonLat(x, y, zoom) {
  const scale = Math.pow(2, zoom);
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lng, lat };
}

function buildCenteredRange(centerIndex, count, maxIndex) {
  const size = Math.max(1, Math.round(count));
  let start = centerIndex - Math.floor(size / 2);
  let end = start + size - 1;
  if (start < 0) {
    end = Math.min(maxIndex, end - start);
    start = 0;
  }
  if (end > maxIndex) {
    start = Math.max(0, start - (end - maxIndex));
    end = maxIndex;
  }
  return { start, end };
}

function limitTileCounts(rawTilesX, rawTilesY, maxTiles, maxIndex) {
  const worldSide = Math.max(1, maxIndex + 1);
  let tilesX = Math.max(1, Math.min(worldSide, Math.round(rawTilesX)));
  let tilesY = Math.max(1, Math.min(worldSide, Math.round(rawTilesY)));
  const limit = Number(maxTiles);
  if (Number.isFinite(limit) && limit > 0) {
    while (tilesX * tilesY > limit && (tilesX > 1 || tilesY > 1)) {
      if (tilesX >= tilesY && tilesX > 1) {
        tilesX -= 1;
      } else if (tilesY > 1) {
        tilesY -= 1;
      } else {
        break;
      }
    }
  }
  return { tilesX, tilesY };
}

function normalizeDisplayBounds(swWgs, neWgs) {
  const swGcj = wgs84ToGcj02(swWgs.lng, swWgs.lat);
  const neGcj = wgs84ToGcj02(neWgs.lng, neWgs.lat);
  const minLat = Math.min(swGcj.lat, neGcj.lat);
  const maxLat = Math.max(swGcj.lat, neGcj.lat);
  const minLng = Math.min(swGcj.lng, neGcj.lng);
  const maxLng = Math.max(swGcj.lng, neGcj.lng);
  return {
    southwest: { longitude: minLng, latitude: minLat },
    northeast: { longitude: maxLng, latitude: maxLat }
  };
}

function buildTiandituSatelliteUrl(x, y, zoom, options = {}) {
  const base = options.base || TIANDITU_SATELLITE_WMTS_BASE;
  const key = options.key || TIANDITU_SATELLITE_KEY;
  const params = {
    SERVICE: "WMTS",
    REQUEST: "GetTile",
    VERSION: "1.0.0",
    LAYER: "img",
    STYLE: "default",
    TILEMATRIXSET: "w",
    FORMAT: "tiles",
    TILEMATRIX: `${zoom}`,
    TILEROW: `${y}`,
    TILECOL: `${x}`,
    tk: key
  };
  const query = Object.keys(params)
    .map((name) => `${name}=${encodeURIComponent(params[name])}`)
    .join("&");
  return `${base}?${query}`;
}

function buildTiandituSatelliteOverlays(center, zoom, region, options = {}) {
  const centerLng = Number(center?.longitude);
  const centerLat = Number(center?.latitude);
  if (!Number.isFinite(centerLng) || !Number.isFinite(centerLat)) return [];
  const resolvedZoom = clampTiandituZoom(zoom);
  const centerWgs = gcj02ToWgs84(centerLng, centerLat);
  const centerTileFloat = lonLatToTileFloat(centerWgs.lng, centerWgs.lat, resolvedZoom);
  const maxIndex = Math.pow(2, resolvedZoom) - 1;
  const centerTile = {
    x: Math.max(0, Math.min(maxIndex, Math.floor(centerTileFloat.x))),
    y: Math.max(0, Math.min(maxIndex, Math.floor(centerTileFloat.y)))
  };
  const viewportWidth = Number.isFinite(options.viewportWidth)
    ? options.viewportWidth
    : DEFAULT_VIEWPORT_WIDTH;
  const viewportHeight = Number.isFinite(options.viewportHeight)
    ? options.viewportHeight
    : DEFAULT_VIEWPORT_HEIGHT;
  const viewportPaddingPx = Number.isFinite(options.viewportPaddingPx)
    ? options.viewportPaddingPx
    : DEFAULT_VIEWPORT_PADDING_PX;
  const rawTilesX = Math.ceil((viewportWidth + viewportPaddingPx * 2) / WEB_TILE_SIZE) + 1;
  const rawTilesY = Math.ceil((viewportHeight + viewportPaddingPx * 2) / WEB_TILE_SIZE) + 1;
  const counts = limitTileCounts(rawTilesX, rawTilesY, options.maxTiles || DEFAULT_MAX_TILES, maxIndex);
  const xRange = buildCenteredRange(centerTile.x, counts.tilesX, maxIndex);
  const yRange = buildCenteredRange(centerTile.y, counts.tilesY, maxIndex);
  const overlays = [];

  for (let x = xRange.start; x <= xRange.end; x += 1) {
    for (let y = yRange.start; y <= yRange.end; y += 1) {
      const nw = tileXYToLonLat(x, y, resolvedZoom);
      const se = tileXYToLonLat(x + 1, y + 1, resolvedZoom);
      overlays.push({
        id: `tianditu-${resolvedZoom}-${x}-${y}`,
        src: buildTiandituSatelliteUrl(x, y, resolvedZoom, options),
        bounds: normalizeDisplayBounds(
          { lng: nw.lng, lat: se.lat },
          { lng: se.lng, lat: nw.lat }
        ),
        alpha: 1,
        zIndex: 0
      });
    }
  }
  return overlays;
}

module.exports = {
  TIANDITU_SATELLITE_KEY,
  TIANDITU_SATELLITE_WMTS_BASE,
  TIANDITU_MIN_ZOOM,
  TIANDITU_MAX_ZOOM,
  buildTiandituSatelliteOverlays,
  clampTiandituZoom
};
