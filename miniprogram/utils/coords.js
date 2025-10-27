function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) +
      20.0 * Math.sin(2.0 * x * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(y * Math.PI) +
      40.0 * Math.sin((y / 3.0) * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((160.0 * Math.sin((y / 12.0) * Math.PI) +
      320 * Math.sin((y * Math.PI) / 30.0)) *
      2.0) /
    3.0;
  return ret;
}

function transformLon(x, y) {
  let ret =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) +
      20.0 * Math.sin(2.0 * x * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(x * Math.PI) +
      40.0 * Math.sin((x / 3.0) * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) +
      300.0 * Math.sin((x / 30.0) * Math.PI)) *
      2.0) /
    3.0;
  return ret;
}

function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) return { lng, lat };
  const a = 6378137.0;
  const ee = 0.00669342162296594323;
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLon = transformLon(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat =
    (dLat * 180.0) /
    (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLon =
    (dLon * 180.0) /
    ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
  const mgLat = lat + dLat;
  const mgLon = lng + dLon;
  return { lng: mgLon, lat: mgLat };
}

function gcj02ToWgs84(lng, lat) {
  if (outOfChina(lng, lat)) return { lng, lat };
  const a = 6378137.0;
  const ee = 0.00669342162296594323;
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLon = transformLon(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat =
    (dLat * 180.0) /
    (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLon =
    (dLon * 180.0) /
    ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
  const mgLat = lat + dLat;
  const mgLon = lng + dLon;
  return { lng: lng * 2 - mgLon, lat: lat * 2 - mgLat };
}



function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6378137;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

function clampRadius(r) {
  return Math.round(Math.min(Math.max(50000, r), 80000));
}

function lonLatToMercator(lng, lat) {
  const originShift = Math.PI * 6378137;
  const x = (lng * originShift) / 180.0;
  const y =
    Math.log(Math.tan(((90 + lat) * Math.PI) / 360.0)) *
    6378137;
  return { x, y };
}

function mercatorToLonLat(x, y) {
  const originShift = Math.PI * 6378137;
  const lng = (x / originShift) * 180.0;
  const lat =
    ((2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) *
      180.0) /
    Math.PI;
  return { lng, lat };
}

function tileXYToBBOX3857(x, y, z) {
  const TILE_SIZE = 256;
  const R = 6378137;
  const originShift = Math.PI * R;
  const res =
    (2 * originShift) /
    (TILE_SIZE * Math.pow(2, z));
  const minx = x * TILE_SIZE * res - originShift;
  const maxx = (x + 1) * TILE_SIZE * res - originShift;
  const maxy = originShift - y * TILE_SIZE * res;
  const miny = originShift - (y + 1) * TILE_SIZE * res;
  const fix = (n) => Number(n.toFixed(6));
  return [fix(minx), fix(miny), fix(maxx), fix(maxy)];
}

module.exports = {
  gcj02ToWgs84,
  wgs84ToGcj02,
  mercatorToLonLat,
  lonLatToMercator,
  tileXYToBBOX3857,
  haversineMeters,
  clampRadius
};
