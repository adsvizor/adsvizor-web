# AdsVizor Project Notes

Owner: **Fabrice**  
Company: **AdsVizor** (adsvizor.com)

Repository: `adsvizor-web`  
Hosting: **Cloudflare Pages** (auto-deploy on `git push`)  
Runtime stack: **Vanilla HTML/CSS/JS** (no frameworks)

## 1. What this project is

**AdsVizor** builds and hosts lightweight landing pages for clients in any sector. Each client gets their own subdomain (example: `formations.adsvizor.com`).  

The system runs **Google Ads** campaigns to drive traffic and uses an **AI agent (Claude API)** to optimize campaign strategy **daily** based on performance and lead outcomes.

In practice, the repo provides a template and an operational workflow for:

1. Generating or maintaining a landing page for a given client/offer.
2. Capturing leads via a web form.
3. Storing leads in **Google Sheets** using a **Google Apps Script** endpoint.
4. Feeding lead outcomes + performance signals to a daily AI optimization agent.
5. Tracking changes and ensuring consistent quality across client pages.

## 2. Business model and key assumptions

### Client delivery model

Clients pay for:

1. Landing page(s) built from a fast, consistent template.
2. Ongoing Google Ads management.
3. AI-assisted daily optimization (creative and targeting recommendations, plus structured adjustments to the campaign plan).

### Core assumption

Lead quality is observable (or at least estimable) and can be correlated with:

1. Ads performance (clicks, conversions, cost, CTR, CVR).
2. Landing page variables (headline, offer framing, CTA wording, form friction).
3. Sector-specific compliance constraints (claims, industries, legal wording).

When this correlation exists, daily optimization improves results.

## 3. Goals

### Primary goals

1. **Speed:** deliver client landing pages quickly, with minimal engineering overhead.
2. **Consistency:** keep UX, performance, and analytics instrumentation uniform across clients.
3. **Automation:** reduce manual steps in lead capture, reporting, and campaign optimization.
4. **Optimization loop:** ensure daily agent recommendations can be implemented safely and auditable.

### Secondary goals

1. **Auditability:** keep a trace of what the agent recommended and why (inputs + reasoning summaries).
2. **Safety and compliance:** prevent restricted claims and ensure form/landing content respects sector rules.
3. **Extensibility:** allow new sectors/offers without rewriting the core template.

## 4. Non-goals (to reduce scope creep)

1. No heavy frontend frameworks or build pipelines required for landing pages.
2. No “one-off” ad-hoc copy changes without a review/quality step.
3. No complex multi-service microservice architecture in this repo; integrations should be documented and isolated.

## 5. Inputs and outputs

### Inputs (from external systems)

1. Google Ads performance data (per campaign/ad group/asset).
2. Lead data from Google Sheets.
3. Client landing page configuration (offer, sector, target persona, compliance constraints).
4. Optional: CRM outcomes or lead status feedback (for stronger optimization).

### Outputs (to external systems)

1. Structured recommendations and/or updates to Google Ads (via Google Ads API).
2. Updated landing page content blocks (if you choose to support iterative landing page testing).
3. Logs/reports for internal review.

## 6. Operational principles

1. **Daily cadence:** the AI agent runs on a schedule and must produce deterministic, structured outputs.
2. **Make changes reversible:** changes to pages/campaign settings should be traceable and, where possible, revertible.
3. **Prefer schemas:** store agent outputs in predictable JSON-like structures so automation is safer than free-form text.
4. **Human-in-the-loop:** even if the system can auto-apply suggestions, preserve a “review gate” option.

## 7. Definition of done (DoD)

A client onboarding + optimization cycle is “done” when:

1. The landing page loads fast and captures form submissions reliably.
2. Submissions arrive in Google Sheets with a stable schema.
3. Analytics events are emitted consistently (page view, CTA clicks, form start, form submit).
4. The daily agent can read the latest lead + Ads metrics and generate recommendations that pass QA/compliance checks.
5. The recommendations are stored with a timestamp, version, and summary.

## 8. Release checklist (high-level)

Before pushing changes:

1. Confirm Cloudflare Pages deploy succeeds.
2. Validate form endpoint URL and required fields.
3. Confirm analytics event names/payloads are consistent.
4. Run a quick “happy path” manual test: fill form, submit, verify the Apps Script writes to Sheets.
5. If prompt templates changed, update version notes in `docs/PROMPTS.md`.

