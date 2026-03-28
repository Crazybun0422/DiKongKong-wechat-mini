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

module.exports = {
  isKmlShapeType,
  cloneMarkerDetail,
  formatNearbyMarkerLabel,
  buildMarkerNameCallout
};
