const DEFAULT_FRAME_PATH = "/assets/vip/vip-position.png";
const DEFAULT_SIZE = 96;

function resolveLocalImagePath(src) {
  return new Promise((resolve, reject) => {
    if (!src || typeof src !== "string") {
      reject(new Error("missing-image-src"));
      return;
    }
    if (!/^https?:\/\//.test(src)) {
      resolve(src);
      return;
    }
    wx.getImageInfo({
      src,
      success: (info = {}) => {
        if (info.path) {
          resolve(info.path);
          return;
        }
        reject(new Error("missing-local-image-path"));
      },
      fail: reject
    });
  });
}

function loadCanvasImage(canvas, src) {
  return new Promise((resolve, reject) => {
    const image = canvas.createImage();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function canvasToTempFilePath(canvas, size) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      width: size,
      height: size,
      destWidth: size,
      destHeight: size,
      fileType: "png",
      success: (res = {}) => {
        if (res.tempFilePath) {
          resolve(res.tempFilePath);
          return;
        }
        reject(new Error("missing-temp-file-path"));
      },
      fail: reject
    });
  });
}

function drawCircleImage(ctx, image, x, y, size) {
  const sourceWidth = Number(image.width) || size;
  const sourceHeight = Number(image.height) || size;
  const sourceSize = Math.min(sourceWidth, sourceHeight);
  const sourceX = Math.max(0, (sourceWidth - sourceSize) / 2);
  const sourceY = Math.max(0, (sourceHeight - sourceSize) / 2);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, x, y, size, size);
  ctx.restore();
}

function composeAvatarLocationIcon(options = {}) {
  if (typeof wx === "undefined" || typeof wx.createOffscreenCanvas !== "function") {
    return Promise.reject(new Error("offscreen-canvas-unavailable"));
  }
  const avatarUrl = options.avatarUrl || "";
  const framePath = options.framePath || DEFAULT_FRAME_PATH;
  const size = Number(options.size) > 0 ? Number(options.size) : DEFAULT_SIZE;
  const avatarSize = Math.round(size * (142 / 256));
  const avatarX = Math.round(size * (57 / 256));
  const avatarY = Math.round(size * (70 / 256));
  const canvas = wx.createOffscreenCanvas({ type: "2d", width: size, height: size });
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof canvas.createImage !== "function") {
    return Promise.reject(new Error("canvas-2d-unavailable"));
  }
  return Promise.all([
    resolveLocalImagePath(avatarUrl),
    resolveLocalImagePath(framePath)
  ])
    .then(([avatarPath, resolvedFramePath]) =>
      Promise.all([
        loadCanvasImage(canvas, avatarPath),
        loadCanvasImage(canvas, resolvedFramePath)
      ])
    )
    .then(([avatarImage, frameImage]) => {
      ctx.clearRect(0, 0, size, size);
      drawCircleImage(ctx, avatarImage, avatarX, avatarY, avatarSize);
      ctx.drawImage(frameImage, 0, 0, size, size);
      return canvasToTempFilePath(canvas, size);
    });
}

module.exports = {
  composeAvatarLocationIcon
};
