/**
 * AdsVizor — Self-host Inter font
 *
 * Downloads Inter woff2 files from Bunny Fonts and generates a local CSS.
 * Eliminates the 760ms render-blocking external font request.
 *
 * Usage (run once):
 *   node scripts/download-fonts.js
 */

import { writeFileSync, mkdirSync } from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FONTS_DIR = path.join(ROOT, 'fonts');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = import('fs').then(fs => fs.createWriteStream(dest));
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        download(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      file.then(f => {
        res.pipe(f);
        f.on('finish', () => f.close(resolve));
      });
    }).on('error', reject);
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        get(res.headers.location).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  mkdirSync(FONTS_DIR, { recursive: true });

  // Get the CSS from Bunny Fonts (woff2 URLs inside)
  const cssUrl = 'https://fonts.bunny.net/css?family=inter:400,500,600,700&display=swap';
  console.log('Fetching font CSS...');
  const css = await get(cssUrl);

  // Extract all woff2 URLs
  const woff2Urls = [...css.matchAll(/url\((https:\/\/[^\)]+\.woff2)\)/g)].map(m => m[1]);
  console.log(`Found ${woff2Urls.length} woff2 files`);

  // Download each and rewrite CSS with local paths
  let localCss = css;
  for (const url of woff2Urls) {
    const filename = url.split('/').pop();
    const dest = path.join(FONTS_DIR, filename);
    process.stdout.write(`  Downloading ${filename}... `);
    await download(url, dest);
    const kb = Math.round((await import('fs')).then(fs => fs.readFileSync(dest).length) / 1024);
    console.log(`done`);
    localCss = localCss.replace(url, `/fonts/${filename}`);
  }

  // Write local CSS
  writeFileSync(path.join(FONTS_DIR, 'inter.css'), localCss, 'utf-8');
  console.log('\n✅ fonts/inter.css written with local paths');

  // Instructions
  console.log('\nNext: update HTML templates to use local font:');
  console.log('  Replace: <link rel="stylesheet" href="https://fonts.bunny.net/...">');
  console.log('  With:    <link rel="stylesheet" href="/fonts/inter.css">');
  console.log('\nThen: node scripts/generate-formation-pages.js && git add fonts/ && git push');
}

main().catch(console.error);
