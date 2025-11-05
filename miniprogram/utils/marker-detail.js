const { buildFileDownloadUrl } = require("./markers");

function ensureText(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed || "";
}

function truncateDisplayName(name, limit = 20) {
  if (typeof name !== "string") {
    return "";
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return "";
  }
  const chars = Array.from(trimmed);
  if (chars.length <= limit) {
    return trimmed;
  }
  return `${chars.slice(0, limit).join("")}...`;
}

function normalizeMarkerDetail(raw = {}, options = {}) {
  const apiBase = options.apiBase;
  const download = (value) => buildFileDownloadUrl(value, { apiBase });

  const name =
    ensureText(raw.name) ||
    ensureText(raw.title) ||
    ensureText(raw.location?.text) ||
    "";

  const locationText =
    ensureText(raw.locationText) ||
    ensureText(raw.address) ||
    ensureText(raw.location?.text) ||
    "";

  const imageFiles = [];
  const pushImage = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((item) => pushImage(item));
      return;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) imageFiles.push(trimmed);
      return;
    }
    if (typeof value === "object") {
      const candidate =
        value.fileName ||
        value.filename ||
        value.objectName ||
        value.name ||
        value.location ||
        value.path ||
        value.url ||
        value.imageUrl ||
        "";
      if (candidate) pushImage(candidate);
    }
  };

  pushImage(raw.images);
  pushImage(raw.imageUrls);
  pushImage(raw.covers);
  pushImage(raw.coverImage);
  pushImage(raw.cover);

  const images = imageFiles.map((fileName, index) => ({
    id: `${raw.id || "marker"}-image-${index}`,
    fileName,
    url: download(fileName)
  }));

  const firstImage = images.length ? images[0].url : "";

  const honorTags = [];
  const pushHonor = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((item) => pushHonor(item));
      return;
    }
    if (typeof value === "string") {
      const text = ensureText(value);
      if (text) {
        honorTags.push(text);
      }
      return;
    }
    if (typeof value === "object") {
      const candidate =
        value.name ||
        value.title ||
        value.label ||
        value.tag ||
        value.text ||
        "";
      const text = ensureText(candidate);
      if (text) {
        honorTags.push(text);
      }
    }
  };

  pushHonor(raw.industryHonorTags);
  pushHonor(raw.honorTags);
  pushHonor(raw.honors);
  pushHonor(raw.honorList);

  const honors = [];
  const seenHonorTags = new Set();
  honorTags.forEach((tag) => {
    if (seenHonorTags.has(tag)) return;
    seenHonorTags.add(tag);
    honors.push(tag);
  });

  const description =
    ensureText(raw.description) ||
    ensureText(raw.introduction) ||
    ensureText(raw.summary) ||
    "";

  const attachments = [];
  let attachmentCounter = 0;
  const pushAttachment = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((item) => pushAttachment(item));
      return;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return;
      const url = download(trimmed);
      attachments.push({
        id: `${raw.id || "marker"}-attachment-${attachmentCounter++}`,
        fileName: trimmed,
        url,
        displayName: trimmed.split("/").pop() || trimmed
      });
      return;
    }
    if (typeof value === "object") {
      const candidate =
        value.url ||
        value.fileUrl ||
        value.fileName ||
        value.filename ||
        value.objectName ||
        value.path ||
        value.location ||
        "";
      if (!candidate) return;
      const url = download(candidate);
      const name =
        value.displayName ||
        value.name ||
        value.title ||
        value.fileName ||
        candidate;
      const displayName = (name || candidate).split("/").pop() || name || candidate;
      attachments.push({
        id: `${raw.id || "marker"}-attachment-${attachmentCounter++}`,
        fileName: name || candidate,
        url,
        displayName
      });
    }
  };

  pushAttachment(raw.attachments);
  pushAttachment(raw.attachmentUrls);
  pushAttachment(raw.attachmentFiles);

  const qrCodes = [];
  let qrCounter = 0;
  const pushQrCode = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((item) => pushQrCode(item));
      return;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return;
      qrCodes.push({
        id: `${raw.id || "marker"}-qr-${qrCounter++}`,
        fileName: trimmed,
        url: download(trimmed)
      });
      return;
    }
    if (typeof value === "object") {
      const candidate =
        value.url ||
        value.fileUrl ||
        value.fileName ||
        value.filename ||
        value.path ||
        value.location ||
        value.imageUrl ||
        "";
      if (!candidate) return;
      qrCodes.push({
        id: `${raw.id || "marker"}-qr-${qrCounter++}`,
        fileName: candidate,
        url: download(candidate)
      });
    }
  };

  pushQrCode(raw.qrCodes);
  pushQrCode(raw.qrCodeUrls);
  pushQrCode(raw.qrCodeImages);

  const videoAccounts = [];
  let videoCounter = 0;
  const pushVideo = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((item) => pushVideo(item));
      return;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return;
      videoAccounts.push({
        id: `${raw.id || "marker"}-video-${videoCounter++}`,
        url: trimmed
      });
      return;
    }
    if (typeof value === "object") {
      const urlValue =
        value.url ||
        value.link ||
        value.pagePath ||
        value.path ||
        value.videoUrl ||
        "";
      const finderId =
        value.finderUserName || value.finderId || value.userName || value.videoChannelId || "";
      const activityId = value.activityId || value.videoId || "";
      if (!urlValue && !finderId && !activityId) return;
      videoAccounts.push({
        id: `${raw.id || "marker"}-video-${videoCounter++}`,
        url: urlValue,
        finderUserName: ensureText(finderId),
        activityId: ensureText(activityId)
      });
    }
  };

  pushVideo(raw.videoChannelUrls);
  pushVideo(raw.videoChannelUrl);
  pushVideo(raw.videoUrls);
  pushVideo(raw.videoAccounts);

  const channelId = ensureText(raw.videoChannelId);
  const videoId = ensureText(raw.videoId);
  if (channelId && videoId) {
    videoAccounts.push({
      id: `${raw.id || "marker"}-video-${videoCounter++}`,
      finderUserName: channelId,
      activityId: videoId
    });
  } else {
    if (channelId) {
      videoAccounts.push({
        id: `${raw.id || "marker"}-video-${videoCounter++}`,
        finderUserName: channelId
      });
    }
    if (videoId) {
      videoAccounts.push({
        id: `${raw.id || "marker"}-video-${videoCounter++}`,
        activityId: videoId
      });
    }
  }

  const uniqueVideoAccounts = [];
  const seenVideoKeys = new Set();
  videoAccounts.forEach((item) => {
    const key = `${item.finderUserName || ""}|${item.activityId || ""}|${item.url || ""}`;
    if (seenVideoKeys.has(key)) return;
    seenVideoKeys.add(key);
    uniqueVideoAccounts.push(item);
  });

  const phone = ensureText(raw.phone || raw.telephone || raw.contactPhone);

  return {
    id: raw.id || "",
    name,
    locationText,
    imageUrl: firstImage,
    images,
    honors,
    description,
    attachments: attachments.map((item) => ({
      ...item,
      shortName: truncateDisplayName(item.displayName || item.fileName)
    })),
    qrCodes,
    videoAccounts: uniqueVideoAccounts,
    primaryVideoAccount: uniqueVideoAccounts.length ? uniqueVideoAccounts[0] : null,
    phone,
    raw
  };
}

module.exports = {
  normalizeMarkerDetail,
  truncateDisplayName,
  ensureText
};
