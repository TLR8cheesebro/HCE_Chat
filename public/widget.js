// widget.js
// 3-step prescreen overlay + required lead capture
// Sends new payload shape to /chat:
// { message, session:{sessionId,prescreenCompleted}, prescreen:{...} }
// Send a recommendation after 3 seconds

const STORAGE_KEYS = {
  sessionId: "hedu_session_id",
  prescreen: "hedu_prescreen",
  prescreenCompleted: "hedu_prescreen_completed",
  autoSent: "hedu_auto_reco_sent"
};

function getOrCreateSessionId() {
  let id = sessionStorage.getItem(STORAGE_KEYS.sessionId);
  if (!id) {
    id = "sess_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
    sessionStorage.setItem(STORAGE_KEYS.sessionId, id);
  }
  return id;
}

function hasSentAutoReco() {
  return sessionStorage.getItem(STORAGE_KEYS.autoSent) === "true";
}

function setSentAutoReco() {
  sessionStorage.setItem(STORAGE_KEYS.autoSent, "true");
}

function setPrescreenCompleted(v) {
  sessionStorage.setItem(STORAGE_KEYS.prescreenCompleted, v ? "true" : "false");
}

function isPrescreenCompleted() {
  return sessionStorage.getItem(STORAGE_KEYS.prescreenCompleted) === "true";
}

function savePrescreen(obj) {
  sessionStorage.setItem(STORAGE_KEYS.prescreen, JSON.stringify(obj));
}

function loadPrescreen() {
  const raw = sessionStorage.getItem(STORAGE_KEYS.prescreen);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function $(id) { return document.getElementById(id); }

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function setStepper(step) {
  document.querySelectorAll(".step-dot").forEach(dot => {
    const s = Number(dot.getAttribute("data-step"));
    dot.classList.toggle("active", s === step);
  });
}

function setStep(step) {
  for (let i = 1; i <= 3; i++) {
    const el = $(`step-${i}`);
    if (!el) continue;
    if (i === step) show(el);
    else hide(el);
  }

  setStepper(step);

  const backBtn = $("backBtn");
  const nextBtn = $("nextBtn");

  if (step === 1) hide(backBtn);
  else show(backBtn);

  nextBtn.textContent = step === 3 ? "Start Chat" : "Next";
}

function sanitizePhone(phone) {
  return String(phone || "").trim();
}

function sanitizeEmail(email) {
  return String(email || "").trim();
}

function addMessage(role, text) {
  const log = $("chat-log");
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

async function fetchConfig() {
  const res = await fetch("/config");
  if (!res.ok) throw new Error("Failed to load /config");
  return res.json();
}

function renderLanguages(languages) {
  const sel = $("languageSelect");
  sel.innerHTML = "";
  for (const l of languages || []) {
    const opt = document.createElement("option");
    opt.value = l.code;
    opt.textContent = l.label;
    sel.appendChild(opt);
  }
}

function renderGoals(programs) {
  // Using programs list as "certificate goals" options.
  // If you later want separate goal labels, this is where you'd map them.
  const wrap = $("goalsList");
  wrap.innerHTML = "";
  (programs || []).forEach((p, idx) => {
    const id = `goal_${idx}`;
    const label = document.createElement("label");
    label.className = "check";
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(p)}" class="goalCheck" /> <span>${escapeHtml(p)}</span>`;
    wrap.appendChild(label);
  });

  // If config returned nothing, provide a sensible default set
  if (!wrap.children.length) {
    const defaults = [
      "Nursing Assistant Training (CNA/NAT)",
      "Home Health Aide (HHA)",
      "Phlebotomy Technician",
      "EKG Technician",
      "Medication Administration Program (MAP)",
      "Clinical Medical Assistant (CMA)",
    ];
    defaults.forEach((p, idx) => {
      const label = document.createElement("label");
      label.className = "check";
      label.innerHTML = `<input type="checkbox" value="${escapeHtml(p)}" class="goalCheck" /> <span>${escapeHtml(p)}</span>`;
      wrap.appendChild(label);
    });
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSelectedGoals() {
  return Array.from(document.querySelectorAll(".goalCheck"))
    .filter(cb => cb.checked)
    .map(cb => cb.value);
}

function getAvailabilityType() {
  const el = document.querySelector('input[name="availabilityType"]:checked');
  return el ? el.value : null;
}

function getDaysOff() {
  return Array.from(document.querySelectorAll(".dayOff"))
    .filter(cb => cb.checked)
    .map(cb => cb.value);
}

function setDaysOffEnabled(enabled) {
  const wrap = $("daysOffWrap");
  if (enabled) show(wrap);
  else hide(wrap);
}

function buildPrescreenPayload() {
  const language = $("languageSelect").value || "en";
  const certificateGoals = getSelectedGoals();

  const availabilityType = getAvailabilityType();
  const daysOff = availabilityType === "daysOff" ? getDaysOff() : [];

  const fullName = $("fullName").value.trim();
  const phone = sanitizePhone($("phone").value);
  const email = sanitizeEmail($("email").value);

  const optIn = $("marketingOptIn").checked;
  const checkboxLabel = $("marketingLabelText").textContent.trim();
  const timestampISO = new Date().toISOString();

  return {
    language,
    certificateGoals,
    availabilityType,
    daysOff,
    lead: { fullName, phone, email },
    marketingConsent: {
      optIn,
      timestampISO,
      language,
      checkboxLabel,
    },
  };
}

// Validation per step
function validateStep(step) {
  if (step === 1) {
    const goals = getSelectedGoals();
    const err = $("step1Error");
    err.textContent = "";
    if (!goals.length) {
      err.textContent = "Please select at least one goal.";
      return false;
    }
    return true;
  }

  if (step === 2) {
    const t = getAvailabilityType();
    const err = $("step2Error");
    err.textContent = "";

    if (!t) {
      err.textContent = "Please select an availability option.";
      return false;
    }
    if (t === "daysOff") {
      const days = getDaysOff();
      if (!days.length) {
        err.textContent = "Please select at least one day you are available.";
        return false;
      }
    }
    return true;
  }

  if (step === 3) {
    const err = $("step3Error");
    err.textContent = "";

    const fullName = $("fullName").value.trim();
    const phone = $("phone").value.trim();
    const email = $("email").value.trim();

    if (!fullName || !phone || !email) {
      err.textContent = "Name, phone, and email are required.";
      return false;
    }
    // Basic email check
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      err.textContent = "Please enter a valid email address.";
      return false;
    }
    return true;
  }

  return true;
}

async function sendToChat(message) {
  const sessionId = getOrCreateSessionId();
  const prescreen = loadPrescreen();

  const payload = {
    message,
    session: { sessionId, prescreenCompleted: isPrescreenCompleted() },
    prescreen,
  };

  const res = await fetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || "Chat request failed");
  }
  return data.reply || "";
}

function initChatForm() {
  const form = $("chat-form");
  const input = $("chat-input");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    addMessage("user", text);

    try {
      const reply = await sendToChat(text);
      addMessage("bot", reply);
    } catch (err) {
      addMessage("bot", "Sorry — something went wrong. Please try again.");
      console.error(err);
    }
  });
}

async function initPrescreen() {
  const overlay = $("prescreen-overlay");

  // If prescreen already completed in this session, hide overlay
  if (isPrescreenCompleted() && loadPrescreen()) {
    hide(overlay);
    return;
  }

  // Load config options
  try {
    const cfg = await fetchConfig();
    renderLanguages(cfg.languages || []);
    renderGoals(cfg.programs || []);
  } catch (e) {
    // Fallback defaults will render goals if programs empty
    renderLanguages([
      { code: "en", label: "English" },
      { code: "es", label: "Español" },
    ]);
    renderGoals([]);
    console.warn("Config load failed, using fallback options.");
  }

  // Default UI state
  let step = 1;
  setStep(step);

  // availability radio: show/hide daysOff picker
  document.querySelectorAll('input[name="availabilityType"]').forEach(r => {
    r.addEventListener("change", () => {
      const t = getAvailabilityType();
      setDaysOffEnabled(t === "daysOff");
    });
  });
  setDaysOffEnabled(true);

  $("backBtn").addEventListener("click", () => {
    if (step > 1) {
      step -= 1;
      setStep(step);
    }
  });

  $("nextBtn").addEventListener("click", () => {
    if (!validateStep(step)) return;

    if (step < 3) {
      step += 1;
      setStep(step);
      return;
    }

    // Step 3 submit
    const prescreen = buildPrescreenPayload();
    savePrescreen(prescreen);
    setPrescreenCompleted(true);

    //start chat
    hide(overlay);

  // Immediate “please wait” greeting 
  addMessage(
    "bot",
    prescreen.language === "es"
      ? "¡Gracias! Ya tengo tu información. Por favor espera mientras genero tu recomendación…"
      : "Thanks! I have your info. Please wait while I generate your recommendation . . ."
  );

  // After 3 seconds, auto-request the recommendation + schedule from the server
  if (!hasSentAutoReco()) {
    setSentAutoReco();
    setTimeout(async () => {
    try {
      // This message is just a trigger for the server prompt to produce the plan.
      // We intentionally do NOT display it as a user bubble.
      const trigger =
        prescreen.language === "es"
          ? "Genera mi recomendación del curso y las 2 mejores opciones de horario si están disponibles. Luego pregúntame si estoy listo(a) para inscribirme o si tengo preguntas."
          : "Generate my course recommendation and the 2 best schedule options if available. Then ask if I'm ready to enroll or have questions.";

      const reply = await sendToChat(trigger);
      addMessage("bot", reply);
    } catch (err) {
      console.error(err);
      addMessage(
        "bot",
        prescreen.language === "es"
          ? "Lo siento—tuve un problema generando tu recomendación. Por favor escribe cualquier pregunta y te ayudo."
          : "Sorry — I had trouble generating your recommendation. Please type any question and I’ll help."
      );
    }
  }, 3000);
  }
});
}
