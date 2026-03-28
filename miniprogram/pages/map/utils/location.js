const MAP_LAST_LOCATION_STORAGE_KEY = "map.lastKnownLocation";
const {
  DEFAULT_CENTER,
  hasValidCoordinate,
  clampMapScale
} = require("./map-shared");

function normalizeCachedMapLocation(payload = null) {
  const latitude = Number(payload?.latitude);
  const longitude = Number(payload?.longitude);
  if (!hasValidCoordinate(latitude, longitude)) {
    return null;
  }
  return {
    latitude,
    longitude,
    updatedAt: Number(payload?.updatedAt) || Date.now()
  };
}

function loadCachedMapLocation() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
    return null;
  }
  try {
    return normalizeCachedMapLocation(wx.getStorageSync(MAP_LAST_LOCATION_STORAGE_KEY));
  } catch (err) {
    console.warn("load cached map location failed", err);
    return null;
  }
}

function cacheMapLocation(page, point = null) {
  const normalized = normalizeCachedMapLocation(point);
  if (!normalized) {
    return null;
  }
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") {
    return normalized;
  }
  try {
    wx.setStorageSync(MAP_LAST_LOCATION_STORAGE_KEY, normalized);
  } catch (err) {
    console.warn("cache map location failed", err);
  }
  return normalized;
}

function resolveCachedMapLocationPoint() {
  const cached = loadCachedMapLocation();
  if (!cached) return null;
  return {
    latitude: cached.latitude,
    longitude: cached.longitude
  };
}

function applyCachedMapLocationFallback(page, options = {}) {
  const shouldCenter = options.center !== false;
  const scale = clampMapScale(
    Number.isFinite(Number(options.scale)) ? Number(options.scale) : page.data.scale
  );
  const cachedPoint = resolveCachedMapLocationPoint();
  if (cachedPoint) {
    page._lastKnownLocation = cachedPoint;
    page.setMyLocationControlPoint(cachedPoint, { syncCenter: false });
    if (shouldCenter) {
      page.centerOnPoint(cachedPoint, scale, true);
    }
    return true;
  }
  if (options.allowDefault === true && shouldCenter && !page.isMapCenterReady()) {
    page.centerOnPoint(DEFAULT_CENTER, scale, true);
    return true;
  }
  return false;
}

function syncMyLocationPoint(page, options = {}) {
  const silent = options.silent === true;
  return new Promise((resolve) => {
    if (typeof wx === "undefined" || typeof wx.getLocation !== "function") {
      resolve(false);
      return;
    }
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: false,
      highAccuracyExpireTime: 8000,
      success: (res) => {
        const latitude = Number(res?.latitude);
        const longitude = Number(res?.longitude);
        if (!hasValidCoordinate(latitude, longitude)) {
          applyCachedMapLocationFallback(page, { center: false });
          resolve(false);
          return;
        }
        const point = { latitude, longitude };
        page._lastKnownLocation = point;
        cacheMapLocation(page, point);
        page.setMyLocationControlPoint(point);
        page.refreshMarkerPageDistance();
        resolve(true);
      },
      fail: (err) => {
        if (!silent) {
          console.warn("sync my location point failed", err);
        }
        applyCachedMapLocationFallback(page, { center: false });
        resolve(false);
      }
    });
  });
}

function requestInitialLocation(page) {
  return ensureLocationPermission(page)
    .then(() => pullAndCenterLocation(page, { silent: true }))
    .catch(() => {
      applyCachedMapLocationFallback(page, {
        allowDefault: true,
        scale: page.data.scale
      });
    })
    .finally(() => {
      page.markSharePermissionAttempted();
    });
}

function pullAndCenterLocation(page, options = {}) {
  return new Promise((resolve, reject) => {
    wx.getLocation({
      type: "gcj02",
      isHighAccuracy: false,
      highAccuracyExpireTime: 8000,
      success: (res) => {
        page._lastKnownLocation = {
          latitude: res.latitude,
          longitude: res.longitude
        };
        cacheMapLocation(page, page._lastKnownLocation);
        page.setMyLocationControlPoint(page._lastKnownLocation, { syncCenter: false });
        page.refreshMarkerPageDistance();
        let targetScale = null;
        if (typeof options.scaleMeters === "number" && options.scaleMeters > 0) {
          const computed = page.scaleForMeters(options.scaleMeters, res.latitude);
          if (Number.isFinite(computed)) {
            targetScale = computed;
          }
        }
        if (!Number.isFinite(targetScale)) {
          const fallbackScale = Object.prototype.hasOwnProperty.call(options, "scale")
            ? options.scale
            : page.data.scale;
          targetScale = clampMapScale(fallbackScale);
        }
        let extraUpdates = null;
        if (options.resetView) {
          extraUpdates = {
            mapRotate: 0,
            mapSkew: 0,
            compassRotate: 0,
            compassSkew: 0,
            compassVisible: false
          };
          page._mapRotate = 0;
          page._mapSkew = 0;
          page._skipNextRotateRegion = true;
        }
        page.centerOnPoint(
          { latitude: res.latitude, longitude: res.longitude },
          targetScale,
          !!options.silent,
          extraUpdates
        );
        resolve(page._lastKnownLocation);
      },
      fail: (err) => {
        console.warn("getLocation fail", err);
        applyCachedMapLocationFallback(page, {
          allowDefault: options.allowDefaultFallback !== false,
          scale: page.data.scale
        });
        if (!options.silent) {
          wx.showToast({ title: "定位失败，请在设置中开启定位权限", icon: "none" });
        }
        reject(err);
      }
    });
  });
}

function waitForLocationPermissionGrantedWithoutPrompt(page, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 80);
  const delayMs = Math.max(120, Number(options.delayMs) || 250);
  return new Promise((resolve) => {
    if (typeof wx === "undefined" || typeof wx.getSetting !== "function") {
      resolve(false);
      return;
    }
    let attempts = 0;
    const check = () => {
      wx.getSetting({
        success: (res = {}) => {
          const granted = !!(res.authSetting && res.authSetting["scope.userLocation"]);
          if (granted) {
            resolve(true);
            return;
          }
          attempts += 1;
          if (attempts >= maxAttempts) {
            resolve(false);
            return;
          }
          page._nativeInitialLocationBootstrapTimer = setTimeout(() => {
            page._nativeInitialLocationBootstrapTimer = null;
            check();
          }, delayMs);
        },
        fail: () => {
          attempts += 1;
          if (attempts >= maxAttempts) {
            resolve(false);
            return;
          }
          page._nativeInitialLocationBootstrapTimer = setTimeout(() => {
            page._nativeInitialLocationBootstrapTimer = null;
            check();
          }, delayMs);
        }
      });
    };
    check();
  });
}

function pullAndCenterLocationWithRetry(page, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 3);
  const delayMs = Math.max(120, Number(options.delayMs) || 400);
  let attempts = 0;
  return new Promise((resolve) => {
    const run = () => {
      attempts += 1;
      pullAndCenterLocation(page, {
        silent: true,
        allowDefaultFallback: false
      })
        .then(() => resolve(true))
        .catch(() => {
          if (attempts >= maxAttempts) {
            resolve(false);
            return;
          }
          page._nativeInitialLocationBootstrapTimer = setTimeout(() => {
            page._nativeInitialLocationBootstrapTimer = null;
            run();
          }, delayMs);
        });
    };
    run();
  });
}

function bootstrapInitialNativeLocationCenter(page) {
  if (page.data.usePlanetCenterPoint || !page.data.myLocationModeResolved) {
    return;
  }
  if (page._skipPendingFocusOnShow || page._skipInitialNativeAutoCenter) {
    page.markSharePermissionAttempted();
    return;
  }
  if (page._nativeInitialLocationBootstrapStarted) {
    return;
  }
  page._nativeInitialLocationBootstrapStarted = true;
  waitForLocationPermissionGrantedWithoutPrompt(page)
    .then((granted) => {
      if (!granted) {
        return false;
      }
      return pullAndCenterLocationWithRetry(page, {
        maxAttempts: 4,
        delayMs: 450
      });
    })
    .finally(() => {
      if (page._nativeInitialLocationBootstrapTimer) {
        clearTimeout(page._nativeInitialLocationBootstrapTimer);
        page._nativeInitialLocationBootstrapTimer = null;
      }
      page.markSharePermissionAttempted();
    });
}

function ensureLocationPermission(page) {
  return new Promise((resolve, reject) => {
    wx.getSetting({
      success: (res) => {
        const granted = !!(res.authSetting && res.authSetting["scope.userLocation"]);
        if (granted) {
          resolve();
          return;
        }
        authorizeLocation(page).then(resolve).catch(reject);
      },
      fail: reject
    });
  });
}

function authorizeLocation() {
  return new Promise((resolve, reject) => {
    wx.authorize({
      scope: "scope.userLocation",
      success: () => resolve(),
      fail: () => {
        wx.openSetting({
          success: (st) => {
            const granted = !!(st.authSetting && st.authSetting["scope.userLocation"]);
            if (granted) resolve();
            else reject(new Error("permission-denied"));
          },
          fail: (err) => reject(err)
        });
      }
    });
  });
}

module.exports = {
  normalizeCachedMapLocation,
  loadCachedMapLocation,
  cacheMapLocation,
  resolveCachedMapLocationPoint,
  applyCachedMapLocationFallback,
  syncMyLocationPoint,
  requestInitialLocation,
  pullAndCenterLocation,
  waitForLocationPermissionGrantedWithoutPrompt,
  pullAndCenterLocationWithRetry,
  bootstrapInitialNativeLocationCenter,
  ensureLocationPermission,
  authorizeLocation
};
