const express = require("express");
const cors = require("cors");
require("dotenv").config();
const OpenAI = require("openai");

let google;
try {
  google = require("googleapis").google;
} catch (e) {
  google = null;
}

// New modules (Group A)
const { recommendCourses, normalizeGoals } = require("./recommendation");
const { selectBestTwo } = require("./schedules");
let wix;
try {
  wix = require("./wixConnection");
} catch (e) {
  wix = null;
}

const app = express();
const PORT = process.env.PORT || 3000;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// -----------------------------
// Knowledge Base (Google Drive)
// -----------------------------

const KB_CACHE_TTL_MS = Number(process.env.KB_CACHE_TTL_MS || 5 * 60 * 1000); // 5 minutes
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || "";
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";

const DEFAULT_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "ht", label: "Kreyòl Ayisyen" },
];

// Discount amount (compliance: always call it a "discount")
const PAY_IN_FULL_DISCOUNT_AMOUNT = Number(process.env.PAY_IN_FULL_DISCOUNT_AMOUNT || 200);
const DEFAULT_DOWN_PAYMENT_PERCENT = Number(process.env.DOWN_PAYMENT_PERCENT || 10);

// Env toggles
const ENABLE_WIX_SYNC = String(process.env.ENABLE_WIX_SYNC || "true").toLowerCase() === "true";
const ENABLE_WIX_SCHEDULES = String(process.env.ENABLE_WIX_SCHEDULES || "true").toLowerCase() === "true";

let kbCache = {
  loadedAt: 0,
  loading: null,
  docs: [],
  programs: [],
  courses: [],
  languages: DEFAULT_LANGUAGES,
  paymentIndex: [],
  source: "default",
  lastError: null,
};

// Helpers

function normalizeName(s = "") {
  return String(s).toLowerCase().trim();
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function norm(s = "") {
  return String(s).trim().toLowerCase();
}

function parseCSV(text = "") {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += ch;
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseBool(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  return ["true", "yes", "1", "y"].includes(s);
}

// end helpers :)

// -------- Course Index (CSV from Google Sheet export) --------
function parseCourseIndexFromCSV(csvText = "") {
  const rows = parseCSV(csvText).filter((r) => r.some((c) => String(c || "").trim().length));
  if (!rows.length) return [];
  console.log("Beginning logic for course index . . .")
  const header = rows[0].map((h) => norm(h));
  const idx = (name) => header.indexOf(norm(name));

  const iCode = idx("course_code");
  const iName = idx("course_name");
  const iCerts = idx("certificates_included");
  const iLink = idx("link");
  const iPriority = idx("priority");
  const iDiscount = idx("pif_discount_available");
  
  console.log("Course code used in Course Index" + iCode);

  if (iCode < 0 || iName < 0 || iCerts < 0) return [];

  const courses = [];
  for (const r of rows.slice(1)) {
    const course_code = (r[iCode] || "").trim();
    const course_name = (r[iName] || "").trim();
    const certRaw = (r[iCerts] || "").trim();
    if (!course_code || !course_name || !certRaw) continue;

    const certificates = certRaw
      .toLowerCase()
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    const link = iLink >= 0 ? (r[iLink] || "").trim() : "";
    const priority = iPriority >= 0 ? Number(String(r[iPriority] || "").trim()) : 999;
    const pif_discount_available = iDiscount >= 0 ? parseBool(r[iDiscount]) : false;

    courses.push({
      course_code,
      course_name,
      certificates_included: certificates, // normalized lower-case tokens
      link,
      priority: Number.isFinite(priority) ? priority : 999,
      pif_discount_available,
    });
    console.log("course index logic complete;" + courses);
  }
  return courses;
}

// -------- Payment Index (CSV from Google Sheet export) --------
function parsePaymentIndexFromCSV(csvText = "") {
  
  console.log("Beginning Payment Index Logic . . .");

  const rows = parseCSV(csvText).filter((r) => r.some((c) => String(c || "").trim().length));
  if (!rows.length) return [];

  const header = rows[0].map((h) => norm(h));
  const idx = (name) => header.indexOf(norm(name));

  const iCode = idx("course_code");
  const iTuition = idx("tuition_price");
  const iDiscount = idx("paidinfull_discountapplicable");
  const iPlanApplicable = idx("paymentplan_applicable");
  const iWeeks = idx("planlength_weeks");
  const iFreq = idx("frequency");
  const iOverride = idx("CUSTOM_OVERRIDE");

  console.log("Course code used in Payment Index" + iCode);
  
  // ovveride for plans deemed to complex for the AI
  if (iOverride == true) {
    console.log("Override detected; This is where I would begin override protocol but i'm not built out yet :)")
  }

  if (iCode < 0 || iTuition < 0 || iDiscount < 0 || iPlanApplicable < 0 || iWeeks < 0 || iFreq < 0) {
    return [];
  }

  const out = [];
  for (const r of rows.slice(1)) {
    const course_code = String(r[iCode] || "").trim();
    if (!course_code) continue;

    const tuitionPrice = Number(String(r[iTuition] || "").trim());
    if (!Number.isFinite(tuitionPrice) || tuitionPrice <= 0) continue;

    const discountApplicable = parseBool(r[iDiscount]);
    const paymentPlanApplicable = parseBool(r[iPlanApplicable]);
    const planLengthWeeks = Number(String(r[iWeeks] || "").trim());
    const frequency = String(r[iFreq] || "").trim().toLowerCase();

    out.push({
      course_code,
      tuitionPrice: Math.round(tuitionPrice),
      discountApplicable,
      paymentPlanApplicable,
      planLengthWeeks: Number.isFinite(planLengthWeeks) ? Math.round(planLengthWeeks) : 10,
      frequency: frequency === "biweekly" ? "biweekly" : "weekly",
    });
  }
  return out;
}

//pre-screening helpers

function parseProgramsFromText(text = "") {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[-*•\s]+/, "").trim());

  const looksCsv = lines.slice(0, 5).some((l) => l.includes(","));
  if (looksCsv) {
    const csvPrograms = [];
    for (const line of lines) {
      const firstCell = line.split(",")[0]?.replace(/^"|"$/g, "").trim();
      if (!firstCell) continue;
      if (normalizeName(firstCell) === "program" || normalizeName(firstCell) === "programs") continue;
      csvPrograms.push(firstCell);
    }
    return uniq(csvPrograms);
  }

  return uniq(lines);
}

function parseLanguagesFromText(text = "") {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[-*•\s]+/, "").trim());

  const parsed = [];
  for (const line of lines) {
    const parts = line.split("|").map((p) => p.trim());
    if (parts.length >= 2 && parts[0] && parts[1]) {
      parsed.push({ code: parts[0], label: parts[1] });
    }
  }
  return parsed.length ? parsed : DEFAULT_LANGUAGES;
}

//end pre-screening helpers

async function getDriveClient() {
  if (!google) throw new Error("googleapis is not installed. Run: npm install googleapis");
  if (!DRIVE_FOLDER_ID) throw new Error("Missing DRIVE_FOLDER_ID env var");
  if (!GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON env var");
  
  console.log("auth credentials exist, continuing with verification . . .");

  let credentials;
  try {
    credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch (e) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must be valid JSON (service account key file contents).");
  }
 
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  return google.drive({ version: "v3", auth });
}

async function listAllChildren(drive, folderId) {
  let files = [];
  let pageToken = undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken, files(id,name,mimeType,modifiedTime)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    files.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return files;
}

async function downloadText(drive, item) {
  const mime = item.mimeType || "";

  try {
    // Google Doc → export as plain text
    if (mime === "application/vnd.google-apps.document") {
      const res = await drive.files.export(
        { fileId: item.id, mimeType: "text/plain", supportsAllDrives: true },
        { responseType: "text" }
      );
      return typeof res.data === "string" ? res.data : "";
    }

    // Google Sheet → export as CSV
    if (mime === "application/vnd.google-apps.spreadsheet") {
      const res = await drive.files.export(
        { fileId: item.id, mimeType: "text/csv", supportsAllDrives: true },
        { responseType: "text" }
      );
      return typeof res.data === "string" ? res.data : "";
    }

    // Other files: attempt direct download
    const res = await drive.files.get(
      { fileId: item.id, alt: "media", supportsAllDrives: true },
      { responseType: "text" }
    );

    if (typeof res.data === "string") return res.data;
    // If API returns something else, stringify safely
    return JSON.stringify(res.data || "");
  } catch (err) {
    console.warn(`[KB] downloadText failed for "${item.name}" (${mime}):`, err?.message || err);
    return "";
  }
}


//idk what this function does
function inferProgramTagFromPath(pathParts) {
  const idx = pathParts.findIndex((p) => normalizeName(p) === "programs");
  if (idx >= 0 && pathParts[idx + 1]) return pathParts[idx + 1];
  return null;
}

async function walkFolder(drive, folderId, pathParts = []) {
  const children = await listAllChildren(drive, folderId);
  
  const docs = [];
  let trainingProgramsText = null;
  let courseIndexText = null;
  let languagesText = null;
  let paymentIndexText = null;

  console.log("Beginning folder walk procedure . . .");

  for (const item of children) {
    if (item.mimeType === "application/vnd.google-apps.folder") {
      const sub = await walkFolder(drive, item.id, [...pathParts, item.name]);
      docs.push(...sub.docs);

      if (sub.trainingProgramsText) trainingProgramsText = trainingProgramsText || sub.trainingProgramsText;
      if (sub.courseIndexText) courseIndexText = courseIndexText || sub.courseIndexText;
      if (sub.languagesText) languagesText = languagesText || sub.languagesText;
      if (sub.paymentIndexText) paymentIndexText = paymentIndexText || sub.paymentIndexText;
      continue;
    }

    const nameLower = normalizeName(item.name);

    const isTrainingProgramsList = nameLower.includes("programs");
    const isCourseIndex = nameLower.includes("chat agent - course index");
    const isLanguagesList = nameLower === "languages.txt" || nameLower === "languages.md" || nameLower.includes("languages");
    const isPaymentIndex = nameLower.includes("chat agent - payment index");

    const text = await downloadText(drive, item);

    if (isTrainingProgramsList) {
      trainingProgramsText = text;
    }
    if (isCourseIndex) {
      courseIndexText = text;
    }
    if (isLanguagesList) {
      languagesText = text;
    }
    if (isPaymentIndex) {
      paymentIndexText = text;
    }

    if (!text || !text.trim()) continue;

    const programTag = inferProgramTagFromPath(pathParts);
    docs.push({
      id: item.id,
      name: item.name,
      path: [...pathParts, item.name].join("/"),
      text,
      programTag,
      modifiedTime: item.modifiedTime,
    });
  }

  return { docs, trainingProgramsText, courseIndexText, languagesText, paymentIndexText };
}

async function loadKnowledgeBase({ force = false } = {}) {
  const now = Date.now();
  const isFresh = kbCache.loadedAt && now - kbCache.loadedAt < KB_CACHE_TTL_MS;

  if (!force && isFresh) return kbCache;
  if (kbCache.loading) return kbCache.loading;

  kbCache.loading = (async () => {
    try {
      if (!DRIVE_FOLDER_ID || !GOOGLE_SERVICE_ACCOUNT_JSON || !google) {
        kbCache = { ...kbCache, loadedAt: now, source: "default", lastError: null };
        return kbCache;
      }

      const drive = await getDriveClient();
      const { docs, trainingProgramsText, languagesText, courseIndexText, paymentIndexText } = await walkFolder(
        drive,
        DRIVE_FOLDER_ID,
        []
      );

      const programs = trainingProgramsText ? parseProgramsFromText(trainingProgramsText) : kbCache.programs;
      const courses = courseIndexText ? parseCourseIndexFromCSV(courseIndexText) : kbCache.courses;
      const languages = languagesText ? parseLanguagesFromText(languagesText) : kbCache.languages;
      const paymentIndex = paymentIndexText ? parsePaymentIndexFromCSV(paymentIndexText) : kbCache.paymentIndex;

      kbCache = {
        loadedAt: now,
        loading: null,
        docs,
        programs,
        courses,
        languages,
        paymentIndex,
        source: "google-drive",
        lastError: null,
      };

      return kbCache;
    } catch (err) {
      console.error("[KB] Failed to load knowledge base:", err);

      kbCache = {
        ...kbCache,
        loadedAt: now,
        loading: null,
        source: kbCache.source || "default",
        lastError: err.message || String(err),
      };

      return kbCache;
    } finally {
      kbCache.loading = null;
    }
  })();

  return kbCache.loading;
}

// -----------------------------
// Relevance extraction (simple)
// -----------------------------
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "else",
  "when",
  "where",
  "what",
  "who",
  "why",
  "how",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "from",
  "by",
  "with",
  "without",
  "about",
  "into",
  "over",
  "under",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "it",
  "them",
  "us",
  "my",
  "your",
  "our",
  "their",
  "this",
  "that",
  "these",
  "those",
  "as",
  "can",
  "could",
  "should",
  "would",
  "do",
  "does",
  "did",
  "will",
  "just",
  "please",
]);

function extractKeywords(text = "") {
  const words = (text.toLowerCase().match(/[a-z0-9_]+/g) || [])
    .filter((w) => w.length >= 3)
    .filter((w) => !STOPWORDS.has(w));

  return uniq(words).slice(0, 20);
}

function chunkText(text = "") {
  const paras = text
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter((p) => p.length >= 40);

  if (paras.length) return paras;

  return text
    .split(/(?<=[.!?])\s+/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 60);
}

function scoreChunk(chunkLower, keywords) {
  let score = 0;
  for (const k of keywords) {
    if (chunkLower.includes(k)) score += 1;
  }
  return score;
}

/**
 * Build KB context.
 * - Always includes docs that match course codes in title/path (course-code centric retrieval)
 * - Also includes general docs + relevant chunks based on user message
 */
function buildKnowledgeContext({ kb, message, certificateGoals, courseCodes }) {
  const docs = kb.docs || [];
  const msg = String(message || "");
  const keywords = extractKeywords(msg);
  const wantRelevant = keywords.length >= 2;

  const codes = (courseCodes || []).map((c) => String(c).toLowerCase());
  const goals = (certificateGoals || []).map((g) => String(g).toLowerCase());

  // General docs: FAQs, general, core, policies
  const generalDocs = docs.filter((d) => {
    const p = normalizeName(d.path || d.name);
    return (
      p.includes("Agreement") ||
      p.includes("Catalog") ||
      p.includes("Refund") ||
      p.includes("Enrollment") ||
      p.includes("About") ||
      p.includes("Basic") ||
      p.includes("info") ||
      p.includes("us") ||
      p.includes("Course") ||
      p.includes("policy") ||
      !d.programTag
    );
  });

  // Course-code docs: doc name/path contains NAT_101 etc.
  const courseDocs = codes.length
    ? docs.filter((d) => {
        const t = normalizeName(`${d.name} ${d.path}`);
        return codes.some((cc) => t.includes(cc));
      })
    : [];

  // If user is mid-chat with a goal but no codes (rare), include docs where goal appears.
  const goalDocs =
    !courseDocs.length && goals.length
      ? docs.filter((d) => {
          const t = normalizeName(`${d.name} ${d.path} ${d.text?.slice(0, 5000) || ""}`);
          return goals.some((g) => t.includes(g));
        })
      : [];

  const candidateDocs = uniq([...courseDocs, ...generalDocs, ...goalDocs]);

  const excerpts = [];
  const maxChunksTotal = 14;
  const maxChunksPerDoc = 3;

  for (const doc of candidateDocs) {
    if (excerpts.length >= maxChunksTotal) break;

    const chunks = chunkText(doc.text || "");
    if (!chunks.length) continue;

    if (!wantRelevant) {
      excerpts.push({ doc, chunk: chunks[0], score: 0 });
      continue;
    }

    const scored = chunks
      .map((c) => ({ c, s: scoreChunk(c.toLowerCase(), keywords) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, maxChunksPerDoc);

    for (const item of scored) {
      if (excerpts.length >= maxChunksTotal) break;
      excerpts.push({ doc, chunk: item.c, score: item.s });
    }
  }

  if (!excerpts.length) return "No knowledge base content available.";

  const grouped = new Map();
  for (const ex of excerpts) {
    const key = ex.doc.path || ex.doc.name;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(ex.chunk);
  }

  let out = "";
  for (const [docPath, chunks] of grouped.entries()) {
    out += `\n### ${docPath}\n`;
    for (const c of chunks) {
      const trimmed = c.length > 900 ? c.slice(0, 900) + "…" : c;
      out += `- ${trimmed.replace(/\n+/g, " ").trim()}\n`;
    }
  }

  return out.trim();
}

// -----------------------------
// Payments
// -----------------------------

function findPaymentRow(paymentIndex, courseCode) {
  const cc = String(courseCode || "").trim();
  return (paymentIndex || []).find((r) => String(r.course_code).trim() === cc) || null;
}

function formatMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function computePaymentPlan({ tuitionPrice, planLengthWeeks, frequency }) {
  const downPayment = Math.round((tuitionPrice * DEFAULT_DOWN_PAYMENT_PERCENT) / 100);
  const remaining = Math.max(0, tuitionPrice - downPayment);

  // weekly -> N payments, biweekly -> approx N/2 payments (ceil)
  const installments =
    frequency === "biweekly" ? Math.max(1, Math.ceil(planLengthWeeks / 2)) : Math.max(1, planLengthWeeks);

  const installmentAmount = Math.ceil(remaining / installments);

  return {
    downPayment,
    installments,
    installmentAmount,
    remaining,
  };
}

function buildPaymentBlock(paymentRow, courseMeta) {
  if (!paymentRow) {
    return `Payment info: Please ask staff for the current tuition and payment options for this course.`;
  }

  const tuition = paymentRow.tuitionPrice;
  const discountApplicable = !!paymentRow.discountApplicable || !!courseMeta?.pif_discount_available;
  const paymentPlanApplicable = !!paymentRow.paymentPlanApplicable;

  // Pay-in-full option
  const discountText = discountApplicable
    ? `Pay-in-full discount: ${formatMoney(PAY_IN_FULL_DISCOUNT_AMOUNT)} off tuition.`
    : `Pay-in-full: available.`;

  // Payment plan option (MAP excluded by sheet boolean)
  let planText = "Payment plan: not available for this course.";
  if (paymentPlanApplicable) {
    const plan = computePaymentPlan({
      tuitionPrice: tuition,
      planLengthWeeks: paymentRow.planLengthWeeks || 10,
      frequency: paymentRow.frequency || "weekly",
    });

    planText =
      `Payment plan: ${DEFAULT_DOWN_PAYMENT_PERCENT}% down (${formatMoney(plan.downPayment)}), then ` +
      `${plan.installments} ${paymentRow.frequency} payments of about ${formatMoney(plan.installmentAmount)}.`;
  }

  return [
    `Tuition: ${formatMoney(tuition)}`,
    discountText,
    planText,
    `Note: If cost is a barrier, we can use the payment plan (when available) so you can enroll sooner.`,
  ].join("\n");
}

// -----------------------------
// Prescreen validation
// -----------------------------


function validatePrescreen(prescreen) {
  if (!prescreen) return { ok: false, reason: "Missing prescreen." };
  const lead = prescreen.lead || {};
  const consent = prescreen.marketingConsent || {};
  const availabilityType = prescreen.availabilityType;

  if (!lead.fullName || !lead.phone || !lead.email) return { ok: false, reason: "Missing name/phone/email." };

  if (!availabilityType || !["daysOff", "noSetSchedule", "notWorking"].includes(availabilityType)) {
    return { ok: false, reason: "Missing availability selection." };
  }

  if (availabilityType === "daysOff") {
    const days = prescreen.daysOff;
    if (!Array.isArray(days) || !days.length) return { ok: false, reason: "Missing available days off." };
  }

  // consent: opt-in is optional, but metadata should exist (widget collects)
  if (!("optIn" in consent)) return { ok: false, reason: "Missing marketing consent field." };

  return { ok: true };
}

function buildScheduleBlock(scheduleOptions = []) {
  if (!scheduleOptions.length) {
    return `Schedule options: We’ll help you pick the best in-person session after you enroll.`;
  }

  const lines = scheduleOptions.map((o, i) => {
    const label = o.label ? `${o.label}: ` : "";
    const when = `${o.dayOfWeek || ""} ${o.startDate || ""} ${o.startTime || ""}-${o.endTime || ""}`.trim();
    const loc = o.location ? ` (${o.location})` : "";
    return `${i + 1}) ${label}${when}${loc}`;
  });

  return `Schedule options (best 2 matches):\n${lines.join("\n")}`;
}

// -----------------------------
// Routes
// -----------------------------

app.get("/health", async (req, res) => {
  const kb = await loadKnowledgeBase();
  res.json({ status: "ok", kbSource: kb.source, kbLoadedAt: kb.loadedAt, kbError: kb.lastError });
});

app.get("/config", async (req, res) => {
  const kb = await loadKnowledgeBase();
  res.json({
    languages: kb.languages && kb.languages.length ? kb.languages : DEFAULT_LANGUAGES,
    programs: kb.programs || [],
    kbSource: kb.source,
  });
});

app.get("/kb-status", async (req, res) => {
  const kb = await loadKnowledgeBase();
  res.json({
    source: kb.source,
    loadedAt: kb.loadedAt,
    docsCount: kb.docs.length,
    programsCount: kb.programs.length,
    paymentIndexCount: (kb.paymentIndex || []).length,
    lastError: kb.lastError,
    sampleDocs: kb.docs.slice(0, 5).map((d) => ({ name: d.name, path: d.path, programTag: d.programTag })),
  });
});

// AI Chat Route (new payload shape supported; backward compatible)
app.post("/chat", async (req, res) => {
  try {
    const body = req.body || {};
    const message = body.message;
    const language = body.prescreen?.language || body.language || "en";

    if (!message) return res.status(400).json({ error: "Missing 'message' in request body" });

    const prescreen = body.prescreen || null;
    const session = body.session || { sessionId: null, prescreenCompleted: false };

    // Backward compatibility: if old client sends programsSelected
    const oldProgramsSelected = Array.isArray(body.programsSelected) ? body.programsSelected : [];
    const certificateGoals = prescreen?.certificateGoals || oldProgramsSelected;

    // Require prescreen completion for live CRM sync and “specialist” behavior
    if (!session?.prescreenCompleted || !prescreen) {
      return res.json({
        reply:
          language === "es"
            ? "Por favor completa el formulario de pre-selección para que pueda recomendarte el mejor programa, horarios y opciones de pago."
            : "Please complete the pre-screening form so I can recommend the best program, schedule options, and payment plan.",
      });
    }

    const pv = validatePrescreen(prescreen);
    if (!pv.ok) {
      return res.json({
        reply:
          language === "es"
            ? "Parece que falta información en el formulario. Por favor revisa tu nombre, teléfono, correo y disponibilidad, y vuelve a intentarlo."
            : "It looks like some pre-screen info is missing. Please give me your name, phone, email, so we can try again.",
      });
    }

    const kb = await loadKnowledgeBase();

    // Normalize goals (CNA/NAT handling)
    const normalizedGoals = normalizeGoals(certificateGoals);

    // Recommend courses using updated course index structure
    const courseRows = (kb.courses || []).map((c) => ({
      course_code: c.course_code,
      course_name: c.course_name,
      certificates_included: c.certificates_included || c.certificates || [],
      priority: c.priority ?? 999,
      link: c.link || "",
      pif_discount_available: !!c.pif_discount_available,
    }));

    const rec = recommendCourses(courseRows, normalizedGoals);

    // CMA handoff
    if (rec.requiresStaffHandoff) {
      const handoffText =
        language === "es"
          ? "Gracias — el programa de Asistente Médico Clínico es un poco más complejo. Un asesor del curso te ayudará personalmente. ¿Prefieres llamada o mensaje de texto?"
          : "Thanks — Clinical Medical Assistant is a bit more complex. A course advisor will help you personally. Do you prefer a phone call or text message?";

      // Optional Wix sync (only after prescreen)
      if (ENABLE_WIX_SYNC && wix?.syncConversation) {
        try {
          await wix.syncConversation({
            sessionId: session.sessionId,
            lead: prescreen.lead,
            prescreen,
            messages: [
              { role: "user", text: String(message) },
              { role: "bot", text: handoffText },
            ],
          });
        } catch (e) {
          // non-fatal
          console.warn("[WIX] sync failed (handoff):", e?.message || e);
        }
      }

      return res.json({ reply: handoffText });
    }

    // Pick top recommendation (single course gameplan)
    const primary = (rec.recommended || [])[0] || null;

    const courseCodes = primary?.course_code ? [primary.course_code] : [];
    const courseMeta = primary || null;

    // Pull payment info (course-code keyed)
    const paymentRow = primary ? findPaymentRow(kb.paymentIndex, primary.course_code) : null;

    // Fetch schedule options from Wix (view-only), then select best 2
    let scheduleOptions = [];
    if (ENABLE_WIX_SCHEDULES && wix?.fetchScheduleOptions && primary?.course_code) {
      try {
        const resp = await wix.fetchScheduleOptions({
          courseCode: primary.course_code,
          availabilityType: prescreen.availabilityType,
          daysOff: prescreen.daysOff || [],
        });

        const options = Array.isArray(resp?.options) ? resp.options : [];
        scheduleOptions = selectBestTwo(options, {
          availabilityType: prescreen.availabilityType,
          daysOff: prescreen.daysOff || [],
        });
      } catch (e) {
        console.warn("[WIX] schedule fetch failed:", e?.message || e);
        scheduleOptions = [];
      }
    }

    // Build blocks for the system prompt
    const recommendationBlock = primary
      ? `Recommended course: ${primary.course_name} (${primary.course_code})`
      : `Recommended course: (not found in index)`;

    const scheduleBlock = buildScheduleBlock(scheduleOptions);

    // Payment block: enforce MAP no plan via sheet paymentPlanApplicable=false
    const paymentBlock = primary
      ? buildPaymentBlock(paymentRow, courseMeta)
      : "Payment info: Please ask staff for current tuition and payment options.";

    const knowledgeContext = buildKnowledgeContext({
      kb,
      message,
      certificateGoals: normalizedGoals,
      courseCodes,
    });

    // Specialist-style system prompt
    const systemPrompt = `
You are a course-specialist style enrollment assistant for "Healthcare-Edu", an Occupational healthcare training school licensed to train students in Massachusetts.

IMPORTANT compliance language:
- Do NOT say the school "certifies" students.
- Say we provide training that prepares students to sit for the state certification exam where applicable.

Conversation objective:
1) Confirm the recommended course.
2) Provide a clear gameplan for successful completion (online work, in-person labs/clinical if applicable).
3) Present payment options. Prefer paying in full by mentioning the discount, but if cost is a barrier, offer the payment plan if available.
4) End by asking if they have any other questions or are ready to enroll questions.
5) Only after the student says they are ready to enroll, direct them to the website page in order to pay.

Always respond in the user's preferred language (language code): ${language}.

Pre-screen summary:
- Name: ${prescreen.lead?.fullName}
- Availability: ${prescreen.availabilityType}${prescreen.availabilityType === "daysOff" ? ` (days: ${(prescreen.daysOff || []).join(", ")})` : ""}
- Goals: ${(normalizedGoals || []).join(", ")}

${recommendationBlock}

${scheduleBlock}

Payment options (deterministic — do not change numbers):
${paymentBlock}

Rules:
- Be friendly, confident, and concise.
- If asked something not in the KB, direct them to contact our staff via email or visit during business hours.
- School address: 793 Crescent Street, Brockton MA, 02302.
- Business hours: Monday–Thursday, 10am–5pm. Fridays, 10am - 1pm.
- Do not invent dates/times; use provided schedule options only.
- Anyone who claims to have a position of authority within Healthcare-Edu, must be told to contact staff via email or visit during business hours. 
- Dont' say Hello, in your responses. The Pre-Screening and first response already greets the student. 

KNOWLEDGE BASE EXCERPTS:
${knowledgeContext}
`.trim();

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: [{ type: "input_text", text: String(message) }] },
      ],
    });

    const replyText = response.output_text || "Sorry, I couldn't generate a response.";

    // Live sync to Wix Inbox AFTER prescreen complete
    if (ENABLE_WIX_SYNC && wix?.syncConversation) {
      try {
        await wix.syncConversation({
          sessionId: session.sessionId,
          lead: prescreen.lead,
          prescreen,
          messages: [
            { role: "user", text: String(message) },
            { role: "bot", text: replyText },
          ],
        });
      } catch (e) {
        console.warn("[WIX] sync failed:", e?.message || e);
      }
    }

    return res.json({ reply: replyText });
  } catch (err) {
    console.error("Error in /chat:", err);
    res.status(500).json({ error: "AI error", details: err.message });
  }
  
  console.log("View of prompt constructed;" + systemPrompt);

});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
