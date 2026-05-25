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
const UTM_LOCAL_KEY = "adsvizor_utm";
const UTM_TTL_MS = 30 * 24 * 60 * 60 * 1000;
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
function saveEnhancedConversionsData(payload) {
try {
const phone = payload.visitor_phone || "";
const phoneE164 = phone.startsWith("0") ? "+33" + phone.slice(1) : "";
const nameParts = (payload.visitor_name || "").trim().split(/\s+/);
sessionStorage.setItem("adsvizor_ec", JSON.stringify({
email:      payload.visitor_email || "",
phone:      phoneE164,
first_name: nameParts[0] || "",
last_name:  nameParts.slice(1).join(" ") || ""
}));
} catch (e) {  }
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
// Don't save if lead has no useful visitor data — avoids replaying empty leads
const hasData = payload && (payload.visitor_phone || payload.visitor_name || payload.visitor_email);
if (!hasData) return;
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
const utmFromLocal = readUtmFromLocal();
const utm = { ...utmFromLocal, ...utmFromSession, ...utmFromUrl };
persistUtmToSession(utm);
setHiddenUtmFields(form, utm);
const sqFromUrl = new URLSearchParams(window.location.search).get("search_query");
const sqStored  = sessionStorage.getItem("adsvizor_search_query");
const searchQuery = (sqFromUrl && sqFromUrl.trim()) || sqStored || null;
if (sqFromUrl && sqFromUrl.trim()) sessionStorage.setItem("adsvizor_search_query", sqFromUrl.trim());
const sqInput = form.querySelector("#search_query");
if (sqInput && searchQuery) sqInput.value = searchQuery;
}
function preserveUtmOnLinks() {
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
const consentMarketing = fd.get("consent_marketing") === "on"
|| fd.get("consent_marketing") === "true";
const professionalStatus = fd.get("professional_status");
const consentLabelEl = document.querySelector('label[for="consent_marketing"]')
|| document.querySelector('.f3-consent-text');
const consentText = consentLabelEl ? consentLabelEl.textContent.trim() : "";
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
hp_trap: safeString(fd.get("hp_trap") ?? "").trim(),
formation_interest: fd.get("formation_interest") ? safeString(fd.get("formation_interest")).trim() : null,
search_query: fd.get("search_query")
? safeString(fd.get("search_query")).trim() || null
: (sessionStorage.getItem("adsvizor_search_query") || null)
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
search_query: sessionStorage.getItem("adsvizor_search_query") || null,
partial: true,
step: "abandoned",
hp_trap: ""
};
try {
fetch(config.form_action, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(payload),
keepalive: true
}).catch(() => {});
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
showStep(0);
showFormError(form, "Veuillez accepter d'être recontacté(e) avant d'envoyer votre demande.");
return;
}
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
if (submitButton) {
submitButton.classList.add("btn-loading");
submitButton.textContent = "";
}
await postLead(config.form_action, payload);
fullSubmitDone = true;
clearPendingLead();
emitEvent("form_submit", { status: "success", client_slug: payload.client_slug, offer_id: payload.offer_id, security_code: securityCode });
saveEnhancedConversionsData(payload);
window.location.href = `thank-you.html?code=${securityCode}`;
} catch (err) {
const message = err instanceof Error ? err.message : "Une erreur est survenue. Veuillez réessayer.";
emitEvent("form_submit", { status: "error", message });
showFormError(form, message);
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
function initSimpleForm(form, config) {
const formationVal    = form.querySelector("#formation_interest_val");
const formationSelect = form.querySelector("#formation_select");
if (formationSelect && formationVal) {
formationSelect.addEventListener("change", () => {
formationVal.value = formationSelect.value;
});
const sessionFormation = sessionStorage.getItem("adsvizor_formation");
sessionStorage.removeItem("adsvizor_formation");
if (sessionFormation) {
for (const opt of formationSelect.options) {
if (opt.value === sessionFormation) { formationSelect.value = sessionFormation; break; }
}
formationVal.value = sessionFormation;
}
}
const formStartOnce = (() => {
let fired = false;
return () => {
if (fired) return;
fired = true;
emitEvent("form_start", { client_slug: config.client_slug, offer_id: form.dataset.offerId || config.offer_id });
};
})();
for (const el of form.querySelectorAll("input, select")) {
el.addEventListener("focus",  formStartOnce, { passive: true });
el.addEventListener("input",  formStartOnce, { passive: true });
el.addEventListener("change", formStartOnce, { passive: true });
}
for (const el of form.querySelectorAll("input, select")) {
el.addEventListener("input",  () => el.classList.remove("input-error"), { passive: true });
el.addEventListener("change", () => el.classList.remove("input-error"), { passive: true });
}
const submitBtn    = form.querySelector('button[type="submit"]');
const originalLabel = submitBtn ? submitBtn.textContent : "";
window.addEventListener("pageshow", (e) => {
if (!e.persisted || !submitBtn) return;
submitBtn.disabled = false;
submitBtn.classList.remove("btn-loading");
if (originalLabel) submitBtn.textContent = originalLabel;
clearFormError(form);
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
const consentEl = form.querySelector("#consent_marketing");
if (consentEl && !consentEl.checked) {
showFormError(form, "Veuillez accepter d'être recontacté(e) pour continuer.");
return;
}
let valid = true, phoneInvalid = false;
for (const inp of form.querySelectorAll("input[required]")) {
const empty    = !inp.value.trim();
const badPhone = inp.type === "tel" && !empty && !isValidFrenchPhone(inp.value);
inp.classList.toggle("input-error", empty || badPhone);
if (badPhone) phoneInvalid = true;
if (empty || badPhone) valid = false;
}
const hiddenFormation = form.querySelector('input[name="formation_interest"]');
const hasHiddenValue  = hiddenFormation && hiddenFormation.value.trim();
if (formationSelect && !hasHiddenValue && !formationSelect.value) {
formationSelect.classList.add("input-error");
valid = false;
}
if (!valid) {
showFormError(form, phoneInvalid
? "Numéro de téléphone invalide. Entrez un numéro français à 10 chiffres (ex : 06 12 34 56 78)."
: "Veuillez remplir tous les champs obligatoires.");
return;
}
if (formationSelect && formationVal && formationSelect.value) {
formationVal.value = formationSelect.value;
}
if (submitBtn) {
submitBtn.disabled = true;
submitBtn.classList.add("btn-loading");
submitBtn.textContent = "";
}
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
await postLead(config.form_action, payload);
saveEnhancedConversionsData(payload);
emitEvent("form_submit", { status: "success", client_slug: payload.client_slug, offer_id: payload.offer_id, security_code: securityCode });
window.location.href = `thank-you.html?code=${securityCode}`;
} catch (err) {
const message = err instanceof Error ? err.message : "Une erreur est survenue. Veuillez réessayer.";
emitEvent("form_submit", { status: "error", message });
showFormError(form, message);
savePendingLead(buildLeadPayload(form, config), message);
if (submitBtn) {
submitBtn.disabled = false;
submitBtn.classList.remove("btn-loading");
if (originalLabel) submitBtn.textContent = originalLabel;
}
}
});
}
function initForm3(form, config) {
let lastResultStep = '3b';
const STEPPER_STATES = {
'0':  [null,     null,     null],
'1':  ['active', null,     null],
'2':  ['done',   'active', null],
'3a': ['done',   'done',   'active'],
'3b': ['done',   'done',   'active'],
'4':  ['done',   'done',   'active'],
};
const stepperEl = form.querySelector('.f3-stepper');
function updateStepper(sid) {
if (!stepperEl) return;
const states = STEPPER_STATES[sid] || [null, null, null];
stepperEl.classList.toggle('f3-stepper--hidden', sid === '0');
stepperEl.querySelectorAll('.f3-stepper-step').forEach((el, i) => {
el.classList.remove('active', 'done');
if (states[i]) el.classList.add(states[i]);
});
stepperEl.querySelectorAll('.f3-stepper-line').forEach((el, i) => {
el.classList.toggle('done', states[i] === 'done');
});
}
function showStep(id, scroll = true) {
const sid = String(id);
form.querySelectorAll('.f3-step').forEach(s => {
const show = s.dataset.step === sid;
s.hidden = !show;
s.style.display = show ? '' : 'none';
});
updateStepper(sid);
clearFormError(form);
if (scroll) {
const card = form.closest('section');
if (card && window.innerWidth < 768) {
setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}
}
}
const recallCheckbox = form.querySelector('#f3_recall');
const btnTo1 = form.querySelector('[data-action="to-1"]');
if (recallCheckbox && btnTo1) {
recallCheckbox.addEventListener('change', () => {
btnTo1.disabled = !recallCheckbox.checked;
});
}
const btnTo2 = form.querySelector('[data-action="to-2"]');
form.querySelectorAll('[name="formation_choice"]').forEach(r => {
r.addEventListener('change', () => { if (btnTo2) btnTo2.disabled = false; });
});
const preselectFormation = form.dataset.preselectFormation;
if (preselectFormation) {
const matchingRadio = form.querySelector(`[name="formation_choice"][value="${preselectFormation}"]`);
if (matchingRadio) {
matchingRadio.checked = true;
const hiddenF = form.querySelector('#formation_interest_val');
if (hiddenF) {
hiddenF.value = preselectFormation === 'permis-cases'
? 'Permis de conduire / CACES'
: preselectFormation;
}
if (btnTo2) btnTo2.disabled = false;
}
}
const btnResult = form.querySelector('[data-action="result"]');
form.querySelectorAll('[name="professional_status"]').forEach(r => {
r.addEventListener('change', () => { if (btnResult) btnResult.disabled = false; });
});
form.addEventListener('click', e => {
const btn = e.target.closest('[data-action]');
if (!btn || btn.type === 'submit' || btn.disabled) return;
const action = btn.dataset.action;
if (action === 'to-1')      { showStep('1'); return; }
if (action === 'to-2') {
const f4Formation = form.querySelector('[name="formation_choice"]:checked')?.value || '';
sendPartialLead(form, config, '1', {
formation_interest: f4Formation === 'permis-cases' ? 'Permis de conduire / CACES' : f4Formation,
});
showStep('2'); return;
}
if (action === 'to-4')      { showStep('4'); return; }
if (action === 'back-to-0') { showStep('0'); return; }
if (action === 'back-to-1') { showStep('1'); return; }
if (action === 'back-to-2') { showStep('2'); return; }
if (action === 'back-to-3') { showStep(lastResultStep); return; }
if (action === 'result') {
const status    = form.querySelector('[name="professional_status"]:checked')?.value;
const formation = form.querySelector('[name="formation_choice"]:checked')?.value;
const hiddenF = form.querySelector('#formation_interest_val');
if (hiddenF) {
hiddenF.value = formation === 'permis-cases'
? 'Permis de conduire / CACES'
: (formation || '');
}
const ineligible = status === 'etudiant'
|| status === 'fonction_publique'
|| formation === 'permis-cases';
lastResultStep = ineligible ? '3a' : '3b';
showStep(lastResultStep);
}
});
const formStartOnce = (() => {
let fired = false;
return () => {
if (fired) return; fired = true;
emitEvent('form_start', { client_slug: config.client_slug, offer_id: form.dataset.offerId || config.offer_id });
};
})();
form.querySelectorAll('input, select').forEach(el => {
el.addEventListener('focus',  formStartOnce, { passive: true });
el.addEventListener('change', formStartOnce, { passive: true });
});
form.querySelectorAll('input').forEach(el => {
el.addEventListener('input', () => el.classList.remove('input-error'), { passive: true });
});
const submitBtn     = form.querySelector('button[type="submit"]');
const originalLabel = submitBtn?.textContent || '';
window.addEventListener('pageshow', e => {
if (!e.persisted || !submitBtn) return;
submitBtn.disabled = false;
submitBtn.classList.remove('btn-loading');
if (originalLabel) submitBtn.textContent = originalLabel;
clearFormError(form);
showStep('0', false);
if (recallCheckbox) recallCheckbox.checked = false;
if (btnTo1) btnTo1.disabled = true;
});
form.addEventListener('submit', async e => {
e.preventDefault();
clearFormError(form);
if (!config.form_action || config.form_action === 'APPS_SCRIPT_URL') {
showFormError(form, "Le formulaire n'est pas encore configuré.");
return;
}
const honeypot = form.querySelector('input[name="hp_trap"]');
if (honeypot?.value.trim()) return;
let valid = true, phoneInvalid = false;
for (const inp of form.querySelectorAll('input[required]')) {
const empty    = !inp.value.trim();
const badPhone = inp.type === 'tel' && !empty && !isValidFrenchPhone(inp.value);
inp.classList.toggle('input-error', empty || badPhone);
if (badPhone) phoneInvalid = true;
if (empty || badPhone) valid = false;
}
if (!valid) {
showFormError(form, phoneInvalid
? 'Numéro de téléphone invalide. Entrez un numéro français à 10 chiffres (ex : 06 12 34 56 78).'
: 'Veuillez remplir tous les champs obligatoires.');
return;
}
if (submitBtn) {
submitBtn.disabled = true;
submitBtn.classList.add('btn-loading');
submitBtn.textContent = '';
}
try {
const securityCode = String(Math.floor(100000 + Math.random() * 900000));
const payload = buildLeadPayload(form, config);
payload.security_code = securityCode;
emitEvent('form_submit', {
status:       'attempt',
client_slug:  payload.client_slug,
offer_id:     payload.offer_id,
page_version: payload.page_version,
utm_source:   payload.utm.source,
utm_medium:   payload.utm.medium,
utm_campaign: payload.utm.campaign,
utm_term:     payload.utm.term,
utm_content:  payload.utm.content
});
await postLead(config.form_action, payload);
saveEnhancedConversionsData(payload);
emitEvent('form_submit', { status: 'success', client_slug: payload.client_slug, security_code: securityCode });
window.location.href = `thank-you.html?code=${securityCode}`;
} catch (err) {
const message = err instanceof Error ? err.message : 'Une erreur est survenue. Veuillez réessayer.';
emitEvent('form_submit', { status: 'error', message });
showFormError(form, message);
savePendingLead(buildLeadPayload(form, config), message);
if (submitBtn) {
submitBtn.disabled = false;
submitBtn.classList.remove('btn-loading');
if (originalLabel) submitBtn.textContent = originalLabel;
}
}
});
showStep('0', false);
}
async function sendPartialLead(form, config, step, extraData) {
if (!config.form_action || config.form_action === 'APPS_SCRIPT_URL') return;
try {
const utm = {};
['source','medium','campaign','term','content'].forEach(k => {
const el = form.querySelector('#utm_' + k);
utm[k] = el ? el.value : '';
});
const sqEl = form.querySelector('#search_query');
const payload = {
partial:           true,
partial_step:      step,
client_slug:       config.client_slug || '',
offer_id:          config.offer_id    || form.dataset.offerId || '',
page_version:      config.page_version || '',
consent_url:       window.location.href,
consent_timestamp: new Date().toISOString(),
consent_text:      'partial',
utm,
search_query: sqEl ? sqEl.value : '',
...extraData,
};
await postLead(config.form_action, payload);
} catch (_) {  }
}
function initForm4(form, config) {
let lastResultStep = '3b';
const STEPPER_STATES = {
'1':  ['active', null,     null],
'2':  ['done',   'active', null],
'3a': ['done',   'done',   'active'],
'3b': ['done',   'done',   'active'],
'4':  ['done',   'done',   'active'],
};
const stepperEl = form.querySelector('.f3-stepper');
function updateStepper(sid) {
if (!stepperEl) return;
const states = STEPPER_STATES[sid] || [null, null, null];
stepperEl.classList.remove('f3-stepper--hidden');
stepperEl.querySelectorAll('.f3-stepper-step').forEach((el, i) => {
el.classList.remove('active', 'done');
if (states[i]) el.classList.add(states[i]);
});
stepperEl.querySelectorAll('.f3-stepper-line').forEach((el, i) => {
el.classList.toggle('done', states[i] === 'done');
});
}
function showStep(id, scroll = true) {
const sid = String(id);
form.querySelectorAll('.f3-step').forEach(s => {
const show = s.dataset.step === sid;
s.hidden = !show;
s.style.display = show ? '' : 'none';
});
updateStepper(sid);
clearFormError(form);
if (scroll) {
const card = form.closest('section');
if (card && window.innerWidth < 768) {
setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}
}
}
const step0 = form.querySelector('.f3-step[data-step="0"]');
if (step0) { step0.hidden = true; step0.style.display = 'none'; }
const backTo0Btn = form.querySelector('[data-action="back-to-0"]');
if (backTo0Btn) { backTo0Btn.hidden = true; backTo0Btn.style.display = 'none'; }
const step4 = form.querySelector('.f3-step[data-step="4"]');
if (step4) {
const emailInput = step4.querySelector('#email');
if (emailInput) {
const emailWrap = emailInput.closest('div');
if (emailWrap) emailWrap.remove();
}
const hiddenConsent = step4.querySelector('input[name="consent_marketing"]');
if (hiddenConsent) hiddenConsent.remove();
const consentLabel = document.createElement('label');
consentLabel.className = 'f3-checkbox-row';
consentLabel.innerHTML =
'<input type="checkbox" id="f4_consent" name="consent_marketing" />'
+ '<span class="f3-consent-text">J’accepte d’être recontacté(e) par un conseiller en formations pour vérifier mes droits CPF.</span>';
const btnRow4 = step4.querySelector('.f3-btn-row');
if (btnRow4) step4.insertBefore(consentLabel, btnRow4);
else step4.appendChild(consentLabel);
const submitBtn4 = step4.querySelector('button[type="submit"]');
if (submitBtn4) submitBtn4.textContent = 'Recevoir un conseil Gratuit';
}
const btn3bTo4 = form.querySelector('.f3-step[data-step="3b"] [data-action="to-4"]');
if (btn3bTo4) btn3bTo4.textContent = 'Étape suivante →';
const btn3aTo4 = form.querySelector('.f3-step[data-step="3a"] [data-action="to-4"]');
if (btn3aTo4) btn3aTo4.textContent = 'Étape suivante →';
const btnTo2 = form.querySelector('[data-action="to-2"]');
form.querySelectorAll('[name="formation_choice"]').forEach(r => {
r.addEventListener('change', () => { if (btnTo2) btnTo2.disabled = false; });
});
const preselectFormation = form.dataset.preselectFormation;
if (preselectFormation) {
const matchingRadio = form.querySelector(`[name="formation_choice"][value="${preselectFormation}"]`);
if (matchingRadio) {
matchingRadio.checked = true;
const hiddenF = form.querySelector('#formation_interest_val');
if (hiddenF) {
hiddenF.value = preselectFormation === 'permis-cases'
? 'Permis de conduire / CACES'
: preselectFormation;
}
if (btnTo2) btnTo2.disabled = false;
}
}
const btnResult = form.querySelector('[data-action="result"]');
form.querySelectorAll('[name="professional_status"]').forEach(r => {
r.addEventListener('change', () => { if (btnResult) btnResult.disabled = false; });
});
form.addEventListener('click', e => {
const btn = e.target.closest('[data-action]');
if (!btn || btn.type === 'submit' || btn.disabled) return;
const action = btn.dataset.action;
if (action === 'to-2')      { showStep('2'); return; }
if (action === 'to-4')      { showStep('4'); return; }
if (action === 'back-to-1') { showStep('1'); return; }
if (action === 'back-to-2') { showStep('2'); return; }
if (action === 'back-to-3') { showStep(lastResultStep); return; }
if (action === 'result') {
const status    = form.querySelector('[name="professional_status"]:checked')?.value;
const formation = form.querySelector('[name="formation_choice"]:checked')?.value;
const hiddenF = form.querySelector('#formation_interest_val');
if (hiddenF) {
hiddenF.value = formation === 'permis-cases'
? 'Permis de conduire / CACES'
: (formation || '');
}
const ineligible = status === 'etudiant'
|| status === 'fonction_publique'
|| formation === 'permis-cases';
sendPartialLead(form, config, '2', {
formation_interest: formation === 'permis-cases' ? 'Permis de conduire / CACES' : (formation || ''),
professional_status: status || '',
});
lastResultStep = ineligible ? '3a' : '3b';
showStep(lastResultStep);
}
});
const formStartOnce = (() => {
let fired = false;
return () => {
if (fired) return; fired = true;
emitEvent('form_start', { client_slug: config.client_slug, offer_id: form.dataset.offerId || config.offer_id });
};
})();
form.querySelectorAll('input, select').forEach(el => {
el.addEventListener('focus',  formStartOnce, { passive: true });
el.addEventListener('change', formStartOnce, { passive: true });
});
form.querySelectorAll('input').forEach(el => {
el.addEventListener('input', () => el.classList.remove('input-error'), { passive: true });
});
const submitBtn     = form.querySelector('button[type="submit"]');
const originalLabel = submitBtn?.textContent || '';
window.addEventListener('pageshow', e => {
if (!e.persisted || !submitBtn) return;
submitBtn.disabled = false;
submitBtn.classList.remove('btn-loading');
if (originalLabel) submitBtn.textContent = originalLabel;
clearFormError(form);
showStep('1', false);
});
form.addEventListener('submit', async e => {
e.preventDefault();
clearFormError(form);
if (!config.form_action || config.form_action === 'APPS_SCRIPT_URL') {
showFormError(form, "Le formulaire n'est pas encore configuré.");
return;
}
const honeypot = form.querySelector('input[name="hp_trap"]');
if (honeypot?.value.trim()) return;
const consentCb = form.querySelector('#f4_consent');
if (consentCb && !consentCb.checked) {
consentCb.classList.add('input-error');
showFormError(form, "Veuillez accepter d'être recontacté(e) pour continuer.");
return;
}
let valid = true, phoneInvalid = false;
for (const inp of form.querySelectorAll('input[required]')) {
const stepEl = inp.closest('.f3-step');
if (stepEl && stepEl.hidden) continue;
const empty    = !inp.value.trim();
const badPhone = inp.type === 'tel' && !empty && !isValidFrenchPhone(inp.value);
inp.classList.toggle('input-error', empty || badPhone);
if (badPhone) phoneInvalid = true;
if (empty || badPhone) valid = false;
}
if (!valid) {
showFormError(form, phoneInvalid
? 'Numéro de téléphone invalide. Entrez un numéro français à 10 chiffres (ex : 06 12 34 56 78).'
: 'Veuillez remplir tous les champs obligatoires.');
return;
}
if (submitBtn) {
submitBtn.disabled = true;
submitBtn.classList.add('btn-loading');
submitBtn.textContent = '';
}
try {
const securityCode = String(Math.floor(100000 + Math.random() * 900000));
const payload = buildLeadPayload(form, config);
payload.security_code = securityCode;
emitEvent('form_submit', {
status:       'attempt',
client_slug:  payload.client_slug,
offer_id:     payload.offer_id,
page_version: payload.page_version,
utm_source:   payload.utm.source,
utm_medium:   payload.utm.medium,
utm_campaign: payload.utm.campaign,
utm_term:     payload.utm.term,
utm_content:  payload.utm.content
});
await postLead(config.form_action, payload);
saveEnhancedConversionsData(payload);
emitEvent('form_submit', { status: 'success', client_slug: payload.client_slug, security_code: securityCode });
window.location.href = `thank-you.html?code=${securityCode}`;
} catch (err) {
const message = err instanceof Error ? err.message : 'Une erreur est survenue. Veuillez réessayer.';
emitEvent('form_submit', { status: 'error', message });
showFormError(form, message);
savePendingLead(buildLeadPayload(form, config), message);
if (submitBtn) {
submitBtn.disabled = false;
submitBtn.classList.remove('btn-loading');
if (originalLabel) submitBtn.textContent = originalLabel;
}
}
});
showStep('1', false);
}
function initForm5(form, config) {
let lastResultStep = '3b';
const STEPPER_STATES = {
'1':  ['active', null,     null],
'2':  ['done',   'active', null],
'3a': ['done',   'done',   'active'],
'3b': ['done',   'done',   'active'],
'4':  ['done',   'done',   'active'],
};
const stepperEl = form.querySelector('.f3-stepper');
function updateStepper(sid) {
if (!stepperEl) return;
const states = STEPPER_STATES[sid] || [null, null, null];
stepperEl.classList.remove('f3-stepper--hidden');
stepperEl.querySelectorAll('.f3-stepper-step').forEach((el, i) => {
el.classList.remove('active', 'done');
if (states[i]) el.classList.add(states[i]);
});
stepperEl.querySelectorAll('.f3-stepper-line').forEach((el, i) => {
el.classList.toggle('done', states[i] === 'done');
});
}
function showStep(id, scroll = true) {
const sid = String(id);
form.querySelectorAll('.f3-step').forEach(s => {
const show = s.dataset.step === sid;
s.hidden = !show;
s.style.display = show ? '' : 'none';
});
updateStepper(sid);
clearFormError(form);
if (scroll) {
const card = form.closest('section');
if (card && window.innerWidth < 768) {
setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}
}
}
const step0 = form.querySelector('.f3-step[data-step="0"]');
if (step0) { step0.hidden = true; step0.style.display = 'none'; }
const backTo0Btn = form.querySelector('[data-action="back-to-0"]');
if (backTo0Btn) { backTo0Btn.hidden = true; backTo0Btn.style.display = 'none'; }
const step1 = form.querySelector('.f3-step[data-step="1"]');
let selFormation = null;
if (step1) {
const radioGroup1 = step1.querySelector('.f3-options');
if (radioGroup1) {
const radios1 = radioGroup1.querySelectorAll('input[type="radio"]');
selFormation = document.createElement('select');
selFormation.name = 'formation_choice';
selFormation.id = 'formation_choice_select';
selFormation.className = 'f5-select';
selFormation.required = true;
selFormation.setAttribute('aria-label', 'Formation souhaitée');
const defOpt = document.createElement('option');
defOpt.value = '';
defOpt.textContent = '— Choisissez votre formation —';
defOpt.disabled = true;
defOpt.selected = true;
selFormation.appendChild(defOpt);
radios1.forEach(r => {
const lbl = r.closest('label');
const opt = document.createElement('option');
opt.value = r.value;
const span = lbl ? lbl.querySelector('.f3-opt-label') : null;
opt.textContent = span ? span.textContent : r.value;
selFormation.appendChild(opt);
});
radioGroup1.replaceWith(selFormation);
}
}
const step2 = form.querySelector('.f3-step[data-step="2"]');
let selStatus = null;
if (step2) {
const radioGroup2 = step2.querySelector('.f3-options');
if (radioGroup2) {
const radios2 = radioGroup2.querySelectorAll('input[type="radio"]');
selStatus = document.createElement('select');
selStatus.name = 'professional_status';
selStatus.id = 'professional_status_select';
selStatus.className = 'f5-select';
selStatus.required = true;
selStatus.setAttribute('aria-label', 'Statut professionnel');
const defOpt2 = document.createElement('option');
defOpt2.value = '';
defOpt2.textContent = '— Sélectionnez votre statut —';
defOpt2.disabled = true;
defOpt2.selected = true;
selStatus.appendChild(defOpt2);
radios2.forEach(r => {
const lbl = r.closest('label');
const opt = document.createElement('option');
opt.value = r.value;
const span = lbl ? lbl.querySelector('.f3-opt-label') : null;
opt.textContent = span ? span.textContent : r.value;
selStatus.appendChild(opt);
});
radioGroup2.replaceWith(selStatus);
}
}
const step4 = form.querySelector('.f3-step[data-step="4"]');
if (step4) {
const emailInput = step4.querySelector('#email');
if (emailInput) { const w = emailInput.closest('div'); if (w) w.remove(); }
const hiddenConsent = step4.querySelector('input[name="consent_marketing"]');
if (hiddenConsent) hiddenConsent.remove();
const consentLabel = document.createElement('label');
consentLabel.className = 'f3-checkbox-row';
consentLabel.innerHTML =
'<input type="checkbox" id="f5_consent" name="consent_marketing" />'
+ '<span class="f3-consent-text">J’accepte d’être recontacté(e) par un conseiller en formations pour vérifier mes droits CPF.</span>';
const btnRow4 = step4.querySelector('.f3-btn-row');
if (btnRow4) step4.insertBefore(consentLabel, btnRow4);
else step4.appendChild(consentLabel);
const submitBtn4 = step4.querySelector('button[type="submit"]');
if (submitBtn4) submitBtn4.textContent = 'Recevoir un conseil Gratuit';
}
const btn3bTo4 = form.querySelector('.f3-step[data-step="3b"] [data-action="to-4"]');
if (btn3bTo4) btn3bTo4.textContent = 'Étape suivante →';
const btn3aTo4 = form.querySelector('.f3-step[data-step="3a"] [data-action="to-4"]');
if (btn3aTo4) btn3aTo4.textContent = 'Étape suivante →';
const btnTo2 = form.querySelector('[data-action="to-2"]');
if (selFormation && btnTo2) {
btnTo2.disabled = true;
selFormation.addEventListener('change', () => { btnTo2.disabled = !selFormation.value; });
}
const btnResult = form.querySelector('[data-action="result"]');
if (selStatus && btnResult) {
btnResult.disabled = true;
selStatus.addEventListener('change', () => { btnResult.disabled = !selStatus.value; });
}
const preselectFormation = form.dataset.preselectFormation;
if (preselectFormation && selFormation) {
selFormation.value = preselectFormation;
if (selFormation.value && btnTo2) btnTo2.disabled = false;
const hiddenF = form.querySelector('#formation_interest_val');
if (hiddenF) hiddenF.value = preselectFormation === 'permis-cases' ? 'Permis de conduire / CACES' : preselectFormation;
}
form.addEventListener('click', e => {
const btn = e.target.closest('[data-action]');
if (!btn || btn.type === 'submit' || btn.disabled) return;
const action = btn.dataset.action;
if (action === 'to-2') {
const f5Formation = selFormation ? selFormation.value : '';
sendPartialLead(form, config, '1', {
formation_interest: f5Formation === 'permis-cases' ? 'Permis de conduire / CACES' : f5Formation,
});
showStep('2'); return;
}
if (action === 'to-4')      { showStep('4'); return; }
if (action === 'back-to-1') { showStep('1'); return; }
if (action === 'back-to-2') { showStep('2'); return; }
if (action === 'back-to-3') { showStep(lastResultStep); return; }
if (action === 'result') {
const status    = selStatus ? selStatus.value : '';
const formation = selFormation ? selFormation.value : '';
const hiddenF = form.querySelector('#formation_interest_val');
if (hiddenF) hiddenF.value = formation === 'permis-cases' ? 'Permis de conduire / CACES' : (formation || '');
const ineligible = status === 'etudiant' || status === 'fonction_publique' || formation === 'permis-cases';
sendPartialLead(form, config, '2', {
formation_interest: formation === 'permis-cases' ? 'Permis de conduire / CACES' : (formation || ''),
professional_status: status || '',
});
lastResultStep = ineligible ? '3a' : '3b';
showStep(lastResultStep);
}
});
const formStartOnce = (() => {
let fired = false;
return () => {
if (fired) return; fired = true;
emitEvent('form_start', { client_slug: config.client_slug, offer_id: form.dataset.offerId || config.offer_id });
};
})();
form.querySelectorAll('input, select').forEach(el => {
el.addEventListener('focus',  formStartOnce, { passive: true });
el.addEventListener('change', formStartOnce, { passive: true });
});
form.querySelectorAll('input').forEach(el => {
el.addEventListener('input', () => el.classList.remove('input-error'), { passive: true });
});
const submitBtn     = form.querySelector('button[type="submit"]');
const originalLabel = submitBtn?.textContent || '';
window.addEventListener('pageshow', e => {
if (!e.persisted || !submitBtn) return;
submitBtn.disabled = false;
submitBtn.classList.remove('btn-loading');
if (originalLabel) submitBtn.textContent = originalLabel;
clearFormError(form);
showStep('1', false);
});
form.addEventListener('submit', async e => {
e.preventDefault();
clearFormError(form);
if (!config.form_action || config.form_action === 'APPS_SCRIPT_URL') {
showFormError(form, "Le formulaire n'est pas encore configuré.");
return;
}
const honeypot = form.querySelector('input[name="hp_trap"]');
if (honeypot?.value.trim()) return;
const consentCb = form.querySelector('#f5_consent');
if (consentCb && !consentCb.checked) {
consentCb.classList.add('input-error');
showFormError(form, "Veuillez accepter d'être recontacté(e) pour continuer.");
return;
}
let valid = true, phoneInvalid = false;
for (const inp of form.querySelectorAll('input[required]')) {
const stepEl = inp.closest('.f3-step');
if (stepEl && stepEl.hidden) continue;
const empty    = !inp.value.trim();
const badPhone = inp.type === 'tel' && !empty && !isValidFrenchPhone(inp.value);
inp.classList.toggle('input-error', empty || badPhone);
if (badPhone) phoneInvalid = true;
if (empty || badPhone) valid = false;
}
if (!valid) {
showFormError(form, phoneInvalid
? 'Numéro de téléphone invalide. Entrez un numéro français à 10 chiffres (ex : 06 12 34 56 78).'
: 'Veuillez remplir tous les champs obligatoires.');
return;
}
if (submitBtn) {
submitBtn.disabled = true;
submitBtn.classList.add('btn-loading');
submitBtn.textContent = '';
}
try {
const securityCode = String(Math.floor(100000 + Math.random() * 900000));
const payload = buildLeadPayload(form, config);
payload.security_code = securityCode;
emitEvent('form_submit', {
status: 'attempt', client_slug: payload.client_slug, offer_id: payload.offer_id,
page_version: payload.page_version, utm_source: payload.utm.source,
utm_medium: payload.utm.medium, utm_campaign: payload.utm.campaign,
utm_term: payload.utm.term, utm_content: payload.utm.content
});
await postLead(config.form_action, payload);
saveEnhancedConversionsData(payload);
emitEvent('form_submit', { status: 'success', client_slug: payload.client_slug, security_code: securityCode });
window.location.href = `thank-you.html?code=${securityCode}`;
} catch (err) {
const message = err instanceof Error ? err.message : 'Une erreur est survenue. Veuillez réessayer.';
emitEvent('form_submit', { status: 'error', message });
showFormError(form, message);
savePendingLead(buildLeadPayload(form, config), message);
if (submitBtn) {
submitBtn.disabled = false;
submitBtn.classList.remove('btn-loading');
if (originalLabel) submitBtn.textContent = originalLabel;
}
}
});
showStep('1', false);
}
function initForm6(form, config) {
let lastResultStep = '3b';
const STEPPER_STATES = {
'1':  ['active', null,     null],
'2':  ['done',   'active', null],
'3a': ['done',   'done',   'active'],
'3b': ['done',   'done',   'active'],
'4':  ['done',   'done',   'active'],
};
const stepperEl = form.querySelector('.f3-stepper');
function updateStepper(sid) {
if (!stepperEl) return;
const states = STEPPER_STATES[sid] || [null, null, null];
stepperEl.classList.remove('f3-stepper--hidden');
stepperEl.querySelectorAll('.f3-stepper-step').forEach((el, i) => {
el.classList.remove('active', 'done');
if (states[i]) el.classList.add(states[i]);
});
stepperEl.querySelectorAll('.f3-stepper-line').forEach((el, i) => {
el.classList.toggle('done', states[i] === 'done');
});
}
function showStep(id, scroll = true) {
const sid = String(id);
form.querySelectorAll('.f3-step').forEach(s => {
const show = s.dataset.step === sid;
s.hidden = !show;
s.style.display = show ? '' : 'none';
});
updateStepper(sid);
clearFormError(form);
if (scroll) {
const card = form.closest('section');
if (card && window.innerWidth < 768) {
setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}
}
}
const step0 = form.querySelector('.f3-step[data-step="0"]');
if (step0) { step0.hidden = true; step0.style.display = 'none'; }
const backTo0Btn = form.querySelector('[data-action="back-to-0"]');
if (backTo0Btn) { backTo0Btn.hidden = true; backTo0Btn.style.display = 'none'; }
const step1 = form.querySelector('.f3-step[data-step="1"]');
let selFormation = null;
if (step1) {
const radioGroup1 = step1.querySelector('.f3-options');
if (radioGroup1) {
const radios1 = radioGroup1.querySelectorAll('input[type="radio"]');
selFormation = document.createElement('select');
selFormation.name = 'formation_choice';
selFormation.id = 'formation_choice_select';
selFormation.className = 'f5-select';
selFormation.required = true;
selFormation.setAttribute('aria-label', 'Formation souhaitée');
const defOpt = document.createElement('option');
defOpt.value = '';
defOpt.textContent = '— Choisissez votre formation —';
defOpt.disabled = true;
defOpt.selected = true;
selFormation.appendChild(defOpt);
radios1.forEach(r => {
const lbl = r.closest('label');
const opt = document.createElement('option');
opt.value = r.value;
const span = lbl ? lbl.querySelector('.f3-opt-label') : null;
opt.textContent = span ? span.textContent : r.value;
selFormation.appendChild(opt);
});
radioGroup1.replaceWith(selFormation);
}
}
const step2 = form.querySelector('.f3-step[data-step="2"]');
let selStatus = null;
if (step2) {
const radioGroup2 = step2.querySelector('.f3-options');
if (radioGroup2) {
const radios2 = radioGroup2.querySelectorAll('input[type="radio"]');
selStatus = document.createElement('select');
selStatus.name = 'professional_status';
selStatus.id = 'professional_status_select';
selStatus.className = 'f5-select';
selStatus.required = true;
selStatus.setAttribute('aria-label', 'Statut professionnel');
const defOpt2 = document.createElement('option');
defOpt2.value = '';
defOpt2.textContent = '— Sélectionnez votre statut —';
defOpt2.disabled = true;
defOpt2.selected = true;
selStatus.appendChild(defOpt2);
radios2.forEach(r => {
const lbl = r.closest('label');
const opt = document.createElement('option');
opt.value = r.value;
const span = lbl ? lbl.querySelector('.f3-opt-label') : null;
opt.textContent = span ? span.textContent : r.value;
selStatus.appendChild(opt);
});
radioGroup2.replaceWith(selStatus);
}
}
const step3b = form.querySelector('.f3-step[data-step="3b"]');
if (step3b) {
const card = step3b.querySelector('.f3-result-card--eligible');
if (card) {
const emoji = card.querySelector('.f3-result-emoji');
card.innerHTML = '';
if (emoji) card.appendChild(emoji);
const title = document.createElement('p');
title.className = 'f3-result-title f3-result-title--good';
title.textContent = 'Félicitations — vous êtes éligible !';
card.appendChild(title);
const msg = document.createElement('p');
msg.className = 'f3-result-text';
msg.textContent = 'Maintenant, informez-vous gratuitement et sans engagement sur la formation.';
card.appendChild(msg);
}
const btn3bTo4 = step3b.querySelector('[data-action="to-4"]');
if (btn3bTo4) btn3bTo4.textContent = 'Obtenir mon accompagnement CPF gratuit →';
}
const btn3aTo4 = form.querySelector('.f3-step[data-step="3a"] [data-action="to-4"]');
if (btn3aTo4) btn3aTo4.textContent = 'Étape suivante →';
const step4 = form.querySelector('.f3-step[data-step="4"]');
if (step4) {
const emailInput = step4.querySelector('#email');
if (emailInput) { const w = emailInput.closest('div'); if (w) w.remove(); }
const reassurance = document.createElement('p');
reassurance.className = 'f6-reassurance';
reassurance.textContent = '🔒 Un conseiller vous rappelle sous 48h — un seul appel, sans relance ni spam.';
const firstField = step4.querySelector('div');
if (firstField) step4.insertBefore(reassurance, firstField);
else step4.prepend(reassurance);
const submitBtn4 = step4.querySelector('button[type="submit"]');
if (submitBtn4) submitBtn4.textContent = "Je réserve mon accompagnement gratuit";
const legalNotice = document.createElement('p');
legalNotice.className = 'f6-legal-notice';
legalNotice.innerHTML = 'En cliquant sur « Je réserve », vous déclarez avoir pris connaissance de la politique de protection des données de <a href="https://formations.adsvizor.com/" target="_blank" rel="noopener">formations.adsvizor.com</a> et acceptez d’être recontacté par un conseiller pour obtenir plus d’informations.';
step4.appendChild(legalNotice);
}
const btnTo2 = form.querySelector('[data-action="to-2"]');
if (selFormation && btnTo2) {
btnTo2.disabled = true;
selFormation.addEventListener('change', () => { btnTo2.disabled = !selFormation.value; });
}
const btnResult = form.querySelector('[data-action="result"]');
if (selStatus && btnResult) {
btnResult.disabled = true;
selStatus.addEventListener('change', () => { btnResult.disabled = !selStatus.value; });
}
const preselectFormation = form.dataset.preselectFormation;
if (preselectFormation && selFormation) {
selFormation.value = preselectFormation;
if (selFormation.value && btnTo2) btnTo2.disabled = false;
const hiddenF = form.querySelector('#formation_interest_val');
if (hiddenF) hiddenF.value = preselectFormation === 'permis-cases' ? 'Permis de conduire / CACES' : preselectFormation;
}
form.addEventListener('click', e => {
const btn = e.target.closest('[data-action]');
if (!btn || btn.type === 'submit' || btn.disabled) return;
const action = btn.dataset.action;
if (action === 'to-2') {
const f6Formation = selFormation ? selFormation.value : '';
sendPartialLead(form, config, '1', {
formation_interest: f6Formation === 'permis-cases' ? 'Permis de conduire / CACES' : f6Formation,
});
showStep('2'); return;
}
if (action === 'to-4')      { showStep('4'); return; }
if (action === 'back-to-1') { showStep('1'); return; }
if (action === 'back-to-2') { showStep('2'); return; }
if (action === 'back-to-3') { showStep(lastResultStep); return; }
if (action === 'result') {
const status    = selStatus ? selStatus.value : '';
const formation = selFormation ? selFormation.value : '';
const hiddenF = form.querySelector('#formation_interest_val');
if (hiddenF) hiddenF.value = formation === 'permis-cases' ? 'Permis de conduire / CACES' : (formation || '');
const ineligible = status === 'etudiant' || status === 'fonction_publique' || formation === 'permis-cases';
sendPartialLead(form, config, '2', {
formation_interest: formation === 'permis-cases' ? 'Permis de conduire / CACES' : (formation || ''),
professional_status: status || '',
});
lastResultStep = ineligible ? '3a' : '3b';
showStep(lastResultStep);
}
});
const formStartOnce = (() => {
let fired = false;
return () => {
if (fired) return; fired = true;
emitEvent('form_start', { client_slug: config.client_slug, offer_id: form.dataset.offerId || config.offer_id });
};
})();
form.querySelectorAll('input, select').forEach(el => {
el.addEventListener('focus',  formStartOnce, { passive: true });
el.addEventListener('change', formStartOnce, { passive: true });
});
form.querySelectorAll('input').forEach(el => {
el.addEventListener('input', () => el.classList.remove('input-error'), { passive: true });
});
const submitBtn     = form.querySelector('button[type="submit"]');
const originalLabel = submitBtn?.textContent || '';
window.addEventListener('pageshow', e => {
if (!e.persisted || !submitBtn) return;
submitBtn.disabled = false;
submitBtn.classList.remove('btn-loading');
if (originalLabel) submitBtn.textContent = originalLabel;
clearFormError(form);
showStep('1', false);
});
form.addEventListener('submit', async e => {
e.preventDefault();
clearFormError(form);
if (!config.form_action || config.form_action === 'APPS_SCRIPT_URL') {
showFormError(form, "Le formulaire n'est pas encore configuré.");
return;
}
const honeypot = form.querySelector('input[name="hp_trap"]');
if (honeypot?.value.trim()) return;
let valid = true, phoneInvalid = false;
for (const inp of form.querySelectorAll('input[required]')) {
const stepEl = inp.closest('.f3-step');
if (stepEl && stepEl.hidden) continue;
const empty    = !inp.value.trim();
const badPhone = inp.type === 'tel' && !empty && !isValidFrenchPhone(inp.value);
inp.classList.toggle('input-error', empty || badPhone);
if (badPhone) phoneInvalid = true;
if (empty || badPhone) valid = false;
}
if (!valid) {
showFormError(form, phoneInvalid
? 'Numéro de téléphone invalide. Entrez un numéro français à 10 chiffres (ex : 06 12 34 56 78).'
: 'Veuillez remplir tous les champs obligatoires.');
return;
}
if (submitBtn) {
submitBtn.disabled = true;
submitBtn.classList.add('btn-loading');
submitBtn.textContent = '';
}
try {
const securityCode = String(Math.floor(100000 + Math.random() * 900000));
const payload = buildLeadPayload(form, config);
payload.security_code = securityCode;
emitEvent('form_submit', {
status: 'attempt', client_slug: payload.client_slug, offer_id: payload.offer_id,
page_version: payload.page_version, utm_source: payload.utm.source,
utm_medium: payload.utm.medium, utm_campaign: payload.utm.campaign,
utm_term: payload.utm.term, utm_content: payload.utm.content
});
await postLead(config.form_action, payload);
saveEnhancedConversionsData(payload);
emitEvent('form_submit', { status: 'success', client_slug: payload.client_slug, security_code: securityCode });
window.location.href = `thank-you.html?code=${securityCode}`;
} catch (err) {
const message = err instanceof Error ? err.message : 'Une erreur est survenue. Veuillez réessayer.';
emitEvent('form_submit', { status: 'error', message });
showFormError(form, message);
savePendingLead(buildLeadPayload(form, config), message);
if (submitBtn) {
submitBtn.disabled = false;
submitBtn.classList.remove('btn-loading');
if (originalLabel) submitBtn.textContent = originalLabel;
}
}
});
showStep('1', false);
}

function initForm7(form, config) {
  // Step slot mapping (reuses existing HTML data-step attributes):
  //   data-step="1" → COORDS    (rebuilt: nom + prénom + téléphone)
  //   data-step="4" → FORMATION (rebuilt: formation dropdown, using radios extracted from step1)
  //   data-step="2" → STATUS    (radio group converted to select)
  //   data-step="3b"→ ELIGIBLE result
  //   data-step="3a"→ INELIGIBLE result
  // Navigation: 1 → 4 → 2 → 3b|3a

  const STEPPER_STATES = {
    '1':  ['active', null,    null  ],
    '4':  ['done',   'active',null  ],
    '2':  ['done',   'done',  'active'],
    '3b': ['done',   'done',  'done'],
    '3a': ['done',   'done',  'done'],
  };

  const stepperEl = form.querySelector('.f3-stepper');
  function updateStepper(sid) {
    if (!stepperEl) return;
    const states = STEPPER_STATES[sid] || [null,null,null];
    stepperEl.classList.remove('f3-stepper--hidden');
    stepperEl.querySelectorAll('.f3-stepper-step').forEach((el,i) => {
      el.classList.remove('active','done');
      if (states[i]) el.classList.add(states[i]);
    });
    stepperEl.querySelectorAll('.f3-stepper-line').forEach((el,i) => {
      el.classList.toggle('done', states[i] === 'done');
    });
  }

  function showStep(id, scroll=true) {
    const sid = String(id);
    form.querySelectorAll('.f3-step').forEach(s => {
      const show = s.dataset.step === sid;
      s.hidden = !show; s.style.display = show ? '' : 'none';
    });
    updateStepper(sid);
    clearFormError(form);
    if (scroll) {
      const card = form.closest('section');
      if (card && window.innerWidth < 768)
        setTimeout(() => card.scrollIntoView({behavior:'smooth',block:'nearest'}), 50);
    }
  }

  // Hide step0 (intro, not used) — but check its consent checkbox
  // so buildLeadPayload reads consent_marketing = true
  const step0 = form.querySelector('.f3-step[data-step="0"]');
  if (step0) {
    step0.hidden=true; step0.style.display='none';
    const cb = step0.querySelector('input[name="consent_marketing"]');
    if (cb) cb.checked = true;
  }

  // ── Extract formation options from step1 BEFORE rebuilding it ──────────────
  const step1El = form.querySelector('.f3-step[data-step="1"]');
  const formationOptions = [];
  if (step1El) {
    step1El.querySelectorAll('input[type="radio"]').forEach(r => {
      const lbl  = r.closest('label');
      const span = lbl ? lbl.querySelector('.f3-opt-label') : null;
      formationOptions.push({ value: r.value, label: span ? span.textContent.trim() : r.value });
    });
  }

  // ── STEP 1: rebuild as COORDS (Nom + Prénom + Téléphone) ───────────────────
  if (step1El) {
    step1El.innerHTML = '';

    const titleEl = document.createElement('p');
    titleEl.className = 'f3-step-title';
    titleEl.textContent = 'Recevez votre bilan CPF gratuit et sans engagement.';
    titleEl.style.fontWeight = '700';
    step1El.appendChild(titleEl);

    [
      {name:'last_name', id:'f7_nom',    label:'Nom',       ph:'Ex : Dupont',    ac:'family-name', type:'text'},
      {name:'first_name',id:'f7_prenom', label:'Prénom',    ph:'Ex : Marie',     ac:'given-name',  type:'text'},
      {name:'phone',     id:'f7_tel',    label:'Téléphone', ph:'06 12 34 56 78', ac:'tel',         type:'tel'},
    ].forEach(({name,id,label,ph,ac,type}) => {
      const d = document.createElement('div');
      d.innerHTML = '<label for="'+id+'">'+label+'</label>'
        +'<input type="'+type+'" id="'+id+'" name="'+name+'" placeholder="'+ph+'" required autocomplete="'+ac+'" />';
      step1El.appendChild(d);
    });

    const btnRow = document.createElement('div');
    btnRow.className = 'f3-btn-row';
    const btnNext = document.createElement('button');
    btnNext.type='button'; btnNext.className='btn-next';
    btnNext.dataset.action='to-formation';
    btnNext.textContent='Vérifier mon éligibilité CPF →';
    btnRow.appendChild(btnNext);
    step1El.appendChild(btnRow);
  }

  // ── STEP 4: rebuild as FORMATION dropdown ──────────────────────────────────
  const step4El = form.querySelector('.f3-step[data-step="4"]');
  let selFormation = null;
  if (step4El) {
    step4El.innerHTML = '';

    const titleEl = document.createElement('p');
    titleEl.className = 'f3-step-title';
    titleEl.textContent = 'Quelle formation vous intéresse ?';
    titleEl.style.fontWeight = '700';
    step4El.appendChild(titleEl);

    selFormation = document.createElement('select');
    selFormation.name='formation_choice'; selFormation.id='f7_formation';
    selFormation.className='f5-select'; selFormation.required=true;
    selFormation.setAttribute('aria-label','Formation souhaitée');
    const defOpt = document.createElement('option');
    defOpt.value=''; defOpt.textContent='— Choisissez votre formation —';
    defOpt.disabled=true; defOpt.selected=true;
    selFormation.appendChild(defOpt);
    formationOptions.forEach(fo => {
      const opt = document.createElement('option');
      opt.value=fo.value; opt.textContent=fo.label;
      selFormation.appendChild(opt);
    });
    step4El.appendChild(selFormation);

    const btnRow = document.createElement('div');
    btnRow.className = 'f3-btn-row f3-step-nav';
    const btnBack = document.createElement('button');
    btnBack.type='button'; btnBack.className='btn-back';
    btnBack.dataset.action='back-to-1'; btnBack.textContent='← Retour';
    const btnNext = document.createElement('button');
    btnNext.type='button'; btnNext.className='btn-next';
    btnNext.dataset.action='to-status'; btnNext.disabled=true;
    btnNext.textContent='Continuer →';
    selFormation.addEventListener('change', () => { btnNext.disabled=!selFormation.value; });
    btnRow.appendChild(btnBack);
    btnRow.appendChild(btnNext);
    step4El.appendChild(btnRow);
  }

  // ── STEP 2: convert STATUS radios → select ─────────────────────────────────
  const step2El = form.querySelector('.f3-step[data-step="2"]');
  let selStatus = null;
  if (step2El) {
    const radioGroup = step2El.querySelector('.f3-options');
    if (radioGroup) {
      const radios = radioGroup.querySelectorAll('input[type="radio"]');
      selStatus = document.createElement('select');
      selStatus.name='professional_status'; selStatus.id='f7_status';
      selStatus.className='f5-select'; selStatus.required=true;
      selStatus.setAttribute('aria-label','Statut professionnel');
      const defOpt = document.createElement('option');
      defOpt.value=''; defOpt.textContent='— Sélectionnez votre statut —';
      defOpt.disabled=true; defOpt.selected=true;
      selStatus.appendChild(defOpt);
      radios.forEach(r => {
        const lbl  = r.closest('label');
        const span = lbl ? lbl.querySelector('.f3-opt-label') : null;
        const opt  = document.createElement('option');
        opt.value=r.value; opt.textContent=span ? span.textContent.trim() : r.value;
        selStatus.appendChild(opt);
      });
      radioGroup.replaceWith(selStatus);
    }
    // Back button: back-to-1 → back-to-formation
    const backBtn = step2El.querySelector('[data-action="back-to-1"]');
    if (backBtn) backBtn.dataset.action = 'back-to-formation';
    // Result button: disable until status selected
    const resultBtn = step2El.querySelector('[data-action="result"]');
    if (resultBtn) {
      resultBtn.disabled = true;
      selStatus?.addEventListener('change', () => { resultBtn.disabled=!selStatus.value; });
    }
  }

  // ── STEP 3b: eligible result ───────────────────────────────────────────────
  const step3bEl = form.querySelector('.f3-step[data-step="3b"]');
  if (step3bEl) {
    const card = step3bEl.querySelector('.f3-result-card--eligible, .f3-result-card');
    if (card) {
      const emoji = card.querySelector('.f3-result-emoji');
      card.innerHTML = '';
      if (emoji) card.appendChild(emoji);
      const t = document.createElement('p'); t.className='f3-result-title f3-result-title--good';
      t.textContent = 'Félicitations — vous êtes éligible !'; card.appendChild(t);
      const m = document.createElement('p'); m.className='f3-result-text';
      m.textContent = 'Votre dossier CPF a bien été transmis. Un conseiller vous rappelle sous 48h pour finaliser votre financement gratuitement.';
      card.appendChild(m);
    }
    step3bEl.querySelectorAll('[data-action="to-4"],[data-action="back-to-2"]').forEach(b => b.remove());
    // Spinner shown while lead posts
    const spin3b = document.createElement('div'); spin3b.className='f7-result-spinner';
    spin3b.innerHTML='<div class="f7-spinner-ring"></div><p class="f7-spinner-label">Envoi en cours…</p>';
    step3bEl.appendChild(spin3b);
  }

  // ── STEP 3a: ineligible result ─────────────────────────────────────────────
  const step3aEl = form.querySelector('.f3-step[data-step="3a"]');
  if (step3aEl) {
    const card = step3aEl.querySelector('.f3-result-card--ineligible, .f3-result-card, .f3-result-card--eligible');
    if (card) {
      const emoji = card.querySelector('.f3-result-emoji');
      card.innerHTML = '';
      if (emoji) card.appendChild(emoji);
      const t = document.createElement('p'); t.className='f3-result-title';
      t.textContent = 'Malheureusement, vous n\'êtes pas éligible :('; card.appendChild(t);
      const m = document.createElement('p'); m.className='f3-result-text';
      m.textContent = 'Votre dossier CPF a bien été transmis. Un conseiller vous rappelle sous 48h pour étudier les alternatives disponibles.';
      card.appendChild(m);
    }
    step3aEl.querySelectorAll('[data-action="to-4"],[data-action="back-to-2"]').forEach(b => b.remove());
    // Spinner shown while lead posts
    const spin3a = document.createElement('div'); spin3a.className='f7-result-spinner';
    spin3a.innerHTML='<div class="f7-spinner-ring"></div><p class="f7-spinner-label">Envoi en cours…</p>';
    step3aEl.appendChild(spin3a);
  }

  // Prevent accidental form submit (submission handled via click router)
  form.addEventListener('submit', e => e.preventDefault());

  // ── Analytics ──────────────────────────────────────────────────────────────
  const formStartOnce = (() => {
    let fired=false;
    return () => {
      if (fired) return; fired=true;
      emitEvent('form_start',{client_slug:config.client_slug,offer_id:form.dataset.offerId||config.offer_id});
    };
  })();
  form.querySelectorAll('input,select').forEach(el => {
    el.addEventListener('focus',  formStartOnce, {passive:true});
    el.addEventListener('change', formStartOnce, {passive:true});
  });
  form.querySelectorAll('input').forEach(el =>
    el.addEventListener('input', ()=>el.classList.remove('input-error'), {passive:true})
  );

  // ── Click router ───────────────────────────────────────────────────────────
  form.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;

    if (action === 'to-formation') {
      const nomEl    = form.querySelector('#f7_nom');
      const prenomEl = form.querySelector('#f7_prenom');
      const telEl    = form.querySelector('#f7_tel');
      // If elements are missing the form wasn't properly initialised — abort silently
      if (!nomEl || !prenomEl || !telEl) return;
      let valid = true;
      if (!nomEl.value.trim())    { nomEl.classList.add('input-error');    valid=false; }
      if (!prenomEl.value.trim()) { prenomEl.classList.add('input-error'); valid=false; }
      const empty=!telEl.value.trim(), bad=!empty&&!isValidFrenchPhone(telEl.value);
      telEl.classList.toggle('input-error', empty||bad);
      if (empty||bad) valid=false;
      if (!valid) {
        showFormError(form, bad
          ? 'Numéro invalide. Entrez un numéro français à 10 chiffres (ex : 06 12 34 56 78).'
          : 'Veuillez remplir tous les champs obligatoires.');
        return;
      }
      clearFormError(form);
      sendPartialLead(form, config, '1', {
        last_name:  nomEl.value.trim(),
        first_name: prenomEl.value.trim(),
        phone:      telEl.value.trim(),
      });
      showStep('4'); return;
    }

    if (action === 'to-status') {
      const formation = selFormation?.value || '';
      const hf = form.querySelector('#formation_interest_val');
      if (hf) hf.value = formation==='permis-cases' ? 'Permis de conduire / CACES' : formation;
      sendPartialLead(form, config, '2', {
        formation_interest: formation==='permis-cases' ? 'Permis de conduire / CACES' : formation,
      });
      showStep('2'); return;
    }

    if (action === 'result') {
      const status    = selStatus?.value    || '';
      const formation = selFormation?.value || '';
      const hf = form.querySelector('#formation_interest_val');
      if (hf) hf.value = formation==='permis-cases' ? 'Permis de conduire / CACES' : formation;
      const ineligible = status==='etudiant' || status==='fonction_publique' || formation==='permis-cases';
      const securityCode = String(Math.floor(100000+Math.random()*900000));
      const payload = buildLeadPayload(form, config);
      payload.professional_status = status;
      payload.formation_interest  = formation==='permis-cases' ? 'Permis de conduire / CACES' : formation;
      payload.security_code = securityCode;
      emitEvent('form_submit',{status:'attempt',client_slug:payload.client_slug,offer_id:payload.offer_id});
      const doRedirect = () => { window.location.href = 'thank-you.html?code=' + securityCode; };
      showStep(ineligible ? '3a' : '3b');
      // Show spinner immediately
      const resultEl = form.querySelector('.f3-step[data-step="' + (ineligible ? '3a' : '3b') + '"]');
      const spinnerEl = resultEl && resultEl.querySelector('.f7-result-spinner');
      if (spinnerEl) spinnerEl.style.display = 'flex';
      // Wait for BOTH: lead sent + minimum reading time (2.5s)
      const minRead = new Promise(res => setTimeout(res, 2500));
      const send = postLead(config.form_action, payload)
        .then(() => {
          saveEnhancedConversionsData(payload);
          emitEvent('form_submit',{status:'success',client_slug:payload.client_slug,security_code:securityCode});
        })
        .catch(err => savePendingLead(payload, err instanceof Error ? err.message : 'error'));
      Promise.all([send, minRead]).then(doRedirect);
      return;
    }

    if (action === 'back-to-1')         { showStep('1'); return; }
    if (action === 'back-to-formation') { showStep('4'); return; }
  });

  window.addEventListener('pageshow', e => { if (e.persisted) showStep('1',false); });
  showStep('1', false);
}


function initHeaderCta() {  return;
document.querySelectorAll(".cpf-cta-bar").forEach(el => el.remove());
if (document.querySelector(".thankyou") || document.querySelector(".privacy-content")) return;
if (window.innerWidth >= 768) return;
const contactSection = document.getElementById("contact");
function attachScrollListener(el) {
if (contactSection) {
el.setAttribute("href", window.location.pathname + "#contact");
el.addEventListener("click", (e) => {
e.preventDefault();
contactSection.scrollIntoView({ behavior: "smooth", block: "start" });
setTimeout(() => {
const firstInput = contactSection.querySelector("input:not([type=hidden])");
if (firstInput) firstInput.focus({ preventScroll: true });
}, 600);
});
} else {
el.setAttribute("href", "/#contact");
}
}
const existing = document.querySelector(".btn-header-cta");
if (existing) {
attachScrollListener(existing);
return;
}
const h1 = document.querySelector("section.hero h1, .hero-body h1");
if (!h1) return;
const cta = document.createElement("a");
cta.className = "btn-header-cta";
cta.setAttribute("data-cta-id", "hero-cta");
cta.setAttribute("data-preserve-utm", "true");
cta.textContent = "\u2705 V\u00e9rifier mes droits CPF";
cta.style.cssText = [
"display:block",
"width:fit-content",
"margin:20px auto 28px",
"padding:14px 28px",
"background:#c2410c",
"color:#ffffff",
"font-size:1rem",
"font-weight:700",
"text-decoration:none",
"border-radius:999px",
"white-space:nowrap",
"box-shadow:0 4px 16px rgba(194,65,12,0.45)",
"text-align:center",
].join(";");
attachScrollListener(cta);
h1.insertAdjacentElement("afterend", cta);
}
async function init() {
try {
const form = document.querySelector("form[data-client-slug]");
emitEvent("page_view", { path: window.location.pathname, has_form: Boolean(form) });
initCtaTracking();
if (form) initUtmTracking(form);
else persistUtmToSession({ ...readUtmFromLocal(), ...readUtmFromSession(), ...parseUtmFromUrl() });
const config = await loadClientConfig(form);
resolveActiveFormation(config);
applyConfigToHead(config);
walkAndReplaceTextNodes(document.body, config);
replacePlaceholdersInAttributes(document.body, config);
for (const li of document.querySelectorAll("nav li")) {
const a = li.querySelector("a");
if (a && !a.textContent.trim()) li.hidden = true;
}
if (config.show_stats === false) {
const el = document.querySelector(".stats-strip");
if (el) el.hidden = true;
}
if (config.show_testimonials === false) {
const el = document.querySelector("[aria-labelledby='testimonials-title']");
if (el) el.hidden = true;
}
retryPendingLead(config.form_action).catch(() => {});
if (form) {
const formOverride = new URLSearchParams(window.location.search).get('form')
|| String(config.active_form || '');
if (formOverride === '7') {
initForm7(form, config);
} else if (formOverride === '6') {
initForm6(form, config);
} else if (formOverride === '5') {
initForm5(form, config);
} else if (formOverride === '4') {
initForm4(form, config);
} else if (form.dataset.form === "3") {
initForm3(form, config);
} else if (form.dataset.simple === "true") {
initSimpleForm(form, config);
} else {
initMultiStepForm(form, config);
}
}
if (!window.location.hash) window.scrollTo(0, 0);
document.body.classList.add("ready");
if (typeof gtag === 'function') {
gtag('event', 'page_view', {
page_title: document.title,
page_location: window.location.href,
});
}
renderFormationList(config);
initStatCounters();
preserveUtmOnLinks();
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
nav.querySelectorAll("a").forEach(link => {
link.addEventListener("click", () => {
toggle.setAttribute("aria-expanded", "false");
nav.classList.remove("is-open");
});
});
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
