/**
 * AdsVizor — Bureautique Subpages Generator
 *
 * Generates 3 static HTML pages targeting specific Google Ads keywords:
 *   - formation-excel.html    (Excel — tous niveaux)
 *   - formation-word.html     (Word — tous niveaux)
 *   - formation-powerpoint.html (PowerPoint — tous niveaux)
 *
 * Usage:
 *   node scripts/generate-bureautique-subpages.js
 *
 * Output: clients/formations/pages/formation-{excel|word|powerpoint}.html
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CLIENT_SLUG = (process.env.CLIENT_SLUG || 'formations').trim();

const config = JSON.parse(readFileSync(path.join(ROOT, `clients/${CLIENT_SLUG}/config.json`), 'utf-8'));

const baseUrl    = 'https://formations.adsvizor.com';
const logoText   = config.logo_text || 'AdsVizor';
const footerTxt  = config.footer_text || '';
const formAction = config.form_action || '';

function buildNav() {
  const items = [];
  for (let i = 0; i <= 4; i++) {
    const href  = config[`nav_item_${i}_href`];
    const label = config[`nav_item_${i}_label`];
    if (href && label) items.push(`<li><a href="${href}">${label}</a></li>`);
  }
  return items.join('\n          ');
}

function buildForm(formationTitle, offerId) {
  return `
            <form
              id="lead-form"
              action="${formAction}"
              method="post"
              autocomplete="on"
              data-client-slug="${CLIENT_SLUG}"
              data-offer-id="${offerId}"
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
                <input type="hidden" name="formation_interest" value="${formationTitle}" />
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
            </form>`;
}

function buildPage({ slug, title, metaDesc, canonical, ogImage, heroImg, heroAlt, h1, formCta, offerId, content }) {
  // data-static="true" → script.js will not override <title> and <meta description>
  return `<!doctype html>
<html lang="fr" data-static="true">
  <head>
    <meta charset="utf-8" />
    <link rel="icon" type="image/png" href="/favicon.png" sizes="any" />
    <link rel="apple-touch-icon" href="/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />

    <title>${title}</title>
    <meta name="description" content="${metaDesc}" />
    <link rel="canonical" href="${canonical}" />

    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${metaDesc}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${ogImage}" />

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
    .formation-section { margin: 32px 0; }
    .formation-section h2 { font-size: 1.25rem; font-weight: 700; color: #0f172a; margin: 0 0 14px; }
    .formation-section h3 { font-size: 1rem; font-weight: 700; color: #2563eb; margin: 20px 0 8px; }
    .niveau-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; margin-bottom: 16px; }
    .niveau-card .niveau-label { display: inline-block; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 3px 10px; border-radius: 999px; margin-bottom: 10px; }
    .niveau-debutant .niveau-label { background: #dcfce7; color: #166534; }
    .niveau-intermediaire .niveau-label { background: #fef9c3; color: #854d0e; }
    .niveau-avance .niveau-label { background: #ede9fe; color: #4c1d95; }
    .metiers-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
    .metier-card { background: #eff6ff; border-radius: 10px; padding: 12px 14px; }
    .metier-card strong { display: block; font-size: 0.88rem; font-weight: 700; color: #1e40af; }
    .metier-card span { font-size: 0.8rem; color: #475569; }
    .subpages-nav { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
    .subpages-nav a { display: inline-flex; align-items: center; gap: 6px; padding: 10px 18px; background: #eff6ff; color: #2563eb; border-radius: 10px; font-size: 0.9rem; font-weight: 600; text-decoration: none; border: 1.5px solid #bfdbfe; transition: background 140ms; }
    .subpages-nav a:hover { background: #dbeafe; }
    .subpages-nav a.active { background: #2563eb; color: #fff; border-color: #2563eb; }
    .certification-block { background: linear-gradient(135deg, #2563eb, #4f46e5); border-radius: 16px; padding: 24px; color: #fff; margin-top: 16px; }
    .certification-block h3 { color: #fff; margin: 0 0 10px; }
    .certification-block p { margin: 0; opacity: 0.9; font-size: 0.95rem; }
    @media (max-width: 600px) { .metiers-grid { grid-template-columns: 1fr; } }
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
          ${buildNav()}
        </ul>
      </nav>
    </header>
    <button class="nav-toggle" aria-expanded="false" aria-label="Ouvrir le menu">
      <span></span><span></span><span></span>
    </button>

    <main>
      <div class="page-layout">

        <div class="page-content">

          <section class="hero" aria-labelledby="page-title">
            <img class="hero-img" src="${heroImg}" alt="${heroAlt}" fetchpriority="high" />
            <div class="hero-body">
              <p class="hero-badge">Bureautique — Éligible CPF</p>
              <h1 id="page-title">${h1}</h1>
              <p class="hero-sub">Formation éligible CPF, finançable à 100 %. Débutant ou expert, progressez à votre rythme avec un conseiller dédié.</p>
              <a href="#contact" class="hero-cta" data-cta-id="cta-${slug}">Demander le programme</a>
            </div>
          </section>

          <section class="formation-detail-section">
            <p class="formation-breadcrumb">
              <a href="/formation-bureautique-office.html">← Bureautique</a>
            </p>

            <!-- Sous-formations navigation -->
            <div class="formation-section">
              <p style="font-size:0.88rem;color:#64748b;margin-bottom:8px;">Formations spécialisées dans cette série :</p>
              ${content.subnav}
            </div>

            ${content.body}

            <div class="formation-mobile-cta">
              <a href="#contact" class="btn">Demander le programme →</a>
            </div>
          </section>
        </div>

        <aside class="form-float">
          <section aria-labelledby="lead-form-title" id="contact">
            <h2 id="lead-form-title">${formCta}</h2>
            <div class="form-progress" aria-hidden="true">
              <div class="form-progress-fill"></div>
            </div>
            <div class="form-step-labels" aria-hidden="true">
              <span class="form-step-label is-active">Vos coordonnées</span>
              <span class="form-step-label">Votre profil</span>
            </div>
            ${buildForm(formCta, offerId)}
          </section>
        </aside>

      </div>
    </main>

    <footer>
      <p>${footerTxt}</p>
    </footer>
  </body>
</html>`;
}

// ── Sub-nav shared ────────────────────────────────────────────────────────────

function subnav(active) {
  const pages = [
    { slug: 'excel',       label: '📊 Formation Excel' },
    { slug: 'word',        label: '📝 Formation Word' },
    { slug: 'powerpoint',  label: '📊 Formation PowerPoint' },
  ];
  return `<div class="subpages-nav">
      ${pages.map(p => `<a href="/formation-${p.slug}.html"${p.slug === active ? ' class="active"' : ''}>${p.label}</a>`).join('\n      ')}
    </div>`;
}

// ── EXCEL ─────────────────────────────────────────────────────────────────────

const excel = buildPage({
  slug: 'excel',
  title: 'Formation Excel CPF — Apprendre Microsoft Excel Débutant à Expert | AdsVizor',
  metaDesc: 'Formation Microsoft Excel éligible CPF : débutant, intermédiaire ou avancé. Formules, tableaux croisés dynamiques, Power Query. Certification TOSA ou MOS. Sans avancer de frais.',
  canonical: `${baseUrl}/formation-excel.html`,
  ogImage: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1200&h=630&q=85&auto=format&fit=crop',
  heroImg: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=1400&h=700&q=85&auto=format&fit=crop',
  heroAlt: 'Professionnel travaillant sur Microsoft Excel avec des tableaux et graphiques',
  h1: 'Formation Excel — Maîtrisez Microsoft Excel et boostez votre carrière',
  formCta: 'Demandez votre programme Formation Excel',
  offerId: 'cpf-bureautique-excel',
  content: {
    subnav: subnav('excel'),
    body: `
            <div class="formation-section">
              <h2>Pourquoi apprendre Excel en 2025 ?</h2>
              <p>Microsoft Excel est utilisé par plus de 750 millions de professionnels dans le monde. Maîtriser Excel est aujourd'hui une compétence indispensable dans pratiquement tous les secteurs : finance, RH, marketing, logistique, gestion de projet. Une formation Microsoft Excel vous permet de gagner des heures chaque semaine, d'éviter les erreurs de calcul et d'analyser vos données avec précision.</p>
              <p>Que vous souhaitiez apprendre Excel débutant pour vos premières formules, ou perfectionner vos compétences Excel avec les tableaux croisés dynamiques et Power Query, nos formations s'adaptent à votre niveau et à vos objectifs professionnels.</p>
            </div>

            <div class="formation-section">
              <h2>Niveaux de formation Excel</h2>

              <div class="niveau-card niveau-debutant">
                <span class="niveau-label">Débutant</span>
                <h3>Cours Excel débutant — Les fondamentaux</h3>
                <p>Vous n'avez jamais utilisé Excel ou vous avez besoin de revoir les bases ? Ce niveau vous apprend à être opérationnel rapidement.</p>
                <ul>
                  <li>Découvrir l'interface Excel : cellules, feuilles, classeurs</li>
                  <li>Saisir et mettre en forme des données efficacement</li>
                  <li>Créer vos premières formules : SOMME, MOYENNE, MIN, MAX, SI</li>
                  <li>Construire des tableaux clairs et des graphiques basiques</li>
                  <li>Trier, filtrer et rechercher dans vos données</li>
                  <li>Imprimer et partager vos fichiers</li>
                </ul>
                <p><strong>Durée :</strong> 14 à 21 heures — <strong>Public :</strong> Tout professionnel sans expérience Excel</p>
              </div>

              <div class="niveau-card niveau-intermediaire">
                <span class="niveau-label">Intermédiaire</span>
                <h3>Formation Excel intermédiaire — Gagner en productivité</h3>
                <p>Vous connaissez les bases et voulez aller plus loin pour gagner du temps et analyser vos données avec puissance.</p>
                <ul>
                  <li>Fonctions avancées : RECHERCHEV, RECHERCHEX, INDEX/EQUIV, NB.SI, SOMME.SI</li>
                  <li>Tableaux croisés dynamiques (TCD) : créer, personnaliser, analyser</li>
                  <li>Graphiques avancés : courbes, secteurs, histogrammes, sparklines</li>
                  <li>Mise en forme conditionnelle pour visualiser vos données</li>
                  <li>Validation des données et listes déroulantes</li>
                  <li>Protection des feuilles et des classeurs</li>
                </ul>
                <p><strong>Durée :</strong> 21 à 35 heures — <strong>Public :</strong> Utilisateurs Excel avec bases confirmées</p>
              </div>

              <div class="niveau-card niveau-avance">
                <span class="niveau-label">Avancé / Expert</span>
                <h3>Formation Excel professionnel — Maîtriser Excel avancé</h3>
                <p>Automatisez vos tâches, créez des tableaux de bord dynamiques et manipulez des volumes de données importants.</p>
                <ul>
                  <li>Power Query : importer, transformer et consolider des données multi-sources</li>
                  <li>Power Pivot et modèles de données pour le reporting avancé</li>
                  <li>Macros VBA : automatiser les tâches répétitives</li>
                  <li>Tableaux de bord interactifs avec segments et chronologies</li>
                  <li>Fonctions matricielles et nouvelles formules (FILTRE, UNIQUE, TRIER)</li>
                  <li>Connexion à des bases de données externes</li>
                </ul>
                <p><strong>Durée :</strong> 35 à 70 heures — <strong>Public :</strong> Contrôleurs de gestion, analystes, responsables reporting</p>
              </div>
            </div>

            <div class="formation-section">
              <h2>Métiers accessibles après une formation Excel</h2>
              <p>Maîtriser Excel ouvre la porte à de nombreux postes dans tous les secteurs :</p>
              <div class="metiers-grid">
                <div class="metier-card"><strong>Analyste financier</strong><span>Modélisation et reporting financier</span></div>
                <div class="metier-card"><strong>Contrôleur de gestion</strong><span>Budgets, prévisions, tableaux de bord</span></div>
                <div class="metier-card"><strong>Chargé(e) de reporting</strong><span>Indicateurs de performance (KPI)</span></div>
                <div class="metier-card"><strong>Assistant(e) comptable</strong><span>Saisie, rapprochements, bilans</span></div>
                <div class="metier-card"><strong>Data analyst junior</strong><span>Analyse de données, visualisation</span></div>
                <div class="metier-card"><strong>Gestionnaire RH</strong><span>Paie, effectifs, tableaux de suivi</span></div>
                <div class="metier-card"><strong>Responsable logistique</strong><span>Stocks, flux, planification</span></div>
                <div class="metier-card"><strong>Chef de projet</strong><span>Plannings, suivi budgétaire</span></div>
              </div>
            </div>

            <div class="formation-section">
              <h2>Certification Excel reconnue</h2>
              <div class="certification-block">
                <h3>TOSA Excel ou MOS Excel (Microsoft Office Specialist)</h3>
                <p>À l'issue de votre formation sur Excel, vous pouvez passer une certification reconnue par les recruteurs. Le TOSA Excel (score sur 1000) et le MOS Excel évaluent vos compétences Excel de façon objective et valorisent votre CV sur le marché de l'emploi.</p>
              </div>
            </div>

            <div class="formation-section">
              <h2>Financement CPF — Apprendre Excel sans débourser un euro</h2>
              <p>Toutes nos formations Excel sont éligibles au Compte Personnel de Formation (CPF). Si vous êtes demandeur d'emploi inscrit à France Travail, votre formation est prise en charge à 100 % sans reste à charge. Si vous êtes salarié, le reste à charge de 150 € peut être pris en charge par votre entreprise.</p>
              <p>Notre conseiller vérifie votre éligibilité et votre solde CPF avec vous, et vous guide jusqu'à l'inscription. <strong>Apprendre Excel débutant ou avancé n'a jamais été aussi accessible.</strong></p>
            </div>`,
  }
});

// ── WORD ──────────────────────────────────────────────────────────────────────

const word = buildPage({
  slug: 'word',
  title: 'Formation Word CPF — Apprendre Microsoft Word Débutant à Avancé | AdsVizor',
  metaDesc: 'Formation Microsoft Word éligible CPF : débutant, intermédiaire ou avancé. Mise en page, styles, publipostage. Certification TOSA ou MOS Word. Sans avancer de frais.',
  canonical: `${baseUrl}/formation-word.html`,
  ogImage: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?w=1200&h=630&q=85&auto=format&fit=crop',
  heroImg: 'https://images.unsplash.com/photo-1455390582262-044cdead277a?w=1400&h=700&q=85&auto=format&fit=crop',
  heroAlt: 'Professionnelle rédigeant un document Microsoft Word sur son ordinateur',
  h1: 'Formation Word — Maîtrisez Microsoft Word pour tous vos documents professionnels',
  formCta: 'Demandez votre programme Formation Word',
  offerId: 'cpf-bureautique-word',
  content: {
    subnav: subnav('word'),
    body: `
            <div class="formation-section">
              <h2>Pourquoi se former sur Word en 2025 ?</h2>
              <p>Microsoft Word reste le logiciel de traitement de texte le plus utilisé dans le monde professionnel. Maîtriser Word vous permet de produire des documents irréprochables : rapports, contrats, courriers, procédures, comptes-rendus. Une formation sur Word vous fait gagner du temps, améliore votre image professionnelle et réduit les erreurs de mise en page.</p>
              <p>Que vous souhaitiez apprendre Word débutant pour créer vos premiers documents, ou maîtriser Word pour produire des rapports longs avec tables des matières automatiques et publipostage, nos formations s'adaptent à votre niveau.</p>
            </div>

            <div class="formation-section">
              <h2>Niveaux de formation Word</h2>

              <div class="niveau-card niveau-debutant">
                <span class="niveau-label">Débutant</span>
                <h3>Cours Word débutant — Créer vos premiers documents</h3>
                <p>Partez de zéro et devenez autonome sur Word rapidement pour vos tâches professionnelles du quotidien.</p>
                <ul>
                  <li>Découvrir l'interface Word et créer un nouveau document</li>
                  <li>Saisir, corriger et mettre en forme du texte (police, taille, couleur)</li>
                  <li>Créer et mettre en forme des tableaux simples</li>
                  <li>Insérer des images, des formes et des en-têtes/pieds de page</li>
                  <li>Utiliser la vérification orthographique et grammaticale</li>
                  <li>Enregistrer en différents formats (Word, PDF) et imprimer</li>
                </ul>
                <p><strong>Durée :</strong> 14 à 21 heures — <strong>Public :</strong> Tout professionnel sans expérience Word</p>
              </div>

              <div class="niveau-card niveau-intermediaire">
                <span class="niveau-label">Intermédiaire</span>
                <h3>Cours Word intermédiaire — Professionnaliser vos documents</h3>
                <p>Donnez un aspect professionnel à vos documents et gagnez du temps grâce aux outils avancés de Word.</p>
                <ul>
                  <li>Créer et appliquer des styles pour une mise en forme cohérente</li>
                  <li>Générer une table des matières et des tables de figures automatiques</li>
                  <li>Créer et utiliser des modèles de documents réutilisables</li>
                  <li>Maîtriser le publipostage pour les courriers, étiquettes et emails en masse</li>
                  <li>Gérer les sections, les sauts de page et les colonnes</li>
                  <li>Utiliser le suivi des modifications pour la révision collaborative</li>
                </ul>
                <p><strong>Durée :</strong> 21 à 35 heures — <strong>Public :</strong> Utilisateurs Word avec bases confirmées</p>
              </div>

              <div class="niveau-card niveau-avance">
                <span class="niveau-label">Avancé</span>
                <h3>Maîtriser Word — Documents longs et automatisation</h3>
                <p>Prenez la maîtrise complète de Word pour produire des documents complexes et automatiser les tâches répétitives.</p>
                <ul>
                  <li>Rédiger des documents longs : thèses, rapports annuels, procédures qualité</li>
                  <li>Créer des formulaires interactifs avec champs et cases à cocher</li>
                  <li>Automatiser des tâches avec les macros Word (VBA)</li>
                  <li>Gérer les références croisées et les notes de bas de page</li>
                  <li>Intégrer des données Excel dans Word (liaisons dynamiques)</li>
                  <li>Protéger et restreindre l'accès aux documents</li>
                </ul>
                <p><strong>Durée :</strong> 14 à 28 heures — <strong>Public :</strong> Juristes, assistants de direction, responsables qualité</p>
              </div>
            </div>

            <div class="formation-section">
              <h2>Métiers accessibles après une formation Word</h2>
              <p>Apprendre Word ouvre des opportunités dans de nombreux secteurs qui recherchent des profils administratifs et rédactionnels :</p>
              <div class="metiers-grid">
                <div class="metier-card"><strong>Secrétaire / Assistant(e)</strong><span>Rédaction de courriers et comptes-rendus</span></div>
                <div class="metier-card"><strong>Assistant(e) RH</strong><span>Contrats, procédures, communications internes</span></div>
                <div class="metier-card"><strong>Chargé(e) de communication</strong><span>Rapports, newsletters, dossiers de presse</span></div>
                <div class="metier-card"><strong>Juriste / Paralégal</strong><span>Contrats, actes juridiques, courriers</span></div>
                <div class="metier-card"><strong>Assistant(e) de direction</strong><span>Rapports de direction, présentations écrites</span></div>
                <div class="metier-card"><strong>Responsable qualité</strong><span>Procédures, manuels, certifications ISO</span></div>
                <div class="metier-card"><strong>Chargé(e) de projet</strong><span>Cahiers des charges, rapports d'avancement</span></div>
                <div class="metier-card"><strong>Agent administratif</strong><span>Formulaires, courriers officiels, archivage</span></div>
              </div>
            </div>

            <div class="formation-section">
              <h2>Certification Word reconnue</h2>
              <div class="certification-block">
                <h3>TOSA Word ou MOS Word (Microsoft Office Specialist)</h3>
                <p>Validez vos compétences avec une certification reconnue par les recruteurs. Le TOSA Word atteste de votre niveau sur une échelle de 1 à 1000. Le MOS Word est la certification officielle Microsoft. Les deux sont éligibles CPF et constituent un vrai atout sur votre CV.</p>
              </div>
            </div>

            <div class="formation-section">
              <h2>Financement CPF — Formation Word sans reste à charge</h2>
              <p>Votre formation sur Word est entièrement finançable via votre Compte Personnel de Formation. Demandeur d'emploi inscrit à France Travail : prise en charge à 100 %, aucun frais. Salarié : reste à charge de 150 € pouvant être pris en charge par votre employeur. Notre conseiller vous accompagne de la vérification de vos droits jusqu'à l'inscription.</p>
            </div>`,
  }
});

// ── POWERPOINT ────────────────────────────────────────────────────────────────

const powerpoint = buildPage({
  slug: 'powerpoint',
  title: 'Formation PowerPoint CPF — Apprendre PowerPoint Débutant à Expert | AdsVizor',
  metaDesc: 'Formation Microsoft PowerPoint éligible CPF : débutant, intermédiaire ou avancé. Créez des présentations percutantes. Certification TOSA ou MOS PowerPoint. Sans avancer de frais.',
  canonical: `${baseUrl}/formation-powerpoint.html`,
  ogImage: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=1200&h=630&q=85&auto=format&fit=crop',
  heroImg: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=1400&h=700&q=85&auto=format&fit=crop',
  heroAlt: 'Professionnel présentant des slides PowerPoint lors d\'une réunion d\'équipe',
  h1: 'Formation PowerPoint — Créez des présentations professionnelles qui marquent les esprits',
  formCta: 'Demandez votre programme Formation PowerPoint',
  offerId: 'cpf-bureautique-powerpoint',
  content: {
    subnav: subnav('powerpoint'),
    body: `
            <div class="formation-section">
              <h2>Pourquoi se former sur PowerPoint en 2025 ?</h2>
              <p>Microsoft PowerPoint est l'outil de référence pour créer des présentations professionnelles. Maîtriser PowerPoint vous permet de convaincre clients, managers et équipes grâce à des visuels clairs et percutants. Une formation sur PowerPoint améliore votre impact lors de réunions, soutenances, pitchs commerciaux et formations internes.</p>
              <p>Que vous souhaitiez apprendre PowerPoint débutant pour créer vos premières diapositives, ou maîtriser PowerPoint pour produire des présentations interactives avec animations avancées et intégration vidéo, nos cours PowerPoint s'adaptent à votre niveau et à vos besoins.</p>
            </div>

            <div class="formation-section">
              <h2>Niveaux de formation PowerPoint</h2>

              <div class="niveau-card niveau-debutant">
                <span class="niveau-label">Débutant</span>
                <h3>Cours PowerPoint débutant — Créer vos premières présentations</h3>
                <p>Démarrez de zéro et créez rapidement des présentations professionnelles claires et soignées.</p>
                <ul>
                  <li>Découvrir l'interface PowerPoint et créer une nouvelle présentation</li>
                  <li>Choisir et personnaliser un thème professionnel</li>
                  <li>Créer et organiser des diapositives : texte, images, icônes</li>
                  <li>Ajouter des formes, des flèches et des zones de texte</li>
                  <li>Appliquer des transitions entre les diapositives</li>
                  <li>Préparer et lancer un diaporama, exporter en PDF</li>
                </ul>
                <p><strong>Durée :</strong> 14 à 21 heures — <strong>Public :</strong> Tout professionnel sans expérience PowerPoint</p>
              </div>

              <div class="niveau-card niveau-intermediaire">
                <span class="niveau-label">Intermédiaire</span>
                <h3>Cours PowerPoint intermédiaire — Présentations percutantes</h3>
                <p>Apprenez à créer des présentations visuellement impactantes avec des animations fluides et une structure maîtrisée.</p>
                <ul>
                  <li>Créer et appliquer un modèle (template) personnalisé aux couleurs de votre marque</li>
                  <li>Maîtriser les animations d'objets (apparition, déplacement, emphase)</li>
                  <li>Intégrer des graphiques depuis Excel et des tableaux de données</li>
                  <li>Utiliser SmartArt pour illustrer des processus et des hiérarchies</li>
                  <li>Insérer des vidéos, sons et images haute définition</li>
                  <li>Créer un diaporama à plusieurs intervenants et gérer les droits</li>
                </ul>
                <p><strong>Durée :</strong> 21 à 35 heures — <strong>Public :</strong> Managers, commerciaux, chargés de communication</p>
              </div>

              <div class="niveau-card niveau-avance">
                <span class="niveau-label">Avancé</span>
                <h3>Maîtriser PowerPoint — Présentations interactives et automatisées</h3>
                <p>Passez au niveau expert pour créer des présentations interactives et automatiser leur production.</p>
                <ul>
                  <li>Créer des présentations interactives avec hyperliens et boutons d'action</li>
                  <li>Enregistrer une narration vocale pour les présentations autonomes</li>
                  <li>Exporter votre présentation en vidéo HD (mp4)</li>
                  <li>Créer des diaporamas automatiques pour kiosques et écrans d'affichage</li>
                  <li>Automatiser la création de slides avec les macros VBA</li>
                  <li>Intégrer Power BI pour des données dynamiques dans vos slides</li>
                </ul>
                <p><strong>Durée :</strong> 14 à 28 heures — <strong>Public :</strong> Formateurs, directeurs communication, chefs de projet</p>
              </div>
            </div>

            <div class="formation-section">
              <h2>Métiers accessibles après une formation PowerPoint</h2>
              <p>Maîtriser PowerPoint est un atout dans tous les métiers qui nécessitent de convaincre, former ou communiquer :</p>
              <div class="metiers-grid">
                <div class="metier-card"><strong>Chargé(e) de communication</strong><span>Présentations clients, presse, événements</span></div>
                <div class="metier-card"><strong>Commercial(e) / Business Developer</strong><span>Pitch commercial, soutenance de projets</span></div>
                <div class="metier-card"><strong>Consultant(e)</strong><span>Livrables clients, recommandations</span></div>
                <div class="metier-card"><strong>Formateur(trice)</strong><span>Supports pédagogiques, e-learning</span></div>
                <div class="metier-card"><strong>Manager / Chef de projet</strong><span>Reportings, roadmaps, comités de direction</span></div>
                <div class="metier-card"><strong>Responsable marketing</strong><span>Campagnes, analyses de marché, briefs</span></div>
                <div class="metier-card"><strong>Enseignant(e)</strong><span>Cours interactifs, supports visuels</span></div>
                <div class="metier-card"><strong>Chargé(e) RH</strong><span>Onboarding, formations internes, présentations</span></div>
              </div>
            </div>

            <div class="formation-section">
              <h2>Certification PowerPoint reconnue</h2>
              <div class="certification-block">
                <h3>TOSA PowerPoint ou MOS PowerPoint (Microsoft Office Specialist)</h3>
                <p>Validez vos compétences avec une certification reconnue. Le TOSA PowerPoint atteste de votre maîtrise de l'outil sur une échelle de 1 à 1000. Le MOS PowerPoint est la certification officielle Microsoft, reconnue dans plus de 100 pays. Les deux sont éligibles CPF et valorisent votre profil sur le marché du travail.</p>
              </div>
            </div>

            <div class="formation-section">
              <h2>Financement CPF — Formation PowerPoint sans frais</h2>
              <p>Votre formation sur PowerPoint est finançable à 100 % via votre CPF. Demandeur d'emploi : aucun reste à charge. Salarié : reste à charge de 150 € pouvant être pris en charge par votre entreprise via l'OPCO. Notre conseiller vérifie vos droits et vous accompagne jusqu'à l'inscription officielle.</p>
            </div>`,
  }
});

// ── Write files ───────────────────────────────────────────────────────────────

const outDir = path.join(ROOT, `clients/${CLIENT_SLUG}/pages`);
mkdirSync(outDir, { recursive: true });

const pages = [
  { filename: 'formation-excel.html',       html: excel },
  { filename: 'formation-word.html',        html: word },
  { filename: 'formation-powerpoint.html',  html: powerpoint },
];

console.log(`📦 Client: ${CLIENT_SLUG}`);
console.log(`🏗️  Generating 3 bureautique sub-pages...\n`);

for (const { filename, html } of pages) {
  writeFileSync(path.join(outDir, filename), html, 'utf-8');
  console.log(`✅ clients/${CLIENT_SLUG}/pages/${filename}`);
  console.log(`   → ${baseUrl}/${filename.replace('.html', '.html')}`);
}

console.log(`\n🎉 Done — 3 pages generated.`);
console.log(`\nSuggested new keywords per category:`);
console.log(`
Excel:
  "formation excel tosa"              | Phrase match
  "formation excel certifiante"       | Phrase match
  "cours excel intermediaire"         | Phrase match
  "formation excel avance"            | Phrase match
  [formation excel avance]            | Exact match
  "formation tableau croise dynamique"| Phrase match
  "vba excel formation"               | Phrase match
  "power query formation excel"       | Phrase match
  "formation excel pour comptable"    | Phrase match
  "formation reporting excel"         | Phrase match
  "formation excel analyse donnees"   | Phrase match

Word:
  "formation word tosa"               | Phrase match
  "formation word certifiante"        | Phrase match
  "cours word intermediaire"          | Phrase match
  "formation word avance"             | Phrase match
  "formation publipostage word"       | Phrase match
  "formation mise en page word"       | Phrase match
  "formation traitement de texte"     | Phrase match
  [formation traitement de texte]     | Exact match
  "formation word secretaire"         | Phrase match
  "cours traitement de texte"         | Phrase match
  "formation word assistant"          | Phrase match

PowerPoint:
  "formation powerpoint tosa"         | Phrase match
  "formation powerpoint certifiante"  | Phrase match
  "cours powerpoint intermediaire"    | Phrase match
  "formation powerpoint avance"       | Phrase match
  "formation creation presentation"   | Phrase match
  "formation slides professionnels"   | Phrase match
  "formation powerpoint manager"      | Phrase match
  [formation pitch powerpoint]        | Exact match
  "formation powerpoint commercial"   | Phrase match
  "cours presentation professionnelle"| Phrase match
  "formation diaporama"               | Phrase match
`);
