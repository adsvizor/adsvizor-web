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

  // Load reference config (formations) as schema example
  let referenceConfig = '';
  try {
    const refPath = `clients/formations/config.json`;
    if (fs.existsSync(refPath)) {
      const refRaw = JSON.parse(fs.readFileSync(refPath, 'utf-8'));
      // Keep only scalar fields (no cpf_formations array) to save tokens
      const refFiltered = Object.fromEntries(
        Object.entries(refRaw).filter(([k, v]) => typeof v !== 'object')
      );
      referenceConfig = JSON.stringify(refFiltered, null, 2);
      console.log(`✅ Loaded reference config (${referenceConfig.length} chars)`);
    }
  } catch (e) {
    console.warn(`⚠️ Could not load reference config: ${e.message}`);
  }

  const systemPrompt = `You are the AdsVizor Webuilder Agent. Generate a complete config.json for a lead-capture landing page.

AdsVizor is a multi-tenant system: each client gets a subdomain (${clientSlug}.adsvizor.com).
Templates use {{placeholder}} syntax filled at runtime from config.json.

Output a JSON object with:
- "config": complete config.json adapted for the new client
- "questions": [] if you have enough info, or specific questions if critical info is missing

INSTRUCTIONS:
1. Use the REFERENCE CONFIG below as your schema — generate ALL the same keys, adapted for the new client.
2. Replace every value with content specific to the new client's business (sector, services, location, brand).
3. Update: client_slug to "${clientSlug}", og_url/form_action/og_url to "https://${clientSlug}.adsvizor.com", privacy_effective_date to "${today}".
4. For field_formation_opt_*: create 4-6 options relevant to this client's actual services (NOT training/CPF options).
5. For why_us_*: use the catalog + web reviews + competitor research to write specific, credible arguments.
6. For post_*: write 4 blog post ideas relevant to this business sector with realistic dates near ${today}.
7. Use Unsplash URLs for all images, choosing photos relevant to the exact business sector.
8. Write everything in French.
9. Do NOT include the cpf_formations array — that is formations-specific.
10. Do NOT copy formations content — adapt everything to the new client.`;

  const userMessage = `Client slug: ${clientSlug}
Today's date: ${today}

=== REFERENCE CONFIG (use as schema — generate ALL the same keys) ===
${referenceConfig}

=== NOTES FROM SENDER ===
${notes}

=== CATALOG CONTENT ===
${catalogText || '(No catalog file attached — analyze from notes only)'}

${reviewsText ? `=== AVIS CLIENTS & REVIEWS WEB ===\n${reviewsText}` : ''}

${competitorText ? `=== SITES CONCURRENTS — inspiration structure et arguments ===\n${competitorText}` : ''}

Generate the complete config.json following the reference schema above. Adapt ALL values to this new client.`;

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
