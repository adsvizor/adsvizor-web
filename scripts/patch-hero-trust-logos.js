/**
 * AdsVizor — Replace hero CTA button with trust logos on all formation pages
 *
 * Removes <button class="hero-cta"> and inserts the MCF + Qualiopi
 * trust block in its place, matching the home page design.
 *
 * Safe to run multiple times — skips already-patched files.
 *
 * Usage:
 *   node scripts/patch-hero-trust-logos.js
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ── Trust block to insert ────────────────────────────────────────────────────

const TRUST_BLOCK = `<div class="hero-trust-block">
                <p class="hero-trust-label">🏆 Certifié &amp; agréé — Votre financement CPF est entre de bonnes mains</p>
                <div class="hero-trust-logos">
                  <img src="/logo_moncompteformation_rvb-1024x603.png" alt="Mon Compte Formation — EDOF" class="hero-trust-logo hero-trust-logo--mcf" width="1024" height="603" loading="lazy" />
                  <img src="/logo-qualiopi.png" alt="Qualiopi — processus certifié — Actions de formation" class="hero-trust-logo hero-trust-logo--qualiopi" width="480" height="240" loading="lazy" />
                </div>
              </div>`;

// Matches <button class="hero-cta" ...>any content</button>
const HERO_CTA_RE = /[ \t]*<button[^>]+class="hero-cta"[\s\S]*?<\/button>/;

const PATCH_MARKER = 'hero-trust-block';

// ── Helpers ──────────────────────────────────────────────────────────────────

function listHtmlFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listHtmlFiles(full));
    else if (entry.name.endsWith('.html')) results.push(full);
  }
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const pagesDir = path.join(ROOT, 'clients/formations/pages');
const files = listHtmlFiles(pagesDir);

let patched = 0, skipped = 0;

for (const filePath of files) {
  const rel = path.relative(ROOT, filePath);
  let html = readFileSync(filePath, 'utf-8');

  if (html.includes(PATCH_MARKER)) {
    console.log(`⏭️  Already patched: ${rel}`);
    skipped++;
    continue;
  }

  if (!HERO_CTA_RE.test(html)) {
    console.log(`⚠️  No hero-cta button found: ${rel}`);
    skipped++;
    continue;
  }

  html = html.replace(HERO_CTA_RE, TRUST_BLOCK);
  writeFileSync(filePath, html, 'utf-8');
  console.log(`✅ ${rel}`);
  patched++;
}

console.log(`\n🎉 Done — ${patched} files patched, ${skipped} skipped.`);
