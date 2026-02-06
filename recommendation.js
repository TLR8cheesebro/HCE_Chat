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

  // Greedy: recommend courses whose certificates_included overlap goals
  const matches = courseIndexRows.filter(row => {
    const included = String(row.certificates_included || "")
      .toLowerCase()
      .split(",")
      .map(s => s.trim());
    return normalizedGoals.some(g => included.includes(g));
  });

  // If nothing matched, fall back to most comprehensive course (highest cert count)
  if (!matches.length && courseIndexRows.length) {
    const sorted = [...courseIndexRows].sort((a, b) => {
      const aCount = String(a.certificates_included || "").split(",").length;
      const bCount = String(b.certificates_included || "").split(",").length;
      return bCount - aCount;
    });
    return { recommended: [sorted[0]], normalizedGoals };
  }

  return { recommended: matches, normalizedGoals };
}


module.exports = {
  normalizeGoals,
  recommendCourses,
};
console.log("Modules exported. . ." + "normalizeGoals" + "recommendCourses");
