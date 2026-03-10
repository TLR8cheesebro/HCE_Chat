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

  ["map", "medication administration program"],
  ["medication administration", "medication administration program"],
  ["medication administration program", "medication administration program"],

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
    .replace(/\([^)]*\)/g, "")        // remove abbreviations in parentheses
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

function recommendCourses(courseIndexRows = [], certificateGoals = []) {
  const normalizedGoals = normalizeGoals(certificateGoals);

  if (isCMA(normalizedGoals)) {
    return {
      recommended: [],
      normalizedGoals,
      requiresStaffHandoff: true,
    };
  }

  const goalSet = new Set(normalizedGoals);

  const scored = (courseIndexRows || []).map((row) => {
    const included = normalizeCertificatesIncluded(row);
    const includedSet = new Set(included);

    const overlapCount = countOverlap(goalSet, includedSet);
    const certificateCount = includedSet.size;

    // exact perfect-match definition:
    // same normalized certificate set, no extras, no missing certs
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

  // PERFECT MATCHES WIN IMMEDIATELY
  const perfectMatches = scored
    .filter((row) => row._meta.perfectMatch)
    .sort((a, b) => {
      if (a._meta.priority !== b._meta.priority) {
        return a._meta.priority - b._meta.priority;
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

  // Only if no perfect match exists, use greedy fallback
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
