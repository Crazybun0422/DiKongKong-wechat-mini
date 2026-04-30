const {
  authorizedRequest,
  getAuthToken,
  resolveApiBase
} = require("./profile");
const { fetchVoicePackVersion, downloadVoicePack } = require("./file-packs");

const VOICE_PACK_CACHE_KEY = "voicePackCache";
const VOICE_PACK_EXTRACT_DIR_NAME = "voice-packs";
const VOICE_PACK_EVENTS = {
  start: ["start.wav"],
  first_drag_map: ["first_drag_map.wav"],
  sign_in: ["sign_in.wav", "sign_in_success.wav"]
};

function getAppInstance() {
  try {
    return typeof getApp === "function" ? getApp() : null;
  } catch (err) {
    return null;
  }
}

function getFileSystemManager() {
  if (typeof wx === "undefined" || typeof wx.getFileSystemManager !== "function") return null;
  try {
    return wx.getFileSystemManager();
  } catch (err) {
    return null;
  }
}

function getUserDataPath() {
  return (typeof wx !== "undefined" && wx.env && wx.env.USER_DATA_PATH) || "";
}

function promisifyFsCall(method, options = {}) {
  const fs = getFileSystemManager();
  if (!fs || typeof fs[method] !== "function") {
    return Promise.reject(new Error(`fs-${method}-unsupported`));
  }
  return new Promise((resolve, reject) => {
    fs[method](Object.assign({}, options, {
      success: (res) => resolve(res || {}),
      fail: (err) => reject(err || new Error(`fs-${method}-failed`))
    }));
  });
}

function fileExists(path) {
  const fs = getFileSystemManager();
  if (!path || !fs) return Promise.resolve(false);
  if (typeof fs.access === "function") {
    return promisifyFsCall("access", { path }).then(() => true).catch(() => false);
  }
  if (typeof fs.accessSync === "function") {
    try {
      fs.accessSync(path);
      return Promise.resolve(true);
    } catch (err) {
      return Promise.resolve(false);
    }
  }
  return Promise.resolve(false);
}

function ensureDir(dirPath) {
  if (!dirPath) return Promise.reject(new Error("missing-dir-path"));
  return promisifyFsCall("mkdir", { dirPath, recursive: true }).catch((err) => {
    const message = `${err?.errMsg || err?.message || ""}`;
    if (message.includes("file already exists")) return null;
    throw err;
  });
}

function removeDir(dirPath) {
  if (!dirPath) return Promise.resolve();
  return fileExists(dirPath).then((exists) => {
    if (!exists) return null;
    return promisifyFsCall("rmdir", { dirPath, recursive: true }).catch(() => null);
  });
}

function saveTempFile(tempFilePath) {
  if (!tempFilePath || typeof wx === "undefined" || typeof wx.saveFile !== "function") {
    return Promise.reject(new Error("save-file-unsupported"));
  }
  return new Promise((resolve, reject) => {
    wx.saveFile({
      tempFilePath,
      success: (res = {}) => resolve(res.savedFilePath || tempFilePath),
      fail: (err) => reject(err)
    });
  });
}

function unzipArchive(zipFilePath, targetPath) {
  if (!zipFilePath || !targetPath) return Promise.reject(new Error("missing-unzip-path"));
  return promisifyFsCall("unzip", { zipFilePath, targetPath });
}

function readTextFile(filePath) {
  const fs = getFileSystemManager();
  if (!fs || typeof fs.readFile !== "function") {
    return Promise.reject(new Error("read-file-unsupported"));
  }
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      encoding: "utf8",
      success: (res = {}) => resolve(`${res.data || ""}`),
      fail: (err) => reject(err)
    });
  });
}

function readDirSync(dirPath) {
  const fs = getFileSystemManager();
  if (!fs || typeof fs.readdirSync !== "function") return [];
  try {
    return fs.readdirSync(dirPath) || [];
  } catch (err) {
    return [];
  }
}

function isDirectory(path) {
  const fs = getFileSystemManager();
  if (!fs || typeof fs.statSync !== "function") return false;
  try {
    const stat = fs.statSync(path);
    return !!(stat && typeof stat.isDirectory === "function" && stat.isDirectory());
  } catch (err) {
    return false;
  }
}

function findFile(rootPath, fileName) {
  if (!rootPath || !fileName) return "";
  const entries = readDirSync(rootPath);
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const fullPath = `${rootPath}/${entry}`;
    if (`${entry}`.toLowerCase() === `${fileName}`.toLowerCase()) return fullPath;
    if (isDirectory(fullPath)) {
      const found = findFile(fullPath, fileName);
      if (found) return found;
    }
  }
  return "";
}

function readStoredPackCache() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return {};
  try {
    return wx.getStorageSync(VOICE_PACK_CACHE_KEY) || {};
  } catch (err) {
    return {};
  }
}

function writeStoredPackCache(cache = {}) {
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") return;
  try {
    wx.setStorageSync(VOICE_PACK_CACHE_KEY, cache);
  } catch (err) {
    console.warn("save voice pack cache failed", err);
  }
}

function normalizeDirectoryName(value) {
  return `${value || ""}`.trim();
}

function getSelectedVoicePackDirectoryName(profile = {}) {
  return normalizeDirectoryName(
    profile.selectedVoicePackDirectoryName ||
    profile.voicePackDirectoryName ||
    profile.voicePack ||
    profile.selectedVoicePack ||
    ""
  );
}

function parseExpireTime(value = "") {
  const text = `${value || ""}`.trim();
  if (!text) return 0;
  const normalized = text.includes("T") ? text : text.replace(/-/g, "/");
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isMembershipActive(profile = {}, now = Date.now()) {
  if (!profile || !profile.vip) return false;
  const expireAt = parseExpireTime(
    profile.memberExpireDate || profile.membershipExpireDate || profile.vipExpireDate || ""
  );
  return !expireAt || expireAt >= now;
}

function stripQuote(value = "") {
  const text = `${value || ""}`.trim();
  if (
    (text.startsWith("\"") && text.endsWith("\"")) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function parseVoicePackagesYml(content = "", rootPath = "") {
  const lines = `${content || ""}`.split(/\r?\n/);
  const packages = [];
  let current = null;
  let currentFile = null;
  lines.forEach((line) => {
    if (!line.trim() || line.trim().startsWith("#")) return;
    const topMatch = line.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (topMatch) {
      if (current) packages.push(current);
      current = {
        directoryName: topMatch[1],
        title: topMatch[1],
        description: "",
        files: [],
        rootPath: rootPath ? `${rootPath}/${topMatch[1]}` : ""
      };
      currentFile = null;
      return;
    }
    if (!current) return;
    const descMatch = line.match(/^\s*description:\s*(.*)$/);
    if (descMatch) {
      const value = stripQuote(descMatch[1]);
      if (currentFile) currentFile.description = value;
      else {
        current.description = value;
        current.title = value || current.title;
      }
      return;
    }
    const itemDescMatch = line.match(/^\s*-\s*description:\s*(.*)$/);
    if (itemDescMatch) {
      currentFile = { description: stripQuote(itemDescMatch[1]), name: "", path: "" };
      current.files.push(currentFile);
      return;
    }
    const itemNameMatch = line.match(/^\s*-\s*name:\s*(.*)$/);
    if (itemNameMatch) {
      currentFile = { description: "", name: stripQuote(itemNameMatch[1]), path: "" };
      current.files.push(currentFile);
      return;
    }
    const nameMatch = line.match(/^\s*name:\s*(.*)$/);
    if (nameMatch && currentFile) {
      currentFile.name = stripQuote(nameMatch[1]);
    }
  });
  if (current) packages.push(current);
  return packages
    .map((item) => {
      const packRoot = item.rootPath;
      const files = item.files
        .filter((file) => file.name)
        .map((file) => Object.assign({}, file, {
          path: packRoot ? `${packRoot}/${file.name}` : file.name
        }));
      return Object.assign({}, item, { files });
    })
    .filter((item) => item.directoryName);
}

function resolveVoiceZip(fileName, version, options = {}) {
  const cache = readStoredPackCache();
  const cachedZip = cache.fileName === fileName && cache.version === version ? cache.zipPath : "";
  return fileExists(cachedZip)
    .then((exists) => {
      if (exists) return cachedZip;
      return downloadVoicePack(fileName, options)
        .then((tempPath) => saveTempFile(tempPath))
        .then((zipPath) => {
          writeStoredPackCache(Object.assign({}, cache, { fileName, version, zipPath }));
          return zipPath;
        });
    });
}

function loadVoiceCatalogFromExtract(targetPath, versionInfo = {}) {
  const ymlPath = findFile(targetPath, "packages.yml");
  if (!ymlPath) return Promise.reject(new Error("missing-voice-pack-yml"));
  return readTextFile(ymlPath).then((content) => {
    const packagesRoot = ymlPath.slice(0, ymlPath.lastIndexOf("/"));
    const packages = parseVoicePackagesYml(content, packagesRoot);
    return {
      version: versionInfo.version || "",
      fileName: versionInfo.fileName || "",
      rootPath: targetPath,
      packages
    };
  });
}

function prepareVoicePackCatalog(options = {}) {
  const root = getUserDataPath();
  const fs = getFileSystemManager();
  if (!root || !fs) return Promise.reject(new Error("fs-unavailable"));
  return fetchVoicePackVersion(options).then((versionInfo = {}) => {
    const fileName = versionInfo.fileName || "";
    const version = versionInfo.version || "";
    if (!fileName) throw new Error("missing-voice-pack-file");
    const targetPath = `${root}/${VOICE_PACK_EXTRACT_DIR_NAME}`;
    const cache = readStoredPackCache();
    const canReuseExtract =
      cache.fileName === fileName &&
      cache.version === version &&
      cache.extractPath === targetPath;
    const loadExisting = canReuseExtract
      ? fileExists(`${targetPath}/packages.yml`).then((exists) =>
        exists ? loadVoiceCatalogFromExtract(targetPath, versionInfo) : null
      )
      : Promise.resolve(null);
    return loadExisting.then((existingCatalog) => {
      if (existingCatalog) return existingCatalog;
      return resolveVoiceZip(fileName, version, options)
        .then((zipPath) =>
          removeDir(targetPath)
            .then(() => ensureDir(targetPath))
            .then(() => unzipArchive(zipPath, targetPath))
            .then(() => {
              writeStoredPackCache({ fileName, version, zipPath, extractPath: targetPath });
              return loadVoiceCatalogFromExtract(targetPath, versionInfo);
            })
        );
    });
  });
}

function findVoicePack(catalog = {}, directoryName = "") {
  const target = normalizeDirectoryName(directoryName);
  if (!target) return null;
  const packages = Array.isArray(catalog.packages) ? catalog.packages : [];
  return packages.find((item) => item.directoryName === target) || null;
}

function setActiveVoicePack(pack = null) {
  const app = getAppInstance();
  if (app && app.globalData) {
    app.globalData.activeVoicePack = pack || null;
  }
  return pack || null;
}

function prepareSelectedVoicePack(profile = {}, options = {}) {
  if (!isMembershipActive(profile)) {
    setActiveVoicePack(null);
    return Promise.resolve(null);
  }
  const directoryName = getSelectedVoicePackDirectoryName(profile);
  if (!directoryName) {
    setActiveVoicePack(null);
    return Promise.resolve(null);
  }
  return prepareVoicePackCatalog(options).then((catalog) => {
    const pack = findVoicePack(catalog, directoryName);
    setActiveVoicePack(pack);
    return pack;
  });
}

function getActiveVoicePack() {
  const app = getAppInstance();
  return app && app.globalData ? app.globalData.activeVoicePack || null : null;
}

function createAudioContext() {
  if (typeof wx === "undefined" || typeof wx.createInnerAudioContext !== "function") return null;
  const app = getAppInstance();
  if (app && app.globalData && app.globalData.voicePackAudioContext) {
    return app.globalData.voicePackAudioContext;
  }
  const audio = wx.createInnerAudioContext();
  audio.obeyMuteSwitch = false;
  if (typeof audio.onError === "function") {
    audio.onError((err) => {
      console.warn("voice pack audio play failed", err);
    });
  }
  if (typeof audio.onEnded === "function") {
    audio.onEnded(() => {
      const latestApp = getAppInstance();
      const handler = latestApp && latestApp.globalData
        ? latestApp.globalData.voicePackAudioEndedHandler
        : null;
      if (typeof handler === "function") {
        handler();
      }
    });
  }
  if (app && app.globalData) app.globalData.voicePackAudioContext = audio;
  return audio;
}

function playFile(filePath = "") {
  const path = `${filePath || ""}`.trim();
  if (!path) return false;
  const fs = getFileSystemManager();
  if (fs && typeof fs.accessSync === "function") {
    try {
      fs.accessSync(path);
    } catch (err) {
      console.warn("voice pack audio file missing", path, err);
      return false;
    }
  }
  const audio = createAudioContext();
  if (!audio) return false;
  try {
    audio.stop();
  } catch (err) {
    // ignore
  }
  audio.src = path;
  audio.play();
  return true;
}

function stopVoicePackAudio() {
  const app = getAppInstance();
  const audio = app && app.globalData ? app.globalData.voicePackAudioContext : null;
  if (!audio) return;
  try {
    audio.stop();
  } catch (err) {
    // ignore
  }
}

function setVoicePackAudioEndedHandler(handler = null) {
  const app = getAppInstance();
  if (!app || !app.globalData) return;
  app.globalData.voicePackAudioEndedHandler = typeof handler === "function" ? handler : null;
}

function playVoicePackFile(pack = null, fileName = "") {
  if (!pack || !fileName) return false;
  const files = Array.isArray(pack.files) ? pack.files : [];
  const file = files.find((item) => item.name === fileName);
  return file ? playFile(file.path) : false;
}

function playVoicePackEvent(eventName = "") {
  const pack = getActiveVoicePack();
  if (!pack) return false;
  const candidates = VOICE_PACK_EVENTS[eventName] || [];
  for (let i = 0; i < candidates.length; i += 1) {
    if (playVoicePackFile(pack, candidates[i])) return true;
  }
  return false;
}

function updateSelectedVoicePack(directoryName = "", options = {}) {
  const voicePackDirectoryName = normalizeDirectoryName(directoryName);
  if (!voicePackDirectoryName) return Promise.reject(new Error("missing-voice-pack-directory"));
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token || getAuthToken(),
    path: "/api/user/profile/voice-pack",
    method: "PUT",
    data: { voicePackDirectoryName }
  }).then((body = {}) => body?.data || body);
}

module.exports = {
  VOICE_PACK_EVENTS,
  getSelectedVoicePackDirectoryName,
  isMembershipActive,
  prepareVoicePackCatalog,
  prepareSelectedVoicePack,
  setActiveVoicePack,
  getActiveVoicePack,
  playVoicePackFile,
  playVoicePackEvent,
  stopVoicePackAudio,
  setVoicePackAudioEndedHandler,
  updateSelectedVoicePack
};
