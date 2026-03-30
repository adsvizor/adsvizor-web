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
  const clientSlug = form?.dataset?.clientSlug;
  if (!clientSlug) throw new Error("Missing data-client-slug on the lead form.");
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

// =========================
// 3) FORM HANDLING
// =========================

function buildLeadPayload(form, config) {
  const fd = new FormData(form);

  const clientSlug = safeString(config.client_slug || form.dataset.clientSlug || "");
  const offerId = safeString(config.offer_id || form.dataset.offerId || "");

  const visitorName = fd.get("name");
  const visitorEmail = fd.get("email");
  const visitorPhone = fd.get("phone");
  const visitorMessage = fd.get("message");

  const payload = {
    client_slug: clientSlug,
    offer_id: offerId,
    visitor_name: visitorName ? safeString(visitorName).trim() : null,
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
    consent_marketing: null
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

    if (submitButton) submitButton.disabled = true;

    try {
      const payload = buildLeadPayload(form, config);

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

      emitEvent("form_submit", { status: "success", client_slug: payload.client_slug, offer_id: payload.offer_id });
      window.location.href = "thank-you.html";
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
  const form = document.querySelector("form[data-client-slug]");
  if (!form) {
    emitEvent("page_view", { status: "no_form_found" });
    return;
  }

  emitEvent("page_view", { path: window.location.pathname });

  initCtaTracking();
  initUtmTracking(form);

  try {
    const config = await loadClientConfig(form);

    // Apply config values to head first (title/meta), then render placeholders.
    applyConfigToHead(config);
    walkAndReplaceTextNodes(document.body, config);
    replacePlaceholdersInAttributes(document.body, config);

    // After placeholders: the form dataset may have changed, but we use config as source of truth.
    initFormHandling(form, config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Impossible de charger la configuration.";
    emitEvent("page_view", { status: "config_error", message });
    showFormError(form, message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => {
    const message = err instanceof Error ? err.message : "Erreur inattendue.";
    console.error("[adsvizor_init_error]", message, err);
  });
});

