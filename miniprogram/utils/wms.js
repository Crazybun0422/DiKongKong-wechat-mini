const {
  tileXYToBBOX3857,
  mercatorToLonLat,
  lonLatToMercator,
  gcj02ToWgs84
} = require("./coords");
const { CAAC_TOKEN } = require("./config");

const WMS_MIN_ZOOM = 6;
const WMS_MAX_ZOOM = 18;
const DEFAULT_WMS_TILE_SIZE = 256;
const WEB_TILE_SIZE = 256;
const DEFAULT_VIEWPORT_WIDTH = 375;
const DEFAULT_VIEWPORT_HEIGHT = 667;
const MAX_WMS_TILE_SIZE = 512;
const DEFAULT_WMS_FORMAT = "image/png";

function normalizeTileSize(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  const rounded = Math.round(num);
  return Math.min(MAX_WMS_TILE_SIZE, Math.max(64, rounded));
}

function lonLatToTileFloat(lng, lat, zoom) {
  const scale = Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * scale;
  const sinLat = Math.sin((lat * Math.PI) / 180);
  const y =
    (0.5 -
      Math.log((1 + sinLat) / (1 - sinLat)) /
      (4 * Math.PI)) *
    scale;
  return { x, y };
}

// Build WMS overlays centered on GCJ center, covering the viewport.
function buildWmsOverlay(center, zoom, region, options = {}) {
  if (!center || zoom < WMS_MIN_ZOOM || zoom > WMS_MAX_ZOOM) {
    return [];
  }
  const centerLng = Number(center.longitude);
  const centerLat = Number(center.latitude);
  if (!Number.isFinite(centerLng) || !Number.isFinite(centerLat)) {
    return [];
  }
  const base = "https://uom.caac.gov.cn/map/airspace/wms";
  const { layers, styles } = buildProvinceLayers();
  const tileSize = normalizeTileSize(options.tileSize, DEFAULT_WMS_TILE_SIZE);
  const maskSize = normalizeTileSize(options.maskSize, DEFAULT_WMS_TILE_SIZE);
  const format = options.format || DEFAULT_WMS_FORMAT;
  const tiles = [];
  const maxIndex = Math.pow(2, zoom) - 1;
  const centerTileFloat = lonLatToTileFloat(centerLng, centerLat, zoom);
  const centerTile = {
    x: Math.floor(centerTileFloat.x),
    y: Math.floor(centerTileFloat.y)
  };
  const viewportWidth = Number.isFinite(options.viewportWidth)
    ? options.viewportWidth
    : DEFAULT_VIEWPORT_WIDTH;
  const viewportHeight = Number.isFinite(options.viewportHeight)
    ? options.viewportHeight
    : DEFAULT_VIEWPORT_HEIGHT;
  const viewportPaddingPx = Number.isFinite(options.viewportPaddingPx)
    ? options.viewportPaddingPx
    : 0;
  const effectiveWidth = viewportWidth + viewportPaddingPx * 2;
  const effectiveHeight = viewportHeight + viewportPaddingPx * 2;
  let tilesX = Math.ceil(effectiveWidth / WEB_TILE_SIZE);
  let tilesY = Math.ceil(effectiveHeight / WEB_TILE_SIZE);
  if (tilesX % 2 === 0) tilesX += 1;
  if (tilesY % 2 === 0) tilesY += 1;
  let xMin = Math.round(centerTileFloat.x - tilesX / 2);
  let xMax = xMin + tilesX - 1;
  let yMin = Math.round(centerTileFloat.y - tilesY / 2);
  let yMax = yMin + tilesY - 1;
  xMin = Math.max(0, xMin);
  yMin = Math.max(0, yMin);
  xMax = Math.min(maxIndex, xMax);
  yMax = Math.min(maxIndex, yMax);
  if (xMin > xMax || yMin > yMax) {
    return [];
  }

  const tileCoords = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      tileCoords.push({ x, y });
    }
  }

  if (centerTile && tileCoords.length > 1) {
    tileCoords.sort((a, b) => {
      const dxA = a.x - centerTile.x;
      const dyA = a.y - centerTile.y;
      const dxB = b.x - centerTile.x;
      const dyB = b.y - centerTile.y;
      return dxA * dxA + dyA * dyA - (dxB * dxB + dyB * dyB);
    });
  }

  tileCoords.forEach(({ x, y }) => {
    const bbox = tileXYToBBOX3857(x, y, zoom);
    const gcjSW = mercatorToLonLat(bbox[0], bbox[1]);
    const gcjNE = mercatorToLonLat(bbox[2], bbox[3]);
    if (!gcjSW || !gcjNE) return;
    const wgsSW = gcj02ToWgs84(gcjSW.lng, gcjSW.lat);
    const wgsNE = gcj02ToWgs84(gcjNE.lng, gcjNE.lat);
    if (!wgsSW || !wgsNE) return;
    const mSW = lonLatToMercator(wgsSW.lng, wgsSW.lat);
    const mNE = lonLatToMercator(wgsNE.lng, wgsNE.lat);
    const reqBBox = [
      Math.min(mSW.x, mNE.x),
      Math.min(mSW.y, mNE.y),
      Math.max(mSW.x, mNE.x),
      Math.max(mSW.y, mNE.y)
    ];

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
  });
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
