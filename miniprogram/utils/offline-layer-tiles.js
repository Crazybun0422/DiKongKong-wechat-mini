const { resolveApiBase } = require("./profile");
const {
  tileXYToBBOX3857,
  mercatorToLonLat,
  gcj02ToWgs84,
  wgs84ToGcj02,
  cgcs2000ToGcj02
} = require("./coords");

const CATALOG_PATH = "/api/offline-layer-tiles/catalog";
const DEFAULT_LAYER_KEY = "collected_exact_geojson_merged_geojson_tiles";
const DEFAULT_MIN_ZOOM = 4;
const DEFAULT_MAX_ZOOM = 13;
const DEFAULT_TILE_SIZE = 256;
const DEFAULT_VIEWPORT_WIDTH = 375;
const DEFAULT_VIEWPORT_HEIGHT = 667;
const WEB_TILE_SIZE = 256;
const SQUARE_VIEWPORT_ASPECT_THRESHOLD = 1.15;

let catalogCache = null;
let catalogPromise = null;
let catalogBase = "";

function getAppInstance() {
  try {
    return getApp ? getApp() : null;
  } catch (err) {
    return null;
  }
}

function resolveOfflineTileAssetBase() {
  const app = getAppInstance();
  const guideAssetBase = `${app?.globalData?.guideAssetBase || ""}`.trim();
  if (guideAssetBase) return guideAssetBase.replace(/\/+$/, "");
  return "https://www.skylane.cn";
}

function normalizeRenderColorToVariant(value) {
  const normalized = `${value || ""}`.trim().toUpperCase();
  if (!normalized || normalized === "DEFAULT" || normalized === "#01F4F4") {
    return "current";
  }
  if (normalized === "#34C759") {
    return "green";
  }
  if (normalized === "#FFB800") {
    return "gold";
  }
  if (normalized === "#FF5A5F") {
    return "coral";
  }
  return "current";
}

function normalizeTileSize(value, fallback = DEFAULT_TILE_SIZE) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(64, Math.min(DEFAULT_TILE_SIZE, Math.round(numeric)));
}

function normalizeZoom(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(numeric);
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

function fillUrlTemplate(urlTemplate, zoom, tileX, tileY) {
  const template = normalizeTileUrlTemplate(urlTemplate);
  if (!template) return "";
  return template
    .replace(/\{z\}/gi, `${zoom}`)
    .replace(/\{x\}/gi, `${tileX}`)
    .replace(/\{y\}/gi, `${tileY}`);
}

function normalizeTileUrlTemplate(value) {
  const template = `${value || ""}`.trim();
  if (!template) return "";
  const assetBase = resolveOfflineTileAssetBase();
  if (/^https?:\/\//i.test(template)) {
    return template.replace(/^https?:\/\/cdn\.skylane\.cn(?=\/|$)/i, assetBase);
  }
  if (template.startsWith("/")) {
    return `${assetBase}${template}`;
  }
  return `${assetBase}/${template.replace(/^\/+/, "")}`;
}

function normalizeTileCoordSystem(value) {
  const normalized = `${value || ""}`.trim().toLowerCase();
  if (!normalized) return "gcj02";
  if (normalized === "wgs" || normalized === "wgs84" || normalized === "epsg:4326") {
    return "wgs84";
  }
  if (normalized === "cgcs2000" || normalized === "epsg:4490") {
    return "cgcs2000";
  }
  return "gcj02";
}

function convertDisplayCenterToTileCoord(center, tileCoordSystem) {
  if (!center) return null;
  const longitude = Number(center.longitude);
  const latitude = Number(center.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }
  const normalized = normalizeTileCoordSystem(tileCoordSystem);
  if (normalized === "wgs84" || normalized === "cgcs2000") {
    const wgs = gcj02ToWgs84(longitude, latitude);
    return { longitude: wgs.lng, latitude: wgs.lat };
  }
  return { longitude, latitude };
}

function convertTileCoordToDisplayPoint(point, tileCoordSystem) {
  if (!point) return null;
  const longitude = Number(point.longitude);
  const latitude = Number(point.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }
  const normalized = normalizeTileCoordSystem(tileCoordSystem);
  if (normalized === "wgs84") {
    const gcj = wgs84ToGcj02(longitude, latitude);
    return { longitude: gcj.lng, latitude: gcj.lat };
  }
  if (normalized === "cgcs2000") {
    const gcj = cgcs2000ToGcj02(longitude, latitude);
    return { longitude: gcj.lng, latitude: gcj.lat };
  }
  return { longitude, latitude };
}

function resolveLayerTileCatalog(options = {}) {
  const apiBase = resolveApiBase(options.apiBase);
  if (!apiBase) {
    return Promise.reject(new Error("missing-api-base"));
  }
  if (catalogCache && catalogBase === apiBase && options.forceRefresh !== true) {
    return Promise.resolve(catalogCache);
  }
  if (catalogPromise && catalogBase === apiBase && options.forceRefresh !== true) {
    return catalogPromise;
  }
  catalogBase = apiBase;
  catalogPromise = new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase}${CATALOG_PATH}`,
      method: "GET",
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.data?.data) {
          catalogCache = res.data.data;
          resolve(catalogCache);
          return;
        }
        reject(new Error(`catalog-status-${res.statusCode || 0}`));
      },
      fail: (err) => reject(err || new Error("catalog-request-failed"))
    });
  }).finally(() => {
    catalogPromise = null;
  });
  return catalogPromise;
}

function getCachedLayerTileCatalog() {
  return catalogCache;
}

function resolveCatalogLayer(options = {}) {
  const catalog = options.catalog || catalogCache;
  if (!catalog || !Array.isArray(catalog.layers) || !catalog.layers.length) return null;
  const preferredLayerKey = `${options.layerKey || DEFAULT_LAYER_KEY}`.trim();
  return (
    catalog.layers.find((item) => `${item?.layerKey || ""}`.trim() === preferredLayerKey)
    || catalog.layers[0]
    || null
  );
}

function resolveVariantEntry(renderColor, options = {}) {
  const layer = options.layer || resolveCatalogLayer(options);
  if (!layer || !Array.isArray(layer.variants) || !layer.variants.length) return null;
  const variantColor = normalizeRenderColorToVariant(renderColor);
  return (
    layer.variants.find((item) => `${item?.color || ""}`.trim().toLowerCase() === variantColor)
    || layer.variants.find((item) => `${item?.color || ""}`.trim().toLowerCase() === "current")
    || layer.variants[0]
    || null
  );
}

function resolveVariantUrlTemplate(renderColor, options = {}) {
  const variant = resolveVariantEntry(renderColor, options);
  return normalizeTileUrlTemplate(variant?.urlTemplate || "");
}

function getCachedLayerTileDescriptor(renderColor, options = {}) {
  const catalog = options.catalog || catalogCache;
  const layer = resolveCatalogLayer(Object.assign({}, options, { catalog }));
  if (!layer) return null;
  const variant = resolveVariantEntry(renderColor, Object.assign({}, options, { catalog, layer }));
  const minZoom = normalizeZoom(layer.minZoom, DEFAULT_MIN_ZOOM);
  const maxZoom = normalizeZoom(layer.maxZoom, DEFAULT_MAX_ZOOM);
  const tileSize = normalizeTileSize(layer.tileSize, DEFAULT_TILE_SIZE);
  const urlTemplate = normalizeTileUrlTemplate(variant?.urlTemplate || "");
  if (!urlTemplate) return null;
  return {
    layerKey: `${layer.layerKey || options.layerKey || DEFAULT_LAYER_KEY}`.trim(),
    variantColor: `${variant?.color || normalizeRenderColorToVariant(renderColor)}`.trim().toLowerCase(),
    urlTemplate,
    minZoom,
    maxZoom,
    tileSize,
    catalogVersion: `${catalog?.version || ""}`.trim(),
    tileCoordSystem: `${catalog?.tileCoordSystem || ""}`.trim()
  };
}

function resolveLayerTileDescriptor(renderColor, options = {}) {
  const cached = getCachedLayerTileDescriptor(renderColor, options);
  if (cached && options.forceRefresh !== true) {
    return Promise.resolve(cached);
  }
  return resolveLayerTileCatalog(options).then((catalog) => {
    const descriptor = getCachedLayerTileDescriptor(renderColor, Object.assign({}, options, { catalog }));
    if (!descriptor) {
      throw new Error("offline-layer-descriptor-missing");
    }
    return descriptor;
  });
}

function buildOfflineLayerTiles(center, zoom, region, options = {}) {
  const descriptor = options.descriptor || null;
  const minZoom = normalizeZoom(options.minZoom, normalizeZoom(descriptor?.minZoom, DEFAULT_MIN_ZOOM));
  const maxZoom = normalizeZoom(options.maxZoom, normalizeZoom(descriptor?.maxZoom, DEFAULT_MAX_ZOOM));
  if (!center || zoom < minZoom || zoom > maxZoom) {
    return [];
  }
  const tileCoordSystem = normalizeTileCoordSystem(options.tileCoordSystem || descriptor?.tileCoordSystem);
  const tileCenter = convertDisplayCenterToTileCoord(center, tileCoordSystem);
  const centerLng = Number(tileCenter?.longitude);
  const centerLat = Number(tileCenter?.latitude);
  if (!Number.isFinite(centerLng) || !Number.isFinite(centerLat)) {
    return [];
  }
  const urlTemplate = `${options.urlTemplate || descriptor?.urlTemplate || ""}`.trim();
  if (!urlTemplate) {
    return [];
  }
  const tileSize = normalizeTileSize(options.tileSize, normalizeTileSize(descriptor?.tileSize, DEFAULT_TILE_SIZE));
  const maskSize = normalizeTileSize(options.maskSize, tileSize);
  const tiles = [];
  const maxIndex = Math.pow(2, zoom) - 1;
  const centerTileFloat = lonLatToTileFloat(centerLng, centerLat, zoom);
  const centerTile = {
    x: Math.floor(centerTileFloat.x),
    y: Math.floor(centerTileFloat.y)
  };
  const viewportWidth = Number.isFinite(options.viewportWidth) ? options.viewportWidth : DEFAULT_VIEWPORT_WIDTH;
  const viewportHeight = Number.isFinite(options.viewportHeight) ? options.viewportHeight : DEFAULT_VIEWPORT_HEIGHT;
  const viewportPaddingPx = Number.isFinite(options.viewportPaddingPx) ? options.viewportPaddingPx : 0;
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
  if (xRange.start > xRange.end || yRange.start > yRange.end) {
    return [];
  }

  const tileCoords = [];
  for (let x = xRange.start; x <= xRange.end; x += 1) {
    for (let y = yRange.start; y <= yRange.end; y += 1) {
      tileCoords.push({ x, y });
    }
  }

  if (tileCoords.length > 1) {
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
    const sourceSouthwest = mercatorToLonLat(bbox[0], bbox[1]);
    const sourceNortheast = mercatorToLonLat(bbox[2], bbox[3]);
    if (!sourceSouthwest || !sourceNortheast) return;
    const southwest = convertTileCoordToDisplayPoint(
      { longitude: sourceSouthwest.lng, latitude: sourceSouthwest.lat },
      tileCoordSystem
    );
    const northeast = convertTileCoordToDisplayPoint(
      { longitude: sourceNortheast.lng, latitude: sourceNortheast.lat },
      tileCoordSystem
    );
    if (!southwest || !northeast) return;
    const src = fillUrlTemplate(urlTemplate, zoom, x, y);
    if (!src) return;
    tiles.push({
      id: `${zoom}-${x}-${y}`,
      src,
      bounds: {
        southwest: { longitude: southwest.longitude, latitude: southwest.latitude },
        northeast: { longitude: northeast.longitude, latitude: northeast.latitude }
      },
      alpha: Number.isFinite(Number(options.alpha)) ? Number(options.alpha) : 0.65,
      opacity: Number.isFinite(Number(options.opacity)) ? Number(options.opacity) : 0.65,
      zIndex: Number.isFinite(Number(options.zIndex)) ? Number(options.zIndex) : 1,
      maskSize
    });
  });

  return tiles;
}

module.exports = {
  DEFAULT_LAYER_KEY,
  DEFAULT_MIN_ZOOM,
  DEFAULT_MAX_ZOOM,
  DEFAULT_TILE_SIZE,
  normalizeRenderColorToVariant,
  resolveLayerTileCatalog,
  getCachedLayerTileCatalog,
  resolveVariantUrlTemplate,
  getCachedLayerTileDescriptor,
  resolveLayerTileDescriptor,
  buildOfflineLayerTiles,
  fillUrlTemplate
};
