# AdsVizor Conventions

This file defines conventions used across AdsVizor landing pages, lead capture, and AI agent interactions.

Principles:

1. **No frameworks**: keep pages lightweight and easy to debug.
2. **Stable contracts**: treat form payloads and agent outputs as versioned schemas.
3. **Consistency wins**: uniform event names, uniform column mapping, uniform error handling.

## 1. Repository layout conventions

### 1.1 Client pages

Client content typically lives under:

* `clients/{client_slug}/`

Where `client_slug` is the subdomain identifier (example: `formations`, `immobilier`).

Within each client folder, keep all client-specific data/config in one place (for example a `client.json`), while the shared landing template logic stays in the root.

### 1.2 Shared template files

At minimum, keep these responsibilities:

* `index.html`: base page structure
* `style.css`: styling
* `script.js`: client-side form/analytics logic
* `thank-you.html`: post-submit confirmation

If you introduce additional shared assets, keep them in root or a dedicated `assets/` folder.

## 2. Naming conventions

### 2.1 Slugs

* `client_slug`: lowercase `a-z0-9` and hyphen `-` only.
* `offer_id` (if used): lowercase `a-z0-9` and hyphen `-` only.

Examples:

* `formations`
* `real-estate-coaching`

### 2.2 HTML ids and data attributes

Use explicit, stable selectors:

* `id` for fields that are singletons (e.g., `name`, `email`, `phone`, `message`)
* `data-*` attributes for metadata:
  * `data-client-slug`
  * `data-offer-id`
  * `data-page-version`

## 3. HTML conventions (landing pages)

### 3.1 Meta and performance basics

* Keep the `<head>` minimal.
* Use a single `<main>` element for primary content.
* Avoid large blocking scripts; prefer `defer` for `script.js`.

### 3.2 Form conventions

The lead capture form should:

* use `method="post"` or fetch-based POST (but keep one approach consistent),
* include required fields with clear labels,
* have a single “submit” action.

Client-side behavior:

* disable submit button while the request is in flight,
* show a clear error state if the request fails validation server-side,
* emit analytics events for `form_start` and `form_submit`.

## 4. JS conventions (vanilla)

Goals:

* predictable behavior,
* no implicit globals,
* clear error handling.

### 4.0 FOUC prevention (placeholders)

All landing pages must prevent visitors from seeing raw `{{placeholders}}` (flash of unrendered content).

Standard approach:

* In `style.css`, start with:
  * `body { visibility: hidden; }`
  * `body.ready { visibility: visible; }`
* In `script.js`, add `document.body.classList.add("ready")`:
  * after config loads and placeholder rendering finishes
  * **and** in the error path (catch/failure) so the page still becomes visible

This convention ensures the page only appears once it is rendered (or a controlled error state is shown), instead of flashing template placeholders.

### 4.1 Code style

* Use `const` by default, `let` only when reassignment is needed.
* Use named functions or small helpers; avoid deeply nested callbacks.
* Prefer `fetch()` with `async/await`.
* Keep DOM selectors in one place at the top of the script.

### 4.2 Analytics event conventions

Emit events consistently; event names should be stable strings.

Recommended event list (browser -> analytics provider):

* `page_view`
* `cta_click` (include `cta_id` or CTA label)
* `form_start` (include `client_slug`, `offer_id`, `page_version`)
* `form_submit` (include attribution fields and success/failure reason)

Attribution fields (include when available):

* `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`

## 5. Apps Script + Sheets conventions (data contracts)

Treat these as a versioned schema.

### 5.1 Lead sheet columns

Keep a stable column set:

* `timestamp_submitted` (server authoritative)
* `client_slug`
* `offer_id`
* `visitor_name`
* `visitor_email`
* `visitor_phone`
* `visitor_message`
* `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
* `page_version`
* `consent_marketing` (if used)
* `lead_status` (initially blank; admin/CRM updates later)
* `notes`

### 5.2 Validation conventions

* Validate required fields on the server.
* Return deterministic error codes/messages that the frontend can display.
* Log validation failures (do not silently drop bad payloads).

## 6. AI agent conventions (Claude -> actionable JSON)

### 6.1 Prompt input principles

* Provide the agent only the data it needs for that run.
* Keep a clear date window for “what changed since last run”.
* Provide sector rules and compliance constraints per client.

### 6.2 Prompt output principles

* The agent must output parseable JSON in a well-defined schema.
* Free-form text is allowed only as a companion to structured fields (e.g., `summary`, `rationale`).
* The system must store:
  * agent run id,
  * data window start/end,
  * model/provider metadata (if available),
  * QA/compliance results,
  * final recommended actions.

## 7. Workflow conventions (git and deployment)

### 7.1 Branching and PRs

If you use PRs:

* keep changes small,
* ensure landing page templates and client-specific configs remain in sync.

### 7.2 Deployment expectations

Because Cloudflare Pages auto-deploys on `git push`:

* ensure form endpoint URLs and configuration are correct before pushing,
* avoid committing secrets (API tokens, sheet ids with privileged access, etc.).

## 8. Quality checklist (manual)

Before considering a change “ready” for production:

1. Landing page loads without console errors.
2. Form submission works end-to-end to Sheets.
3. Analytics events fire with correct payload keys.
4. Thank-you page shows the intended message and does not break attribution.
5. Agent output conforms to the expected JSON schema (if prompt/contract changed).

