const KML_SHAPE_TYPES = new Set(["KML", "KMZ"]);

const isKmlShapeType = (value) => KML_SHAPE_TYPES.has(`${value || ""}`.toUpperCase());

const cloneMarkerDetail = (detail = {}) => {
  if (!detail || typeof detail !== "object") {
    return {};
  }
  const cloneArray = (value) => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item) => (item && typeof item === "object" ? { ...item } : item));
  };
  const cloned = { ...detail };
  cloned.images = cloneArray(detail.images);
  cloned.honors = Array.isArray(detail.honors) ? [...detail.honors] : [];
  cloned.attachments = cloneArray(detail.attachments);
  cloned.qrCodes = cloneArray(detail.qrCodes);
  cloned.videoAccounts = cloneArray(detail.videoAccounts);
  if (detail.primaryVideoAccount && typeof detail.primaryVideoAccount === "object") {
    cloned.primaryVideoAccount = { ...detail.primaryVideoAccount };
  } else if (!detail.primaryVideoAccount) {
    cloned.primaryVideoAccount = null;
  }
  return cloned;
};

const formatNearbyMarkerLabel = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const chars = Array.from(trimmed);
  if (chars.length <= 7) return chars.join("");
  return `${chars.slice(0, 6).join("")}…`;
};

const buildMarkerNameCallout = (content, overrides = {}) => {
  if (!content) return null;
  return Object.assign(
    {
      content,
      color: "#111827",
      fontSize: 12,
      fontWeight: "bold",
      display: "ALWAYS",
      borderRadius: 5,
      padding: 6,
      borderColor: "#111827",
      borderWidth: 0.4
    },
    overrides
  );
};

const resolvePinPointCategory = (value = {}) => {
  const shape = value?.shape || value?.raw?.shape || {};
  return `${shape.pointCategory || shape.pointcategory || value?.pointCategory || value?.pointcategory || ""}`.toUpperCase();
};

const resolvePinPointIconPath = (value = {}) => {
  const category = resolvePinPointCategory(value);
  const iconMap = {
    GENERAL: "/assets/default.png",
    WARNING: "/assets/drone-warning.png",
    AERIAL_SHOT: "/assets/aerial.png",
    TAKEOFF_LANDING: "/assets/dock.png",
    TALL_BUILDING: "/assets/elevation.png"
  };
  return iconMap[category] || "/assets/default.png";
};

const buildPinDisplayName = (name = "", category = "", height) => {
  const baseName = `${name || ""}`.trim();
  const normalizedCategory = `${category || ""}`.toUpperCase();
  if (normalizedCategory !== "TALL_BUILDING" || !Number.isFinite(Number(height))) {
    return baseName;
  }
  const heightText = `${Math.round(Number(height))}m`;
  if (baseName) {
    if (baseName.includes(heightText)) {
      return baseName;
    }
    return `${baseName}·${heightText}`;
  }
  return `高程${heightText}`;
};

const buildPinPointCalloutContent = (name = "", category = "", height) => {
  return formatNearbyMarkerLabel(buildPinDisplayName(name, category, height));
  const contentParts = [];
  const formattedName = formatNearbyMarkerLabel(name || "");
  if (formattedName) {
    contentParts.push(formattedName);
  }
  if (`${category || ""}`.toUpperCase() === "TALL_BUILDING" && Number.isFinite(Number(height))) {
    const heightText = `${Math.round(Number(height))}m`;
    contentParts.push(name ? heightText : `高程${heightText}`);
  }
  return contentParts.join(" ");
};

module.exports = {
  isKmlShapeType,
  cloneMarkerDetail,
  formatNearbyMarkerLabel,
  buildMarkerNameCallout,
  resolvePinPointCategory,
  resolvePinPointIconPath,
  buildPinDisplayName,
  buildPinPointCalloutContent
};
