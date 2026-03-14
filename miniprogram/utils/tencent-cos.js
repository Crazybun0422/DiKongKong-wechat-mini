const { authorizedRequest, resolveApiBase } = require("./profile");

function fetchTencentCosSts(options = {}) {
  return authorizedRequest({
    apiBase: resolveApiBase(options.apiBase),
    token: options.token,
    path: "/api/tencent-cos/sts",
    method: "GET"
  }).then((body = {}) => body?.data || {});
}

function fetchTencentCosConfig(options = {}) {
  return new Promise((resolve, reject) => {
    const base = resolveApiBase(options.apiBase);
    if (!base) {
      reject(new Error("missing-api-base"));
      return;
    }
    wx.request({
      url: `${base}/api/tencent-cos/config`,
      method: "GET",
      header: { "content-type": "application/json" },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data?.data || {});
        } else {
          reject(new Error(res.data?.message || res.errMsg || `status-${res.statusCode}`));
        }
      },
      fail: (err) => reject(err)
    });
  });
}

function extractFileExtension(filePath = "") {
  const text = `${filePath || ""}`.trim();
  if (!text) return "";
  const parts = text.split(/[\\/]/);
  const name = parts[parts.length - 1] || "";
  const index = name.lastIndexOf(".");
  if (index < 0) return "";
  return name.slice(index).toLowerCase();
}

function buildCosObjectKey(filePath = "", options = {}) {
  const prefix = `${options.prefix || "pins/videos/"}`.replace(/^\/+/, "");
  const ext = extractFileExtension(filePath) || ".mp4";
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}${stamp}-${random}${ext}`;
}

function buildCosHost(bucket = "", region = "") {
  const normalizedBucket = `${bucket || ""}`.trim();
  const normalizedRegion = `${region || ""}`.trim();
  if (!normalizedBucket || !normalizedRegion) return "";
  return `${normalizedBucket}.cos.${normalizedRegion}.myqcloud.com`;
}

function encodeCosPath(path = "") {
  const normalized = `${path || ""}`.trim().replace(/^\/+/, "");
  if (!normalized) return "/";
  return `/${normalized.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function extractCosObjectKey(value = "", options = {}) {
  const raw = `${value || ""}`.trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) {
    return raw.replace(/^\/+/, "");
  }
  try {
    const match = raw.match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?/i);
    if (!match) return "";
    const parsedHost = `${match[1] || ""}`.trim().toLowerCase();
    const expectedHost = `${options.host || ""}`.trim().toLowerCase();
    if (expectedHost && parsedHost !== expectedHost) {
      return "";
    }
    const pathname = `${match[2] || ""}`.replace(/^\/+/, "");
    return decodeURIComponent(pathname);
  } catch (err) {
    return "";
  }
}

function isTencentCosStsValid(sts = {}) {
  const expire = Number(sts?.expiredTime);
  const now = Math.floor(Date.now() / 1000);
  return Number.isFinite(expire) && expire - now > 60;
}

function encodeUtf8(str = "") {
  const text = unescape(encodeURIComponent(`${str || ""}`));
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    bytes.push(text.charCodeAt(i));
  }
  return bytes;
}

function normalizeInputBytes(input) {
  if (Array.isArray(input)) {
    return input.slice();
  }
  return encodeUtf8(input);
}

function bytesToWords(bytes = []) {
  const words = [];
  for (let i = 0; i < bytes.length; i += 1) {
    words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8);
  }
  return words;
}

function wordsToHex(words = [], length = 0) {
  const hex = [];
  for (let i = 0; i < length; i += 1) {
    const byte = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    hex.push((byte >>> 4).toString(16));
    hex.push((byte & 0x0f).toString(16));
  }
  return hex.join("");
}

function sha1(message = "") {
  const bytes = normalizeInputBytes(message);
  const originalBitLength = bytes.length * 8;
  const padded = bytes.slice();
  padded.push(0x80);
  while ((padded.length % 64) !== 56) {
    padded.push(0);
  }
  const high = Math.floor(originalBitLength / 0x100000000);
  const low = originalBitLength >>> 0;
  padded.push((high >>> 24) & 0xff);
  padded.push((high >>> 16) & 0xff);
  padded.push((high >>> 8) & 0xff);
  padded.push(high & 0xff);
  padded.push((low >>> 24) & 0xff);
  padded.push((low >>> 16) & 0xff);
  padded.push((low >>> 8) & 0xff);
  padded.push(low & 0xff);

  const words = bytesToWords(padded);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Array(80);
  for (let i = 0; i < words.length; i += 16) {
    for (let t = 0; t < 16; t += 1) {
      w[t] = words[i + t] | 0;
    }
    for (let t = 16; t < 80; t += 1) {
      const value = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16];
      w[t] = ((value << 1) | (value >>> 31)) | 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t += 1) {
      let f;
      let k;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = ((((a << 5) | (a >>> 27)) + f + e + k + w[t]) | 0) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) | 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  return wordsToHex([h0, h1, h2, h3, h4], 20);
}

function hmacSha1(key = "", message = "") {
  let keyBytes = normalizeInputBytes(key);
  if (keyBytes.length > 64) {
    const keyHex = sha1(keyBytes);
    keyBytes = [];
    for (let i = 0; i < keyHex.length; i += 2) {
      keyBytes.push(parseInt(keyHex.slice(i, i + 2), 16));
    }
  }
  while (keyBytes.length < 64) {
    keyBytes.push(0);
  }
  const oPad = [];
  const iPad = [];
  for (let i = 0; i < 64; i += 1) {
    oPad[i] = keyBytes[i] ^ 0x5c;
    iPad[i] = keyBytes[i] ^ 0x36;
  }
  const innerInput = iPad.concat(normalizeInputBytes(message));
  const innerHex = sha1(innerInput);
  const innerBytes = [];
  for (let i = 0; i < innerHex.length; i += 2) {
    innerBytes.push(parseInt(innerHex.slice(i, i + 2), 16));
  }
  const outerInput = oPad.concat(innerBytes);
  return sha1(outerInput);
}

function encodeCosValue(value = "") {
  return encodeURIComponent(`${value || ""}`)
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizeCosSignPairs(source = {}, options = {}) {
  const includeEmpty = options.includeEmpty === true;
  return Object.keys(source)
    .map((key) => {
      const normalizedKey = `${key || ""}`.trim().toLowerCase();
      if (!normalizedKey) return null;
      const rawValue = source[key];
      if (rawValue === undefined || rawValue === null) return null;
      const normalizedValue =
        normalizedKey === "host"
          ? `${rawValue || ""}`.trim().toLowerCase()
          : `${rawValue || ""}`.trim();
      if (!normalizedValue && !includeEmpty) return null;
      return {
        key: normalizedKey,
        value: normalizedValue
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.key.localeCompare(b.key));
}

function buildCosQueryString(query = {}) {
  const pairs = normalizeCosSignPairs(query, { includeEmpty: true });
  return pairs.map(({ key, value }) => `${key}=${encodeCosValue(value)}`).join("&");
}

function buildCosAuthorization(options = {}) {
  const host = `${options.host || ""}`.trim().toLowerCase();
  const secretId = `${options.secretId || ""}`.trim();
  const secretKey = `${options.secretKey || ""}`.trim();
  const method = `${options.method || "POST"}`.trim().toLowerCase();
  const pathname = options.pathname || "/";
  const signTime = `${options.startTime};${options.endTime}`;
  const headerPairs = normalizeCosSignPairs({ host });
  const queryPairs = normalizeCosSignPairs(options.query || {}, { includeEmpty: true });
  const headerList = headerPairs.map(({ key }) => key).join(";");
  const queryList = queryPairs.map(({ key }) => key).join(";");
  const httpString = [
    method,
    pathname,
    queryPairs.map(({ key, value }) => `${key}=${encodeCosValue(value)}`).join("&"),
    headerPairs.map(({ key, value }) => `${key}=${encodeCosValue(value)}`).join("&"),
    ""
  ].join("\n");
  const signKey = hmacSha1(secretKey, signTime);
  const stringToSign = `sha1\n${signTime}\n${sha1(httpString)}\n`;
  const signature = hmacSha1(signKey, stringToSign);
  return [
    "q-sign-algorithm=sha1",
    `q-ak=${encodeCosValue(secretId)}`,
    `q-sign-time=${signTime}`,
    `q-key-time=${signTime}`,
    `q-header-list=${headerList}`,
    `q-url-param-list=${queryList}`,
    `q-signature=${signature}`
  ].join("&");
}

function buildTencentCosSignedUrl(objectRef = "", options = {}) {
  const host = `${options.host || buildCosHost(options.bucket, options.region) || ""}`.trim();
  const objectName = extractCosObjectKey(objectRef, { host });
  const sts = options.sts || {};
  const tmpSecretId = `${options.secretId || sts.tmpSecretId || ""}`.trim();
  const tmpSecretKey = `${options.secretKey || sts.tmpSecretKey || ""}`.trim();
  const sessionToken = `${options.sessionToken || sts.sessionToken || ""}`.trim();
  if (!host || !objectName || !tmpSecretId || !tmpSecretKey || !sessionToken) {
    return "";
  }
  const now = Math.floor(Date.now() / 1000) - 5;
  const expire = Number(options.expiredTime || sts.expiredTime);
  const endTime = Number.isFinite(expire) && expire > now ? expire : now + 1800;
  const pathname = encodeCosPath(objectName);
  const query = {
    "x-cos-security-token": sessionToken
  };
  const authorization = buildCosAuthorization({
    method: "GET",
    pathname,
    host,
    query,
    secretId: tmpSecretId,
    secretKey: tmpSecretKey,
    startTime: now,
    endTime
  });
  const queryString = buildCosQueryString(query);
  return `https://${host}${pathname}?${authorization}&${queryString}`;
}

function arrayBufferToUtf8(buffer) {
  if (!buffer) return "";
  if (typeof buffer === "string") return buffer;
  try {
    const bytes = new Uint8Array(buffer);
    let text = "";
    for (let i = 0; i < bytes.length; i += 1) {
      text += String.fromCharCode(bytes[i]);
    }
    return decodeURIComponent(escape(text));
  } catch (err) {
    return "";
  }
}

function parseXmlTag(xml, tagName) {
  const source = arrayBufferToUtf8(xml);
  if (!source || !tagName) return "";
  const pattern = new RegExp(`<${tagName}>([^<]+)</${tagName}>`, "i");
  const match = source.match(pattern);
  return match && match[1] ? match[1].trim() : "";
}

function escapeXml(text = "") {
  return `${text || ""}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getCosResponseHeader(headers = {}, name = "") {
  if (!headers || !name) return "";
  const target = `${name}`.trim().toLowerCase();
  const hit = Object.keys(headers).find((key) => `${key}`.trim().toLowerCase() === target);
  return hit ? `${headers[hit] || ""}`.trim() : "";
}

function getFileInfo(filePath) {
  return new Promise((resolve, reject) => {
    if (typeof wx === "undefined" || typeof wx.getFileInfo !== "function") {
      reject(new Error("get-file-info-not-supported"));
      return;
    }
    wx.getFileInfo({
      filePath,
      success: (res = {}) => resolve(res),
      fail: (err) => reject(err)
    });
  });
}

function readLocalFileChunk(filePath, position, length) {
  return new Promise((resolve, reject) => {
    const fs = typeof wx !== "undefined" && typeof wx.getFileSystemManager === "function"
      ? wx.getFileSystemManager()
      : null;
    if (!fs || typeof fs.readFile !== "function") {
      reject(new Error("filesystem-read-not-supported"));
      return;
    }
    fs.readFile({
      filePath,
      position,
      length,
      success: (res = {}) => {
        if (res.data) {
          resolve(res.data);
          return;
        }
        reject(new Error("read-file-empty"));
      },
      fail: (err) => reject(err)
    });
  });
}

function computeMultipartPartSize(fileSize, preferredSize) {
  const minPartSize = 1024 * 1024;
  const maxPartCount = 10000;
  let partSize = Math.max(minPartSize, Number(preferredSize) || 8 * 1024 * 1024);
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return partSize;
  }
  while (Math.ceil(fileSize / partSize) > maxPartCount) {
    partSize += minPartSize;
  }
  return partSize;
}

function buildCompleteMultipartUploadXml(parts = []) {
  const body = parts
    .map((part) => (
      `<Part><PartNumber>${Number(part.PartNumber)}</PartNumber><ETag>${escapeXml(part.ETag)}</ETag></Part>`
    ))
    .join("");
  return `<CompleteMultipartUpload>${body}</CompleteMultipartUpload>`;
}

function requestTencentCos(options = {}) {
  return new Promise((resolve, reject) => {
    const host = `${options.host || ""}`.trim();
    const pathname = options.pathname || "/";
    const query = options.query || {};
    const sts = options.sts || {};
    const tmpSecretId = `${options.secretId || sts.tmpSecretId || ""}`.trim();
    const tmpSecretKey = `${options.secretKey || sts.tmpSecretKey || ""}`.trim();
    const sessionToken = `${options.sessionToken || sts.sessionToken || ""}`.trim();
    if (!host || !pathname || !tmpSecretId || !tmpSecretKey || !sessionToken) {
      reject(new Error("tencent-cos-request-config-invalid"));
      return;
    }
    const now = Math.floor(Date.now() / 1000) - 5;
    const expire = Number(options.expiredTime || sts.expiredTime);
    const endTime = Number.isFinite(expire) && expire > now ? expire : now + 1800;
    const queryString = buildCosQueryString(query);
    const url = `https://${host}${pathname}${queryString ? `?${queryString}` : ""}`;
    const authorization = buildCosAuthorization({
      method: options.method || "GET",
      pathname,
      host,
      query,
      secretId: tmpSecretId,
      secretKey: tmpSecretKey,
      startTime: now,
      endTime
    });
    wx.request({
      url,
      method: options.method || "GET",
      data: options.data,
      responseType: options.responseType || "text",
      header: Object.assign({}, options.header || {}, {
        Authorization: authorization,
        "x-cos-security-token": sessionToken
      }),
      success: (res = {}) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res);
          return;
        }
        reject(new Error(res.errMsg || `cos-request-status-${res.statusCode || "unknown"}`));
      },
      fail: (err) => reject(err)
    });
  });
}

function retryAsync(task, options = {}) {
  const retries = Math.max(0, Number(options.retries) || 0);
  const delayMs = Math.max(0, Number(options.delayMs) || 0);
  let attempt = 0;
  const run = () =>
    Promise.resolve()
      .then(() => task(attempt))
      .catch((err) => {
        if (attempt >= retries) {
          throw err;
        }
        attempt += 1;
        if (!delayMs) {
          return run();
        }
        return new Promise((resolve) => setTimeout(resolve, delayMs)).then(run);
      });
  return run();
}

function initiateMultipartUpload(objectName, options = {}) {
  return requestTencentCos({
    method: "POST",
    host: options.host,
    pathname: encodeCosPath(objectName),
    query: { uploads: "" },
    sts: options.sts
  }).then((res = {}) => {
    const uploadId = parseXmlTag(res.data, "UploadId");
    if (!uploadId) {
      throw new Error("cos-multipart-init-missing-upload-id");
    }
    return uploadId;
  });
}

function uploadPart(objectName, uploadId, partNumber, chunkData, options = {}) {
  return requestTencentCos({
    method: "PUT",
    host: options.host,
    pathname: encodeCosPath(objectName),
    query: {
      partNumber: `${partNumber}`,
      uploadId
    },
    data: chunkData,
    sts: options.sts,
    responseType: "arraybuffer",
    header: {
      "Content-Type": "application/octet-stream"
    }
  }).then((res = {}) => {
    const etag = getCosResponseHeader(res.header, "ETag");
    if (!etag) {
      throw new Error("cos-multipart-upload-part-missing-etag");
    }
    return etag;
  });
}

function completeMultipartUpload(objectName, uploadId, parts, options = {}) {
  return requestTencentCos({
    method: "POST",
    host: options.host,
    pathname: encodeCosPath(objectName),
    query: { uploadId },
    data: buildCompleteMultipartUploadXml(parts),
    sts: options.sts,
    header: {
      "Content-Type": "application/xml"
    }
  });
}

function abortMultipartUpload(objectName, uploadId, options = {}) {
  if (!uploadId) return Promise.resolve();
  return requestTencentCos({
    method: "DELETE",
    host: options.host,
    pathname: encodeCosPath(objectName),
    query: { uploadId },
    sts: options.sts
  }).catch(() => null);
}

function emitUploadProgress(handler, uploadedBytes, totalBytes) {
  if (typeof handler !== "function") return;
  const total = Number(totalBytes) || 0;
  const sent = Math.max(0, Math.min(total || uploadedBytes, Number(uploadedBytes) || 0));
  const progress = total > 0 ? Math.max(0, Math.min(100, Math.round((sent / total) * 100))) : 0;
  handler({
    progress,
    totalBytesExpectedToSend: total,
    totalBytesSent: sent
  });
}

function uploadFileToTencentCos(filePath, options = {}) {
  if (!filePath) {
    return Promise.reject(new Error("missing-file-path"));
  }
  const requestSts = options.sts
    ? Promise.resolve(options.sts)
    : fetchTencentCosSts({ apiBase: options.apiBase, token: options.token });
  return requestSts.then(async (sts = {}) => {
    const bucket =
      `${options.bucket || ""}`.trim() ||
      (Array.isArray(sts.buckets) ? `${sts.buckets[0] || ""}`.trim() : "");
    const region = `${options.region || sts.region || ""}`.trim();
    const tmpSecretId = `${sts.tmpSecretId || ""}`.trim();
    const tmpSecretKey = `${sts.tmpSecretKey || ""}`.trim();
    const sessionToken = `${sts.sessionToken || ""}`.trim();
    if (!bucket || !region || !tmpSecretId || !tmpSecretKey || !sessionToken) {
      throw new Error("tencent-cos-upload-config-invalid");
    }
    const objectName = `${options.objectName || buildCosObjectKey(filePath, options)}`.trim();
    const host = buildCosHost(bucket, region);
    if (!host || !objectName) {
      throw new Error("tencent-cos-upload-target-invalid");
    }
    const fileInfo = await getFileInfo(filePath);
    const fileSize = Number(fileInfo?.size) || 0;
    if (fileSize <= 0) {
      throw new Error("tencent-cos-upload-file-empty");
    }
    const partSize = computeMultipartPartSize(fileSize, options.partSize);
    const partCount = Math.max(1, Math.ceil(fileSize / partSize));
    const uploadId = await initiateMultipartUpload(objectName, { host, sts });
    const uploadedParts = [];
    let uploadedBytes = 0;
    emitUploadProgress(options.onProgress, 0, fileSize);
    try {
      for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
        const position = (partNumber - 1) * partSize;
        const length = Math.min(partSize, fileSize - position);
        const chunkData = await readLocalFileChunk(filePath, position, length);
        const etag = await retryAsync(
          () => uploadPart(objectName, uploadId, partNumber, chunkData, {
            host,
            sts
          }),
          { retries: 2, delayMs: 200 }
        );
        uploadedParts.push({
          PartNumber: partNumber,
          ETag: etag
        });
        uploadedBytes += length;
        emitUploadProgress(options.onProgress, uploadedBytes, fileSize);
      }
      await completeMultipartUpload(objectName, uploadId, uploadedParts, { host, sts });
      emitUploadProgress(options.onProgress, fileSize, fileSize);
      return {
        objectName,
        location: `https://${host}/${objectName.replace(/^\/+/, "")}`,
        bucket,
        region
      };
    } catch (err) {
      await abortMultipartUpload(objectName, uploadId, { host, sts });
      throw err;
    }
  });
}

module.exports = {
  fetchTencentCosSts,
  fetchTencentCosConfig,
  buildCosObjectKey,
  buildCosHost,
  extractCosObjectKey,
  isTencentCosStsValid,
  buildTencentCosSignedUrl,
  uploadFileToTencentCos
};
