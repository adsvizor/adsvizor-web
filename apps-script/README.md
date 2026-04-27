# Google Apps Script — Lead Capture Backend

Source of truth for the Apps Script web app that receives leads from the Cloudflare Worker and writes them to Google Sheets.

## Files

- [`Code.gs`](Code.gs) — Full Apps Script source code

## How to deploy

Google Apps Script doesn't support automatic deployment from GitHub (unless you use [`clasp`](https://github.com/google/clasp), which adds OAuth complexity). For now we use manual copy-paste:

1. Edit `Code.gs` in this repo, commit, push
2. Open [script.google.com](https://script.google.com) → your AdsVizor project
3. Open `Code.gs` in the editor
4. **Cmd+A** (select all) → **Cmd+V** (paste new code) → **Save** (Cmd+S)
5. **Deploy → Manage deployments → New version** → enter description → Deploy
6. The `/exec` URL stays the same — no need to update the Cloudflare Worker

## Schema management

The script auto-creates missing columns in the Google Sheet on every request, so you never need to touch the sheet manually after a schema change.

When you add new fields to `SHEET_COLUMNS`:
- New columns are appended at the end
- Existing columns are never renamed or reordered
- Existing rows keep their data

## Current schema (24 columns A → X)

| # | Col | Field | Source |
|---|-----|-------|--------|
| 0 | A | Date soumission | Server (insert time) |
| 1 | B | Mis à jour | Server (last update time) |
| 2 | C | Nom | Frontend |
| 3 | D | Email | Frontend (UPSERT KEY) |
| 4 | E | Téléphone | Frontend |
| 5 | F | Formation demandée | Frontend |
| 6 | G | Consentement | Frontend (boolean) |
| 7 | H | Code sécurité | Frontend |
| 8 | I | Statut professionnel | Frontend |
| 9 | J | Statut lead | Server ("Partiel" / "Complet") |
| 10 | K | Notes | **Manual — never touched by script** |
| 11 | L | Client | Frontend |
| 12 | M | Offre | Frontend |
| 13 | N | Version | Frontend |
| 14-18 | O-S | UTM Source/Medium/Campagne/Terme/Contenu | Frontend |
| 19 | T | Consent URL | Frontend (RGPD proof) |
| 20 | U | Consent Texte | Frontend (RGPD proof) |
| 21 | V | Consent Timestamp | Frontend (RGPD proof) |
| 22 | W | Consent IP | Worker (`CF-Connecting-IP`) |
| 23 | X | Consent User-Agent | Worker (`User-Agent` header) |

## Upsert by email

The script merges step-1 partial submissions and step-2 complete submissions into a single row, keyed by lowercased email:

- New email → INSERT new row, status "Partiel"
- Existing email + step-2 complete → UPDATE row, status "Complet"
- A "Complet" lead is never downgraded back to "Partiel"

## Concurrency

Script-level lock (`LockService.getScriptLock()`) serializes all writes. If 2 leads arrive simultaneously, the second waits up to 8 seconds. If the lock isn't acquired, the script returns 503 — the Cloudflare Worker should retry (TODO).
