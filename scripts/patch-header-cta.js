/**
 * AdsVizor — Patch all pages: remove green bar, add orange header CTA
 *
 * 1. Removes hardcoded <div class="cpf-cta-bar">…</div>
 * 2. Wraps <nav> in <div class="header-right"> with the orange CTA button
 *
 * Safe to run multiple times — skips already-patched files.
 *
 * Usage:
 *   node scripts/patch-header-cta.js
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ── Patterns ────────────────────────────────────────────────────────────────

// Matches the green cpf-cta-bar div block (any variant)
const CPF_BAR_BLOCK = /[ \t]*<div class="cpf-cta-bar">[\s\S]*?<\/div>\n?/;

// Matches the opening <nav …> tag inside the header (with any aria-label)
const NAV_OPEN = /(<nav\b[^>]*>)/;

// Marks already-patched files
const PATCH_MARKER = 'btn-header-cta';

// ── Orange CTA button ────────────────────────────────────────────────────────

function ctaButton(href) {
  return `<div class="header-right">\n        <a href="${href}" class="btn-header-cta" data-cta-id="header-cta" data-preserve-utm="true">✅ Vérifier mes droits CPF</a>\n        `;
}

// Close the header-right div just before </header>
const HEADER_CLOSE_OLD = /(<\/nav>\s*)\n(\s*<\/header>)/;
const HEADER_CLOSE_NEW = '</nav>\n      </div>\n    </header>';

// ── File helpers ─────────────────────────────────────────────────────────────

function getAllHtmlFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...getAllHtmlFiles(full));
    else if (entry.name.endsWith('.html')) results.push(full);
  }
  return results;
}

// ── Target files ─────────────────────────────────────────────────────────────

const targets = [
  // Shared templates (root) — no form on thank-you / privacy so skip those
  path.join(ROOT, 'blog.html'),
  path.join(ROOT, 'contact.html'),
  // formations listing template
  path.join(ROOT, 'clients/formations/pages/formations.html'),
  // All static formation pages
  ...getAllHtmlFiles(path.join(ROOT, 'clients/formations/pages')).filter(
    f => f !== path.join(ROOT, 'clients/formations/pages/formations.html')
  ),
];

// ── Main loop ────────────────────────────────────────────────────────────────

let patched = 0, skipped = 0;

for (const filePath of targets) {
  let html;
  try { html = readFileSync(filePath, 'utf-8'); } catch { continue; }

  const rel = path.relative(ROOT, filePath);

  if (html.includes(PATCH_MARKER)) {
    console.log(`⏭️  Already patched: ${rel}`);
    skipped++;
    continue;
  }

  let changed = false;

  // 1. Remove green bar
  if (CPF_BAR_BLOCK.test(html)) {
    html = html.replace(CPF_BAR_BLOCK, '');
    changed = true;
  }

  // 2. Add orange CTA — decide href
  //    Pages with a lead form: #contact  |  blog/contact templates: #contact
  const href = '#contact';

  if (NAV_OPEN.test(html)) {
    // Wrap opening <nav …> with header-right div + CTA
    html = html.replace(NAV_OPEN, ctaButton(href) + '$1');
    // Close header-right just before </header>
    html = html.replace(HEADER_CLOSE_OLD, HEADER_CLOSE_NEW);
    changed = true;
  }

  if (!changed) {
    console.log(`⚠️  No changes needed: ${rel}`);
    skipped++;
    continue;
  }

  writeFileSync(filePath, html, 'utf-8');
  console.log(`✅ ${rel}`);
  patched++;
}

console.log(`\n🎉 Done — ${patched} files patched, ${skipped} skipped.`);
