const { authorizedRequest, getAuthToken, resolveApiBase } = require("./profile");

const CONFIG_DEFINITIONS = {
  flightQualificationAssessment: {
    path: "/api/config/flight-qualification-assessment-rich-text",
    title: "飞行资质评估"
  },
  insuranceCoverage: {
    path: "/api/config/insurance-coverage-rich-text",
    title: "爱机保险"
  },
  caacLicenseRegistrationSubsidy: {
    path: "/api/config/caac-license-registration-subsidy-rich-text",
    title: "CAAC执照"
  },
  theoryCertificate: {
    path: "/api/config/theory-certificate-rich-text",
    title: "操控理论合格证"
  },
  operationCertificate: {
    path: "/api/config/operation-certificate-rich-text",
    title: "运营合格证"
  },
  flightHeight120m: {
    path: "/api/config/120m-flight-rich-text",
    title: "120米飞行说明"
  },
  noSpecialFlightScenario: {
    path: "/api/config/no-special-flight-scenario-rich-text",
    title: "特殊飞行场景说明"
  },
  reportAndUnlockGuide: {
    path: "/api/config/report-and-unlock-guide-rich-text",
    title: "报备和解禁指南"
  },
  airspaceDescription: {
    path: "/api/config/airspace-description-rich-text",
    title: "空域说明"
  }
};

function appendNoCacheQuery(path = "") {
  const separator = path.includes("?") ? "&" : "?";
  const nonce = `${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
  return `${path}${separator}_rt=${nonce}`;
}

function resolveConfigDefinition(key = "") {
  const normalizedKey = `${key || ""}`.trim();
  return CONFIG_DEFINITIONS[normalizedKey] || null;
}

function fetchPreflightRichTextConfig(key, options = {}) {
  const definition = resolveConfigDefinition(key);
  if (!definition) {
    return Promise.reject(new Error("unsupported-rich-text-key"));
  }
  const apiBase = resolveApiBase(options.apiBase);
  const token = options.token || getAuthToken();
  const noCache = options.noCache !== false;
  return authorizedRequest({
    apiBase,
    token,
    path: noCache ? appendNoCacheQuery(definition.path) : definition.path,
    method: "GET",
    header: noCache
      ? {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0"
      }
      : {}
  }).then((body = {}) => {
    const payload = body?.data || {};
    return {
      key,
      title: typeof payload.title === "string" && payload.title.trim()
        ? payload.title.trim()
        : definition.title,
      content: typeof payload.content === "string" ? payload.content : "",
      updatedAt: payload.updatedAt || ""
    };
  });
}

function buildPreflightRichTextUrl(key, title = "") {
  const definition = resolveConfigDefinition(key);
  if (!definition) return "";
  const query = [`key=${encodeURIComponent(key)}`];
  const finalTitle = `${title || definition.title || ""}`.trim();
  if (finalTitle) {
    query.push(`title=${encodeURIComponent(finalTitle)}`);
  }
  return `/packages/preflight/rich-text/index?${query.join("&")}`;
}

module.exports = {
  CONFIG_DEFINITIONS,
  resolveConfigDefinition,
  fetchPreflightRichTextConfig,
  buildPreflightRichTextUrl
};
