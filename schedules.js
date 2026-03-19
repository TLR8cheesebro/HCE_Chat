/**
 * schedules.js
 * - Keeps all schedule entries in rank order
 * - Recommends the best 2 first
 * - Preserves alternates and day-specific groups for follow-up questions
 */

const DAY_ALIASES = {
  sun: ["sun", "sunday", "sundays"],
  mon: ["mon", "monday", "mondays"],
  tue: ["tue", "tues", "tuesday", "tuesdays"],
  wed: ["wed", "wednesday", "wednesdays"],
  thu: ["thu", "thur", "thurs", "thursday", "thursdays"],
  fri: ["fri", "friday", "fridays"],
  sat: ["sat", "saturday", "saturdays"],
};

function parseDateTime(opt) {
  // Prefer ISO datetime if provided by Wix
  if (opt.startDateTimeISO) {
    const d = new Date(opt.startDateTimeISO);
    return isNaN(d.getTime()) ? null : d;
  }

  // Fallback
  const d = new Date(`${opt.startDate}T${opt.startTime}`);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeDayValue(day = "") {
  const lower = String(day || "").trim().toLowerCase();
  if (!lower) return "";

  for (const [key, aliases] of Object.entries(DAY_ALIASES)) {
    if (aliases.some((alias) => lower === alias || lower.includes(alias))) {
      return key;
    }
  }

  return lower.slice(0, 3);
}

function keyForOption(opt = {}) {
  return String(
    opt.wixItemId ||
      opt.startDateTimeISO ||
      `${opt.label || ""}|${opt.dayOfWeek || ""}|${opt.startDate || ""}|${opt.startTime || ""}`
  );
}

function stripRankFields(opt = {}) {
  const { _dt, ...rest } = opt;
  return rest;
}

function rankBySoonest(options = []) {
  return options
    .map((o) => ({ ...o, _dt: parseDateTime(o) }))
    .filter((o) => o._dt)
    .sort((a, b) => a._dt - b._dt);
}

function filterByAvailability(options = [], availability = {}) {
  if (availability?.availabilityType !== "daysOff" || !Array.isArray(availability?.daysOff)) {
    return options;
  }

  const days = availability.daysOff.map((d) => normalizeDayValue(d)).filter(Boolean);
  if (!days.length) return options;

  return options.filter((o) => days.includes(normalizeDayValue(o.dayOfWeek || "")));
}

function groupOptionsByDay(options = []) {
  return options.reduce((acc, opt) => {
    const dayKey = normalizeDayValue(opt.dayOfWeek || "");
    if (!dayKey) return acc;
    if (!acc[dayKey]) acc[dayKey] = [];
    acc[dayKey].push(opt);
    return acc;
  }, {});
}

/**
 * @param {Array<Object>} options
 * @param {{ availabilityType: string, daysOff?: string[] }} availability
 * @param {number} recommendationCount
 * @returns {{
 *   allOptions: Array<Object>,
 *   rankedAllOptions: Array<Object>,
 *   filteredOptions: Array<Object>,
 *   rankedOptions: Array<Object>,
 *   recommendedTop2: Array<Object>,
 *   alternates: Array<Object>,
 *   groupedByDay: Record<string, Array<Object>>
 * }}
 */
function buildSchedulePlan(options = [], availability = {}, recommendationCount = 2) {
  const rankedAllOptions = rankBySoonest(options).map(stripRankFields);
  const availabilityFiltered = filterByAvailability(options, availability);
  const rankedOptions = rankBySoonest(availabilityFiltered.length ? availabilityFiltered : options).map(stripRankFields);

  return {
    allOptions: options,
    rankedAllOptions,
    filteredOptions: availabilityFiltered.length ? availabilityFiltered : options,
    rankedOptions,
    recommendedTop2: rankedOptions.slice(0, recommendationCount),
    alternates: rankedOptions.slice(recommendationCount),
    groupedByDay: groupOptionsByDay(rankedAllOptions),
  };
}

function selectBestTwo(options, availability) {
  return buildSchedulePlan(options, availability).recommendedTop2;
}

function detectRequestedDay(text = "") {
  const lower = String(text || "").toLowerCase();
  if (!lower) return "";

  for (const [key, aliases] of Object.entries(DAY_ALIASES)) {
    const matched = aliases.some((alias) => new RegExp(`\\b${alias}\\b`, "i").test(lower));
    if (matched) return key;
  }

  return "";
}

function isScheduleDetailRequest(text = "") {
  const lower = String(text || "").toLowerCase();
  if (!lower) return false;

  const detailPhrases = [
    "full schedule",
    "full lab",
    "full session",
    "all dates",
    "lab dates",
    "lab days",
    "what are the dates",
    "which dates",
    "what days",
    "give me the full",
    "entire schedule",
    "whole schedule",
    "four lab",
    "share lab schedule",
    "share exact schedule",
    "exact schedule",
    "all of the schedule",
    "complete schedule",
    "practical lab schedule",
    "practical lab days"
  ];

  if (detailPhrases.some((phrase) => lower.includes(phrase))) return true;

  const requestedDay = detectRequestedDay(lower);
  if (requestedDay && (lower.includes("schedule") || lower.includes("labs") || lower.includes("dates"))) {
    return true;
  }

  return false;
}

function isAlternateScheduleRequest(text = "") {
  const lower = String(text || "").toLowerCase();
  if (!lower) return false;

  const phrases = [
    "those don't work",
    "those dont work",
    "these don't work",
    "these dont work",
    "none of those",
    "another option",
    "another schedule",
    "other options",
    "more options",
    "different option",
    "different schedule",
    "what else",
    "anything else",
    "show me more",
    "other times",
  ];

  if (phrases.some((phrase) => lower.includes(phrase))) return true;

  const requestedDay = detectRequestedDay(lower);
  if (requestedDay && (lower.includes("other") || lower.includes("another") || lower.includes("more"))) {
    return true;
  }

  return false;
}

module.exports = {
  buildSchedulePlan,
  selectBestTwo,
  rankBySoonest,
  keyForOption,
  normalizeDayValue,
  detectRequestedDay,
  isScheduleDetailRequest,
  isAlternateScheduleRequest,
};
console.log("Modules exported. . ." + "buildSchedulePlan" + "selectBestTwo");
