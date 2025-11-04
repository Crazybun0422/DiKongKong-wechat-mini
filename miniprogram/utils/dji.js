const { wgs84ToGcj02 } = require("./coords");
const { DJI_PROXY } = require("./config");

const DEFAULT_LEVELS = "2,6,1,4,3,7,8,10";
const DEFAULT_DRONE = "spark";
const DJI_FLYSAFE_RECT_URL =
  "https://flysafe-api.dji.com/api/qep/geo/feedback/areas/in_rectangle";
const NFZ_FILL_ALPHA = 0.30;
const NFZ_SUBAREA_ALPHA_SCALE = 0.7;
const NFZ_STROKE_OPACITY = 0.95;
const NFZ_DEFAULT_COLOR = "#DE4329";

function fetchDjiAreas({ rect, levels, drone }) {
  return new Promise((resolve, reject) => {
    if (
      !rect ||
      rect.ltlat == null ||
      rect.ltlng == null ||
      rect.rblat == null ||
      rect.rblng == null
    ) {
      reject(new Error("Rectangle bounds required"));
      return;
    }
    const params = {
      ltlat: String(rect.ltlat),
      ltlng: String(rect.ltlng),
      rblat: String(rect.rblat),
      rblng: String(rect.rblng),
      zones_mode: "flysafe_website",
      level: levels || DEFAULT_LEVELS,
      drone: drone || DEFAULT_DRONE,
      country: "CN"
    };
    const qs = Object.keys(params)
      .map((k) => `${k}=${encodeURIComponent(params[k])}`)
      .join("&");
    const targetUrl = `${DJI_FLYSAFE_RECT_URL}?${qs}`;
    const requestUrl = DJI_PROXY
      ? `${DJI_PROXY}${encodeURIComponent(targetUrl)}`
      : targetUrl;

    wx.request({
      url: requestUrl,
      method: "GET",
      success(res) {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(
            new Error(
              `DJI request failed: ${res.statusCode} ${res.errMsg || ""}`
            )
          );
          return;
        }
        const body = res.data || {};
        const areas =
          body.areas ||
          body.data?.areas ||
          body.data?.data?.areas ||
          body.data?.zones ||
          [];
        resolve(Array.isArray(areas) ? areas : []);
      },
      fail(err) {
        reject(err);
      }
    });
  });
}

// 按外部（H5）实现对齐的调色板（忽略返回中的 color 字段）
const NFZ_PALETTE = {
  1: "#000000", // Authorization
  2: "#DE4329", // Restricted
  3: "#EE8815", // Enhanced warning
  4: "#FFCC00", // Warning
  6: "#979797", // Altitude limit
  7: "#37C4DB", // Regulation
  8: "#35C759", // Suitable
  10: "#A9D86E" // Scenic
};

function styleForLevel(level) {
  // console.log("color:", level)
  const color = NFZ_PALETTE[level] || NFZ_DEFAULT_COLOR;
  return {
    strokeColor: color,
    fillColor: color,
    strokeWidth: 1,
    level: level,
    fillAlphaScale: 1
  };
}

function normalizeHex(hex) {
  const h = hex || NFZ_DEFAULT_COLOR;
  return h.startsWith("#") ? h : `#${h}`;
}

function toAlphaHex(opacity) {
  const v = Math.max(0, Math.min(1, Number(opacity)));
  return Math.round(v * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

function levelFillOpacity(level, scale = 1) {
  const base = Number(level) === 6 ? NFZ_FILL_ALPHA * 0.9 : NFZ_FILL_ALPHA;
  return base * scale;
}

function colorWithAlpha(hex, opacity) {
  return `${normalizeHex(hex)}${toAlphaHex(opacity)}`;
}

function toPolygonPoints(ring) {
  return ring
    .map((pt) => {
      const lng = Number(pt[0]);
      const lat = Number(pt[1]);
      if (!isFinite(lng) || !isFinite(lat)) return null;
      const gcj = wgs84ToGcj02(lng, lat);
      return {
        longitude: gcj.lng,
        latitude: gcj.lat
      };
    })
    .filter(Boolean);
}

function buildAreaGraphics(areas) {
  const polygons = [];
  const circles = [];
  if (!Array.isArray(areas)) return { polygons, circles };

  areas.forEach((area) => {
    const baseStyle = styleForLevel(Number(area.level));
    const same = findSameGeometrySub(area);
    if (same) {
      const merged = Object.assign({}, area);
      if (same.color) merged.color = same.color; // 与外部一致：同几何子区域可覆盖颜色/高度
      if (typeof same.height === 'number') merged.height = same.height;
      drawSingleArea(merged, baseStyle, polygons, circles);
      if (Array.isArray(area.sub_areas)) {
        const subStyle = { ...baseStyle, fillAlphaScale: NFZ_SUBAREA_ALPHA_SCALE };
        area.sub_areas.forEach((sub) => {
          if (sub !== same) drawSingleArea(sub, subStyle, polygons, circles);
        });
      }
    } else {
      if (Array.isArray(area.sub_areas)) {
        const subStyle = { ...baseStyle, fillAlphaScale: NFZ_SUBAREA_ALPHA_SCALE };
        area.sub_areas.forEach((sub) => drawSingleArea(sub, subStyle, polygons, circles));
      }
      drawSingleArea(area, baseStyle, polygons, circles);
    }
  });

  return { polygons, circles };
}

function findSameGeometrySub(a) {
  if (!a || !Array.isArray(a.sub_areas)) return null;
  for (const sa of a.sub_areas) {
    if (sameCircle(a, sa) || samePolygon(a, sa)) return sa;
  }
  return null;
}

function sameCircle(a, b) {
  const ar = Number(a.radius), br = Number(b.radius);
  const alng = Number(a.lng), alang = Number(a.lat);
  const blng = Number(b.lng), blat = Number(b.lat);
  if (!isFinite(ar) || !isFinite(br) || !isFinite(alng) || !isFinite(alang) || !isFinite(blng) || !isFinite(blat)) return false;
  const eq = (x, y, eps) => Math.abs(x - y) <= (eps || 1e-5);
  return eq(ar, br, 1) && eq(alng, blng, 1e-5) && eq(alang, blat, 1e-5);
}

function samePolygon(a, b) {
  const ap = a.polygon_points || a.points || a.polygon || a.geometry?.coordinates;
  const bp = b.polygon_points || b.points || b.polygon || b.geometry?.coordinates;
  if (!ap || !bp) return false;
  try {
    return JSON.stringify(ap) === JSON.stringify(bp);
  } catch (e) {
    return false;
  }
}

function drawSingleArea(area, style, polygons, circles) {
  // console.log("area",area);
  let base = normalizeHex(style.strokeColor);
  const fillScale = style.fillAlphaScale || 1;
  const fillOpacity = levelFillOpacity(style.level || area.level, fillScale);
  const strokeColor = colorWithAlpha(base, NFZ_STROKE_OPACITY);

  if (base !== area.color) {
    base = area.color
  }
  const fillColor = colorWithAlpha(base, fillOpacity);
  if (
    area.shape === 0 ||
    (!area.polygon_points && area.radius && area.lat && area.lng)
  ) {
    const center = wgs84ToGcj02(Number(area.lng), Number(area.lat));
    circles.push({
      longitude: center.lng,
      latitude: center.lat,
      radius: Number(area.radius) || 0,
      color: strokeColor,
      fillColor: fillColor,
      strokeWidth: style.strokeWidth || 1
    });
    return;
  }

  const pts =
    area.polygon_points || area.points || area.polygon || area.geometry?.coordinates;
  if (!pts || !pts.length) return;
  // 支持 MultiPolygon / Polygon / Ring 三种深度
  if (Array.isArray(pts[0]) && Array.isArray(pts[0][0]) && Array.isArray(pts[0][0][0])) {
    // MultiPolygon: [[[ring],[ring]], [[ring], ...]]
    pts.forEach((poly) => {
      const outer = Array.isArray(poly[0]) ? poly[0] : poly;
      const ring = Array.isArray(outer[0]) ? outer[0] : outer;
      const points = toPolygonPoints(ring);
      if (points.length) {
        polygons.push({
          points,
          strokeColor: strokeColor,
          fillColor: fillColor,
          strokeWidth: style.strokeWidth || 1
        });
      }
    });
  } else if (Array.isArray(pts[0]) && Array.isArray(pts[0][0])) {
    // Polygon: [[ring],[hole]...]
    const ring = Array.isArray(pts[0]) ? pts[0] : pts;
    const points = toPolygonPoints(ring);
    if (points.length) {
      polygons.push({
        points,
        strokeColor: strokeColor,
        fillColor: fillColor,
        strokeWidth: style.strokeWidth || 1
      });
    }
  } else {
    // Ring: [[lng,lat], ...]
    const points = toPolygonPoints(pts);
    if (points.length) {
      polygons.push({
        points,
        strokeColor: strokeColor,
        fillColor: fillColor,
        strokeWidth: style.strokeWidth || 1
      });
    }
  }
}

module.exports = {
  fetchDjiAreas,
  buildAreaGraphics
};
