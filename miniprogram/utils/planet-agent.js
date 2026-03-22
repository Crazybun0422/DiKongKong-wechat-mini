const { authorizedRequest } = require("./profile");

// Keep this as a single switch point; if the backend route changes later,
// update this constant only.
const DEFAULT_PLANET_AGENT_PATH = "/api/coze/police-station-phone";

function normalizeText(value) {
  if (value === undefined || value === null) return "";
  return `${value}`.trim();
}

function safeParseJson(text) {
  if (!text || typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return null;
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    return null;
  }
}

const ENVELOPE_SKIP_KEYS = new Set([
  "success",
  "ok",
  "code",
  "status",
  "statuscode",
  "message",
  "msg",
  "error",
  "err",
  "traceid",
  "requestid",
  "timestamp"
]);

const NOISE_STRINGS = new Set(["success", "ok", "true", "false", "null", "undefined"]);

function normalizeCandidateText(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  if (NOISE_STRINGS.has(text.toLowerCase())) return "";
  return text;
}

function deepExtractReplyText(value, depth = 0, seen = new WeakSet(), options = {}) {
  if (depth > 8) return "";
  if (value === undefined || value === null) return "";

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";
    const parsed = safeParseJson(text);
    if (parsed) {
      const nested = deepExtractReplyText(parsed, depth + 1, seen, options);
      if (nested) return nested;
    }
    return normalizeCandidateText(text);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = deepExtractReplyText(item, depth + 1, seen, options);
      if (hit) return hit;
    }
    return "";
  }

  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const preferredKeys = [
    "output",
    "outputs",
    "final_output",
    "finalOutput",
    "answer",
    "content",
    "result",
    "text",
    "reply",
    "data"
  ];

  for (const key of preferredKeys) {
    if (!(key in value)) continue;
    const hit = deepExtractReplyText(value[key], depth + 1, seen, options);
    if (hit) return hit;
  }

  for (const key of Object.keys(value)) {
    const lowerKey = `${key}`.toLowerCase();
    if (options.skipEnvelopeKeys && ENVELOPE_SKIP_KEYS.has(lowerKey)) continue;
    const hit = deepExtractReplyText(value[key], depth + 1, seen, options);
    if (hit) return hit;
  }

  return "";
}

function extractPlanetAgentReplyText(responseBody = {}) {
  const hit = deepExtractReplyText(responseBody, 0, new WeakSet(), { skipEnvelopeKeys: true });
  if (hit) return hit;
  if (typeof responseBody === "string") return responseBody.trim();
  try {
    return JSON.stringify(responseBody, null, 2);
  } catch (err) {
    return "";
  }
}

function queryPlanetAgent(payload = {}, options = {}) {
  const address = normalizeText(payload.address || payload.query || payload.input);
  if (!address) return Promise.reject(new Error("missing-address"));
  const path = normalizeText(options.path) || DEFAULT_PLANET_AGENT_PATH;
  const requestBody = {
    address
  };
  return authorizedRequest({
    apiBase: options.apiBase,
    token: options.token,
    path,
    method: "POST",
    data: requestBody
  });
}

function queryPlanetAgentByAddress(address, options = {}) {
  return queryPlanetAgent({ address }, options);
}

module.exports = {
  DEFAULT_PLANET_AGENT_PATH,
  queryPlanetAgent,
  queryPlanetAgentByAddress,
  extractPlanetAgentReplyText
};
