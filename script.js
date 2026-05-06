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

// Persist UTMs to localStorage with 30-day expiry (matches Google's conversion window).
// This survives across sessions so leads who return days after clicking an ad
// still have UTM attribution in the sheet.
const UTM_LOCAL_KEY = "adsvizor_utm";
const UTM_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function readUtmFromLocal() {
  try {
    const raw = localStorage.getItem(UTM_LOCAL_KEY);
    if (!raw) return {};
    const { utm, expires } = JSON.parse(raw);
    if (!utm || Date.now() > expires) { localStorage.removeItem(UTM_LOCAL_KEY); return {}; }
    return utm;
  } catch { return {}; }
}

function persistUtmToLocal(utm) {
  try {
    const existing = readUtmFromLocal();
    // Only overwrite individual keys that have a value (don't clobber prior UTMs with blanks).
    const merged = { ...existing };
    for (const key of UTM_KEYS) {
      const value = utm[key];
      if (value && String(value).trim()) merged[key] = String(value).trim();
    }
    if (Object.keys(merged).length > 0) {
      localStorage.setItem(UTM_LOCAL_KEY, JSON.stringify({ utm: merged, expires: Date.now() + UTM_TTL_MS }));
    }
  } catch {}
}

function persistUtmToSession(utm) {
  for (const key of UTM_KEYS) {
    const value = utm[key];
    if (value && String(value).trim()) sessionStorage.setItem(key, String(value).trim());
  }
  persistUtmToLocal(utm);
}

function setHiddenUtmFields(form, utm) {
  for (const key of UTM_KEYS) {
    const input = form.querySelector(`#${key}`);
    if (input && typeof utm[key] === "string") input.value = utm[key];
  }
}

// =========================
// Phone validation
// =========================

/**
 * Strips all non-digit characters from a phone number and normalises
 * international French prefixes (+33 / 0033) back to a leading zero.
 * Examples:
 *   "+33 6 12 34 56 78"  → "0612345678"
 *   "00336 12 34 56 78"  → "0612345678"
 *   "06.12.34.56.78"     → "0612345678"
 *   "06 12 34 56 78"     → "0612345678"
 */
function normalizePhoneNumber(raw) {
  let s = (raw || "").trim();
  // Replace international French prefix with leading zero
  if (s.startsWith("+33")) {
    s = "0" + s.slice(3);
  } else if (s.startsWith("0033")) {
    s = "0" + s.slice(4);
  }
  // Remove all non-digit characters (spaces, dashes, dots, parens, etc.)
  return s.replace(/\D/g, "");
}

/**
 * Returns true if the phone number is a valid 10-digit French number
 * (starts with 0 followed by any digit 1-9).
 * Handles all common French formats and country-code prefixes automatically.
 */
function isValidFrenchPhone(raw) {
  const digits = normalizePhoneNumber(raw);
  return /^0[1-9]\d{8}$/.test(digits);
}

/**
 * Saves lead contact data to sessionStorage so thank-you.html can pass it to
 * gtag Enhanced Conversions (user_data) before the conversion event fires.
 * Silent-fails if sessionStorage is unavailable (private browsing, etc.).
 */
function saveEnhancedConversionsData(payload) {
  try {
    const phone = payload.visitor_phone || "";
    // Convert French 10-digit "0612345678" → E.164 "+33612345678" (required by Google)
    const phoneE164 = phone.startsWith("0") ? "+33" + phone.slice(1) : "";
    const nameParts = (payload.visitor_name || "").trim().split(/\s+/);
    sessionStorage.setItem("adsvizor_ec", JSON.stringify({
      email:      payload.visitor_email || "",
      phone:      phoneE164,
      first_name: nameParts[0] || "",
      last_name:  nameParts.slice(1).join(" ") || ""
    }));
  } catch (e) { /* sessionStorage unavailable — silent fail */ }
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

// =========================
// Lead persistence (localStorage safety net)
// =========================

const PENDING_LEAD_KEY = "adsvizor_pending_lead";
const PENDING_LEAD_TTL = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Persist a failed lead payload to localStorage so it can be retried
 * on the next page load, even if the user closes the tab or browser.
 */
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

/**
 * On page load: silently retry any previously failed lead.
 * - Abandoned after 48 h (stale data)
 * - Max 5 retry attempts across page loads
 * - Never blocks the UI
 */
async function retryPendingLead(formActionUrl) {
  if (!formActionUrl || formActionUrl === "APPS_SCRIPT_URL") return;
  let saved;
  try {
    const raw = localStorage.getItem(PENDING_LEAD_KEY);
    if (!raw) return;
    saved = JSON.parse(raw);
  } catch { clearPendingLead(); return; }

  if (!saved || !saved.payload) { clearPendingLead(); return; }

  // Expire after 48 h
  if (Date.now() - new Date(saved.savedAt).getTime() > PENDING_LEAD_TTL) {
    clearPendingLead(); return;
  }

  // Give up after 5 attempts
  if (saved.attempts > 5) { clearPendingLead(); return; }

  try {
    await postLead(formActionUrl, saved.payload);
    clearPendingLead();
    emitEvent("form_submit", { status: "retry_success", attempts: saved.attempts, original_error: saved.errorReason });
    console.info("[adsvizor] Pending lead retried successfully after", saved.attempts, "attempt(s).");
  } catch {
    // Still failing — increment counter, try again next load
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

  // Skip title/meta override on static pages (data-static="true") — they have hardcoded SEO content
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
  const utmFromLocal = readUtmFromLocal(); // cross-session fallback (30-day localStorage)
  // Priority: URL params > session (same tab) > localStorage (prior visit)
  const utm = { ...utmFromLocal, ...utmFromSession, ...utmFromUrl };

  persistUtmToSession(utm);
  setHiddenUtmFields(form, utm);
}

function preserveUtmOnLinks() {
  // Keeps UTM params in URL when navigating via links that opt-in.
  const utmFromUrl = parseUtmFromUrl();
  const utmFromSession = readUtmFromSession();
  const utmFromLocal = readUtmFromLocal();
  const utm = { ...utmFromLocal, ...utmFromSession, ...utmFromUrl };
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
  // Normalize phone: strip country prefix (+33/0033), spaces, dashes, etc.
  const rawPhone = fd.get("phone");
  const visitorPhone = rawPhone ? normalizePhoneNumber(safeString(rawPhone).trim()) : null;
  const visitorMessage = fd.get("message");
  const consentMarketing = fd.get("consent_marketing") === "on";

  const professionalStatus = fd.get("professional_status");

  // Capture consent proof context (RGPD)
  const consentLabelEl = document.querySelector('label[for="consent_marketing"]');
  const consentText = consentLabelEl ? consentLabelEl.textContent.trim() : "";

  // UTM: read from hidden form fields (set at page load), with sessionStorage then
  // localStorage fallback in case the DOM was rehydrated or the hidden input values
  // were somehow cleared (covers return visits days after the initial ad click).
  const storedUtm = { ...readUtmFromLocal(), ...readUtmFromSession() };
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
    consent_timestamp: new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    hp_trap: safeString(fd.get("hp_trap") ?? "").trim(), // honeypot
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

  // Apps Script ALWAYS returns HTTP 200 — even on errors.
  // We must read the JSON body and check status: "error" explicitly.
  const contentType = res.headers.get("content-type") || "";
  const bodyText = await res.text().catch(() => "");

  if (contentType.includes("application/json") || bodyText.startsWith("{")) {
    let data;
    try { data = JSON.parse(bodyText); } catch {}
    if (data && data.status === "error") {
      // "Server busy" = Apps Script lock timeout (usually caused by concurrent partial + full submit).
      // Retry once automatically after a short delay — the lock will have been released by then.
      if (attempt <= 2 && data.message && data.message.toLowerCase().includes("busy")) {
        await new Promise((r) => setTimeout(r, 3500));
        return postLead(formActionUrl, payload, attempt + 1);
      }
      // Any other Apps Script error: surface it to the user so the lead is NOT silently lost.
      throw new Error(data.message || "Erreur lors de l’enregistrement. Veuillez réessayer.");
    }
    return data;
  }

  // Non-JSON response (Apps Script HTML error page, network issue, etc.)
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
      saveEnhancedConversionsData(payload);
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
  // Returns { valid: boolean, phoneInvalid: boolean }
  function validateStep(stepEl) {
    let valid = true;
    let phoneInvalid = false;

    // Required text / email / tel inputs
    for (const input of stepEl.querySelectorAll("input[required], textarea[required]")) {
      const empty = !input.value.trim();
      const badEmail = input.type === "email" && !empty && !input.checkValidity();
      // Phone: normalize first (+33 / 0033 prefix), then validate 10-digit French format
      const badPhone = input.type === "tel" && !empty && !isValidFrenchPhone(input.value);
      input.classList.toggle("input-error", empty || badEmail || badPhone);
      if (badPhone) phoneInvalid = true;
      if (empty || badEmail || badPhone) valid = false;
    }

    // Radio groups
    const groupNames = new Set(
      Array.from(stepEl.querySelectorAll("input[type='radio']")).map((r) => r.name)
    );
    for (const name of groupNames) {
      if (!stepEl.querySelector(`input[type='radio'][name='${name}']:checked`)) valid = false;
    }

    return { valid, phoneInvalid };
  }

  // Clear error highlights when user starts typing
  for (const input of form.querySelectorAll("input, textarea")) {
    input.addEventListener("input", () => input.classList.remove("input-error"), { passive: true });
  }

  // ── Abandonment beacon (replaces fire-and-forget sendPartial) ──
  // Fires via navigator.sendBeacon on pagehide ONLY if:
  //   - user completed step 1 (has email) AND
  //   - user did NOT complete the full submit
  // sendBeacon is guaranteed to be delivered and CANNOT overlap with a full submit
  // (the user is leaving the page — they can't also be submitting the form).
  // This eliminates the concurrency/lock-timeout issue entirely.
  let fullSubmitDone = false;

  function sendAbandonmentBeacon() {
    if (fullSubmitDone) return;
    if (!config.form_action || config.form_action === "APPS_SCRIPT_URL") return;
    const fd = new FormData(form);
    const email = safeString(fd.get("email") ?? "").trim();
    if (!email) return; // step 1 not completed — nothing useful to capture
    const firstName = safeString(fd.get("first_name") ?? "").trim();
    const lastName  = safeString(fd.get("last_name")  ?? "").trim();
    const rawPhone  = safeString(fd.get("phone") ?? "").trim();
    const utm = { ...readUtmFromLocal(), ...readUtmFromSession() };
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
      consent_timestamp: new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
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
      // Blob with application/json so the Cloudflare Worker parses it correctly
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      navigator.sendBeacon(config.form_action, blob);
      emitEvent("form_partial", { status: "beacon", step: "abandoned" });
    } catch {}
  }

  // pagehide fires on real navigation/close (unlike beforeunload, works on iOS too).
  // e.persisted = true means the page is going into bfcache (back button) — skip beacon.
  window.addEventListener("pagehide", (e) => { if (!e.persisted) sendAbandonmentBeacon(); });

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

  // ── Default formation (always send a value) ──
  // If no formation was pre-filled from a CTA click, pre-select "Permis de conduire (CACES)"
  // so the hidden input always has a value when the form is submitted.
  // We do NOT trigger the disqualification UI on initial load — only on explicit user change.
  if (!sessionFormation && formationSelect && formationVal && !formationVal.value) {
    formationSelect.value = "permis-cases";
    formationVal.value = "Permis de conduire (CACES)";
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
      // Note: permis disqualification is captured by the abandonment beacon on pagehide
      // — no need to send a separate request here (avoids concurrency with full submit).
    });
  }

  // ── "Continuer" button (step 1 → step 2) ──
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
      // Consent is required to advance to step 2
      const consentBox = form.querySelector('#consent_marketing');
      if (consentBox && !consentBox.checked) {
        showFormError(form, "Veuillez accepter d'être recontacté(e) pour continuer.");
        return;
      }
      // Send partial via sendBeacon — immediate, reliable on all platforms including mobile,
      // non-blocking (browser manages it independently of the page JS thread).
      // Using sendBeacon here instead of pagehide because iOS Safari doesn't fire pagehide
      // reliably on window close. The user is guaranteed to be present at this moment.
      sendAbandonmentBeacon();
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

  // ── bfcache fix: reset button state when user navigates BACK from thank-you ──
  // When the form is submitted successfully the button enters a loading state and
  // we navigate to thank-you.html. If the user presses the browser Back button,
  // browsers restore the page from the bfcache (JS does not re-run, DOM is frozen
  // in the loading state). The "pageshow" event fires with e.persisted = true —
  // we use it to put the button back to its normal state.
  const originalSubmitLabel = submitButton ? submitButton.textContent : "";
  window.addEventListener("pageshow", (evt) => {
    if (!evt.persisted || !submitButton) return;
    submitButton.disabled = false;
    submitButton.classList.remove("btn-loading");
    if (originalSubmitLabel) submitButton.textContent = originalSubmitLabel;
    clearFormError(form);
    // Also go back to step 1 so the form is clean
    showStep(0);
  });

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
    if (!validateStep(steps[1]).valid) {
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

      // Mark full submit done BEFORE navigating so the pagehide beacon doesn't fire
      fullSubmitDone = true;
      clearPendingLead(); // clean up any previously saved pending lead on success
      emitEvent("form_submit", { status: "success", client_slug: payload.client_slug, offer_id: payload.offer_id, security_code: securityCode });
      saveEnhancedConversionsData(payload);
      window.location.href = `thank-you.html?code=${securityCode}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Une erreur est survenue. Veuillez réessayer.";
      emitEvent("form_submit", { status: "error", message });
      showFormError(form, message);
      // Persist payload to localStorage — will be retried silently on next page load
      savePendingLead(payload, message);
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

// =========================
// CPF CTA Bar
// =========================

/**
 * Injects a sticky "Vérifier mon éligibilité CPF" bar above the header
 * on all pages. On pages with a lead form (#contact): scrolls to it.
 * On other pages: links to the formations listing.
 */
function initCpfCtaBar() {
  // Don't inject on thank-you or privacy pages
  if (document.querySelector(".thankyou") || document.querySelector(".privacy-content")) return;

  let bar = document.querySelector(".cpf-cta-bar");

  if (!bar) {
    bar = document.createElement("div");
    bar.className = "cpf-cta-bar";

    const contactSection = document.getElementById("contact");

    if (contactSection) {
      const btn = document.createElement("button");
      btn.className = "cpf-cta-bar-btn";
      btn.setAttribute("type", "button");
      btn.setAttribute("data-cta-id", "cpf-cta-bar");
      btn.textContent = "Vérifier mon éligibilité CPF →";
      btn.addEventListener("click", () => {
        contactSection.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => {
          const firstInput = contactSection.querySelector("input:not([type=hidden])");
          if (firstInput) firstInput.focus({ preventScroll: true });
        }, 600);
        emitEvent("cta_click", { cta_id: "cpf-cta-bar" });
      });
      bar.appendChild(btn);
    } else {
      const link = document.createElement("a");
      link.className = "cpf-cta-bar-btn";
      link.setAttribute("href", "/formations.html");
      link.setAttribute("data-cta-id", "cpf-cta-bar");
      link.textContent = "Vérifier mon éligibilité CPF →";
      bar.appendChild(link);
    }

    const header = document.querySelector("header");
    if (header) document.body.insertBefore(bar, header);
    else document.body.prepend(bar);
  }

  // Push fixed hamburger + nav dropdown below the bar on mobile
  requestAnimationFrame(() => {
    const h = bar.offsetHeight;
    if (h > 0) document.documentElement.style.setProperty("--cpf-bar-h", h + "px");
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

    // UTM: always persist to session + localStorage; only inject into hidden fields if a form exists.
    if (form) initUtmTracking(form);
    else persistUtmToSession({ ...readUtmFromLocal(), ...readUtmFromSession(), ...parseUtmFromUrl() });

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

    // Silently retry any lead that failed on a previous page load (localStorage safety net).
    // Fire-and-forget — never blocks the UI or delays page display.
    retryPendingLead(config.form_action).catch(() => {});

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

    // Sticky CPF eligibility bar — all pages except thank-you and privacy.
    initCpfCtaBar();


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

