const { resolveApiBase, getAuthToken } = require("./profile");
const { wgs84ToGcj02 } = require("./coords");

const PROVINCE_CITY_KML_CONFIG_STORAGE_KEY = "provinceCityKmlZipConfig";
const PROVINCE_CITY_KML_LOCAL_CACHE_STORAGE_KEY = "provinceCityKmlZipLocalCache";
const PROVINCE_CITY_KML_EXTRACT_DIR_NAME = "province-city-kml";
const PROVINCE_CITY_KML_OUTLINE_KEYWORD = "\u5168\u7701\u8f6e\u5ed3";
const PROVINCE_CITY_KML_POLYGON_STROKE_COLOR = "#E4C64C";
const PROVINCE_CITY_KML_POLYGON_FILL_COLOR = "#F7E8A04D";
const PROVINCE_CITY_KML_POLYGON_STROKE_WIDTH = 2;

const normalizeProvinceCityKmlConfig = (payload = {}) => {
  const source = payload && typeof payload === "object" ? payload : {};
  const fileName = typeof source.fileName === "string" ? source.fileName.trim() : "";
  const version = typeof source.version === "string" ? source.version.trim() : "";
  if (!fileName || !version) return null;
  return { fileName, version };
};

const normalizeProvinceCityKmlLocalCache = (payload = {}) => {
  const source = payload && typeof payload === "object" ? payload : {};
  const fileName = typeof source.fileName === "string" ? source.fileName.trim() : "";
  const version = typeof source.version === "string" ? source.version.trim() : "";
  const path = typeof source.path === "string" ? source.path.trim() : "";
  if (!fileName || !version || !path) return null;
  return {
    fileName,
    version,
    path,
    updatedAt: Number(source.updatedAt) || Date.now()
  };
};

const readStoredProvinceCityKmlConfig = () => {
  try {
    return normalizeProvinceCityKmlConfig(wx.getStorageSync(PROVINCE_CITY_KML_CONFIG_STORAGE_KEY));
  } catch (err) {
    console.warn("read province city kml config failed", err);
    return null;
  }
};

const writeStoredProvinceCityKmlConfig = (config) => {
  const normalized = normalizeProvinceCityKmlConfig(config);
  if (!normalized) return;
  try {
    wx.setStorageSync(PROVINCE_CITY_KML_CONFIG_STORAGE_KEY, normalized);
  } catch (err) {
    console.warn("store province city kml config failed", err);
  }
};

const readStoredProvinceCityKmlLocalCache = () => {
  try {
    return normalizeProvinceCityKmlLocalCache(wx.getStorageSync(PROVINCE_CITY_KML_LOCAL_CACHE_STORAGE_KEY));
  } catch (err) {
    console.warn("read province city kml local cache failed", err);
    return null;
  }
};

const writeStoredProvinceCityKmlLocalCache = (cache) => {
  const normalized = normalizeProvinceCityKmlLocalCache(cache);
  if (!normalized) return;
  try {
    wx.setStorageSync(PROVINCE_CITY_KML_LOCAL_CACHE_STORAGE_KEY, normalized);
  } catch (err) {
    console.warn("store province city kml local cache failed", err);
  }
};

const clearStoredProvinceCityKmlLocalCache = () => {
  try {
    wx.removeStorageSync(PROVINCE_CITY_KML_LOCAL_CACHE_STORAGE_KEY);
  } catch (err) {
    console.warn("clear province city kml local cache failed", err);
  }
};

const getFileSystemManager = () => {
  if (typeof wx === "undefined" || typeof wx.getFileSystemManager !== "function") return null;
  try {
    return wx.getFileSystemManager();
  } catch (err) {
    return null;
  }
};

const checkFileExists = (path) =>
  new Promise((resolve) => {
    const target = `${path || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs) {
      resolve(false);
      return;
    }
    if (typeof fs.access === "function") {
      fs.access({
        path: target,
        success: () => resolve(true),
        fail: () => resolve(false)
      });
      return;
    }
    if (typeof fs.accessSync === "function") {
      try {
        fs.accessSync(target);
        resolve(true);
      } catch (err) {
        resolve(false);
      }
      return;
    }
    resolve(false);
  });

const getPathStat = (path) =>
  new Promise((resolve) => {
    const target = `${path || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs || typeof fs.stat !== "function") {
      resolve({ exists: false, isDirectory: false });
      return;
    }
    fs.stat({
      path: target,
      success: (res = {}) => {
        const stats = res?.stats || res;
        let isDirectory = false;
        if (stats && typeof stats.isDirectory === "function") {
          try {
            isDirectory = !!stats.isDirectory();
          } catch (err) {
            isDirectory = false;
          }
        }
        resolve({ exists: true, isDirectory });
      },
      fail: () => resolve({ exists: false, isDirectory: false })
    });
  });

const ensureDirectory = (dirPath) =>
  new Promise((resolve, reject) => {
    const target = `${dirPath || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs || typeof fs.mkdir !== "function") {
      reject(new Error("mkdir-unsupported"));
      return;
    }
    fs.mkdir({
      dirPath: target,
      recursive: true,
      success: () => resolve(target),
      fail: (err) => reject(err || new Error("mkdir-failed"))
    });
  });

const removeSavedFileQuietly = (path) =>
  new Promise((resolve) => {
    const target = `${path || ""}`.trim();
    if (!target || typeof wx === "undefined" || typeof wx.removeSavedFile !== "function") {
      resolve(false);
      return;
    }
    wx.removeSavedFile({
      filePath: target,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });

const removeFileQuietly = (path) =>
  new Promise((resolve) => {
    const target = `${path || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs || typeof fs.unlink !== "function") {
      resolve(false);
      return;
    }
    fs.unlink({
      filePath: target,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });

const removeDirectoryQuietly = (dirPath) =>
  new Promise((resolve) => {
    const target = `${dirPath || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs || typeof fs.rmdir !== "function") {
      resolve(false);
      return;
    }
    fs.rmdir({
      dirPath: target,
      recursive: true,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });

const removePathQuietly = async (path) => {
  const target = `${path || ""}`.trim();
  if (!target) return false;
  const stat = await getPathStat(target);
  if (stat.exists) {
    if (stat.isDirectory) {
      const removedDir = await removeDirectoryQuietly(target);
      if (removedDir) return true;
    } else {
      const removedFile = await removeFileQuietly(target);
      if (removedFile) return true;
    }
  }
  return removeSavedFileQuietly(target);
};

const readdir = (dirPath) =>
  new Promise((resolve, reject) => {
    const target = `${dirPath || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs || typeof fs.readdir !== "function") {
      reject(new Error("readdir-unsupported"));
      return;
    }
    fs.readdir({
      dirPath: target,
      success: (res = {}) => resolve(Array.isArray(res.files) ? res.files : []),
      fail: (err) => reject(err || new Error("readdir-failed"))
    });
  });

const readTextFile = (filePath) =>
  new Promise((resolve, reject) => {
    const target = `${filePath || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs || typeof fs.readFile !== "function") {
      reject(new Error("read-file-unsupported"));
      return;
    }
    fs.readFile({
      filePath: target,
      encoding: "utf-8",
      success: (res = {}) => resolve(`${res.data || ""}`),
      fail: (err) => reject(err || new Error("read-file-failed"))
    });
  });

const unzipArchiveToDirectory = (zipFilePath, targetPath) =>
  new Promise((resolve, reject) => {
    const zip = `${zipFilePath || ""}`.trim();
    const target = `${targetPath || ""}`.trim();
    const fs = getFileSystemManager();
    if (!zip || !target || !fs || typeof fs.unzip !== "function") {
      reject(new Error("unzip-unsupported"));
      return;
    }
    fs.unzip({
      zipFilePath: zip,
      targetPath: target,
      success: () => resolve(target),
      fail: (err) => reject(err || new Error("unzip-failed"))
    });
  });

const saveTempFile = (tempFilePath) =>
  new Promise((resolve, reject) => {
    const path = `${tempFilePath || ""}`.trim();
    if (!path) {
      reject(new Error("missing-temp-file-path"));
      return;
    }
    const userDataPath = `${wx?.env?.USER_DATA_PATH || ""}`.trim();
    if (userDataPath && path.startsWith(userDataPath)) {
      resolve(path);
      return;
    }
    if (typeof wx === "undefined" || typeof wx.saveFile !== "function") {
      resolve(path);
      return;
    }
    wx.saveFile({
      tempFilePath: path,
      success: (res = {}) => {
        const savedPath = `${res.savedFilePath || ""}`.trim();
        resolve(savedPath || path);
      },
      fail: (err) => reject(err || new Error("save-file-failed"))
    });
  });

const buildProvinceCityKmlDownloadUrl = (options = {}) => {
  const apiBase = resolveApiBase(options.apiBase);
  if (!apiBase) return "";
  return `${apiBase}/api/config/province-city-kml-zip/latest/download`;
};

const fetchProvinceCityKmlZipConfig = (options = {}) =>
  new Promise((resolve, reject) => {
    const apiBase = resolveApiBase(options.apiBase);
    const token = options.token || getAuthToken();
    if (!apiBase) {
      reject(new Error("missing-api-base"));
      return;
    }
    if (!token) {
      reject(new Error("missing-token"));
      return;
    }
    wx.request({
      url: `${apiBase}/api/config/province-city-kml-zip`,
      method: "GET",
      header: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`
      },
      success: (res = {}) => {
        const statusCode = Number(res.statusCode) || 0;
        if (statusCode >= 200 && statusCode < 300) {
          const normalized = normalizeProvinceCityKmlConfig(res?.data?.data || {});
          if (normalized) {
            writeStoredProvinceCityKmlConfig(normalized);
            resolve(normalized);
            return;
          }
          resolve(null);
          return;
        }
        if (statusCode === 404) {
          resolve(null);
          return;
        }
        const reason = res?.data?.message || res?.errMsg || `status-${statusCode}`;
        reject(new Error(typeof reason === "string" ? reason : JSON.stringify(reason)));
      },
      fail: (err) => reject(err || new Error("request-failed"))
    });
  });

const downloadLatestProvinceCityKmlZip = (options = {}) =>
  new Promise((resolve, reject) => {
    const apiBase = resolveApiBase(options.apiBase);
    const token = options.token || getAuthToken();
    if (!apiBase) {
      reject(new Error("missing-api-base"));
      return;
    }
    if (!token) {
      reject(new Error("missing-token"));
      return;
    }
    wx.downloadFile({
      url: buildProvinceCityKmlDownloadUrl({ apiBase }),
      header: {
        Authorization: `Bearer ${token}`
      },
      success: (res = {}) => {
        const statusCode = Number(res.statusCode) || 0;
        const tempFilePath = `${res.tempFilePath || ""}`.trim();
        if (statusCode < 200 || statusCode >= 300 || !tempFilePath) {
          reject(new Error(`download-failed-${statusCode || "unknown"}`));
          return;
        }
        saveTempFile(tempFilePath).then(resolve).catch(reject);
      },
      fail: (err) => reject(err || new Error("download-failed"))
    });
  });

const buildProvinceCityExtractedRootPath = () => {
  const root = `${wx?.env?.USER_DATA_PATH || ""}`.trim();
  if (!root) return "";
  return `${root}/${PROVINCE_CITY_KML_EXTRACT_DIR_NAME}`;
};

const sortNames = (list = []) =>
  list.slice().sort((a, b) => `${a || ""}`.localeCompare(`${b || ""}`, "zh-Hans-CN"));

const stripKmlExtension = (value = "") => `${value || ""}`.replace(/\.kml$/i, "").trim();

const buildProvinceNodeId = (provinceName = "") => `province::${provinceName}`;
const buildCityNodeId = (provinceName = "", cityName = "") => `city::${provinceName}::${cityName}`;

const resolveProvinceOutlineFile = (provinceName = "", kmlFileNames = []) => {
  const list = Array.isArray(kmlFileNames) ? kmlFileNames : [];
  const exactName = `${provinceName}_${PROVINCE_CITY_KML_OUTLINE_KEYWORD}.kml`;
  const exact = list.find((name) => `${name}` === exactName);
  if (exact) return exact;
  const fuzzy = list.find((name) => `${name}`.includes(PROVINCE_CITY_KML_OUTLINE_KEYWORD));
  if (fuzzy) return fuzzy;
  if (list.length === 1) return list[0];
  return "";
};

const resolveProvinceCityContentRoot = async (extractedPath) => {
  const root = `${extractedPath || ""}`.trim();
  if (!root) return "";
  let entries = [];
  try {
    entries = await readdir(root);
  } catch (err) {
    return root;
  }
  const childStats = await Promise.all(
    entries.map(async (name) => {
      const fullPath = `${root}/${name}`;
      const stat = await getPathStat(fullPath);
      return { name, fullPath, stat };
    })
  );
  const directories = childStats.filter((item) => item.stat.exists && item.stat.isDirectory);
  const topKmlFiles = childStats.filter(
    (item) => item.stat.exists && !item.stat.isDirectory && /\.kml$/i.test(`${item.name}`)
  );
  if (directories.length === 1 && topKmlFiles.length === 0) {
    return directories[0].fullPath;
  }
  return root;
};

const buildProvinceCityTree = async (rootPath) => {
  const contentRoot = `${rootPath || ""}`.trim();
  if (!contentRoot) return [];
  const provinceNames = sortNames(await readdir(contentRoot));
  const provinces = [];
  for (let i = 0; i < provinceNames.length; i += 1) {
    const provinceName = provinceNames[i];
    const provincePath = `${contentRoot}/${provinceName}`;
    const provinceStat = await getPathStat(provincePath);
    if (!provinceStat.exists || !provinceStat.isDirectory) continue;
    const childNames = sortNames(await readdir(provincePath));
    const kmlFileNames = childNames.filter((name) => /\.kml$/i.test(`${name}`));
    const provinceOutlineFileName = resolveProvinceOutlineFile(provinceName, kmlFileNames);
    const cityNodes = kmlFileNames
      .filter((name) => name !== provinceOutlineFileName)
      .map((fileName) => {
        const cityName = stripKmlExtension(fileName);
        return {
          id: buildCityNodeId(provinceName, cityName),
          type: "city",
          provinceName,
          cityName,
          label: cityName,
          fileName,
          filePath: `${provincePath}/${fileName}`
        };
      });
    provinces.push({
      id: buildProvinceNodeId(provinceName),
      type: "province",
      provinceName,
      label: provinceName,
      fileName: provinceOutlineFileName,
      filePath: provinceOutlineFileName ? `${provincePath}/${provinceOutlineFileName}` : "",
      children: cityNodes
    });
  }
  return provinces;
};

const extractOuterBoundaryCoordinates = (polygonText = "") => {
  const text = `${polygonText || ""}`;
  if (!text) return "";
  const outerMatch = text.match(/<outerBoundaryIs\b[\s\S]*?<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i);
  if (outerMatch && outerMatch[1]) {
    return outerMatch[1];
  }
  const firstMatch = text.match(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i);
  return firstMatch && firstMatch[1] ? firstMatch[1] : "";
};

const parseKmlCoordinateText = (coordinateText = "") => {
  const text = `${coordinateText || ""}`.trim();
  if (!text) return [];
  const points = text
    .split(/\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const parts = chunk.split(",");
      const longitude = Number(parts[0]);
      const latitude = Number(parts[1]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return null;
      }
      return { longitude, latitude };
    })
    .filter(Boolean);
  if (points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (
      Math.abs(Number(first.longitude) - Number(last.longitude)) <= 1e-9 &&
      Math.abs(Number(first.latitude) - Number(last.latitude)) <= 1e-9
    ) {
      points.pop();
    }
  }
  return points;
};

const buildProvinceCityHighlightPolygons = async (filePath) => {
  const target = `${filePath || ""}`.trim();
  if (!target) return [];
  const xml = await readTextFile(target);
  if (!xml) return [];
  const polygonMatches = xml.match(/<Polygon\b[\s\S]*?<\/Polygon>/gi) || [];
  const polygons = [];
  polygonMatches.forEach((polygonText) => {
    const coordinateText = extractOuterBoundaryCoordinates(polygonText);
    const rawPoints = parseKmlCoordinateText(coordinateText);
    if (rawPoints.length < 3) return;
    const points = rawPoints
      .map((point) => wgs84ToGcj02(Number(point.longitude), Number(point.latitude)))
      .map((point) => ({
        longitude: Number(point?.lng),
        latitude: Number(point?.lat)
      }))
      .filter((point) => Number.isFinite(point.longitude) && Number.isFinite(point.latitude));
    if (points.length < 3) return;
    polygons.push({
      points,
      strokeColor: PROVINCE_CITY_KML_POLYGON_STROKE_COLOR,
      fillColor: PROVINCE_CITY_KML_POLYGON_FILL_COLOR,
      strokeWidth: PROVINCE_CITY_KML_POLYGON_STROKE_WIDTH
    });
  });
  return polygons;
};

const resolveProvinceCityKmlZipCache = async (options = {}) => {
  const remoteConfig = await fetchProvinceCityKmlZipConfig(options).catch((err) => {
    const storedConfig = readStoredProvinceCityKmlConfig();
    if (storedConfig) {
      console.warn("fetch province city kml config failed, fallback to stored config", err);
      return storedConfig;
    }
    throw err;
  });

  let localCache = readStoredProvinceCityKmlLocalCache();
  const localCacheReady = localCache && localCache.path ? await checkFileExists(localCache.path) : false;
  const needDownload =
    !!remoteConfig &&
    (
      !localCacheReady ||
      !localCache ||
      localCache.fileName !== remoteConfig.fileName ||
      localCache.version !== remoteConfig.version
    );

  if (needDownload) {
    if (localCache?.path) {
      await removePathQuietly(localCache.path);
    }
    clearStoredProvinceCityKmlLocalCache();
    const zipPath = await downloadLatestProvinceCityKmlZip(options);
    localCache = {
      fileName: remoteConfig.fileName,
      version: remoteConfig.version,
      path: zipPath,
      updatedAt: Date.now()
    };
    writeStoredProvinceCityKmlLocalCache(localCache);
    writeStoredProvinceCityKmlConfig(remoteConfig);
  }

  const cacheToUse = needDownload
    ? localCache
    : (localCacheReady ? localCache : readStoredProvinceCityKmlLocalCache());
  if (!cacheToUse || !(await checkFileExists(cacheToUse.path))) {
    throw new Error("province-city-kml-cache-missing");
  }

  return {
    config: remoteConfig || normalizeProvinceCityKmlConfig(cacheToUse),
    cache: cacheToUse
  };
};

const prepareProvinceCityHighlightResource = async (options = {}) => {
  const { config, cache } = await resolveProvinceCityKmlZipCache(options);
  const extractedRootPath = buildProvinceCityExtractedRootPath();
  if (!extractedRootPath) {
    throw new Error("missing-user-data-path");
  }
  await removePathQuietly(extractedRootPath);
  await ensureDirectory(extractedRootPath);
  await unzipArchiveToDirectory(cache.path, extractedRootPath);
  const contentRootPath = await resolveProvinceCityContentRoot(extractedRootPath);
  const tree = await buildProvinceCityTree(contentRootPath);
  return {
    config,
    cache,
    extractedRootPath,
    contentRootPath,
    tree
  };
};

module.exports = {
  PROVINCE_CITY_KML_CONFIG_STORAGE_KEY,
  PROVINCE_CITY_KML_LOCAL_CACHE_STORAGE_KEY,
  normalizeProvinceCityKmlConfig,
  normalizeProvinceCityKmlLocalCache,
  readStoredProvinceCityKmlConfig,
  readStoredProvinceCityKmlLocalCache,
  fetchProvinceCityKmlZipConfig,
  buildProvinceCityKmlDownloadUrl,
  prepareProvinceCityHighlightResource,
  buildProvinceCityTree,
  buildProvinceCityHighlightPolygons,
  buildProvinceNodeId,
  buildCityNodeId
};
