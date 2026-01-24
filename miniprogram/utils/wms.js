const {
  tileXYToBBOX3857,
  mercatorToLonLat,
  lonLatToMercator,
  wgs84ToGcj02,
  gcj02ToWgs84
} = require("./coords");
const { CAAC_TOKEN } = require("./config");

const WMS_MIN_ZOOM = 5;
const WMS_MAX_ZOOM = 18;
const DEFAULT_WMS_TILE_SIZE = 256;
const MAX_WMS_TILE_SIZE = 512;
const DEFAULT_WMS_FORMAT = "image/png";
const DEFAULT_WMS_MAX_SPAN = 6;
const DEFAULT_WMS_MAX_TILES = 81;

function normalizeTilePadding(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(6, Math.max(0, Math.round(num)));
}

function normalizeTileSpan(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(20, Math.max(2, Math.round(num)));
}

function normalizeTileCount(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(400, Math.max(9, Math.round(num)));
}

function clampSpanAroundCenter(min, max, targetSpan) {
  const span = Math.max(1, Math.round(targetSpan));
  const mid = Math.floor((min + max) / 2);
  const half = Math.floor(span / 2);
  let nextMin = mid - half;
  let nextMax = nextMin + span - 1;
  return { min: nextMin, max: nextMax };
}

function normalizeTileSize(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  const rounded = Math.round(num);
  return Math.min(MAX_WMS_TILE_SIZE, Math.max(64, rounded));
}

function lonLatToTile(lng, lat, zoom) {
  const scale = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * scale);
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y = Math.floor(
    (0.5 -
      Math.log((1 + sinLat) / (1 - sinLat)) /
      (4 * Math.PI)) *
    scale
  );
  return { x, y };
}

// Build WMS overlays covering region bounds (GCJ-02), aligning CAAC (WGS84/3857) to GCJ with bbox shift
function buildWmsOverlay(center, zoom, region, options = {}) {
  if (!center || zoom < WMS_MIN_ZOOM || zoom > WMS_MAX_ZOOM) {
    return [];
  }
  // compute tile range: if region provided, use it; else build a 3x3 grid around center
  const base = "https://uom.caac.gov.cn/map/airspace/wms";
  const { layers, styles } = buildProvinceLayers();
  const tileSize = normalizeTileSize(options.tileSize, DEFAULT_WMS_TILE_SIZE);
  const maskSize = normalizeTileSize(options.maskSize, DEFAULT_WMS_TILE_SIZE);
  const format = options.format || DEFAULT_WMS_FORMAT;
  const paddingTiles = normalizeTilePadding(options.paddingTiles);
  const maxSpan = normalizeTileSpan(options.maxSpan, DEFAULT_WMS_MAX_SPAN);
  const maxTiles = normalizeTileCount(options.maxTiles, DEFAULT_WMS_MAX_TILES);
  const tiles = [];
  let xMin, xMax, yMin, yMax;
  if (region && region.northeast && region.southwest) {
    const ne = region.northeast;
    const sw = region.southwest;
    const wgsNE = gcj02ToWgs84(ne.longitude, ne.latitude);
    const wgsSW = gcj02ToWgs84(sw.longitude, sw.latitude);
    const tNE = lonLatToTile(wgsNE.lng, wgsNE.lat, zoom);
    const tSW = lonLatToTile(wgsSW.lng, wgsSW.lat, zoom);
    xMin = Math.min(tNE.x, tSW.x);
    xMax = Math.max(tNE.x, tSW.x);
    yMin = Math.min(tNE.y, tSW.y);
    yMax = Math.max(tNE.y, tSW.y);
    if (paddingTiles) {
      xMin -= paddingTiles;
      xMax += paddingTiles;
      yMin -= paddingTiles;
      yMax += paddingTiles;
    }
    // hard cap to avoid too many overlays
    if (xMax - xMin > maxSpan) {
      const clamped = clampSpanAroundCenter(xMin, xMax, maxSpan + 1);
      xMin = clamped.min;
      xMax = clamped.max;
    }
    if (yMax - yMin > maxSpan) {
      const clamped = clampSpanAroundCenter(yMin, yMax, maxSpan + 1);
      yMin = clamped.min;
      yMax = clamped.max;
    }
  } else {
    const { longitude: lng, latitude: lat } = center;
    const wgsCenter = gcj02ToWgs84(lng, lat);
    const t = lonLatToTile(wgsCenter.lng, wgsCenter.lat, zoom);
    xMin = t.x - 1; xMax = t.x + 1;
    yMin = t.y - 1; yMax = t.y + 1;
    if (paddingTiles) {
      xMin -= paddingTiles;
      xMax += paddingTiles;
      yMin -= paddingTiles;
      yMax += paddingTiles;
    }
  }

  let xSpan = xMax - xMin + 1;
  let ySpan = yMax - yMin + 1;
  if (maxTiles && xSpan > 0 && ySpan > 0 && xSpan * ySpan > maxTiles) {
    while (xSpan * ySpan > maxTiles && (xSpan > 1 || ySpan > 1)) {
      if (xSpan >= ySpan && xSpan > 1) {
        xSpan -= 1;
      } else if (ySpan > 1) {
        ySpan -= 1;
      } else {
        break;
      }
    }
    const nextX = clampSpanAroundCenter(xMin, xMax, xSpan);
    const nextY = clampSpanAroundCenter(yMin, yMax, ySpan);
    xMin = nextX.min;
    xMax = nextX.max;
    yMin = nextY.min;
    yMax = nextY.max;
  }

  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      const bbox = tileXYToBBOX3857(x, y, zoom);
      // GCJ alignment: compute dx/dy in meters in 3857 at tile center
      const cx = (bbox[0] + bbox[2]) / 2;
      const cy = (bbox[1] + bbox[3]) / 2;
      const cWgs = mercatorToLonLat(cx, cy);
      const cGcj = wgs84ToGcj02(cWgs.lng, cWgs.lat);
      const mWgs = lonLatToMercator(cWgs.lng, cWgs.lat);
      const mGcj = lonLatToMercator(cGcj.lng, cGcj.lat);
      const dx = mGcj.x - mWgs.x;
      const dy = mGcj.y - mWgs.y;
      const reqBBox = [bbox[0] - dx, bbox[1] - dy, bbox[2] - dx, bbox[3] - dy];

      const queryParams = {
        token: CAAC_TOKEN,
        service: "WMS",
        request: "GetMap",
        layers,
        styles,
        format,
        transparent: "true",
        version: "1.1.0",
        srs: "EPSG:3857",
        width: `${tileSize}`,
        height: `${tileSize}`,
        bbox: reqBBox.join(",")
      };
      const q = toQuery(queryParams);

      // Bounds for overlay must be in GCJ-02
      const wgsSW = mercatorToLonLat(reqBBox[0], reqBBox[1]);
      const wgsNE = mercatorToLonLat(reqBBox[2], reqBBox[3]);
      const gcjSW = wgs84ToGcj02(wgsSW.lng, wgsSW.lat);
      const gcjNE = wgs84ToGcj02(wgsNE.lng, wgsNE.lat);

      tiles.push({
        id: `${zoom}-${x}-${y}`,
        src: `${base}?${q}`,
        bounds: {
          southwest: { longitude: gcjSW.lng, latitude: gcjSW.lat },
          northeast: { longitude: gcjNE.lng, latitude: gcjNE.lat }
        },
        alpha: 0.65,
        opacity: 0.65,
        zIndex: 1,
        maskSize
      });
    }
  }
  return tiles;
}

function buildProvinceLayers() {
  const PROVINCE_CODES = [
    "12",
    "13",
    "14",
    "15",
    "21",
    "22",
    "23",
    "31",
    "32",
    "33",
    "34",
    "35",
    "36",
    "37",
    "41",
    "42",
    "43",
    "44",
    "45",
    "46",
    "50",
    "51",
    "52",
    "53",
    "54",
    "61",
    "62",
    "63",
    "64",
    "65"
  ];
  const layers = PROVINCE_CODES.map((c) => `QGSFKYFW:sf${c}0000`).join(",");
  const styles = PROVINCE_CODES.map(() => "QGSFKYFW:shifeikongyu").join(",");
  return { layers, styles };
}

function toQuery(params) {
  return Object.keys(params)
    .map((key) => `${key}=${encodeURIComponent(params[key])}`)
    .join("&");
}

module.exports = {
  buildWmsOverlay,
  WMS_MIN_ZOOM,
  WMS_MAX_ZOOM
};
