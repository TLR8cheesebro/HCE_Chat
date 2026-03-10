/**
 * wixConnection.js
 *
 * Bridges the Render/Node server to Wix.
 *
 * We use 3 Wix-related integrations in this project:
 *  1) Wix Automations webhook (manage.wix.com webhook-trigger) for prescreen record/contact creation.
 *  2) Wix Velo HTTP function (/_functions[/_dev]) for schedule options (view-only).
 *  3) Wix REST APIs (www.wixapis.com) for Wix Inbox conversation syncing.
 *
 * Why REST for Inbox sync?
 * - Sending messages via Velo backend modules can fail with NOT_PERMITTED_TO_SEND if the
 *   site/collaborator/app permissions aren't aligned.
 * - Using a Wix REST API Key + wix-site-id allows server-to-server inbox syncing.
 */

// Use native fetch when available (Node 18+). Fall back to node-fetch if installed.
let fetch = global.fetch;
if (!fetch) {
  try {
    const fetchMod = require("node-fetch");
    fetch = fetchMod.default || fetchMod;
  } catch (e) {
    throw new Error("No fetch implementation found. Use Node 18+ or add node-fetch to dependencies.");
  }
}

// ---- 1) Wix Velo bridge (HTTP Functions) ----
const BRIDGE_BASE = process.env.WIX_BRIDGE_BASE_URL; // e.g. https://yourdomain.com/_functions or /_functions-dev
const BRIDGE_KEY = process.env.WIX_BRIDGE_API_KEY;   // must match Wix secret CHATBOT_BRIDGE_KEY

// ---- 2) Wix Automations webhook trigger ----
const AUTOMATION_WEBHOOK = process.env.WIX_AUTOMATION_WEBHOOK_URL; // manage.wix.com/_api/webhook-trigger/...

// ---- 3) Wix REST (Inbox + Contacts) ----
const WIX_REST_API_KEY = (process.env.WIX_CHAT_LOG_API_KEY || process.env.WIX_CHAT_API_KEY || "").trim();
const WIX_SITE_ID = (process.env.WIX_SITE_ID || "").trim();

const WIX_API_BASE = "https://www.wixapis.com";

const REST_ENDPOINTS = {
  contactsQuery: `${WIX_API_BASE}/contacts/v4/contacts/query`,
  contactsCreate: `${WIX_API_BASE}/contacts/v4/contacts`,
  inboxConversations: `${WIX_API_BASE}/inbox/v2/conversations`,
  inboxMessages: `${WIX_API_BASE}/inbox/v2/messages`,
};

function isRestConfigured() {
  return Boolean(WIX_REST_API_KEY && WIX_SITE_ID);
}

function restHeaders() {
  if (!isRestConfigured()) {
    throw new Error("WIX_API_KEY and WIX_SITE_ID must be set for Wix REST Inbox sync");
  }
  return {
    "Content-Type": "application/json",
    // Wix REST API Keys are passed directly in the Authorization header (no Bearer prefix)
    Authorization: WIX_REST_API_KEY,
    // For site-level APIs, Wix requires wix-site-id header.
    // (Do not include wix-account-id unless you are calling account-level APIs.)
    "wix-site-id": WIX_SITE_ID,
  };
}

async function restPost(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: restHeaders(),
    body: JSON.stringify(body || {}),
  });

  const txt = await res.text();
  if (!res.ok) {
    // Include response body to help debug permission / schema issues.
    throw new Error(`Wix REST error ${res.status}: ${txt}`);
  }

  if (!txt) return {};
  try {
    return JSON.parse(txt);
  } catch {
    // Some Wix endpoints may return non-JSON (rare). Return raw.
    return { raw: txt };
  }
}

// ---- Velo bridge helpers (schedules) ----
async function bridgePost(path, body) {
  if (!BRIDGE_BASE) throw new Error("WIX_BRIDGE_BASE_URL not set");

  const key = (BRIDGE_KEY || "").trim();

  console.log("[WIX] bridge key present:", Boolean(key), "len:", key.length);

  const res = await fetch(`${BRIDGE_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "X-Bridge-Key": key } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix bridge error ${res.status}: ${text}`);
  }
  return res.json();
}

// ---- Automations webhook trigger (prescreen) ----
async function triggerPrescreenAutomation(payload) {
  if (!AUTOMATION_WEBHOOK) return { ok: false, skipped: true };

  const res = await fetch(AUTOMATION_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Automation webhook error ${res.status}: ${text}`);
  }

  // Some triggers return empty/204; safe-parse
  const txt = await res.text();
  try {
    return txt ? JSON.parse(txt) : { ok: true };
  } catch {
    return { ok: true };
  }
}

// ---- Schedule options (from Wix Velo, view-only) ----
async function fetchScheduleOptions(payload) {
  return bridgePost("/chatbot/schedules", payload);
}

// ---- Inbox sync (Wix REST) ----

function splitName(fullName) {
  const name = String(fullName || "").trim();
  if (!name) return { first: "", last: "" };
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normPhone(phone) {
  return String(phone || "").trim();
}

function prune(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v && typeof v === "object") {
      const vv = prune(v);
      if (Array.isArray(vv) && vv.length === 0) continue;
      if (!Array.isArray(vv) && typeof vv === "object" && Object.keys(vv).length === 0) continue;
      out[k] = vv;
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function queryContactIdByLead({ email, phone }) {
  const filters = [];
  if (email) filters.push({ "info.emails.email": { $eq: email } });
  if (phone) filters.push({ "info.phones.phone": { $eq: phone } });
  if (!filters.length) return null;

  const filter = filters.length === 1 ? filters[0] : { $or: filters };

  const resp = await restPost(REST_ENDPOINTS.contactsQuery, {
    query: {
      filter,
      // only need the id
      fields: ["id"],
      paging: { limit: 1, offset: 0 },
    },
  });

  const contacts = resp?.contacts || resp?.items || resp?.results || [];
  const first = Array.isArray(contacts) ? contacts[0] : null;
  return first?.id || first?._id || first?.contactId || null;
}

async function createContactFromLead(lead) {
  const email = normEmail(lead?.email);
  const phone = normPhone(lead?.phone);
  const { first, last } = splitName(lead?.fullName);

  const info = prune({
    name: first || last ? prune({ first: first || undefined, last: last || undefined }) : undefined,
    emails: email ? [{ email }] : undefined,
    phones: phone ? [{ phone }] : undefined,
  });

  const resp = await restPost(REST_ENDPOINTS.contactsCreate, prune({
    info,
    // By default, Wix won't create duplicates when email already exists.
    // Keeping allowDuplicates=false protects your CRM.
    allowDuplicates: false,
  }));

  const c = resp?.contact || resp;
  return c?.id || c?._id || c?.contactId || null;
}

async function resolveContactId(lead) {
  const email = normEmail(lead?.email);
  const phone = normPhone(lead?.phone);

  if (!email && !phone) throw new Error("Missing lead email/phone");

  // 1) Try query first
  let contactId = await queryContactIdByLead({ email, phone });
  if (contactId) return contactId;

  // 2) Create contact; if it fails due to duplicates, query again.
  try {
    contactId = await createContactFromLead({ fullName: lead?.fullName, email, phone });
    if (contactId) return contactId;
  } catch (e) {
    contactId = await queryContactIdByLead({ email, phone });
    if (contactId) return contactId;
    throw e;
  }

  throw new Error("Could not resolve Wix contactId");
}

async function getOrCreateConversationId(contactId) {
  const resp = await restPost(REST_ENDPOINTS.inboxConversations, {
    participantId: { contactId },
  });

  const convo = resp?.conversation || resp;
  const conversationId = convo?.id || convo?._id || resp?.conversationId || null;
  if (!conversationId) {
    throw new Error(`Could not resolve conversationId. Response: ${JSON.stringify(resp).slice(0, 300)}`);
  }
  return conversationId;
}

async function sendInboxMessage({ conversationId, direction, visibility, content }) {
  return restPost(REST_ENDPOINTS.inboxMessages, {
    message: {
      conversationId,
      direction,
      visibility,
      content,
    },
  });
}

// Cache (in-memory) to reduce REST calls.
// sessionId -> { contactId, conversationId, updatedAt }
const INBOX_CACHE = new Map();
const INBOX_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function getCached(sessionId) {
  const v = INBOX_CACHE.get(sessionId);
  if (!v) return null;
  if (Date.now() - v.updatedAt > INBOX_CACHE_TTL_MS) {
    INBOX_CACHE.delete(sessionId);
    return null;
  }
  return v;
}

function setCached(sessionId, data) {
  INBOX_CACHE.set(sessionId, { ...data, updatedAt: Date.now() });
  // basic cleanup
  for (const [k, v] of INBOX_CACHE.entries()) {
    if (Date.now() - v.updatedAt > INBOX_CACHE_TTL_MS) INBOX_CACHE.delete(k);
  }
}

/**
 * syncConversation(payload)
 *
 * Expected payload (from server.js):
 * {
 *   sessionId: string,
 *   lead: { fullName, phone, email },
 *   prescreen: {...},
 *   includePrescreenForm: boolean,
 *   messages: [{ role: 'user'|'bot', text: string }]
 * }
 */
async function syncConversation(payload) {
  // If REST isn’t configured, fall back to the old Velo bridge route (if you still have it).
  if (!isRestConfigured()) {
    console.warn("[WIX] REST not configured (WIX_API_KEY/WIX_SITE_ID missing). Falling back to Velo bridge.");
    return bridgePost("/chatbot/inbox/sync", payload);
  }

  const sessionId = String(payload?.sessionId || "");
  const lead = payload?.lead || {};
  const prescreen = payload?.prescreen || null;
  const includePrescreenForm = payload?.includePrescreenForm === true;
  const msgList = Array.isArray(payload?.messages) ? payload.messages : [];

  if (!sessionId) throw new Error("Missing sessionId");
  if (!lead?.email && !lead?.phone) throw new Error("Missing lead email/phone");

  // Resolve contact + conversation with cache
  const cached = getCached(sessionId);

  let contactId = cached?.contactId;
  let conversationId = cached?.conversationId;

  if (!contactId) contactId = await resolveContactId(lead);
  if (!conversationId) conversationId = await getOrCreateConversationId(contactId);

  setCached(sessionId, { contactId, conversationId });

  // Optional: attach prescreen as a BUSINESS-only form message (so staff can see it)
  if (prescreen && includePrescreenForm) {
    const fields = [
      { name: "Goals", value: (prescreen.certificateGoals || []).join(", ") },
      { name: "Availability Type", value: String(prescreen.availabilityType || "") },
      { name: "Days Available", value: (prescreen.daysOff || []).join(", ") },
      { name: "Consent Opt-In", value: String(!!prescreen?.marketingConsent?.optIn) },
      { name: "Consent Timestamp", value: String(prescreen?.marketingConsent?.timestampISO || "") },
    ];

    await sendInboxMessage({
      conversationId,
      direction: "PARTICIPANT_TO_BUSINESS",
      visibility: "BUSINESS",
      content: {
        form: {
          title: "Chatbot Pre-screen Completed",
          fields,
        },
      },
    });
  }

  // Send chat log messages (BUSINESS-only)
  for (const m of msgList) {
    const role = String(m.role || "").toLowerCase();
    const text = String(m.text || "").trim();
    if (!text) continue;

    await sendInboxMessage({
      conversationId,
      direction: role === "user" ? "PARTICIPANT_TO_BUSINESS" : "BUSINESS_TO_PARTICIPANT",
      visibility: "BUSINESS",
      content: {
        basic: [{ text }],
      },
    });
  }

  return { ok: true, contactId, conversationId };
}

module.exports = {
  triggerPrescreenAutomation,
  fetchScheduleOptions,
  syncConversation,
};
