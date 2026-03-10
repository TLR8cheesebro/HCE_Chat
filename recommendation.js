/**
 * recommendation.js
 * - Normalizes certificate goals from widget labels + course index values
 * - Computes recommended course(s) from the course index
 * - Handles CMA handoff rule
 * - Greedy ranking:
 *    1) perfect match first
 *    2) otherwise highest overlap with requested goals
 *    3) then most certificates included
 *    4) then lowest numeric priority
 */

const SYNONYM_RULES = [
  {
    canonical: "nursing assistant training",
    matches: [
      "cna",
      "nat",
      "nursing assistant",
      "nursing assistant training",
      "certified nursing assistant",
    ],
  },
  {
    canonical: "home health aide",
    matches: [
      "hha",
      "home health aide",
    ],
  },
  {
    canonical: "medication administration program",
    matches: [
      "map",
      "medication administration",
      "medication administration program",
    ],
  },
  {
    canonical: "phlebotomy technician",
    matches: [
      "phleb",
      "phlebotomy",
      "phlebotomy technician",
    ],
  },
  {
    canonical: "ekg technician",
    matches: [
      "ekg",
      "ekg technician",
    ],
  },
  {
    canonical: "clinical medical assistant",
    matches: [
      "cma",
      "clinical medical assistant",
    ],
  },
];

function cleanLabel(value = "") {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\([^)]*\)/g, "")   // removes things like (CNA/NAT), (HHA), (MAP)
    .replace(/[\/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGoal(goal = "") {
  const raw = String(goal || "").toLowerCase().trim();
  const cleaned = cleanLabel(raw);

  for (const rule of SYNONYM_RULES) {
    if (rule.matches.some((m) => raw.includes(m) || cleaned.includes(m))) {
      return rule.canonical;
    }
  }

  return cleaned;
}

function normalizeGoals(goals = []) {
  return [...new Set((goals || []).map(normalizeGoal).filter(Boolean))];
}

function isCMA(goals = []) {
  return goals.some((g) => normalizeGoal(g) === "clinical medical assistant");
}

function normalizeCertificatesIncluded(row) {
  const raw = row?.certificates_included;

  if (Array.isArray(raw)) {
    return raw.map(normalizeGoal).filter(Boolean);
  }

  return String(raw || "")
    .split(",")
    .map((s) => normalizeGoal(s))
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

function stripMeta(row) {
  const { _meta, ...rest } = row;
  return rest;
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

  // Score EVERY course row
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
      if (a._meta.priority !== b._meta.priority) {
        return a._meta.priority - b._meta.priority;
      }
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

  // 2) GREEDY PARTIAL MATCHES
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

  // 3) NOTHING MATCHED -> most comprehensive fallback
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

module.exports = {
  normalizeGoals,
  recommendCourses,
};
console.log("Modules exported. . ." + "normalizeGoals" + "recommendCourses");
