/**
 * patch-form3.js
 * Replaces the old lead form (<aside class="form-float">…</aside>) in every
 * hand-crafted formation page with the form3 funnel.
 *
 * Only touches files that do NOT already have data-form="3".
 *
 * Usage:
 *   node scripts/patch-form3.js
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'clients/formations/pages');

// ── Category → form3 radio value ────────────────────────────────────────────
const CATEGORY_MAP = {
  bureautique:    'Informatique &amp; Digital',
  ia:             'Informatique &amp; Digital',
  langues:        'Langues étrangères',
  management:     'Management &amp; Commerce',
  marketing:      'Management &amp; Commerce',
  finance:        'Comptabilité &amp; Gestion',
  entrepreneuriat:'Autre formation professionnelle',
  'dev-personnel':'Autre formation professionnelle',
};

function getCategoryFromDir(dir) {
  const cat = path.basename(dir);
  return CATEGORY_MAP[cat] || 'Autre formation professionnelle';
}

// ── Extract hero image URL from existing HTML ────────────────────────────────
function extractHeroImage(html) {
  const m = html.match(/<img class="hero-img"[^>]+src="([^"]+)"/);
  return m ? m[1] : '';
}

// ── Extract offer_id from existing HTML ──────────────────────────────────────
function extractOfferId(html) {
  const m = html.match(/data-offer-id="([^"]+)"/);
  return m ? m[1] : '';
}

// ── Extract form action URL ──────────────────────────────────────────────────
function extractFormAction(html) {
  const m = html.match(/action="([^"]+)"/);
  return m ? m[1] : 'https://formations.adsvizor.com/api/leads';
}

// ── Build replacement aside with form3 ──────────────────────────────────────
function buildForm3Aside(imageUrl, offerId, formAction, preselectFormation) {
  return `        <aside class="form-float">
          <section aria-labelledby="lead-form-title" id="contact">
            <h2 id="lead-form-title" class="f3-hidden-title">Vérifiez vos droits CPF</h2>

            <form
              id="lead-form"
              action="${formAction}"
              method="post"
              autocomplete="on"
              data-client-slug="formations"
              data-offer-id="${offerId}"
              data-form="3"
              data-preselect-formation="${preselectFormation}"
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
                <div class="f3-intro-card" style="background-image: url('${imageUrl}')">
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

              <!-- ── Étape 1 : formation souhaitée (pré-sélectionnée) ── -->
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
                    <label for="first_name">Prénom</label>
                    <input id="first_name" name="first_name" type="text" autocomplete="given-name" placeholder="Votre prénom" required />
                  </div>
                  <div>
                    <label for="last_name">Nom</label>
                    <input id="last_name" name="last_name" type="text" autocomplete="family-name" placeholder="Votre nom de famille" required />
                  </div>
                </div>
                <div>
                  <label for="email">Email</label>
                  <input id="email" name="email" type="email" autocomplete="email" placeholder="votre@email.com" />
                </div>
                <div>
                  <label for="phone">Téléphone</label>
                  <input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="06 00 00 00 00" required />
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
                <input type="hidden" id="page_version" name="page_version" value="" />
                <div class="f3-btn-row">
                  <button type="button" class="f3-back-btn" data-action="back-to-3">← Retour</button>
                  <button type="submit">Confirmer ma demande →</button>
                </div>
              </div>

            </form>
          </section>
        </aside>`;
}

// ── Walk pages directory recursively ────────────────────────────────────────
function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walk(full));
    } else if (entry.endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────────────────────
const files = walk(PAGES_DIR);
let patched = 0, skipped = 0;

for (const filePath of files) {
  const html = readFileSync(filePath, 'utf-8');

  // Skip if already using form3
  if (html.includes('data-form="3"')) {
    console.log(`⏭  Already form3: ${path.relative(ROOT, filePath)}`);
    skipped++;
    continue;
  }

  // Skip if no aside.form-float (not a formation page with a sidebar form)
  if (!html.includes('<aside class="form-float">')) {
    console.log(`⏭  No aside found: ${path.relative(ROOT, filePath)}`);
    skipped++;
    continue;
  }

  const dir             = path.dirname(filePath);
  const preselectFormation = getCategoryFromDir(dir);
  const imageUrl        = extractHeroImage(html);
  const offerId         = extractOfferId(html);
  const formAction      = extractFormAction(html);

  // Replace entire <aside class="form-float">…</aside> block
  const newAside = buildForm3Aside(imageUrl, offerId, formAction, preselectFormation);
  const patched_html = html.replace(
    /<aside class="form-float">[\s\S]*?<\/aside>/,
    newAside
  );

  if (patched_html === html) {
    console.log(`⚠️  No replacement made: ${path.relative(ROOT, filePath)}`);
    skipped++;
    continue;
  }

  writeFileSync(filePath, patched_html, 'utf-8');
  console.log(`✅ Patched: ${path.relative(ROOT, filePath)}`);
  console.log(`   preselect="${preselectFormation}" | offer="${offerId}" | img="${imageUrl.slice(0,50)}…"`);
  patched++;
}

console.log(`\n🎉 Done — ${patched} file(s) patched, ${skipped} skipped.`);
