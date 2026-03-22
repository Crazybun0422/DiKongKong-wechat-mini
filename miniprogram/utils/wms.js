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
const MAX_WMS_TILE_SIZE = 256;
const DEFAULT_WMS_FORMAT = "image/png";
const DEFAULT_LAYER_NAMESPACE = "QGSFKYFW";
const DEFAULT_STYLE_NAME = "shifeikongyu";
const SQUARE_VIEWPORT_ASPECT_THRESHOLD = 1.15;
const DEFAULT_PROVINCE_CODES = [
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

function tilePriorityDistance(tileX, tileY, centerTileFloat) {
  if (!centerTileFloat) return Number.POSITIVE_INFINITY;
  const minDx = centerTileFloat.x < tileX
    ? tileX - centerTileFloat.x
    : (centerTileFloat.x > tileX + 1 ? centerTileFloat.x - (tileX + 1) : 0);
  const minDy = centerTileFloat.y < tileY
    ? tileY - centerTileFloat.y
    : (centerTileFloat.y > tileY + 1 ? centerTileFloat.y - (tileY + 1) : 0);
  return minDx * minDx + minDy * minDy;
}

function normalizeSquareSide(baseSide, maxTiles, maxIndex) {
  let side = Number.isFinite(baseSide) ? Math.max(1, Math.round(baseSide)) : 1;
  const worldSide = Number.isFinite(maxIndex) ? maxIndex + 1 : side;
  if (Number.isFinite(maxTiles) && maxTiles > 0) {
    const limited = Math.floor(Math.sqrt(maxTiles));
    if (limited > 0) {
      side = Math.min(side, limited);
    }
  }
  if (Number.isFinite(worldSide) && worldSide > 0) {
    side = Math.min(side, worldSide);
  }
  return Math.max(1, side);
}

function normalizeRectangularTileCounts(rawTilesX, rawTilesY, maxTiles, maxIndex) {
  const worldSide = Number.isFinite(maxIndex) ? maxIndex + 1 : Number.POSITIVE_INFINITY;
  let tilesX = Number.isFinite(rawTilesX) ? Math.max(1, Math.round(rawTilesX)) : 1;
  let tilesY = Number.isFinite(rawTilesY) ? Math.max(1, Math.round(rawTilesY)) : 1;
  tilesX = Math.min(tilesX, worldSide);
  tilesY = Math.min(tilesY, worldSide);
  if (Number.isFinite(maxTiles) && maxTiles > 0) {
    const area = tilesX * tilesY;
    if (area > maxTiles) {
      const scale = Math.sqrt(maxTiles / area);
      tilesX = Math.max(1, Math.floor(tilesX * scale));
      tilesY = Math.max(1, Math.floor(tilesY * scale));
    }
    while (tilesX * tilesY > maxTiles && (tilesX > 1 || tilesY > 1)) {
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

function normalizeAxisSpan(value, maxIndex) {
  const span = Number(value);
  const worldSide = Number.isFinite(maxIndex) ? maxIndex + 1 : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(span) || span <= 0) return worldSide;
  return Math.max(1, Math.min(worldSide, Math.round(span)));
}

function resolveViewportTileShape(viewportWidth, viewportHeight, options = {}) {
  const explicitShape = `${options.viewportShape || ""}`.toLowerCase();
  if (explicitShape === "square") return "square";
  if (explicitShape === "rect" || explicitShape === "rectangle") return "rectangle";
  if (typeof options.forceSquareViewport === "boolean") {
    return options.forceSquareViewport ? "square" : "rectangle";
  }
  const width = Number.isFinite(viewportWidth) ? Math.max(1, viewportWidth) : DEFAULT_VIEWPORT_WIDTH;
  const height = Number.isFinite(viewportHeight) ? Math.max(1, viewportHeight) : DEFAULT_VIEWPORT_HEIGHT;
  const aspect = Math.max(width, height) / Math.max(1, Math.min(width, height));
  return aspect <= SQUARE_VIEWPORT_ASPECT_THRESHOLD ? "square" : "rectangle";
}

function buildCenteredAxisRange(centerIndex, centerFloat, side, maxIndex) {
  const size = Math.max(1, Math.round(side));
  const fractional = Number.isFinite(centerFloat) ? centerFloat - Math.floor(centerFloat) : 0.5;
  let before = Math.floor((size - 1) / 2);
  let after = size - before - 1;
  if (size % 2 === 0) {
    if (fractional < 0.5) {
      before = size / 2;
      after = size / 2 - 1;
    } else {
      before = size / 2 - 1;
      after = size / 2;
    }
  }
  let start = centerIndex - before;
  let end = centerIndex + after;
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
  const resolveLayerParams = typeof options.resolveLayerParams === "function"
    ? options.resolveLayerParams
    : null;
  const fallbackLayerParams = buildProvinceLayers(options);
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
  const paddingTiles = Math.max(0, Math.round(Number(options.paddingTiles) || 0));
  const maxSpan = normalizeAxisSpan(options.maxSpan, maxIndex);
  const effectiveWidth = viewportWidth + viewportPaddingPx * 2;
  const effectiveHeight = viewportHeight + viewportPaddingPx * 2;
  const rawTilesX = Math.max(1, Math.ceil(effectiveWidth / WEB_TILE_SIZE) + paddingTiles * 2);
  const rawTilesY = Math.max(1, Math.ceil(effectiveHeight / WEB_TILE_SIZE) + paddingTiles * 2);
  const viewportShape = resolveViewportTileShape(viewportWidth, viewportHeight, options);
  let tilesX = rawTilesX;
  let tilesY = rawTilesY;
  if (viewportShape === "square") {
    const squareSide = normalizeSquareSide(
      Math.max(rawTilesX, rawTilesY),
      Number(options.maxTiles),
      maxIndex
    );
    tilesX = squareSide;
    tilesY = squareSide;
  } else {
    const rect = normalizeRectangularTileCounts(
      rawTilesX,
      rawTilesY,
      Number(options.maxTiles),
      maxIndex
    );
    tilesX = rect.tilesX;
    tilesY = rect.tilesY;
  }
  tilesX = Math.max(1, Math.min(maxSpan, tilesX));
  tilesY = Math.max(1, Math.min(maxSpan, tilesY));
  const xRange = buildCenteredAxisRange(centerTile.x, centerTileFloat.x, tilesX, maxIndex);
  const yRange = buildCenteredAxisRange(centerTile.y, centerTileFloat.y, tilesY, maxIndex);
  const xMin = xRange.start;
  const xMax = xRange.end;
  const yMin = yRange.start;
  const yMax = yRange.end;
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
      const distA = tilePriorityDistance(a.x, a.y, centerTileFloat);
      const distB = tilePriorityDistance(b.x, b.y, centerTileFloat);
      if (Math.abs(distA - distB) > 1e-9) {
        return distA - distB;
      }
      const centerXA = a.x + 0.5;
      const centerYA = a.y + 0.5;
      const centerXB = b.x + 0.5;
      const centerYB = b.y + 0.5;
      const dxA = Math.abs(centerXA - centerTileFloat.x);
      const dyA = Math.abs(centerYA - centerTileFloat.y);
      const dxB = Math.abs(centerXB - centerTileFloat.x);
      const dyB = Math.abs(centerYB - centerTileFloat.y);
      if (Math.abs(dxA - dxB) > 1e-9) {
        return dxA - dxB;
      }
      if (Math.abs(dyA - dyB) > 1e-9) {
        return dyA - dyB;
      }
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
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
    const tileBounds = {
      southwest: { longitude: gcjSW.lng, latitude: gcjSW.lat },
      northeast: { longitude: gcjNE.lng, latitude: gcjNE.lat }
    };
    const layerParams = resolveLayerParams
      ? resolveLayerParams(tileBounds, {
        x,
        y,
        zoom,
        bounds: tileBounds,
        bbox3857: reqBBox
      })
      : fallbackLayerParams;
    const layers = `${layerParams?.layers || ""}`.trim();
    const styles = `${layerParams?.styles || ""}`.trim();
    if (!layers || !styles) return;

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
      bounds: tileBounds,
      alpha: 0.65,
      opacity: 0.65,
      zIndex: 1,
      maskSize,
      provinceCodes: Array.isArray(layerParams?.provinceCodes) ? layerParams.provinceCodes.slice() : []
    });
  });
  return tiles;
}

function buildProvinceLayers(options = {}) {
  const layerNamespace = options.layerNamespace || DEFAULT_LAYER_NAMESPACE;
  const styleName = options.styleName || DEFAULT_STYLE_NAME;
  const provinceCodes = Array.isArray(options.provinceCodes) && options.provinceCodes.length
    ? options.provinceCodes
    : DEFAULT_PROVINCE_CODES;
  const layers = provinceCodes.map((code) => `${layerNamespace}:sf${code}0000`).join(",");
  const styles = provinceCodes.map(() => `${layerNamespace}:${styleName}`).join(",");
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
