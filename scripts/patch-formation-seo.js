/**
 * AdsVizor — Formation Page SEO Patcher
 *
 * Adds Twitter Cards, og:locale, robots meta, Course JSON-LD and
 * BreadcrumbList JSON-LD to existing formation pages WITHOUT touching
 * the body content.
 *
 * Safe to run multiple times — skips files that already have twitter:card.
 *
 * Usage:
 *   node scripts/patch-formation-seo.js
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');
const CLIENT    = 'formations';
const BASE_URL  = 'https://formations.adsvizor.com';

// ── Load config ───────────────────────────────────────────────────────────────
const config    = JSON.parse(readFileSync(path.join(ROOT, `clients/${CLIENT}/config.json`), 'utf-8'));
const formations = config.cpf_formations || [];

const CATEGORY_LABELS = {
  'bureautique':    'Bureautique & Informatique',
  'langues':        'Langues étrangères',
  'management':     'Management',
  'marketing':      'Marketing Digital',
  'finance':        'Finance & Comptabilité',
  'dev-personnel':  'Développement personnel',
  'entrepreneuriat':'Entrepreneuriat',
  'ia':             'Intelligence Artificielle',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getAllHtmlFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...getAllHtmlFiles(full));
    else if (entry.name.endsWith('.html')) results.push(full);
  }
  return results;
}

function extractAttr(html, selector) {
  const m = html.match(new RegExp(selector));
  return m ? m[1] : '';
}

function makeAbsolute(url) {
  if (!url) return '';
  return url.startsWith('http') ? url : `${BASE_URL}${url}`;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Main ──────────────────────────────────────────────────────────────────────
const pagesDir = path.join(ROOT, `clients/${CLIENT}/pages`);
const files    = getAllHtmlFiles(pagesDir);

let patched = 0, skipped = 0;

for (const filePath of files) {
  let html = readFileSync(filePath, 'utf-8');

  // Skip if already patched
  if (html.includes('twitter:card')) {
    console.log(`⏭️  Skipped (already patched): ${path.relative(ROOT, filePath)}`);
    skipped++;
    continue;
  }

  // ── Extract existing head values ───────────────────────────────────────────
  const canonicalUrl  = extractAttr(html, /<link rel="canonical" href="([^"]+)"/i);
  const ogTitle       = extractAttr(html, /<meta property="og:title" content="([^"]*)"/i);
  const ogDescription = extractAttr(html, /<meta property="og:description" content="([^"]*)"/i);
  const ogImage       = extractAttr(html, /<meta property="og:image" content="([^"]*)"/i);
  const ogImageAbs    = makeAbsolute(ogImage);

  // ── Match formation in config ──────────────────────────────────────────────
  const relHref   = canonicalUrl.replace(BASE_URL, '');
  const formation = formations.find(f => f.href === relHref);

  // ── Derive category from URL ───────────────────────────────────────────────
  const parts        = relHref.replace(/^\//, '').split('/');
  const category     = parts.length >= 2 ? parts[0] : null;
  const categoryLabel = (category && CATEGORY_LABELS[category]) || 'Formations CPF';

  // ── Build Course schema ────────────────────────────────────────────────────
  let courseTag = '';
  if (formation) {
    const course = {
      '@context': 'https://schema.org',
      '@type': 'Course',
      'name': formation.title,
      'description': formation.excerpt,
      'url': canonicalUrl,
      'image': ogImageAbs,
      'provider': { '@type': 'Organization', 'name': 'AdsVizor', 'url': BASE_URL },
      'educationalCredentialAwarded': formation.certification,
      'hasCourseInstance': [{
        '@type': 'CourseInstance',
        'courseMode': 'online',
        'courseWorkload': formation.duration,
        'offers': {
          '@type': 'Offer',
          'price': '0',
          'priceCurrency': 'EUR',
          'description': 'Financement 100 % CPF — sans avance de frais',
          'availability': 'https://schema.org/InStock',
        },
      }],
    };
    courseTag = `    <script type="application/ld+json">${JSON.stringify(course)}</script>`;
  }

  // ── Build BreadcrumbList schema ────────────────────────────────────────────
  let breadcrumbTag = '';
  if (canonicalUrl) {
    const items = [
      { '@type': 'ListItem', 'position': 1, 'name': 'Accueil', 'item': `${BASE_URL}/` },
    ];
    if (category) {
      items.push({ '@type': 'ListItem', 'position': 2, 'name': categoryLabel, 'item': `${BASE_URL}/${category}/` });
    }
    items.push({ '@type': 'ListItem', 'position': items.length + 1, 'name': formation?.title || ogTitle, 'item': canonicalUrl });

    const breadcrumb = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': items };
    breadcrumbTag = `    <script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>`;
  }

  // ── Build injection block ──────────────────────────────────────────────────
  const injection = [
    `    <meta property="og:locale" content="fr_FR" />`,
    `    <meta name="twitter:card" content="summary_large_image" />`,
    `    <meta name="twitter:title" content="${escapeAttr(ogTitle)}" />`,
    `    <meta name="twitter:description" content="${escapeAttr(ogDescription)}" />`,
    `    <meta name="twitter:image" content="${ogImageAbs}" />`,
    `    <meta name="robots" content="index, follow" />`,
    courseTag,
    breadcrumbTag,
  ].filter(Boolean).join('\n');

  // ── Insert after og:image line ─────────────────────────────────────────────
  const ogImagePattern = /(<meta property="og:image" content="[^"]*"\s*\/>)/;
  if (!ogImagePattern.test(html)) {
    console.log(`⚠️  Skipped (no og:image found): ${path.relative(ROOT, filePath)}`);
    skipped++;
    continue;
  }

  html = html.replace(ogImagePattern, `$1\n${injection}`);
  writeFileSync(filePath, html, 'utf-8');
  console.log(`✅ ${path.relative(ROOT, filePath)}`);
  patched++;
}

console.log(`\n🎉 Done — ${patched} files patched, ${skipped} skipped.`);
