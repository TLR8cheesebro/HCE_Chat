const express = require("express");
const cors = require("cors");
require("dotenv").config();
const OpenAI = require("openai");

// Optional Google Drive knowledge base integration
let google;
try {
  // Only required if you enable Google Drive KB
  google = require("googleapis").google;
} catch (e) {
  google = null;
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

// You can tune these in Render env vars
const KB_CACHE_TTL_MS = Number(process.env.KB_CACHE_TTL_MS || 5 * 60 * 1000); // 5 minutes
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || "";
const GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";

// Fallback config if Drive is not configured
const DEFAULT_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "ht", label: "Kreyòl Ayisyen" },
];

let kbCache = {
  loadedAt: 0,
  loading: null, // promise
  // docs: [{ id, name, path, text, programTag, modifiedTime }]
  docs: [],
  programs: [],
  courses: [],
  languages: DEFAULT_LANGUAGES,
  source: "default",
  lastError: null,
};

function normalizeName(s = "") {
  return String(s).toLowerCase().trim();
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function parseCSV(text = "") {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"' && inQuotes && next === '"') { cell += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }

    if (ch === "," && !inQuotes) { row.push(cell); cell = ""; continue; }

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

  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function norm(s = "") { return String(s).trim().toLowerCase(); }

function parseCourseIndexFromCSV(csvText = "") {
  const rows = parseCSV(csvText).filter(r => r.some(c => String(c || "").trim().length));
  if (!rows.length) return [];

  const header = rows[0].map(h => norm(h));
  const idx = (name) => header.indexOf(norm(name));

  const iCode = idx("course_code");
  const iName = idx("course_name");
  const iCerts = idx("certificates_included");
  const iLink = idx("link");
  const iPriority = idx("priority");

  if (iCode < 0 || iName < 0 || iCerts < 0) return [];

  const courses = [];
  for (const r of rows.slice(1)) {
    const course_code = (r[iCode] || "").trim();
    const course_name = (r[iName] || "").trim();
    const certRaw = (r[iCerts] || "").trim();
    if (!course_code || !course_name || !certRaw) continue;

    const certificates = certRaw.split(",").map(x => x.trim()).filter(Boolean);
    const link = iLink >= 0 ? (r[iLink] || "").trim() : "";
    const priority = iPriority >= 0 ? Number(String(r[iPriority] || "").trim()) : 999;

    courses.push({
      course_code,
      course_name,
      certificates,
      link,
      priority: Number.isFinite(priority) ? priority : 999,
    });
  }
  return courses;
}

function recommendCourses(selectedCerts = [], courses = [], maxCourses = 3) {
  const selected = (selectedCerts || [])
    .map(s => String(s).trim())
    .filter(Boolean)
    .filter(s => norm(s) !== "not sure yet");

  const selectedSet = new Set(selected.map(norm));
  if (!selectedSet.size || !courses.length) return [];

  // 1) Perfect match: covers all selected certs
  const perfect = courses
    .map(c => {
      const certSet = new Set((c.certificates || []).map(norm));
      const all = [...selectedSet].every(x => certSet.has(x));
      const overlap = [...selectedSet].filter(x => certSet.has(x)).length;
      return { c, all, overlap };
    })
    .filter(x => x.all)
    .sort((a,b) => (a.c.priority - b.c.priority) || (b.overlap - a.overlap));

  if (perfect.length) return [perfect[0].c];

  // 2) Greedy cover: fewest/highest overlap, tie-break by priority
  const remaining = new Set([...selectedSet]);
  const picked = [];

  while (remaining.size && picked.length < maxCourses) {
    let best = null;

    for (const c of courses) {
      const certSet = new Set((c.certificates || []).map(norm));
      const overlap = [...remaining].filter(x => certSet.has(x)).length;
      if (overlap <= 0) continue;

      if (!best) best = { c, overlap };
      else if (overlap > best.overlap) best = { c, overlap };
      else if (overlap === best.overlap && c.priority < best.c.priority) best = { c, overlap };
    }

    if (!best) break;
    picked.push(best.c);
    for (const cert of best.c.certificates || []) remaining.delete(norm(cert));
  }

  return picked;
}

function parseProgramsFromText(text = "") {
  // Supports simple line list, bullets, or a single-column CSV export.
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[-*•\s]+/, "").trim());

  // If the file is CSV-ish (commas present), take first cell from each non-header row.
  const looksCsv = lines.slice(0, 5).some((l) => l.includes(","));
  if (looksCsv) {
    const csvPrograms = [];
    for (const line of lines) {
      const firstCell = line.split(",")[0]?.replace(/^"|"$/g, "").trim();
      if (!firstCell) continue;
      // Skip header-y rows
      if (normalizeName(firstCell) === "program" || normalizeName(firstCell) === "programs") continue;
      csvPrograms.push(firstCell);
    }
    return uniq(csvPrograms);
  }

  // Plain line list
  return uniq(lines);
}

function parseLanguagesFromText(text = "") {
  // Each line: code|Label  (ex: en|English)
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
  console.log("These are the languages parsed" + parsed);
}

async function getDriveClient() {
  if (!google) throw new Error("googleapis is not installed. Run: npm install googleapis");
  if (!DRIVE_FOLDER_ID) throw new Error("Missing DRIVE_FOLDER_ID env var");
  if (!GOOGLE_SERVICE_ACCOUNT_JSON) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON env var");

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

      // These two are essential for Shared Drives + “Shared with me”
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const batch = res.data.files || [];
    files.push(...batch);
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  console.log(`[KB] listAllChildren(${folderId}) -> ${files.length} files`);
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

    // Google Sheet → export as CSV (first sheet)
    if (mime === "application/vnd.google-apps.spreadsheet") {
      const res = await drive.files.export(
        { fileId: item.id, mimeType: "text/csv", supportsAllDrives: true },
        { responseType: "text" }
      );
      return typeof res.data === "string" ? res.data : "";
    }

    // Normal files (txt/md/csv/etc)
    const res = await drive.files.get({
      q: `'${folderId}' in parents and trashed=false`,
      fields: `files(id,name,mimeType,modifiedTime),nextPageToken`,
      pageSize: 1000,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
  });

    return typeof res.data === "string" ? res.data : JSON.stringify(res.data || "");
  } catch (err) {
    console.warn(`[KB] downloadText failed for "${item.name}" (${mime}):`, err?.message || err);
    return "";
  }
}

function inferProgramTagFromPath(pathParts) {
  // Recommended Drive folder layout:
  //   <KB ROOT>/
  //     FAQs/...
  //     Programs/<Program Name>/...
  const idx = pathParts.findIndex((p) => normalizeName(p) === "programs");
  if (idx >= 0 && pathParts[idx + 1]) return pathParts[idx + 1];
  return null;
}

async function walkFolder(drive, folderId, pathParts = []) {
  console.log("Walking this folder -> " + folderId);
  const children = await listAllChildren(drive, folderId);
  console.log(`[KB] children count in ${folderId}: ${children.length}`);

  const docs = [];
  let trainingProgramsText = null;
  let courseIndexText = null;
  let languagesText = null;

  for (const item of children) {
    console.log(`[KB] Found: ${item.name} (${item.mimeType})`);
    if (item.mimeType === "application/vnd.google-apps.folder") {
      const sub = await walkFolder(drive, item.id, [...pathParts, item.name]);
      docs.push(...sub.docs);

      if (sub.trainingProgramsText) trainingProgramsText = trainingProgramsText || sub.trainingProgramsText;
      if (sub.courseIndexText) courseIndexText = courseIndexText || sub.courseIndexText;
      if (sub.languagesText) languagesText = languagesText || sub.languagesText;
      continue;
    }

    const nameLower = normalizeName(item.name);

    const isTrainingProgramsList =
      nameLower === "training programs" ||
      nameLower.includes("training programs");

    const isCourseIndex =
      nameLower === "chat agent - course index" ||
      nameLower.includes("chat agent - course index");

    const isLanguagesList =
      nameLower === "languages.txt" ||
      nameLower === "languages.md" ||
      nameLower.includes("language list");

    const text = await downloadText(drive, item);

    if (isTrainingProgramsList) {
      trainingProgramsText = text;
      docs.push({
        id: item.id,
        name: item.name,
        path: [...pathParts, item.name].join("/"),
        text,
        programTag: null,
        modifiedTime: item.modifiedTime,
      });
      continue;
    }

    if (isCourseIndex) {
      courseIndexText = text;
      docs.push({
        id: item.id,
        name: item.name,
        path: [...pathParts, item.name].join("/"),
        text,
        programTag: null,
        modifiedTime: item.modifiedTime,
      });
      continue;
    }

    if (isLanguagesList) {
      languagesText = text;
      docs.push({
        id: item.id,
        name: item.name,
        path: [...pathParts, item.name].join("/"),
        text,
        programTag: null,
        modifiedTime: item.modifiedTime,
      });
      continue;
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

  return { docs, trainingProgramsText, courseIndexText, languagesText };
}


async function loadKnowledgeBase({ force = false } = {}) {
  const now = Date.now();
  const isFresh = kbCache.loadedAt && now - kbCache.loadedAt < KB_CACHE_TTL_MS;

  if (!force && isFresh) return kbCache;
  if (kbCache.loading) return kbCache.loading;

  kbCache.loading = (async () => {
    try {
      if (!DRIVE_FOLDER_ID || !GOOGLE_SERVICE_ACCOUNT_JSON || !google) {
        // Drive not configured (or googleapis missing). Keep defaults.
        kbCache = {
          ...kbCache,
          loadedAt: now,
          source: "default",
          lastError: null,
        };
        return kbCache;
      }

      const drive = await getDriveClient();
      console.log("Did I load a client successfully???" + drive);
      
      const { docs, trainingProgramsText, languagesText, courseIndexText } = await walkFolder(drive, DRIVE_FOLDER_ID, []);
      const programs = trainingProgramsText
        ? parseProgramsFromText(trainingProgramsText)
        : kbCache.programs;

      const courses = courseIndexText
        ? parseCourseIndexFromCSV(courseIndexText)
        : kbCache.courses;
      
      const languages = languagesText ? parseLanguagesFromText(languagesText) : kbCache.languages;

      kbCache = {
        loadedAt: now,
        loading: null,
        docs,
        programs,
        courses,
        languages,
        source: "google-drive",
        lastError: null,
      };

      console.log(
        `[KB] Loaded ${docs.length} docs, ${programs.length} programs. Source=${kbCache.source}`
      );

      return kbCache;
    } catch (err) {
      console.error("[KB] Failed to load knowledge base:", err);

      // Keep the last known cache if we have one; otherwise keep defaults
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
  "the","a","an","and","or","but","if","then","else","when","where","what","who","why","how",
  "to","of","in","on","at","for","from","by","with","without","about","into","over","under",
  "is","are","was","were","be","been","being","i","you","we","they","he","she","it","them","us",
  "my","your","our","their","this","that","these","those","as","can","could","should","would",
  "do","does","did","will","just","please"
]);

function extractKeywords(text = "") {
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((w) => w.length >= 3)
    .filter((w) => !STOPWORDS.has(w));

  // limit for speed
  return uniq(words).slice(0, 20);
}

function chunkText(text = "") {
  // Split by blank lines; fallback to sentence-ish split if needed
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

function buildKnowledgeContext({ kb, message, programsSelected }) {
  const selected = (programsSelected || []).map((p) => String(p).trim()).filter(Boolean);
  const selectedNorm = selected.map(normalizeName);

  // Candidate docs:
  // - Always include anything in FAQs folder or with faq-ish name
  // - Include any program-tagged docs matching selection
  // - If no selection, include general docs only (avoid dumping every program)
  const docs = kb.docs || [];

  const generalDocs = docs.filter((d) => {
    const p = normalizeName(d.path || d.name);
    const isFaq = p.includes("faq") || p.includes("faqs") || p.includes("general");
    const isProgramsList = normalizeName(d.name) === "Training Programs" || p.includes("Training Programs") || p.includes("Chat Agent - Course Index") ;
    return isFaq || isProgramsList || !d.programTag;
  });

  let programDocs = [];
  if (selectedNorm.length) {
    programDocs = docs.filter((d) => {
      const tag = normalizeName(d.programTag || "");
      const name = normalizeName(d.name || "");
      const path = normalizeName(d.path || "");
      // Match by folder tag first; otherwise fallback to name/path contains the program label
      return selectedNorm.some((sp) => (tag && sp === tag) || name.includes(sp) || path.includes(sp));
    });
  }

  const candidateDocs = uniq([...generalDocs, ...programDocs]);

  // If no message or very short, include just a small fixed excerpt
  const keywords = extractKeywords(message || "");
  const wantRelevant = keywords.length >= 2;

  const excerpts = [];
  const maxChunksTotal = 12;
  const maxChunksPerDoc = 3;

  for (const doc of candidateDocs) {
    if (excerpts.length >= maxChunksTotal) break;

    const chunks = chunkText(doc.text || "");
    if (!chunks.length) continue;

    if (!wantRelevant) {
      // Take first chunk only to keep context short
      excerpts.push({
        doc,
        chunk: chunks[0],
        score: 0,
      });
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

  // Group by doc for readability
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
      // Keep each chunk reasonably short
      const trimmed = c.length > 900 ? c.slice(0, 900) + "…" : c;
      out += `- ${trimmed.replace(/\n+/g, " ").trim()}\n`;
    }
  }

  return out.trim();
}

// -----------------------------
// Routes
// -----------------------------

// Health check
app.get("/health", async (req, res) => {
  const kb = await loadKnowledgeBase();
  res.json({ status: "ok", kbSource: kb.source, kbLoadedAt: kb.loadedAt, kbError: kb.lastError });
});

// Config for the widget (program list, language list)
app.get("/config", async (req, res) => {
  const kb = await loadKnowledgeBase();
  res.json({
    languages: kb.languages && kb.languages.length ? kb.languages : DEFAULT_LANGUAGES,
    programs: kb.programs || [],
    kbSource: kb.source,
  });
});

// Optional: simple status endpoint for debugging
app.get("/kb-status", async (req, res) => {
  const kb = await loadKnowledgeBase();
  res.json({
    source: kb.source,
    loadedAt: kb.loadedAt,
    docsCount: kb.docs.length,
    programsCount: kb.programs.length,
    lastError: kb.lastError,
    sampleDocs: kb.docs.slice(0, 5).map((d) => ({ name: d.name, path: d.path, programTag: d.programTag })),
  });
});

// AI Chat Route
app.post("/chat", async (req, res) => {
  console.log("Received /chat request with body:", req.body);

  try {
    const { message, language = "en", programsSelected = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Missing 'message' in request body" });
    }

    const kb = await loadKnowledgeBase();

    const knowledgeContext = buildKnowledgeContext({
      kb,
      message,
      programsSelected,
    });

    const recommended = recommendCourses(programsSelected, kb.courses, 3)

    const recommendationBlock = recommended.length
      ? recommended.map(c =>
          `- ${c.course_name} (${c.course_code}) — Includes: ${c.certificates.join(", ")}${c.link ? ` — Link: ${c.link}` : ""} — Priority: ${c.priority}`
      ).join("\n")
      : "- no course matches found in the Course Index for the selected certificates.";

    const systemPrompt = `
You are an enrollment assistant for "Healthcare-Edu" a healthcare training school licensed to train in Massachusetts.

Your goals:
- Be friendly, helpful, and concise.
- Always respond in the user's preferred language (language code): ${language}.
- Answer any questions the students may have about our training programs. 
- Encourage the student to enroll or speak with staff for next steps.
- The School's physical address is 793 Crescent Street, Brockton MA, 02302.
- If you are not sure, direct the student to visit the school during our standard business hours (Monday - Friday, 10am to 5pm). Do NOT invent details.

Programs the student selected: ${Array.isArray(programsSelected) ? programsSelected.join(", ") : ""}

Recommended course(s) based on selected certificates:
${recommendationBlock}

Rules:
- Treat the recommended course list as the primary enrollment suggestion.
- If the user asks about something not covered, explain what is missing and propose the next best path.

Use the following Knowledge Base content to answer. If the KB does not contain an answer, direct them to visit the school during our schools business hours (Monday - Friday, 10am - 5pm).

KNOWLEDGE BASE:
${knowledgeContext}
`.trim();

    const response = await client.responses.create({
      model: "gpt-4.1-mini", // or any model you choose
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [{ type: "input_text", text: message }],
        },
      ],
    });

    console.log("OpenAI raw response:", JSON.stringify(response, null, 2));

    let replyText = "";

    if (response.output_text) {
      replyText = response.output_text;
    } else if (
      response.output &&
      response.output[0] &&
      response.output[0].content &&
      response.output[0].content[0] &&
      response.output[0].content[0].text
    ) {
      replyText = response.output[0].content[0].text;
    } else {
      replyText = "Sorry, I couldn't generate a response.";
    }

    res.json({ reply: replyText });
  } catch (err) {
    console.error("Error in /chat:", err);
    res.status(500).json({ error: "AI error", details: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
