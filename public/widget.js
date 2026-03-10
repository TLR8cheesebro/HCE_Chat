// widget.js
// 3-step prescreen overlay + required lead capture
// Sends new payload shape to /chat:
// { message, session:{sessionId,prescreenCompleted}, prescreen:{...} }
// Send a recommendation after 2 seconds

const STORAGE_KEYS = {
  sessionId: "hedu_session_id",
  prescreen: "hedu_prescreen",
  prescreenCompleted: "hedu_prescreen_completed",
  autoSent: "hedu_auto_reco_sent",
  enrollUrl: "hedu_enroll_url",
  enrollVisible: "hedu_enroll_visible"
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

function saveEnrollState(url, visible) {
  if (url) sessionStorage.setItem(STORAGE_KEYS.enrollUrl, url);
  else sessionStorage.removeItem(STORAGE_KEYS.enrollUrl);

  sessionStorage.setItem(STORAGE_KEYS.enrollVisible, visible ? "true" : "false");
}

function loadEnrollState() {
  return {
    url: sessionStorage.getItem(STORAGE_KEYS.enrollUrl) || "",
    visible: sessionStorage.getItem(STORAGE_KEYS.enrollVisible) === "true",
  };
}

function clearAutoRecoFlag() {
  sessionStorage.removeItem(STORAGE_KEYS.autoSent);
}

function clearChatLog() {
  const log = $("chat-log");
  if (log) log.innerHTML = "";
}

function setSelectedGoals(goals = []) {
  const wanted = new Set((goals || []).map(String));
  document.querySelectorAll(".goalCheck").forEach((cb) => {
    cb.checked = wanted.has(cb.value);
  });
}

function hydratePrescreenForm(prescreen) {
  if (!prescreen) return;

  if ($("languageSelect") && prescreen.language) {
    $("languageSelect").value = prescreen.language;
  }

  setSelectedGoals(prescreen.certificateGoals || []);

  const availabilityType = prescreen.availabilityType || "daysOff";
  const radio = document.querySelector(`input[name="availabilityType"][value="${availabilityType}"]`);
  if (radio) radio.checked = true;
  setDaysOffEnabled(availabilityType === "daysOff");

  const wantedDays = new Set((prescreen.daysOff || []).map(String));
  document.querySelectorAll(".dayOff").forEach((cb) => {
    cb.checked = wantedDays.has(cb.value);
  });

  const lead = prescreen.lead || {};
  if ($("fullName")) $("fullName").value = lead.fullName || "";
  if ($("phone")) $("phone").value = lead.phone || "";
  if ($("email")) $("email").value = lead.email || "";

  const consent = prescreen.marketingConsent || {};
  if ($("marketingOptIn")) $("marketingOptIn").checked = !!consent.optIn;
}

function resetStepErrors() {
  ["step1Error", "step2Error", "step3Error"].forEach((id) => {
    const el = $(id);
    if (el) el.textContent = "";
  });
}

function isInIframe() {
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}

function startRecommendationFlow(prescreen) {
  hideEnrollButton();
  clearChatLog();

  addMessage(
    "bot",
    prescreen.language === "es"
      ? "¡Gracias! Ya tengo tu información. Por favor espera mientras genero tu recomendación…"
      : "Thanks! I have your info. Please wait while I generate your recommendation . . ."
  );

  clearAutoRecoFlag();

  if (!hasSentAutoReco()) {
    setSentAutoReco();

    setTimeout(async () => {
      try {
        const trigger =
          prescreen.language === "es"
            ? "Genera mi recomendación del curso y las 2 mejores opciones de horario si están disponibles. Luego pregúntame si estoy listo(a) para inscribirme o si tengo preguntas."
            : "Generate my course recommendation and the 2 best schedule options if available. Then ask if I'm ready to enroll or have questions.";

        const data = await sendToChat(trigger, { internal: true });
        handleChatResponse(data);
      } catch (err) {
        console.error(err);
        addMessage(
          "bot",
          prescreen.language === "es"
            ? "Lo siento—tuve un problema generando tu recomendación. Por favor escribe cualquier pregunta y te ayudo."
            : "Sorry — I had trouble generating your recommendation. Please type any question and I’ll help."
        );
      }
    }, 2000);
  }
}

let goalsEditMode = false;

function openGoalChangeMode() {
  const existing = loadPrescreen();
  if (!existing) return;

  goalsEditMode = true;
  hydratePrescreenForm(existing);
  resetStepErrors();
  setStep(1);
  show($("prescreen-overlay"));

  const nextBtn = $("nextBtn");
  if (nextBtn) nextBtn.textContent = "Update Recommendation";
}

function showEnrollButton(url) {
  const bar = $("enroll-bar");
  const btn = $("enrollBtn");
  if (!bar || !btn || !url) return;

  btn.dataset.url = url;
  saveEnrollState(url, true);
  show(bar);
}

function hideEnrollButton() {
  const bar = $("enroll-bar");
  const btn = $("enrollBtn");
  if (btn) btn.dataset.url = "";
  if (bar) hide(bar);
  saveEnrollState("", false);
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

function handleChatResponse(data) {
  const reply = data?.reply || "";
  if (reply) addMessage("bot", reply);

  if (data?.action === "changeCertificates") {
    openGoalChangeMode();
    return;
  }

  if (data?.showEnrollButton && data?.enrollUrl) {
    showEnrollButton(data.enrollUrl);
  }
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
  const langCode = $("languageSelect").value || "en";
  const langLabel = $("languageSelect").selectedOptions?.[0]?.textContent?.trim() || "";
  const languagePreference = `${langCode}|${langLabel || langCode}`;

  const certificateGoals = getSelectedGoals(); // array (keep for chat)
  const availabilityType = getAvailabilityType();
  const daysOff = availabilityType === "daysOff" ? getDaysOff() : []; // array (keep for chat)

  const fullName = $("fullName").value.trim();
  const phone = sanitizePhone($("phone").value);
  const email = sanitizeEmail($("email").value);

  const optIn = $("marketingOptIn").checked;
  const checkboxLabel = $("marketingLabelText").textContent.trim();
  const timestampISO = new Date().toISOString();

  return {
    // keep these for your server + chat flow
    language: langCode,
    languagePreference, // <-- NEW
    certificateGoals,   // <-- array, used by chat + recommendation
    availabilityType,
    daysOff,            // <-- array, used by schedules logic

    // lead object now includes placeholders (per your desired webhook schema)
    lead: {
      email,
      phone,
      fullName,
      firstName: "",
      lastName: "",
    },

    marketingConsent: {
      optIn,
      timestampISO,
      language: langCode,
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

async function sendToChat(message, meta) {
  const sessionId = getOrCreateSessionId();
  const prescreen = loadPrescreen();

  const payload = {
    message,
    session: { sessionId, prescreenCompleted: isPrescreenCompleted() },
    prescreen,
    meta: meta || {},
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
  return data;
}

function initChatForm() {
  const form = $("chat-form");
  const input = $("chat-input");
  const homeBtn = document.getElementById("homeBtn");

  if (homeBtn) {
    if (isInIframe()) {
      homeBtn.style.display = "none";
    } else {
      homeBtn.style.display = "inline-flex";
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    addMessage("user", text);

    try {
      const data = await sendToChat(text);
      handleChatResponse(data);
    } catch (err) {
      addMessage("bot", "Sorry — something went wrong. Please try again.");
      console.error(err);
    }
  });

  const enrollBtn = $("enrollBtn");
  if (enrollBtn) {
    enrollBtn.addEventListener("click", () => {
      const url = enrollBtn.dataset.url || loadEnrollState().url;
      if (!url) return;

      hideEnrollButton();
      window.open(url, "_blank", "noopener,noreferrer");
    });
  }

  if (homeBtn) {
    homeBtn.addEventListener("click", () => {
      window.location.href = "https://healthcare-edu.com";
    });
  }

  const changeGoalsBtn = $("changeGoalsBtn");
  if (changeGoalsBtn) {
    changeGoalsBtn.addEventListener("click", async () => {
      const existing = loadPrescreen();
      if (!existing) {
        openGoalChangeMode();
        return;
      }

      try {
        const data = await sendToChat(
          "I want to change my certificates.",
          { intent: "change_certificates" }
        );
        handleChatResponse(data);
      } catch (err) {
        console.error(err);
        openGoalChangeMode();
      }
    });
  }
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
  if (goalsEditMode) {
    goalsEditMode = false;
    hide($("prescreen-overlay"));
    return;
  }

  if (step > 1) {
    step -= 1;
    setStep(step);
  }
});

    $("nextBtn").addEventListener("click", () => {
      const existing = loadPrescreen();

      //goal change
      if (goalsEditMode) {
    if (!validateStep(1)) return;

    const updated = {
      ...(existing || {}),
      language: $("languageSelect").value || existing?.language || "en",
      languagePreference: `${$("languageSelect").value || existing?.language || "en"}|${$("languageSelect").selectedOptions?.[0]?.textContent?.trim() || ""}`,
      certificateGoals: getSelectedGoals(),
      lead: {
        ...(existing?.lead || {}),
      },
      marketingConsent: {
        ...(existing?.marketingConsent || {}),
      },
      availabilityType: existing?.availabilityType || getAvailabilityType() || "daysOff",
      daysOff: Array.isArray(existing?.daysOff) ? existing.daysOff : getDaysOff(),
    };

    savePrescreen(updated);
    setPrescreenCompleted(true);
    goalsEditMode = false;
    hide($("prescreen-overlay"));
    startRecommendationFlow(updated);
    return;
  }

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

    // Trigger prescreen workflow (non-blocking)
    fetch("/prescreen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: { sessionId: getOrCreateSessionId() },
        prescreen,
      }),
    }).catch(console.warn);

    // Start chat
    hide(overlay);
    startRecommendationFlow(prescreen);

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
          const trigger =
            prescreen.language === "es"
              ? "Genera mi recomendación del curso y las 2 mejores opciones de horario si están disponibles. Luego pregúntame si estoy listo(a) para inscribirme o si tengo preguntas."
              : "Generate my course recommendation and the 2 best schedule options if available. Then ask if I'm ready to enroll or have questions.";

          // mark as internal so the server can avoid logging it as a user message in Wix Inbox
          const data = await sendToChat(trigger, { internal: true });
            handleChatResponse(data);
        } catch (err) {
          console.error(err);
          addMessage(
            "bot",
            prescreen.language === "es"
              ? "Lo siento—tuve un problema generando tu recomendación. Por favor escribe cualquier pregunta y te ayudo."
              : "Sorry — I had trouble generating your recommendation. Please type any question and I’ll help."
          );
        }
      }, 2000); 
    }
  });
} // ✅ CLOSES initPrescreen()

(async function main() {
  console.log("initiating Chat instance. . .");
  getOrCreateSessionId();
  await initPrescreen();
  initChatForm();

  const enrollState = loadEnrollState();
  if (enrollState.visible && enrollState.url) {
    showEnrollButton(enrollState.url);
  }
})();
