const { resolveApiBase, getAuthToken } = require("../../../utils/profile");
const { wgs84ToGcj02, outOfChina } = require("../../../utils/coords");
const asmCrypto = require("../vendor/asmcrypto.js");

const UOM3_RENDER_COLOR_STORAGE_KEY = "uom3RenderColor";
const UOM3_AES_KEY_STORAGE_KEY = "uom3KmlDecryptAesKey";
const UOM3_FILE_CACHE_STORAGE_KEY = "uom3SuitableFlyZoneFileCache";
const UOM3_CACHE_DIR_NAME = "uom3-kml-cache";
const UOM3_DEFAULT_KML_COLOR = "66f4f401";
const UOM3_DEFAULT_RENDER_COLOR = "default";
const UOM4_RENDER_ALPHA_FACTOR = 0.7;
const UOM3_MAX_POLYGON_POINTS = 900;
const UOM3_MAX_POLYLINE_POINTS = 1200;
const UOM3_SIMPLIFY_TOLERANCE_STEPS = [0, 1, 2, 4, 8, 16, 32, 64, 128];
const UOM3_SAFE_STATUS_TEXT = "适飞空域（限高120m）";
const UOM3_NON_RESTRICTED_STATUS_TEXT = "非管制区域";
const UOM3_RESTRICTED_STATUS_TEXT = "管制空域";

const UOM3_MEMORY_RESOURCE_CACHE_LIMIT = 3;
const memoryResourceCache = new Map();
const memoryResourcePromiseCache = new Map();
let memoryAesKeyPayload = null;

function touchMemoryResourceCacheEntry(fileName = "", resource = null) {
  const key = `${fileName || ""}`.trim();
  if (!key || !resource) return;
  if (memoryResourceCache.has(key)) {
    memoryResourceCache.delete(key);
  }
  memoryResourceCache.set(key, resource);
  while (memoryResourceCache.size > UOM3_MEMORY_RESOURCE_CACHE_LIMIT) {
    const oldestKey = memoryResourceCache.keys().next().value;
    if (!oldestKey) break;
    memoryResourceCache.delete(oldestKey);
  }
}

function describeError(err) {
  let rawString = "";
  try {
    rawString = err && typeof err === "object" ? JSON.stringify(err) : `${err || ""}`;
  } catch (jsonErr) {
    rawString = `${err || ""}`;
  }
  if (!err) return { message: "unknown-error" };
  return {
    message: err.message || `${err}`,
    errMsg: err.errMsg || "",
    statusCode: Number(err.statusCode) || 0,
    stack: err.stack || "",
    rawType: Object.prototype.toString.call(err),
    rawKeys: err && typeof err === "object" ? Object.keys(err) : [],
    rawString
  };
}

function logUom3(level, message, detail) {
  const payload = detail && typeof detail === "object" ? detail : undefined;
  if (level === "warn") {
    console.warn(`[uom3-v2] ${message}`, payload || "");
    return;
  }
  console.log(`[uom3-v2] ${message}`, payload || "");
}

function normalizeRenderColor(value) {
  const text = `${value || ""}`.trim();
  if (!text || text.toLowerCase() === UOM3_DEFAULT_RENDER_COLOR) {
    return UOM3_DEFAULT_RENDER_COLOR;
  }
  const hex = text.replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return `#${hex.toUpperCase()}`;
  }
  return UOM3_DEFAULT_RENDER_COLOR;
}

function readStoredRenderColor() {
  try {
    return normalizeRenderColor(wx.getStorageSync(UOM3_RENDER_COLOR_STORAGE_KEY));
  } catch (err) {
    return UOM3_DEFAULT_RENDER_COLOR;
  }
}

function writeStoredRenderColor(value) {
  const normalized = normalizeRenderColor(value);
  try {
    wx.setStorageSync(UOM3_RENDER_COLOR_STORAGE_KEY, normalized);
  } catch (err) {
    // ignore storage failure
  }
  return normalized;
}

function normalizeAesKeyPayload(payload = {}) {
  const aesKey = typeof payload?.aesKey === "string" ? payload.aesKey.trim() : "";
  if (!aesKey) return null;
  return {
    aesKey,
    updatedAt: Number(payload?.updatedAt) || Date.now()
  };
}

function readStoredAesKeyPayload() {
  try {
    const normalized = normalizeAesKeyPayload(wx.getStorageSync(UOM3_AES_KEY_STORAGE_KEY));
    if (normalized?.aesKey) {
      memoryAesKeyPayload = normalized;
    }
    return normalized;
  } catch (err) {
    return null;
  }
}

function writeStoredAesKeyPayload(payload = {}) {
  const normalized = normalizeAesKeyPayload(payload);
  if (!normalized) return null;
  memoryAesKeyPayload = normalized;
  try {
    wx.setStorageSync(UOM3_AES_KEY_STORAGE_KEY, normalized);
  } catch (err) {
    // ignore storage failure
  }
  return normalized;
}

function normalizeFileCacheMeta(payload = {}) {
  const fileName = typeof payload?.fileName === "string" ? payload.fileName.trim() : "";
  const path = typeof payload?.path === "string" ? payload.path.trim() : "";
  if (!fileName || !path) return null;
  return {
    fileName,
    path,
    encrypted: payload?.encrypted === true,
    updatedAt: Number(payload?.updatedAt) || Date.now()
  };
}

function readStoredFileCacheMeta() {
  try {
    return normalizeFileCacheMeta(wx.getStorageSync(UOM3_FILE_CACHE_STORAGE_KEY));
  } catch (err) {
    return null;
  }
}

function writeStoredFileCacheMeta(payload = {}) {
  const normalized = normalizeFileCacheMeta(payload);
  if (!normalized) return null;
  try {
    wx.setStorageSync(UOM3_FILE_CACHE_STORAGE_KEY, normalized);
  } catch (err) {
    // ignore storage failure
  }
  return normalized;
}

function clearStoredFileCacheMeta() {
  try {
    wx.removeStorageSync(UOM3_FILE_CACHE_STORAGE_KEY);
  } catch (err) {
    // ignore storage failure
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

function checkFileExists(path) {
  return new Promise((resolve) => {
    const target = `${path || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs) {
      resolve(false);
      return;
    }
    fs.access({
      path: target,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

function ensureDirectory(dirPath) {
  return new Promise((resolve, reject) => {
    const target = `${dirPath || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs) {
      reject(new Error("fs-unavailable"));
      return;
    }
    fs.mkdir({
      dirPath: target,
      recursive: true,
      success: () => resolve(target),
      fail: (err) => {
        const errMsg = `${err?.errMsg || ""}`;
        if (errMsg.includes("file already exists")) {
          resolve(target);
          return;
        }
        reject(err || new Error("mkdir-failed"));
      }
    });
  });
}

function unlinkQuietly(path) {
  return new Promise((resolve) => {
    const target = `${path || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs) {
      resolve(false);
      return;
    }
    fs.unlink({
      filePath: target,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

function readTextFile(filePath) {
  return new Promise((resolve, reject) => {
    const target = `${filePath || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs) {
      reject(new Error("fs-unavailable"));
      return;
    }
    fs.readFile({
      filePath: target,
      encoding: "utf-8",
      success: (res = {}) => resolve(`${res.data || ""}`),
      fail: (err) => reject(err || new Error("read-file-failed"))
    });
  });
}

function writeTextFile(filePath, data = "") {
  return new Promise((resolve, reject) => {
    const target = `${filePath || ""}`.trim();
    const fs = getFileSystemManager();
    if (!target || !fs) {
      reject(new Error("fs-unavailable"));
      return;
    }
    fs.writeFile({
      filePath: target,
      data: `${data || ""}`,
      encoding: "utf-8",
      success: () => resolve(target),
      fail: (err) => reject(err || new Error("write-file-failed"))
    });
  });
}

function isFileStorageLimitError(err) {
  const message = `${err?.errMsg || err?.message || err || ""}`.toLowerCase();
  return (
    message.includes("maximum size of the file storage limit is exceeded") ||
    message.includes("file storage limit is exceeded") ||
    message.includes("storage limit")
  );
}

function buildCacheRootPath() {
  const userPath = `${wx?.env?.USER_DATA_PATH || ""}`.trim();
  return userPath ? `${userPath}/${UOM3_CACHE_DIR_NAME}` : "";
}

function sanitizeFileName(value = "") {
  return `${value || ""}`.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_");
}

function buildCachedKmlFilePath(fileName = "") {
  const root = buildCacheRootPath();
  if (!root) return "";
  return `${root}/${sanitizeFileName(fileName || "uom3")}.kml`;
}

function decodeArrayBuffer(buffer) {
  if (!(buffer instanceof ArrayBuffer)) return "";
  try {
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-8").decode(new Uint8Array(buffer));
    }
  } catch (err) {
    // fall through
  }
  const bytes = new Uint8Array(buffer);
  let text = "";
  const chunkSize = 1024;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  try {
    return decodeURIComponent(escape(text));
  } catch (err) {
    return text;
  }
}

function requestRaw(options = {}) {
  return new Promise((resolve, reject) => {
    const url = `${options.url || ""}`.trim();
    if (!url) {
      reject(new Error("missing-url"));
      return;
    }
    const header = Object.assign({}, options.header || {});
    if (options.token) {
      header.Authorization = `Bearer ${options.token}`;
    }
    wx.request({
      url,
      method: options.method || "GET",
      data: options.data,
      responseType: options.responseType,
      header,
      success: (res = {}) => {
        const statusCode = Number(res.statusCode) || 0;
        if (statusCode >= 200 && statusCode < 300) {
          resolve(res);
          return;
        }
        reject(new Error(`${res?.errMsg || "request-failed"}:${statusCode || "unknown"}`));
      },
      fail: (err) => reject(err || new Error("request-failed"))
    });
  });
}

function resolveSuitableFlyZoneDownloadBase(explicitBase) {
  if (explicitBase) return `${explicitBase}`.trim();
  try {
    const app = getApp ? getApp() : null;
    const guideAssetBase = app?.globalData?.guideAssetBase;
    if (guideAssetBase) {
      return `${guideAssetBase}`.trim();
    }
  } catch (err) {
    // ignore app lookup failure
  }
  return resolveApiBase();
}

function buildResolveUrl(center = {}, apiBase = resolveApiBase()) {
  if (!apiBase) return "";
  const longitude = Number(center?.longitude);
  const latitude = Number(center?.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return "";
  return `${apiBase}/api/suitable-fly-zone-city-kml/resolve?longitude=${encodeURIComponent(longitude)}&latitude=${encodeURIComponent(latitude)}`;
}

function buildDownloadUrl(fileName = "", downloadBase = resolveSuitableFlyZoneDownloadBase()) {
  if (!downloadBase || !fileName) return "";
  return `${downloadBase}/api/suitable-fly-zone-city-kml/download/${encodeURIComponent(fileName)}`;
}

async function resolveSuitableFlyZoneFile(center = {}, options = {}) {
  const apiBase = resolveApiBase(options.apiBase);
  const url = buildResolveUrl(center, apiBase);
  if (!url) {
    throw new Error("missing-api-base");
  }
  const res = await requestRaw({
    url,
    method: "GET",
    header: {
      "content-type": "application/json"
    }
  });
  const payload = res?.data?.data || {};
  return {
    fileName: typeof payload.fileName === "string" ? payload.fileName.trim() : "",
    encrypted: payload.encrypted === true
  };
}

async function fetchKmlDecryptAesKey(options = {}) {
  const apiBase = resolveApiBase(options.apiBase);
  const token = options.token || getAuthToken();
  const forceRefresh = options.forceRefresh === true;
  const inMemory = !forceRefresh ? normalizeAesKeyPayload(memoryAesKeyPayload) : null;
  if (inMemory?.aesKey) {
    return inMemory.aesKey;
  }
  const stored = !forceRefresh ? readStoredAesKeyPayload() : normalizeAesKeyPayload(memoryAesKeyPayload) || readStoredAesKeyPayload();
  if (!apiBase || !token) {
    if (stored?.aesKey) return stored.aesKey;
    throw new Error("missing-token");
  }
  try {
    logUom3("log", "fetch decrypt aes key", {
      apiBase,
      forceRefresh
    });
    const res = await requestRaw({
      url: `${apiBase}/api/config/kml-decrypt-aes-key`,
      method: "GET",
      token,
      header: {
        "content-type": "application/json"
      }
    });
    const aesKey = typeof res?.data?.data?.aesKey === "string" ? res.data.data.aesKey.trim() : "";
    if (!aesKey) {
      throw new Error("empty-aes-key");
    }
    writeStoredAesKeyPayload({ aesKey, updatedAt: Date.now() });
    return aesKey;
  } catch (err) {
    logUom3("warn", "fetch decrypt aes key failed", {
      apiBase,
      forceRefresh,
      error: describeError(err)
    });
    if (stored?.aesKey) return stored.aesKey;
    throw err;
  }
}

function base64ToBytes(base64 = "") {
  const text = `${base64 || ""}`.trim();
  if (!text) return new Uint8Array(0);
  if (typeof wx !== "undefined" && typeof wx.base64ToArrayBuffer === "function") {
    try {
      return new Uint8Array(wx.base64ToArrayBuffer(text));
    } catch (err) {
      // fall through
    }
  }
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let normalized = text.replace(/[^A-Za-z0-9+/=]/g, "");
  let bufferLength = (normalized.length * 3) / 4;
  if (normalized.charAt(normalized.length - 1) === "=") bufferLength -= 1;
  if (normalized.charAt(normalized.length - 2) === "=") bufferLength -= 1;
  const arraybuffer = new ArrayBuffer(Math.max(0, bufferLength));
  const bytes = new Uint8Array(arraybuffer);
  let offset = 0;
  for (let i = 0; i < normalized.length; i += 4) {
    const encoded1 = chars.indexOf(normalized.charAt(i));
    const encoded2 = chars.indexOf(normalized.charAt(i + 1));
    const encoded3 = chars.indexOf(normalized.charAt(i + 2));
    const encoded4 = chars.indexOf(normalized.charAt(i + 3));
    bytes[offset++] = (encoded1 << 2) | (encoded2 >> 4);
    if (encoded3 !== 64) {
      bytes[offset++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    }
    if (encoded4 !== 64) {
      bytes[offset++] = ((encoded3 & 3) << 6) | encoded4;
    }
  }
  return bytes;
}

function concatBytes(a, b) {
  const left = a instanceof Uint8Array ? a : new Uint8Array(0);
  const right = b instanceof Uint8Array ? b : new Uint8Array(0);
  const merged = new Uint8Array(left.length + right.length);
  merged.set(left, 0);
  merged.set(right, left.length);
  return merged;
}

function normalizeHexKeyText(value = "") {
  return `${value || ""}`.trim().replace(/^0x/i, "").replace(/\s+/g, "");
}

function hexToBytesStrict(hexText = "") {
  const normalized = normalizeHexKeyText(hexText);
  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("invalid-display-key-hex");
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
}

function addIntegerToBytesWithCarry(bytes, increment = 0) {
  const target = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(0);
  let carry = Number(increment) || 0;
  for (let i = target.length - 1; i >= 0 && carry > 0; i -= 1) {
    const sum = target[i] + (carry & 0xff);
    target[i] = sum & 0xff;
    carry = (carry >> 8) + (sum >> 8);
  }
  if (carry > 0) {
    throw new Error("display-key-overflow");
  }
  return target;
}

function deriveRealAes128KeyFromDisplayKey(keyText = "") {
  const displayKeyBytes = hexToBytesStrict(keyText);
  if (displayKeyBytes.length !== 16) {
    throw new Error("display-key-not-aes128");
  }
  return addIntegerToBytesWithCarry(displayKeyBytes, 0x1f);
}

async function decryptKmlEnvelope(envelope = {}, keyText = "") {
  if (!envelope || envelope.format !== "uom-kml-aes-gcm-v1") {
    throw new Error("unsupported-encryption-format");
  }
  if (envelope.algorithm && envelope.algorithm !== "AES-128-GCM") {
    throw new Error("unsupported-encryption-algorithm");
  }
  if (
    envelope.keyDerivation &&
    envelope.keyDerivation !== "display-key-hex-128-plus-0x1f-with-carry"
  ) {
    throw new Error("unsupported-key-derivation");
  }
  const key = deriveRealAes128KeyFromDisplayKey(keyText);
  const nonce = base64ToBytes(envelope.nonce);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const tag = base64ToBytes(envelope.tag);
  const encrypted = concatBytes(ciphertext, tag);
  const plainBytes = asmCrypto.AES_GCM.decrypt(encrypted, key, nonce, undefined, 16);
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8").decode(plainBytes);
  }
  if (typeof asmCrypto.bytes_to_string === "function") {
    return asmCrypto.bytes_to_string(plainBytes, true);
  }
  return decodeArrayBuffer(plainBytes.buffer);
}

async function decryptDownloadedKmlText(rawText = "", options = {}) {
  const text = `${rawText || ""}`;
  const trimmed = text.trim();
  const fileName = `${options.fileName || ""}`.trim();
  if (!trimmed) {
    throw new Error("empty-encrypted-payload");
  }
  if (trimmed.startsWith("<")) {
    logUom3("warn", "encrypted resource returned plain kml, skip decrypt", {
      fileName
    });
    return text;
  }

  let envelope = null;
  try {
    envelope = JSON.parse(trimmed);
  } catch (err) {
    logUom3("warn", "parse encrypted envelope failed", {
      fileName,
      preview: trimmed.slice(0, 160),
      error: describeError(err)
    });
    throw err;
  }

  const attemptDecrypt = async (forceRefreshKey) => {
    const aesKey = await fetchKmlDecryptAesKey({
      apiBase: options.apiBase,
      token: options.token,
      forceRefresh: forceRefreshKey
    });
    return decryptKmlEnvelope(envelope, aesKey);
  };

  try {
    return await attemptDecrypt(false);
  } catch (err) {
    logUom3("warn", "decrypt kml envelope failed, retry with fresh key", {
      fileName,
      algorithm: envelope?.algorithm || "",
      keyDerivation: envelope?.keyDerivation || "",
      envelopeFormat: envelope?.format || "",
      hasNonce: !!envelope?.nonce,
      hasCiphertext: !!envelope?.ciphertext,
      hasTag: !!envelope?.tag,
      error: describeError(err)
    });
    try {
      return await attemptDecrypt(true);
    } catch (retryErr) {
      logUom3("warn", "decrypt kml envelope failed after key refresh", {
        fileName,
        algorithm: envelope?.algorithm || "",
        keyDerivation: envelope?.keyDerivation || "",
        envelopeFormat: envelope?.format || "",
        error: describeError(retryErr)
      });
      throw retryErr;
    }
  }
}

function normalizeKmlHexColor(value = "") {
  const raw = `${value || ""}`.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{8}$/.test(raw)) return raw.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `ff${raw.toLowerCase()}`;
  return "";
}

function kmlColorToWxColor(kmlHexColor = "", renderColor = UOM3_DEFAULT_RENDER_COLOR) {
  const normalized = normalizeKmlHexColor(kmlHexColor) || UOM3_DEFAULT_KML_COLOR;
  const rawAlpha = parseInt(normalized.slice(0, 2), 16) || 0;
  const alpha = Math.max(0, Math.min(255, Math.round(rawAlpha * UOM4_RENDER_ALPHA_FACTOR)))
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  const blue = normalized.slice(2, 4);
  const green = normalized.slice(4, 6);
  const red = normalized.slice(6, 8);
  let rgb = `${red}${green}${blue}`.toUpperCase();
  const override = normalizeRenderColor(renderColor);
  if (override !== UOM3_DEFAULT_RENDER_COLOR && rawAlpha > 0) {
    rgb = override.slice(1).toUpperCase();
  }
  return `#${rgb}${alpha}`;
}

function kmlColorAlpha(kmlHexColor = "") {
  const normalized = normalizeKmlHexColor(kmlHexColor);
  if (!normalized) return 0;
  return parseInt(normalized.slice(0, 2), 16) || 0;
}

function buildHoleMaskFillColor(baseColor = "") {
  const normalized = `${baseColor || ""}`.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{8}$/.test(normalized)) {
    return "#F4F4F438";
  }
  const alpha = parseInt(normalized.slice(6, 8), 16) || 0;
  const gray = 244;
  const nextAlpha = Math.max(24, Math.min(72, Math.round(alpha * 0.6)));
  const toHex = (value) => value.toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(gray)}${toHex(gray)}${toHex(gray)}${toHex(nextAlpha)}`;
}

function extractTagText(xml = "", tagName = "") {
  if (!xml || !tagName) return "";
  const match = xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match && match[1] ? `${match[1]}`.trim() : "";
}

function mergeStyle(base = null, extra = null) {
  return Object.assign(
    {
      lineColor: "",
      lineWidth: 1,
      polyColor: "",
      fillEnabled: true,
      outlineEnabled: true
    },
    base || {},
    extra || {}
  );
}

function parseStyleBlock(styleText = "") {
  if (!styleText) return mergeStyle();
  const lineStyleText = extractTagText(styleText, "LineStyle");
  const polyStyleText = extractTagText(styleText, "PolyStyle");
  const width = Number(extractTagText(lineStyleText, "width"));
  const fillText = extractTagText(polyStyleText, "fill");
  const outlineText = extractTagText(polyStyleText, "outline");
  return mergeStyle(null, {
    lineColor: normalizeKmlHexColor(extractTagText(lineStyleText, "color")),
    lineWidth: Number.isFinite(width) && width > 0 ? width : 1,
    polyColor: normalizeKmlHexColor(extractTagText(polyStyleText, "color")),
    fillEnabled: fillText === "" ? true : fillText !== "0",
    outlineEnabled: outlineText === "" ? true : outlineText !== "0"
  });
}

function buildStyleDictionaries(xml = "") {
  const styles = new Map();
  const styleMaps = new Map();
  const styleRegex = /<Style\b[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/Style>/gi;
  let match = null;
  while ((match = styleRegex.exec(xml))) {
    styles.set(`${match[1]}`.trim(), parseStyleBlock(match[2]));
  }
  const styleMapRegex = /<StyleMap\b[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/StyleMap>/gi;
  while ((match = styleMapRegex.exec(xml))) {
    const id = `${match[1]}`.trim();
    const block = `${match[2] || ""}`;
    const pairRegex = /<Pair\b[^>]*>([\s\S]*?)<\/Pair>/gi;
    let pair = null;
    while ((pair = pairRegex.exec(block))) {
      const pairText = `${pair[1] || ""}`;
      const key = extractTagText(pairText, "key");
      const styleUrl = extractTagText(pairText, "styleUrl").replace(/^#/, "");
      if (key === "normal" && styleUrl) {
        styleMaps.set(id, styleUrl);
        break;
      }
    }
  }
  return { styles, styleMaps };
}

function resolveStyleByUrl(styleUrl = "", dictionaries = {}, seen = new Set()) {
  const id = `${styleUrl || ""}`.replace(/^#/, "").trim();
  if (!id || seen.has(id)) return mergeStyle();
  seen.add(id);
  const style = dictionaries?.styles?.get(id);
  if (style) return mergeStyle(style);
  const styleMapRef = dictionaries?.styleMaps?.get(id);
  if (styleMapRef) {
    return resolveStyleByUrl(styleMapRef, dictionaries, seen);
  }
  return mergeStyle();
}

function extractFirstCoordinatesBlock(geometryText = "") {
  const match = geometryText.match(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i);
  return match?.[1] || "";
}

function extractCoordinatesBlocksWithinTag(geometryText = "", tagName = "") {
  if (!geometryText || !tagName) return [];
  const regex = new RegExp(
    `<${tagName}\\b[\\s\\S]*?<coordinates\\b[^>]*>([\\s\\S]*?)<\\/coordinates>`,
    "gi"
  );
  const blocks = [];
  let match = null;
  while ((match = regex.exec(geometryText))) {
    if (match?.[1]) {
      blocks.push(match[1]);
    }
  }
  return blocks;
}

function extractPolygonRingBlocks(geometryText = "") {
  const outerBlocks = extractCoordinatesBlocksWithinTag(geometryText, "outerBoundaryIs");
  const innerBlocks = extractCoordinatesBlocksWithinTag(geometryText, "innerBoundaryIs");
  return {
    outer: outerBlocks[0] || extractFirstCoordinatesBlock(geometryText),
    holes: innerBlocks
  };
}

function parseCoordinateText(coordinateText = "") {
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
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
      return { longitude, latitude };
    })
    .filter(Boolean);
  if (points.length >= 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (
      Math.abs(first.longitude - last.longitude) <= 1e-9 &&
      Math.abs(first.latitude - last.latitude) <= 1e-9
    ) {
      points.pop();
    }
  }
  return points;
}

function convertWgsPointsToGcj(points = []) {
  return (Array.isArray(points) ? points : [])
    .map((point) => {
      if (!Number.isFinite(point?.longitude) || !Number.isFinite(point?.latitude)) return null;
      if (outOfChina(point.longitude, point.latitude)) {
        return {
          longitude: Number(point.longitude),
          latitude: Number(point.latitude)
        };
      }
      const converted = wgs84ToGcj02(Number(point.longitude), Number(point.latitude));
      return {
        longitude: Number(converted.lng),
        latitude: Number(converted.lat)
      };
    })
    .filter(Boolean);
}

function buildBounds(points = []) {
  if (!Array.isArray(points) || !points.length) return null;
  return points.reduce(
    (acc, point) => ({
      minLng: Math.min(acc.minLng, point.longitude),
      maxLng: Math.max(acc.maxLng, point.longitude),
      minLat: Math.min(acc.minLat, point.latitude),
      maxLat: Math.max(acc.maxLat, point.latitude)
    }),
    {
      minLng: Number.POSITIVE_INFINITY,
      maxLng: Number.NEGATIVE_INFINITY,
      minLat: Number.POSITIVE_INFINITY,
      maxLat: Number.NEGATIVE_INFINITY
    }
  );
}

function normalizeViewportBounds(region = null) {
  const northeast = region?.northeast || null;
  const southwest = region?.southwest || null;
  const neLng = Number(northeast?.longitude);
  const neLat = Number(northeast?.latitude);
  const swLng = Number(southwest?.longitude);
  const swLat = Number(southwest?.latitude);
  if (
    !Number.isFinite(neLng) ||
    !Number.isFinite(neLat) ||
    !Number.isFinite(swLng) ||
    !Number.isFinite(swLat)
  ) {
    return null;
  }
  return {
    minLng: Math.min(neLng, swLng),
    maxLng: Math.max(neLng, swLng),
    minLat: Math.min(neLat, swLat),
    maxLat: Math.max(neLat, swLat)
  };
}

function boundsIntersect(a, b) {
  if (!a || !b) return true;
  return !(
    a.maxLng < b.minLng ||
    a.minLng > b.maxLng ||
    a.maxLat < b.minLat ||
    a.minLat > b.maxLat
  );
}

function pointInBounds(point, bounds) {
  if (!point || !bounds) return false;
  return (
    point.longitude >= bounds.minLng &&
    point.longitude <= bounds.maxLng &&
    point.latitude >= bounds.minLat &&
    point.latitude <= bounds.maxLat
  );
}

function pointOnSegment(a, b, p) {
  const epsilon = 1e-10;
  return (
    Math.min(a.longitude, b.longitude) - epsilon <= p.longitude &&
    p.longitude <= Math.max(a.longitude, b.longitude) + epsilon &&
    Math.min(a.latitude, b.latitude) - epsilon <= p.latitude &&
    p.latitude <= Math.max(a.latitude, b.latitude) + epsilon &&
    Math.abs(
      (b.longitude - a.longitude) * (p.latitude - a.latitude) -
      (b.latitude - a.latitude) * (p.longitude - a.longitude)
    ) <= epsilon
  );
}

function pointInPolygon(point, polygon = []) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i];
    const previous = polygon[j];
    if (pointOnSegment(previous, current, point)) return true;
    const crosses = (current.latitude > point.latitude) !== (previous.latitude > point.latitude);
    if (!crosses) continue;
    const slope = (previous.longitude - current.longitude) / ((previous.latitude - current.latitude) || 1e-10);
    const xAtY = slope * (point.latitude - current.latitude) + current.longitude;
    if (point.longitude < xAtY) inside = !inside;
  }
  return inside;
}

function normalizeHolePointsList(pointsList = []) {
  return (Array.isArray(pointsList) ? pointsList : []).filter((points) => Array.isArray(points) && points.length >= 3);
}

function closePolylinePoints(points = []) {
  const next = Array.isArray(points) ? points.slice() : [];
  if (next.length < 2) return next;
  const first = next[0];
  const last = next[next.length - 1];
  if (
    Math.abs(Number(first?.longitude) - Number(last?.longitude)) > 1e-9 ||
    Math.abs(Number(first?.latitude) - Number(last?.latitude)) > 1e-9
  ) {
    next.push({
      longitude: Number(first.longitude),
      latitude: Number(first.latitude)
    });
  }
  return next;
}

function dedupeAdjacentPoints(points = []) {
  if (!Array.isArray(points) || !points.length) return [];
  const deduped = [];
  points.forEach((point) => {
    const longitude = Number(point?.longitude);
    const latitude = Number(point?.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      Math.abs(previous.longitude - longitude) <= 1e-9 &&
      Math.abs(previous.latitude - latitude) <= 1e-9
    ) {
      return;
    }
    deduped.push({ longitude, latitude });
  });
  return deduped;
}

function simplifyPointsToLimit(points = [], options = {}) {
  const limit = Math.max(0, Number(options?.limit) || 0);
  const type = options?.type === "polyline" ? "polyline" : "polygon";
  const baseTolerance = Math.max(0, Number(options?.baseTolerance) || 0);
  const minimumPoints = type === "polyline" ? 2 : 3;
  const sanitizedPoints = dedupeAdjacentPoints(points);
  if (sanitizedPoints.length <= minimumPoints) {
    return sanitizedPoints.length >= minimumPoints
      ? sanitizedPoints
      : (Array.isArray(points) ? points.slice() : []);
  }
  if (!limit || sanitizedPoints.length <= limit) {
    return sanitizedPoints;
  }
  const simplify = type === "polyline" ? simplifyOpenPoints : simplifyRingPoints;
  let best = sanitizedPoints;
  for (let i = 0; i < UOM3_SIMPLIFY_TOLERANCE_STEPS.length; i += 1) {
    const tolerance = Math.max(baseTolerance, UOM3_SIMPLIFY_TOLERANCE_STEPS[i]);
    const candidate = dedupeAdjacentPoints(simplify(best, tolerance));
    if (candidate.length >= minimumPoints && candidate.length < best.length) {
      best = candidate;
    }
    if (best.length <= limit) {
      break;
    }
  }
  return best.length >= minimumPoints ? best : sanitizedPoints;
}

function resolveRenderSimplifyToleranceMeters(scale) {
  const numeric = Number(scale);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric <= 8) return 220;
  if (numeric <= 9) return 160;
  if (numeric <= 10) return 120;
  if (numeric <= 11) return 80;
  if (numeric <= 12) return 48;
  if (numeric <= 13) return 24;
  if (numeric <= 14) return 12;
  if (numeric <= 15) return 6;
  return 0;
}

function createMeterProjector(points = []) {
  const first = Array.isArray(points) ? points[0] : null;
  const baseLat = Number(first?.latitude);
  const baseLng = Number(first?.longitude);
  if (!Number.isFinite(baseLat) || !Number.isFinite(baseLng)) {
    return null;
  }
  const metersPerLat = 111320;
  const metersPerLng = metersPerLat * Math.max(Math.cos((baseLat * Math.PI) / 180), 0.0001);
  return {
    project(point) {
      return {
        x: (Number(point.longitude) - baseLng) * metersPerLng,
        y: (Number(point.latitude) - baseLat) * metersPerLat
      };
    }
  };
}

function pointToSegmentDistanceMeters(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return Math.sqrt(px * px + py * py);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  const nearestX = start.x + t * dx;
  const nearestY = start.y + t * dy;
  const rx = point.x - nearestX;
  const ry = point.y - nearestY;
  return Math.sqrt(rx * rx + ry * ry);
}

function simplifyOpenPoints(points = [], toleranceMeters = 0) {
  const tolerance = Number(toleranceMeters);
  if (!Array.isArray(points) || points.length <= 2 || !Number.isFinite(tolerance) || tolerance <= 0) {
    return Array.isArray(points) ? points.slice() : [];
  }
  const projector = createMeterProjector(points);
  if (!projector) return points.slice();
  const projected = points.map((point) => projector.project(point));
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const current = stack.pop();
    const startIndex = current[0];
    const endIndex = current[1];
    let maxDistance = 0;
    let farthestIndex = -1;
    for (let i = startIndex + 1; i < endIndex; i += 1) {
      const distance = pointToSegmentDistanceMeters(projected[i], projected[startIndex], projected[endIndex]);
      if (distance > maxDistance) {
        maxDistance = distance;
        farthestIndex = i;
      }
    }
    if (farthestIndex >= 0 && maxDistance > tolerance) {
      keep[farthestIndex] = true;
      stack.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }
  return points.filter((point, index) => keep[index]);
}

function simplifyRingPoints(points = [], toleranceMeters = 0) {
  const tolerance = Number(toleranceMeters);
  if (!Array.isArray(points) || points.length <= 3 || !Number.isFinite(tolerance) || tolerance <= 0) {
    return Array.isArray(points) ? points.slice() : [];
  }
  const simplified = [];
  for (let i = 0; i < points.length; i += 1) {
    const prev = simplified[simplified.length - 1];
    const current = points[i];
    if (!prev) {
      simplified.push(current);
      continue;
    }
    const projector = createMeterProjector([prev, current]);
    if (!projector) {
      simplified.push(current);
      continue;
    }
    const prevProjected = projector.project(prev);
    const currentProjected = projector.project(current);
    const dx = currentProjected.x - prevProjected.x;
    const dy = currentProjected.y - prevProjected.y;
    if (Math.sqrt(dx * dx + dy * dy) >= tolerance * 0.35) {
      simplified.push(current);
    }
  }
  const ring = simplified.length >= 3 ? simplified : points.slice();
  let changed = true;
  while (changed && ring.length > 3) {
    changed = false;
    for (let i = 0; i < ring.length; i += 1) {
      const prev = ring[(i - 1 + ring.length) % ring.length];
      const current = ring[i];
      const next = ring[(i + 1) % ring.length];
      const projector = createMeterProjector([prev, current, next]);
      if (!projector) continue;
      const distance = pointToSegmentDistanceMeters(
        projector.project(current),
        projector.project(prev),
        projector.project(next)
      );
      if (distance <= tolerance) {
        ring.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return ring.length >= 3 ? ring : points.slice();
}

function buildParsedResourceFromKmlText(kmlText = "", options = {}) {
  const xml = `${kmlText || ""}`;
  const renderColor = normalizeRenderColor(options.renderColor);
  const dictionaries = buildStyleDictionaries(xml);
  const placemarkMatches = xml.match(/<Placemark\b[\s\S]*?<\/Placemark>/gi) || [];
  const placemarks = placemarkMatches.length ? placemarkMatches : [xml];
  const polygons = [];
  const polylines = [];

  placemarks.forEach((placemarkText) => {
    const baseStyle = resolveStyleByUrl(extractTagText(placemarkText, "styleUrl"), dictionaries);
    const inlineStyleText = extractTagText(placemarkText, "Style");
    const style = mergeStyle(baseStyle, parseStyleBlock(inlineStyleText));
    const polygonMatches = placemarkText.match(/<Polygon\b[\s\S]*?<\/Polygon>/gi) || [];
    polygonMatches.forEach((polygonText) => {
      const ringBlocks = extractPolygonRingBlocks(polygonText);
      const wgs84Points = parseCoordinateText(ringBlocks.outer);
      if (wgs84Points.length < 3) return;
      const wgs84HolePointsList = normalizeHolePointsList(
        ringBlocks.holes.map((holeText) => parseCoordinateText(holeText))
      );
      const gcjPoints = convertWgsPointsToGcj(wgs84Points);
      const gcjHolePointsList = wgs84HolePointsList.map((points) => convertWgsPointsToGcj(points));
      polygons.push({
        wgs84Points,
        wgs84HolePointsList,
        gcjPoints,
        gcjHolePointsList,
        bounds: buildBounds(wgs84Points),
        gcjBounds: buildBounds(gcjPoints),
        gcjHoleBoundsList: gcjHolePointsList.map((points) => buildBounds(points)),
        lineColor: style.lineColor || UOM3_DEFAULT_KML_COLOR,
        polyColor: style.polyColor || UOM3_DEFAULT_KML_COLOR,
        lineWidth: Number(style.lineWidth) > 0 ? Number(style.lineWidth) : 1,
        fillEnabled: style.fillEnabled !== false,
        outlineEnabled: style.outlineEnabled !== false
      });
    });
    const lineMatches = placemarkText.match(/<LineString\b[\s\S]*?<\/LineString>/gi) || [];
    lineMatches.forEach((lineText) => {
      const wgs84Points = parseCoordinateText(extractFirstCoordinatesBlock(lineText));
      if (wgs84Points.length < 2) return;
      const gcjPoints = convertWgsPointsToGcj(wgs84Points);
      polylines.push({
        gcjPoints,
        gcjBounds: buildBounds(gcjPoints),
        lineColor: style.lineColor || style.polyColor || UOM3_DEFAULT_KML_COLOR,
        lineWidth: Number(style.lineWidth) > 0 ? Number(style.lineWidth) : 2
      });
    });
  });

  return {
    renderColor,
    polygons,
    polylines
  };
}

function buildGraphicsFromParsedResource(resource = {}, renderColor = UOM3_DEFAULT_RENDER_COLOR, options = {}) {
  const resolvedRenderColor = normalizeRenderColor(renderColor);
  const simplifyToleranceMeters = resolveRenderSimplifyToleranceMeters(options.scale);
  const viewportBounds = normalizeViewportBounds(options.region);
  const polygons = [];
  const polylines = [];
  (Array.isArray(resource?.polygons) ? resource.polygons : []).forEach((polygon, index) => {
    if (viewportBounds && polygon.gcjBounds && !boundsIntersect(polygon.gcjBounds, viewportBounds)) {
      return;
    }
    const strokeAlpha = polygon.outlineEnabled === false ? 0 : kmlColorAlpha(polygon.lineColor);
    const fillAlpha = polygon.fillEnabled === false ? 0 : kmlColorAlpha(polygon.polyColor);
    const strokeWidth = polygon.outlineEnabled === false ? 0 : Math.max(1, Math.round(Number(polygon.lineWidth) || 1));
    const strokeColor = strokeAlpha > 0
      ? kmlColorToWxColor(polygon.lineColor || UOM3_DEFAULT_KML_COLOR, resolvedRenderColor)
      : "#00000000";
    const fillColor = fillAlpha > 0
      ? kmlColorToWxColor(polygon.polyColor || UOM3_DEFAULT_KML_COLOR, resolvedRenderColor)
      : "#00000000";
    const holeMaskFillColor = buildHoleMaskFillColor(fillColor);
    const rawOuterPoints = Array.isArray(polygon.gcjPoints) ? polygon.gcjPoints : [];
    const rawHolePointsList = normalizeHolePointsList(polygon.gcjHolePointsList);
    const outerPoints = simplifyPointsToLimit(
      simplifyRingPoints(rawOuterPoints, simplifyToleranceMeters),
      {
        type: "polygon",
        limit: UOM3_MAX_POLYGON_POINTS,
        baseTolerance: simplifyToleranceMeters
      }
    );
    const holePointsList = normalizeHolePointsList(
      rawHolePointsList.map((points) => simplifyPointsToLimit(
        simplifyRingPoints(points, simplifyToleranceMeters),
        {
          type: "polygon",
          limit: UOM3_MAX_POLYGON_POINTS,
          baseTolerance: simplifyToleranceMeters
        }
      ))
    );
    if (outerPoints.length < 3) {
      return;
    }
    if (holePointsList.length > 0) {
      if (fillAlpha > 0) {
        polygons.push({
          id: `uom3-polygon-${index}-outer-fill`,
          points: outerPoints,
          strokeWidth: 0,
          strokeColor: "#00000000",
          fillColor
        });
        holePointsList.forEach((holePoints, holeIndex) => {
          const holeBounds = buildBounds(holePoints);
          if (viewportBounds && holeBounds && !boundsIntersect(holeBounds, viewportBounds)) {
            return;
          }
          polygons.push({
            id: `uom3-polygon-${index}-hole-mask-${holeIndex}`,
            points: holePoints,
            strokeWidth: 0,
            strokeColor: "#00000000",
            fillColor: holeMaskFillColor
          });
        });
      }
      if (strokeWidth > 0 && strokeAlpha > 0) {
        if (!viewportBounds || !polygon.gcjBounds || boundsIntersect(polygon.gcjBounds, viewportBounds)) {
          polylines.push({
            id: `uom3-polygon-${index}-outer-line`,
            points: closePolylinePoints(outerPoints),
            width: strokeWidth,
            color: strokeColor,
            dottedLine: false,
            arrowLine: false
          });
        }
        holePointsList.forEach((holePoints, holeIndex) => {
          const holeBounds = buildBounds(holePoints);
          if (viewportBounds && holeBounds && !boundsIntersect(holeBounds, viewportBounds)) {
            return;
          }
          polylines.push({
            id: `uom3-polygon-${index}-hole-line-${holeIndex}`,
            points: closePolylinePoints(holePoints),
            width: strokeWidth,
            color: strokeColor,
            dottedLine: false,
            arrowLine: false
          });
        });
      }
      return;
    }
    polygons.push({
      id: `uom3-polygon-${index}`,
      points: outerPoints,
      strokeWidth,
      strokeColor,
      fillColor
    });
  });
  (Array.isArray(resource?.polylines) ? resource.polylines : [])
    .map((polyline, index) => ({
      id: `uom3-line-${index}`,
      points: simplifyPointsToLimit(
        simplifyOpenPoints(
          Array.isArray(polyline.gcjPoints) ? polyline.gcjPoints : [],
          simplifyToleranceMeters
        ),
        {
          type: "polyline",
          limit: UOM3_MAX_POLYLINE_POINTS,
          baseTolerance: simplifyToleranceMeters
        }
      ),
      bounds: polyline.gcjBounds || buildBounds(polyline.gcjPoints),
      width: Math.max(1, Math.round(Number(polyline.lineWidth) || 2)),
      color: kmlColorAlpha(polyline.lineColor) > 0
        ? kmlColorToWxColor(polyline.lineColor || UOM3_DEFAULT_KML_COLOR, resolvedRenderColor)
        : "#00000000",
      dottedLine: false,
      arrowLine: false
    }))
    .filter((polyline) => {
      if (!Array.isArray(polyline.points) || polyline.points.length < 2) return false;
      if (viewportBounds && polyline.bounds && !boundsIntersect(polyline.bounds, viewportBounds)) {
        return false;
      }
      delete polyline.bounds;
      return true;
    })
    .forEach((polyline) => {
      polylines.push(polyline);
    });
  return { polygons, polylines };
}

function mergeBounds(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return {
    minLng: Math.min(a.minLng, b.minLng),
    maxLng: Math.max(a.maxLng, b.maxLng),
    minLat: Math.min(a.minLat, b.minLat),
    maxLat: Math.max(a.maxLat, b.maxLat)
  };
}

function buildCoverageIndex(resource = {}) {
  const polygons = (Array.isArray(resource?.polygons) ? resource.polygons : []).filter((polygon) => (
    polygon &&
    polygon.fillEnabled !== false &&
    kmlColorAlpha(polygon.polyColor) > 0 &&
    polygon.gcjBounds &&
    Array.isArray(polygon.gcjPoints) &&
    polygon.gcjPoints.length >= 3
  ));
  if (!polygons.length) return null;
  const overallBounds = polygons.reduce((acc, polygon) => mergeBounds(acc, polygon.gcjBounds), null);
  if (!overallBounds) return null;
  const lngSpan = Math.max(1e-9, overallBounds.maxLng - overallBounds.minLng);
  const latSpan = Math.max(1e-9, overallBounds.maxLat - overallBounds.minLat);
  const longerSpan = Math.max(lngSpan, latSpan);
  const shorterSpan = Math.max(1e-9, Math.min(lngSpan, latSpan));
  const longerSideCellCount = 72;
  const shorterSideCellCount = Math.max(16, Math.min(72, Math.round(longerSideCellCount * (shorterSpan / longerSpan))));
  const width = lngSpan >= latSpan ? longerSideCellCount : shorterSideCellCount;
  const height = lngSpan >= latSpan ? shorterSideCellCount : longerSideCellCount;
  const cellLng = lngSpan / width;
  const cellLat = latSpan / height;
  const cells = Array.from({ length: width * height }, () => []);

  polygons.forEach((polygon, polygonIndex) => {
    const bounds = polygon.gcjBounds;
    const startX = Math.max(0, Math.min(width - 1, Math.floor((bounds.minLng - overallBounds.minLng) / cellLng)));
    const endX = Math.max(0, Math.min(width - 1, Math.floor((bounds.maxLng - overallBounds.minLng) / cellLng)));
    const startY = Math.max(0, Math.min(height - 1, Math.floor((bounds.minLat - overallBounds.minLat) / cellLat)));
    const endY = Math.max(0, Math.min(height - 1, Math.floor((bounds.maxLat - overallBounds.minLat) / cellLat)));
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        cells[y * width + x].push(polygonIndex);
      }
    }
  });

  return {
    polygons,
    bounds: overallBounds,
    width,
    height,
    cellLng,
    cellLat,
    cells
  };
}

function resolveCoverageIndex(resource = {}) {
  if (resource && resource._coverageIndex) {
    return resource._coverageIndex;
  }
  const nextIndex = buildCoverageIndex(resource);
  if (resource && nextIndex) {
    resource._coverageIndex = nextIndex;
  }
  return nextIndex;
}

function pointCoveredBySuitableZoneExactGcj(point = {}, resource = {}) {
  const longitude = Number(point?.longitude);
  const latitude = Number(point?.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;
  const gcjPoint = { longitude, latitude };
  const coverageIndex = resolveCoverageIndex(resource);
  const candidatePolygons = (() => {
    if (!coverageIndex || !pointInBounds(gcjPoint, coverageIndex.bounds)) {
      return Array.isArray(resource?.polygons) ? resource.polygons : [];
    }
    const x = Math.max(
      0,
      Math.min(
        coverageIndex.width - 1,
        Math.floor((gcjPoint.longitude - coverageIndex.bounds.minLng) / coverageIndex.cellLng)
      )
    );
    const y = Math.max(
      0,
      Math.min(
        coverageIndex.height - 1,
        Math.floor((gcjPoint.latitude - coverageIndex.bounds.minLat) / coverageIndex.cellLat)
      )
    );
    const indices = coverageIndex.cells[y * coverageIndex.width + x] || [];
    return indices.map((index) => coverageIndex.polygons[index]).filter(Boolean);
  })();

  for (let i = 0; i < candidatePolygons.length; i += 1) {
    const polygon = candidatePolygons[i];
    if (!polygon || polygon.fillEnabled === false) continue;
    if (kmlColorAlpha(polygon.polyColor) <= 0) continue;
    if (!pointInBounds(gcjPoint, polygon.gcjBounds || polygon.bounds)) continue;
    if (!pointInPolygon(gcjPoint, polygon.gcjPoints || polygon.wgs84Points)) continue;
    const holePointsList = normalizeHolePointsList(polygon.gcjHolePointsList || polygon.wgs84HolePointsList);
    const coveredByHole = holePointsList.some((holePoints) => pointInPolygon(gcjPoint, holePoints));
    if (!coveredByHole) return true;
  }
  return false;
}

function pointCoveredBySuitableZone(center = {}, resource = {}) {
  const longitude = Number(center?.longitude);
  const latitude = Number(center?.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;
  return pointCoveredBySuitableZoneExactGcj({ longitude, latitude }, resource);
}

async function downloadKmlText(fileName = "", encrypted = false, options = {}) {
  const apiBase = resolveApiBase(options.apiBase);
  const downloadBase = resolveSuitableFlyZoneDownloadBase(options.downloadBase);
  const token = options.token || getAuthToken();
  if (!apiBase || !token) {
    throw new Error("missing-token");
  }
  logUom3("log", "download suitable fly zone file", {
    fileName,
    encrypted,
    apiBase,
    downloadBase
  });
  try {
    const res = await requestRaw({
      url: buildDownloadUrl(fileName, downloadBase),
      method: "GET",
      token,
      responseType: "arraybuffer"
    });
    const rawText = res?.data instanceof ArrayBuffer ? decodeArrayBuffer(res.data) : `${res?.data || ""}`;
    if (!encrypted) {
      return rawText;
    }
    return decryptDownloadedKmlText(rawText, {
      apiBase,
      token,
      fileName
    });
  } catch (err) {
    logUom3("warn", "download or decrypt suitable fly zone file failed", {
      fileName,
      encrypted,
      apiBase,
      downloadBase,
      error: describeError(err)
    });
    throw err;
  }
}

async function loadParsedResourceForResolvedFile(resolved = {}, options = {}) {
  const fileName = typeof resolved?.fileName === "string" ? resolved.fileName.trim() : "";
  const encrypted = resolved?.encrypted === true;
  if (!fileName) {
    return {
      fileName: "",
      encrypted: false,
      resource: buildParsedResourceFromKmlText("", options)
    };
  }
  const cached = memoryResourceCache.get(fileName);
  if (cached) {
    touchMemoryResourceCacheEntry(fileName, cached);
    return {
      fileName,
      encrypted,
      resource: cached
    };
  }
  if (memoryResourcePromiseCache.has(fileName)) {
    return memoryResourcePromiseCache.get(fileName);
  }
  const loader = (async () => {
    const storedMeta = readStoredFileCacheMeta();
    let kmlText = "";
    let dataSource = "download";
    if (
      storedMeta &&
      storedMeta.fileName === fileName &&
      await checkFileExists(storedMeta.path)
    ) {
      kmlText = await readTextFile(storedMeta.path);
      dataSource = "file-cache";
    } else {
      const oldPath = storedMeta?.path || "";
      kmlText = await downloadKmlText(fileName, encrypted, options);
      const root = buildCacheRootPath();
      if (!root) {
        throw new Error("missing-user-data-path");
      }
      await ensureDirectory(root);
      const nextPath = buildCachedKmlFilePath(fileName);
      let cachedToFile = false;
      try {
        await writeTextFile(nextPath, kmlText);
        cachedToFile = true;
      } catch (err) {
        if (!isFileStorageLimitError(err)) {
          throw err;
        }
        if (oldPath && oldPath !== nextPath) {
          await unlinkQuietly(oldPath);
          clearStoredFileCacheMeta();
          try {
            await writeTextFile(nextPath, kmlText);
            cachedToFile = true;
          } catch (retryErr) {
            if (!isFileStorageLimitError(retryErr)) {
              throw retryErr;
            }
          }
        }
        if (!cachedToFile) {
          dataSource = "download-memory";
          logUom3("warn", "skip file cache due storage limit", {
            fileName,
            encrypted,
            cacheRoot: root,
            oldPath
          });
        }
      }
      if (cachedToFile) {
        writeStoredFileCacheMeta({
          fileName,
          path: nextPath,
          encrypted,
          updatedAt: Date.now()
        });
        if (oldPath && oldPath !== nextPath) {
          await unlinkQuietly(oldPath);
        }
      }
    }
    logUom3("log", "loaded suitable fly zone file", {
      fileName,
      encrypted,
      dataSource,
      textLength: kmlText.length
    });
    const parsed = buildParsedResourceFromKmlText(kmlText, options);
    logUom3("log", "parsed suitable fly zone file", {
      fileName,
      polygonCount: Array.isArray(parsed?.polygons) ? parsed.polygons.length : 0,
      polygonHoleCount: Array.isArray(parsed?.polygons)
        ? parsed.polygons.reduce(
          (sum, polygon) => sum + normalizeHolePointsList(polygon?.wgs84HolePointsList).length,
          0
        )
        : 0,
      polylineCount: Array.isArray(parsed?.polylines) ? parsed.polylines.length : 0
    });
    touchMemoryResourceCacheEntry(fileName, parsed);
    return {
      fileName,
      encrypted,
      resource: parsed
    };
  })()
    .finally(() => {
      memoryResourcePromiseCache.delete(fileName);
    });
  memoryResourcePromiseCache.set(fileName, loader);
  return loader;
}

function clearResourceMemoryCache(options = {}) {
  const fileName = `${options.fileName || ""}`.trim();
  if (fileName) {
    memoryResourceCache.delete(fileName);
    memoryResourcePromiseCache.delete(fileName);
    return;
  }
  memoryResourceCache.clear();
  memoryResourcePromiseCache.clear();
}

module.exports = {
  UOM3_DEFAULT_KML_COLOR,
  UOM3_DEFAULT_RENDER_COLOR,
  UOM3_RENDER_COLOR_STORAGE_KEY,
  UOM3_SAFE_STATUS_TEXT,
  UOM3_NON_RESTRICTED_STATUS_TEXT,
  UOM3_RESTRICTED_STATUS_TEXT,
  normalizeRenderColor,
  readStoredRenderColor,
  writeStoredRenderColor,
  resolveSuitableFlyZoneFile,
  loadParsedResourceForResolvedFile,
  buildGraphicsFromParsedResource,
  pointCoveredBySuitableZone,
  clearResourceMemoryCache,
  clearStoredFileCacheMeta,
  buildParsedResourceFromKmlText
};
