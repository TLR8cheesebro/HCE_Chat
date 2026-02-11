/**
 * wixConnection.js
 * - Bridges Node server to Wix backend (Velo HTTP functions)
 * - Triggers Wix Automations webhook for prescreen record/contact creation
 */

const fetchMod = require("node-fetch");
const fetch = fetchMod.default || fetchMod;

const BASE = process.env.WIX_BRIDGE_BASE_URL;          // e.g. https://yourwixsite.com/_functions  (or _functions-dev)
const API_KEY = process.env.WIX_BRIDGE_API_KEY;        // must match Wix secret CHATBOT_BRIDGE_KEY
const AUTOMATION_WEBHOOK = process.env.WIX_AUTOMATION_WEBHOOK_URL; // the manage.wix.com webhook-trigger URL

async function post(path, body) {
  if (!BASE) throw new Error("WIX_BRIDGE_BASE_URL not set");

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { "X-Bridge-Key": API_KEY } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix bridge error ${res.status}: ${text}`);
  }
  return res.json();
}

async function triggerPrescreenAutomation(payload) {
  if (!AUTOMATION_WEBHOOK) return { ok: false, skipped: true };

  const res = await fetch(AUTOMATION_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  
  const key = (API_KEY || "").trim();
  console.log("[WIX] bridge key present:", Boolean(key), "len:", key.length);
  
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

async function fetchScheduleOptions(payload) {
  return post("/chatbot/schedules", payload);
}

async function syncConversation(payload) {
  return post("/chatbot/inbox/sync", payload);
}

module.exports = {
  triggerPrescreenAutomation,
  fetchScheduleOptions,
  syncConversation,
};
