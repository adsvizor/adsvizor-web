/**
 * AdsVizor — Move gtag scripts from <head> to just before </body>
 *
 * Improves PageSpeed mobile score by eliminating render-blocking gtag
 * inline script. Analytics still fires reliably for users who stay on
 * the page long enough to interact (all form submitters).
 *
 * Safe to run multiple times — skips files where gtag is already in body.
 *
 * Usage:
 *   node scripts/patch-gtag-to-body.js
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

// Regex matches the gtag block regardless of \r\n vs \n line endings
const GTAG_BLOCK = /\s*<!-- Google tag \(gtag\.js\) -->\s*<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=GT-KD7C7TR3"><\/script>\s*<script>[\s\S]*?<\/script>/;

const GTAG_IN_BODY = `  <!-- Google tag (gtag.js) — loaded after render for better PageSpeed -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=GT-KD7C7TR3"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'GT-KD7C7TR3');
    gtag('config', 'AW-18122720723');
  </script>
</body>`;

function getAllHtmlFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...getAllHtmlFiles(full));
    else if (entry.name.endsWith('.html')) results.push(full);
  }
  return results;
}

const clientDir = path.join(ROOT, 'clients/formations');
const files     = getAllHtmlFiles(clientDir);

let patched = 0, skipped = 0;

for (const filePath of files) {
  let html = readFileSync(filePath, 'utf-8');

  // Skip if gtag is already in the body (already patched)
  if (html.includes('loaded after render for better PageSpeed')) {
    console.log(`⏭️  Skipped (already patched): ${path.relative(ROOT, filePath)}`);
    skipped++;
    continue;
  }

  if (!GTAG_BLOCK.test(html)) {
    console.log(`⚠️  Skipped (gtag block not found): ${path.relative(ROOT, filePath)}`);
    skipped++;
    continue;
  }

  // Remove gtag from <head>
  html = html.replace(GTAG_BLOCK, '');

  // Insert gtag just before </body>
  html = html.replace('</body>', GTAG_IN_BODY);

  writeFileSync(filePath, html, 'utf-8');
  console.log(`✅ ${path.relative(ROOT, filePath)}`);
  patched++;
}

console.log(`\n🎉 Done — ${patched} files patched, ${skipped} skipped.`);
