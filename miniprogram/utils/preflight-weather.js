const {
  AIRCRAFT_CLASS_MICRO,
  AIRCRAFT_CLASS_LIGHT,
  AIRCRAFT_CLASS_SMALL,
  AIRCRAFT_CLASS_MEDIUM,
  AIRCRAFT_CLASS_LARGE
} = require("./preflight-qualification");

const WEATHER_RISK_SAFE = "safe";
const WEATHER_RISK_CAUTION = "caution";
const WEATHER_RISK_DANGER = "danger";

const WIND_LIMITS = {
  [AIRCRAFT_CLASS_MICRO]: { caution: 5.5, danger: 8.5 },
  [AIRCRAFT_CLASS_LIGHT]: { caution: 7.5, danger: 10.8 },
  [AIRCRAFT_CLASS_SMALL]: { caution: 9.5, danger: 13.8 },
  [AIRCRAFT_CLASS_MEDIUM]: { caution: 12.0, danger: 17.2 },
  [AIRCRAFT_CLASS_LARGE]: { caution: 15.0, danger: 20.8 }
};

function normalizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getWindLimits(aircraftClass = AIRCRAFT_CLASS_LIGHT) {
  return WIND_LIMITS[aircraftClass] || WIND_LIMITS[AIRCRAFT_CLASS_LIGHT];
}

function pushReason(list = [], text = "") {
  const value = `${text || ""}`.trim();
  if (!value) return;
  if (!list.includes(value)) list.push(value);
}

function resolveSeverityTitle(severity = WEATHER_RISK_SAFE) {
  if (severity === WEATHER_RISK_DANGER) return "风险飞行";
  if (severity === WEATHER_RISK_CAUTION) return "谨慎飞行";
  return "适宜飞行";
}

function buildSafeReason() {
  return "当前天气条件适合飞行";
}

function bumpSeverity(current, next) {
  const weight = {
    [WEATHER_RISK_SAFE]: 0,
    [WEATHER_RISK_CAUTION]: 1,
    [WEATHER_RISK_DANGER]: 2
  };
  return (weight[next] || 0) > (weight[current] || 0) ? next : current;
}

function evaluateWind(severity, reasons, slot = {}, aircraftClass = AIRCRAFT_CLASS_LIGHT) {
  const wind = normalizeNumber(slot.windSpeedValue);
  if (wind === null) return severity;

  const limits = getWindLimits(aircraftClass);
  if (wind >= limits.danger) {
    pushReason(reasons, "当前风速过大，不建议飞行");
    return bumpSeverity(severity, WEATHER_RISK_DANGER);
  }
  if (wind >= limits.caution) {
    pushReason(reasons, "当前风速偏高，请谨慎飞行");
    return bumpSeverity(severity, WEATHER_RISK_CAUTION);
  }
  return severity;
}

function evaluateWeatherPhenomena(severity, reasons, slot = {}) {
  const iconName = `${slot.iconName || ""}`.trim();
  if (["strong-convective", "thunderstorm", "hail"].includes(iconName)) {
    pushReason(reasons, "当前天气不适合无人机飞行");
    return bumpSeverity(severity, WEATHER_RISK_DANGER);
  }
  if (["heavy-rain", "heavy-snow", "moderate-snow"].includes(iconName)) {
    pushReason(reasons, "当前降水或降雪会明显影响飞行安全");
    return bumpSeverity(severity, WEATHER_RISK_DANGER);
  }
  if (["moderate-rain", "showers", "snow-showers", "light-snow", "fog"].includes(iconName)) {
    pushReason(reasons, "当前天气会影响姿态控制和视距");
    return bumpSeverity(severity, WEATHER_RISK_CAUTION);
  }
  return severity;
}

function evaluateVisibility(severity, reasons, slot = {}) {
  const visibility = normalizeNumber(slot.visibilityValue);
  if (visibility === null) return severity;

  if (visibility < 1000) {
    pushReason(reasons, "当前能见度过低，不建议飞行");
    return bumpSeverity(severity, WEATHER_RISK_DANGER);
  }
  if (visibility < 3000) {
    pushReason(reasons, "当前能见度偏低，请谨慎飞行");
    return bumpSeverity(severity, WEATHER_RISK_CAUTION);
  }
  return severity;
}

function evaluatePrecipitation(severity, reasons, slot = {}) {
  const probability = normalizeNumber(slot.precipitationProbabilityValue);
  const precipitation = normalizeNumber(slot.precipitationValue);
  const rain = normalizeNumber(slot.rainValue);
  const showers = normalizeNumber(slot.showersValue);
  const snowfall = normalizeNumber(slot.snowfallValue);
  const actual = Math.max(
    precipitation || 0,
    rain || 0,
    showers || 0,
    snowfall || 0
  );

  if (actual >= 1.2) {
    pushReason(reasons, "当前降水较强，不建议飞行");
    return bumpSeverity(severity, WEATHER_RISK_DANGER);
  }
  if (actual > 0 || (probability !== null && probability >= 60)) {
    pushReason(reasons, "存在降水影响，请谨慎飞行");
    return bumpSeverity(severity, WEATHER_RISK_CAUTION);
  }
  return severity;
}

function buildPreflightWeatherAssessment(slot = {}, aircraftClass = AIRCRAFT_CLASS_LIGHT) {
  if (!slot || typeof slot !== "object") {
    return {
      level: WEATHER_RISK_CAUTION,
      title: "谨慎飞行",
      reason: "气象数据加载中",
      reasons: ["气象数据加载中"]
    };
  }

  const reasons = [];
  let severity = WEATHER_RISK_SAFE;
  severity = evaluateWind(severity, reasons, slot, aircraftClass);
  severity = evaluateWeatherPhenomena(severity, reasons, slot);
  severity = evaluateVisibility(severity, reasons, slot);
  severity = evaluatePrecipitation(severity, reasons, slot);

  if (!reasons.length) pushReason(reasons, buildSafeReason());

  return {
    level: severity,
    title: resolveSeverityTitle(severity),
    reason: reasons[0] || buildSafeReason(),
    reasons
  };
}

module.exports = {
  WEATHER_RISK_SAFE,
  WEATHER_RISK_CAUTION,
  WEATHER_RISK_DANGER,
  buildPreflightWeatherAssessment
};
