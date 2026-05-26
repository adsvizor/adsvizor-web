# AdsVizor Architecture

End-to-end system design for the AdsVizor multi-tenant landing page + lead capture platform.

## 1. System overview

AdsVizor provides a repeatable pipeline:

1. A client gets a subdomain (e.g. `formations.adsvizor.com`).
2. A shared landing page template is served from that subdomain via **Cloudflare Pages**.
3. A **Cloudflare Pages Function** (`functions/_middleware.js`) intercepts HTML requests and routes them to the correct client directory at runtime.
4. Visitors interact with the landing page and submit a lead form.
5. Submissions are proxied through a **Cloudflare Worker** to a **Google Apps Script** endpoint, which writes to **Google Sheets**.
6. A daily **blog agent** (Claude API, GitHub Actions) generates SEO articles per client and commits them back to the repo.
7. A daily **campaign optimization agent** (Claude API) reads leads + Google Ads metrics and produces structured JSON recommendations.

## 2. Repository layout

```
/ (root — generic assets, shared by all clients)
├── index.html, blog.html, contact.html, privacy.html, thank-you.html  ← templates
├── main.css, script.js, cloudflare-worker.js                          ← shared
├── favicon.png, logo.png, logo.svg, _headers, _redirects
├── package.json, wrangler.jsonc, CLAUDE.md, sitemap.xml

clients/{slug}/
├── config.json          ← all {{placeholder}} values for the web templates
├── agent.config.json    ← blog agent: system_prompt, article_types, cta_blocks, nav_links
├── blog/                ← generated blog articles (e.g. sophie-marchand.html)
└── pages/
    ├── formations.html               ← formations listing page
    ├── bureautique/                  ← Excel, Word, PowerPoint, Outils Collaboratifs, WordPress, PAO, Bases Informatiques
    ├── langues/                      ← Anglais TOEIC
    ├── management/                   ← Management Leadership, Gestion de Projet
    ├── marketing/                    ← Marketing Digital
    ├── finance/                      ← Comptabilité & Paie
    ├── dev-personnel/                ← Développement Personnel, Bilan de Compétences
    ├── entrepreneuriat/              ← Création d'Entreprise
    └── ia/                           ← Intelligence Artificielle

data/{slug}/
└── blog-history.json    ← published posts index (max 10, FIFO eviction)

scripts/
└── blog-agent.js        ← parameterized by CLIENT_SLUG env var

functions/
└── _middleware.js        ← Cloudflare Pages Function: routes *.html + handles 301 redirects

.github/workflows/
└── blog-agent.yml        ← matrix strategy: one job per client slug
```

## 3. Request routing

### Production (subdomain)

```
formations.adsvizor.com/formations.html
  → _middleware.js detects slug "formations" from hostname
  → fetches /clients/formations/pages/formations.html from Pages ASSETS
  → injects <base href="/"> so relative links resolve from domain root
  → returns 200

formations.adsvizor.com/blog/sophie-marchand.html
  → _middleware.js detects slug "formations"
  → fetches /clients/formations/blog/sophie-marchand.html
  → injects <base href="/">
  → returns 200

formations.adsvizor.com/          (root templates)
formations.adsvizor.com/index.html
formations.adsvizor.com/blog.html
formations.adsvizor.com/contact.html
formations.adsvizor.com/thank-you.html
formations.adsvizor.com/privacy.html
  → _middleware.js passes through to Cloudflare Pages directly (ROOT_TEMPLATES set)
```

### Local dev (wrangler pages dev)

```bash
npm run dev
# http://localhost:5500/?client=formations
```

`wrangler pages dev` runs `functions/_middleware.js` locally. Without it, routing to `clients/` directories doesn't work. The `?client=` param replaces subdomain detection when running on localhost.

### Why `<base href="/">`

Client-specific pages live at `/clients/{slug}/blog/` or `/clients/{slug}/pages/` physically, but are served at `/blog/*.html` or `/*.html` via the middleware. Without `<base href="/">`, relative links in those files (CSS, JS, nav hrefs) would resolve relative to the physical path and break. The middleware injects this tag dynamically — no manual edits to each HTML file needed.

## 4. Template system

`index.html`, `blog.html`, `contact.html`, and `thank-you.html` are shared templates using `{{placeholder}}` syntax.

At runtime, `script.js`:

1. Detects client slug from subdomain, then `?client=` param, then `data-client-slug` form attribute, then defaults to `formations`.
2. Fetches `clients/{slug}/config.json`.
3. Walks the DOM and replaces all `{{placeholders}}` in text nodes and attributes.
4. Adds `document.body.classList.add("ready")` to reveal the page (FOUC prevention — `body` starts `visibility: hidden`).

Unresolved placeholders render as literal `{{key}}` text (intentionally visible for debugging).

## 5. Lead capture flow

```
Browser (form7)
  → sendPartialLead at step 1 (coords) and step 4 (formation)   ← lead captured early
  → Promise.all([postLead, minRead 2.5s]) at result step         ← full lead + min reading time
  → POST JSON to /api/leads (Cloudflare Worker — CORS proxy)
  → Worker injects server-side fields (IP, UA, city, region)
  → forwards to Google Apps Script endpoint
  → appended to Google Sheet (26 columns A–Z)
  → redirect to thank-you.html?code=XXXXXX
```

**Full lead payload (form7):**
```json
{
  "client_slug": "formations", "offer_id": "...", "page_version": "...",
  "visitor_name": "Prénom Nom", "visitor_phone": "+33612345678",
  "visitor_email": null,
  "formation_interest": "Excel", "professional_status": "salarie",
  "security_code": "738291",
  "utm": { "source": "google", "medium": "cpc", "campaign": "...", "term": "...", "content": "..." },
  "consent_marketing": true,
  "consent_url": "https://formations.adsvizor.com/...",
  "consent_text": "J'accepte d'être recontacté(e)...",
  "consent_timestamp": "...",
  "search_query": "..."
}
```

**Partial lead payload** (sent at step 1 and step 4, `partial: true`, `consent_text: "partial"`).

`savePendingLead` guards: skips payloads with no `visitor_phone / visitor_name / visitor_email` to prevent empty leads from being saved or retried.

The Worker (`cloudflare-worker.js`) enforces an origin allowlist: `adsvizor.com`, `*.adsvizor.com`, `localhost:*`, `127.0.0.1:*`. Requests without an Origin header are rejected (403).

## 6. Blog agent

`scripts/blog-agent.js` runs as a GitHub Actions job, scheduled daily. It is parameterized by `CLIENT_SLUG` env var (set by the Actions matrix).

Per run:

1. Reads `clients/${CLIENT_SLUG}/agent.config.json` for system prompt, article types, CTA blocks, nav links.
2. Reads `data/${CLIENT_SLUG}/blog-history.json` to avoid duplicates.
3. Calls Claude API to generate one article (type rotated: `temoignage`, `actualites`, `formation`).
4. Assembles a complete standalone HTML file with nav, article body, and CTA.
5. Writes to `clients/${CLIENT_SLUG}/blog/{slug}.html`.
6. Updates `clients/${CLIENT_SLUG}/config.json` blog post slots (prepends newest, max 10, FIFO eviction).
7. Updates `data/${CLIENT_SLUG}/blog-history.json` (removes evicted entries, deletes their HTML files).
8. Commits + pushes → Cloudflare Pages auto-deploys.

### agent.config.json

Per-client configuration for the blog agent:

```json
{
  "client_name": "...",
  "base_url": "https://formations.adsvizor.com",
  "footer_text": "...",
  "cta_link": "contact.html",
  "system_prompt": "...",
  "article_types": ["temoignage", "actualites", "formation"],
  "type_labels": { "temoignage": "Témoignage", ... },
  "type_instructions": { "temoignage": "...", ... },
  "cta_blocks": { "temoignage": { "h2": "...", "p": "..." }, ... },
  "nav_links": [{ "href": "formations.html", "label": "Nos Formations" }, ...]
}
```

### Blog post cap and eviction

`MAX_BLOG_POSTS = 10`. When a new article would exceed the cap, the oldest slot is evicted: its HTML file is deleted, its entry removed from history, and its config slot cleared. The `blog.html` template hides empty card slots via CSS:

```css
.blog-card:has(a[href=""]) { display: none; }
```

## 7. Campaign optimization agent

External to this repo (documented for reference). Runs daily, reads leads + Google Ads metrics, outputs structured JSON recommendations. See `docs/PROMPTS.md` for prompt library.

Output schema: `agent_run_id`, `data_window`, `summary`, `ranked_actions`, `qa`.  
Action categories: `bidding | targeting | keywords | ads | landing_copy`.

## 8. Deployment

| Target | How |
|--------|-----|
| Landing pages + blog | `git push` to `main` → Cloudflare Pages auto-deploys |
| Cloudflare Worker | `npx wrangler versions upload` |
| Blog articles | GitHub Actions commits + pushes generated HTML |

No build step. No bundler. Everything is vanilla HTML/CSS/JS.

## 9. Multi-tenant: adding a new client

### Manual (legacy)

1. `clients/{slug}/config.json` — all template placeholder values
2. `clients/{slug}/agent.config.json` — blog agent context
3. `data/{slug}/blog-history.json` — `{"posts": []}`
4. Cloudflare DNS: add `{slug}` CNAME → Pages project
5. `.github/workflows/blog-agent.yml` matrix: add `{slug}` to the client list

No middleware changes needed — the slug is resolved from the subdomain at runtime.

### Automated via Webuilder (current)

Send an email to `webuilder@adsvizor.com`:
- Subject: `WEBUILDER: {slug} - Business description`
- Body: client info (name, address, phone, email, area, brands)
- Attachment: PDF/DOCX/XLSX catalog (optional but recommended)

The pipeline handles everything automatically. See §15 for full details.

## 15. Webuilder pipeline

End-to-end automated client onboarding: email → live site in ~10 minutes.

```
Gmail (webuilder@adsvizor.com)
  → Apps Script (IntakeAgent.gs) — polls every 5 min
      ↓ extracts PDF text via Drive API
      ↓ creates branch webuilder/{slug} + NOTES.md
      ↓ opens GitHub PR
  → GitHub Actions (webuilder-agent.yml) — triggers on PR open
      ↓ reads NOTES.md + catalog text
      ↓ Brave Search: reviews + 4 competitor pages (parallel)
      ↓ Claude claude-opus-4-6 → generates complete config.json
      ↓ writes clients/{slug}/config.json + agent.config.json
      ↓ posts ✅ comment on PR
  → Human merges PR
  → Cloudflare Pages auto-deploys
  → GitHub Actions (webuilder-dns.yml) — triggers on push to main
      ↓ detects new clients/*/config.json via git diff
      ↓ creates CNAME DNS record via Cloudflare API
      ↓ adds custom domain to Pages project
  → {slug}.adsvizor.com live in ~2 min
```

### Key files

| File | Role |
|------|------|
| `apps-script/IntakeAgent.gs` | Email intake, PDF extraction, GitHub branch+PR creation |
| `.github/workflows/webuilder-agent.yml` | Triggers on `webuilder/*` PR; runs Node.js agent |
| `scripts/webuilder-agent.js` | Catalog extraction + web research + Claude API call |
| `.github/workflows/webuilder-dns.yml` | Post-merge DNS + Pages domain config; supports `workflow_dispatch` |

### config.json completeness

The agent generates all required fields in one pass:
- SEO/meta, nav (5 items), hero, stats, benefits, why_us (a–d)
- Form: service dropdown (4–6 options), personal field labels, RGPD disclaimer, submit label
- Thank-you page, footer
- Contact page: hero, benefits (a–d), process steps (1–5 with icon/image/title/text)
- Blog page: title, subtitle, 4 posts with date + tag
- Privacy page

Reference schema: `clients/formations/config.json`

### Web research (requires `BRAVE_API_KEY` secret)

For each new client, the agent runs 2 parallel searches:
1. **Reviews** — `avis clients "{businessName}"` + `{sector} {city} avis Google`
2. **Competitors** — finds 4 competitor sites, scrapes their text (max 2500 chars each)

Claude uses both to generate differentiated why_us arguments and competitor-informed copy.

## 10. Security and data

- PII (name/email/phone) stored only in Google Sheets via Apps Script.
- Worker enforces origin allowlist — browser-only submissions.
- Secrets (Apps Script URL, Claude API key, GitHub token) stored as GitHub Actions secrets or Cloudflare env vars — never committed.
- Agent output is recommendations only; changes to Google Ads are applied manually or after a review gate.

## 11. Root domain isolation

`adsvizor.com` (no subdomain) serves `landing.html` — just the centered logo. This hides the agency identity from anyone who types the root domain manually. All real client sites live on subdomains.

The middleware detects `hostParts.length === 2` (or `www.`) and serves `landing.html` for any HTML request. Static assets (logo, favicon, CSS) are still served normally.

## 12. Static formation pages (Google Ads Quality Score)

JS-rendered pages (`formation-detail.html?f=bureautique`) hurt Google Ads Quality Score because the crawler may see placeholder content before JS executes. Static pages solve this.

`scripts/generate-formation-pages.js` reads `clients/{slug}/config.json` and generates:
- `clients/{slug}/pages/{category}/formation-{slug}.html` — one per formation, organised by category
- `sitemap.xml` at repo root — all pages indexed

Each static page has the keyword hardcoded in `<title>`, `<meta description>`, `<h1>`, and `<link rel="canonical">`. `script.js` still runs for form handling, UTM capture, analytics.

**Performance (critical for Quality Score):**
- `body{visibility:hidden}` removed immediately by inline `<script>document.body.classList.add('ready')</script>` — page visible at HTML parse time, no network delay
- GTM removed from `<head>`; deferred 1.5s after `window.load` to eliminate TBT
- Both fixes applied to all 39 pages AND baked into the generator template

Run after any formation content change: `node scripts/generate-formation-pages.js`

## 13. RGPD consent proof

Every lead submission captures a full consent audit trail:

| Field | Source | How |
|-------|--------|-----|
| `consent_url` | Frontend | `window.location.href` |
| `consent_text` | Frontend | Checkbox label text content |
| `consent_timestamp` | Frontend | ISO timestamp at submit |
| `consent_ip` | Worker | `CF-Connecting-IP` header |
| `consent_user_agent` | Worker | `User-Agent` header |
| `visitor_city` | Worker | `request.cf.city` |
| `visitor_region` | Worker | `request.cf.region` |

Worker fields are server-side — cannot be forged by the browser.

Apps Script (`apps-script/Code.gs` v6) stores all 26 fields in columns A–Z. `ensureSchema_()` auto-creates missing columns on every request.

## 14. Google Ads tracking

- Google tag IDs: `GT-KD7C7TR3` (Google Tag) + `AW-18122720723` (Google Ads) on all pages
- Conversion event fires on `thank-you.html` only when `?code=` param is present and hostname is not localhost
- Tracking template: `{lpurl}?utm_source=google&utm_medium=cpc&utm_campaign={campaign}&utm_term={keyword}&utm_content={adgroupid}`
- Formation landing pages: `formations.adsvizor.com/{category}/formation-{slug}.html`
