const { USER_CREDENTIAL_TYPES } = require("./user-credentials");

const QUALIFICATION_MODE_ENTERTAINMENT = "ENTERTAINMENT";
const QUALIFICATION_MODE_COMMERCIAL = "COMMERCIAL";

const QUALIFICATION_LEVEL_NONE = "NONE";
const QUALIFICATION_LEVEL_SUGGESTED = "SUGGESTED";
const QUALIFICATION_LEVEL_REQUIRED = "REQUIRED";

const AIRCRAFT_CLASS_MICRO = "MICRO";
const AIRCRAFT_CLASS_LIGHT = "LIGHT";
const AIRCRAFT_CLASS_SMALL = "SMALL";
const AIRCRAFT_CLASS_MEDIUM = "MEDIUM";
const AIRCRAFT_CLASS_LARGE = "LARGE";

const AIRCRAFT_CLASS_LABELS = {
  [AIRCRAFT_CLASS_MICRO]: "微型",
  [AIRCRAFT_CLASS_LIGHT]: "轻型",
  [AIRCRAFT_CLASS_SMALL]: "小型",
  [AIRCRAFT_CLASS_MEDIUM]: "中型",
  [AIRCRAFT_CLASS_LARGE]: "大型"
};

const QUALIFICATION_LEVEL_LABELS = {
  [QUALIFICATION_LEVEL_NONE]: "无需",
  [QUALIFICATION_LEVEL_SUGGESTED]: "建议",
  [QUALIFICATION_LEVEL_REQUIRED]: "必须"
};

const STATIC_DRONE_CLASSIFIERS = [
  { match: /(neo|mini|flip)/i, aircraftClass: AIRCRAFT_CLASS_MICRO },
  { match: /(spark|air\b|mavic|avata|fpv|phantom|m30|m3d|m3td|m3e|m3t|m100)/i, aircraftClass: AIRCRAFT_CLASS_LIGHT },
  { match: /(inspire|m200|m210|m300|m350|m600|matrice 300|matrice 350|matrice 600)/i, aircraftClass: AIRCRAFT_CLASS_SMALL },
  { match: /(flycart|fc30|mg-|agras|t10|t16|t20|t25|t30|t40|t50|t60)/i, aircraftClass: AIRCRAFT_CLASS_MEDIUM }
];

function normalizeText(value = "") {
  return `${value || ""}`.trim().toLowerCase();
}

function buildRequirement(level, detail = "") {
  return {
    level,
    label: QUALIFICATION_LEVEL_LABELS[level] || "无需",
    detail: `${detail || ""}`.trim()
  };
}

function resolveAircraftClassFromStaticModel(drone = {}) {
  const source = `${drone?.slug || ""} ${drone?.name || ""}`.trim();
  const normalized = normalizeText(source);
  if (!normalized) {
    return AIRCRAFT_CLASS_LIGHT;
  }
  const matched = STATIC_DRONE_CLASSIFIERS.find((item) => item.match.test(normalized));
  if (matched) return matched.aircraftClass;
  return AIRCRAFT_CLASS_LIGHT;
}

function buildPolicyTemplate(aircraftClass, mode) {
  const commercial = mode === QUALIFICATION_MODE_COMMERCIAL;
  if (aircraftClass === AIRCRAFT_CLASS_MICRO) {
    if (!commercial) {
      return {
        [USER_CREDENTIAL_TYPES.INSURANCE]: buildRequirement(QUALIFICATION_LEVEL_NONE),
        [USER_CREDENTIAL_TYPES.THEORY]: buildRequirement(QUALIFICATION_LEVEL_NONE),
        [USER_CREDENTIAL_TYPES.CAAC]: buildRequirement(QUALIFICATION_LEVEL_NONE),
        [USER_CREDENTIAL_TYPES.OPERATION]: buildRequirement(QUALIFICATION_LEVEL_NONE)
      };
    }
    return {
      [USER_CREDENTIAL_TYPES.INSURANCE]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED),
      [USER_CREDENTIAL_TYPES.THEORY]: buildRequirement(QUALIFICATION_LEVEL_SUGGESTED),
      [USER_CREDENTIAL_TYPES.CAAC]: buildRequirement(QUALIFICATION_LEVEL_SUGGESTED),
      [USER_CREDENTIAL_TYPES.OPERATION]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED)
    };
  }

  if (aircraftClass === AIRCRAFT_CLASS_LIGHT) {
    if (!commercial) {
      return {
        [USER_CREDENTIAL_TYPES.INSURANCE]: buildRequirement(QUALIFICATION_LEVEL_NONE),
        [USER_CREDENTIAL_TYPES.THEORY]: buildRequirement(QUALIFICATION_LEVEL_NONE),
        [USER_CREDENTIAL_TYPES.CAAC]: buildRequirement(QUALIFICATION_LEVEL_NONE),
        [USER_CREDENTIAL_TYPES.OPERATION]: buildRequirement(QUALIFICATION_LEVEL_NONE)
      };
    }
    return {
      [USER_CREDENTIAL_TYPES.INSURANCE]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED),
      [USER_CREDENTIAL_TYPES.THEORY]: buildRequirement(QUALIFICATION_LEVEL_SUGGESTED),
      [USER_CREDENTIAL_TYPES.CAAC]: buildRequirement(QUALIFICATION_LEVEL_SUGGESTED),
      [USER_CREDENTIAL_TYPES.OPERATION]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED)
    };
  }

  if (aircraftClass === AIRCRAFT_CLASS_SMALL) {
    if (!commercial) {
      return {
        [USER_CREDENTIAL_TYPES.INSURANCE]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED),
        [USER_CREDENTIAL_TYPES.THEORY]: buildRequirement(QUALIFICATION_LEVEL_NONE),
        [USER_CREDENTIAL_TYPES.CAAC]: buildRequirement(QUALIFICATION_LEVEL_NONE),
        [USER_CREDENTIAL_TYPES.OPERATION]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED)
      };
    }
    return {
      [USER_CREDENTIAL_TYPES.INSURANCE]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED),
      [USER_CREDENTIAL_TYPES.THEORY]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED),
      [USER_CREDENTIAL_TYPES.CAAC]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED, "视距内 / 超视距"),
      [USER_CREDENTIAL_TYPES.OPERATION]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED)
    };
  }

  if (aircraftClass === AIRCRAFT_CLASS_MEDIUM || aircraftClass === AIRCRAFT_CLASS_LARGE) {
    return {
      [USER_CREDENTIAL_TYPES.INSURANCE]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED),
      [USER_CREDENTIAL_TYPES.THEORY]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED),
      [USER_CREDENTIAL_TYPES.CAAC]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED, "超视距"),
      [USER_CREDENTIAL_TYPES.OPERATION]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED)
    };
  }

  return {
    [USER_CREDENTIAL_TYPES.INSURANCE]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED),
    [USER_CREDENTIAL_TYPES.THEORY]: buildRequirement(QUALIFICATION_LEVEL_SUGGESTED),
    [USER_CREDENTIAL_TYPES.CAAC]: buildRequirement(QUALIFICATION_LEVEL_SUGGESTED),
    [USER_CREDENTIAL_TYPES.OPERATION]: buildRequirement(QUALIFICATION_LEVEL_REQUIRED)
  };
}

function resolveRequirementPassed(requirement = {}, credential = {}) {
  const level = requirement?.level || QUALIFICATION_LEVEL_NONE;
  if (level === QUALIFICATION_LEVEL_NONE || level === QUALIFICATION_LEVEL_SUGGESTED) {
    return true;
  }
  return !!credential?.bound;
}

function buildQualificationAssessment(options = {}) {
  const mode = options.mode === QUALIFICATION_MODE_COMMERCIAL
    ? QUALIFICATION_MODE_COMMERCIAL
    : QUALIFICATION_MODE_ENTERTAINMENT;
  const aircraftClass = resolveAircraftClassFromStaticModel({
    slug: options.droneSlug,
    name: options.droneName
  });
  const requirements = buildPolicyTemplate(aircraftClass, mode);
  const credentials = options.credentials || {};

  const items = {};
  let passed = true;
  Object.keys(requirements).forEach((type) => {
    const requirement = requirements[type];
    const credential = credentials[type] || {};
    const itemPassed = resolveRequirementPassed(requirement, credential);
    if (!itemPassed) passed = false;
    items[type] = {
      requirementLevel: requirement.level,
      requirementLabel: requirement.label,
      requirementDetail: requirement.detail,
      passed: itemPassed
    };
  });

  return {
    aircraftClass,
    aircraftClassLabel: AIRCRAFT_CLASS_LABELS[aircraftClass] || AIRCRAFT_CLASS_LABELS[AIRCRAFT_CLASS_LIGHT],
    mode,
    purposeLabel: mode === QUALIFICATION_MODE_COMMERCIAL ? "商业（经营性）" : "非商业（娱乐）",
    items,
    passed
  };
}

module.exports = {
  QUALIFICATION_MODE_ENTERTAINMENT,
  QUALIFICATION_MODE_COMMERCIAL,
  QUALIFICATION_LEVEL_NONE,
  QUALIFICATION_LEVEL_SUGGESTED,
  QUALIFICATION_LEVEL_REQUIRED,
  AIRCRAFT_CLASS_MICRO,
  AIRCRAFT_CLASS_LIGHT,
  AIRCRAFT_CLASS_SMALL,
  AIRCRAFT_CLASS_MEDIUM,
  AIRCRAFT_CLASS_LARGE,
  QUALIFICATION_LEVEL_LABELS,
  AIRCRAFT_CLASS_LABELS,
  resolveAircraftClassFromStaticModel,
  buildQualificationAssessment
};
