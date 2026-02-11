/**
 * schedules.js
 * - Filters and ranks schedule options
 * - Presents the BEST 2 options
 * - For no-set-schedule / not-working: returns the 2 soonest
 */

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

function rankBySoonest(options = []) {
  return options
    .map(o => ({ ...o, _dt: parseDateTime(o) }))
    .filter(o => o._dt)
    .sort((a, b) => a._dt - b._dt);
}

/**
 * @param {Array<Object>} options
 * @param {{ availabilityType: string, daysOff?: string[] }} availability
 * @returns {Array<Object>}
 */
function selectBestTwo(options, availability) {
  let filtered = options;

  if (availability.availabilityType === "daysOff" && Array.isArray(availability.daysOff)) {
    const days = availability.daysOff.map(d => d.toLowerCase());
    filtered = options.filter(o =>
      days.includes(String(o.dayOfWeek || "").toLowerCase())
    );
  }

  const ranked = rankBySoonest(filtered.length ? filtered : options);
  return ranked.slice(0, 2);
}

module.exports = {
  selectBestTwo,
};
console.log("Modules exported. . ." + "selectBestTwo");
