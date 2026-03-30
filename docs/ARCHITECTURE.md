# AdsVizor Architecture

This document describes how the AdsVizor lead-generation landing page system is structured end-to-end.

## 1. System overview

AdsVizor provides a repeatable pipeline:

1. A client gets a subdomain (example: `formations.adsvizor.com`).
2. A lightweight landing page is served from that subdomain via **Cloudflare Pages**.
3. Visitors interact with the landing page and submit a lead form.
4. Submissions are sent to a backend endpoint implemented as a **Google Apps Script** web app.
5. The Apps Script writes lead data to a **Google Sheet**.
6. A daily **AI optimization agent** (Claude API) reads new leads + campaign performance context and recommends improvements to Google Ads.
7. Recommendations feed back into the day-to-day operating system: they are logged, reviewed, and (optionally) applied through the **Google Ads API**.

The key idea is a tight loop between:

* **traffic quality** (Google Ads performance),
* **conversion behavior** (landing page UX + form funnel),
* **lead outcomes** (lead sheet feedback),
* **campaign strategy changes** (agent recommendations).

## 2. Deployment and hosting

### Cloudflare Pages

* The repo is connected to **Cloudflare Pages**.
* Every `git push` triggers an automatic redeploy of static assets.
* Per-client subdomains are routed via DNS and Cloudflare configuration.

### Subdomain mapping

There are multiple ways to map subdomains to static content; the system should be consistent with whichever mapping you choose.

Expected behavior:

* Each client subdomain loads a landing page variant determined by a client identifier (slug) and configuration.
* The landing page should not require server-side rendering; configuration should be encoded/loaded in a safe way (for example: embedded config, or a lightweight client-side fetch).

## 3. Major components

### 3.1 Landing page template (static)

Files in the repo (example names):

* `index.html` – landing page base template
* `style.css` – styles
* `script.js` – client-side behavior
* `thank-you.html` – confirmation page after submission

Responsibilities:

* Render the offer/benefits/CTA and lead capture form.
* Emit analytics events (page view, CTA clicks, form start/submit).
* Collect form fields and submit them to the Apps Script endpoint.
* Store client/offer metadata in `data-*` attributes or query parameters so submissions are attributable.

Non-goals:

* No frameworks, no heavy build steps.
* No dependency on server-side templating at runtime.

### 3.2 Lead capture endpoint (Apps Script)

**Google Apps Script** exposes an HTTP endpoint.

Responsibilities:

* Validate the incoming payload shape.
* Normalize fields (trim, normalize phone/email formats, enforce required fields).
* Write the submission to a Google Sheet (append-only style).
* Return a small JSON response or a redirect signal.

Data handling guidelines:

* Treat PII carefully; minimize stored fields.
* Store raw submission plus derived metadata (client slug, offer id, timestamps).
* If you implement consent, store consent state explicitly and consistently.

### 3.3 Google Sheet (lead database)

The sheet is the canonical lightweight database.

Expected columns:

* `timestamp_submitted` (ISO string)
* `client_slug`
* `offer_id` (or `landing_id`)
* `visitor_name` (optional)
* `visitor_email`
* `visitor_phone` (optional)
* `visitor_message` (optional)
* `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` (if available)
* `page_version` (landing page build/version string)
* `consent_marketing` (if applicable)
* `lead_status` (initially blank or default)
* `notes` (operator/admin notes if needed)

The sheet should also support:

* backfilling campaign performance references (if you choose to store GAds click ids, etc.)
* export/sync for the agent (either direct read or via a controlled data export).

### 3.4 AI optimization agent (Claude API)

Responsibilities:

* Read latest leads (and their outcomes if available) from Sheets.
* Read Google Ads performance metrics from a provided export or from a data bridge.
* Create a structured plan to improve performance:
  * creative messaging adjustments (if supported),
  * targeting changes,
  * budget and bidding recommendations,
  * negative keywords and ad text refinements (as policies allow).
* Output:
  * a machine-readable recommendation JSON,
  * a human-readable summary for review,
  * QA/compliance notes.

Cadence:

* Runs **daily** (or at a defined schedule).
* Should be idempotent: re-running for the same day should not produce duplicate conflicting actions.

### 3.5 Google Ads integration (Google Ads API)

Responsibilities:

* Provide performance metrics to the agent.
* Optionally apply the agent’s recommendations back to campaigns/ad groups/assets.

Safe integration strategy:

* Use a “recommend first” mode by default.
* Apply changes only after QA checks and, if enabled, a review gate.

## 4. End-to-end flows

### Flow A: Landing page -> lead capture

1. User loads `https://{client-subdomain}/...`.
2. Landing JS initializes:
   * reads client metadata,
   * attaches event listeners,
   * captures UTM parameters if present.
3. User submits the form.
4. The browser sends a POST request to the Apps Script endpoint with:
   * form fields,
   * client slug + offer id,
   * timestamps (optional; server will set authoritative timestamp),
   * UTM info.
5. Apps Script validates and appends to Google Sheet.
6. Page redirects to `thank-you.html` (or displays a success state).

### Flow B: Daily AI optimization

1. Scheduler triggers the agent orchestration job.
2. Agent reads:
   * recent lead records and outcomes (if available),
   * aggregated landing funnel metrics (if you store them),
   * Google Ads performance data.
3. Agent produces:
   * recommendations ranked by expected impact,
   * confidence and assumptions,
   * actions that can be safely applied,
   * “do not change” items and rationale.
4. QA/compliance checker validates any text recommendations for restricted content.
5. Final plan is stored with:
   * agent version,
   * data snapshot window,
   * output JSON,
   * timestamps and traceable reasoning summary.
6. Optional application step:
   * apply via Google Ads API, then record “applied changes” with external ids.

## 5. Data contracts (recommended)

To keep the system robust, treat payloads and outputs as explicit contracts.

### 5.1 Lead submission payload (browser -> Apps Script)

Recommended JSON shape:

```json
{
  "client_slug": "string",
  "offer_id": "string",
  "visitor_name": "string|null",
  "visitor_email": "string",
  "visitor_phone": "string|null",
  "visitor_message": "string|null",
  "utm": {
    "source": "string|null",
    "medium": "string|null",
    "campaign": "string|null",
    "term": "string|null",
    "content": "string|null"
  },
  "page_version": "string",
  "consent_marketing": "boolean|null"
}
```

### 5.2 Agent recommendation output (Claude -> system)

Recommended JSON shape:

```json
{
  "agent_run_id": "string",
  "data_window": { "start": "ISO", "end": "ISO" },
  "summary": "string",
  "ranked_actions": [
    {
      "action_id": "string",
      "category": "bidding|targeting|keywords|ads|landing_copy",
      "priority": "high|medium|low",
      "rationale": "string",
      "expected_impact": { "metric": "string", "direction": "up|down", "confidence": 0.0 },
      "change_payload": { "type": "json-object" }
    }
  ],
  "qa": {
    "risks": ["string"],
    "compliance_notes": ["string"],
    "text_recommendations_present": true
  }
}
```

## 6. Security, privacy, and compliance

The system handles PII (name/email/phone). The architecture should follow:

* Principle of least privilege:
  * Apps Script service account/token should only access the target sheet.
  * Ads API token should only access the relevant customer ids.
* Transport security:
  * all traffic must use HTTPS (Cloudflare provides TLS for the frontend).
* Data minimization:
  * store only what is needed for lead follow-up and optimization.
* Consent handling:
  * if you run marketing consent flows, persist consent and timestamp.
* Compliance:
  * agent must avoid restricted claims for the client’s sector.

## 7. Operational logging

Store these events somewhere reviewable (sheet, log table, or storage):

* Lead submissions and validation errors.
* Agent runs:
  * input window,
  * model/version,
  * generated output.
* Application step:
  * which actions were applied,
  * external ids from Google Ads API,
  * errors/rollback decisions.

