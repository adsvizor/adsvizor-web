# Project Progress & Roadmap

Last updated: 2026-04-25

Owner: Fabrice  
Company: AdsVizor

---

## Current state: all phases complete

### Infrastructure

- **Domain** `adsvizor.com` on Porkbun.
- **Cloudflare** active: SSL, CDN, security.
- **Email routing**: `contact@adsvizor.com` → `adsvizor@gmail.com`.
- **GitHub repo** `adsvizor-web` connected to **Cloudflare Pages** (auto-deploy on every push).
- **Cloudflare Worker** (`cloudflare-worker.js`) deployed as CORS proxy for `/api/leads`.

---

## Completed work (chronological)

### Phase 1 — Landing template foundation ✅

- Generic `index.html` template with `{{placeholder}}` syntax.
- `clients/formations/config.json` — all French CPF content.
- `script.js` — config loading, placeholder rendering, UTM capture, form submission, analytics events.
- `main.css` — mobile-first responsive, FOUC prevention (`body.ready`).
- `thank-you.html` — confirmation page with placeholders.
- `blog.html` — shared blog listing template, supports up to 10 post card slots.
- `contact.html` — fully templateized (all body content uses `{{contact_*}}` placeholders).
- `privacy.html`.

### Phase 2 — Lead capture + Cloudflare Worker ✅

- `cloudflare-worker.js` — CORS proxy, origin allowlist enforced.
- `wrangler.jsonc` — Worker config.
- Google Apps Script endpoint wired to Google Sheets.
- Lead payload schema stable: `client_slug`, `offer_id`, `visitor_*`, `utm.*`, `page_version`, `consent_marketing`.

### Phase 3 — Blog agent V1 ✅

- `scripts/blog-agent.js` — generates SEO articles via Claude API.
- `.github/workflows/blog-agent.yml` — daily scheduled GitHub Action.
- `data/formations/blog-history.json` — published posts index.
- 4 articles live: `sophie-marchand.html`, `cpf-actualites-2026.html`, `formation-ia-generative.html`, `reconversion-cpf-technicien-cybersecurite.html`.

### Phase 4 — Multi-tenant architecture V2 ✅

**Blog agent parameterization:**
- `CLIENT_SLUG` env var controls which client the agent runs for.
- `clients/{slug}/agent.config.json` per client: system prompt, article types, CTA blocks, nav links, base URL. Blog agent reads everything from this file — no hardcoded client content in the script.
- GitHub Actions matrix strategy: `matrix.client: [formations]` — scales to N clients, each a separate job.
- `data/{slug}/blog-history.json` — data isolation per client.
- Max 10 articles cap with FIFO eviction (deletes HTML file + removes from history + clears config slot).

**Option C routing — Cloudflare Pages Function:**
- All client-specific pages moved out of root into `clients/{slug}/`:
  - Blog articles → `clients/{slug}/blog/*.html`
  - Other pages → `clients/{slug}/pages/*.html` (e.g. `formations.html`, `formation-detail.html`)
- `functions/_middleware.js` — global routing middleware:
  - Intercepts all `*.html` requests except root templates.
  - Resolves client slug from subdomain (production) or `?client=` param (local dev).
  - Fetches from `clients/{slug}/blog/` or `clients/{slug}/pages/` via `env.ASSETS.fetch()`.
  - Injects `<base href="/">` so relative links resolve from domain root without editing every HTML file.
  - Falls through to 404 if asset not found.
- `package.json` at root: `npm run dev` runs `wrangler pages dev` on port 5500 (replaces Live Server for local development).

**Template completions:**
- `contact.html` fully templateized — 38 `{{contact_*}}` keys in config.json.
- Blog card slots 4–10 added to `blog.html`, hidden via CSS `:has(a[href=""])` when empty.
- Blog articles sorted newest-first (post_1 = most recent).

**File cleanup:**
- Deleted: `style.css` (replaced by `main.css`), `clients/formations/blog.html` (replaced by per-client dir), `_logo-preview.html`, `functions/blog/[[path]].js` (replaced by `_middleware.js`).
- Moved to `docs/`: architecture HTML/PDF files.

### Phase 5 — Google Ads launch + production hardening ✅

**Lead form improvements:**
- Multi-step form: consent checkbox moved to Step 1 (required to advance), visible from start (RGPD)
- Formation dropdown on all 3 forms (index, blog, contact) with CACES disqualification
- CACES → formation history tracking in Apps Script (`appendFormationHistory_()`)
- sessionStorage cleared after reading (one-time-use, prevents stale formation preselect)
- Loading spinner on submit button during Apps Script processing

**RGPD consent proof:**
- Worker (`adsvizor-leads`) injects `consent_ip` (CF-Connecting-IP) and `consent_user_agent`
- Frontend sends `consent_url`, `consent_text`, `consent_timestamp`
- Worker also injects `visitor_city` and `visitor_region` (Cloudflare `request.cf` geolocation)
- Apps Script v6: 26 columns A–Z, `ensureSchema_()` auto-creates missing columns

**Apps Script versioned in repo:**
- `apps-script/Code.gs` — source of truth, copy-paste to deploy
- `apps-script/README.md` — deploy instructions

**Google Ads setup:**
- Google tag (GT-KD7C7TR3 + AW-18122720723) on all pages
- Conversion event on `thank-you.html` (fires only with `?code=` param and on production)
- Tracking template with UTM params configured in Google Ads
- Worker correctly identified as `adsvizor-leads` (wrangler.jsonc updated)

**Static formation pages for Quality Score:**
- `scripts/generate-formation-pages.js` — generates 10 static HTML pages per client
- Each page has keyword in `<title>`, `<meta description>`, `<h1>`, canonical URL
- Formation cards now link to `/formation-{slug}.html` (not `formation-detail.html?f=`)
- `sitemap.xml` auto-generated with all pages (formation + blog + static)

**SEO fixes:**
- `index.html`: static meta fallbacks (no more `{{placeholders}}` visible to Googlebot)
- `index.html`: canonical tag pointing to `formations.adsvizor.com`
- `_redirects`: 301 from `/formations-cpf.html` → `/formations.html`
- `landing.html`: root domain `adsvizor.com` serves logo only (hides agency identity)
- Middleware updated to serve `landing.html` for all requests on root domain

---

## Active roadmap

### Near term

1. **Second client onboarding** — duplicate `clients/formations/` structure for a new slug, add Cloudflare DNS, add to Actions matrix.
2. **Google Ads integration** — connect performance metrics to campaign optimization agent.
3. **Campaign optimizer** — implement daily agent run (see `docs/PROMPTS.md`); store output in `data/{slug}/agent-runs/`.

### Medium term

1. **Analytics provider** — replace `console.log("[adsvizor_event]", ...)` with a real provider (e.g. Plausible, GA4).
2. **Lead outcome feedback** — admin mechanism to mark leads as qualified/unqualified for tighter agent signal.
3. **A/B testing** — `page_version` field already present; wire up variant logic in `script.js`.

---

## Risks and mitigations

1. **Pages Function cold start** — warm by default on Cloudflare Pages; monitor for latency on first request.
2. **Blog agent commit conflicts** — matrix runs are `fail-fast: false`; if two clients push simultaneously, git conflicts are possible. Mitigation: serialize with a per-client lock or offset cron schedules.
3. **Eviction race** — if blog-agent runs twice in the same day (manual + scheduled), the eviction count could double. Mitigation: history deduplication by slug.
4. **Compliance risk** — sector-specific restricted claims. Mitigation: system prompt and type instructions in `agent.config.json` per client; QA/compliance checker prompt in `docs/PROMPTS.md`.
5. **Secrets exposure** — Apps Script URL, Claude API key, GitHub token. Mitigation: GitHub Actions secrets + Cloudflare env vars, never committed.
