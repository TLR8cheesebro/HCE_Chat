/**
 * recommendation.js
 * - Normalizes certificate goals from widget labels + course index values
 * - Computes recommended course(s) from the course index
 * - Handles CMA handoff rule
 * - Perfect matches always win and return immediately
 * - Otherwise greedy ranking:
 *    1) highest overlap with requested goals
 *    2) most certificates included
 *    3) lowest numeric priority
 */

const CANONICAL_MAP = new Map([
  ["cna", "nursing assistant training"],
  ["nat", "nursing assistant training"],
  ["nursing assistant", "nursing assistant training"],
  ["nursing assistant training", "nursing assistant training"],
  ["certified nursing assistant", "nursing assistant training"],

  ["hha", "home health aide"],
  ["home health aide", "home health aide"],
  ["home health aide training", "home health aide"],
  ["home health aide training program", "home health aide"],

   // MAP
  ["map", "medication administration program"],
  ["medication administration", "medication administration program"],
  ["medication administration program", "medication administration program"],
  ["medication admin", "medication administration program"],
  ["medication admin.", "medication administration program"],
  ["medication admin program", "medication administration program"],
  ["medication admin. program", "medication administration program"],
  ["med. admin. program", "med admin program"],
  ["medication admin program", "med admin. program"],

  ["phleb", "phlebotomy technician"],
  ["phlebotomy", "phlebotomy technician"],
  ["phlebotomy technician", "phlebotomy technician"],
  ["phlebotomy technician training", "phlebotomy technician"],
  ["phlebotomy technician training program", "phlebotomy technician"],

  ["ekg", "ekg technician"],
  ["ekg technician", "ekg technician"],
  ["ekg technician training", "ekg technician"],
  ["ekg technician training program", "ekg technician"],

  ["cma", "clinical medical assistant"],
  ["clinical medical assistant", "clinical medical assistant"],
  ["clinical medical assistant training", "clinical medical assistant"],
  ["clinical medical assistant training program", "clinical medical assistant"],
]);

function cleanLabel(value = "") {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\([^)]*\)/g, "") // remove things like (CNA/NAT), (HHA), (MAP)
    .replace(/[\/_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\btraining program\b/g, "")
    .replace(/\btraining\b/g, "")
    .replace(/\bprogram\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGoal(goal = "") {
  const raw = String(goal || "").toLowerCase().trim();
  const cleaned = cleanLabel(raw);

  if (CANONICAL_MAP.has(raw)) return CANONICAL_MAP.get(raw);
  if (CANONICAL_MAP.has(cleaned)) return CANONICAL_MAP.get(cleaned);

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

function isSingleProgram(row) {
  return (row?._meta?.certificateCount || 0) === 1;
}

function isComboProgram(row) {
  return (row?._meta?.certificateCount || 0) > 1;
}

function isCmaProgramRow(row) {
  const included = row?._meta?.included || [];
  return included.includes("clinical medical assistant");
}

function baseSort(a, b) {
  if (a._meta.priority !== b._meta.priority) {
    return a._meta.priority - b._meta.priority;
  }
  return String(a.course_code || "").localeCompare(String(b.course_code || ""));
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

  // CMA is explicitly not supported by the bot if user selected it
  if (isCMA(normalizedGoals)) {
    return {
      recommended: [],
      normalizedGoals,
      requiresStaffHandoff: true,
    };
  }

  const goalSet = new Set(normalizedGoals);
  const selectedGoalCount = goalSet.size;

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
        included,
        overlapCount,
        certificateCount,
        perfectMatch,
        priority: safePriority(row),
      },
    };
  });

  // Exclude CMA rows from all normal recommendation paths
  const nonCmaRows = scored.filter((row) => !isCmaProgramRow(row));

  // 1) PERFECT MATCHES WIN IMMEDIATELY
  const perfectMatches = nonCmaRows
    .filter((row) => row._meta.perfectMatch)
    .sort(baseSort);

  if (perfectMatches.length) {
    return {
      recommended: perfectMatches.map(stripMeta),
      normalizedGoals,
      matchType: "perfect",
    };
  }

  // 2) If no perfect match exists:
  // For 2 or 3 selected goals, prefer SINGLE-PROGRAM fallback
  if (selectedGoalCount >= 2 && selectedGoalCount <= 3) {
    const singleProgramMatches = nonCmaRows
      .filter((row) => row._meta.overlapCount > 0)
      .filter((row) => isSingleProgram(row))
      .sort((a, b) => {
        // For single-program fallback:
        // first choose lowest priority, then alphabetical tiebreak
        return baseSort(a, b);
      });

    if (singleProgramMatches.length) {
      return {
        recommended: singleProgramMatches.map(stripMeta),
        normalizedGoals,
        matchType: "single-fallback",
      };
    }

    // If somehow no single-program rows overlap, use combo fallback as backup
    const comboFallback = nonCmaRows
      .filter((row) => row._meta.overlapCount > 0)
      .sort((a, b) => {
        if (a._meta.overlapCount !== b._meta.overlapCount) {
          return b._meta.overlapCount - a._meta.overlapCount;
        }
        if (a._meta.certificateCount !== b._meta.certificateCount) {
          return b._meta.certificateCount - a._meta.certificateCount;
        }
        return baseSort(a, b);
      });

    if (comboFallback.length) {
      return {
        recommended: comboFallback.map(stripMeta),
        normalizedGoals,
        matchType: "partial-combo-fallback",
      };
    }
  }

  // 3) For 4+ selected goals, allow broader combo fallback
  if (selectedGoalCount >= 4) {
    const ranked = nonCmaRows
      .filter((row) => row._meta.overlapCount > 0)
      .sort((a, b) => {
        if (a._meta.overlapCount !== b._meta.overlapCount) {
          return b._meta.overlapCount - a._meta.overlapCount;
        }
        if (a._meta.certificateCount !== b._meta.certificateCount) {
          return b._meta.certificateCount - a._meta.certificateCount;
        }
        return baseSort(a, b);
      });

    if (ranked.length) {
      return {
        recommended: ranked.map(stripMeta),
        normalizedGoals,
        matchType: "partial",
      };
    }
  }

  // 4) For 1 selected goal with no perfect match, prefer single-program overlap first
  if (selectedGoalCount === 1) {
    const singleGoalFallback = nonCmaRows
      .filter((row) => row._meta.overlapCount > 0)
      .sort((a, b) => {
        // smaller, simpler programs should win here
        if (a._meta.certificateCount !== b._meta.certificateCount) {
          return a._meta.certificateCount - b._meta.certificateCount;
        }
        return baseSort(a, b);
      });

    if (singleGoalFallback.length) {
      return {
        recommended: singleGoalFallback.map(stripMeta),
        normalizedGoals,
        matchType: "single-goal-fallback",
      };
    }
  }

  // 5) Last-resort fallback:
  // prefer non-CMA single-programs first, then broader non-CMA rows
  const fallback = [...nonCmaRows].sort((a, b) => {
    const aSingle = isSingleProgram(a) ? 0 : 1;
    const bSingle = isSingleProgram(b) ? 0 : 1;
    if (aSingle !== bSingle) return aSingle - bSingle;

    if (a._meta.certificateCount !== b._meta.certificateCount) {
      return a._meta.certificateCount - b._meta.certificateCount;
    }

    return baseSort(a, b);
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
