# Contexte AdsVizor Webuilder — à coller en début de conversation

## Ce qu'on a construit
Pipeline complet "Webuilder" : email → site client auto-généré + DNS configuré automatiquement.

**Flow :**
1. J'envoie un email depuis Gmail à webuilder@adsvizor.com
   - Sujet : `WEBUILDER: {slug} - Description`
   - Corps : infos client (nom, adresse, tel, email, zone, marques)
   - PJ : catalogue PDF/Excel/Word
2. Apps Script (AdsVizor Intake → Code.gs) détecte l'email toutes les 5 min
   - Extrait le texte du PDF via conversion Google Docs (Drive API v2 activée)
   - Crée branche `webuilder/{slug}` sur GitHub
   - Crée `webuilder/{slug}/NOTES.md` avec infos + texte extrait embarqué
   - Ouvre un PR GitHub
3. GitHub Actions (webuilder-agent.yml) se déclenche sur le PR
   - Lit NOTES.md
   - Recherche web : avis clients + scraping de 4 sites concurrents (via Brave Search API)
   - Appelle Claude API (claude-opus-4-6) pour générer config.json complet
   - Écrit `clients/{slug}/config.json` + `clients/{slug}/agent.config.json`
   - Poste un commentaire ✅ sur le PR
4. On merge le PR → Cloudflare Pages déploie automatiquement
5. GitHub Actions (webuilder-dns.yml) se déclenche au merge
   - Crée le CNAME DNS pour `{slug}.adsvizor.com`
   - Ajoute le custom domain sur Cloudflare Pages
   - Site live en ~2 minutes

## Statut — tout est opérationnel ✅

## Repo
github.com/adsvizor/adsvizor-web
- Stack : HTML/CSS/JS vanilla, Cloudflare Pages, pas de build step
- Chaque client : `clients/{slug}/config.json` + templates partagés index.html/blog.html/etc.
- Worker Cloudflare (`adsvizor-leads`) = proxy CORS pour leads → Google Sheets

## Fichiers clés
- `apps-script/IntakeAgent.gs` → script Apps Script (collé dans Code.gs dans AdsVizor Intake)
- `.github/workflows/webuilder-agent.yml` → agent GitHub Actions (génère config.json)
- `.github/workflows/webuilder-dns.yml` → auto DNS post-merge + workflow_dispatch pour trigger manuel
- `scripts/webuilder-agent.js` → agent Node.js : extraction catalogue + recherche web + Claude API
- `scripts/package.json` → dépendances : @anthropic-ai/sdk, pdf-parse, mammoth, xlsx, node-fetch

## Secrets GitHub configurés
- `ANTHROPIC_API_KEY` ✅
- `GITHUB_TOKEN` ✅ (automatique)
- `CLOUDFLARE_API_TOKEN` ✅ (token `webuilder-dns` — Zone/DNS Edit + Account/Pages Edit)
- `CLOUDFLARE_ZONE_ID` ✅
- `CLOUDFLARE_ACCOUNT_ID` ✅
- `BRAVE_API_KEY` ✅ (Brave Search API — plan Search, $5 crédits/mois gratuits)

## Ce que fait l'agent webuilder-agent.js
1. Lit `webuilder/{slug}/NOTES.md`
2. Télécharge et extrait le texte du catalogue (PDF/DOCX/XLSX via Drive links)
3. Recherche web en parallèle (si BRAVE_API_KEY présent) :
   - Avis clients / reviews Google pour le business
   - Scraping de 4 sites concurrents dans le même secteur
4. Appelle Claude claude-opus-4-6 (max_tokens: 12000) avec catalog + reviews + concurrents
5. Génère un config.json complet avec TOUS les champs requis :
   - SEO, hero, stats, benefits, why_us, form (labels inclus), thank-you, contact page (steps 1-5), blog (4 posts avec dates/tags), privacy, footer
6. Écrit `clients/{slug}/config.json` + `agent.config.json`

## Clients actifs
- `formations` — formations CPF (client principal)
- `pompes-chaleur` — Confort Énergie, installateur PAC à Lyon (client test Webuilder)
