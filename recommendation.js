//
// * - Normalizes certificate goals (CNA/NAT synonyms)
// * - Computes recommended course(s) from the course index
// * - Handles CMA handoff rule
// */
//
const CNA_SYNONYMS = [
  "cna",
  "nat",
  "nursing assistant",
  "nursing assistant training",
  "certified nursing assistant",
];

function normalizeGoal(goal = "") {
    console.log("Recommendation logic has begun. . . ");
  const g = goal.toLowerCase().trim();
  if (CNA_SYNONYMS.some(s => g.includes(s))) {
    return "nursing assistant training";
  }
  console.log("CNA Synonyms loaded");
  return g;
}

function normalizeGoals(goals = []) {
  return [...new Set(goals.map(normalizeGoal))];
}

function isCMA(goals = []) {
  return goals.some(g => g.toLowerCase().includes("clinical medical assistant"));
}

/**
 * @param {Array<Object>} courseIndexRows
 * @param {Array<string>} certificateGoals
 * @returns {{ recommended: Array<Object>, normalizedGoals: Array<string> }}
 */
function recommendCourses(courseIndexRows, certificateGoals) {
  const normalizedGoals = normalizeGoals(certificateGoals);

  // CMA is explicitly not supported by the bot
  if (isCMA(normalizedGoals)) {
    return {
      recommended: [],
      normalizedGoals,
      requiresStaffHandoff: true,
    };
  }

  const goalSet = new Set(normalizedGoals);

  const includedSetForRow = (row) => {
    const included = String(row.certificates_included || "")
      .toLowerCase()
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
      .map(normalizeGoal); // apply same normalization (CNA/NAT etc.)

    return new Set(included);
  };

  const setsEqual = (a, b) => {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  };

  // 1) PERFECT MATCH: row cert set exactly equals selected goals set
  const perfectMatches = courseIndexRows.filter(row => {
    const incSet = includedSetForRow(row);
    return setsEqual(incSet, goalSet);
  });

  if (perfectMatches.length) {
    return { recommended: perfectMatches, normalizedGoals, matchType: "perfect" };
  }

  // 2) FALLBACK: overlap match (your existing behavior)
  const partialMatches = courseIndexRows.filter(row => {
    const incSet = includedSetForRow(row);
    for (const g of goalSet) {
      if (incSet.has(g)) return true;
    }
    return false;
  });

  // 3) If nothing matched, fall back to most comprehensive course (highest cert count)
  if (!partialMatches.length && courseIndexRows.length) {
    const sorted = [...courseIndexRows].sort((a, b) => {
      const aCount = String(a.certificates_included || "").split(",").filter(Boolean).length;
      const bCount = String(b.certificates_included || "").split(",").filter(Boolean).length;
      return bCount - aCount;
    });
    return { recommended: [sorted[0]], normalizedGoals, matchType: "fallback" };
  }

  return { recommended: partialMatches, normalizedGoals, matchType: "partial" };
}


module.exports = {
  normalizeGoals,
  recommendCourses,
};
console.log("Modules exported. . ." + "normalizeGoals" + "recommendCourses");
