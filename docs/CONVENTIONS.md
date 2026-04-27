# AdsVizor Conventions

Conventions used across AdsVizor landing pages, lead capture, blog agent, and AI agent interactions.

Principles:

1. **No frameworks**: keep pages lightweight and easy to debug.
2. **Stable contracts**: treat form payloads and agent outputs as versioned schemas.
3. **Consistency wins**: uniform event names, uniform column mapping, uniform error handling.

## 1. Repository layout conventions

### 1.1 Root — shared only

The root contains only generic, client-agnostic assets:

- Templates: `index.html`, `blog.html`, `contact.html`, `privacy.html`, `thank-you.html`
- Shared assets: `main.css`, `script.js`, `cloudflare-worker.js`
- Config: `package.json`, `wrangler.jsonc`, `CLAUDE.md`

**Do not put client-specific files in the root.**

### 1.2 Client directory

All client content lives under `clients/{client_slug}/`:

```
clients/{slug}/
├── config.json          ← all {{placeholder}} values used in templates
├── agent.config.json    ← blog agent prompts, article types, CTA blocks
├── blog/                ← generated blog articles (*.html)
└── pages/               ← client-specific static pages (*.html)
```

`client_slug` is the subdomain identifier: lowercase `a-z0-9` and `-` only.

### 1.3 Data directory

Per-client runtime data lives under `data/{client_slug}/`:

```
data/{slug}/
└── blog-history.json    ← published articles index
```

### 1.4 Shared template files

Root templates use `{{placeholder}}` syntax. Every placeholder key must exist in `clients/{slug}/config.json`. Unresolved placeholders render as literal `{{key}}` (visible for debugging).

### 1.5 Local development

Use `wrangler pages dev` (NOT Live Server):

```bash
npm run dev   # wrangler pages dev . --port 5500 --compatibility-date 2026-04-19
```

Live Server has no middleware support — `functions/_middleware.js` will not run, and client-specific pages won't be found.

## 2. Naming conventions

### 2.1 Slugs

- `client_slug`: lowercase `a-z0-9` and hyphen `-` only.
- `offer_id`: lowercase `a-z0-9` and hyphen `-` only.

Examples: `formations`, `real-estate-coaching`

### 2.2 Blog article filenames

Blog article HTML files live at `clients/{slug}/blog/{filename}.html` and are served at `/blog/{filename}.html`.

- Filename: lowercase, hyphen-separated, **no** `blog-` prefix (e.g. `sophie-marchand.html`).
- Slug stored in history: may include `blog-` prefix as a unique ID — this is just an identifier.
- URL-facing path is always clean: `/blog/sophie-marchand.html`.

### 2.3 HTML ids and data attributes

Use explicit, stable selectors:

- `id` for singleton fields (e.g. `name`, `email`, `phone`, `message`)
- `data-*` for metadata: `data-client-slug`, `data-offer-id`, `data-page-version`, `data-cta-id`

## 3. HTML conventions

### 3.1 Templates

- Use `{{placeholder}}` for all client-specific text, links, and values.
- Keep the `<head>` minimal.
- Use a single `<main>` for primary content.
- Avoid large blocking scripts; prefer `defer` on `script.js`.
- Client-specific pages must not hardcode root-relative paths — the middleware injects `<base href="/">` at runtime.

### 3.2 Form conventions

- Use fetch-based POST (not native `method="post"` form submit).
- Disable submit button while in flight.
- Show `[data-form-error]` block above the form on error.
- On success, redirect to `thank-you.html`.
- Emit `form_start` on first focus/input, `form_submit` on submit attempt.

## 4. CSS conventions

- File: `main.css` (not `style.css`).
- Mobile-first, single breakpoint at `768px`.
- FOUC prevention: `body { visibility: hidden; }` → `body.ready { visibility: visible; }`.
- Blog card hide rule: `.blog-card:has(a[href=""]) { display: none; }` (hides empty post slots).

## 5. JS conventions (vanilla)

- `const` by default, `let` only when reassignment is needed.
- `async/await` for all fetch calls.
- No implicit globals.
- Named functions or small helpers; avoid deeply nested callbacks.
- DOM selectors gathered at the top of the script.

### 5.1 FOUC prevention

After config loads and placeholder rendering finishes (and in the error path):

```js
document.body.classList.add("ready");
```

### 5.2 Analytics events

Emitted via `console.log("[adsvizor_event]", {...})`:

| Event | When |
|-------|------|
| `page_view` | Every page load |
| `cta_click` | On `[data-cta-id]` click |
| `form_start` | First focus/input in form fields |
| `form_submit` | Submit attempt — `status: "attempt" \| "success" \| "error"` |

## 6. Blog agent conventions

- Agent is parameterized by `CLIENT_SLUG` env var.
- All client-specific content (system prompt, article types, CTAs, nav) comes from `clients/{slug}/agent.config.json` — nothing hardcoded in the script.
- Article types rotate; the type is chosen based on history to avoid consecutive duplicates.
- Max 10 articles per client. On eviction: delete HTML file, remove from history, clear config slot.
- Config `post_1_*` = most recent article, `post_10_*` = oldest.
- Article `href` format in config: `blog/{filename}.html` (no leading slash; resolved relative to `<base href="/">`).
- GitHub Actions matrix per client: `fail-fast: false`.

## 7. Apps Script + Sheets conventions

Stable column set for lead sheet:

- `timestamp_submitted`, `client_slug`, `offer_id`
- `visitor_name`, `visitor_email`, `visitor_phone`, `visitor_message`
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
- `page_version`, `consent_marketing`
- `lead_status` (admin updates), `notes`

Always validate required fields server-side. Return deterministic error codes the frontend can display.

## 8. AI agent conventions (campaign optimizer)

- Outputs must be valid, parseable JSON.
- Free-form text only in companion fields (`summary`, `rationale`).
- Store: `agent_run_id`, `data_window`, model metadata, QA results, ranked actions.
- Prompt templates and compliance rules kept in `docs/PROMPTS.md` (campaign optimizer) or `clients/{slug}/agent.config.json` (blog agent).

## 9. Deployment conventions

- `git push` to `main` triggers Cloudflare Pages auto-deploy.
- Worker changes: `npx wrangler versions upload`.
- Never commit secrets (API keys, Apps Script URLs with privileged access, Google Sheet IDs).
- Confirm Cloudflare Pages and Workers builds both go green before considering a change shipped.

## 10. Quality checklist (manual)

Before pushing:

1. Landing page loads without console errors at `http://localhost:5500/?client=formations`.
2. All `{{placeholders}}` resolved (none visible as literal text).
3. Form submission works end-to-end to Sheets.
4. Analytics events fire with correct payload keys.
5. Thank-you page shows correctly and preserves UTM params.
6. Blog listing shows newest article first; empty slots are hidden.
7. Client-specific pages (`/formations.html`, `/blog/sophie-marchand.html`) load correctly via middleware.
