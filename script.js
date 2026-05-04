const PLACEHOLDER_RE = /\{\{([a-zA-Z0-9_]+)\}\}/g;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
function safeString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}
function getMetaContent(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  return el.getAttribute("content");
}
function setMetaContent(selector, content) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.setAttribute("content", safeString(content));
}
function emitEvent(eventName, payload) {
  console.log("[adsvizor_event]", eventName, payload ?? {});
}
function parseUtmFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const utm = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value && value.trim()) utm[key] = value.trim();
  }
  return utm;
}
function readUtmFromSession() {
  const utm = {};
  for (const key of UTM_KEYS) {
    const value = sessionStorage.getItem(key);
    if (value && value.trim()) utm[key] = value.trim();
  }
  return utm;
}
function persistUtmToSession(utm) {
  for (const key of UTM_KEYS) {
    const value = utm[key];
    if (value && String(value).trim()) sessionStorage.setItem(key, String(value).trim());
  }
}
function setHiddenUtmFields(form, utm) {
  for (const key of UTM_KEYS) {
    const input = form.querySelector(`#${key}`);
    if (input && typeof utm[key] === "string") input.value = utm[key];
  }
}
function normalizePhoneNumber(raw) {
  let s = (raw || "").trim();
  if (s.startsWith("+33")) {
    s = "0" + s.slice(3);
  } else if (s.startsWith("0033")) {
    s = "0" + s.slice(4);
  }
  return s.replace(/\D/g, "");
}
function isValidFrenchPhone(raw) {
  const digits = normalizePhoneNumber(raw);
  return /^0[1-9]\d{8}$/.test(digits);
}
function ensureFormErrorEl(form) {
  const existing = form.querySelector("[data-form-error]");
  if (existing) return existing;
  const el = document.createElement("div");
  el.setAttribute("data-form-error", "true");
  el.setAttribute("role", "alert");
  el.hidden = true;
  form.prepend(el);
  return el;
}
const PENDING_LEAD_KEY = "adsvizor_pending_lead";
const PENDING_LEAD_TTL = 48 * 60 * 60 * 1000;
function savePendingLead(payload, errorReason) {
  try {
    localStorage.setItem(PENDING_LEAD_KEY, JSON.stringify({
      payload,
      errorReason,
      savedAt: new Date().toISOString(),
      attempts: 1
    }));
  } catch {}
}
function clearPendingLead() {
  try { localStorage.removeItem(PENDING_LEAD_KEY); } catch {}
}
async function retryPendingLead(formActionUrl) {
  if (!formActionUrl || formActionUrl === "APPS_SCRIPT_URL") return;
  let saved;
  try {
    const raw = localStorage.getItem(PENDING_LEAD_KEY);
    if (!raw) return;
    saved = JSON.parse(raw);
  } catch { clearPendingLead(); return; }
  if (!saved || !saved.payload) { clearPendingLead(); return; }
  if (Date.now() - new Date(saved.savedAt).getTime() > PENDING_LEAD_TTL) {
    clearPendingLead(); return;
  }
  if (saved.attempts > 5) { clearPendingLead(); return; }
  try {
    await postLead(formActionUrl, saved.payload);
    clearPendingLead();
    emitEvent("form_submit", { status: "retry_success", attempts: saved.attempts, original_error: saved.errorReason });
    console.info("[adsvizor] Pending lead retried successfully after", saved.attempts, "attempt(s).");
  } catch {
    try {
      saved.attempts += 1;
      localStorage.setItem(PENDING_LEAD_KEY, JSON.stringify(saved));
    } catch {}
  }
}
function showFormError(form, message) {
  const el = ensureFormErrorEl(form);
  el.textContent = safeString(message);
  el.hidden = false;
}
function clearFormError(form) {
  const el = form.querySelector("[data-form-error]");
  if (!el) return;
  el.textContent = "";
  el.hidden = true;
}
async function fetchJson(url) {
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} while fetching JSON: ${url}${text ? ` — ${text}` : ""}`);
  }
  return res.json();
}
function replacePlaceholdersInString(input, config) {
  return input.replace(PLACEHOLDER_RE, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(config, key)) return safeString(config[key]);
    return `{{${key}}}`;
  });
}
function walkAndReplaceTextNodes(root, config) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const original = node.nodeValue ?? "";
    if (original.includes("{{")) node.nodeValue = replacePlaceholdersInString(original, config);
    node = walker.nextNode();
  }
}
function replacePlaceholdersInAttributes(root, config) {
  const elList = root.querySelectorAll("*");
  for (const el of elList) {
    for (const attr of Array.from(el.attributes)) {
      if (!attr.value || !attr.value.includes("{{")) continue;
      el.setAttribute(attr.name, replacePlaceholdersInString(attr.value, config));
    }
  }
}
function applyConfigToHead(config) {
  const pageTitleKey = document.documentElement.getAttribute("data-page-title-key");
  const pageDescKey  = document.documentElement.getAttribute("data-page-desc-key");
  const titleValue = (pageTitleKey && Object.prototype.hasOwnProperty.call(config, pageTitleKey))
    ? config[pageTitleKey]
    : (Object.prototype.hasOwnProperty.call(config, "meta_title") ? config.meta_title : null);
  const descValue = (pageDescKey && Object.prototype.hasOwnProperty.call(config, pageDescKey))
    ? config[pageDescKey]
    : (Object.prototype.hasOwnProperty.call(config, "meta_description") ? config.meta_description : null);
  const isStatic = document.documentElement.getAttribute('data-static') === 'true';
  if (!isStatic && titleValue !== null) document.title = safeString(titleValue);
  if (!isStatic && descValue !== null) setMetaContent('meta[name="description"]', descValue);
  if (Object.prototype.hasOwnProperty.call(config, "og_type")) setMetaContent('meta[property="og:type"]', config.og_type);
  if (Object.prototype.hasOwnProperty.call(config, "og_url")) setMetaContent('meta[property="og:url"]', config.og_url);
  if (Object.prototype.hasOwnProperty.call(config, "og_image_url")) setMetaContent('meta[property="og:image"]', config.og_image_url);
  if (titleValue !== null) setMetaContent('meta[property="og:title"]', titleValue);
  if (descValue !== null) setMetaContent('meta[property="og:description"]', descValue);
}
async function loadClientConfig(form) {
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  let clientSlug = null;
  if (parts.length >= 3 && !hostname.includes('localhost') && !/^\d+/.test(hostname)) {
    clientSlug = parts[0];
  }
  if (!clientSlug || clientSlug === 'www') {
    const params = new URLSearchParams(window.location.search);
    clientSlug = params.get('client');
  }
  if (!clientSlug) {
    const fromForm = form?.dataset?.clientSlug;
    const isPlaceholder = typeof fromForm === 'string' &&
      (fromForm.includes('{{') || fromForm.includes('}}'));
    if (!isPlaceholder) clientSlug = fromForm;
  }
  clientSlug = (clientSlug || 'formations').trim();
  const url = `/clients/${encodeURIComponent(clientSlug)}/config.json`;
  return fetchJson(url);
}
function initUtmTracking(form) {
  const utmFromUrl = parseUtmFromUrl();
  const utmFromSession = readUtmFromSession();
  const utm = { ...utmFromSession, ...utmFromUrl };
  persistUtmToSession(utm);
  setHiddenUtmFields(form, utm);
}
function preserveUtmOnLinks() {
  const utmFromUrl = parseUtmFromUrl();
  const utmFromSession = readUtmFromSession();
  const utm = { ...utmFromSession, ...utmFromUrl };
  const hasAnyUtm = UTM_KEYS.some((k) => typeof utm[k] === "string" && utm[k].trim());
  if (!hasAnyUtm) return;
  const params = new URLSearchParams();
  for (const key of UTM_KEYS) {
    const value = utm[key];
    if (value && value.trim()) params.set(key, value.trim());
  }
  const utmQuery = params.toString();
  if (!utmQuery) return;
  for (const a of document.querySelectorAll('a[data-preserve-utm="true"]')) {
    const rawHref = a.getAttribute("href");
    if (!rawHref || rawHref.startsWith("#")) continue;
    let url;
    try {
      url = new URL(rawHref, window.location.href);
    } catch {
      continue;
    }
    if (url.origin !== window.location.origin) continue;
    for (const key of UTM_KEYS) {
      if (!url.searchParams.get(key) && params.get(key)) url.searchParams.set(key, params.get(key));
    }
    a.setAttribute("href", url.pathname + (url.search ? url.search : "") + (url.hash ? url.hash : ""));
  }
}
function buildLeadPayload(form, config) {
  const fd = new FormData(form);
  const clientSlug = safeString(config.client_slug || form.dataset.clientSlug || "");
  const offerId = safeString(form.dataset.offerId || config.offer_id || "");
  const firstName = safeString(fd.get("first_name") ?? "").trim();
  const lastName = safeString(fd.get("last_name") ?? "").trim();
  const visitorName = firstName || lastName
    ? [firstName, lastName].filter(Boolean).join(" ")
    : (safeString(fd.get("name") ?? "").trim() || null);
  const visitorEmail = fd.get("email");
  const rawPhone = fd.get("phone");
  const visitorPhone = rawPhone ? normalizePhoneNumber(safeString(rawPhone).trim()) : null;
  const visitorMessage = fd.get("message");
  const consentMarketing = fd.get("consent_marketing") === "on";
  const professionalStatus = fd.get("professional_status");
  const consentLabelEl = document.querySelector('label[for="consent_marketing"]');
  const consentText = consentLabelEl ? consentLabelEl.textContent.trim() : "";
  const storedUtm = readUtmFromSession();
  function fdUtm(key) {
    const v = fd.get(key);
    return (v && safeString(v).trim()) || storedUtm[key] || null;
  }
  const payload = {
    client_slug: clientSlug,
    offer_id: offerId,
    visitor_name: visitorName || null,
    visitor_email: visitorEmail ? safeString(visitorEmail).trim() : "",
    visitor_phone: visitorPhone || null,
    visitor_message: visitorMessage ? safeString(visitorMessage).trim() : null,
    professional_status: professionalStatus ? safeString(professionalStatus).trim() : null,
    utm: {
      source:   fdUtm("utm_source"),
      medium:   fdUtm("utm_medium"),
      campaign: fdUtm("utm_campaign"),
      term:     fdUtm("utm_term"),
      content:  fdUtm("utm_content")
    },
    page_version: fd.get("page_version") ? safeString(fd.get("page_version")).trim() : safeString(config.page_version || ""),
    consent_marketing: consentMarketing,
    consent_url: window.location.href,
    consent_text: consentText,
    consent_timestamp: new Date().toISOString(),
    hp_trap: safeString(fd.get("hp_trap") ?? "").trim(),
    formation_interest: fd.get("formation_interest") ? safeString(fd.get("formation_interest")).trim() : null
  };
  return payload;
}
async function postLead(formActionUrl, payload, _attempt) {
  const attempt = _attempt || 1;
  const res = await fetch(formActionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Échec de l’envoi (HTTP ${res.status})${text ? ` — ${text}` : ""}`);
  }
  const contentType = res.headers.get("content-type") || "";
  const bodyText = await res.text().catch(() => "");
  if (contentType.includes("application/json") || bodyText.startsWith("{")) {
    let data;
    try { data = JSON.parse(bodyText); } catch {}
    if (data && data.status === "error") {
      if (attempt <= 2 && data.message && data.message.toLowerCase().includes("busy")) {
        await new Promise((r) => setTimeout(r, 3500));
        return postLead(formActionUrl, payload, attempt + 1);
      }
      throw new Error(data.message || "Erreur lors de l’enregistrement. Veuillez réessayer.");
    }
    return data;
  }
  if (bodyText.includes("<!DOCTYPE") || bodyText.includes("<html")) {
    throw new Error("Erreur serveur temporaire. Veuillez réessayer dans quelques instants.");
  }
  return bodyText;
}
function initFormHandling(form, config) {
  const submitButton = form.querySelector('button[type="submit"]');
  const formStartOnce = (() => {
    let fired = false;
    return () => {
      if (fired) return;
      fired = true;
      emitEvent("form_start", {
        client_slug: config.client_slug,
        offer_id: config.offer_id,
        page_version: config.page_version
      });
    };
  })();
  for (const el of form.querySelectorAll("input, textarea, select")) {
    el.addEventListener("focus", formStartOnce, { passive: true });
    el.addEventListener("input", formStartOnce, { passive: true });
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormError(form);
    if (!config.form_action || config.form_action === "APPS_SCRIPT_URL") {
      showFormError(form, "Le formulaire n’est pas encore configuré. Veuillez réessayer plus tard.");
      return;
    }
    const honeypot = form.querySelector('input[name="hp_trap"]');
    if (honeypot && honeypot.value.trim()) return;
    if (submitButton) submitButton.disabled = true;
    try {
      const securityCode = String(Math.floor(100000 + Math.random() * 900000));
      const payload = buildLeadPayload(form, config);
      payload.security_code = securityCode;
      emitEvent("form_submit", {
        status: "attempt",
        client_slug: payload.client_slug,
        offer_id: payload.offer_id,
        page_version: payload.page_version,
        utm_source: payload.utm.source,
        utm_medium: payload.utm.medium,
        utm_campaign: payload.utm.campaign,
        utm_term: payload.utm.term,
        utm_content: payload.utm.content
      });
      await postLead(config.form_action, payload);
      emitEvent("form_submit", { status: "success", client_slug: payload.client_slug, offer_id: payload.offer_id, security_code: securityCode });
      window.location.href = `thank-you.html?code=${securityCode}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Une erreur est survenue. Veuillez réessayer.";
      emitEvent("form_submit", { status: "error", message });
      showFormError(form, message);
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.classList.remove("btn-loading");
        if (typeof originalSubmitLabel !== "undefined" && originalSubmitLabel) {
          submitButton.textContent = originalSubmitLabel;
        }
      }
    }
  });
}
function initCtaTracking() {
  const ctaEls = document.querySelectorAll("[data-cta-id]");
  for (const el of ctaEls) {
    el.addEventListener(
      "click",
      () => {
        emitEvent("cta_click", { cta_id: el.getAttribute("data-cta-id") });
        const formation = el.getAttribute("data-formation");
        if (formation) sessionStorage.setItem("adsvizor_formation", formation);
      },
      { passive: true }
    );
  }
}
function resolveActiveFormation(config) {
  const detailContainer = document.getElementById("formation-detail-content");
  if (!detailContainer) return;
  const slug = new URLSearchParams(window.location.search).get("f");
  const formations = config.cpf_formations;
  if (!slug || !Array.isArray(formations)) {
    window.location.replace("/formations.html");
    return;
  }
  const formation = formations.find((f) => f.slug === slug);
  if (!formation) {
    window.location.replace("/formations.html");
    return;
  }
  for (const [key, value] of Object.entries(formation)) {
    if (typeof value === "string") config[`active_${key}`] = value;
  }
  if (!config.active_meta_title) {
    config.active_meta_title = `${formation.title} — Formation CPF | ${safeString(config.logo_text || "AdsVizor")}`;
  }
  if (!config.active_meta_description) {
    config.active_meta_description = `${formation.title} : formation éligible CPF. ${safeString(formation.excerpt || "")}`;
  }
}
function renderFormationList(config) {
  const container = document.getElementById("formation-list");
  if (!container || !Array.isArray(config.cpf_formations)) return;
  const cards = config.cpf_formations.map((f, i) => {
    const rank = i + 1;
    const href = f.href || `/formation-${f.slug}.html`;
    return `<li class="formation-card">
  <a href="${href}" class="formation-card-link" aria-label="${f.title}">
    <div class="formation-card-img-wrap">
      <img src="${f.image_url}" alt="${f.image_alt}" loading="${rank <= 2 ? "eager" : "lazy"}" />
      <span class="formation-rank">#${rank}</span>
      <span class="formation-tag">${f.tag}</span>
    </div>
    <div class="formation-card-body">
      <h2 class="formation-card-title">${f.title}</h2>
      <p class="formation-card-excerpt">${f.excerpt}</p>
      <span class="formation-card-cta">Découvrir cette formation &rarr;</span>
    </div>
  </a>
</li>`;
  });
  container.innerHTML = cards.join("\n");
}
function initStatCounters() {
  const strip = document.querySelector('.stats-strip');
  if (!strip || strip.hidden) return;
  const statEls = Array.from(strip.querySelectorAll('.stat strong'));
  if (!statEls.length) return;
  const parsed = statEls.map(el => {
    const text = el.textContent.trim();
    const m = text.match(/^([^\d]*)([\d\s]+)([^\d]*)$/);
    if (!m) return null;
    const raw = m[2].replace(/\s/g, '');
    return { el, prefix: m[1], target: parseInt(raw, 10), suffix: m[3], useSpace: m[2].includes(' ') };
  }).filter(Boolean);
  if (!parsed.length) return;
  const DURATION = 1600;
  const ease = t => 1 - (1 - t) ** 3;
  function fmt(n, useSpace) {
    if (useSpace && n >= 1000) {
      return Math.floor(n / 1000) + '\u00a0' + String(n % 1000).padStart(3, '0');
    }
    return String(n);
  }
  function run() {
    const t0 = performance.now();
    function tick(now) {
      const p = Math.min((now - t0) / DURATION, 1);
      const e = ease(p);
      for (const { el, prefix, target, suffix, useSpace } of parsed) {
        el.textContent = prefix + fmt(Math.round(e * target), useSpace) + suffix;
      }
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  const observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) { observer.disconnect(); run(); }
  }, { threshold: 0.5 });
  observer.observe(strip);
}
function initMultiStepForm(form, config) {
  const steps      = Array.from(form.querySelectorAll(".form-step"));
  const section    = form.closest("section");
  const progressFill  = section ? section.querySelector(".form-progress-fill") : null;
  const stepLabels = section
    ? Array.from(section.querySelectorAll(".form-step-label"))
    : [];
  let currentStep = 0;
  steps.forEach((step, i) => {
    step.hidden = i !== 0;
    step.style.display = i !== 0 ? "none" : "";
  });
  const formStartOnce = (() => {
    let fired = false;
    return () => {
      if (fired) return;
      fired = true;
      emitEvent("form_start", {
        client_slug: config.client_slug,
        offer_id: config.offer_id,
        page_version: config.page_version
      });
    };
  })();
  for (const el of form.querySelectorAll("input, textarea, select")) {
    el.addEventListener("focus", formStartOnce, { passive: true });
    el.addEventListener("input", formStartOnce, { passive: true });
  }
  function showStep(index) {
    steps.forEach((step, i) => {
      const hide = i !== index;
      step.hidden = hide;
      step.style.display = hide ? "none" : "";
    });
    if (progressFill) progressFill.style.width = index === 0 ? "50%" : "100%";
    stepLabels.forEach((lbl, i) => lbl.classList.toggle("is-active", i === index));
    currentStep = index;
    clearFormError(form);
    if (section && index > 0) section.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function validateStep(stepEl) {
    let valid = true;
    let phoneInvalid = false;
    for (const input of stepEl.querySelectorAll("input[required], textarea[required]")) {
      const empty = !input.value.trim();
      const badEmail = input.type === "email" && !empty && !input.checkValidity();
      const badPhone = input.type === "tel" && !empty && !isValidFrenchPhone(input.value);
      input.classList.toggle("input-error", empty || badEmail || badPhone);
      if (badPhone) phoneInvalid = true;
      if (empty || badEmail || badPhone) valid = false;
    }
    const groupNames = new Set(
      Array.from(stepEl.querySelectorAll("input[type='radio']")).map((r) => r.name)
    );
    for (const name of groupNames) {
      if (!stepEl.querySelector(`input[type='radio'][name='${name}']:checked`)) valid = false;
    }
    return { valid, phoneInvalid };
  }
  for (const input of form.querySelectorAll("input, textarea")) {
    input.addEventListener("input", () => input.classList.remove("input-error"), { passive: true });
  }
  let fullSubmitDone = false;
  function sendAbandonmentBeacon() {
    if (fullSubmitDone) return;
    if (!config.form_action || config.form_action === "APPS_SCRIPT_URL") return;
    const fd = new FormData(form);
    const email = safeString(fd.get("email") ?? "").trim();
    if (!email) return;
    const firstName = safeString(fd.get("first_name") ?? "").trim();
    const lastName  = safeString(fd.get("last_name")  ?? "").trim();
    const rawPhone  = safeString(fd.get("phone") ?? "").trim();
    const utm = readUtmFromSession();
    const payload = {
      client_slug: safeString(config.client_slug || form.dataset.clientSlug || ""),
      offer_id:    safeString(form.dataset.offerId || config.offer_id || ""),
      visitor_name:  [firstName, lastName].filter(Boolean).join(" ") || null,
      visitor_email: email,
      visitor_phone: rawPhone ? normalizePhoneNumber(rawPhone) : null,
      formation_interest: fd.get("formation_interest")
        ? safeString(fd.get("formation_interest")).trim() : null,
      consent_marketing: form.querySelector("#consent_marketing")?.checked ?? false,
      consent_url: window.location.href,
      consent_text: document.querySelector('label[for="consent_marketing"]')?.textContent?.trim() ?? "",
      consent_timestamp: new Date().toISOString(),
      utm: {
        source:   utm.utm_source   || null,
        medium:   utm.utm_medium   || null,
        campaign: utm.utm_campaign || null,
        term:     utm.utm_term     || null,
        content:  utm.utm_content  || null
      },
      page_version: safeString(config.page_version || ""),
      partial: true,
      step: "abandoned",
      hp_trap: ""
    };
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      navigator.sendBeacon(config.form_action, blob);
      emitEvent("form_partial", { status: "beacon", step: "abandoned" });
    } catch {}
  }
  window.addEventListener("pagehide", (e) => { if (!e.persisted) sendAbandonmentBeacon(); });
  const formationVal     = form.querySelector("#formation_interest_val");
  const dropdownWrap     = form.querySelector("#formation-dropdown-wrap");
  const prefilledWrap    = form.querySelector("#formation-prefilled-wrap");
  const prefilledName    = form.querySelector("#formation-prefilled-name");
  const formationSelect  = form.querySelector("#formation_select");
  const permisDisqualif  = form.querySelector("#permis-disqualif");
  const submitBtn        = form.querySelector('button[type="submit"]');
  const sessionFormation = sessionStorage.getItem("adsvizor_formation");
  sessionStorage.removeItem("adsvizor_formation");
  if (sessionFormation && dropdownWrap && prefilledWrap) {
    dropdownWrap.hidden = true;
    dropdownWrap.style.display = "none";
    prefilledWrap.hidden = false;
    prefilledWrap.style.display = "";
    if (prefilledName) prefilledName.textContent = sessionFormation;
    if (formationVal) formationVal.value = sessionFormation;
  }
  if (!sessionFormation && formationSelect && formationVal && !formationVal.value) {
    formationSelect.value = "permis-cases";
    formationVal.value = "Permis de conduire (CACES)";
  }
  if (formationSelect) {
    formationSelect.addEventListener("change", () => {
      const val = formationSelect.value;
      const formationLabel = val === "permis-cases" ? "Permis de conduire (CACES)" : val;
      if (formationVal) formationVal.value = formationLabel;
      const isPermis = val === "permis-cases";
      if (permisDisqualif) {
        permisDisqualif.hidden = !isPermis;
        permisDisqualif.style.display = isPermis ? "" : "none";
      }
      if (submitBtn) submitBtn.disabled = isPermis;
    });
  }
  const btnNext = form.querySelector(".btn-next");
  if (btnNext) {
    btnNext.addEventListener("click", () => {
      clearFormError(form);
      const { valid, phoneInvalid } = validateStep(steps[0]);
      if (!valid) {
        if (phoneInvalid) {
          showFormError(form, "Numéro de téléphone invalide. Entrez un numéro français à 10 chiffres (ex : 06 12 34 56 78).");
        } else {
          showFormError(form, "Veuillez remplir tous les champs obligatoires.");
        }
        return;
      }
      const consentBox = form.querySelector('#consent_marketing');
      if (consentBox && !consentBox.checked) {
        showFormError(form, "Veuillez accepter d'être recontacté(e) pour continuer.");
        return;
      }
      sendAbandonmentBeacon();
      showStep(1);
    });
  }
  const btnBack = form.querySelector(".btn-back");
  if (btnBack) {
    btnBack.addEventListener("click", () => showStep(0));
  }
  const submitButton = form.querySelector('button[type="submit"]');
  const originalSubmitLabel = submitButton ? submitButton.textContent : "";
  window.addEventListener("pageshow", (evt) => {
    if (!evt.persisted || !submitButton) return;
    submitButton.disabled = false;
    submitButton.classList.remove("btn-loading");
    if (originalSubmitLabel) submitButton.textContent = originalSubmitLabel;
    clearFormError(form);
    showStep(0);
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormError(form);
    if (!config.form_action || config.form_action === "APPS_SCRIPT_URL") {
      showFormError(form, "Le formulaire n'est pas encore configuré. Veuillez réessayer plus tard.");
      return;
    }
    const honeypot = form.querySelector('input[name="hp_trap"]');
    if (honeypot && honeypot.value.trim()) return;
    const consentEl = form.querySelector('#consent_marketing');
    if (consentEl && !consentEl.checked) {
      showStep