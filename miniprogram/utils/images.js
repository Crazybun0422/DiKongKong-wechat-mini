const { resolveApiBase } = require("./profile");

function buildImageUrl(value, options = {}) {
  const fallback = options.fallback || "";
  if (!value) return fallback;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback || trimmed;
    if (/^https?:\/\//.test(trimmed) || trimmed.startsWith("wxfile://")) {
      return trimmed;
    }
    const normalized = trimmed.replace(/^\.\//, "");
    if (/^\/assets\//.test(normalized) || normalized.startsWith("/")) {
      return normalized.startsWith("/") ? normalized : `/${normalized}`;
    }
    const base = resolveApiBase(options.apiBase);
    if (!base) return normalized;
    return `${base}/api/files/download/${encodeURIComponent(normalized)}`;
  }
  if (typeof value === "object" && value !== null) {
    const candidate =
      value.url ||
      value.avatarUrl ||
      value.fileName ||
      value.filename ||
      value.name ||
      value.path ||
      value.location;
    if (candidate) return buildImageUrl(candidate, options);
  }
  return fallback;
}

module.exports = {
  buildImageUrl
};
