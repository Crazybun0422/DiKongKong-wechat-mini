const {
  resolveApiBase,
  extractAvatarFileName,
  buildAvatarDownloadUrl
} = require("./profile");

function normalizeUrl(value = "") {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim().replace(/&amp;/gi, "&");
  if (!/^https?:\/\//i.test(trimmed)) {
    return "";
  }
  const lower = trimmed.toLowerCase();
  if (/(\.)(?:js|css|png|jpg|jpeg|gif|svg|webp|ico)(?:[?#].*)?$/i.test(lower)) {
    return "";
  }
  return trimmed;
}

function fetchOpenPlatformCopy(options = {}) {
  const base = resolveApiBase(options.apiBase);
  if (!base) {
    return Promise.reject(new Error("missing-api-base"));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${base}/api/config/open-platform-copy`,
      method: "GET",
      header: { "content-type": "application/json" },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data?.data || {});
        } else {
          const reason = res.data?.message || res.errMsg || `status-${res.statusCode}`;
          reject(new Error(typeof reason === "string" ? reason : JSON.stringify(reason)));
        }
      },
      fail: (err) => reject(err)
    });
  });
}

function resolveAssetUrl(src = "", options = {}) {
  const value = typeof src === "string" ? src.trim() : "";
  if (!value) return "";
  if (/^(data:|wxfile:)/i.test(value)) {
    return value;
  }

  const apiBase = resolveApiBase(options.apiBase);
  const fileName = extractAvatarFileName(value);
  if (fileName) {
    return buildAvatarDownloadUrl(fileName, { apiBase });
  }

  if (!apiBase) {
    return value;
  }

  const normalizedBase = apiBase.replace(/\/?$/, "");
  if (value.startsWith("/")) {
    return `${normalizedBase}${value}`;
  }
  if (/^\.\.?\//.test(value)) {
    return `${normalizedBase}/${value.replace(/^\.+\//, "")}`;
  }
  if (value.includes("/")) {
    return `${normalizedBase}/${value}`;
  }
  return `${normalizedBase}/api/files/download/${encodeURIComponent(value)}`;
}

function mergeClasses(baseClass, attrsText = "") {
  const classMatch = attrsText.match(/class=['"]([^'"]*)['"]/i);
  const otherAttrs = attrsText.replace(/class=['"][^'"]*['"]/i, "").trim();
  const extra = classMatch && classMatch[1] ? classMatch[1].trim() : "";
  const classes = [baseClass];
  if (extra) classes.push(extra);
  const classAttr = classes.filter(Boolean).join(" ");
  const attrParts = [];
  if (classAttr) attrParts.push(`class="${classAttr}"`);
  if (otherAttrs) attrParts.push(otherAttrs);
  return attrParts.length ? ` ${attrParts.join(" ")}` : "";
}

function replaceTag(html, fromTag, toTag, baseClass) {
  const openTag = new RegExp(`<${fromTag}\\b([^>]*)>`, "gi");
  const closeTag = new RegExp(`</${fromTag}>`, "gi");
  let output = html.replace(openTag, (match, attrs = "") => {
    const merged = mergeClasses(baseClass, attrs || "");
    return `<${toTag}${merged}>`;
  });
  output = output.replace(closeTag, `</${toTag}>`);
  return output;
}

function transformHtmlContent(html = "", options = {}) {
  if (!html || typeof html !== "string") {
    return "";
  }
  let output = html;

  output = output.replace(/<input\b[^>]*type=['"]?checkbox['"]?[^>]*>/gi, (tag) => {
    const checked = /\bchecked\b/i.test(tag);
    const glyph = checked ? "[x]" : "[ ]";
    return `<span class="op-checkbox${checked ? " is-checked" : ""}" data-op-checkbox="${checked ? "checked" : "unchecked"}">${glyph}</span>`;
  });

  output = replaceTag(output, "figure", "div", "op-figure");
  output = replaceTag(output, "figcaption", "div", "op-figcaption");
  output = replaceTag(output, "table", "div", "op-table");
  output = replaceTag(output, "thead", "div", "op-table-head");
  output = replaceTag(output, "tbody", "div", "op-table-body");
  output = replaceTag(output, "tr", "div", "op-table-row");
  output = replaceTag(output, "th", "div", "op-table-header-cell");
  output = replaceTag(output, "td", "div", "op-table-cell");
  output = replaceTag(output, "caption", "div", "op-table-caption");
  output = output.replace(/<colgroup[^>]*>/gi, "");
  output = output.replace(/<col[^>]*>/gi, "");
  output = output.replace(/<\/colgroup>/gi, "");

  output = output.replace(/<a\b([^>]*)>/gi, (match, attrs = "") => {
    let href = "";
    const hrefMatch = attrs.match(/href=['"]([^'"]*)['"]/i);
    if (hrefMatch && hrefMatch[1]) {
      href = hrefMatch[1].trim();
    }
    const withoutHref = attrs.replace(/href=['"][^'"]*['"]/i, "");
    const classMatch = withoutHref.match(/class=['"]([^'"]*)['"]/i);
    const remaining = withoutHref.replace(/class=['"][^'"]*['"]/i, "").trim();
    const classes = ["op-link"];
    if (classMatch && classMatch[1]) {
      const extra = classMatch[1].trim();
      if (extra) classes.push(extra);
    }
    const attrParts = [];
    if (classes.length) {
      attrParts.push(`class="${classes.join(" ")}"`);
    }
    if (href) {
      const safeHref = href.replace(/"/g, "&quot;");
      attrParts.push(`href="${safeHref}"`);
      attrParts.push(`data-op-link="${safeHref}"`);
    } else {
      attrParts.push('href="javascript:void(0)"');
    }
    if (remaining) {
      attrParts.push(remaining);
    }
    return `<a ${attrParts.join(" ")}>`;
  });

  output = output.replace(/<img\b([^>]*)>/gi, (match, attrs = "") => {
    let src = "";
    const srcMatch = attrs.match(/src=['"]([^'"]*)['"]/i);
    if (srcMatch && srcMatch[1]) {
      src = srcMatch[1].trim();
    }
    const resolved = resolveAssetUrl(src, options);
    const otherAttrs = attrs.replace(/src=['"][^'"]*['"]/i, "").trim();
    const attrParts = [];
    if (resolved) {
      const safe = resolved.replace(/"/g, "&quot;");
      attrParts.push(`src="${safe}"`);
      attrParts.push(`data-op-image="${safe}"`);
    }
    attrParts.push('mode="widthFix"');
    if (otherAttrs) {
      attrParts.push(otherAttrs);
    }
    const imageTag = `<img ${attrParts.join(" ")} />`;
    return `<div class="op-image-container">${imageTag}</div>`;
  });

  output = output.replace(/<br\s*>/gi, "<br />");

  return output;
}

function extractImageUrls(html = "", options = {}) {
  if (!html || typeof html !== "string") {
    return [];
  }
  const urls = [];
  html.replace(/<img\b([^>]*)>/gi, (match, attrs = "") => {
    const srcMatch = attrs.match(/src=['"]([^'"]*)['"]/i);
    if (srcMatch && srcMatch[1]) {
      const resolved = resolveAssetUrl(srcMatch[1], options);
      if (resolved) {
        urls.push(resolved);
      }
    }
    return match;
  });
  return Array.from(new Set(urls));
}

function extractExternalPageUrl(html = "", options = {}) {
  const htmlString = typeof html === "string" ? html : "";
  const candidates = [];

  if (typeof options?.directUrl === "string") {
    candidates.push(options.directUrl);
  }

  if (Array.isArray(options?.fallbackUrls)) {
    for (const item of options.fallbackUrls) {
      if (typeof item === "string") {
        candidates.push(item);
      }
    }
  }

  if (htmlString) {
    const canonicalMatch = htmlString.match(
      /<link[^>]+rel=['"]?(?:canonical|alternate)['"]?[^>]*href=['"]([^'"]+)['"]/i
    );
    if (canonicalMatch && canonicalMatch[1]) {
      candidates.push(canonicalMatch[1]);
    }

    const ogUrlMatch = htmlString.match(
      /<meta[^>]+property=['"]og:url['"][^>]*content=['"]([^'"]+)['"]/i
    );
    if (ogUrlMatch && ogUrlMatch[1]) {
      candidates.push(ogUrlMatch[1]);
    }

    const metaUrlMatch = htmlString.match(
      /<meta[^>]+name=['"]og:url['"][^>]*content=['"]([^'"]+)['"]/i
    );
    if (metaUrlMatch && metaUrlMatch[1]) {
      candidates.push(metaUrlMatch[1]);
    }

    const refreshMatch = htmlString.match(
      /<meta[^>]+http-equiv=['"]refresh['"][^>]*content=['"][^;]*;\s*url=([^'"]+)['"]/i
    );
    if (refreshMatch && refreshMatch[1]) {
      candidates.push(refreshMatch[1]);
    }

    const dataUrlMatch = htmlString.match(/data-open-platform-url=['"]([^'"]+)['"]/i);
    if (dataUrlMatch && dataUrlMatch[1]) {
      candidates.push(dataUrlMatch[1]);
    }

    const firstHttpMatch = htmlString.match(/https?:\/\/[^"'<>\s]+/i);
    if (firstHttpMatch && firstHttpMatch[0]) {
      candidates.push(firstHttpMatch[0]);
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

module.exports = {
  fetchOpenPlatformCopy,
  transformHtmlContent,
  resolveAssetUrl,
  extractImageUrls,
  extractExternalPageUrl
};
