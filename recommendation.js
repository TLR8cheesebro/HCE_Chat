/**
 * recommendation.js
 * - Normalizes certificate goals (CNA/NAT synonyms)
 * - Computes recommended course(s) from the course index
 * - Handles CMA handoff rule
 * - Greedy ranking:
 *    1) perfect match first
 *    2) otherwise highest overlap with requested goals
 *    3) then most certificates included
 *    4) then lowest numeric priority
 */

const CNA_SYNONYMS = [
  "cna",
  "nat",
  "nursing assistant",
  "nursing assistant training",
  "certified nursing assistant",
];

function normalizeGoal(goal = "") {
  const g = String(goal || "").toLowerCase().trim();

  if (CNA_SYNONYMS.some((s) => g.includes(s))) {
    return "nursing assistant training";
  }

  return g;
}

function normalizeGoals(goals = []) {
  return [...new Set((goals || []).map(normalizeGoal).filter(Boolean))];
}

function isCMA(goals = []) {
  return goals.some((g) => String(g).toLowerCase().includes("clinical medical assistant"));
}

function normalizeCertificatesIncluded(row) {
  const raw = row?.certificates_included;

  if (Array.isArray(raw)) {
    return raw.map(normalizeGoal).filter(Boolean);
  }

  return String(raw || "")
    .split(",")
    .map((s) => normalizeGoal(s.trim()))
    .filter(Boolean);
}

function countOverlap(goalSet, includedSet) {
  let count = 0;
  for (const g of goalSet) {
    if (includedSet.has(g)) count += 1;
  }
  return count;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

function safePriority(row) {
  const p = Number(row?.priority);
  return Number.isFinite(p) ? p : 999999;
}

/**
 * @param {Array<Object>} courseIndexRows
 * @param {Array<string>} certificateGoals
 * @returns {{
 *   recommended: Array<Object>,
 *   normalizedGoals: Array<string>,
 *   requiresStaffHandoff?: boolean,
 *   matchType?: string
 * }}
 */
function recommendCourses(courseIndexRows = [], certificateGoals = []) {
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

  // Build scored view of EVERY course row
  const scored = (courseIndexRows || []).map((row) => {
    const included = normalizeCertificatesIncluded(row);
    const includedSet = new Set(included);

    const overlapCount = countOverlap(goalSet, includedSet);
    const certificateCount = includedSet.size;
    const perfectMatch = setsEqual(goalSet, includedSet);

    return {
      ...row,
      _meta: {
        overlapCount,
        certificateCount,
        perfectMatch,
        priority: safePriority(row),
      },
    };
  });

  // 1) PERFECT MATCHES ONLY
  const perfectMatches = scored
    .filter((row) => row._meta.perfectMatch)
    .sort((a, b) => {
      // if multiple perfect matches exist, prefer lower priority first
      if (a._meta.priority !== b._meta.priority) {
        return a._meta.priority - b._meta.priority;
      }
      // then prefer more certificates (usually equal for perfect, but safe)
      if (a._meta.certificateCount !== b._meta.certificateCount) {
        return b._meta.certificateCount - a._meta.certificateCount;
      }
      return String(a.course_code || "").localeCompare(String(b.course_code || ""));
    });

  if (perfectMatches.length) {
    return {
      recommended: perfectMatches.map(stripMeta),
      normalizedGoals,
      matchType: "perfect",
    };
  }

  // 2) GREEDY FALLBACK:
  //    - highest overlap with requested goals
  //    - then most certificates included
  //    - then lowest priority
  const ranked = scored
    .filter((row) => row._meta.overlapCount > 0)
    .sort((a, b) => {
      if (a._meta.overlapCount !== b._meta.overlapCount) {
        return b._meta.overlapCount - a._meta.overlapCount;
      }
      if (a._meta.certificateCount !== b._meta.certificateCount) {
        return b._meta.certificateCount - a._meta.certificateCount;
      }
      if (a._meta.priority !== b._meta.priority) {
        return a._meta.priority - b._meta.priority;
      }
      return String(a.course_code || "").localeCompare(String(b.course_code || ""));
    });

  if (ranked.length) {
    return {
      recommended: ranked.map(stripMeta),
      normalizedGoals,
      matchType: "partial",
    };
  }

  // 3) NOTHING MATCHED:
  //    choose the most comprehensive course, then priority
  const fallback = [...scored].sort((a, b) => {
    if (a._meta.certificateCount !== b._meta.certificateCount) {
      return b._meta.certificateCount - a._meta.certificateCount;
    }
    if (a._meta.priority !== b._meta.priority) {
      return a._meta.priority - b._meta.priority;
    }
    return String(a.course_code || "").localeCompare(String(b.course_code || ""));
  });

  return {
    recommended: fallback.length ? [stripMeta(fallback[0])] : [],
    normalizedGoals,
    matchType: "fallback",
  };
}

function stripMeta(row) {
  const { _meta, ...rest } = row;
  return rest;
}

module.exports = {
  normalizeGoals,
  recommendCourses,
};
console.log("Modules exported. . ." + "normalizeGoals" + "recommendCourses");
