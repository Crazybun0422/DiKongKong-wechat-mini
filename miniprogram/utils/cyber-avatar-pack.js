const { fetchAvatarPackVersion, downloadAvatarPack } = require("./file-packs");

const CYBER_AVATAR_PACK_CACHE_KEY = "cyberAvatarPackCache";
const CYBER_AVATAR_EXTRACT_DIR_NAME = "cyber-avatar-pack";

function logCyberAvatar(event, detail = {}) {
  try {
    console.log("[cyber-avatar-pack]", event, detail);
  } catch (err) {}
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
  if (!dirPath) return Promise.resolve(false);
  return fileExists(dirPath).then((exists) => {
    if (!exists) return false;
    return promisifyFsCall("rmdir", { dirPath, recursive: true })
      .then(() => fileExists(dirPath))
      .then((stillExists) => {
        if (stillExists) {
          logCyberAvatar("remove-dir:incomplete", { dirPath });
          throw new Error("dir-remove-incomplete");
        }
        logCyberAvatar("remove-dir:success", { dirPath });
        return true;
      });
  });
}

function removeFile(filePath) {
  if (!filePath) return Promise.resolve(false);
  return fileExists(filePath).then((exists) => {
    if (!exists) return false;
    return promisifyFsCall("unlink", { filePath }).catch((err) => {
      if (typeof wx === "undefined" || typeof wx.removeSavedFile !== "function") throw err;
      return new Promise((resolve, reject) => {
        wx.removeSavedFile({
          filePath,
          success: () => resolve(null),
          fail: (removeErr) => reject(removeErr)
        });
      });
    }).then(() => fileExists(filePath))
      .then((stillExists) => {
        if (stillExists) {
          logCyberAvatar("remove-file:incomplete", { filePath });
          throw new Error("file-remove-incomplete");
        }
        logCyberAvatar("remove-file:success", { filePath });
        return true;
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
    const cache = wx.getStorageSync(CYBER_AVATAR_PACK_CACHE_KEY) || {};
    logCyberAvatar("read-cache", cache);
    return cache;
  } catch (err) {
    logCyberAvatar("read-cache-failed", { err });
    return {};
  }
}

function writeStoredPackCache(cache = {}) {
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") return;
  try {
    wx.setStorageSync(CYBER_AVATAR_PACK_CACHE_KEY, cache);
    logCyberAvatar("write-cache", cache);
  } catch (err) {
    console.warn("save cyber avatar pack cache failed", err);
  }
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

function parseCharactersYaml(content = "", rootPath = "") {
  const lines = `${content || ""}`.split(/\r?\n/);
  const characters = [];
  let current = null;
  let inFiles = false;
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const itemMatch = line.match(/^- id:\s*(.+)$/);
    if (itemMatch) {
      if (current) characters.push(current);
      current = {
        id: stripQuote(itemMatch[1]),
        index: 0,
        zhName: "",
        enName: "",
        slug: "",
        avatarPath: "",
        quoteCardPath: ""
      };
      inFiles = false;
      return;
    }
    if (!current) return;
    if (/^\s{2}files:\s*$/.test(line)) {
      inFiles = true;
      return;
    }
    if (inFiles) {
      const fileMatch = line.match(/^\s{4}([A-Za-z0-9_]+):\s*(.+)$/);
      if (fileMatch) {
        const key = fileMatch[1];
        const path = stripQuote(fileMatch[2]).replace(/\\/g, "/");
        if (key === "avatar") current.avatarPath = rootPath ? `${rootPath}/${path}` : path;
        if (key === "quote_card") current.quoteCardPath = rootPath ? `${rootPath}/${path}` : path;
      }
      return;
    }
    const fieldMatch = line.match(/^\s{2}([A-Za-z0-9_]+):\s*(.+)$/);
    if (!fieldMatch) return;
    const key = fieldMatch[1];
    const value = stripQuote(fieldMatch[2]);
    if (key === "index") {
      current.index = Number(value) || 0;
      return;
    }
    if (key === "zh_name") current.zhName = value;
    if (key === "en_name") current.enName = value;
    if (key === "slug") current.slug = value;
  });
  if (current) characters.push(current);
  return characters
    .filter((item) => item.id && item.avatarPath && item.quoteCardPath)
    .sort((a, b) => (a.index || 0) - (b.index || 0));
}

function resolveExtractRootFromManifestPath(manifestPath = "", extractedRoot = "") {
  const normalized = `${manifestPath || ""}`.replace(/\\/g, "/");
  const marker = "/manifest/";
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex > 0) return normalized.slice(0, markerIndex);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash > 0 ? normalized.slice(0, lastSlash) : extractedRoot;
}

function loadCharactersFromExtract(targetPath, versionInfo = {}) {
  logCyberAvatar("load-extract:start", {
    targetPath,
    version: versionInfo.version || "",
    fileName: versionInfo.fileName || ""
  });
  const manifestPath =
    findFile(targetPath, "characters.yaml") || findFile(targetPath, "characters_list.yaml");
  if (!manifestPath) return Promise.reject(new Error("missing-characters-yaml"));
  const archiveRoot = resolveExtractRootFromManifestPath(manifestPath, targetPath);
  return readTextFile(manifestPath).then((content) => {
    const catalog = {
      version: versionInfo.version || "",
      fileName: versionInfo.fileName || "",
      rootPath: archiveRoot,
      manifestPath,
      characters: parseCharactersYaml(content, archiveRoot)
    };
    logCyberAvatar("load-extract:success", {
      targetPath,
      manifestPath,
      characterCount: catalog.characters.length
    });
    return catalog;
  });
}

function getExtractPath(root = "") {
  return root ? `${root}/${CYBER_AVATAR_EXTRACT_DIR_NAME}` : "";
}

function clearInstalledPack(extractPath = "", zipPath = "", reason = "") {
  logCyberAvatar("clear-installed-pack:start", {
    reason,
    extractPath,
    zipPath
  });
  return removeDir(extractPath)
    .catch((err) => {
      logCyberAvatar("clear-installed-pack:extract-failed", { reason, extractPath, err });
      throw err;
    })
    .then(() => {
      if (!zipPath) return null;
      return removeFile(zipPath).catch((err) => {
        logCyberAvatar("clear-installed-pack:zip-failed", { reason, zipPath, err });
        throw err;
      });
    })
    .then(() => {
      logCyberAvatar("clear-installed-pack:done", {
        reason,
        extractPath,
        zipPath
      });
    });
}

function installFromTempZip(tempZipPath, targetPath, versionInfo = {}) {
  logCyberAvatar("install-from-temp-zip:start", {
    tempZipPath,
    targetPath,
    version: versionInfo.version || "",
    fileName: versionInfo.fileName || ""
  });
  return removeDir(targetPath)
    .catch((err) => {
      logCyberAvatar("install-from-temp-zip:extract-clear-failed", { targetPath, err });
      throw err;
    })
    .then(() => ensureDir(targetPath))
    .then(() => {
      logCyberAvatar("install-from-temp-zip:extract-dir-ready", { targetPath });
      return unzipArchive(tempZipPath, targetPath);
    })
    .then(() => {
      logCyberAvatar("install-from-temp-zip:unzipped", { tempZipPath, targetPath });
      return loadCharactersFromExtract(targetPath, versionInfo);
    });
}

function downloadAndInstallPack(fileName, version, options = {}, extractPath = "") {
  logCyberAvatar("download-install:start", {
    fileName,
    version,
    extractPath
  });
  return downloadAvatarPack(fileName, options)
    .then((tempZipPath) => {
      logCyberAvatar("download-install:temp-downloaded", {
        fileName,
        version,
        tempZipPath
      });
      return installFromTempZip(tempZipPath, extractPath, { fileName, version });
    })
    .then((catalog) => {
      writeStoredPackCache({
        fileName,
        version,
        zipPath: "",
        extractPath
      });
      logCyberAvatar("download-install:success", {
        fileName,
        version,
        extractPath,
        characterCount: Array.isArray(catalog?.characters) ? catalog.characters.length : 0
      });
      return catalog;
    });
}

function prepareCyberAvatarCatalog(options = {}) {
  const root = getUserDataPath();
  const fs = getFileSystemManager();
  if (!root || !fs) return Promise.reject(new Error("fs-unavailable"));
  const extractPath = getExtractPath(root);
  logCyberAvatar("prepare:start", {
    root,
    extractPath
  });
  return fetchAvatarPackVersion(options).then((versionInfo = {}) => {
    const fileName = versionInfo.fileName || "";
    const version = versionInfo.version || "";
    logCyberAvatar("prepare:remote-version", versionInfo);
    if (!fileName) throw new Error("missing-avatar-pack-file");

    const cache = readStoredPackCache();
    const cacheMatched = cache.fileName === fileName && cache.version === version;
    logCyberAvatar("prepare:cache-compare", {
      remoteFileName: fileName,
      remoteVersion: version,
      cacheFileName: cache.fileName || "",
      cacheVersion: cache.version || "",
      cacheExtractPath: cache.extractPath || "",
      cacheZipPath: cache.zipPath || "",
      cacheMatched
    });

    const legacyZipPath = cache.zipPath || "";
    const cachedExtractPath = cache.extractPath || extractPath;

    if (cacheMatched) {
      return fileExists(cachedExtractPath)
        .then((extractExists) => {
          logCyberAvatar("prepare:reuse-extract-check", {
            cachedExtractPath,
            extractExists
          });
          if (!extractExists) {
            throw new Error("cached-extract-missing");
          }
          return loadCharactersFromExtract(cachedExtractPath, versionInfo);
        })
        .then((catalog) =>
          removeFile(legacyZipPath)
            .catch(() => null)
            .then(() => {
              if (legacyZipPath) {
                writeStoredPackCache({
                  fileName,
                  version,
                  zipPath: "",
                  extractPath: cachedExtractPath
                });
              }
              logCyberAvatar("prepare:reuse-extract-success", {
                extractPath: cachedExtractPath,
                characterCount: Array.isArray(catalog?.characters) ? catalog.characters.length : 0
              });
              return catalog;
            })
        )
        .catch((err) => {
          logCyberAvatar("prepare:reuse-extract-failed", {
            extractPath: cachedExtractPath,
            err
          });
          return clearInstalledPack(cachedExtractPath, legacyZipPath, "extract-invalid")
            .then(() => {
              writeStoredPackCache({});
              return downloadAndInstallPack(fileName, version, options, extractPath);
            });
        });
    }

    return clearInstalledPack(extractPath, legacyZipPath, "version-changed")
      .catch((err) => {
        logCyberAvatar("prepare:clear-before-install-failed", { extractPath, legacyZipPath, err });
        throw err;
      })
      .then(() => {
        writeStoredPackCache({});
        return downloadAndInstallPack(fileName, version, options, extractPath);
      });
  });
}

module.exports = {
  prepareCyberAvatarCatalog
};
