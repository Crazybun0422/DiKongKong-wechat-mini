const { resolveApiBase, getAuthToken } = require("./profile");

const EASTER_EGG_RESOURCE_CONFIG_STORAGE_KEY = "easterEggResourceConfig";
const EASTER_EGG_RESOURCE_LOCAL_CACHE_STORAGE_KEY = "easterEggResourceLocalCache";
const EASTER_EGG_RESOURCE_SEGMENT_STATE_STORAGE_KEY = "easterEggResourceSegmentState";
const PROBE_BYTES = 1024;
const DEFAULT_SEGMENT_COUNT = 20;
const EASTER_EGG_DOWNLOAD_LOG_TAG = "[afei-download]";
const EASTER_EGG_UNPACK_PREFIX = "easter-egg-unpacked-";

const STORAGE_LIMIT_ERROR_PATTERNS = [
  "maximum size of the file storage limit",
  "storage limit is exceeded",
  "storage limit exceeded",
  "user dir saved file size limit exceeded"
];

const normalizeErrorForLog = (err) => ({
  message: `${err?.message || err?.errMsg || err || ""}`.trim(),
  errMsg: `${err?.errMsg || ""}`.trim()
});

const logEasterEggDownload = (event, detail = {}) => {
  try {
    console.log(`${EASTER_EGG_DOWNLOAD_LOG_TAG} ${event}`, detail);
  } catch (err) {}
};

const normalizeEasterEggResourceConfig = (payload = {}) => {
  const source = payload && typeof payload === "object" ? payload : {};
  const fileName = typeof source.fileName === "string" ? source.fileName.trim() : "";
  const version = typeof source.version === "string" ? source.version.trim() : "";
  if (!fileName || !version) return null;
  return { fileName, version };
};

const normalizeEasterEggResourceLocalCache = (payload = {}) => {
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

const normalizeEasterEggResourceSegmentState = (payload = {}) => {
  const source = payload && typeof payload === "object" ? payload : {};
  const fileName = typeof source.fileName === "string" ? source.fileName.trim() : "";
  const version = typeof source.version === "string" ? source.version.trim() : "";
  const mergedPath = typeof source.mergedPath === "string" ? source.mergedPath.trim() : "";
  const totalBytes = Number(source.totalBytes);
  const chunkCount = Number(source.chunkCount);
  const nextIndex = Number(source.nextIndex);
  if (!fileName || !version || !mergedPath) return null;
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  if (!Number.isInteger(chunkCount) || chunkCount <= 0) return null;
  if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex > chunkCount) return null;
  return {
    fileName,
    version,
    mergedPath,
    totalBytes: Math.floor(totalBytes),
    chunkCount,
    nextIndex,
    updatedAt: Number(source.updatedAt) || Date.now()
  };
};

const readStoredEasterEggResourceConfig = () => {
  try {
    const stored = wx.getStorageSync(EASTER_EGG_RESOURCE_CONFIG_STORAGE_KEY);
    if (stored && typeof stored === "object") {
      return normalizeEasterEggResourceConfig(stored);
    }
  } catch (err) {
    console.warn("read easter egg config failed", err);
  }
  return null;
};

const writeStoredEasterEggResourceConfig = (config) => {
  if (!config) return;
  try {
    wx.setStorageSync(EASTER_EGG_RESOURCE_CONFIG_STORAGE_KEY, config);
  } catch (err) {
    console.warn("store easter egg config failed", err);
  }
};

const readStoredEasterEggResourceLocalCache = () => {
  try {
    const stored = wx.getStorageSync(EASTER_EGG_RESOURCE_LOCAL_CACHE_STORAGE_KEY);
    if (stored && typeof stored === "object") {
      return normalizeEasterEggResourceLocalCache(stored);
    }
  } catch (err) {
    console.warn("read easter egg local cache failed", err);
  }
  return null;
};

const writeStoredEasterEggResourceLocalCache = (cache) => {
  if (!cache) return;
  try {
    wx.setStorageSync(EASTER_EGG_RESOURCE_LOCAL_CACHE_STORAGE_KEY, cache);
  } catch (err) {
    console.warn("store easter egg local cache failed", err);
  }
};

const clearStoredEasterEggResourceLocalCache = () => {
  try {
    wx.removeStorageSync(EASTER_EGG_RESOURCE_LOCAL_CACHE_STORAGE_KEY);
  } catch (err) {
    console.warn("clear easter egg local cache failed", err);
  }
};

const readStoredEasterEggResourceSegmentState = () => {
  try {
    const stored = wx.getStorageSync(EASTER_EGG_RESOURCE_SEGMENT_STATE_STORAGE_KEY);
    if (stored && typeof stored === "object") {
      return normalizeEasterEggResourceSegmentState(stored);
    }
  } catch (err) {
    console.warn("read easter egg segment state failed", err);
  }
  return null;
};

const writeStoredEasterEggResourceSegmentState = (state = {}) => {
  const normalized = normalizeEasterEggResourceSegmentState(state);
  if (!normalized) return;
  try {
    wx.setStorageSync(EASTER_EGG_RESOURCE_SEGMENT_STATE_STORAGE_KEY, normalized);
  } catch (err) {
    console.warn("store easter egg segment state failed", err);
  }
};

const clearStoredEasterEggResourceSegmentState = () => {
  try {
    wx.removeStorageSync(EASTER_EGG_RESOURCE_SEGMENT_STATE_STORAGE_KEY);
  } catch (err) {
    console.warn("clear easter egg segment state failed", err);
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

const isStorageLimitError = (err) => {
  const message = `${err?.message || err?.errMsg || err || ""}`.trim().toLowerCase();
  if (!message) return false;
  return STORAGE_LIMIT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
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
  if (!stat.exists) return false;
  if (stat.isDirectory) {
    const removedDir = await removeDirectoryQuietly(target);
    if (removedDir) return true;
  }
  return removeFileQuietly(target);
};

const listSavedFiles = () =>
  new Promise((resolve) => {
    if (typeof wx === "undefined" || typeof wx.getSavedFileList !== "function") {
      resolve([]);
      return;
    }
    wx.getSavedFileList({
      success: (res = {}) => {
        const files = Array.isArray(res.fileList) ? res.fileList : [];
        resolve(files);
      },
      fail: () => resolve([])
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

const listUserDataFiles = () =>
  new Promise((resolve) => {
    const root = `${wx?.env?.USER_DATA_PATH || ""}`.trim();
    const fs = getFileSystemManager();
    if (!root || !fs || typeof fs.readdir !== "function") {
      resolve([]);
      return;
    }
    fs.readdir({
      dirPath: root,
      success: (res = {}) => {
        const files = Array.isArray(res.files) ? res.files : [];
        resolve(files);
      },
      fail: () => resolve([])
    });
  });

const cleanupEasterEggPrefixFiles = async (excludePath = "") => {
  const root = `${wx?.env?.USER_DATA_PATH || ""}`.trim();
  if (!root) return;
  const exclude = `${excludePath || ""}`.trim();
  const files = await listUserDataFiles();
  const tasks = files
    .filter((name) => typeof name === "string" && name.startsWith("easter-egg-"))
    .map((name) => `${root}/${name}`)
    .filter((path) => !exclude || path !== exclude)
    .map((path) => removeFileQuietly(path));
  logEasterEggDownload("cleanup.prefix.scan", {
    totalFiles: files.length,
    targetFiles: tasks.length,
    exclude
  });
  if (tasks.length) {
    await Promise.all(tasks);
    logEasterEggDownload("cleanup.prefix.done", {
      removed: tasks.length
    });
  }
};

const cleanupSavedFilesUnderPressure = async (options = {}) => {
  const keepPaths = Array.isArray(options.keepPaths)
    ? options.keepPaths.map((item) => `${item || ""}`.trim()).filter(Boolean)
    : [];
  const keepSet = new Set(keepPaths);
  const entries = await listSavedFiles();
  const targets = entries
    .map((item) => `${item?.filePath || ""}`.trim())
    .filter(Boolean)
    .filter((path) => !keepSet.has(path));
  logEasterEggDownload("cleanup.saved.scan", {
    savedFileCount: entries.length,
    targetCount: targets.length,
    keepCount: keepSet.size
  });
  if (!targets.length) return 0;
  const results = await Promise.all(targets.map((path) => removeSavedFileQuietly(path)));
  const removed = results.filter(Boolean).length;
  logEasterEggDownload("cleanup.saved.done", { removed });
  return removed;
};

const clearStaleEasterEggArtifacts = async (targetFileName, targetVersion) => {
  const cached = readStoredEasterEggResourceLocalCache();
  if (
    cached &&
    (cached.fileName !== targetFileName || cached.version !== targetVersion)
  ) {
    logEasterEggDownload("cleanup.stale.cache", {
      cacheFileName: cached.fileName,
      cacheVersion: cached.version,
      targetFileName,
      targetVersion,
      cachePath: cached.path
    });
    await removeFileQuietly(cached.path);
    clearStoredEasterEggResourceLocalCache();
  }
  const segmentState = readStoredEasterEggResourceSegmentState();
  if (
    segmentState &&
    (segmentState.fileName !== targetFileName || segmentState.version !== targetVersion)
  ) {
    logEasterEggDownload("cleanup.stale.resume", {
      resumeFileName: segmentState.fileName,
      resumeVersion: segmentState.version,
      targetFileName,
      targetVersion,
      mergedPath: segmentState.mergedPath
    });
    await removeFileQuietly(segmentState.mergedPath);
    clearStoredEasterEggResourceSegmentState();
  }
};

const writeArrayBufferToFile = (path, data) =>
  new Promise((resolve, reject) => {
    const target = `${path || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs) {
      reject(new Error("missing-file-system"));
      return;
    }
    fs.writeFile({
      filePath: target,
      data,
      success: () => resolve(target),
      fail: (err) => reject(err || new Error("write-file-failed"))
    });
  });

const appendArrayBufferToFile = (path, data) =>
  new Promise((resolve, reject) => {
    const target = `${path || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs || typeof fs.appendFile !== "function") {
      reject(new Error("append-file-unsupported"));
      return;
    }
    fs.appendFile({
      filePath: target,
      data,
      success: () => resolve(target),
      fail: (err) => reject(err || new Error("append-file-failed"))
    });
  });

const writeArrayBufferWithRetry = async (path, data, options = {}) => {
  try {
    return await writeArrayBufferToFile(path, data);
  } catch (err) {
    if (!isStorageLimitError(err)) throw err;
    logEasterEggDownload("write.retry.storage-limit", {
      path,
      byteLength: Number(data?.byteLength || 0),
      error: normalizeErrorForLog(err)
    });
    await cleanupEasterEggPrefixFiles(`${options.keepPath || ""}`.trim());
    await cleanupSavedFilesUnderPressure({
      keepPaths: options.keepPaths || []
    });
    return writeArrayBufferToFile(path, data);
  }
};

const appendArrayBufferWithRetry = async (path, data, options = {}) => {
  try {
    return await appendArrayBufferToFile(path, data);
  } catch (err) {
    if (!isStorageLimitError(err)) throw err;
    logEasterEggDownload("append.retry.storage-limit", {
      path,
      byteLength: Number(data?.byteLength || 0),
      error: normalizeErrorForLog(err)
    });
    await cleanupEasterEggPrefixFiles(`${options.keepPath || ""}`.trim());
    await cleanupSavedFilesUnderPressure({
      keepPaths: options.keepPaths || []
    });
    return appendArrayBufferToFile(path, data);
  }
};

const getFileSize = (path) =>
  new Promise((resolve) => {
    const target = `${path || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs || typeof fs.stat !== "function") {
      resolve(0);
      return;
    }
    fs.stat({
      path: target,
      success: (res = {}) => {
        const size = Number(res?.stats?.size ?? res?.size);
        resolve(Number.isFinite(size) && size > 0 ? Math.floor(size) : 0);
      },
      fail: () => resolve(0)
    });
  });

const sliceArrayBuffer = (buffer, start, endExclusive) => {
  if (!buffer || typeof buffer.byteLength !== "number") return null;
  const begin = Math.max(0, Number(start) || 0);
  const finish = Math.max(begin, Number(endExclusive) || begin);
  if (typeof buffer.slice === "function") {
    try {
      return buffer.slice(begin, finish);
    } catch (err) {}
  }
  try {
    const view = new Uint8Array(buffer);
    return view.slice(begin, finish).buffer;
  } catch (err) {
    return null;
  }
};

const hasValidEasterEggResourceLocalCache = (cache = {}) => {
  const normalized = normalizeEasterEggResourceLocalCache(cache);
  if (!normalized) return Promise.resolve(false);
  return checkFileExists(normalized.path);
};

const buildEasterEggResourceDownloadUrl = (options = {}) => {
  const base = resolveApiBase(options.apiBase);
  if (!base) return "";
  return `${base}/api/config/easter-egg-resource/latest/download`;
};

const fetchEasterEggResourceConfig = (options = {}) =>
  new Promise((resolve, reject) => {
    const base = resolveApiBase(options.apiBase);
    if (!base) {
      reject(new Error("missing-api-base"));
      return;
    }
    const token = options.token || getAuthToken();
    if (!token) {
      reject(new Error("missing-token"));
      return;
    }
    wx.request({
      url: `${base}/api/config/easter-egg-resource`,
      method: "GET",
      header: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`
      },
      success: (res) => {
        const statusCode = Number(res?.statusCode) || 0;
        if (statusCode >= 200 && statusCode < 300) {
          const normalized = normalizeEasterEggResourceConfig(res?.data?.data || {});
          if (normalized) {
            writeStoredEasterEggResourceConfig(normalized);
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

const normalizeHeaderMap = (header = {}) => {
  const source = header && typeof header === "object" ? header : {};
  const result = {};
  Object.keys(source).forEach((key) => {
    result[`${key}`.toLowerCase()] = source[key];
  });
  return result;
};

const parseTotalBytesFromContentRange = (contentRange = "") => {
  const text = `${contentRange || ""}`.trim();
  const match = text.match(/bytes\s+\d+\s*-\s*\d+\s*\/\s*(\d+)/i);
  if (!match || !match[1]) return 0;
  const total = Number(match[1]);
  return Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
};

const requestRangeChunk = (options = {}) => {
  const base = resolveApiBase(options.apiBase);
  const token = options.token || getAuthToken();
  const start = Number(options.start);
  const end = Number(options.end);
  const requestId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  let requestTask = null;
  const promise = new Promise((resolve, reject) => {
    if (!base) {
      reject(new Error("missing-api-base"));
      return;
    }
    if (!token) {
      reject(new Error("missing-token"));
      return;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      reject(new Error("invalid-range"));
      return;
    }
    logEasterEggDownload("chunk.request.start", {
      requestId,
      start: Math.floor(start),
      end: Math.floor(end),
      expectedBytes: Math.floor(end - start + 1)
    });
    requestTask = wx.request({
      url: buildEasterEggResourceDownloadUrl({ apiBase: base }),
      method: "GET",
      responseType: "arraybuffer",
      header: {
        Authorization: `Bearer ${token}`,
        Range: `bytes=${Math.floor(start)}-${Math.floor(end)}`
      },
      success: (res) => {
        const statusCode = Number(res?.statusCode) || 0;
        if (statusCode !== 206 && statusCode !== 200) {
          if (statusCode === 416) {
            reject(new Error("range-not-satisfiable"));
            return;
          }
          reject(new Error(`download-failed-${statusCode || "unknown"}`));
          return;
        }
        const headers = normalizeHeaderMap(res?.header || {});
        const dataByteLength =
          res?.data && typeof res.data.byteLength === "number" ? Number(res.data.byteLength) : 0;
        logEasterEggDownload("chunk.request.success", {
          requestId,
          statusCode,
          dataByteLength,
          contentRange: `${headers["content-range"] || ""}`,
          contentLength: `${headers["content-length"] || ""}`
        });
        resolve({
          statusCode,
          data: res?.data,
          header: headers
        });
      },
      fail: (err) => {
        logEasterEggDownload("chunk.request.fail", {
          requestId,
          error: normalizeErrorForLog(err)
        });
        reject(err || new Error("download-failed"));
      }
    });
  });
  return {
    promise,
    abort() {
      if (requestTask && typeof requestTask.abort === "function") {
        try {
          requestTask.abort();
        } catch (err) {}
      }
    }
  };
};

const probeLatestResourceTotalBytes = (options = {}) =>
  requestRangeChunk({
    apiBase: options.apiBase,
    token: options.token,
    start: 0,
    end: PROBE_BYTES - 1
  }).promise.then((result) => {
    const headers = result?.header || {};
    let totalBytes = parseTotalBytesFromContentRange(headers["content-range"]);
    if (!totalBytes) {
      const contentLength = Number(headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > 0 && result.statusCode === 200) {
        totalBytes = Math.floor(contentLength);
      }
    }
    if (!totalBytes) {
      throw new Error("missing-total-bytes");
    }
    logEasterEggDownload("probe.total-bytes", {
      totalBytes,
      contentRange: `${headers["content-range"] || ""}`,
      contentLength: `${headers["content-length"] || ""}`,
      statusCode: Number(result?.statusCode || 0)
    });
    return { totalBytes };
  });

const buildChunkPlan = (totalBytes, segmentCount = DEFAULT_SEGMENT_COUNT) => {
  const total = Number(totalBytes);
  if (!Number.isFinite(total) || total <= 0) return [];
  const countRaw = Number(segmentCount);
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : DEFAULT_SEGMENT_COUNT;
  const chunkSize = Math.max(1, Math.ceil(total / count));
  const chunks = [];
  for (let index = 0; index < count; index += 1) {
    const start = index * chunkSize;
    if (start >= total) break;
    const end = Math.min(total - 1, start + chunkSize - 1);
    chunks.push({ index, start, end, byteLength: end - start + 1 });
  }
  return chunks;
};

const calculateDownloadedBytesByIndex = (chunks = [], nextIndex = 0) => {
  const end = Math.max(0, Math.min(Number(nextIndex) || 0, chunks.length));
  let total = 0;
  for (let i = 0; i < end; i += 1) {
    total += Number(chunks[i]?.byteLength || 0);
  }
  return total;
};

const emitProgress = (downloadedBytes, totalBytes, handler) => {
  if (typeof handler !== "function") return;
  const total = Number(totalBytes);
  const downloaded = Number(downloadedBytes);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(downloaded)) return;
  const percent = Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
  logEasterEggDownload("progress.emit", {
    percent,
    downloadedBytes: Math.max(0, Math.min(total, downloaded)),
    totalBytes: total
  });
  handler(percent, {
    downloadedBytes: Math.max(0, Math.min(total, downloaded)),
    totalBytes: total
  });
};

const sanitizeName = (value = "") => `${value || ""}`.replace(/[^a-zA-Z0-9._-]+/g, "_");

const stripZipExt = (value = "") => {
  const text = `${value || ""}`.trim();
  return text.replace(/\.zip$/i, "");
};

const buildEasterEggUnpackedDirPath = (fileName, version) => {
  const root = `${wx?.env?.USER_DATA_PATH || ""}`.trim();
  if (!root) return "";
  const safeVersion = sanitizeName(version || "0");
  const safeName = sanitizeName(stripZipExt(fileName || "easter-egg-resource"));
  return `${root}/${EASTER_EGG_UNPACK_PREFIX}${safeVersion}-${safeName}`;
};

const buildMergedFilePath = (fileName, version) => {
  const root = `${wx?.env?.USER_DATA_PATH || ""}`.trim();
  if (!root) return "";
  const safeName = sanitizeName(fileName || "easter-egg-resource.zip");
  const safeVersion = sanitizeName(version || "0");
  return `${root}/easter-egg-${safeVersion}-${safeName}`;
};

const buildLegacyPartFilePath = (fileName, version, index) => {
  const root = `${wx?.env?.USER_DATA_PATH || ""}`.trim();
  if (!root) return "";
  const safeName = sanitizeName(fileName || "easter-egg-resource.zip");
  const safeVersion = sanitizeName(version || "0");
  return `${root}/easter-egg-${safeVersion}-${safeName}.${index}.part`;
};

const cleanupLegacyPartFiles = (fileName, version, maxCount = 40) => {
  const countRaw = Number(maxCount);
  const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : 40;
  const tasks = [];
  for (let i = 0; i < count; i += 1) {
    const path = buildLegacyPartFilePath(fileName, version, i);
    if (!path) continue;
    tasks.push(removeFileQuietly(path));
  }
  return Promise.all(tasks).then(() => true);
};

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
      success: (res) => {
        const savedPath = `${res?.savedFilePath || ""}`.trim();
        resolve(savedPath || path);
      },
      fail: () => resolve(path)
    });
  });

const startLatestEasterEggResourceDownload = (options = {}) => {
  const base = resolveApiBase(options.apiBase);
  const token = options.token || getAuthToken();
  const fileName = `${options.fileName || ""}`.trim();
  const version = `${options.version || ""}`.trim();
  const segmentCountRaw = Number(options.segmentCount);
  const segmentCount =
    Number.isFinite(segmentCountRaw) && segmentCountRaw > 0
      ? Math.floor(segmentCountRaw)
      : DEFAULT_SEGMENT_COUNT;
  let aborted = false;
  let abortCurrent = null;

  const promise = (async () => {
    logEasterEggDownload("download.start", {
      fileName,
      version,
      segmentCount
    });
    if (!base) throw new Error("missing-api-base");
    if (!token) throw new Error("missing-token");
    if (!fileName || !version) throw new Error("missing-resource-meta");
    await clearStaleEasterEggArtifacts(fileName, version);

    let totalBytes = 0;
    try {
      ({ totalBytes } = await probeLatestResourceTotalBytes({
        apiBase: base,
        token
      }));
    } catch (err) {
      if (!isStorageLimitError(err)) throw err;
      logEasterEggDownload("probe.retry.storage-limit", {
        error: normalizeErrorForLog(err)
      });
      await cleanupSavedFilesUnderPressure();
      ({ totalBytes } = await probeLatestResourceTotalBytes({
        apiBase: base,
        token
      }));
    }

    const mergedPath = buildMergedFilePath(fileName, version);
    if (!mergedPath) throw new Error("missing-user-data-path");

    const chunks = buildChunkPlan(totalBytes, segmentCount);
    if (!chunks.length) throw new Error("empty-chunk-plan");
    logEasterEggDownload("chunk.plan.ready", {
      totalBytes,
      chunkCount: chunks.length,
      firstChunk: chunks[0],
      lastChunk: chunks[chunks.length - 1]
    });

    let nextIndex = 0;
    const resume = readStoredEasterEggResourceSegmentState();
    if (
      resume &&
      resume.fileName === fileName &&
      resume.version === version &&
      resume.totalBytes === totalBytes &&
      resume.chunkCount === chunks.length &&
      resume.mergedPath === mergedPath &&
      (await checkFileExists(mergedPath))
    ) {
      const candidateIndex = Math.max(0, Math.min(resume.nextIndex, chunks.length));
      const expectedSize = calculateDownloadedBytesByIndex(chunks, candidateIndex);
      const actualSize = await getFileSize(mergedPath);
      logEasterEggDownload("resume.check", {
        resumeNextIndex: resume.nextIndex,
        candidateIndex,
        expectedSize,
        actualSize,
        mergedPath
      });
      if (actualSize === expectedSize) {
        nextIndex = candidateIndex;
        logEasterEggDownload("resume.accepted", {
          nextIndex,
          mergedPath
        });
      } else {
        logEasterEggDownload("resume.reset.mismatch", {
          expectedSize,
          actualSize
        });
        clearStoredEasterEggResourceSegmentState();
        await cleanupEasterEggPrefixFiles("");
        await cleanupLegacyPartFiles(fileName, version, Math.max(chunks.length + 20, 40));
        await removeFileQuietly(mergedPath);
        await writeArrayBufferWithRetry(mergedPath, new Uint8Array(0).buffer, {
          keepPath: mergedPath,
          keepPaths: [mergedPath]
        });
        logEasterEggDownload("resume.reset.recreated-file", { mergedPath });
      }
    } else {
      logEasterEggDownload("resume.not-used", {
        hasResume: Boolean(resume),
        mergedPath
      });
      clearStoredEasterEggResourceSegmentState();
      await cleanupEasterEggPrefixFiles("");
      await cleanupLegacyPartFiles(fileName, version, Math.max(chunks.length + 20, 40));
      await removeFileQuietly(mergedPath);
      await writeArrayBufferWithRetry(mergedPath, new Uint8Array(0).buffer, {
        keepPath: mergedPath,
        keepPaths: [mergedPath]
      });
      logEasterEggDownload("download.init-file", { mergedPath });
    }

    let downloadedBytes = calculateDownloadedBytesByIndex(chunks, nextIndex);
    emitProgress(downloadedBytes, totalBytes, options.onProgress);

    for (let i = nextIndex; i < chunks.length; i += 1) {
      if (aborted) throw new Error("download-aborted");
      const chunk = chunks[i];
      let result = null;
      let attempt = 0;
      logEasterEggDownload("chunk.loop.start", {
        index: i,
        start: chunk.start,
        end: chunk.end,
        expectedLength: chunk.byteLength
      });
      while (attempt < 2) {
        logEasterEggDownload("chunk.loop.attempt", {
          index: i,
          attempt: attempt + 1
        });
        const request = requestRangeChunk({
          apiBase: base,
          token,
          start: chunk.start,
          end: chunk.end
        });
        abortCurrent = request.abort;
        try {
          result = await request.promise;
          abortCurrent = null;
          break;
        } catch (err) {
          abortCurrent = null;
          if (aborted) throw new Error("download-aborted");
          if (!isStorageLimitError(err) || attempt > 0) {
            logEasterEggDownload("chunk.loop.fail", {
              index: i,
              attempt: attempt + 1,
              error: normalizeErrorForLog(err)
            });
            throw err;
          }
          logEasterEggDownload("chunk.loop.retry.storage-limit", {
            index: i,
            attempt: attempt + 1,
            error: normalizeErrorForLog(err)
          });
          await cleanupEasterEggPrefixFiles(mergedPath);
          await cleanupSavedFilesUnderPressure({
            keepPaths: [mergedPath]
          });
          attempt += 1;
        }
      }
      if (!result) {
        throw new Error("empty-segment-response");
      }
      if (aborted) throw new Error("download-aborted");

      const rawData = result?.data;
      const rawByteLength = rawData && typeof rawData.byteLength === "number" ? Number(rawData.byteLength) : 0;
      const expectedLength = Number(chunk.byteLength) || Math.max(0, chunk.end - chunk.start + 1);
      logEasterEggDownload("chunk.data.received", {
        index: i,
        rawByteLength,
        expectedLength
      });
      if (!Number.isFinite(rawByteLength) || rawByteLength <= 0 || !Number.isFinite(expectedLength) || expectedLength <= 0) {
        throw new Error("empty-segment-data");
      }
      let dataToAppend = rawData;
      if (rawByteLength !== expectedLength) {
        if (rawByteLength < expectedLength) {
          throw new Error("segment-size-mismatch");
        }
        const startOffset = rawByteLength >= chunk.end + 1 ? chunk.start : 0;
        const endOffset = startOffset + expectedLength;
        const sliced = sliceArrayBuffer(rawData, startOffset, endOffset);
        const slicedLength = sliced && typeof sliced.byteLength === "number" ? Number(sliced.byteLength) : 0;
        if (!sliced || slicedLength !== expectedLength) {
          throw new Error("segment-size-mismatch");
        }
        dataToAppend = sliced;
        logEasterEggDownload("chunk.data.sliced", {
          index: i,
          slicedLength
        });
      }

      await appendArrayBufferWithRetry(mergedPath, dataToAppend, {
        keepPath: mergedPath,
        keepPaths: [mergedPath]
      });
      nextIndex = i + 1;
      const fileSizeAfterAppend = await getFileSize(mergedPath);
      writeStoredEasterEggResourceSegmentState({
        fileName,
        version,
        mergedPath,
        totalBytes,
        chunkCount: chunks.length,
        nextIndex,
        updatedAt: Date.now()
      });
      downloadedBytes += expectedLength;
      logEasterEggDownload("chunk.appended", {
        index: i,
        nextIndex,
        downloadedBytes,
        totalBytes,
        fileSizeAfterAppend
      });
      emitProgress(downloadedBytes, totalBytes, options.onProgress);
    }

    clearStoredEasterEggResourceSegmentState();
    emitProgress(totalBytes, totalBytes, options.onProgress);
    logEasterEggDownload("download.completed", {
      fileName,
      version,
      totalBytes,
      mergedPath
    });
    return {
      statusCode: 200,
      tempFilePath: mergedPath,
      totalBytes
    };
  })().catch((err) => {
    logEasterEggDownload("download.failed", {
      fileName,
      version,
      error: normalizeErrorForLog(err)
    });
    throw err;
  });

  return {
    abort() {
      aborted = true;
      logEasterEggDownload("download.abort.called", {
        fileName,
        version
      });
      if (typeof abortCurrent === "function") {
        abortCurrent();
      }
    },
    promise,
    get task() {
      return {
        abort: () => {
          aborted = true;
          if (typeof abortCurrent === "function") {
            abortCurrent();
          }
        }
      };
    }
  };
};

const cacheEasterEggResourceDownload = (options = {}) =>
  saveTempFile(options.tempFilePath).then((savedPath) => {
    const normalized = normalizeEasterEggResourceLocalCache({
      fileName: options.fileName,
      version: options.version,
      path: savedPath,
      updatedAt: Date.now()
    });
    if (!normalized) {
      throw new Error("invalid-easter-egg-cache-payload");
    }
    writeStoredEasterEggResourceLocalCache(normalized);
    writeStoredEasterEggResourceConfig({
      fileName: normalized.fileName,
      version: normalized.version
    });
    return normalized;
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

const cleanupStaleEasterEggUnpackedDirs = async (keepDirPath = "") => {
  const root = `${wx?.env?.USER_DATA_PATH || ""}`.trim();
  if (!root) return;
  const keep = `${keepDirPath || ""}`.trim();
  const entries = await listUserDataFiles();
  const targets = entries
    .filter((name) => typeof name === "string" && name.startsWith(EASTER_EGG_UNPACK_PREFIX))
    .map((name) => `${root}/${name}`)
    .filter((path) => !keep || path !== keep);
  if (!targets.length) return;
  await Promise.all(targets.map((path) => removePathQuietly(path)));
};

const clearMismatchedEasterEggResourceArtifacts = async (targetFileName, targetVersion) => {
  const targetName = `${targetFileName || ""}`.trim();
  const targetVer = `${targetVersion || ""}`.trim();
  if (!targetName || !targetVer) return;
  const targetDir = buildEasterEggUnpackedDirPath(targetName, targetVer);
  const cached = readStoredEasterEggResourceLocalCache();
  if (cached && (cached.fileName !== targetName || cached.version !== targetVer)) {
    await removePathQuietly(cached.path);
    clearStoredEasterEggResourceLocalCache();
  }
  await cleanupStaleEasterEggUnpackedDirs(targetDir);
};

const ensureEasterEggResourceExtracted = async (options = {}) => {
  const fileName = `${options.fileName || ""}`.trim();
  const version = `${options.version || ""}`.trim();
  const zipPath = `${options.zipPath || ""}`.trim();
  if (!fileName || !version) {
    throw new Error("missing-resource-meta");
  }
  if (!zipPath || !(await checkFileExists(zipPath))) {
    throw new Error("missing-zip-file");
  }
  const extractedPath = buildEasterEggUnpackedDirPath(fileName, version);
  if (!extractedPath) {
    throw new Error("missing-user-data-path");
  }
  await removePathQuietly(extractedPath);
  await ensureDirectory(extractedPath);
  try {
    await unzipArchiveToDirectory(zipPath, extractedPath);
  } catch (err) {
    await removePathQuietly(extractedPath);
    throw err;
  }
  const extractedStatAfterUnzip = await getPathStat(extractedPath);
  if (!extractedStatAfterUnzip.exists || !extractedStatAfterUnzip.isDirectory) {
    await removePathQuietly(extractedPath);
    throw new Error("unpacked-directory-missing");
  }
  return {
    fileName,
    version,
    zipPath,
    extractedPath
  };
};

module.exports = {
  EASTER_EGG_RESOURCE_CONFIG_STORAGE_KEY,
  EASTER_EGG_RESOURCE_LOCAL_CACHE_STORAGE_KEY,
  EASTER_EGG_RESOURCE_SEGMENT_STATE_STORAGE_KEY,
  PROBE_BYTES,
  DEFAULT_SEGMENT_COUNT,
  normalizeEasterEggResourceConfig,
  normalizeEasterEggResourceLocalCache,
  readStoredEasterEggResourceConfig,
  readStoredEasterEggResourceLocalCache,
  writeStoredEasterEggResourceConfig,
  writeStoredEasterEggResourceLocalCache,
  hasValidEasterEggResourceLocalCache,
  buildEasterEggResourceDownloadUrl,
  fetchEasterEggResourceConfig,
  startLatestEasterEggResourceDownload,
  cacheEasterEggResourceDownload,
  clearMismatchedEasterEggResourceArtifacts,
  ensureEasterEggResourceExtracted
};
