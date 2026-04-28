/* AdsVizor landing template script
   Responsibilities:
   1) Load client config + render {{placeholders}}
   2) Capture UTM params -> hidden fields + sessionStorage
   3) Handle lead form submit -> JSON POST -> redirect on success
   4) Emit analytics events via console.log (temporary)
*/

// =========================
// Utilities
// =========================

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
  // Temporary analytics sink
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

// =========================
// 1) LOAD CONFIG + RENDER
// =========================

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
  // Pages declare page-specific meta keys via data-page-title-key / data-page-desc-key on <html>.
  const pageTitleKey = document.documentElement.getAttribute("data-page-title-key");
  const pageDescKey  = document.documentElement.getAttribute("data-page-desc-key");

  const titleValue = (pageTitleKey && Object.prototype.hasOwnProperty.call(config, pageTitleKey))
    ? config[pageTitleKey]
    : (Object.prototype.hasOwnProperty.call(config, "meta_title") ? config.meta_title : null);
  const descValue = (pageDescKey && Object.prototype.hasOwnProperty.call(config, pageDescKey))
    ? config[pageDescKey]
    : (Object.prototype.hasOwnProperty.call(config, "meta_description") ? config.meta_description : null);

  if (titleValue !== null) document.title = safeString(titleValue);
  if (descValue !== null) setMetaContent('meta[name="description"]', descValue);

  if (Object.prototype.hasOwnProperty.call(config, "og_type")) setMetaContent('meta[property="og:type"]', config.og_type);
  if (Object.prototype.hasOwnProperty.call(config, "og_url")) setMetaContent('meta[property="og:url"]', config.og_url);
  if (Object.prototype.hasOwnProperty.call(config, "og_image_url")) setMetaContent('meta[property="og:image"]', config.og_image_url);
  if (titleValue !== null) setMetaContent('meta[property="og:title"]', titleValue);
  if (descValue !== null) setMetaContent('meta[property="og:description"]', descValue);
}

async function loadClientConfig(form) {
  // 1) Try subdomain: formations.adsvizor.com → "formations"
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  
  let clientSlug = null;
  
  // If subdomain exists (e.g. formations.adsvizor.com), but not localhost/IP addresses
  if (parts.length >= 3 && !hostname.includes('localhost') && !/^\d+/.test(hostname)) {
    clientSlug = parts[0];
  }
  
  // 2) Fallback to URL param ?client=formations
  if (!clientSlug || clientSlug === 'www') {
    const params = new URLSearchParams(window.location.search);
    clientSlug = params.get('client');
  }
  
  // 3) Fallback to form data-client-slug
  if (!clientSlug) {
    const fromForm = form?.dataset?.clientSlug;
    const isPlaceholder = typeof fromForm === 'string' && 
      (fromForm.includes('{{') || fromForm.includes('}}'));
    if (!isPlaceholder) clientSlug = fromForm;
  }
  
  // 4) Default fallback
  clientSlug = (clientSlug || 'formations').trim();
  
  // Absolute path so the fetch works regardless of the page URL (e.g. /formations/ with trailing slash).
  const url = `/clients/${encodeURIComponent(clientSlug)}/config.json`;
  return fetchJson(url);
}

// =========================
// 2) UTM TRACKING
// =========================

function initUtmTracking(form) {
  const utmFromUrl = parseUtmFromUrl();
  const utmFromSession = readUtmFromSession();
  const utm = { ...utmFromSession, ...utmFromUrl };

  persistUtmToSession(utm);
  setHiddenUtmFields(form, utm);
}

function preserveUtmOnLinks() {
  // Keeps UTM params in URL when navigating via links that opt-in.
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

    // Only preserve for same-origin or relative navigation.
    if (url.origin !== window.location.origin) continue;

    for (const key of UTM_KEYS) {
      if (!url.searchParams.get(key) && params.get(key)) url.searchParams.set(key, params.get(key));
    }
    a.setAttribute("href", url.pathname + (url.search ? url.search : "") + (url.hash ? url.hash : ""));
  }
}

// =========================
// 3) FORM HANDLING
// =========================

function buildLeadPayload(form, config) {
  const fd = new FormData(form);

  const clientSlug = safeString(config.client_slug || form.dataset.clientSlug || "");
  // Prefer per-page data-offer-id (e.g. formation detail pages) over global config.offer_id.
  const offerId = safeString(form.dataset.offerId || config.offer_id || "");

  // Support both split first/last name fields and legacy single name field.
  const firstName = safeString(fd.get("first_name") ?? "").trim();
  const lastName = safeString(fd.get("last_name") ?? "").trim();
  const visitorName = firstName || lastName
    ? [firstName, lastName].filter(Boolean).join(" ")
    : (safeString(fd.get("name") ?? "").trim() || null);

  const visitorEmail = fd.get("email");
  const visitorPhone = fd.get("phone");
  const visitorMessage = fd.get("message");
  const consentMarketing = fd.get("consent_marketing") === "on";

  const professionalStatus = fd.get("professional_status");

  // Capture consent proof context (RGPD)
  const consentLabelEl = document.querySelector('label[for="consent_marketing"]');
  const consentText = consentLabelEl ? consentLabelEl.textContent.trim() : "";

  const payload = {
    client_slug: clientSlug,
    offer_id: offerId,
    visitor_name: visitorName || null,
    visitor_email: visitorEmail ? safeString(visitorEmail).trim() : "",
    visitor_phone: visitorPhone ? safeString(visitorPhone).trim() : null,
    visitor_message: visitorMessage ? safeString(visitorMessage).trim() : null,
    professional_status: professionalStatus ? safeString(professionalStatus).trim() : null,
    utm: {
      source: fd.get("utm_source") ? safeString(fd.get("utm_source")).trim() : null,
      medium: fd.get("utm_medium") ? safeString(fd.get("utm_medium")).trim() : null,
      campaign: fd.get("utm_campaign") ? safeString(fd.get("utm_campaign")).trim() : null,
      term: fd.get("utm_term") ? safeString(fd.get("utm_term")).trim() : null,
      content: fd.get("utm_content") ? safeString(fd.get("utm_content")).trim() : null
    },
    page_version: fd.get("page_version") ? safeString(fd.get("page_version")).trim() : safeString(config.page_version || ""),
    consent_marketing: consentMarketing,
    consent_url: window.location.href,
    consent_text: consentText,
    consent_timestamp: new Date().toISOString(),
    hp_trap: safeString(fd.get("hp_trap") ?? "").trim(), // honeypot
    formation_interest: fd.get("formation_interest") ? safeString(fd.get("formation_interest")).trim() : null
  };

  return payload;
}

async function postLead(formActionUrl, payload) {
  const res = await fetch(formActionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Échec de l’envoi (HTTP ${res.status})${text ? ` — ${text}` : ""}`);
  }

  // Response may be JSON or plain text depending on Apps Script implementation.
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return res.text();
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

    // Honeypot check — bots fill hidden fields, humans don’t.
    const honeypot = form.querySelector('input[name="hp_trap"]');
    if (honeypot && honeypot.value.trim()) return;

    if (submitButton) submitButton.disabled = true;

    try {
      // Generate security code before building payload so it is included in the lead record.
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
      if (submitButton) submitButton.disabled = false;
    }
  });
}

// =========================
// 4) ANALYTICS EVENTS (console for now)
// =========================

function initCtaTracking() {
  const ctaEls = document.querySelectorAll("[data-cta-id]");
  for (const el of ctaEls) {
    el.addEventListener(
      "click",
      () => {
        emitEvent("cta_click", { cta_id: el.getAttribute("data-cta-id") });
        // Store pre-selected formation so form can auto-fill it
        const formation = el.getAttribute("data-formation");
        if (formation) sessionStorage.setItem("adsvizor_formation", formation);
      },
      { passive: true }
    );
  }
}

// =========================
// 5) FORMATION PAGES
// =========================

/**
 * Formation detail page: reads ?f=slug from URL, finds the matching formation in
 * config.cpf_formations, and injects all its fields as active_* keys into config
 * so the {{active_*}} placeholders in formation-detail.html get replaced normally.
 * Also auto-generates active_meta_title and active_meta_description for the <head>.
 * Redirects to formations.html if slug is missing or unknown.
 */
function resolveActiveFormation(config) {
  const detailContainer = document.getElementById("formation-detail-content");
  if (!detailContainer) return; // not on the detail page

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

  // Auto-generate meta title and description for the browser tab / OG tags.
  if (!config.active_meta_title) {
    config.active_meta_title = `${formation.title} — Formation CPF | ${safeString(config.logo_text || "AdsVizor")}`;
  }
  if (!config.active_meta_description) {
    config.active_meta_description = `${formation.title} : formation éligible CPF. ${safeString(formation.excerpt || "")}`;
  }
}

/**
 * Formation listing page: builds the formation card grid from config.cpf_formations
 * and injects it into <ul id="formation-list">.
 */
function renderFormationList(config) {
  const container = document.getElementById("formation-list");
  if (!container || !Array.isArray(config.cpf_formations)) return;

  const cards = config.cpf_formations.map((f, i) => {
    const rank = i + 1;
    const href = `/formation-${f.slug}.html`;
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

// =========================
// 6) STAT COUNTER ANIMATION
// =========================

function initStatCounters() {
  const strip = document.querySelector('.stats-strip');
  if (!strip || strip.hidden) return;
  const statEls = Array.from(strip.querySelectorAll('.stat strong'));
  if (!statEls.length) return;

  const parsed = statEls.map(el => {
    const text = el.textContent.trim();
    // Match optional prefix, digits (with optional space thousands separator), optional suffix
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

// =========================
// 7) MULTI-STEP FORM
// =========================

/**
 * Replaces single-step form handling.
 * Step 1 — name / phone / email: validated locally, partial payload POSTed on "Continuer".
 * Step 2 — professional status + desired training: full payload POSTed on submit.
 */
function initMultiStepForm(form, config) {
  // DOM references
  const steps      = Array.from(form.querySelectorAll(".form-step"));
  const section    = form.closest("section");
  const progressFill  = section ? section.querySelector(".form-progress-fill") : null;
  const stepLabels = section
    ? Array.from(section.querySelectorAll(".form-step-label"))
    : [];

  let currentStep = 0;

  // Force correct initial state immediately (JS inline style beats any cached CSS)
  steps.forEach((step, i) => {
    step.hidden = i !== 0;
    step.style.display = i !== 0 ? "none" : "";
  });

  // ── form_start event (fires on first interaction) ──
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

  // ── Show / hide steps + update progress UI ──
  // Uses inline style (beats any CSS rule) so mobile browsers can't override it.
  function showStep(index) {
    steps.forEach((step, i) => {
      const hide = i !== index;
      step.hidden = hide;
      step.style.display = hide ? "none" : "";   // inline style overrides all CSS
    });

    // Progress fill: 50 % at step 0, 100 % at step 1
    if (progressFill) progressFill.style.width = index === 0 ? "50%" : "100%";

    // Active label highlight
    stepLabels.forEach((lbl, i) => lbl.classList.toggle("is-active", i === index));

    currentStep = index;
    clearFormError(form);

    // On mobile, scroll the form card into view when advancing
    if (section && index > 0) section.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ── Client-side validation for a single step ──
  // Note: no input.focus() calls — on iOS they scroll the page and make it look
  // like the button did nothing. Invalid fields are highlighted via CSS instead.
  function validateStep(stepEl) {
    let valid = true;

    // Required text / email / tel inputs
    for (const input of stepEl.querySelectorAll("input[required], textarea[required]")) {
      const empty = !input.value.trim();
      const badEmail = input.type === "email" && !empty && !input.checkValidity();
      input.classList.toggle("input-error", empty || badEmail);
      if (empty || badEmail) valid = false;
    }

    // Radio groups
    const groupNames = new Set(
      Array.from(stepEl.querySelectorAll("input[type='radio']")).map((r) => r.name)
    );
    for (const name of groupNames) {
      if (!stepEl.querySelector(`input[type='radio'][name='${name}']:checked`)) valid = false;
    }

    return valid;
  }

  // Clear error highlights when user starts typing
  for (const input of form.querySelectorAll("input, textarea")) {
    input.addEventListener("input", () => input.classList.remove("input-error"), { passive: true });
  }

  // ── Fire-and-forget partial POST (step 1 data) ──
  function sendPartial() {
    if (!config.form_action || config.form_action === "APPS_SCRIPT_URL") return;
    try {
      const fd = new FormData(form);
      const firstName = safeString(fd.get("first_name") ?? "").trim();
      const lastName  = safeString(fd.get("last_name")  ?? "").trim();
      const utm = readUtmFromSession();
      const payload = {
        client_slug: safeString(config.client_slug || form.dataset.clientSlug || ""),
        offer_id:    safeString(form.dataset.offerId || config.offer_id || ""),
        visitor_name:  [firstName, lastName].filter(Boolean).join(" ") || null,
        visitor_email: safeString(fd.get("email") ?? "").trim() || null,
        visitor_phone: safeString(fd.get("phone") ?? "").trim() || null,
        formation_interest: fd.get("formation_interest")
          ? safeString(fd.get("formation_interest")).trim() : null,
        consent_marketing: form.querySelector('#consent_marketing')?.checked ?? false,
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
        step: 1,
        hp_trap: ""
      };
      // Fire-and-forget — never block the UI, but log failures for debugging
      postLead(config.form_action, payload)
        .then(() => emitEvent("form_partial", { status: "success", step: 1 }))
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          emitEvent("form_partial", { status: "error", step: 1, message: msg });
          console.warn("[adsvizor] Partial lead send failed (step 1):", msg);
        });
    } catch (err) {
      console.warn("[adsvizor] sendPartial setup error:", err);
    }
  }

  // ── Formation pre-select (from data-formation CTA click) ──
  const formationVal     = form.querySelector("#formation_interest_val");
  const dropdownWrap     = form.querySelector("#formation-dropdown-wrap");
  const prefilledWrap    = form.querySelector("#formation-prefilled-wrap");
  const prefilledName    = form.querySelector("#formation-prefilled-name");
  const formationSelect  = form.querySelector("#formation_select");
  const permisDisqualif  = form.querySelector("#permis-disqualif");
  const submitBtn        = form.querySelector('button[type="submit"]');

  // Apply any formation stored in session (set by CTA click)
  // Read and immediately clear — one-time-use only (avoids stale value on next visit)
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

  // Sync dropdown → hidden input + handle permis disqualification
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

      // Auto-send when permis selected — captures the disqualification in the sheet
      if (isPermis && config.form_action && config.form_action !== "APPS_SCRIPT_URL") {
        const fd = new FormData(form);
        const firstName = safeString(fd.get("first_name") ?? "").trim();
        const lastName  = safeString(fd.get("last_name")  ?? "").trim();
        const utm = readUtmFromSession();
        const payload = {
          client_slug:       safeString(config.client_slug || form.dataset.clientSlug || ""),
          offer_id:          safeString(form.dataset.offerId || config.offer_id || ""),
          visitor_name:      [firstName, lastName].filter(Boolean).join(" ") || null,
          visitor_email:     safeString(fd.get("email") ?? "").trim() || null,
          visitor_phone:     safeString(fd.get("phone") ?? "").trim() || null,
          formation_interest: "Permis de conduire (CACES)",
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
          step: "permis-disqualif",
          hp_trap: ""
        };
        postLead(config.form_action, payload)
          .then(() => emitEvent("form_partial", { status: "success", step: "permis-disqualif" }))
          .catch((err) => console.warn("[adsvizor] Permis partial send failed:", err));
      }
    });
  }

  // ── "Continuer" button (step 1 → step 2) ──
  const btnNext = form.querySelector(".btn-next");
  if (btnNext) {
    btnNext.addEventListener("click", () => {
      clearFormError(form);
      if (!validateStep(steps[0])) {
        showFormError(form, "Veuillez remplir tous les champs obligatoires.");
        return;
      }
      // Consent is required to advance to step 2
      const consentBox = form.querySelector('#consent_marketing');
      if (consentBox && !consentBox.checked) {
        showFormError(form, "Veuillez accepter d'être recontacté(e) pour continuer.");
        return;
      }
      sendPartial();   // capture step-1 data (incl. consent) even if user abandons
      showStep(1);
    });
  }

  // ── "← Retour" button (step 2 → step 1) ──
  const btnBack = form.querySelector(".btn-back");
  if (btnBack) {
    btnBack.addEventListener("click", () => showStep(0));
  }

  // ── Final submit (step 2) ──
  const submitButton = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormError(form);

    if (!config.form_action || config.form_action === "APPS_SCRIPT_URL") {
      showFormError(form, "Le formulaire n'est pas encore configuré. Veuillez réessayer plus tard.");
      return;
    }

    // Honeypot — bots fill it, humans don't
    const honeypot = form.querySelector('input[name="hp_trap"]');
    if (honeypot && honeypot.value.trim()) return;

    // Consent check (checkbox is in step 1, required for submit)
    const consentEl = form.querySelector('#consent_marketing');
    if (consentEl && !consentEl.checked) {
      showStep(0);
      showFormError(form, "Veuillez accepter d'être recontacté(e) avant d'envoyer votre demande.");
      return;
    }

    // Validate step 2 fields (status radio is checked via JS)
    if (!validateStep(steps[1])) {
      showFormError(form, "Veuillez sélectionner votre statut professionnel.");
      return;
    }

    if (submitButton) submitButton.disabled = true;

    try {
      const securityCode = String(Math.floor(100000 + Math.random() * 900000));
      const payload = buildLeadPayload(form, config);
      payload.security_code = securityCode;

      emitEvent("form_submit", {
        status:       "attempt",
        client_slug:  payload.client_slug,
        offer_id:     payload.offer_id,
        page_version: payload.page_version,
        utm_source:   payload.utm.source,
        utm_medium:   payload.utm.medium,
        utm_campaign: payload.utm.campaign,
        utm_term:     payload.utm.term,
        utm_content:  payload.utm.content
      });

      // Show loading animation while Apps Script processes
      if (submitButton) {
        submitButton.classList.add("btn-loading");
        submitButton.textContent = "";
      }

      await postLead(config.form_action, payload);

      emitEvent("form_submit", { status: "success", client_slug: payload.client_slug, offer_id: payload.offer_id, security_code: securityCode });
      window.location.href = `thank-you.html?code=${securityCode}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Une erreur est survenue. Veuillez réessayer.";
      emitEvent("form_submit", { status: "error", message });
      showFormError(form, message);
      if (submitButton) submitButton.disabled = false;
    }
  });
}

// =========================
// Boot
// =========================

async function init() {
  try {
    const form = document.querySelector("form[data-client-slug]");

    emitEvent("page_view", { path: window.location.pathname, has_form: Boolean(form) });
    initCtaTracking();

    // UTM: always persist to session; only inject into hidden fields if a form exists.
    if (form) initUtmTracking(form);
    else persistUtmToSession({ ...readUtmFromSession(), ...parseUtmFromUrl() });

    const config = await loadClientConfig(form);

    // Inject active_* keys for formation detail page BEFORE placeholder rendering.
    resolveActiveFormation(config);

    // Apply config values to head first (title/meta), then render placeholders.
    applyConfigToHead(config);
    walkAndReplaceTextNodes(document.body, config);
    replacePlaceholdersInAttributes(document.body, config);

    // Hide nav items whose label rendered to empty.
    for (const li of document.querySelectorAll("nav li")) {
      const a = li.querySelector("a");
      if (a && !a.textContent.trim()) li.hidden = true;
    }

    // Hide optional sections based on config flags.
    if (config.show_stats === false) {
      const el = document.querySelector(".stats-strip");
      if (el) el.hidden = true;
    }
    if (config.show_testimonials === false) {
      const el = document.querySelector("[aria-labelledby='testimonials-title']");
      if (el) el.hidden = true;
    }

    // Init multi-step form BEFORE body.ready so steps are in the right state
    // when the page becomes visible (prevents flash of both steps showing).
    if (form) initMultiStepForm(form, config);

    document.body.classList.add("ready");

    // Build formation card grid on the listing page.
    renderFormationList(config);

    // Animate stat counters once the strip scrolls into view.
    initStatCounters();

    // After placeholders: ensure UTM-preserving links get updated (e.g., thank-you CTA).
    preserveUtmOnLinks();

    // Display security code on the thank-you page if present in URL.
    const securityCodeParam = new URLSearchParams(window.location.search).get("code");
    if (securityCodeParam && /^\d{6}$/.test(securityCodeParam)) {
      const block = document.getElementById("security-code-block");
      const valueEl = document.getElementById("security-code-value");
      if (block && valueEl) {
        valueEl.textContent = securityCodeParam;
        block.hidden = false;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Impossible de charger la configuration.";
    emitEvent("page_view", { status: "config_error", message });
    document.body.classList.add("ready");

    const form = document.querySelector("form[data-client-slug]");
    if (form) showFormError(form, message);
    else console.error("[adsvizor_config_error]", message, err);
  }
}

function initMobileNav() {
  const toggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector("header nav");
  if (!toggle || !nav) return;

  toggle.addEventListener("click", () => {
    const isOpen = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!isOpen));
    nav.classList.toggle("is-open", !isOpen);
  });

  // Close on nav link click
  nav.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", () => {
      toggle.setAttribute("aria-expanded", "false");
      nav.classList.remove("is-open");
    });
  });

  // Close on outside click (ignore clicks on the toggle button itself and inside the nav)
  document.addEventListener("click", (e) => {
    if (e.target.closest(".nav-toggle")) return;
    if (e.target.closest("header nav")) return;
    if (nav.classList.contains("is-open")) {
      toggle.setAttribute("aria-expanded", "false");
      nav.classList.remove("is-open");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initMobileNav();
  init().catch((err) => {
    const message = err instanceof Error ? err.message : "Erreur inattendue.";
    console.error("[adsvizor_init_error]", message, err);
  });
});

