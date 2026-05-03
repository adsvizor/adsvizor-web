/**
 * AdsVizor Webuilder Agent
 *
 * Triggered by GitHub Actions on PR open/update (branch: webuilder/{slug})
 * 1. Reads webuilder/{slug}/NOTES.md from the PR branch
 * 2. Downloads catalog files from Drive links
 * 3. Extracts text (PDF, Excel, Word, images)
 * 4. Calls Claude API to analyze + generate config.json + pages
 * 5. Writes clients/{slug}/ structure to repo
 * 6. Posts PR comment with questions if info is missing
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ANTHROPIC = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GH_TOKEN  = process.env.GITHUB_TOKEN;
const PR_NUMBER = process.env.PR_NUMBER;
const REPO_OWNER = process.env.REPO_OWNER || 'adsvizor';
const REPO_NAME  = process.env.REPO_NAME  || 'adsvizor-web';
const BRANCH     = process.env.BRANCH_NAME || '';

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  // Extract client slug from branch name (webuilder/{slug})
  const slugMatch = BRANCH.match(/webuilder\/(.+)/);
  if (!slugMatch) {
    console.error(`❌ Cannot extract slug from branch: ${BRANCH}`);
    process.exit(1);
  }
  const clientSlug = slugMatch[1];
  console.log(`📦 Webuilder agent starting for: ${clientSlug}`);

  // Read NOTES.md
  const notesPath = `webuilder/${clientSlug}/NOTES.md`;
  if (!fs.existsSync(notesPath)) {
    await postPRComment(`❌ \`${notesPath}\` not found. Please add a NOTES.md with catalog links and description.`);
    process.exit(1);
  }
  const notes = fs.readFileSync(notesPath, 'utf-8');
  console.log(`✅ Read NOTES.md (${notes.length} chars)`);

  // Extract Drive links from NOTES.md
  const driveLinks = extractDriveLinks(notes);
  console.log(`📎 Found ${driveLinks.length} Drive link(s)`);

  // Download and extract text from catalog files
  let catalogText = '';
  for (const link of driveLinks) {
    try {
      const text = await downloadAndExtract(link);
      catalogText += `\n\n=== File: ${link.name} ===\n${text}`;
      console.log(`✅ Extracted text from ${link.name} (${text.length} chars)`);
    } catch (e) {
      console.warn(`⚠️ Could not extract ${link.name}: ${e.message}`);
    }
  }

  // Call Claude to analyze catalog + generate site config
  console.log('🤖 Calling Claude API to analyze catalog...');
  const result = await analyzeCatalog({ clientSlug, notes, catalogText });

  if (result.questions && result.questions.length > 0) {
    // Post questions as PR comment and stop
    const comment = buildQuestionsComment(result.questions);
    await postPRComment(comment);
    console.log('❓ Questions posted to PR — waiting for answers');
    return;
  }

  // Generate client site structure
  console.log('🏗️ Generating client site...');
  generateClientSite(clientSlug, result.config);

  // Post success comment
  const siteUrl = `https://${clientSlug}.adsvizor.com`;
  await postPRComment([
    `✅ **Site généré pour \`${clientSlug}\`**`,
    ``,
    `Le site a été construit et est prêt à déployer.`,
    `URL cible : ${siteUrl}`,
    ``,
    `**Fichiers créés :**`,
    `- \`clients/${clientSlug}/config.json\``,
    `- \`clients/${clientSlug}/pages/index.html\` (à venir)`,
    ``,
    `Merge ce PR pour déployer sur Cloudflare Pages.`,
  ].join('\n'));

  console.log(`✅ Client site generated for ${clientSlug}`);
}

// ─── Extract Drive links from NOTES.md ───────────────────────────────────────

function extractDriveLinks(notes) {
  const links = [];
  // Match markdown links: [filename](url)
  const regex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let match;
  while ((match = regex.exec(notes)) !== null) {
    const url = match[2];
    if (url.includes('drive.google.com') || url.includes('docs.google.com') ||
        url.includes('dropbox.com') || url.includes('onedrive') ||
        url.includes('wetransfer.com')) {
      links.push({ name: match[1], url: convertToDirectDownload(url) });
    }
  }
  return links;
}

function convertToDirectDownload(url) {
  // Google Drive: convert share link to direct download
  const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (idMatch) {
    return `https://drive.google.com/uc?export=download&id=${idMatch[1]}`;
  }
  return url;
}

// ─── Download file and extract text ──────────────────────────────────────────

async function downloadAndExtract(link) {
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(link.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = path.extname(link.name).toLowerCase();

  if (ext === '.pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ext === '.xlsx' || ext === '.xls') {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    let text = '';
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      text += `\n[Sheet: ${sheetName}]\n`;
      text += XLSX.utils.sheet_to_csv(sheet);
    }
    return text;
  }

  if (ext === '.csv' || ext === '.txt' || ext === '.md') {
    return buffer.toString('utf-8');
  }

  // For images or unknown formats, return a placeholder
  return `[Binary file: ${link.name} — ${buffer.length} bytes]`;
}

// ─── Brave Search helper ──────────────────────────────────────────────────────

async function braveSearch(query, count = 5) {
  const BRAVE_KEY = process.env.BRAVE_API_KEY;
  if (!BRAVE_KEY) return [];
  const { default: fetch } = await import('node-fetch');
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&search_lang=fr`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_KEY },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.web?.results || [];
  } catch (e) {
    console.warn(`⚠️ Brave search failed for "${query}": ${e.message}`);
    return [];
  }
}

// ─── Fetch and extract text from a webpage ───────────────────────────────────

async function fetchPageText(url, maxChars = 3000) {
  const { default: fetch } = await import('node-fetch');
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AdsVizorBot/1.0)' },
      timeout: 8000,
    });
    if (!res.ok) return '';
    const html = await res.text();
    // Strip HTML tags, scripts, styles — keep readable text
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
    return text.slice(0, maxChars);
  } catch (e) {
    return '';
  }
}

// ─── Web search for business reviews ─────────────────────────────────────────

async function searchBusinessReviews(businessName, sector, city) {
  if (!process.env.BRAVE_API_KEY) {
    console.log('ℹ️  BRAVE_API_KEY not set — skipping review search');
    return '';
  }

  const queries = [
    `avis clients "${businessName}"`,
    `${sector} ${city} avis Google`,
    `${businessName} témoignages`,
  ];

  let reviewsText = '';
  for (const q of queries) {
    const results = await braveSearch(q, 5);
    const snippets = results.map(r => `• ${r.title}: ${r.description}`).join('\n');
    if (snippets) reviewsText += `\n[Avis — "${q}"]\n${snippets}\n`;
  }

  console.log(`🔍 Reviews search: ${reviewsText.length} chars`);
  return reviewsText;
}

// ─── Web research on competitor sites ────────────────────────────────────────

async function researchCompetitorSites(sector, city) {
  if (!process.env.BRAVE_API_KEY) {
    console.log('ℹ️  BRAVE_API_KEY not set — skipping competitor research');
    return '';
  }

  const queries = [
    `site vitrine ${sector} ${city} devis gratuit`,
    `installateur ${sector} France landing page`,
    `${sector} prix tarif offre site`,
  ];

  // Collect unique URLs from search results (exclude directories, wikis, forums)
  const EXCLUDED = ['wikipedia', 'leboncoin', 'pagesjaunes', 'yelp', 'tripadvisor',
                    'facebook', 'linkedin', 'youtube', 'reddit', 'quora'];
  const urls = [];
  for (const q of queries) {
    const results = await braveSearch(q, 6);
    for (const r of results) {
      if (urls.length >= 4) break;
      if (EXCLUDED.some(ex => r.url.includes(ex))) continue;
      if (!urls.includes(r.url)) urls.push(r.url);
    }
    if (urls.length >= 4) break;
  }

  console.log(`🌐 Fetching ${urls.length} competitor pages...`);

  let competitorText = '';
  for (const url of urls) {
    const text = await fetchPageText(url, 2500);
    if (text.length > 200) {
      competitorText += `\n\n=== Concurrent: ${url} ===\n${text}`;
      console.log(`  ✅ ${url} (${text.length} chars)`);
    }
  }

  console.log(`🏆 Competitor research: ${competitorText.length} total chars`);
  return competitorText;
}

// ─── Claude API: analyze catalog ─────────────────────────────────────────────

async function analyzeCatalog({ clientSlug, notes, catalogText }) {
  // Extract business info for web search
  const nameMatch  = notes.match(/Nom\s*:\s*(.+)/i);
  const sectorMatch = notes.match(/Description\s*:\s*(.+)/i) || notes.match(/WEBUILDER:[^-]+-\s*(.+)/i);
  const cityMatch  = notes.match(/(?:Adresse|Ville)\s*:\s*.+?([A-ZÀ-Ü][a-zà-ü]+(?:\s[A-ZÀ-Ü][a-zà-ü]+)*)\s*\d/i);

  const businessName = nameMatch?.[1]?.trim() || clientSlug;
  const sector       = sectorMatch?.[1]?.trim() || '';
  const city         = cityMatch?.[1]?.trim() || '';

  const [reviewsText, competitorText] = await Promise.all([
    searchBusinessReviews(businessName, sector, city),
    researchCompetitorSites(sector, city),
  ]);

  const today = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const systemPrompt = `You are the AdsVizor Webuilder Agent. Generate a complete config.json for a lead-capture landing page.

AdsVizor is a multi-tenant system: each client gets a subdomain (${clientSlug}.adsvizor.com).
Templates use {{placeholder}} syntax filled at runtime from config.json.

Output a JSON object with:
- "config": complete config.json (all fields below, NO omissions)
- "questions": [] if you have enough info, or a list of questions if critical info is missing

━━━ REQUIRED FIELDS — generate ALL of them ━━━

## SEO & meta
lang, meta_title, meta_description, og_type, og_url ("https://${clientSlug}.adsvizor.com"),
og_image_url (Unsplash), home_href ("/"), logo_text, nav_aria_label

## Navigation (5 items — use anchors #hero #benefits #why-us #form #blog)
nav_item_0_href, nav_item_0_label, ..., nav_item_4_href, nav_item_4_label

## Hero section
headline, subheadline, hero_badge, hero_image_url, hero_image_alt, cta_href ("#form"), cta_id ("cta-hero"), cta_label

## Stats (show_stats: true)
stat_1_value, stat_1_label, stat_2_value, stat_2_label, stat_3_value, stat_3_label, stats_aria_label

## Benefits
benefits_title, benefit_1_title, benefit_1_text, benefit_1_image_url, benefit_1_image_alt,
benefit_2_title, benefit_2_text, benefit_2_image_url, benefit_2_image_alt

## Why us (use catalog + reviews to make this specific and credible)
why_us_title, why_us_a_emoji, why_us_a_title, why_us_a_text,
why_us_b_emoji, why_us_b_title, why_us_b_text,
why_us_c_emoji, why_us_c_title, why_us_c_text,
why_us_d_emoji, why_us_d_title, why_us_d_text

## Testimonials (show_testimonials: false but include fields)
testimonials_title, testimonial_1_text, testimonial_1_author, testimonial_2_text, testimonial_2_author

## Lead form — service dropdown (adapt options to this business, 4-6 options)
field_formation_label, field_formation_placeholder, field_formation_opt_1, field_formation_opt_2,
field_formation_opt_3, field_formation_opt_4 (add opt_5/opt_6 if relevant)

## Lead form — personal fields (REQUIRED — do not skip)
form_title, form_id ("lead-form"), form_action ("https://${clientSlug}.adsvizor.com/api/leads"),
field_first_name_label ("Prénom"), field_first_name_placeholder,
field_last_name_label ("Nom"), field_last_name_placeholder,
field_email_label ("Adresse email"), field_email_placeholder,
field_phone_label ("Téléphone"), field_phone_placeholder,
field_status_label ("Votre situation"),
field_message_label, field_message_placeholder, field_message_rows ("4"),
submit_label ("Recevoir mon devis gratuit" or similar),
form_disclaimer_text (RGPD consent text mentioning the company name and data retention),
client_slug ("${clientSlug}"), offer_id ("lead-gen-v1"), page_version ("1.0.0")

## Thank you page
thankyou_title, thankyou_message, security_code_label ("Votre code de sécurité"),
security_code_notice, thankyou_cta_label ("Retour à l'accueil"), thankyou_cta_href ("/")

## Footer
footer_text

## Contact page
contact_meta_title, contact_meta_description, contact_og_url ("https://${clientSlug}.adsvizor.com/contact.html"),
contact_hero_badge, contact_hero_title, contact_hero_subtitle,
contact_why_title,
contact_benefit_a_emoji, contact_benefit_a_title, contact_benefit_a_text,
contact_benefit_b_emoji, contact_benefit_b_title, contact_benefit_b_text,
contact_benefit_c_emoji, contact_benefit_c_title, contact_benefit_c_text,
contact_benefit_d_emoji, contact_benefit_d_title, contact_benefit_d_text,
contact_process_title, contact_process_intro,
contact_step_1_icon, contact_step_1_image (Unsplash), contact_step_1_title, contact_step_1_text,
contact_step_2_icon, contact_step_2_image, contact_step_2_title, contact_step_2_text,
contact_step_3_icon, contact_step_3_image, contact_step_3_title, contact_step_3_text,
contact_step_4_icon, contact_step_4_image, contact_step_4_title, contact_step_4_text,
contact_step_5_icon, contact_step_5_image, contact_step_5_title, contact_step_5_text,
contact_form_title, contact_mobile_cta_label

## Privacy page
privacy_meta_title, privacy_meta_description, privacy_og_url,
privacy_company_name, privacy_contact_email, privacy_effective_date ("${today}")

## Blog page
blog_meta_title, blog_meta_description, blog_og_url,
blog_title, blog_subtitle, blog_posts_aria_label, read_more_label ("Lire l'article")

## Blog posts (4 posts — adapt topics to this business sector)
post_1_href, post_1_date ("${today}"), post_1_tag, post_1_title, post_1_excerpt, post_1_image_url,
post_2_href, post_2_date, post_2_tag, post_2_title, post_2_excerpt, post_2_image_url,
post_3_href, post_3_date, post_3_tag, post_3_title, post_3_excerpt, post_3_image_url,
post_4_href, post_4_date, post_4_tag, post_4_title, post_4_excerpt, post_4_image_url

## Contact info
contact_company, contact_address, contact_phone, contact_email

━━━ IMAGES ━━━
Use Unsplash URLs: https://images.unsplash.com/photo-XXXXXXXXXX?w=1400&h=700&q=85&auto=format&fit=crop
Pick photos relevant to the exact business sector (not generic office photos).

━━━ COMPETITOR INSPIRATION ━━━
You have access to competitor website content. Use it to:
- Identify the best selling arguments used in this sector
- Adopt effective headline patterns and CTAs
- Extract service/offer naming conventions
- Spot gaps you can position as differentiators for this client
Do NOT copy text verbatim. Synthesize and adapt to this specific client.

━━━ LANGUAGE & TONE ━━━
Write in French. Adapt ALL text to this specific business. Do NOT use CPF/training language.
For why_us: use catalog data + web reviews + competitor analysis to write specific, credible arguments.`;

  const userMessage = `Client slug: ${clientSlug}
Today's date: ${today}

=== NOTES FROM SENDER ===
${notes}

=== CATALOG CONTENT ===
${catalogText || '(No catalog file attached — analyze from notes only)'}

${reviewsText ? `=== AVIS CLIENTS & REVIEWS WEB ===\n${reviewsText}` : ''}

${competitorText ? `=== SITES CONCURRENTS — inspiration structure et arguments ===\n${competitorText}` : ''}

Generate the COMPLETE config.json. Do not omit any field listed in the system prompt.`;

  const response = await ANTHROPIC.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 12000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0].text;

  // Extract JSON from response
  const jsonMatch = text.match(/```json\n?([\s\S]+?)\n?```/) ||
                    text.match(/(\{[\s\S]+\})/);
  if (!jsonMatch) {
    throw new Error('Claude did not return valid JSON');
  }

  return JSON.parse(jsonMatch[1]);
}

// ─── Generate client site structure ──────────────────────────────────────────

function generateClientSite(clientSlug, config) {
  const clientDir = `clients/${clientSlug}`;
  fs.mkdirSync(`${clientDir}/pages`, { recursive: true });
  fs.mkdirSync(`${clientDir}/blog`,  { recursive: true });

  // Write config.json
  fs.writeFileSync(
    `${clientDir}/config.json`,
    JSON.stringify(config, null, 2),
    'utf-8'
  );
  console.log(`✅ Written: ${clientDir}/config.json`);

  // Write minimal agent.config.json
  const agentConfig = {
    client_slug: clientSlug,
    base_url: `https://${clientSlug}.adsvizor.com`,
    system_prompt: `You are a professional blog writer for ${config.logo_text || clientSlug}. Write informative, SEO-optimized articles about ${config.meta_description || 'this business'}.`,
    article_types: ['guide', 'tips', 'news'],
    nav_links: [
      { label: 'Accueil', href: '/' },
      { label: 'Blog', href: '/blog.html' },
      { label: 'Contact', href: '/contact.html' },
    ],
  };
  fs.writeFileSync(
    `${clientDir}/agent.config.json`,
    JSON.stringify(agentConfig, null, 2),
    'utf-8'
  );
  console.log(`✅ Written: ${clientDir}/agent.config.json`);
}

// ─── GitHub PR comment ────────────────────────────────────────────────────────

async function postPRComment(body) {
  if (!PR_NUMBER || !GH_TOKEN) {
    console.log('PR comment (dry run):', body);
    return;
  }
  const { default: fetch } = await import('node-fetch');
  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues/${PR_NUMBER}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${GH_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'AdsVizor-WebuilderAgent/1.0',
      },
      body: JSON.stringify({ body }),
    }
  );
  if (res.ok) console.log('✅ PR comment posted');
  else console.error('❌ PR comment failed:', await res.text());
}

function buildQuestionsComment(questions) {
  return [
    '## ❓ Webuilder Agent — Questions',
    '',
    "J'ai besoin de quelques informations supplémentaires pour générer le site :",
    '',
    ...questions.map((q, i) => `${i + 1}. ${q}`),
    '',
    'Réponds à ce commentaire ou mets à jour `NOTES.md` et pousse un nouveau commit.',
  ].join('\n');
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch(async (err) => {
  console.error('❌ Fatal error:', err);
  await postPRComment(`❌ **Webuilder agent error:**\n\`\`\`\n${err.message}\n\`\`\``);
  process.exit(1);
});
