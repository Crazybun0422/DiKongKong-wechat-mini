const { resolveApiBase, getAuthToken } = require("./profile");

function ensureApiBase(options = {}) {
  if (options.apiBase) return options.apiBase;
  return resolveApiBase();
}

const isArrayBuffer = (value) =>
  Object.prototype.toString.call(value) === "[object ArrayBuffer]";

const normalizeHeaders = (headers = {}) => {
  const normalized = {};
  Object.keys(headers || {}).forEach((key) => {
    normalized[key.toLowerCase()] = headers[key];
  });
  return normalized;
};

const getHeaderValue = (headers = {}, name = "") => {
  if (!name) return "";
  const normalized = normalizeHeaders(headers);
  const key = name.toLowerCase();
  return typeof normalized[key] === "string" ? normalized[key] : "";
};

const isImageContentType = (value = "") => {
  if (typeof value !== "string") return false;
  return value.toLowerCase().includes("image/");
};

const looksLikePng = (buffer) => {
  if (!isArrayBuffer(buffer)) return false;
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8) return false;
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
};

const arrayBufferToText = (buffer) => {
  if (!isArrayBuffer(buffer)) return "";
  try {
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-8").decode(new Uint8Array(buffer));
    }
  } catch (err) {
    // fall back to manual decode
  }
  try {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 1024;
    let result = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
      result += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    try {
      return decodeURIComponent(escape(result));
    } catch (err) {
      return result;
    }
  } catch (err) {
    return "";
  }
};

const parseArrayBufferJson = (buffer) => {
  const text = arrayBufferToText(buffer);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
};

const persistArrayBuffer = (buffer, options = {}) =>
  new Promise((resolve, reject) => {
    if (!isArrayBuffer(buffer)) {
      reject(new Error("invalid-buffer"));
      return;
    }
    const fs =
      typeof wx !== "undefined" && typeof wx.getFileSystemManager === "function"
        ? wx.getFileSystemManager()
        : null;
    const userPath = (typeof wx !== "undefined" && wx.env && wx.env.USER_DATA_PATH) || "";
    if (!fs || !userPath) {
      reject(new Error("fs-unavailable"));
      return;
    }
    const filePrefix = options.filePrefix || "weapp-poster";
    const filePath = `${userPath}/${filePrefix}-${Date.now()}.png`;
    fs.writeFile({
      filePath,
      data: buffer,
      success: () => resolve(filePath),
      fail: reject
    });
  });

const extractErrorMessage = (res) => {
  const headerValue = getHeaderValue(res?.header, "content-type");
  const data = res?.data;
  if (isArrayBuffer(data) && headerValue.includes("json")) {
    const parsed = parseArrayBufferJson(data);
    const message = parsed?.message || parsed?.error || parsed?.msg;
    if (typeof message === "string") return message;
  }
  if (data && typeof data === "object") {
    const message = data.message || data.error || data.msg;
    if (typeof message === "string") return message;
  }
  if (typeof res?.errMsg === "string") return res.errMsg;
  return "";
};

function requestWeappQrcode(payload = {}, options = {}) {
  const apiBase = ensureApiBase(options);
  const token = options.token || getAuthToken();
  if (!apiBase) {
    return Promise.reject(new Error("missing-api-base"));
  }
  if (!token) {
    return Promise.reject(new Error("missing-token"));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase}/api/weapp/poster-invite`,
      method: "POST",
      data: payload,
      responseType: "arraybuffer",
      header: Object.assign(
        {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`
        },
        options.header || {}
      ),
      success: (res) => {
        const status = Number(res?.statusCode);
        if (status >= 200 && status < 300) {
          const contentType = getHeaderValue(res?.header, "content-type");
          const data = res?.data;
          if (isArrayBuffer(data) && (isImageContentType(contentType) || looksLikePng(data))) {
            persistArrayBuffer(data, { filePrefix: "invite-poster" })
              .then((filePath) => resolve({ tempFilePath: filePath }))
              .catch(reject);
            return;
          }
          if (isArrayBuffer(data)) {
            const parsed = parseArrayBufferJson(data);
            if (parsed && Object.prototype.hasOwnProperty.call(parsed, "data")) {
              resolve(parsed.data || {});
              return;
            }
            resolve(parsed || {});
            return;
          }
          if (data && typeof data === "object") {
            resolve(data.data || data);
            return;
          }
          resolve(data || {});
          return;
        }
        const reason = extractErrorMessage(res);
        reject(new Error(reason || `status-${status || "unknown"}`));
      },
      fail: (err) => reject(err)
    });
  });
}

function requestWeappPosterStatus(options = {}) {
  const apiBase = ensureApiBase(options);
  const token = options.token || getAuthToken();
  if (!apiBase) {
    return Promise.reject(new Error("missing-api-base"));
  }
  if (!token) {
    return Promise.reject(new Error("missing-token"));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase}/api/weapp/poster-invite/status`,
      method: "GET",
      header: Object.assign(
        {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`
        },
        options.header || {}
      ),
      success: (res) => {
        const status = Number(res?.statusCode);
        if (status >= 200 && status < 300) {
          const data = res?.data;
          if (data && typeof data === "object") {
            resolve(data.data || {});
            return;
          }
          resolve({});
          return;
        }
        const reason = extractErrorMessage(res);
        reject(new Error(reason || `status-${status || "unknown"}`));
      },
      fail: (err) => reject(err)
    });
  });
}

function requestWeappMerchantPoster(payload = {}, options = {}) {
  const apiBase = ensureApiBase(options);
  const token = options.token || getAuthToken();
  if (!apiBase) {
    return Promise.reject(new Error("missing-api-base"));
  }
  if (!token) {
    return Promise.reject(new Error("missing-token"));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase}/api/weapp/poster-merchant`,
      method: "POST",
      data: payload,
      responseType: "arraybuffer",
      header: Object.assign(
        {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`
        },
        options.header || {}
      ),
      success: (res) => {
        const status = Number(res?.statusCode);
        if (status >= 200 && status < 300) {
          const contentType = getHeaderValue(res?.header, "content-type");
          const data = res?.data;
          if (isArrayBuffer(data) && (isImageContentType(contentType) || looksLikePng(data))) {
            persistArrayBuffer(data, { filePrefix: "merchant-poster" })
              .then((filePath) => resolve({ tempFilePath: filePath }))
              .catch(reject);
            return;
          }
          if (isArrayBuffer(data)) {
            const parsed = parseArrayBufferJson(data);
            if (parsed && Object.prototype.hasOwnProperty.call(parsed, "data")) {
              resolve(parsed.data || {});
              return;
            }
            resolve(parsed || {});
            return;
          }
          if (data && typeof data === "object") {
            resolve(data.data || data);
            return;
          }
          resolve(data || {});
          return;
        }
        const reason = extractErrorMessage(res);
        reject(new Error(reason || `status-${status || "unknown"}`));
      },
      fail: (err) => reject(err)
    });
  });
}

function requestWeappMerchantPosterStatus(payload = {}, options = {}) {
  const apiBase = ensureApiBase(options);
  const token = options.token || getAuthToken();
  if (!apiBase) {
    return Promise.reject(new Error("missing-api-base"));
  }
  if (!token) {
    return Promise.reject(new Error("missing-token"));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase}/api/weapp/poster-merchant/status`,
      method: "POST",
      data: payload,
      header: Object.assign(
        {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`
        },
        options.header || {}
      ),
      success: (res) => {
        const status = Number(res?.statusCode);
        if (status >= 200 && status < 300) {
          const data = res?.data;
          if (data && typeof data === "object") {
            resolve(data.data || {});
            return;
          }
          resolve({});
          return;
        }
        const reason = extractErrorMessage(res);
        reject(new Error(reason || `status-${status || "unknown"}`));
      },
      fail: (err) => reject(err)
    });
  });
}

module.exports = {
  requestWeappQrcode,
  requestWeappPosterStatus,
  requestWeappMerchantPoster,
  requestWeappMerchantPosterStatus
};
