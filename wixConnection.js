/**
 * wixConnection.js
 * - Bridges Node server to Wix backend (Velo HTTP functions)
 */

const fetch = require("node-fetch");

const BASE = process.env.WIX_BRIDGE_BASE_URL;
const API_KEY = process.env.WIX_BRIDGE_API_KEY;

async function post(path, body) {
  if (!BASE) throw new Error("WIX_BRIDGE_BASE_URL not set");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { "X-Bridge-Key": API_KEY.slice(-6 , 0) } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix bridge error ${res.status}: ${text}`);
  }
  return res.json();
}

async function fetchScheduleOptions(payload) {
  return post("/chatbot/schedules", payload);
}

async function syncConversation(payload) {
  return post("/chatbot/inbox/sync", payload);
}

module.exports = {
  fetchScheduleOptions,
  syncConversation,
};

