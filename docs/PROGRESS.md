# Project Progress & Roadmap

Last updated: 2026-03-30

Owner: Fabrice
Company: AdsVizor

## 1. Current state (what is already completed)

Infrastructure is already completed:

1. **Domain** `adsvizor.com` on Porkbun (`$11/year`).
2. **Cloudflare active** with SSL, CDN, and security features enabled.
3. **Email routing**: `contact@adsvizor.com` -> `adsvizor@gmail.com`.
4. **GitHub repo** `adsvizor-web` connected to **Cloudflare Pages**.
5. **Cloudflare Pages** auto-deploys on every `git push`.

These items enable the operational model:

* Add/update frontend assets in the repo.
* Push to GitHub.
* Cloudflare Pages deploys the landing pages automatically.

## 2. Near-term targets

The remaining work typically clusters into four areas:

1. Landing page production quality (performance, reliability, analytics correctness).
2. Lead capture reliability (Apps Script validation + stable Sheet schema).
3. Data readiness for the AI agent (inputs available daily with consistent schema).
4. Daily optimization loop (recommendation output + optional application gate).

## 3. Roadmap (phased)

### Phase 1: Landing template hardening (foundation)

Target outcome:

* Every client subdomain serves a landing page that behaves identically from a tracking and form-funnel perspective.

Milestones:

1. Landing page baseline:
   * consistent CTA and form UX,
   * robust input handling and client-side validation,
   * reliable UTM capture.
2. Analytics instrumentation:
   * emit events consistently (page view, CTA click, form start, form submit),
   * include attribution fields in event payloads.
3. Thank-you page behavior:
   * confirm submission,
   * preserve attribution identifiers when relevant.

Success criteria:

* Manual “happy path” test: form submit arrives in Sheets within expected time.
* No console errors on load and submit flows.

### Phase 2: Lead capture + Sheet schema (data contract)

Target outcome:

* Google Apps Script writes leads to Google Sheets with a stable, versioned schema.

Milestones:

1. Apps Script endpoint:
   * validate required fields,
   * normalize data formats,
   * return deterministic JSON response for success/failure.
2. Google Sheets:
   * define columns and enforce mapping,
   * store `client_slug`, `offer_id`, `page_version`, and timestamp fields.
3. Error handling:
   * track validation errors,
   * store rejection reasons and reattempt behavior if implemented.

Success criteria:

* Every lead submission yields one row (or a logged error record) with correct attribution mapping.

### Phase 3: Daily agent input pipeline (readiness)

Target outcome:

* The AI agent can reliably read the required data daily.

Milestones:

1. Metrics export:
   * define how Ads metrics are exported/collected for the agent.
2. Lead outcome readiness:
   * optional but recommended: add lead outcome updates (e.g., status = qualified/unqualified).
3. Data windowing:
   * agent uses a defined date range and avoids overlapping inconsistent windows.

Success criteria:

* Agent can run end-to-end daily using the same input contracts with no manual intervention.

### Phase 4: Daily optimization (recommendations -> optional application)

Target outcome:

* The agent produces structured recommendations with QA/compliance checks.

Milestones:

1. Recommendation format:
   * structured JSON output,
   * ranked actions with rationale + confidence.
2. QA/compliance:
   * a checker step prevents restricted claims and unsafe text.
3. Application gate:
   * default: recommend-first (no automatic changes),
   * optional: auto-apply for safe categories after review configuration.
4. Audit trail:
   * record agent runs, outputs, and applied change ids.

Success criteria:

* Recommendations are explainable, reviewable, and actionable.

## 4. Agent operating model (daily)

Daily loop (expected):

1. Gather inputs (lead sheet window + Ads performance snapshot).
2. Agent generates a plan.
3. QA/compliance checks validate text and constraints.
4. Store outputs with run id + data snapshot window.
5. If enabled, apply safe changes via Google Ads API.

Non-functional requirements:

* Idempotency (avoid duplicate actions when re-running).
* Deterministic schemas (agent output must be parseable).
* Traceability (inputs -> reasoning -> output -> applied changes).

## 5. Risks and mitigations

1. **Data mismatch risk** (Sheets columns diverge; agent reads wrong fields)  
Mitigation: version the sheet schema and enforce payload validation in Apps Script.
2. **Low signal risk** (few leads, high variance)  
Mitigation: use conservative confidence scoring; widen data windows; optimize for learning.
3. **Compliance risk** (sector restricted claims)  
Mitigation: QA/compliance checker; maintain a sector rules list per client.
4. **Attribution risk** (UTMs missing from events and/or leads)  
Mitigation: include UTM fields in both analytics and lead submission payload.

## 6. Open questions (to finalize)

1. For each sector, what restricted claims/wording rules apply?
2. What is the lead outcome feedback mechanism (manual admin, CRM sync, or form-based status)?
3. Do you want recommendations applied automatically for any categories, or always review-first?

