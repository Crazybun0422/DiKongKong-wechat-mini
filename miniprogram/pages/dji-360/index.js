const { createScopedThreejs } = require("../../libs/threejs-miniprogram");

const DEFAULT_PANORAMA_SRC = "/assets/ex.jpg";
const CAMERA_RADIUS = 500;
const OUTER_RADIUS = 900;
const ROTATE_SENSITIVITY = 0.12;
const MIN_FOV = 30;
const MAX_FOV = 90;
const PLANET_DEFAULT_LAT = 82;
const PLANET_MIN_LAT = 55;
const PLANET_MAX_LAT = 89;
const PLANET_MAX_SIZE = 8192;
const PLANET_OUTPUT_SIZE = 1024;
const PLANET_RADIUS_RATIO = 0.38;
const PLANET_EDGE_BLEND = 0.08;
const PLANET_PLANE_DISTANCE = 900;

Page({
  data: {
    showHint: true,
    viewMode: "planet"
  },

  onLoad(query = {}) {
    const raw = typeof query.src === "string" ? query.src : "";
    const decoded = raw ? decodeURIComponent(raw) : "";
    const planetRaw = typeof query.planetSrc === "string" ? query.planetSrc : "";
    const planetDecoded = planetRaw ? decodeURIComponent(planetRaw) : "";
    this._panoramaSrc = decoded || DEFAULT_PANORAMA_SRC;
    this._panoramaPlanetSrc = planetDecoded || this._panoramaSrc;
    console.log("panorama page load", {
      raw,
      decoded,
      planetRaw,
      planetDecoded,
      src: this._panoramaSrc
    });
  },

  onReady() {
    this.initThreeScene();
  },

  onUnload() {
    this.disposeThreeScene();
  },

  initThreeScene() {
    const query = wx.createSelectorQuery();
    query
      .select("#panorama-canvas")
      .fields({ node: true, size: true })
      .exec((res) => {
        const info = res && res[0];
        if (!info || !info.node) {
          wx.showToast({ title: "Canvas unavailable", icon: "none" });
          return;
        }
        const canvas = info.node;
        const THREE = createScopedThreejs(canvas);
        this._three = THREE;
        const sys = wx.getSystemInfoSync();
        const dpr = sys.pixelRatio || 1;
        canvas.width = info.width * dpr;
        canvas.height = info.height * dpr;
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.setPixelRatio(dpr);
        renderer.setSize(info.width, info.height, false);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, info.width / info.height, 1, 1100);
        camera.position.set(0, 0, 0.1);

        const geometry = new THREE.SphereGeometry(CAMERA_RADIUS, 64, 48);
        const textureLoader = new THREE.TextureLoader();
        const target = new THREE.Vector3();

        this._canvas = canvas;
        this._renderer = renderer;
        this._scene = scene;
        this._camera = camera;
        this._geometry = geometry;
        this._target = target;
        this._viewWidth = info.width;
        this._viewHeight = info.height;
        this._insideLon = 0;
        this._insideLat = 0;
        this._planetLon = 0;
        this._planetLat = PLANET_DEFAULT_LAT;
        this._viewMode = "planet";
        this.updateViewMode("planet");

        const ensureScene = (baseTexture) => {
          const material = new THREE.MeshBasicMaterial({
            map: baseTexture,
            side: THREE.BackSide
          });
          this._material = material;
          const mesh = new THREE.Mesh(geometry, material);
          scene.add(mesh);
          this._sphereMesh = mesh;
          this.updateViewMode(this._viewMode || "planet");
          this.startRenderLoop();
        };

        const ensurePlanetPlane = (planetTexture) => {
          if (this._planetMesh) {
            if (this._planetMaterial && this._planetMaterial.map !== planetTexture) {
              this._planetMaterial.map = planetTexture;
              this._planetMaterial.needsUpdate = true;
            }
            return;
          }
          const planeGeo = new THREE.PlaneGeometry(1, 1);
          const planeMat = new THREE.MeshBasicMaterial({
            map: planetTexture,
            transparent: false
          });
          const planeMesh = new THREE.Mesh(planeGeo, planeMat);
          scene.add(planeMesh);
          this._planetMesh = planeMesh;
          this._planetMaterial = planeMat;
        };

        const buildCanvasTexture = (img, targetWidth, targetHeight) => {
          const offscreen = wx.createOffscreenCanvas({
            type: "2d",
            width: targetWidth,
            height: targetHeight
          });
          const ctx = offscreen.getContext("2d");
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
          const texture = new THREE.CanvasTexture(offscreen);
          texture.needsUpdate = true;
          texture.minFilter = THREE.LinearFilter;
          return texture;
        };

        const buildLittlePlanetTexture = (srcData, srcW, srcH) => {
          const size = Math.max(256, PLANET_OUTPUT_SIZE);
          const canvas = wx.createOffscreenCanvas({ type: "2d", width: size, height: size });
          const ctx = canvas.getContext("2d");
          const imageData = ctx.createImageData(size, size);
          const data = imageData.data;
          const cx = size / 2;
          const cy = size / 2;
          const maxR = Math.min(cx, cy);
          const planetR = maxR * PLANET_RADIUS_RATIO;
          const blendR = planetR * PLANET_EDGE_BLEND;
          const stripH = Math.max(1, Math.round(srcH * 0.12));
          for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
              const dx = x - cx;
              const dy = y - cy;
              const r = Math.sqrt(dx * dx + dy * dy);
              const idx = (y * size + x) * 4;
              const angle = Math.atan2(dy, dx);
              const u = (angle / (2 * Math.PI)) + 0.5;
              let rNorm = r / maxR;
              if (rNorm > 1) rNorm = 1;

              const sampleSky = () => {
                const t = Math.max(0, Math.min(1, (r - planetR) / (maxR - planetR)));
                const v = (1 - t) * (stripH - 1);
                const sx = Math.min(srcW - 1, Math.max(0, Math.round(u * (srcW - 1))));
                const sy = Math.min(stripH - 1, Math.max(0, Math.round(v)));
                const sidx = (sy * srcW + sx) * 4;
                return {
                  r: srcData[sidx],
                  g: srcData[sidx + 1],
                  b: srcData[sidx + 2]
                };
              };

              const samplePlanet = () => {
                const c = 2 * Math.atan(r / planetR);
                const lat = -Math.PI / 2 + c;
                const v = 0.5 - (lat / Math.PI);
                const sx = Math.min(srcW - 1, Math.max(0, Math.round(u * (srcW - 1))));
                const sy = Math.min(srcH - 1, Math.max(0, Math.round(v * (srcH - 1))));
                const sidx = (sy * srcW + sx) * 4;
                return {
                  r: srcData[sidx],
                  g: srcData[sidx + 1],
                  b: srcData[sidx + 2]
                };
              };

              if (r <= planetR - blendR) {
                const c = samplePlanet();
                data[idx] = c.r;
                data[idx + 1] = c.g;
                data[idx + 2] = c.b;
                data[idx + 3] = 255;
                continue;
              }
              if (r >= planetR + blendR) {
                const c = sampleSky();
                data[idx] = c.r;
                data[idx + 1] = c.g;
                data[idx + 2] = c.b;
                data[idx + 3] = 255;
                continue;
              }
              const t = Math.min(1, Math.max(0, (r - (planetR - blendR)) / (2 * blendR)));
              const p = samplePlanet();
              const s = sampleSky();
              data[idx] = Math.round(p.r * (1 - t) + s.r * t);
              data[idx + 1] = Math.round(p.g * (1 - t) + s.g * t);
              data[idx + 2] = Math.round(p.b * (1 - t) + s.b * t);
              data[idx + 3] = 255;
            }
          }
          ctx.putImageData(imageData, 0, 0);
          const texture = new THREE.CanvasTexture(canvas);
          texture.needsUpdate = true;
          texture.minFilter = THREE.LinearFilter;
          return texture;
        };


        const loadTextureFromSrc = (src, options = {}) =>
          new Promise((resolve, reject) => {
            if (typeof wx.createOffscreenCanvas !== "function") {
              reject(new Error("offscreen-canvas-unsupported"));
              return;
            }
            const imageCanvas = wx.createOffscreenCanvas({ type: "2d", width: 2, height: 2 });
            const img = imageCanvas.createImage();
            let triedDataUrl = false;
            const applyImage = () => {
              const width = img.width || 1;
              const height = img.height || 1;
              const maxSide = Math.max(width, height);
              let targetW = width;
              let targetH = height;
              if (options.maxSize && maxSide > options.maxSize) {
                const scale = options.maxSize / maxSide;
                targetW = Math.max(1, Math.round(width * scale));
                targetH = Math.max(1, Math.round(height * scale));
              }
              console.log("panorama texture image loaded", {
                src,
                width,
                height,
                targetW,
                targetH
              });
              if (options.littlePlanet) {
                const srcCanvas = wx.createOffscreenCanvas({
                  type: "2d",
                  width: targetW,
                  height: targetH
                });
                const srcCtx = srcCanvas.getContext("2d");
                srcCtx.drawImage(img, 0, 0, targetW, targetH);
                const srcData = srcCtx.getImageData(0, 0, targetW, targetH).data;
                resolve(buildLittlePlanetTexture(srcData, targetW, targetH));
                return;
              }
              resolve(buildCanvasTexture(img, targetW, targetH));
            };
            img.onload = applyImage;
            img.onerror = (err) => {
              if (!triedDataUrl && src.startsWith("wxfile://") && typeof wx.getFileSystemManager === "function") {
                triedDataUrl = true;
                const fs = wx.getFileSystemManager();
                fs.readFile({
                  filePath: src,
                  encoding: "base64",
                  success: (res) => {
                    const dataUrl = `data:image/jpeg;base64,${res.data || ""}`;
                    console.log("panorama texture image retry with data url");
                    img.src = dataUrl;
                  },
                  fail: (readErr) => {
                    console.warn("panorama readFile failed", readErr);
                    reject(err || new Error("image-load-failed"));
                  }
                });
                return;
              }
              reject(err || new Error("image-load-failed"));
            };
            img.src = src;
            console.log("panorama texture image loading", { src });
          });

        const loadPlanetTexture = () => {
          const src = this._panoramaPlanetSrc || this._panoramaSrc;
          return loadTextureFromSrc(src, {
            maxSize: PLANET_MAX_SIZE,
            littlePlanet: true
          })
            .then((texture) => {
              this._texturePlanet = texture;
              if (!this._sphereMesh) {
                ensureScene(texture);
              } else {
                this.updateViewMode(this._viewMode || "planet");
              }
              ensurePlanetPlane(texture);
            });
        };

        const loadInsideTexture = () => {
          const src = this._panoramaSrc;
          return loadTextureFromSrc(src)
            .then((texture) => {
              this._textureInside = texture;
              this.updateViewMode(this._viewMode || "planet");
            });
        };

        loadPlanetTexture()
          .catch((err) => {
            console.warn("panorama planet texture load failed", err);
            wx.showToast({ title: "Image load failed", icon: "none" });
          })
          .finally(() => {
            loadInsideTexture().catch((err) => {
              console.warn("panorama inside texture load failed", err);
            });
          });

      });
  },

  startRenderLoop() {
    if (!this._renderer || !this._scene || !this._camera || !this._three) return;
    const THREE = this._three;
    const loop = () => {
      if (!this._renderer || !this._scene || !this._camera) return;
      const latClampMax = this._viewMode === "planet" ? PLANET_MAX_LAT : 85;
      const latClampMin = this._viewMode === "planet" ? PLANET_MIN_LAT : -85;
      const baseLat = this._viewMode === "planet" ? this._planetLat : this._insideLat;
      const lat = Math.max(latClampMin, Math.min(latClampMax, baseLat || 0));
      const lon = this._viewMode === "planet" ? (this._planetLon || 0) : (this._insideLon || 0);
      const phi = THREE.Math.degToRad(90 - lat);
      const theta = THREE.Math.degToRad(lon);
      if (this._viewMode === "inside") {
        const x = CAMERA_RADIUS * Math.sin(phi) * Math.cos(theta);
        const y = CAMERA_RADIUS * Math.cos(phi);
        const z = CAMERA_RADIUS * Math.sin(phi) * Math.sin(theta);
        this._target.set(x, y, z);
        this._camera.position.set(0, 0, 0.1);
        this._camera.lookAt(this._target);
      } else {
        this._camera.position.set(0, 0, PLANET_PLANE_DISTANCE);
        this._camera.lookAt(0, 0, 0);
        if (this._planetMesh) {
          this._planetMesh.rotation.z = THREE.Math.degToRad(lon);
        }
      }
      this._renderer.render(this._scene, this._camera);
      const raf = this._canvas?.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
      this._rafId = raf(loop);
    };
    loop();
  },

  disposeThreeScene() {
    if (this._canvas && this._rafId) {
      if (typeof this._canvas.cancelAnimationFrame === "function") {
        this._canvas.cancelAnimationFrame(this._rafId);
      } else {
        clearTimeout(this._rafId);
      }
    }
    this._rafId = null;
    if (this._sphereMesh && this._scene) {
      this._scene.remove(this._sphereMesh);
    }
    if (this._planetMesh && this._scene) {
      this._scene.remove(this._planetMesh);
    }
    if (this._geometry) this._geometry.dispose();
    if (this._planetMesh?.geometry) this._planetMesh.geometry.dispose();
    if (this._material) this._material.dispose();
    if (this._planetMaterial) this._planetMaterial.dispose();
    if (this._texturePlanet) this._texturePlanet.dispose();
    if (this._textureInside) this._textureInside.dispose();
    if (this._renderer) this._renderer.dispose();
    this._sphereMesh = null;
    this._planetMesh = null;
    this._scene = null;
    this._camera = null;
    this._renderer = null;
    this._geometry = null;
    this._material = null;
    this._planetMaterial = null;
    this._texturePlanet = null;
    this._textureInside = null;
  },

  updateViewMode(mode) {
    const nextMode = mode === "inside" ? "inside" : "planet";
    this._viewMode = nextMode;
    if (this._material && this._three) {
      const nextTexture = nextMode === "inside"
        ? (this._textureInside || this._texturePlanet)
        : (this._texturePlanet || this._textureInside);
      if (nextTexture && this._material.map !== nextTexture) {
        this._material.map = nextTexture;
        this._material.map.needsUpdate = true;
      }
      this._material.side = this._three.BackSide;
      this._material.needsUpdate = true;
    }
    if (this._scene) {
      this._scene.background = null;
    }
    if (this._sphereMesh) {
      this._sphereMesh.visible = nextMode === "inside";
      this._sphereMesh.scale.set(1, 1, 1);
    }
    if (this._planetMesh && this._camera) {
      this._planetMesh.visible = nextMode === "planet";
      if (nextMode === "planet") {
        const fov = (this._camera.fov || 70) * (Math.PI / 180);
        const height = 2 * PLANET_PLANE_DISTANCE * Math.tan(fov / 2);
        const size = Math.min(height, height * (this._viewWidth / Math.max(1, this._viewHeight)));
        this._planetMesh.scale.set(size, size, 1);
      }
    }
    if (nextMode === "planet") {
      this._planetLat = PLANET_DEFAULT_LAT;
      if (this._planetLon == null) {
        this._planetLon = this._insideLon || 0;
      }
      this.setFov(70);
    } else {
      if (this._insideLat == null) {
        this._insideLat = 0;
      }
      if (this._insideLon == null) {
        this._insideLon = 0;
      }
      this.setFov(75);
    }
    this.setData({ viewMode: nextMode });
  },

  setFov(value) {
    if (!this._camera) return;
    const next = Math.max(MIN_FOV, Math.min(MAX_FOV, value));
    this._camera.fov = next;
    this._camera.updateProjectionMatrix();
  },

  onModeToggle() {
    const next = this._viewMode === "inside" ? "planet" : "inside";
    this.updateViewMode(next);
  },

  onZoomInTap() {
    this.setFov((this._camera?.fov || 75) - 6);
  },

  onZoomOutTap() {
    this.setFov((this._camera?.fov || 75) + 6);
  },

  onTouchStart(event) {
    const touches = event?.touches || [];
    if (!touches.length) return;
    if (touches.length >= 2) {
      this._pinching = true;
      this._pinchStartDist = this.touchDistance(touches);
      this._pinchStartFov = this._camera?.fov || 75;
    } else {
      const touch = touches[0];
      this._dragging = true;
      this._startX = touch.clientX;
      this._startY = touch.clientY;
      this._startLon = this._insideLon || 0;
      this._startLat = this._insideLat || 0;
      this._startPlanetLon = this._planetLon || 0;
    }
    if (this.data.showHint) {
      this.setData({ showHint: false });
    }
  },

  onTouchMove(event) {
    const touches = event?.touches || [];
    if (this._pinching && touches.length >= 2) {
      const dist = this.touchDistance(touches);
      const startDist = this._pinchStartDist || dist;
      if (startDist > 0) {
        const scale = dist / startDist;
        const next = (this._pinchStartFov || 75) / Math.max(0.2, scale);
        this.setFov(next);
      }
      return;
    }
    if (!this._dragging) return;
    const touch = touches[0];
    if (!touch) return;
    const deltaX = touch.clientX - (this._startX || 0);
    const deltaY = touch.clientY - (this._startY || 0);
    if (this._viewMode === "planet") {
      this._planetLon = (this._startPlanetLon || 0) - deltaX * ROTATE_SENSITIVITY;
    } else {
      this._insideLon = (this._startLon || 0) - deltaX * ROTATE_SENSITIVITY;
      this._insideLat = (this._startLat || 0) + deltaY * ROTATE_SENSITIVITY;
    }
  },

  onTouchEnd() {
    this._dragging = false;
    this._pinching = false;
  },
  touchDistance(touches = []) {
    if (touches.length < 2) return 0;
    const dx = (touches[0].clientX || 0) - (touches[1].clientX || 0);
    const dy = (touches[0].clientY || 0) - (touches[1].clientY || 0);
    return Math.sqrt(dx * dx + dy * dy);
  }
});
