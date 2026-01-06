// IMPORTANT:
// Use the same base URL for both /chat and /config
const backendBaseURL = "https://hce-chat-p4ot.onrender.com";
const chatURL = `${backendBaseURL}/chat`;
const configURL = `${backendBaseURL}/config`;

const messagesContainer = document.getElementById("chat-messages");
const input = document.getElementById("chat-input");
const sendButton = document.getElementById("chat-send");

const prechat = document.getElementById("prechat");
const languageOptionsEl = document.getElementById("language-options");
const programOptionsEl = document.getElementById("program-options");
const startChatBtn = document.getElementById("start-chat");

// Session state (kept in sessionStorage so refresh doesn't break flow)
let selectedLanguage = sessionStorage.getItem("hce_language") || "";
let selectedPrograms = JSON.parse(sessionStorage.getItem("hce_programs") || "[]");

// Config (pulled from backend so staff can update program list without code changes)
let config = {
  languages: [
    { code: "en", label: "English" },
    { code: "es", label: "Español" },
    { code: "fr", label: "Français" },
    { code: "ht", label: "Kreyòl Ayisyen" }
  ],
  programs: []
};

function addMessage(text, sender = "bot") {
  const msg = document.createElement("div");
  msg.classList.add("message");
  msg.classList.add(sender === "user" ? "user-message" : "bot-message");
  msg.textContent = text;

  messagesContainer.appendChild(msg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function setChatEnabled(enabled) {
  input.disabled = !enabled;
  sendButton.disabled = !enabled;
  if (enabled) input.focus();
}

function normalize(s) {
  return String(s || "").trim().toLowerCase();
}

function isPrechatComplete() {
  return Boolean(selectedLanguage) && Array.isArray(selectedPrograms) && selectedPrograms.length > 0;
}

function updateStartButtonState() {
  startChatBtn.disabled = !isPrechatComplete();
}

function saveSession() {
  sessionStorage.setItem("hce_language", selectedLanguage);
  sessionStorage.setItem("hce_programs", JSON.stringify(selectedPrograms));
}

function renderLanguageOptions() {
  languageOptionsEl.innerHTML = "";

  const langs = (config.languages || []).slice(0, 10);
  langs.forEach((lang) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-btn";
    btn.textContent = lang.label;
    btn.dataset.code = lang.code;

    if (normalize(selectedLanguage) === normalize(lang.code)) {
      btn.classList.add("selected");
    }

    btn.addEventListener("click", () => {
      selectedLanguage = lang.code;
      saveSession();
      renderLanguageOptions();
      updateStartButtonState();
    });

    languageOptionsEl.appendChild(btn);
  });
}

function toggleProgram(programLabel) {
  const label = String(programLabel || "").trim();
  if (!label) return;

  const idx = selectedPrograms.findIndex((p) => normalize(p) === normalize(label));
  if (idx >= 0) selectedPrograms.splice(idx, 1);
  else selectedPrograms.push(label);

  // Keep stable order based on config list
  const order = (config.programs || []).map((p) => normalize(p));
  selectedPrograms.sort((a, b) => order.indexOf(normalize(a)) - order.indexOf(normalize(b)));

  saveSession();
  renderProgramOptions();
  updateStartButtonState();
}

function renderProgramOptions() {
  programOptionsEl.innerHTML = "";

  const programs = config.programs || [];

  if (!programs.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No programs loaded yet.";
    programOptionsEl.appendChild(empty);
    return;
  }

  programs.forEach((programLabel) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "option-btn";
    btn.textContent = programLabel;

    if (selectedPrograms.some((p) => normalize(p) === normalize(programLabel))) {
      btn.classList.add("selected");
    }

    btn.addEventListener("click", () => toggleProgram(programLabel));

    programOptionsEl.appendChild(btn);
  });

  // Helpful option
  const unsureBtn = document.createElement("button");
  unsureBtn.type = "button";
  unsureBtn.className = "option-btn";
  unsureBtn.textContent = "Not sure yet";
  if (selectedPrograms.some((p) => normalize(p) === "not sure yet")) unsureBtn.classList.add("selected");
  unsureBtn.addEventListener("click", () => toggleProgram("Not sure yet"));
  programOptionsEl.appendChild(unsureBtn);
}

async function loadConfig() {
  try {
    const res = await fetch(configURL, { method: "GET" });
    const data = await res.json();

    if (Array.isArray(data.languages) && data.languages.length) {
      config.languages = data.languages;
    }
    if (Array.isArray(data.programs)) {
      config.programs = data.programs;
    }
  } catch (e) {
    // Keep defaults if config fails
  } finally {
    renderLanguageOptions();
    renderProgramOptions();

    // If the user already completed prechat earlier in this session, unlock chat immediately
    if (isPrechatComplete()) {
      prechat.classList.add("hidden");
      setChatEnabled(true);
      addMessage("Hi! How can I help you today?", "bot");
    } else {
      setChatEnabled(false);
    }

    updateStartButtonState();
  }
}

startChatBtn.addEventListener("click", () => {
  if (!isPrechatComplete()) return;

  prechat.classList.add("hidden");
  setChatEnabled(true);

  // Friendly confirmation message (optional)
  addMessage(
    `Thanks! I’ll respond in ${selectedLanguage.toUpperCase()} and focus on: ${selectedPrograms.join(", ")}.`,
    "bot"
  );

  addMessage("What questions can I answer for you?", "bot");
});

function buildRequestBody(messageText) {
  return {
    message: messageText,
    language: selectedLanguage || "en",
    programsSelected: Array.isArray(selectedPrograms) ? selectedPrograms : []
  };
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  // User message
  addMessage(text, "user");
  input.value = "";

  // Loading indicator
  const loadingMsg = document.createElement("div");
  loadingMsg.classList.add("message", "bot-message", "loading");
  loadingMsg.textContent = "Typing...";
  messagesContainer.appendChild(loadingMsg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  try {
    const response = await fetch(chatURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRequestBody(text))
    });

    const data = await response.json();

    loadingMsg.remove();
    addMessage(data.reply || "[Error: No response]", "bot");
  } catch (err) {
    loadingMsg.remove();
    addMessage("Sorry, something went wrong.", "bot");
  }
}

sendButton.addEventListener("click", sendMessage);
input.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

// Kick off
loadConfig();
