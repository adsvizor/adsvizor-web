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

// ── Formation category → form3 radio value ────────────────────────────────────

/**
 * Maps a formation to the matching radio value in form3 step 1.
 * Uses f.href (e.g. "/langues/formation-anglais-toeic.html") to derive the category.
 */
function getFormationCategory(f) {
  const category = (f.href || '').replace(/^\//, '').split('/')[0];
  const slug     = (f.slug || '').toLowerCase();

  if (category === 'langues')                                          return 'Langues étrangères';
  if (category === 'finance')                                          return 'Comptabilité &amp; Gestion';
  if (category === 'dev-personnel' && slug.includes('bilan'))          return 'Bilan de compétences';
  if (category === 'management' || category === 'marketing')           return 'Management &amp; Commerce';
  if (category === 'bureautique' || category === 'ia')                 return 'Informatique &amp; Digital';
  return 'Autre formation professionnelle';
}

// ── Subpages nav (language series) ───────────────────────────────────────────

// Flag images via flagcdn.com — flag emojis (🇬🇧 etc.) don't render on Windows desktop
const FLAG_IMG = (code, alt) =>
  `<img src="https://flagcdn.com/20x15/${code}.png" alt="${alt}" width="20" height="15" style="vertical-align:middle;border-radius:2px;">`;

const LANG_EMOJI = {
  'anglais-toeic': FLAG_IMG('gb', 'Drapeau Royaume-Uni'),
  'allemand':      FLAG_IMG('de', 'Drapeau Allemagne'),
  'espagnol':      FLAG_IMG('es', 'Drapeau Espagne'),
  'italien':       FLAG_IMG('it', 'Drapeau Italie'),
  'lsf':           '🤟',
};

// Hard-coded list of bureautique sub-tool pages (not in config.json)
const BUREAUTIQUE_SUBPAGES = [
  { href: '/bureautique/formation-excel.html',                label: '📊 Excel' },
  { href: '/bureautique/formation-word.html',                 label: '📝 Word' },
  { href: '/bureautique/formation-powerpoint.html',           label: '📊 PowerPoint' },
  { href: '/bureautique/formation-outils-collaboratifs.html', label: '🤝 Outils Collaboratifs' },
  { href: '/bureautique/formation-wordpress.html',            label: '🌐 WordPress' },
  { href: '/bureautique/formation-pao.html',                  label: '🎨 PAO' },
  { href: '/bureautique/formation-bases-informatique.html',   label: '💻 Bases Informatiques' },
];

/**
 * For formations in the /langues/ or /bureautique/ category, returns a
 * subpages-nav block linking to sibling pages. Returns '' for other categories.
 */
function buildSubpagesNav(f, allFormations) {
  const category = (f.href || '').replace(/^\//, '').split('/')[0];

  // Bureautique overview → link to all sub-tool pages
  if (category === 'bureautique') {
    const links = BUREAUTIQUE_SUBPAGES.map(s =>
      `<a href="${s.href}">${s.label}</a>`
    ).join('\n                ');

    return `
            <!-- Sous-formations navigation -->
            <div class="formation-section">
              <p style="font-size:0.88rem;color:#64748b;margin-bottom:8px;">Formations spécialisées dans cette série :</p>
              <div class="subpages-nav">
                ${links}
              </div>
            </div>`;
  }

  if (category !== 'langues') return '';

  const siblings = allFormations.filter(s =>
    (s.href || '').replace(/^\//, '').split('/')[0] === 'langues'
  );

  const links = siblings.map(s => {
    const emoji  = LANG_EMOJI[s.slug] || '🌍';
    const active = s.slug === f.slug ? ' class="active"' : '';
    return `<a href="${s.href}"${active}>${emoji} ${(s.nav_label || s.title.replace(' professionnel', '').replace(' (LSF)', ''))}</a>`;
  }).join('\n                ');

  return `
            <!-- Sous-formations navigation -->
            <div class="formation-section">
              <p style="font-size:0.88rem;color:#64748b;margin-bottom:8px;">Formations spécialisées dans cette série :</p>
              <div class="subpages-nav">
                ${links}
              </div>
            </div>`;
}

// ── HTML assembly ─────────────────────────────────────────────────────────────

function assembleHTML(f, config, allFormations) {
  const canonicalUrl = `${baseUrl}${f.href}`;
  const metaTitle    = `${f.title} — Formation CPF | ${logoText}`;
  const metaDesc     = `${f.title} : formation certifiante éligible CPF. ${f.excerpt}`.slice(0, 155);

  // data-static="true" → script.js will not override <title> and <meta description>
  return `<!doctype html>
<html lang="fr" data-static="true">
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

    <link rel="preconnect" href="https://images.unsplash.com" />

    <link rel="preload" as="image" href="${f.image_url}" fetchpriority="high" />
    <style>body{visibility:hidden}</style>
    <link rel="preload" href="/main.css?v=9" as="style" onload="this.onload=null;this.rel='stylesheet'" />
    <noscript><link rel="stylesheet" href="/main.css?v=9" /></noscript>
    <script defer src="/script.js?v=21"></script>
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
    gtag('config', 'GT-KD7C7TR3', { send_page_view: false });
    gtag('config', 'AW-18122720723', { send_page_view: false });
  </script>
  </head>

  <body>
    <div class="cpf-cta-bar">
      <button class="cpf-cta-bar-btn" type="button" data-cta-id="cpf-bar-${f.slug}"
        onclick="document.getElementById('contact').scrollIntoView({behavior:'smooth',block:'start'});setTimeout(function(){var i=document.querySelector('#contact input:not([type=hidden])');if(i)i.focus({preventScroll:true});},600)">
        Vérifier mes droits CPF →
      </button>
    </div>
    <header>
      <div>
        <a href="/" class="site-logo-link"><picture><source srcset="/logo.webp" type="image/webp" /><img src="/logo.png" alt="${logoText}" class="site-logo" width="200" height="200" /></picture></a>
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
              <div class="hero-trust-block">
                <p class="hero-trust-label">🏆 Certifié &amp; agréé — Votre financement CPF est entre de bonnes mains</p>
                <div class="hero-trust-logos">
                  <img src="/logo_moncompteformation_rvb-1024x603.png" alt="Mon Compte Formation — EDOF" class="hero-trust-logo hero-trust-logo--mcf" width="1024" height="603" loading="lazy" />
                  <img src="/logo-qualiopi.png" alt="Qualiopi — processus certifié — Actions de formation" class="hero-trust-logo hero-trust-logo--qualiopi" width="480" height="240" loading="lazy" />
                </div>
              </div>
            </div>
          </section>

          <section class="formation-detail-section" aria-labelledby="detail-title">

            <p class="formation-breadcrumb"><a href="/formations.html">← Toutes les formations</a></p>
${buildSubpagesNav(f, allFormations)}
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
              <button type="button" class="btn" onclick="document.getElementById('contact').scrollIntoView({behavior:'smooth',block:'start'});setTimeout(function(){var i=document.querySelector('#contact input:not([type=hidden])');if(i)i.focus({preventScroll:true});},600)">Voir mon financement CPF →</button>
            </div>

          </section>
        </div>

        <!-- RIGHT: floating form -->
        <aside class="form-float">
          <section aria-labelledby="lead-form-title" id="contact">
            <h2 id="lead-form-title" class="f3-hidden-title">${f.form_cta}</h2>

            <!-- Formulaire 3 — Funnel éligibilité multi-étapes
                 data-preselect-formation → initForm3() pre-checks the matching radio on step 1 -->
            <form
              id="lead-form"
              action="${formAction}"
              method="post"
              autocomplete="on"
              data-client-slug="${CLIENT_SLUG}"
              data-offer-id="${f.offer_id || offerId}"
              data-form="3"
              data-preselect-formation="${getFormationCategory(f)}"
            >
              <!-- Stepper numéroté (masqué sur étape 0) -->
              <div class="f3-stepper f3-stepper--hidden" aria-label="Progression">
                <div class="f3-stepper-step" data-sn="1"><span>1</span></div>
                <div class="f3-stepper-line"></div>
                <div class="f3-stepper-step" data-sn="2"><span>2</span></div>
                <div class="f3-stepper-line"></div>
                <div class="f3-stepper-step" data-sn="3"><span>3</span></div>
              </div>

              <!-- ── Étape 0 : intro + consentement ── -->
              <div class="f3-step f3-step-intro" data-step="0">
                <div class="f3-intro-card" style="background-image: url('${f.image_url}')">
                  <p class="f3-headline">Vérification de votre éligibilité. C'est parti !</p>
                  <div class="f3-trust-pills">
                    <span>✅ Sans engagement</span>
                    <span>🔒 Données sécurisées</span>
                  </div>
                </div>
                <label class="f3-checkbox-row">
                  <input type="checkbox" id="f3_recall" />
                  <span class="f3-consent-text">J'accepte d'être recontacté(e) par un conseiller en formations pour vérifier mes droits CPF.</span>
                </label>
                <button type="button" class="f3-btn" data-action="to-1" disabled>Commençons ! →</button>
              </div>

              <!-- ── Étape 1 : formation souhaitée (pré-sélectionnée via data-preselect-formation) ── -->
              <div class="f3-step" data-step="1" hidden style="display:none">
                <p class="f3-question">Quelle formation vous intéresse ?</p>
                <div class="f3-options" role="group" aria-label="Formation souhaitée">
                  <label class="f3-option"><input type="radio" name="formation_choice" value="Informatique &amp; Digital" /><span class="f3-opt-icon">💻</span><span class="f3-opt-label">Informatique &amp; Digital</span></label>
                  <label class="f3-option"><input type="radio" name="formation_choice" value="Langues étrangères" /><span class="f3-opt-icon">🌍</span><span class="f3-opt-label">Langues étrangères</span></label>
                  <label class="f3-option"><input type="radio" name="formation_choice" value="Management &amp; Commerce" /><span class="f3-opt-icon">📊</span><span class="f3-opt-label">Management &amp; Commerce</span></label>
                  <label class="f3-option"><input type="radio" name="formation_choice" value="Comptabilité &amp; Gestion" /><span class="f3-opt-icon">🧾</span><span class="f3-opt-label">Comptabilité &amp; Gestion</span></label>
                  <label class="f3-option"><input type="radio" name="formation_choice" value="Santé &amp; Social" /><span class="f3-opt-icon">🏥</span><span class="f3-opt-label">Santé &amp; Social</span></label>
                  <label class="f3-option"><input type="radio" name="formation_choice" value="Bilan de compétences" /><span class="f3-opt-icon">🎯</span><span class="f3-opt-label">Bilan de compétences</span></label>
                  <label class="f3-option"><input type="radio" name="formation_choice" value="permis-cases" /><span class="f3-opt-icon">🚗</span><span class="f3-opt-label">Permis / CACES</span></label>
                  <label class="f3-option"><input type="radio" name="formation_choice" value="Autre formation professionnelle" /><span class="f3-opt-icon">✨</span><span class="f3-opt-label">Autre</span></label>
                </div>
                <div class="f3-btn-row">
                  <button type="button" class="f3-back-btn" data-action="back-to-0">← Retour</button>
                  <button type="button" class="f3-btn" data-action="to-2" disabled>Suivant →</button>
                </div>
              </div>

              <!-- ── Étape 2 : statut professionnel ── -->
              <div class="f3-step" data-step="2" hidden style="display:none">
                <p class="f3-question">Quel est votre statut professionnel ?</p>
                <div class="f3-options" role="group" aria-label="Statut professionnel">
                  <label class="f3-option"><input type="radio" name="professional_status" value="salarie" /><span class="f3-opt-icon">💼</span><span class="f3-opt-label">Employé secteur privé</span></label>
                  <label class="f3-option"><input type="radio" name="professional_status" value="fonction_publique" /><span class="f3-opt-icon">🏛️</span><span class="f3-opt-label">Employé fonction publique</span></label>
                  <label class="f3-option"><input type="radio" name="professional_status" value="chomage" /><span class="f3-opt-icon">🔍</span><span class="f3-opt-label">En recherche d'emploi</span></label>
                  <label class="f3-option"><input type="radio" name="professional_status" value="etudiant" /><span class="f3-opt-icon">🎓</span><span class="f3-opt-label">Étudiant(e)</span></label>
                </div>
                <div class="f3-btn-row">
                  <button type="button" class="f3-back-btn" data-action="back-to-1">← Retour</button>
                  <button type="button" class="f3-btn" data-action="result" disabled>Voir mes résultats →</button>
                </div>
              </div>

              <!-- ── Étape 3a : inéligible ── -->
              <div class="f3-step" data-step="3a" hidden style="display:none">
                <div class="f3-result-card f3-result-card--ineligible">
                  <div class="f3-result-emoji">😔</div>
                  <p class="f3-result-title f3-result-title--bad">Votre profil n'est pas éligible au CPF</p>
                  <p class="f3-result-text">Le CPF est réservé aux actifs du secteur privé et aux demandeurs d'emploi. Votre situation ne permet pas d'en bénéficier directement.</p>
                </div>
                <div class="f3-btn-row">
                  <button type="button" class="f3-back-btn" data-action="back-to-2">← Retour</button>
                  <button type="button" class="f3-btn f3-btn--secondary" data-action="to-4">Être contacté(e) quand même →</button>
                </div>
              </div>

              <!-- ── Étape 3b : éligible ── -->
              <div class="f3-step" data-step="3b" hidden style="display:none">
                <div class="f3-result-card f3-result-card--eligible">
                  <div class="f3-result-emoji">🏆</div>
                  <p class="f3-result-title f3-result-title--good">Félicitations — vous êtes éligible !</p>
                  <p class="f3-result-text">Votre profil correspond aux critères CPF. Financez votre formation sans avance de frais via Mon Compte Formation.</p>
                  <div class="f3-eligible-badges">
                    <span>✅ 100% financé</span>
                    <span>⏱️ Réponse sous 24h</span>
                  </div>
                </div>
                <div class="f3-btn-row">
                  <button type="button" class="f3-back-btn" data-action="back-to-2">← Retour</button>
                  <button type="button" class="f3-btn f3-btn--success" data-action="to-4">Être rappelé(e) par un conseiller →</button>
                </div>
              </div>

              <!-- ── Étape 4 : coordonnées ── -->
              <div class="f3-step" data-step="4" hidden style="display:none">
                <p class="f3-question">Vos coordonnées</p>
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
                  <label for="email">${config.field_email_label}</label>
                  <input id="email" name="email" type="email" autocomplete="email" placeholder="${config.field_email_placeholder}" />
                </div>
                <div>
                  <label for="phone">${config.field_phone_label}</label>
                  <input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="${config.field_phone_placeholder}" required />
                </div>
                <input type="hidden" name="formation_interest" id="formation_interest_val" value="" />
                <input type="hidden" name="consent_marketing" value="true" />
                <div class="form-honeypot" aria-hidden="true">
                  <input type="text" name="hp_trap" id="hp_trap" autocomplete="nope" tabindex="-1" />
                </div>
                <input type="hidden" id="utm_source"   name="utm_source"   value="" />
                <input type="hidden" id="utm_medium"   name="utm_medium"   value="" />
                <input type="hidden" id="utm_campaign" name="utm_campaign" value="" />
                <input type="hidden" id="utm_term"     name="utm_term"     value="" />
                <input type="hidden" id="utm_content"  name="utm_content"  value="" />
                <input type="hidden" id="search_query" name="search_query" value="" />
                <input type="hidden" id="page_version" name="page_version" value="${config.page_version || '1.0.0'}" />
                <div class="f3-btn-row">
                  <button type="button" class="f3-back-btn" data-action="back-to-3">← Retour</button>
                  <button type="submit">Confirmer ma demande →</button>
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
    url: `${baseUrl}${f.href}`,
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

  const bureautiqueSubPages = BUREAUTIQUE_SUBPAGES.map(s => ({
    url: `${baseUrl}${s.href}`,
    priority: '0.8',
    freq: 'monthly'
  }));
  const allPages = [...staticPages, ...formationPages, ...bureautiqueSubPages, ...blogPages];

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
  // f.href = "/langues/formation-anglais-toeic.html" → write to pages/langues/formation-anglais-toeic.html
  const hrefRelative = f.href.replace(/^\//, '');           // "langues/formation-anglais-toeic.html"
  const filePath     = path.join(outDir, hrefRelative);
  mkdirSync(path.dirname(filePath), { recursive: true });   // ensure subdirectory exists
  const html = assembleHTML(f, config, formations);
  writeFileSync(filePath, html, 'utf-8');
  console.log(`✅ clients/${CLIENT_SLUG}/pages/${hrefRelative}`);
  console.log(`   → ${baseUrl}${f.href}`);
}

// Generate sitemap.xml at repo root
const sitemapPath = path.join(ROOT, 'sitemap.xml');
const sitemap = buildSitemap(formations, config, baseUrl);
writeFileSync(sitemapPath, sitemap, 'utf-8');
console.log(`\n[sitemap] sitemap.xml generated`);
console.log(`   → ${baseUrl}/sitemap.xml`);

console.log(`\n[done] ${formations.length} pages generated.`);
console.log(`\nNext steps:`);
console.log(`  git add clients/${CLIENT_SLUG}/pages/formation-*.html`);
console.log(`  git commit -m "feat(${CLIENT_SLUG}): generate static formation pages"`);
console.log(`  git push`);
