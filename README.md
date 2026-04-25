# adsvizor-web

Multi-tenant landing page + lead capture system for AdsVizor clients.

## What this is

Each client gets a subdomain (e.g. `formations.adsvizor.com`) served by **Cloudflare Pages**. The repo contains:

- Generic HTML templates (`index.html`, `blog.html`, `contact.html`, `thank-you.html`, `privacy.html`) with `{{placeholder}}` syntax
- Shared assets (`main.css`, `script.js`, `cloudflare-worker.js`)
- Per-client configuration under `clients/{slug}/`
- A daily blog agent (`scripts/blog-agent.js`) that generates SEO articles via Claude API
- A Cloudflare Pages Function (`functions/_middleware.js`) that routes client-specific pages

## Quick start (local dev)

```bash
npm run dev
# opens http://localhost:5500/?client=formations
```

Uses `wrangler pages dev` — required for the Pages Function middleware to run locally.

## Project structure

```
/ (root — shared only)
├── index.html, blog.html, contact.html, privacy.html, thank-you.html
├── main.css, script.js, cloudflare-worker.js
├── favicon.png, logo.png, logo.svg, _headers
├── package.json, wrangler.jsonc, CLAUDE.md

clients/{slug}/
├── config.json          — all web template placeholders
├── agent.config.json    — blog agent prompts + settings
├── blog/                — generated blog articles (HTML)
└── pages/               — client-specific static pages

data/{slug}/
└── blog-history.json    — published articles index

scripts/
└── blog-agent.js        — daily blog article generator (NODE_ENV + CLIENT_SLUG)

functions/
└── _middleware.js        — Cloudflare Pages Function: routes *.html to client directory

.github/workflows/
└── blog-agent.yml        — scheduled GitHub Action (matrix per client)

docs/                     — project documentation
```

## Adding a new client

1. Create `clients/{slug}/config.json` (copy from `clients/formations/config.json`)
2. Create `clients/{slug}/agent.config.json` (copy from `clients/formations/agent.config.json`)
3. Create `data/{slug}/blog-history.json` with `{"posts": []}`
4. Add the subdomain in Cloudflare DNS
5. Add `{slug}` to the matrix in `.github/workflows/blog-agent.yml`

No code changes required — the middleware resolves slugs from the subdomain automatically.

## Deployment

- **Landing pages**: `git push` to `main` → Cloudflare Pages auto-deploys
- **Worker**: `npx wrangler versions upload`
- **Blog agent**: runs daily via GitHub Actions; articles are committed back to the repo

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design and routing
- [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) — coding and naming conventions
- [`docs/PROJECT.md`](docs/PROJECT.md) — business context and goals
- [`docs/PROMPTS.md`](docs/PROMPTS.md) — AI agent prompt library (campaign optimizer)
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — changelog and roadmap
- [`CLAUDE.md`](CLAUDE.md) — in-session guidance for Claude Code
