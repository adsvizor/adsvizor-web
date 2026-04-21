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
  if (Object.prototype.hasOwnProperty.call(config, "meta_title")) document.title = safeString(config.meta_title);
  if (Object.prototype.hasOwnProperty.call(config, "meta_description")) {
    setMetaContent('meta[name="description"]', config.meta_description);
  }

  if (Object.prototype.hasOwnProperty.call(config, "og_type")) setMetaContent('meta[property="og:type"]', config.og_type);
  if (Object.prototype.hasOwnProperty.call(config, "og_url")) setMetaContent('meta[property="og:url"]', config.og_url);
  if (Object.prototype.hasOwnProperty.call(config, "og_image_url")) setMetaContent('meta[property="og:image"]', config.og_image_url);

  // Keep OG title/description aligned with main meta if present
  const title = Object.prototype.hasOwnProperty.call(config, "meta_title") ? config.meta_title : getMetaContent('meta[property="og:title"]');
  const desc = Object.prototype.hasOwnProperty.call(config, "meta_description")
    ? config.meta_description
    : getMetaContent('meta[property="og:description"]');
  if (title !== null) setMetaContent('meta[property="og:title"]', title);
  if (desc !== null) setMetaContent('meta[property="og:description"]', desc);
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
  
  const url = `clients/${encodeURIComponent(clientSlug)}/config.json`;
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
  const offerId = safeString(config.offer_id || form.dataset.offerId || "");

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

  const payload = {
    client_slug: clientSlug,
    offer_id: offerId,
    visitor_name: visitorName || null,
    visitor_email: visitorEmail ? safeString(visitorEmail).trim() : "",
    visitor_phone: visitorPhone ? safeString(visitorPhone).trim() : null,
    visitor_message: visitorMessage ? safeString(visitorMessage).trim() : null,
    utm: {
      source: fd.get("utm_source") ? safeString(fd.get("utm_source")).trim() : null,
      medium: fd.get("utm_medium") ? safeString(fd.get("utm_medium")).trim() : null,
      campaign: fd.get("utm_campaign") ? safeString(fd.get("utm_campaign")).trim() : null,
      term: fd.get("utm_term") ? safeString(fd.get("utm_term")).trim() : null,
      content: fd.get("utm_content") ? safeString(fd.get("utm_content")).trim() : null
    },
    page_version: fd.get("page_version") ? safeString(fd.get("page_version")).trim() : safeString(config.page_version || ""),
    consent_marketing: consentMarketing,
    website: safeString(fd.get("website") ?? "").trim() // honeypot
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
    const honeypot = form.querySelector('input[name="website"]');
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
      },
      { passive: true }
    );
  }
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
    if (config.show_testimonials === false) {
      const el = document.querySelector("[aria-labelledby='testimonials-title']");
      if (el) el.hidden = true;
    }

    document.body.classList.add("ready");

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

    // Form handling only applies on pages that include a form.
    if (form) initFormHandling(form, config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Impossible de charger la configuration.";
    emitEvent("page_view", { status: "config_error", message });
    document.body.classList.add("ready");

    const form = document.querySelector("form[data-client-slug]");
    if (form) showFormError(form, message);
    else console.error("[adsvizor_config_error]", message, err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => {
    const message = err instanceof Error ? err.message : "Erreur inattendue.";
    console.error("[adsvizor_init_error]", message, err);
  });
});

