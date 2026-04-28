/**
 * AdsVizor — Static Formation Page Generator
 *
 * Reads clients/{CLIENT_SLUG}/config.json and generates one static HTML file
 * per formation in cpf_formations → clients/{CLIENT_SLUG}/pages/formation-{slug}.html
 *
 * Why static? JS-rendered pages hurt Google Ads Quality Score and organic SEO.
 * Static pages have the keyword in the title/H1/meta before JS executes.
 *
 * Usage:
 *   CLIENT_SLUG=formations node scripts/generate-formation-pages.js
 *   node scripts/generate-formation-pages.js          # defaults to formations
 *
 * Output:
 *   clients/formations/pages/formation-bureautique-office.html
 *   clients/formations/pages/formation-anglais-toeic.html
 *   ... (one per formation in cpf_formations)
 *
 * URLs served at:
 *   https://formations.adsvizor.com/formation-bureautique-office.html
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CLIENT_SLUG = (process.env.CLIENT_SLUG || 'formations').trim();

// ── Load config ──────────────────────────────────────────────────────────────

let config;
try {
  config = JSON.parse(readFileSync(path.join(ROOT, `clients/${CLIENT_SLUG}/config.json`), 'utf-8'));
} catch (err) {
  console.error(`❌ Cannot load clients/${CLIENT_SLUG}/config.json: ${err.message}`);
  process.exit(1);
}

const formations = config.cpf_formations;
if (!Array.isArray(formations) || formations.length === 0) {
  console.error('❌ No cpf_formations found in config.json');
  process.exit(1);
}

const baseUrl   = config.og_url?.replace(/\/$/, '') || `https://${CLIENT_SLUG}.adsvizor.com`;
const logoText  = config.logo_text || 'AdsVizor';
const footerTxt = config.footer_text || '';
const formAction = config.form_action || '';
const offerId   = config.offer_id || '';

// ── Nav links ─────────────────────────────────────────────────────────────────

function buildNav(config) {
  const items = [];
  for (let i = 0; i <= 4; i++) {
    const href  = config[`nav_item_${i}_href`];
    const label = config[`nav_item_${i}_label`];
    if (href && label) items.push(`<li><a href="${href}">${label}</a></li>`);
  }
  return items.join('\n          ');
}

// ── HTML assembly ─────────────────────────────────────────────────────────────

function assembleHTML(f, config) {
  const canonicalUrl = `${baseUrl}/formation-${f.slug}.html`;
  const metaTitle    = `${f.title} — Formation CPF | ${logoText}`;
  const metaDesc     = `${f.title} : formation certifiante éligible CPF. ${f.excerpt}`.slice(0, 155);

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" type="image/png" href="/favicon.png" sizes="any" />
    <link rel="icon" type="image/png" href="/favicon.png" sizes="48x48" />
    <link rel="apple-touch-icon" href="/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />

    <title>${metaTitle}</title>
    <meta name="description" content="${metaDesc}" />
    <link rel="canonical" href="${canonicalUrl}" />

    <meta property="og:title" content="${metaTitle}" />
    <meta property="og:description" content="${metaDesc}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="${f.image_url}" />

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

    <link rel="stylesheet" href="main.css" />
    <script defer src="script.js?v=12"></script>
  <style>
    .site-logo { height: 60px; width: auto; }
    @media (min-width: 768px) { .site-logo { height: 72px; } }
    @media (max-width: 767px) {
      .nav-toggle { display: flex !important; }
      header nav:not(.is-open) { display: none !important; }
    }
    @media (min-width: 768px) {
      .nav-toggle { display: none !important; }
      header nav { display: block !important; }
    }
  </style>
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=GT-KD7C7TR3"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'GT-KD7C7TR3');
    gtag('config', 'AW-18122720723');
  </script>
  </head>

  <body>
    <header>
      <div>
        <a href="/" class="site-logo-link"><img src="/logo.png" alt="${logoText}" class="site-logo" /></a>
      </div>
      <nav aria-label="Navigation principale">
        <ul>
          ${buildNav(config)}
        </ul>
      </nav>
    </header>
    <button class="nav-toggle" aria-expanded="false" aria-label="Ouvrir le menu">
      <span></span><span></span><span></span>
    </button>

    <main>
      <div class="page-layout">

        <!-- LEFT: content -->
        <div class="page-content">

          <section class="hero" aria-labelledby="formation-title">
            <img class="hero-img" src="${f.image_url}" alt="${f.image_alt}" fetchpriority="high" />
            <div class="hero-body">
              <p class="hero-badge">${f.tag} — Éligible CPF</p>
              <h1 id="formation-title">${f.headline}</h1>
              <p class="hero-sub">${f.subheadline}</p>
              <a href="#contact" class="hero-cta" data-cta-id="cta-formation-${f.slug}">Demander le programme</a>
            </div>
          </section>

          <section class="formation-detail-section" aria-labelledby="detail-title">

            <p class="formation-breadcrumb"><a href="/formations.html">← Toutes les formations</a></p>

            <h2 id="detail-title" class="formation-detail-title">À propos de cette formation</h2>
            <p class="formation-desc">${f.description_1}</p>
            <p class="formation-desc">${f.description_2}</p>

            <h3 class="formation-section-heading">Pour qui ?</h3>
            <p class="formation-desc">${f.for_who}</p>

            <h3 class="formation-section-heading">Ce que vous apprendrez</h3>
            <ul class="formation-points">
              <li>${f.point_1}</li>
              <li>${f.point_2}</li>
              <li>${f.point_3}</li>
            </ul>

            <div class="formation-info-grid">
              <div class="formation-info-card">
                <span class="formation-info-label">Durée</span>
                <span class="formation-info-value">${f.duration}</span>
              </div>
              <div class="formation-info-card">
                <span class="formation-info-label">Certification</span>
                <span class="formation-info-value">${f.certification}</span>
              </div>
              <div class="formation-info-card">
                <span class="formation-info-label">Financement</span>
                <span class="formation-info-value">100 % éligible CPF — sans avance de frais</span>
              </div>
            </div>

            <div class="formation-mobile-cta">
              <a href="#contact" class="btn">Demander le programme →</a>
            </div>

          </section>
        </div>

        <!-- RIGHT: floating form -->
        <aside class="form-float">
          <section aria-labelledby="lead-form-title" id="contact">
            <h2 id="lead-form-title">${f.form_cta}</h2>

            <div class="form-progress" aria-hidden="true">
              <div class="form-progress-fill"></div>
            </div>
            <div class="form-step-labels" aria-hidden="true">
              <span class="form-step-label is-active">Vos coordonnées</span>
              <span class="form-step-label">Votre profil</span>
            </div>

            <form
              id="lead-form"
              action="${formAction}"
              method="post"
              autocomplete="on"
              data-client-slug="${CLIENT_SLUG}"
              data-offer-id="${f.offer_id || offerId}"
            >
              <!-- Step 1 -->
              <div class="form-step" data-step="0">
                <div class="form-name-row">
                  <div>
                    <label for="first_name">${config.field_first_name_label}</label>
                    <input id="first_name" name="first_name" type="text" autocomplete="given-name" placeholder="${config.field_first_name_placeholder}" required />
                  </div>
                  <div>
                    <label for="last_name">${config.field_last_name_label}</label>
                    <input id="last_name" name="last_name" type="text" autocomplete="family-name" placeholder="${config.field_last_name_placeholder}" required />
                  </div>
                </div>
                <div>
                  <label for="phone">${config.field_phone_label}</label>
                  <input id="phone" name="phone" type="tel" autocomplete="tel" placeholder="${config.field_phone_placeholder}" required />
                </div>
                <div>
                  <label for="email">${config.field_email_label}</label>
                  <input id="email" name="email" type="email" autocomplete="email" placeholder="${config.field_email_placeholder}" required />
                </div>

                <div class="form-consent">
                  <input type="checkbox" id="consent_marketing" name="consent_marketing" />
                  <label for="consent_marketing">${config.form_disclaimer_text}</label>
                </div>

                <button type="button" class="btn-next">Continuer <span aria-hidden="true">→</span></button>
              </div>

              <!-- Step 2 -->
              <div class="form-step" data-step="1" hidden style="display:none">
                <div>
                  <label>${config.field_status_label}</label>
                  <div class="status-cards" role="group" aria-label="Statut professionnel">
                    <label class="status-card">
                      <input type="radio" name="professional_status" value="chomage" />
                      <span class="status-card-icon" aria-hidden="true">🔍</span>
                      <span class="status-card-label">En recherche d'emploi</span>
                    </label>
                    <label class="status-card">
                      <input type="radio" name="professional_status" value="salarie" />
                      <span class="status-card-icon" aria-hidden="true">💼</span>
                      <span class="status-card-label">Salarié(e)</span>
                    </label>
                    <label class="status-card">
                      <input type="radio" name="professional_status" value="etudiant" />
                      <span class="status-card-icon" aria-hidden="true">🎓</span>
                      <span class="status-card-label">Étudiant(e)</span>
                    </label>
                    <label class="status-card">
                      <input type="radio" name="professional_status" value="retraite" />
                      <span class="status-card-icon" aria-hidden="true">🌅</span>
                      <span class="status-card-label">Retraité(e)</span>
                    </label>
                  </div>
                </div>

                <!-- Formation pre-filled (static page — formation always known) -->
                <input type="hidden" name="formation_interest" value="${f.title}" />

                <div class="form-honeypot" aria-hidden="true">
                  <input type="text" name="hp_trap" id="hp_trap" autocomplete="nope" tabindex="-1" />
                </div>

                <input type="hidden" id="utm_source"   name="utm_source"   value="" />
                <input type="hidden" id="utm_medium"   name="utm_medium"   value="" />
                <input type="hidden" id="utm_campaign" name="utm_campaign" value="" />
                <input type="hidden" id="utm_term"     name="utm_term"     value="" />
                <input type="hidden" id="utm_content"  name="utm_content"  value="" />
                <input type="hidden" id="page_version" name="page_version" value="${config.page_version || '1.0.0'}" />

                <div class="form-step-nav">
                  <button type="button" class="btn-back"><span aria-hidden="true">←</span> Retour</button>
                  <button type="submit">${config.submit_label}</button>
                </div>
              </div>
            </form>
          </section>
        </aside>

      </div>
    </main>

    <footer>
      <p>${footerTxt}</p>
    </footer>
  </body>
</html>
`;
}

// ── Sitemap generator ─────────────────────────────────────────────────────────

function buildSitemap(formations, config, baseUrl) {
  const now = new Date().toISOString().split('T')[0];

  const staticPages = [
    { url: `${baseUrl}/`,             priority: '1.0', freq: 'weekly' },
    { url: `${baseUrl}/formations.html`, priority: '0.9', freq: 'weekly' },
    { url: `${baseUrl}/contact.html`, priority: '0.8', freq: 'monthly' },
    { url: `${baseUrl}/blog.html`,    priority: '0.7', freq: 'weekly' },
  ];

  const formationPages = formations.map(f => ({
    url: `${baseUrl}/formation-${f.slug}.html`,
    priority: '0.9',
    freq: 'monthly'
  }));

  // Blog posts from config
  const blogPages = [];
  for (let i = 1; i <= 10; i++) {
    const href = config[`post_${i}_href`];
    if (href) blogPages.push({
      url: `${baseUrl}/${href}`,
      priority: '0.6',
      freq: 'never'
    });
  }

  const allPages = [...staticPages, ...formationPages, ...blogPages];

  const urls = allPages.map(p => `
  <url>
    <loc>${p.url}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const outDir = path.join(ROOT, `clients/${CLIENT_SLUG}/pages`);
mkdirSync(outDir, { recursive: true });

console.log(`📦 Client: ${CLIENT_SLUG}`);
console.log(`🏗️  Generating ${formations.length} formation pages...\n`);

for (const f of formations) {
  const filename = `formation-${f.slug}.html`;
  const filePath = path.join(outDir, filename);
  const html = assembleHTML(f, config);
  writeFileSync(filePath, html, 'utf-8');
  console.log(`✅ clients/${CLIENT_SLUG}/pages/${filename}`);
  console.log(`   → ${baseUrl}/formation-${f.slug}.html`);
}

// Generate sitemap.xml at repo root
const sitemapPath = path.join(ROOT, 'sitemap.xml');
const sitemap = buildSitemap(formations, config, baseUrl);
writeFileSync(sitemapPath, sitemap, 'utf-8');
console.log(`\n🗺️  sitemap.xml generated (${formations.length + 4} URLs + blog posts)`);
console.log(`   → ${baseUrl}/sitemap.xml`);

console.log(`\n🎉 Done — ${formations.length} pages generated.`);
console.log(`\nNext steps:`);
console.log(`  git add clients/${CLIENT_SLUG}/pages/formation-*.html`);
console.log(`  git commit -m "feat(${CLIENT_SLUG}): generate static formation pages"`);
console.log(`  git push`);
