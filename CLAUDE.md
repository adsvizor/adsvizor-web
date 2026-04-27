# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

AdsVizor is a multi-tenant landing page + lead capture system. Each client gets a subdomain (e.g. `formations.adsvizor.com`) served by **Cloudflare Pages**, which auto-deploys on every `git push` to `main`. There is no build step — everything is vanilla HTML/CSS/JS.

A separate **Cloudflare Worker** (`cloudflare-worker.js`) acts as a CORS proxy, forwarding lead POST requests from the browser to a Google Apps Script endpoint, which writes to Google Sheets. A daily AI agent (Claude API) reads Sheets + Google Ads metrics and outputs structured JSON recommendations.

## Deployment

- `git push` to `main` → Cloudflare Pages deploys static assets automatically
- Worker is deployed via `npx wrangler versions upload` (configured in `wrangler.jsonc`)
- No build step, no bundler

## Local development

Use `wrangler pages dev` (NOT Live Server) — required to run `functions/_middleware.js` locally:

```bash
npm run dev          # starts wrangler pages dev on port 5500
# or directly:
npx wrangler pages dev . --port 5500 --compatibility-date 2026-04-19
```

Then open `http://localhost:5500/?client=formations` for the landing page.
Client-specific pages work automatically: `http://localhost:5500/formations.html?client=formations`

> **Why not Live Server?** Client-specific pages (`formations.html`, blog articles) are stored under
> `clients/{slug}/pages/` and `clients/{slug}/blog/`. The middleware routes them at runtime based on
> the subdomain (production) or `?client=` param (local). Live Server has no middleware support.

## How the template system works

`index.html` and `blog.html` are shared templates using `{{placeholder}}` syntax. At runtime, `script.js`:

1. Detects the client slug from the subdomain (`formations.adsvizor.com` → `formations`), or falls back to `?client=` URL param, form `data-client-slug`, then defaults to `formations`
2. Fetches `clients/{client_slug}/config.json`
3. Walks the DOM and replaces all `{{placeholders}}` in text nodes and attributes
4. Sets `document.body.classList.add("ready")` to reveal the page (FOUC prevention: `body` starts `visibility: hidden`)

**Adding a new client:** create `clients/{slug}/config.json` with all placeholder values. The subdomain routing is handled via Cloudflare DNS — no code change needed.

**Adding a new template placeholder:** add it to the relevant HTML template and to every active `clients/*/config.json`. Unresolved placeholders render as literal `{{key}}` text.

## File responsibilities

- `index.html` / `blog.html` / `thank-you.html` — shared templates, placeholders only
- `style.css` — all styles; mobile-first, breakpoint at 768px; includes blog card styles
- `script.js` — config loading, placeholder rendering, UTM capture, form submission, analytics events
- `cloudflare-worker.js` — CORS proxy for `/api/leads`; enforces origin allowlist
- `wrangler.jsonc` — wrangler config pointing `main` to `cloudflare-worker.js`
- `clients/{slug}/config.json` — all client-specific text and settings
- `clients/{slug}/blog.html` — optional: client-specific static blog page (not template-rendered)

## Key config.json fields

Every client config must include all `{{placeholder}}` keys used in the templates. Critical fields:
- `client_slug`, `offer_id`, `page_version` — included in lead payloads and analytics events
- `form_action` — the Apps Script endpoint URL (e.g. `https://formations.adsvizor.com/api/leads`)
- `nav_item_4_href` / `nav_item_4_label` — blog nav link (set to `blog.html` / `Blog`)
- Blog keys: `blog_title`, `blog_subtitle`, `post_1_*` through `post_3_*`, `read_more_label`

## Lead submission flow

Browser → POST JSON to `cloudflare-worker.js /api/leads` → forwarded to Google Apps Script → appended to Google Sheet.

Payload shape (built in `script.js → buildLeadPayload`):
```json
{
  "client_slug": "...", "offer_id": "...",
  "visitor_name": "...", "visitor_email": "...", "visitor_phone": "...", "visitor_message": "...",
  "utm": { "source": "...", "medium": "...", "campaign": "...", "term": "...", "content": "..." },
  "page_version": "...", "consent_marketing": null
}
```

On success, the page redirects to `thank-you.html`. On error, `script.js` renders an error block (`[data-form-error]`) above the form.

## Analytics events (console-based for now)

Emitted via `console.log("[adsvizor_event]", ...)`:
- `page_view` — on every page load
- `cta_click` — on `[data-cta-id]` click
- `form_start` — on first focus/input in form fields
- `form_submit` — on submit attempt, with `status: "attempt" | "success" | "error"`

## CORS / Worker origin allowlist

`cloudflare-worker.js` allows: `adsvizor.com`, `www.adsvizor.com`, `*.adsvizor.com`, `localhost:5500`, `127.0.0.1:5500`. Non-browser requests without an Origin header are rejected (403).

## AI agent (Claude API)

The daily optimization agent is external to this repo but documented here. It uses three prompt types (see `docs/PROMPTS.md`):
1. **Daily Campaign Optimizer** — reads leads + Ads metrics, outputs ranked `ranked_actions` JSON
2. **Landing Copy Generator** — generates compliant copy blocks as JSON
3. **Compliance QA Checker** — validates candidate text against sector rules

Agent output schema always includes `agent_run_id`, `data_window`, `summary`, `ranked_actions`, and `qa`. Action categories: `bidding | targeting | keywords | ads | landing_copy`.

## Conventions

- Client slugs: lowercase `a-z0-9` and `-` only
- No frameworks, no build steps, no TypeScript
- JS: `const` by default, `async/await` for fetch, no implicit globals
- Before pushing: confirm Cloudflare Pages and Workers builds both go green in the PR checks
