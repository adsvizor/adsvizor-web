/**
 * AdsVizor — Image Self-Hosting Script
 *
 * Downloads all Unsplash images used in clients/formations/config.json,
 * converts them to optimized WebP, and saves to clients/formations/images/.
 * Then updates config.json with local paths and patches all static formation pages.
 *
 * Usage:
 *   node scripts/download-images.js
 *
 * Requires: npm install sharp (run once)
 *   npm install sharp
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, renameSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { createWriteStream } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CLIENT_SLUG = 'formations';
const CONFIG_PATH = path.join(ROOT, 'clients', CLIENT_SLUG, 'config.json');
const IMAGES_DIR = path.join(ROOT, 'clients', CLIENT_SLUG, 'images');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractPhotoId(url) {
  const match = url.match(/photo-([a-f0-9-]+)/);
  return match ? match[1] : null;
}

function urlToFilename(url) {
  const id = extractPhotoId(url);
  const w = url.match(/w=(\d+)/)?.[1];
  const h = url.match(/h=(\d+)/)?.[1];
  const size = w && h ? `${w}x${h}` : 'orig';
  return `photo-${id}-${size}.webp`;
}

function urlToLocalPath(url) {
  return `/clients/${CLIENT_SLUG}/images/${urlToFilename(url)}`;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => {
      file.close();
      reject(err);
    });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Dynamically import sharp (must be installed)
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('❌ sharp not found. Run: npm install sharp');
    process.exit(1);
  }

  mkdirSync(IMAGES_DIR, { recursive: true });

  const configRaw = readFileSync(CONFIG_PATH, 'utf-8');

  // Find all unique Unsplash URLs
  const allUrls = [...configRaw.matchAll(/https:\/\/images\.unsplash\.com\/[^\s"]+/g)]
    .map(m => m[0]);
  const uniqueUrls = [...new Set(allUrls)];

  console.log(`\n📸 Found ${uniqueUrls.length} unique Unsplash URLs\n`);

  const urlMap = {}; // old URL → new local path

  for (const url of uniqueUrls) {
    const filename = urlToFilename(url);
    const outputPath = path.join(IMAGES_DIR, filename);
    const localPath = urlToLocalPath(url);

    if (existsSync(outputPath)) {
      const kb = Math.round(readFileSync(outputPath).length / 1024);
      console.log(`  SKIP (exists, ${kb}KB): ${filename}`);
      urlMap[url] = localPath;
      continue;
    }

    // Download to a temp .jpg first
    const tempPath = outputPath + '.tmp';
    try {
      // Build optimized Unsplash URL (WebP, appropriate quality)
      const fetchUrl = url
        .replace('auto=format', 'fm=webp&auto=compress')
        .replace('w=1400&h=700&q=85', 'w=900&h=500&q=82');

      process.stdout.write(`  Downloading ${filename}... `);
      await downloadFile(fetchUrl, tempPath);

      // Convert and optimize with sharp
      const w = parseInt(url.match(/w=(\d+)/)?.[1] || '800');
      const tmpOut = outputPath + '.converting';
      await sharp(tempPath)
        .resize({ width: Math.min(w, 900), withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(tmpOut);

      // On Windows sharp keeps a lock on tempPath briefly — rename instead of unlink
      try { unlinkSync(tempPath); } catch { /* ignore lock, file will be cleaned up */ }
      renameSync(tmpOut, outputPath);

      const kb = Math.round(readFileSync(outputPath).length / 1024);
      console.log(`✅ ${kb}KB`);
      urlMap[url] = localPath;
    } catch (err) {
      console.log(`❌ ${err.message}`);
      try { unlinkSync(tempPath); } catch {}
      try { unlinkSync(outputPath + '.converting'); } catch {}
    }
  }

  // ── Update config.json ──────────────────────────────────────────────────────
  let newConfig = configRaw;
  let configChanges = 0;
  for (const [oldUrl, newPath] of Object.entries(urlMap)) {
    if (newConfig.includes(oldUrl)) {
      newConfig = newConfig.split(oldUrl).join(newPath);
      configChanges++;
    }
  }
  writeFileSync(CONFIG_PATH, newConfig, 'utf-8');
  console.log(`\n✅ config.json: ${configChanges} URLs replaced with local paths`);

  // ── Patch all static formation pages ───────────────────────────────────────
  const { globSync } = await import('glob').catch(() => {
    // fallback if glob not available
    return { globSync: (p) => [] };
  });

  const pages = globSync(
    path.join(ROOT, 'clients', CLIENT_SLUG, 'pages', '**', '*.html')
  );

  let pagesPatched = 0;
  for (const pagePath of pages) {
    let html = readFileSync(pagePath, 'utf-8');
    const original = html;
    for (const [oldUrl, newPath] of Object.entries(urlMap)) {
      html = html.split(oldUrl).join(newPath);
    }
    // Also update preload href if present
    if (html !== original) {
      writeFileSync(pagePath, html, 'utf-8');
      pagesPatched++;
    }
  }
  console.log(`✅ ${pagesPatched} static pages patched with local image paths`);

  console.log(`\n🎉 Done! Next steps:`);
  console.log(`  1. Re-run the page generator to apply all changes:`);
  console.log(`     node scripts/generate-formation-pages.js`);
  console.log(`  2. Commit and push:`);
  console.log(`     git add clients/formations/images/ clients/formations/config.json clients/formations/pages/`);
  console.log(`     git commit -m "perf: self-host Unsplash images as WebP for LCP improvement"`);
  console.log(`     git push`);
  console.log(`\n  Expected LCP improvement: 16s → <1.5s on hero images`);
}

main().catch(console.error);
