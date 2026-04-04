const { fetchDrones } = require("../../../utils/drones");

const resolveEventIndex = (event = {}) => {
  const currentIndex = Number(event?.currentTarget?.dataset?.index);
  if (Number.isFinite(currentIndex)) {
    return currentIndex;
  }
  const detailIndex = Number(event?.detail?.index);
  return detailIndex;
};

function computeDronePickerLabel(page, state = {}) {
  const loading =
    Object.prototype.hasOwnProperty.call(state, "loadingDrones")
      ? state.loadingDrones
      : page.data.loadingDrones;
  const available =
    Object.prototype.hasOwnProperty.call(state, "droneListAvailable")
      ? state.droneListAvailable
      : page.data.droneListAvailable;
  const name =
    Object.prototype.hasOwnProperty.call(state, "selectedDroneName")
      ? state.selectedDroneName
      : page.data.selectedDroneName;
  if (loading) return "加载中";
  if (!available) return "未提供";
  return name || "未提供";
}

function normalizeAircraftModel(_page, value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function getDroneList(page) {
  if (Array.isArray(page._droneList) && page._droneList.length) {
    return page._droneList;
  }
  return [];
}

function resolveDroneIndexByModel(page, model) {
  const normalized = normalizeAircraftModel(page, model);
  if (!normalized) return -1;
  const list = getDroneList(page);
  if (!Array.isArray(list) || !list.length) return -1;
  let index = list.findIndex((item) => item.slug === normalized);
  if (index >= 0) return index;
  const lower = normalized.toLowerCase();
  return list.findIndex((item) => (item.name || "").toLowerCase() === lower);
}

function resolveDroneCategoryId(_page, item = {}) {
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const slug = typeof item.slug === "string" ? item.slug.trim() : "";
  const nameLower = name.toLowerCase();
  const slugLower = slug.toLowerCase();

  const isTransport = slugLower.includes("flycart") || nameLower.includes("flycart");
  const isAgriculture =
    slugLower.startsWith("mg-") ||
    slugLower.startsWith("mg1") ||
    slugLower.startsWith("mg-new") ||
    /^mg\d/.test(slugLower) ||
    /^t\d/.test(slugLower) ||
    /^t\d/i.test(name);
  const isEnterprise =
    slugLower.includes("matrice") ||
    slugLower.startsWith("m-") ||
    slugLower.startsWith("m100") ||
    slugLower.startsWith("m200") ||
    slugLower.startsWith("m300") ||
    slugLower.startsWith("m350") ||
    slugLower.startsWith("m600") ||
    slugLower.startsWith("m30") ||
    slugLower.startsWith("industry-") ||
    nameLower.includes("enterprise");
  const isProAerial = slugLower.includes("inspire") || nameLower.includes("inspire");
  const isFpv = slugLower.includes("fpv") || nameLower.includes("fpv") ||
    slugLower.includes("avata") || nameLower.includes("avata");
  const isConsumerPortable =
    slugLower.includes("mini") ||
    nameLower.includes("mini") ||
    slugLower.includes("neo") ||
    nameLower.includes("neo") ||
    slugLower.includes("flip") ||
    nameLower.includes("flip") ||
    slugLower.includes("spark") ||
    nameLower.includes("spark");
  const isConsumerImaging =
    slugLower.includes("mavic") ||
    nameLower.includes("mavic") ||
    slugLower.includes("air") ||
    nameLower.includes("air") ||
    slugLower.includes("classic") ||
    nameLower.includes("classic") ||
    slugLower.includes("phantom") ||
    nameLower.includes("phantom") ||
    slugLower.includes("pro") ||
    nameLower.includes("pro");

  if (isTransport) return "transport";
  if (isAgriculture) return "agri";
  if (isEnterprise) return "enterprise";
  if (isProAerial) return "pro";
  if (isFpv) return "fpv";
  if (isConsumerPortable) return "consumer-portable";
  if (isConsumerImaging) return "consumer-imaging";
  return "other";
}

function buildDroneCategories(page, list = []) {
  if (!Array.isArray(list) || !list.length) return [];
  const categories = [
    { id: "consumer-portable", label: "消费级便携", items: [] },
    { id: "consumer-imaging", label: "消费级影像", items: [] },
    { id: "fpv", label: "FPV 沉浸", items: [] },
    { id: "pro", label: "专业航拍", items: [] },
    { id: "enterprise", label: "企业级行业", items: [] },
    { id: "agri", label: "农业植保", items: [] },
    { id: "transport", label: "物流运输", items: [] },
    { id: "other", label: "其他", items: [] }
  ];

  const map = new Map(categories.map((category) => [category.id, category]));
  list.forEach((item, index) => {
    if (!item) return;
    const id = resolveDroneCategoryId(page, item);
    const target = map.get(id) || map.get("other");
    if (target) {
      target.items.push({
        index,
        name: item.name || "",
        slug: item.slug || ""
      });
    }
  });
  categories.forEach((category) => {
    if (!Array.isArray(category.items)) return;
    category.items.sort((a, b) =>
      `${a?.name || ""}`.toLowerCase().localeCompare(`${b?.name || ""}`.toLowerCase())
    );
  });
  return categories.filter((category) => category.items.length);
}

function applyDroneByIndex(page, idx, options = {}) {
  const list = getDroneList(page);
  if (!Array.isArray(list) || !list.length) return;
  const bounded = Math.max(0, Math.min(list.length - 1, idx));
  const drone = list[bounded] || list[0];
  const dronePickerLabel = computeDronePickerLabel(page, {
    loadingDrones: false,
    droneListAvailable: true,
    selectedDroneName: drone.name
  });
  const previousSlug = page.data.selectedDrone;
  const changed = drone.slug !== previousSlug;
  const shouldPersist = options.persist !== false;
  const categories = Array.isArray(page.data.droneCategories) ? page.data.droneCategories : [];
  let activeIndex = Number.isFinite(page.data.activeDroneCategoryIndex)
    ? page.data.activeDroneCategoryIndex
    : 0;
  const matchedCategoryIndex = categories.findIndex((category) =>
    Array.isArray(category.items) && category.items.some((item) => item.index === bounded)
  );
  if (matchedCategoryIndex >= 0) {
    activeIndex = matchedCategoryIndex;
  }
  const activeCategory = categories[activeIndex] || categories[0] || { items: [] };

  page.setData({
    activeDroneCategoryIndex: activeIndex,
    droneCategoryItems: activeCategory.items || [],
    selectedDroneIndex: bounded,
    selectedDrone: drone.slug,
    selectedDroneName: drone.name,
    dronePickerLabel
  }, () => {
    if (changed) {
      page.syncDjiLayerQuery({ force: true });
      if (shouldPersist) {
        page.persistMapLayerSettings();
      }
    }
  });
}

function applyAircraftModelSetting(page, model, options = {}) {
  const normalized = normalizeAircraftModel(page, model);
  if (!normalized) return false;
  const index = resolveDroneIndexByModel(page, normalized);
  if (index < 0) return false;
  applyDroneByIndex(page, index, { persist: options.persist !== false });
  return true;
}

function applyDroneList(page, list = []) {
  if (!Array.isArray(list) || !list.length) return;
  page._droneList = list;
  const currentSlug = page.data.selectedDrone;
  let nextIndex = list.findIndex((item) => item.slug === currentSlug);
  if (nextIndex < 0) {
    nextIndex = 0;
  }
  const next = list[nextIndex];
  if (!next) return;
  const changed = next.slug !== currentSlug;
  const dronePickerLabel = computeDronePickerLabel(page, {
    loadingDrones: false,
    droneListAvailable: true,
    selectedDroneName: next.name
  });

  const categories = buildDroneCategories(page, list);
  let activeIndex = Number.isFinite(page.data.activeDroneCategoryIndex)
    ? page.data.activeDroneCategoryIndex
    : 0;
  if (activeIndex < 0 || activeIndex >= categories.length) {
    activeIndex = 0;
  }
  const matchedCategoryIndex = categories.findIndex((category) =>
    Array.isArray(category.items) && category.items.some((item) => item.index === nextIndex)
  );
  if (matchedCategoryIndex >= 0) {
    activeIndex = matchedCategoryIndex;
  }
  const activeCategory = categories[activeIndex] || categories[0] || { items: [] };

  page.setData({
    droneCategories: categories,
    droneCategoryItems: activeCategory.items || [],
    activeDroneCategoryIndex: activeIndex,
    selectedDroneIndex: nextIndex,
    selectedDrone: next.slug,
    selectedDroneName: next.name,
    loadingDrones: false,
    droneListAvailable: true,
    dronePickerLabel
  });
  if (changed) {
    page.syncDjiLayerQuery({ force: true });
  }
}

function loadDronesFromApi(page) {
  const dronePickerLabel = computeDronePickerLabel(page, {
    loadingDrones: true,
    droneListAvailable: page.data.droneListAvailable
  });
  page.setData({ loadingDrones: true, dronePickerLabel });
  return fetchDrones()
    .then((list) => {
      if (Array.isArray(list) && list.length) {
        applyDroneList(page, list);
        const pending = page._pendingAircraftModel;
        if (pending) {
          const applied = applyAircraftModelSetting(page, pending, { persist: false });
          if (applied) {
            page._pendingAircraftModel = "";
          }
        }
        return;
      }
      page._droneList = [];
      const fallbackLabel = computeDronePickerLabel(page, {
        loadingDrones: false,
        droneListAvailable: false
      });
      page.setData({
        droneNames: [],
        droneCategories: [],
        droneCategoryItems: [],
        activeDroneCategoryIndex: 0,
        loadingDrones: false,
        droneListAvailable: false,
        dronePickerLabel: fallbackLabel
      });
    })
    .catch((err) => {
      console.warn("Failed to fetch drone list", err);
      page._droneList = [];
      const fallbackLabel = computeDronePickerLabel(page, {
        loadingDrones: false,
        droneListAvailable: false
      });
      page.setData({
        droneNames: [],
        droneCategories: [],
        droneCategoryItems: [],
        activeDroneCategoryIndex: 0,
        loadingDrones: false,
        droneListAvailable: false,
        dronePickerLabel: fallbackLabel
      });
    });
}

function openDronePicker(page) {
  if (page.data.loadingDrones) {
    wx.showToast({ title: "机型加载中", icon: "none" });
    return;
  }
  if (!page.data.droneListAvailable) {
    wx.showToast({ title: "机型未提供", icon: "none" });
    return;
  }
  page.setData({
    dronePickerVisible: true,
    pendingDroneIndex: page.data.selectedDroneIndex
  });
}

function closeDronePicker(page) {
  page.setData({
    dronePickerVisible: false,
    pendingDroneIndex: null
  });
}

function onSelectDroneCategory(page, event = {}) {
  const idx = resolveEventIndex(event);
  if (!Number.isFinite(idx)) return;
  const categories = Array.isArray(page.data.droneCategories) ? page.data.droneCategories : [];
  const category = categories[idx];
  if (!category) return;
  page.setData({
    activeDroneCategoryIndex: idx,
    droneCategoryItems: category.items || []
  });
}

function onSelectDroneOption(page, event = {}) {
  const idx = resolveEventIndex(event);
  if (!Number.isFinite(idx)) return;
  page.setData({ pendingDroneIndex: idx });
}

function confirmDronePicker(page) {
  const idx = page.data.pendingDroneIndex;
  if (typeof idx === "number" && idx >= 0) {
    applyDroneByIndex(page, idx);
  }
  closeDronePicker(page);
}

module.exports = {
  computeDronePickerLabel,
  normalizeAircraftModel,
  resolveDroneIndexByModel,
  applyAircraftModelSetting,
  getDroneList,
  resolveDroneCategoryId,
  buildDroneCategories,
  applyDroneList,
  loadDronesFromApi,
  openDronePicker,
  closeDronePicker,
  onSelectDroneCategory,
  onSelectDroneOption,
  confirmDronePicker,
  applyDroneByIndex
};
